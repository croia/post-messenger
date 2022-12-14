import { buildMessageEvent } from './factories';
import { exportedKey, TextDecoder, textDecoderResponse, TextEncoder } from './mocks';
import { PostMessenger } from '../src/index';
import { ConnectionDetails, InternalRequestNames } from '../src/types';

interface TestWindow extends Window {
  crypto: any;
  TextEncoder: any;
  TextDecoder: any;
}

declare let window: TestWindow;

export function buildRequestNameKeys<T extends string>(messages: Record<string, string>): { [K in T]: K; } {
  const messageKeys = {};
  Object.keys(messages).forEach((messageKey) => {
    messageKeys[messageKey] = messageKey;
  });
  return messageKeys as { [K in T]: K; };
}

enum RequestNames {
  one = 'test:one',
}
const RequestNameKeys = buildRequestNameKeys<keyof typeof RequestNames>(RequestNames);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function appendIFrameAndGetWindow(): Window {
  const iframeElement = document.createElement('iframe');
  const iframe = document.body.appendChild(iframeElement);

  if (!iframe.contentWindow) {
    throw new Error('iframe contentWindow is null');
  }

  return iframe.contentWindow;
}

type MessageEventListener = (messageEvent: WindowEventMap['message']) => void;
type WindowRef = { sendMessage: (messageEvent: WindowEventMap['message']) => Promise<void> };

function buildExternalPromise<T>() {
  let resolveExternalPromise: (returnValue: T) => void = () => undefined;
  const externalPromise: Promise<T> = new Promise((resolve) => { resolveExternalPromise = resolve; });
  return { externalPromise, resolveExternalPromise };
}

/* Wait for next addEventListener to be called on window and return
   a windowRef object with a reference to call the added function.
   This is essentially mocking sending a message to the current window: */
function buildWindowRef(): WindowRef {
  const windowSpy = jest.spyOn(window, 'addEventListener');
  const { externalPromise, resolveExternalPromise } = buildExternalPromise<MessageEventListener>();
  const windowRef: WindowRef = {
    sendMessage: async (message) => {
      const handler = await externalPromise;
      handler(message);
    },
  };

  /* when the next addEventListener is called resolve sendMessage promise: */
  windowSpy.mockImplementation((eventType, handler) => {
    if (eventType === 'message' && typeof handler === 'function') {
      resolveExternalPromise(handler);
    }
  });
  return windowRef;
}

function getConnectionDetails(extraProps?: Partial<ConnectionDetails>): ConnectionDetails {
  return {
    clientName: 'iframe-client',
    requestNames: undefined,
    useEncryption: false,
    ...extraProps,
  };
}

async function connectWithMock(
  postMessengerInstance: PostMessenger<typeof RequestNames | undefined>,
  targetWindow: Window,
  targetOrigin: string,
  connectResponse: ConnectionDetails,
  connectResponseDelay = 0,
): Promise<WindowRef> {
  jest.setTimeout(8000);
  const windowRef = buildWindowRef();
  const postMessageSpy = jest.spyOn(targetWindow, 'postMessage');
  let connectPromise;

  /* since we need the latest connect message id we need to start connect before adding
     the listener if we want to delay the response to test retries: */
  if (connectResponseDelay) {
    connectPromise = postMessengerInstance.connect({ targetOrigin, targetWindow });
    await sleep(connectResponseDelay);
  }

  postMessageSpy.mockImplementationOnce(async (message) => {
    await windowRef.sendMessage(buildMessageEvent({
      data: {
        data: connectResponse,
        errorMessage: null,
        isError: false,
        requestId: message.requestId,
        requestName: InternalRequestNames.postMessengerConnect,
      },
      origin: targetOrigin,
    }));
  });

  /* if there's no connect response delay needed we should expect a response immediately after the listener is added above: */
  if (!connectResponseDelay) {
    connectPromise = postMessengerInstance.connect({ maxRetries: 0, targetOrigin, targetWindow });
  }

  await connectPromise;

  return windowRef;
}

