import autoBind from 'auto-bind';
import { v4 as uuidv4 } from 'uuid';
import {
  AcceptConnectionsArgs,
  ConnectArgs,
  ConnectionDetails,
  ConnectMessage,
  EncryptionValues,
  InternalRequestNames,
  InternalRequestKeys,
  isError,
  isRequestMessage,
  Listener,
  Listeners,
  RequestName,
  PostMessengerArgs,
  RemoveAllResponders,
  RemoveListener,
  RequestOptions,
  Responders,
  ValidateOriginFn,
  ValidateRequest,
} from './types';
import {
  ab2str,
  decodeBase64,
  encodeBase64,
  hasOwnProperty,
  isUndef,
  shallowCompare,
  str2ab,
} from './utils';

const AESCBC = 'AES-CBC';

class PostMessenger<T extends Record<string, string> | undefined = undefined> {
  /* prefixed to messages and log messages to help distinguish sending/receiving side */
  clientName: string;

  connection: ConnectionDetails | null = null;

  #enableLogging: boolean;

  /* when true will encrypt messages using a key determined by self or trusted connection initiator: */
  useEncryption: (requestName?: string, throwForNoConnection?: boolean | ((error: Error) => void)) => boolean;

  /* these must be kept private, prefix with # for runtime guarentee (see https://bit.ly/31tQYou) */
  #encryptionValues: EncryptionValues = {
    algorithm: null,
    iv: null,
    requestKey: null,
  };

  #listeners: Listeners = {};

  /* maxResponseTime max time to wait in ms before canceling request */
  maxResponseTime: number;

  targetWindow: Window | null = null;

  targetOrigin: string | null = null;

  /* message names to keys representing sent and expected received request names */
  #requestNames: T | undefined;

  #validateOrigin: ValidateOriginFn | null = null;

  constructor(
    {
      clientName = 'unknown',
      enableLogging = false,
      useEncryption = true,
      maxResponseTime = 10000,
    }: PostMessengerArgs,
    requestNames?: T,
  ) {
    autoBind(this);
    this.clientName = clientName;
    this.#enableLogging = enableLogging;
    this.useEncryption = (requestName, throwForNoConnection = false): boolean => {
      const useEncryptionForMessage = useEncryption && requestName !== InternalRequestNames.postMessengerConnect;
      if (useEncryptionForMessage && !this.connection && throwForNoConnection) {
        const error = this.#buildError(`Cannot send request ${requestName}. Encryption is on but there is no connected client.`);
        if (typeof throwForNoConnection === 'function') {
          throwForNoConnection(error);
        } else {
          throw error;
        }
      }
      return useEncryptionForMessage;
    };

    if (requestNames && hasOwnProperty(requestNames, InternalRequestKeys.postMessengerConnect)) {
      throw this.#buildError(`${InternalRequestKeys.postMessengerConnect} is a reserved request name.`);
    }

    this.maxResponseTime = maxResponseTime;
    this.#requestNames = requestNames;

    this.#logger('created');
  }

  get requestNames(): T {
    return this.#requestNames as T;
  }

  #prefix(str: string): string {
    return `postMessenger: ${this.clientName} ${str}`;
  }

  #logger(...args: unknown[]): void {
    if (this.#enableLogging) {
      if (typeof args[0] === 'string') {
        console.log(this.#prefix(args[0]), ...args.slice(1));
      } else {
        console.log(...args);
      }
    }
  }

  #buildError(msg: string): Error {
    return new Error(this.#prefix(msg));
  }

  #addListener(messageName: string, fn: Listener): RemoveListener {
    if (this.#listeners[messageName]) {
      this.#listeners[messageName].push(fn);
    } else {
      this.#listeners[messageName] = [fn];
    }
    return () => this.#removeListener(messageName, fn);
  }

  #removeListener(messageName: string, fn: Listener): void {
    if (this.#listeners[messageName]) {
      const i = this.#listeners[messageName].indexOf(fn);
      if (i > -1) {
        this.#listeners[messageName].splice(i, i + 1);
      }
    }
  }

  onReceiveMessage(event: WindowEventMap['message']): void {
    if (event.data && this.#listeners[event.data.requestName]) {
      if (this.#validateOrigin) {
        if (!this.#validateOrigin(event.origin)) {
          return;
        }
      }
      this.#listeners[event.data.requestName].forEach((listener) => {
        listener(event.data, event);
      });
    }
  }

  /* Sends a single message with no expectation for a response. Internal use only, clients should use request */
  #send(message: unknown = {}): void {
    if (!this.targetWindow || !this.targetOrigin) {
      throw this.#buildError('targetWindow has not been initialized, please ensure you call setTarget before calling beginListening');
    }
    this.targetWindow.postMessage(message, this.targetOrigin);
  }

  /* Build and send RequestMessage shape expected by this.request */
  async #sendRequestMessage(requestName: string, requestId: string, messageData: unknown = {}, errorMessageStr?: string): Promise<void> {
    let data = messageData;
    let errorMessage = errorMessageStr || null;
    if (this.useEncryption(requestName, true)) {
      data = await this.#encrypt(messageData);
      if (errorMessage) {
        errorMessage = await this.#encrypt(errorMessage);
      }
    }
    this.#send({
      data,
      errorMessage,
      isError: Boolean(errorMessage),
      requestId,
      requestName,
    });
  }

  /* Sends a message and listens for a response matching a unique message id. */
  async #request<R = unknown>(requestName: string, data: unknown = {}, options: RequestOptions = {}): Promise<R> {
    const requestId = uuidv4();
    this.#logger(`sending request with name '${requestName}' to '${this.targetOrigin}':`, data);
    const result = new Promise((resolve, reject) => {
      let hasCompleted = false;
      const removeResponseListener = this.#addListener(requestName, async (responseMessage): Promise<void> => {
        if (!isRequestMessage<R>(responseMessage)) {
          return;
        }
        if (responseMessage.requestId === requestId) {
          hasCompleted = true;
          removeResponseListener();
          if (responseMessage.isError) {
            let errorMessage = responseMessage.errorMessage;
            if (this.useEncryption(requestName, true) && responseMessage.errorMessage) {
              errorMessage = await this.#decrypt(responseMessage.errorMessage);
            }
            reject(this.#buildError(
              `Responder for request name '${requestName}' to target '${this.targetOrigin}' ` +
              `failed with message: "${errorMessage}"`,
            ));
          } else {
            let responseMessageData = responseMessage.data;
            if (this.useEncryption(requestName, true)) {
              if (typeof responseMessage.data !== 'string') {
                reject(this.#buildError(
                  `encryption is required but request received a non string data response for message: ${requestName}`,
                ));
                return;
              }
              responseMessageData = await this.#decrypt<R>(responseMessage.data);
            }
            resolve(responseMessageData);
          }
        }
      });

      setTimeout(() => {
        if (!hasCompleted) {
          reject(this.#buildError(
            `Time out waiting for target '${this.targetOrigin}' to respond to request name '${requestName}'`,
          ));
          removeResponseListener();
        }
      }, options.maxResponseTime || this.maxResponseTime);
    });

    await this.#sendRequestMessage(requestName, requestId, data);

    return result as Promise<R>;
  }

  /* validate requestName exists if optional requestNames are provided to constructor */
  #getRequestName(requestName: string): string {
    if (InternalRequestNames[requestName]) {
      return InternalRequestNames[requestName];
    }

    if (this.requestNames) {
      if (!this.requestNames[requestName]) {
        throw this.#buildError(
          `requestNames were provided to constructor but unable to find requestName for ${String(requestName)}`,
        );
      }
      return this.requestNames[requestName];
    }
    return requestName;
  }

  /* type safe public request wrapper for #requestNames */
  request<R = unknown>(requestName: RequestName<T>, data: unknown = {}, options: RequestOptions = {}): Promise<R> {
    if (this.requestNames && this.connection && this.connection.requestNames && !this.connection.requestNames[String(requestName)]) {
      throw this.#buildError(
        `Connected client ${this.connection.clientName} does not have a matching request name for ${String(requestName)} so this request will fail.`,
      );
    }
    return this.#request<R>(this.#getRequestName(requestName), data, options);
  }

  /* Accepts an object of event requestNames mapping to handlers that return promises.
     Adds listeners that expect messages sent by the request function above in
     order to return a corresponding requestId */
  #bindResponders(responders: Responders<T> | Responders<InternalRequestNames>, validateRequest: ValidateRequest | null = null): RemoveAllResponders {
    const allRemoveFns: RemoveListener[] = [];
    Object.entries(responders).forEach(([messageName, handler]) => {
      const requestName = this.#getRequestName(messageName);
      const removeListenerFn = this.#addListener(requestName, async (message, event: WindowEventMap['message']): Promise<void> => {
        if (!isRequestMessage(message) || !handler) {
          return;
        }

        if (validateRequest && !validateRequest(message.data)) {
          return;
        }

        let { data } = message;
        try {
          if (this.useEncryption(requestName, true)) {
            if (typeof data !== 'string') {
              throw this.#buildError('encryption is required but responder received a non string data response');
            }
            data = await this.#decrypt(data);
          }
          const response = await handler(data, event);
          this.#logger(`responding to request name '${requestName}' from target '${this.targetOrigin}':`, response);
          this.#sendRequestMessage(requestName, message.requestId, response);
        } catch (e) {
          if (isError(e)) {
            this.#sendRequestMessage(requestName, message.requestId, {}, e.message);
          } else {
            this.#sendRequestMessage(requestName, message.requestId, {}, this.#prefix('responder threw a non Error object'));
          }
        }
      });
      allRemoveFns.push(removeListenerFn);
    });

    return () => {
      this.#logger('removing responders:', responders);
      allRemoveFns.forEach(removeFn => removeFn());
    };
  }

  bindResponders(responders: Responders<T>): RemoveAllResponders {
    if (hasOwnProperty(responders, InternalRequestKeys.postMessengerConnect)) {
      throw this.#buildError(`${InternalRequestKeys.postMessengerConnect} is a reserved request name.`);
    }
    return this.#bindResponders(responders);
  }

  async connect({ targetWindow, targetOrigin, maxRetries = 10 }: ConnectArgs): Promise<boolean> {
    if (!targetWindow || !targetOrigin) {
      throw this.#buildError('targetWindow and targetOrigin are required for connect');
    }
    this.#setTarget(targetWindow, targetOrigin);
    this.#beginListening(origin => (origin === new URL(targetOrigin).origin));

    let iv: Uint8Array | null = null;
    let jsonRequestKey: JsonWebKey | null = null;
    const useEncryption = this.useEncryption();
    if (useEncryption) {
      iv = crypto.getRandomValues(new Uint8Array(16));
      /* encryption code based examples https://bit.ly/3ex4DiQ and https://ibm.co/30ABCdZ */

      this.#encryptionValues.requestKey = await crypto.subtle.generateKey(
        { length: 256, name: AESCBC }, // AES in CBC mode, with a key length of 256 bits.
        true, // Allow extracting the key material
        ['encrypt', 'decrypt'], // Restrict usage of the key
      );
      jsonRequestKey = await crypto.subtle.exportKey('jwk', this.#encryptionValues.requestKey);

      // AES-CBC requires a 128-bit initialization vector (iv).
      this.#encryptionValues.iv = iv;

      // The algorithm is still AES-CBC. The 128-bit iv must be specified.
      this.#encryptionValues.algorithm = { iv, name: AESCBC };
    }

    const tries = maxRetries || 1;
    const maxResponseTime = 500;
    let connection: null | ConnectionDetails = null;
    for (let i = 0; i < tries; i += 1) {
      try {
        connection = await this.#request<ConnectionDetails>(InternalRequestNames.postMessengerConnect, {
          clientName: this.clientName,
          iv,
          jsonRequestKey,
          origin: window.location.origin,
          requestNames: this.requestNames,
          useEncryption,
        }, { maxResponseTime });
      } catch (e) { /* ignore */ }

      if (connection) {
        this.connection = connection;
        break;
      }
    }

    if (!this.connection) {
      throw this.#buildError(`Connection failed after ${tries} attempts over ${(tries * maxResponseTime) / 1000} seconds.`);
    }

    this.#logger(`Connection established to ${this.connection.clientName}`, this.connection);

    return true;
  }

  acceptConnections({
    allowAnyOrigin = false,
    fromClientName = null,
    origin,
  }: AcceptConnectionsArgs): Promise<ConnectionDetails> {
    if (!allowAnyOrigin && !origin) {
      throw this.#buildError('allowAnyOrigin must be true if origin is not specified');
    }

    /* Optionally allow caller to specify client name to accept connections from. This helps
       disambiguate multiple postMessenger connections on the same page to / from same origin */
    const validateConnectRequest = (data: ConnectMessage) => (
      !fromClientName || fromClientName === data.clientName
    );

    this.#beginListening(messageOrigin => (origin ? messageOrigin === origin : true));

    return new Promise((resolve, reject) => {
      const removeConnectionResponder = this.#bindResponders({
        postMessengerConnect: async (data: ConnectMessage, event): Promise<ConnectionDetails> => {
          if (!event.source) {
            reject(this.#buildError('Received connection attempt but event.source is null'));
          }

          this.connection = {
            clientName: data.clientName,
            requestNames: data.requestNames,
            useEncryption: data.useEncryption,
          };

          this.#setTarget(event.source as Window, data.origin);

          const requestNames = this.requestNames;
          /* check to make sure both sides agree on requestNames */
          const providedRequestNamesObjMatch = (
            !!requestNames &&
            !!data.requestNames &&
            shallowCompare(requestNames, data.requestNames)
          );

          /* either they are both provided and match or both should be undefined: */
          if (!providedRequestNamesObjMatch && !(isUndef(this.requestNames) && isUndef(data.requestNames))) {
            reject(this.#buildError('Received connection attempt but requestNames must be the same for both PostMessenger instances'));
          }

          /* check to make sure both sides agree on useEncryption */
          const useEncryption = this.useEncryption();
          if (useEncryption !== data.useEncryption) {
            reject(this.#buildError('Received connection attempt but useEncryption must be the same for both PostMessenger instances'));
          }

          if (this.useEncryption()) {
            if (!data.iv || !data.jsonRequestKey || !data.useEncryption) {
              const error = this.#buildError(
                'encryption is required but iv or jsonRequestKey or useEncryption were not provided in connection message.',
              );
              reject(error);
              throw error;
            }

            this.#encryptionValues.iv = new Uint8Array([...data.iv]);
            this.#encryptionValues.algorithm = { iv: this.#encryptionValues.iv, name: AESCBC };
            this.#encryptionValues.requestKey = await crypto.subtle.importKey(
              'jwk',
              data.jsonRequestKey,
              { name: AESCBC },
              false,
              ['encrypt', 'decrypt'],
            );
          }

          /* If the page has multiple postMessenger instances to / from same origin there could be
         a second connect message that overwrites this connection. Once the first connection
         is confirmed we should stop listening for future connect messages: */
          removeConnectionResponder();

          this.#logger(`Accepted connection from ${this.connection.clientName}`, this.connection);

          resolve(this.connection);

          return {
            clientName: this.clientName,
            requestNames: data.requestNames,
            useEncryption: this.useEncryption(),
          };
        },
      }, validateConnectRequest);
    });
  }

  #setTarget(targetWindow: Window, targetOrigin: string): void {
    if (!targetWindow || !targetOrigin) {
      throw this.#buildError('targetWindow and targetWindow are required for setTarget');
    }
    this.targetWindow = targetWindow;
    /* validate initTargetOrigin is proper URL: */
    const targetUrl = new URL(targetOrigin);
    this.targetOrigin = targetUrl.origin;
  }

  #beginListening(validateOrigin: ValidateOriginFn): void {
    this.#validateOrigin = validateOrigin;
    window.addEventListener('message', this.onReceiveMessage);
  }

  stopListening(): void {
    window.removeEventListener('message', this.onReceiveMessage);
  }

  async #decrypt<R = unknown>(data: string): Promise<R> {
    if (!this.#encryptionValues.algorithm || !this.#encryptionValues.requestKey) {
      throw this.#buildError('encryptionValues must be set before calling decrpyt');
    }

    const base64Decoded = decodeBase64(data);
    const encodedData = str2ab(base64Decoded);
    const decryptedData = await crypto.subtle.decrypt(
      this.#encryptionValues.algorithm,
      this.#encryptionValues.requestKey,
      encodedData,
    );

    if (decryptedData.byteLength === 0) {
      return null as unknown as R;
    }

    const textDecoder = new TextDecoder();
    const decryptedText = textDecoder.decode(decryptedData);
    return JSON.parse(decryptedText);
  }

  /* encryption code based examples https://bit.ly/3ex4DiQ and https://ibm.co/30ABCdZ */
  async #encrypt(data: unknown): Promise<string> {
    if (!this.#encryptionValues.algorithm || !this.#encryptionValues.requestKey) {
      throw this.#buildError('encryptionValues must be set before calling encrypt');
    }

    // This is the plaintext:
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(JSON.stringify(data));

    // Finally, encrypt the plaintext, and obtain the ciphertext.
    const encryptedAB = await crypto.subtle.encrypt(
      this.#encryptionValues.algorithm,
      // This must be an AES-CBC key encryption key, or this fn will reject.
      this.#encryptionValues.requestKey,
      // The plaintext to encrypt.
      encodedData,
    );

    const encryptedText = ab2str(encryptedAB);
    const base64Text = encodeBase64(encryptedText);
    return base64Text;
  }
}

export { PostMessenger };
