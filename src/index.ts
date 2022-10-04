import autoBind from 'auto-bind';
import { v4 as uuidv4 } from 'uuid';
import {
  AcceptConnectionsArgs,
  ConnectArgs,
  ConnectionDetails,
  ConnectMessage,
  EncryptionValues,
  InternalMessageTypes,
  isError,
  isRequestMessage,
  Listener,
  Listeners,
  MessageName,
  PostMessengerArgs,
  RemoveAllResponders,
  RemoveListener,
  RequestOptions,
  Responders,
  ValidateOriginFn,
  ValidateRequest,
} from './types';
import { ab2str, decodeBase64, encodeBase64, str2ab } from './utils';

const AESCBC = 'AES-CBC';

class PostMessenger<T extends Record<string, string>> {
  clientName: string; /* prefixed to messages and log messages to help distinguish sending/receiving side */

  connection: ConnectionDetails | null = null;

  #enableLogging: boolean;

  /* when true will encrypt messages using a key determined by self or trusted connection initiator: */
  useEncryption: (messageType?: string, throwForNoConnection?: boolean | ((error: Error) => void)) => boolean;

  /* these must be kept private, prefix with # for runtime guarentee (see https://bit.ly/31tQYou) */
  #encryptionValues: EncryptionValues = {
    algorithm: null,
    iv: null,
    requestKey: null,
  };

  #listeners: Listeners = {};

  maxResponseTime: number; /* maxResponseTime max time to wait in ms before canceling request */

  targetWindow: Window | null = null;

  targetOrigin: string | null = null;

  #types: T & typeof InternalMessageTypes; /* types map of message names to values representing sent and expected received message types */

  #validateOrigin: ValidateOriginFn | null = null;

  constructor({
    clientName = 'unknown',
    enableLogging = false,
    useEncryption = true,
    maxResponseTime = 10000,
    types,
  }: PostMessengerArgs<T>) {
    autoBind(this);
    this.clientName = clientName;
    this.#enableLogging = enableLogging;
    this.useEncryption = (messageType, throwForNoConnection = false): boolean => {
      const useEncryptionForMessage = useEncryption && messageType !== InternalMessageTypes.postMessengerConnect;
      if (useEncryptionForMessage && !this.connection && throwForNoConnection) {
        const error = new Error(this.prefix(`Cannot send message ${messageType}. Encryption is on but there is no connected client.`));
        if (typeof throwForNoConnection === 'function') {
          throwForNoConnection(error);
        } else {
          throw error;
        }
      }
      return useEncryptionForMessage;
    };
    this.maxResponseTime = maxResponseTime;

    if (types.postMessengerConnect) {
      throw new Error(this.prefix('postMessengerConnect is a reserved message type.'));
    }

    this.#types = {
      ...types,
      ...InternalMessageTypes,
    };
  }

  prefix(str: string): string {
    return `postMessenger: ${this.clientName} ${str}`;
  }

  logger(...args: unknown[]): void {
    if (this.#enableLogging) {
      if (typeof args[0] === 'string') {
        console.log(this.prefix(args[0]), ...args.slice(1));
      } else {
        console.log(...args);
      }
    }
  }

  getListeners(): Listeners {
    return this.#listeners;
  }

  addListener(messageType: string, fn: Listener): RemoveListener {
    if (this.#listeners[messageType]) {
      this.#listeners[messageType].push(fn);
    } else {
      this.#listeners[messageType] = [fn];
    }
    return () => this.removeListener(messageType, fn);
  }

  removeListener(messageType: string, fn: Listener): void {
    if (this.#listeners[messageType]) {
      const i = this.#listeners[messageType].indexOf(fn);
      if (i > -1) {
        this.#listeners[messageType].splice(i, i + 1);
      }
    }
  }

  onReceiveMessage(event: WindowEventMap['message']): void {
    if (event.data && this.#listeners[event.data.type]) {
      if (this.#validateOrigin) {
        if (!this.#validateOrigin(event.origin)) {
          return;
        }
      }
      this.#listeners[event.data.type].forEach((listener) => {
        listener(event.data, event);
      });
    }
  }

  /* Sends a single message with no expectation for a response. Internal use only, clients should use request */
  #send(message: unknown = {}): void {
    if (!this.targetWindow || !this.targetOrigin) {
      const errMsg = this.prefix('targetWindow has not been initialized, please ensure you call setTarget before calling beginListening');
      throw new Error(errMsg);
    }
    this.targetWindow.postMessage(message, this.targetOrigin);
  }

  /* Build and send RequestMessage shape expected by this.request */
  async #sendRequestMessage(messageType: string, messageId: string, messageData: unknown = {}, errorMessageStr?: string): Promise<void> {
    let data = messageData;
    let errorMessage = errorMessageStr || null;
    if (this.useEncryption(messageType, true)) {
      data = await this.encrypt(messageData);
      if (errorMessage) {
        errorMessage = await this.encrypt(errorMessage);
      }
    }
    this.#send({
      data,
      errorMessage,
      isError: Boolean(errorMessage),
      messageId,
      type: messageType,
    });
  }

  /* Sends a message and listens for a response matching a unique message id. */
  async #request<R = any>(messageType: string, data: unknown = {}, options: RequestOptions = {}): Promise<R> {
    const messageId = uuidv4();
    this.logger(`sending request type '${messageType}' to '${this.targetOrigin}':`, data);
    await this.#sendRequestMessage(messageType, messageId, data);
    return new Promise((resolve, reject) => {
      let hasCompleted = false;
      const removeResponseListener = this.addListener(messageType, async (responseMessage): Promise<void> => {
        if (!isRequestMessage<R>(responseMessage)) {
          return;
        }
        if (responseMessage.messageId === messageId) {
          hasCompleted = true;
          removeResponseListener();
          if (responseMessage.isError) {
            let errorMessage = responseMessage.errorMessage;
            if (this.useEncryption(messageType, true) && responseMessage.errorMessage) {
              errorMessage = await this.decrypt(responseMessage.errorMessage);
            }
            const errorMsg = this.prefix(
              `Responder for request type '${messageType}' to target '${this.targetOrigin}' ` +
              `failed with message: "${errorMessage}"`,
            );
            reject(new Error(errorMsg));
          } else {
            let responseMessageData = responseMessage.data;
            if (this.useEncryption(messageType, true)) {
              if (typeof responseMessage.data !== 'string') {
                const errorMsg = this.prefix(`encryption is required but request received a non string data response for message: ${messageType}`);
                reject(new Error(errorMsg));
                return;
              }
              responseMessageData = await this.decrypt<R>(responseMessage.data);
            }
            resolve(responseMessageData);
          }
        }
      });

      setTimeout(() => {
        if (!hasCompleted) {
          const errorMsg = this.prefix(`Time out waiting for target '${this.targetOrigin}' to respond to request, type '${messageType}'`);
          reject(new Error(errorMsg));
          removeResponseListener();
        }
      }, options.maxResponseTime || this.maxResponseTime);
    });
  }

  /* type safe public request wrapper for #request */
  request<R = any>(messageKey: MessageName<T>, data: unknown = {}, options: RequestOptions = {}): Promise<R> {
    const messageType = this.#types[messageKey];
    if (!messageType) {
      throw new Error(this.prefix(`Unable to find messageType for ${String(messageKey)}`));
    }

    if (this.connection && !this.connection.types[String(messageKey)]) {
      throw new Error(this.prefix(
        `Connected client ${this.connection.clientName} does not have a matching message type for ${String(messageKey)} so this request will fail.`,
      ));
    }
    return this.#request<R>(messageType, data, options);
  }

  /* Accepts an object of event types mapping to handlers that return promises.
     Adds listeners that expect messages sent by the request function above in
     order to return a corresponding messageId */
  #bindResponders(responders: Responders<T>, validateRequest: ValidateRequest | null = null): RemoveAllResponders {
    const allRemoveFns: RemoveListener[] = [];
    Object.entries(responders).forEach(([messageName, handler]) => {
      const messageType = this.#types[messageName];
      const removeListenerFn = this.addListener(messageType, async (message, event: WindowEventMap['message']): Promise<void> => {
        if (!isRequestMessage(message) || !handler) {
          return;
        }

        if (validateRequest && !validateRequest(message.data)) {
          return;
        }

        let { data } = message;
        try {
          if (this.useEncryption(messageType, true)) {
            if (typeof data !== 'string') {
              throw new Error(this.prefix('encryption is required but responder received a non string data response'));
            }
            data = await this.decrypt(data);
          }
          const response = await handler(data, event);
          this.logger(`responding to request type '${messageType}' from target '${this.targetOrigin}':`, response);
          this.#sendRequestMessage(messageType, message.messageId, response);
        } catch (e) {
          if (isError(e)) {
            this.#sendRequestMessage(messageType, message.messageId, {}, e.message);
          } else {
            this.#sendRequestMessage(messageType, message.messageId, {}, this.prefix('responder threw a non Error object'));
          }
        }
      });
      allRemoveFns.push(removeListenerFn);
    });

    return () => {
      this.logger('removing responders:', responders);
      allRemoveFns.forEach(removeFn => removeFn());
    };
  }

  bindResponders(responders: Responders<T>): RemoveAllResponders {
    if (responders.postMessengerConnect) {
      throw new Error(this.prefix('postMessengerConnect is a reserved message type.'));
    }
    return this.#bindResponders(responders);
  }

  async connect({ targetWindow, targetOrigin, maxRetries = 10 }: ConnectArgs): Promise<boolean> {
    if (!targetWindow || !targetOrigin) {
      throw new Error(this.prefix('targetWindow and targetOrigin are required for connect'));
    }
    this.setTarget(targetWindow, targetOrigin);
    this.beginListening(origin => (origin === new URL(targetOrigin).origin));

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
        connection = await this.#request<ConnectionDetails>(InternalMessageTypes.postMessengerConnect, {
          clientName: this.clientName,
          iv,
          jsonRequestKey,
          origin: window.location.origin,
          types: this.#types,
          useEncryption,
        }, { maxResponseTime });
      } catch (e) { /* ignore */ }

      if (connection) {
        this.connection = connection;
        break;
      }
    }

    if (!this.connection) {
      throw new Error(this.prefix(`Connection failed after ${tries} attempts over ${(tries * maxResponseTime) / 1000} seconds.`));
    }

    this.logger(`Connection established to ${this.connection.clientName}`, this.connection);

    return true;
  }

  acceptConnections({
    allowAnyOrigin = false,
    fromClientName = null,
    origin,
  }: AcceptConnectionsArgs): Promise<ConnectionDetails> {
    if (!allowAnyOrigin && !origin) {
      throw new Error(this.prefix('allowAnyOrigin must be true if origin is not specified'));
    }

    /* Optionally allow caller to specify client name to accept connections from. This helps
       disambiguate multiple postMessenger connections on the same page to / from same origin */
    const validateConnectRequest = (data: ConnectMessage) => (
      !fromClientName || fromClientName === data.clientName
    );

    this.beginListening(messageOrigin => (origin ? messageOrigin === origin : true));

    return new Promise((resolve) => {
      const removeResponders = this.#bindResponders({
        postMessengerConnect: async (data: ConnectMessage, event): Promise<ConnectionDetails> => {
          if (!event.source) {
            throw new Error(this.prefix('event.source is null'));
          }

          this.setTarget(event.source as Window, data.origin);

          this.connection = {
            clientName: data.clientName,
            types: data.types,
            useEncryption: false,
          };
  
          if (this.useEncryption()) {
            if (!data.iv || !data.jsonRequestKey || !data.useEncryption) {
              const errorMsg = 'encryption is required but iv or jsonRequestKey or useEncryption were not provided in connection message.';
              throw new Error(this.prefix(errorMsg));
            }
  
            this.connection.useEncryption = true;
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
          removeResponders();

          this.logger(`Accepted connection from ${this.connection.clientName}`, this.connection);

          resolve(this.connection);

          return {
            clientName: this.clientName,
            types: data.types,
            useEncryption: this.useEncryption(),
          };
        },
      }, validateConnectRequest);
    });
  }

  setTarget(targetWindow: Window, targetOrigin: string): void {
    if (!targetWindow || !targetOrigin) {
      throw new Error(this.prefix('targetWindow and targetWindow are required for setTarget'));
    }
    this.targetWindow = targetWindow;
    /* validate initTargetOrigin is proper URL: */
    const targetUrl = new URL(targetOrigin);
    this.targetOrigin = targetUrl.origin;
  }

  beginListening(validateOrigin: ValidateOriginFn): void {
    this.#validateOrigin = validateOrigin;
    window.addEventListener('message', this.onReceiveMessage);
  }

  stopListening(): void {
    window.removeEventListener('message', this.onReceiveMessage);
  }

  async decrypt<R = unknown>(data: string): Promise<R> {
    if (!this.#encryptionValues.algorithm || !this.#encryptionValues.requestKey) {
      throw new Error(this.prefix('encryptionValues must be set before calling decrpyt'));
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
  async encrypt(data: unknown): Promise<string> {
    if (!this.#encryptionValues.algorithm || !this.#encryptionValues.requestKey) {
      throw new Error(this.prefix('encryptionValues must be set before calling encrypt'));
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