describe('PostMessenger', () => {
  const clientName = 'test-messenger';
  const targetOrigin = 'https://test.com';

  beforeEach(() => {
    jest.resetModules();
  });

  describe('constructor', () => {
    test('should construct PostMessenger properly and not expose private properties', async () => {
      const postMessenger = new PostMessenger({ clientName }, RequestNames);
      expect(postMessenger.clientName).toEqual(clientName);
      expect(postMessenger.maxResponseTime).toBeDefined();

      expect(postMessenger['#listeners']).not.toBeDefined();
      expect(postMessenger['#encryptionValues']).not.toBeDefined();
      expect(postMessenger['#requestNames']).not.toBeDefined();
      expect(postMessenger['#enableLogging']).not.toBeDefined();
    });

    test('should prevent reserved request names from being used', async () => {
      expect(() => {
        new PostMessenger(
          { clientName },
          { postMessengerConnect: 'post-messenger-connect' },
        );
      }).toThrow(/.*reserved.*request.*/gi);
    });
  });

  describe('enableLogging constructor argument', () => {
    test('should not log when false', async () => {
      const consoleLogMock = jest.spyOn(console, 'log');
      const consoleWarnMock = jest.spyOn(console, 'warn');
      const consoleErrorMock = jest.spyOn(console, 'error');

      new PostMessenger({
        clientName,
        useEncryption: false,
      }, RequestNames);

      expect(consoleLogMock).not.toHaveBeenCalled();
      expect(consoleWarnMock).not.toHaveBeenCalled();
      expect(consoleErrorMock).not.toHaveBeenCalled();
    });

    test('should log when true', async () => {
      const consoleLogMock = jest.spyOn(console, 'log');

      new PostMessenger({
        clientName,
        enableLogging: true,
        useEncryption: false,
      }, RequestNames);

      expect(consoleLogMock).toHaveBeenCalled();
    });
  });

  describe('request', () => {
    let iframeWindow: Window;
    let postMessenger: PostMessenger;
    let windowRef: WindowRef;
    let postMessageSpy: jest.SpyInstance<void, [message: any, options?: WindowPostMessageOptions | undefined]>;

    const defaultConnectionDetails = getConnectionDetails();
    const requestName = 'test:request';
    const responseData = { resProp: true };

    beforeEach(async () => {
      iframeWindow = appendIFrameAndGetWindow();
      postMessenger = new PostMessenger({ clientName, useEncryption: false });
      windowRef = await connectWithMock(postMessenger, iframeWindow, targetOrigin, defaultConnectionDetails);
      postMessageSpy = jest.spyOn(iframeWindow, 'postMessage');
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    test('should send request messages and respond to requests properly after connection', async () => {
      postMessageSpy.mockImplementation(async (message) => {
        await windowRef.sendMessage(buildMessageEvent({
          data: {
            data: responseData,
            errorMessage: null,
            isError: false,
            requestId: message.requestId,
            requestName,
          },
          origin: targetOrigin,
        }));
      });
      const response = await postMessenger.request<typeof responseData>(requestName, {});
      expect(response.resProp).toEqual(true);
    });

    test('should throw if request returns a request message indicating an error occurred', async () => {
      const errorMessage = 'Some more specific error message';
      postMessageSpy.mockImplementation(async (message) => {
        await windowRef.sendMessage(buildMessageEvent({
          data: {
            data: responseData,
            errorMessage,
            isError: true,
            requestId: message.requestId,
            requestName,
          },
          origin: targetOrigin,
        }));
      });
      await expect(async () => {
        await postMessenger.request(requestName, {});
      }).rejects.toThrow(new RegExp(`.*${errorMessage}.*`, 'gi'));
    });

    test('should not accept and timeout for a received request message with a non matching requestId', async () => {
      postMessageSpy.mockImplementation(async () => {
        await windowRef.sendMessage(buildMessageEvent({
          data: {
            data: responseData,
            errorMessage: null,
            isError: false,
            requestId: 'the-wrong-request-id',
            requestName: requestName,
          },
        }));
      });
      await expect(async () => {
        await postMessenger.request(requestName, {}, { maxResponseTime: 100 });
      }).rejects.toThrow(new RegExp('.*time out.*', 'gi'));
    });

    test('should throw for non existing connection when encryption is true', async () => {
      const pm = new PostMessenger({ clientName, useEncryption: true });
      await expect(async () => {
        await pm.request(requestName, {});
      }).rejects.toThrow(new RegExp('.*no connected client.*', 'gi'));
    });

    test('should throw an error if messageKey does not exist on request names when requestNames are provided', async () => {
      const pm = new PostMessenger({ clientName }, RequestNames);

      expect(() => {
        // @ts-expect-error: 'two' is not on requestNames so this should be a type error:
        pm.request('two', {});
      }).toThrow(/.*requestNames were provided to constructor but unable to find requestName for two.*/);
    });

    test('should allow any request name by default if requestNames not provided', async () => {
      const pm = new PostMessenger({ clientName });
      windowRef = await connectWithMock(pm, iframeWindow, targetOrigin, defaultConnectionDetails);

      postMessageSpy.mockImplementation(async (message) => {
        await windowRef.sendMessage(buildMessageEvent({
          data: {
            data: 'sdf',
            errorMessage: null,
            isError: false,
            requestId: message.requestId,
            requestName: 'two',
          },
          origin: targetOrigin,
        }));
      });

      /* note there is no type error here when requestNames is not provided.
         see test above for opposite case which verifies that a type error is thrown */
      await expect(await pm.request('two', {})).toEqual(JSON.parse(textDecoderResponse));
    });
  });

  describe('connect with encryption', () => {
    let iframeWindow: Window;
    let postMessenger: PostMessenger<typeof RequestNames>;
    let postMessageSpy: jest.SpyInstance<void, [message: any, options?: WindowPostMessageOptions | undefined]>;

    const defaultConnectionDetails = getConnectionDetails({ requestNames: RequestNames, useEncryption: true });

    function buildConnectMessage(origin: string = targetOrigin, messageData?, extraData?) {
      return buildMessageEvent({
        data: {
          data: {
            iv: window.crypto.getRandomValues(new Uint8Array(16)),
            jsonRequestKey: exportedKey,
            origin: 'https://any-origin-should-work.com',
            ...defaultConnectionDetails,
            ...messageData,
          },
          errorMessage: null,
          isError: false,
          requestId: '2342552',
          requestName: InternalRequestNames.postMessengerConnect,
          ...extraData,
        },
        origin,
      });
    }

    beforeEach(async () => {
      iframeWindow = appendIFrameAndGetWindow();
      postMessenger = new PostMessenger({ clientName }, RequestNames);
      postMessageSpy = jest.spyOn(iframeWindow, 'postMessage');
    });

    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;

    test('should throw an error immediately if connected client does not have matching request name when requestNames are provided', async () => {
      await connectWithMock(postMessenger, iframeWindow, targetOrigin, {
        clientName: 'iframe-client',
        requestNames: {},
        useEncryption: true,
      });
      await expect(async () => {
        await postMessenger.request(RequestNameKeys.one, {});
      }).rejects.toThrow(/.*does not have a matching request name*/gi);
    });

    test('should connect successfully', async () => {
      await connectWithMock(postMessenger, iframeWindow, targetOrigin, defaultConnectionDetails);
      expect(postMessenger.connection).toEqual(defaultConnectionDetails);
    });

    test('should connect successfully after multiple retries', async () => {
      await connectWithMock(postMessenger, iframeWindow, targetOrigin, defaultConnectionDetails, 3000);
      expect(postMessenger.connection).toEqual(defaultConnectionDetails);
    });

    test('should throw for non string request responses', async () => {
      const windowRef = await connectWithMock(postMessenger, iframeWindow, targetOrigin, defaultConnectionDetails);
      const nonStringResponseData = { resProp: 'something' };
      postMessageSpy.mockImplementation(async (message: any) => {
        await windowRef.sendMessage(buildMessageEvent({
          data: {
            data: nonStringResponseData,
            errorMessage: null,
            isError: false,
            requestId: message.requestId,
            requestName: RequestNames.one,
          },
          origin: targetOrigin,
        }));
      });

      await expect(async () => {
        await postMessenger.request(RequestNameKeys.one, {});
      }).rejects.toThrow();
    });

    test('should encrypt request messages', async () => {
      const windowRef = await connectWithMock(postMessenger, iframeWindow, targetOrigin, defaultConnectionDetails);
      postMessageSpy.mockImplementation(async (message: any) => {
        await windowRef.sendMessage(buildMessageEvent({
          data: {
            data: 'rYQvNe+52XQOnBbxkknwHryr7B1e+1/OPBm8BXyx7Kog4DHftBZ4cLEKo6bkEMyu4qKjOsYLnPNJQx4xO1tm2XY84ANCWnQu+gQHmrbeZnY=',
            errorMessage: null,
            isError: false,
            requestId: message.requestId,
            requestName: RequestNames.one,
          },
          origin: targetOrigin,
        }));
      });

      const encryptSpy = jest.spyOn(window.crypto.subtle, 'encrypt');
      await postMessenger.request(RequestNameKeys.one, {});
      expect(encryptSpy).toHaveBeenCalled();
    });

    test('should accept connections', async () => {
      const windowRef = buildWindowRef();
      const pendingConnection = postMessenger.acceptConnections({ allowAnyOrigin: true });
      expect(postMessenger.connection).toEqual(null);
      windowRef.sendMessage(buildConnectMessage());

      const connectionResponse = await pendingConnection;
      expect(connectionResponse).toEqual(defaultConnectionDetails);
    });

    test('should accept connections and resolve with connection details when connecting client takes a while', async () => {
      const windowRef = buildWindowRef();
      const pendingConnection = postMessenger.acceptConnections({ allowAnyOrigin: true });
      expect(postMessenger.connection).toEqual(null);
      setTimeout(() => {
        windowRef.sendMessage(buildConnectMessage());
      }, 1000);

      const connectionResponse = await pendingConnection;
      expect(connectionResponse).toEqual(defaultConnectionDetails);
    });

    test('should throw an error when useEncryption does not match between clients', async () => {
      const windowRef = buildWindowRef();
      const pendingConnection = postMessenger.acceptConnections({ allowAnyOrigin: true });
      windowRef.sendMessage(buildConnectMessage(targetOrigin, { useEncryption: false }));
      await expect(async () => {
        await pendingConnection;
      }).rejects.toThrow(/.*useEncryption must be the same for both PostMessenger instances*/gi);
    });

    test('should throw an error when requestNames does not match between clients', async () => {
      const windowRef = buildWindowRef();
      const pendingConnection = postMessenger.acceptConnections({ allowAnyOrigin: true });
      windowRef.sendMessage(buildConnectMessage(
        targetOrigin,
        { requestNames: undefined, useEncryption: false },
      ));
      await expect(async () => {
        await pendingConnection;
      }).rejects.toThrow(/.*requestNames must be the same for both PostMessenger instances*/gi);
    });

    test('should throw an error when allowAnyOrigin is not true with no origin specified', async () => {
      expect(() => {
        postMessenger.acceptConnections({ allowAnyOrigin: false });
      }).toThrow(/.*origin.*not.*specified.*/gi);
    });

    test('should accept connections from trusted origin only when specified', async () => {
      const windowRef = buildWindowRef();
      const trustedOrigin = 'https://only-this-origin.com';
      const pendingConnection = postMessenger.acceptConnections({ allowAnyOrigin: false, origin: trustedOrigin });
      expect(postMessenger.connection).toEqual(null);
      windowRef.sendMessage(buildConnectMessage(trustedOrigin));

      const connectionResponse = await pendingConnection;
      expect(connectionResponse).toEqual(defaultConnectionDetails);
    });

    test('should fail to connect when received message is not from trusted origin', async () => {
      const windowRef = buildWindowRef();
      const trustedOrigin = 'https://only-this-origin.com';
      const pendingConnection = postMessenger.acceptConnections({ allowAnyOrigin: false, origin: trustedOrigin });
      expect(postMessenger.connection).toEqual(null);
      windowRef.sendMessage(buildConnectMessage('https://google.com'));
      await Promise.race([
        pendingConnection, // should not resolve due to invalid connect attempt above
        new Promise(resolve => setTimeout(resolve, 50)),
      ]);
      expect(postMessenger.connection).toEqual(null);
    });

    test('should bind responder and be called when corresponding message is recieved', async () => {
      const windowRef = buildWindowRef();
      const pendingConnection = postMessenger.acceptConnections({ allowAnyOrigin: true });

      expect(postMessenger.connection).toEqual(null); // no connection should exist yet
      // simulate connection message from a root page client to this client:
      windowRef.sendMessage(buildConnectMessage(targetOrigin, { clientName: 'root-client' }));

      const connectionResponse = await pendingConnection;
      // verify connection received:
      expect(connectionResponse).toEqual({
        ...defaultConnectionDetails,
        clientName: 'root-client',
      });

      const mockResponder = jest.fn();
      postMessenger.bindResponders({ [RequestNameKeys.one]: mockResponder });

      const messageEvent = buildMessageEvent({
        data: {
          data: 'rYQvNe+52XQOnBbxkknwHryr7B1e+1/OPBm8BXyx7Kog4DHftBZ4cLEKo6bkEMyu4qKjOsYLnPNJQx4xO1tm2XY84ANCWnQu+gQHmrbeZnY=',
          errorMessage: null,
          isError: false,
          requestId: '23423425',
          requestName: RequestNames.one,
        },
      });

      windowRef.sendMessage(messageEvent);
      await sleep(0); // responder is called async, move to bottom of stack
      expect(mockResponder).toHaveBeenCalledWith(JSON.parse(textDecoderResponse), messageEvent);
    });
  });

  describe('connect without encryption', () => {
    let iframeWindow;
    beforeEach(() => {
      iframeWindow = appendIFrameAndGetWindow();
    });

    const defaultConnectionDetails = getConnectionDetails({ requestNames: {} });

    test('should connect successfully', async () => {
      const postMessenger = new PostMessenger({ clientName, useEncryption: false });
      await connectWithMock(postMessenger, iframeWindow, targetOrigin, defaultConnectionDetails);
      expect(postMessenger.connection).toEqual(defaultConnectionDetails);
    });

    test('should connect successfully after multiple retries', async () => {
      const postMessenger = new PostMessenger({ clientName, useEncryption: false });
      await connectWithMock(postMessenger, iframeWindow, targetOrigin, defaultConnectionDetails, 3000);
      expect(postMessenger.connection).toEqual(defaultConnectionDetails);
    });

    test('should accept connections', async () => {
      const postMessenger = new PostMessenger({ clientName, useEncryption: false });
      const windowRef = buildWindowRef();
      const pendingConnection = postMessenger.acceptConnections({ allowAnyOrigin: true });
      expect(postMessenger.connection).toEqual(null);
      windowRef.sendMessage(buildMessageEvent({
        data: {
          data: {
            clientName: 'iframe-client',
            origin: 'https://any-origin-should-work.com',
            requestNames: undefined,
            useEncryption: false,
          },
          errorMessage: null,
          isError: false,
          requestId: '2342552',
          requestName: InternalRequestNames.postMessengerConnect,
        },
      }));

      const connectionResponse = await pendingConnection;
      expect(connectionResponse).toEqual({
        clientName: 'iframe-client',
        requestNames: undefined,
        useEncryption: false,
      });
    });
  });

  describe('bindResponders', () => {
    let postMessenger: PostMessenger<typeof RequestNames>;
    beforeEach(() => {
      postMessenger = new PostMessenger({
        clientName,
        useEncryption: false,
      }, RequestNames);
    });

    test('should fail if a reserved request responder is provided', () => {
      expect(() => {
        // @ts-expect-error: test for non ts consumers
        postMessenger.bindResponders({ postMessengerConnect: () => { return 'something'; } });
      }).toThrow(/.*reserved request name.*/gi);
    });

    test('should bind responder and be called when corresponding message is recieved', async () => {
      const mockResponder = jest.fn();
      const iframeWindow = appendIFrameAndGetWindow();
      const windowRef = await connectWithMock(postMessenger, iframeWindow, targetOrigin, getConnectionDetails());
      postMessenger.bindResponders({ [RequestNameKeys.one]: mockResponder });

      const data = { resProp: true };
      const messageEvent = buildMessageEvent({
        data: {
          data,
          errorMessage: null,
          isError: false,
          requestId: '23423425',
          requestName: RequestNames.one,
        },
        origin: targetOrigin,
      });
      await windowRef.sendMessage(messageEvent);
      expect(mockResponder).toHaveBeenCalledWith(data, messageEvent);
    });
  });
});
