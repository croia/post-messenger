import { buildMessageEvent } from './factories';
import { crypto, exportedKey, TextDecoder, textDecoderResponse, TextEncoder } from './mocks';
import { PostMessenger } from '../src/index';
import { ConnectionDetails, InternalMessageTypes } from '../src/types';

interface TestWindow extends Window {
  crypto: any;
  TextEncoder: any;
  TextDecoder: any;
}

declare let window: TestWindow;

export function buildMessageKeys<T extends string>(messages: Record<string, string>): { [K in T]: K; } {
  const messageKeys = {};
  Object.keys(messages).forEach((messageKey) => {
    messageKeys[messageKey] = messageKey;
  });
  return messageKeys as { [K in T]: K; };
}

enum MessageTypes {
  one = 'test:one',
}
const MessageKeys = buildMessageKeys<keyof typeof MessageTypes>(MessageTypes);

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
type WindowRef = { sendMessage: MessageEventListener | (() => void) };

/* wait for next addEventListener to be called on window and return
   an object that will contain a reference to call the added function.
   this is essentially mocking sending a message to the current window: */
function buildWindowRef(): WindowRef {
  const windowSpy = jest.spyOn(window, 'addEventListener');
  const windowRef: WindowRef = {
    /* until addEventListener is called, sendMessage should just be a function that throws an error */
    sendMessage: () => {
      throw new Error('addEventListener was never called');
    },
  };
  windowSpy.mockImplementation((eventType, handler) => {
    if (eventType === 'message' && typeof handler === 'function') {
      windowRef.sendMessage = handler;
    }
  });
  return windowRef;
}

async function beginListeningWithMock(postMessengerInstance: PostMessenger<typeof MessageTypes>): Promise<WindowRef> {
  return new Promise((resolve) => {
    const windowRef = buildWindowRef();
    postMessengerInstance.beginListening(() => true);
    resolve(windowRef);
  });
}

async function connectWithMock(
  postMessengerInstance: PostMessenger<typeof MessageTypes>,
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
    await sleep(0); // move to bottom of stack since addListener from connect above is added async
    windowRef.sendMessage(buildMessageEvent({
      data: {
        data: connectResponse,
        errorMessage: null,
        isError: false,
        messageId: message.messageId,
        type: InternalMessageTypes.postMessengerConnect,
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
      const postMessenger = new PostMessenger({
        clientName,
        types: MessageTypes,
      });
      expect(postMessenger.clientName).toEqual(clientName);
      expect(postMessenger.maxResponseTime).toBeDefined();

      expect(postMessenger['#listeners']).not.toBeDefined();
      expect(postMessenger['#encryptionValues']).not.toBeDefined();
      expect(postMessenger['#types']).not.toBeDefined();
      expect(postMessenger['#enableLogging']).not.toBeDefined();
    });

    test('should prevent reserved message types from being used', async () => {
      expect(() => {
        new PostMessenger({
          clientName,
          types: { postMessengerConnect: 'post-messenger-connect' },
        });
      }).toThrow(/.*reserved.*message.*/gi);
    });
  });

  describe('logger', () => {
    test('should not log when enableLogging is false', async () => {
      const postMessenger = new PostMessenger({
        clientName,
        enableLogging: false,
        types: MessageTypes,
      });

      const consoleLogMock = jest.spyOn(console, 'log');
      const consoleWarnMock = jest.spyOn(console, 'warn');
      const consoleErrorMock = jest.spyOn(console, 'error');
      
      postMessenger.logger('sjkdfkjd');
      expect(consoleLogMock).not.toHaveBeenCalled();
      expect(consoleWarnMock).not.toHaveBeenCalled();
      expect(consoleErrorMock).not.toHaveBeenCalled();
    });

    test('should log when enableLogging is true', async () => {
      const postMessenger = new PostMessenger({
        clientName,
        enableLogging: true,
        types: MessageTypes,
      });

      const consoleLogMock = jest.spyOn(console, 'log');
      
      postMessenger.logger('sjkdfkjd');
      expect(consoleLogMock).toHaveBeenCalled();
    });
  });

  describe('addListener and removeListener', () => {
    test('should add and remove listeners successfully', async () => {
      const postMessenger = new PostMessenger({
        clientName,
        types: MessageTypes,
      });
      const listener = () => {};
      const removeListener = postMessenger.addListener(MessageTypes.one, listener);
      let listeners = postMessenger.getListeners();
      expect(Object.keys(listeners)).toHaveLength(1);
      expect(Object.values(listeners)[0]).toHaveLength(1);
      expect(Object.values(listeners)[0][0]).toEqual(listener);
      removeListener();
      listeners = postMessenger.getListeners();
      expect(Object.keys(listeners)).toHaveLength(1);
      expect(Object.values(listeners)[0]).toHaveLength(0);
    });
  });

  describe('request', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    test('should throw an error if messageKey does not exist on types', async () => {
      const postMessenger = new PostMessenger({
        clientName,
        types: MessageTypes,
      });
      expect(() => {
        // @ts-expect-error: test for non ts consumers
        postMessenger.request('message:two', {});
      }).toThrow();
    });

    test('should send request messages and respond to request messages properly after beginListening is called', async () => {
      const postMessenger = new PostMessenger({
        clientName,
        types: MessageTypes,
        useEncryption: false,
      });

      const iframeWindow = appendIFrameAndGetWindow();
      postMessenger.setTarget(iframeWindow, targetOrigin);
      const windowRef = await beginListeningWithMock(postMessenger);
      const postMessageSpy = jest.spyOn(iframeWindow, 'postMessage');
      postMessageSpy.mockImplementation(async (message) => {
        await sleep(0); // move to bottom of stack since addListener from beginListening above is added async
        windowRef.sendMessage(buildMessageEvent({
          data: {
            data: { resProp: true },
            errorMessage: null,
            isError: false,
            messageId: message.messageId,
            type: MessageTypes.one,
          },
          origin: targetOrigin,
        }));
      });
      const response = await postMessenger.request(MessageKeys.one, {});
      expect(response.resProp).toEqual(true);
    });

    test('should throw if request returns a request message indicating an error occurred', async () => {
      const postMessenger = new PostMessenger({
        clientName,
        types: MessageTypes,
        useEncryption: false,
      });

      const iframeWindow = appendIFrameAndGetWindow();
      postMessenger.setTarget(iframeWindow, targetOrigin);
      const windowRef = await beginListeningWithMock(postMessenger);
      const errorMessage = 'Some more specific error message';
      const postMessageSpy = jest.spyOn(iframeWindow, 'postMessage');
      postMessageSpy.mockImplementation(async (message) => {
        await sleep(0);
        windowRef.sendMessage(buildMessageEvent({
          data: {
            data: { resProp: true },
            errorMessage,
            isError: true,
            messageId: message.messageId,
            type: MessageTypes.one,
          },
        }));
      });
      await expect(async () => {
        await postMessenger.request(MessageKeys.one, {});
      }).rejects.toThrow(new RegExp(`.*${errorMessage}.*`, 'gi'));
    });

    test('should not accept and timeout for a received request message with a non matching messageId', async () => {
      const postMessenger = new PostMessenger({
        clientName,
        types: MessageTypes,
        useEncryption: false,
      });

      const iframeWindow = appendIFrameAndGetWindow();
      postMessenger.setTarget(iframeWindow, targetOrigin);
      const windowRef = await beginListeningWithMock(postMessenger);
      const postMessageSpy = jest.spyOn(iframeWindow, 'postMessage');
      postMessageSpy.mockImplementation(async () => {
        await sleep(0);
        windowRef.sendMessage(buildMessageEvent({
          data: {
            data: { resProp: true },
            errorMessage: null,
            isError: false,
            messageId: 'the-wrong-message-id',
            type: MessageTypes.one,
          },
        }));
      });
      await expect(async () => {
        await postMessenger.request(MessageKeys.one, {}, { maxResponseTime: 100 });
      }).rejects.toThrow(new RegExp('.*time out.*', 'gi'));
    });

    test('should throw for non existing connection when encryption is true', async () => {
      const postMessenger = new PostMessenger({
        clientName,
        types: MessageTypes,
        useEncryption: true,
      });

      const iframeWindow = appendIFrameAndGetWindow();
      postMessenger.setTarget(iframeWindow, targetOrigin);
      await beginListeningWithMock(postMessenger);
      await expect(async () => {
        await postMessenger.request(MessageKeys.one, {});
      }).rejects.toThrow(new RegExp('.*no connected client.*', 'gi'));
    });
  });

  describe('connect with encryption', () => {
    let postMessenger: PostMessenger<typeof MessageTypes>;
    let iframeWindow;
    beforeEach(() => {
      postMessenger = new PostMessenger({
        clientName,
        types: MessageTypes,
      });
      iframeWindow = appendIFrameAndGetWindow();
    });

    const connectionResponse = {
      clientName: 'iframe-client',
      types: MessageTypes,
      useEncryption: true,
    };
    
    window.crypto = crypto;
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;

    test('should throw an error immediately if connected client does not have matching message type', async () => {
      await connectWithMock(postMessenger, iframeWindow, targetOrigin, {
        clientName: 'iframe-client',
        types: {},
        useEncryption: true,
      });
      await expect(async () => {
        await postMessenger.request(MessageKeys.one, {});
      }).rejects.toThrow(/.*does not have a matching message type.*/gi);
    });

    test('should connect successfully', async () => {
      await connectWithMock(postMessenger, iframeWindow, targetOrigin, connectionResponse);
      expect(postMessenger.connection).toEqual(connectionResponse);
    });

    test('should connect successfully after multiple retries', async () => {
      await connectWithMock(postMessenger, iframeWindow, targetOrigin, connectionResponse, 3000);
      expect(postMessenger.connection).toEqual(connectionResponse);
    });

    test('should throw for non string request responses', async () => {
      const windowRef = await connectWithMock(postMessenger, iframeWindow, targetOrigin, connectionResponse);
      const postMessageSpy = jest.spyOn(iframeWindow, 'postMessage');
      postMessageSpy.mockImplementation(async (message: any) => {
        await sleep(0); // move to bottom of stack since addListener from connect above is added async
        windowRef.sendMessage(buildMessageEvent({
          data: {
            data: { resProp: true },
            errorMessage: null,
            isError: false,
            messageId: message.messageId,
            type: MessageTypes.one,
          },
          origin: targetOrigin,
        }));
      });

      await expect(async () => {
        await postMessenger.request(MessageKeys.one, {});
      }).rejects.toThrow();
    });

    test('should encrypt request messages', async () => {
      const windowRef = await connectWithMock(postMessenger, iframeWindow, targetOrigin, connectionResponse);
      const postMessageSpy = jest.spyOn(iframeWindow, 'postMessage');
      postMessageSpy.mockImplementation(async (message: any) => {
        await sleep(0); // move to bottom of stack since addListener from connect above is added async
        windowRef.sendMessage(buildMessageEvent({
          data: {
            data: 'rYQvNe+52XQOnBbxkknwHryr7B1e+1/OPBm8BXyx7Kog4DHftBZ4cLEKo6bkEMyu4qKjOsYLnPNJQx4xO1tm2XY84ANCWnQu+gQHmrbeZnY=',
            errorMessage: null,
            isError: false,
            messageId: message.messageId,
            type: MessageTypes.one,
          },
          origin: targetOrigin,
        }));
      });

      const encryptSpy = jest.spyOn(window.crypto.subtle, 'encrypt');
      await postMessenger.request(MessageKeys.one, {});
      expect(encryptSpy).toHaveBeenCalled();
    });

    test('should accept connections', async () => {
      const windowRef = buildWindowRef();
      postMessenger.acceptConnections({ allowAnyOrigin: true });
      await sleep(0); // move to bottom of stack since addListener from acceptConnections above is added async
      expect(postMessenger.connection).toEqual(null);
      windowRef.sendMessage(buildMessageEvent({
        data: {
          data: {
            clientName: 'iframe-client',
            iv: window.crypto.getRandomValues(new Uint8Array(16)),
            jsonRequestKey: exportedKey,
            origin: 'https://any-origin-should-work.com',
            types: MessageTypes,
            useEncryption: true,
          },
          errorMessage: null,
          isError: false,
          messageId: '2342552',
          type: InternalMessageTypes.postMessengerConnect,
        },
      }));
      expect(postMessenger.connection).toEqual({
        clientName: 'iframe-client',
        types: MessageTypes,
        useEncryption: true,
      });
    });

    test('should accept connections and resolve with connection details when connecting client takes a while', async () => {
      const windowRef = buildWindowRef();
      const pendingConnection = postMessenger.acceptConnections({ allowAnyOrigin: true });
      await sleep(0); // move to bottom of stack since addListener from acceptConnections above is added async
      expect(postMessenger.connection).toEqual(null);
      setTimeout(() => {
        windowRef.sendMessage(buildMessageEvent({
          data: {
            data: {
              clientName: 'iframe-client',
              iv: window.crypto.getRandomValues(new Uint8Array(16)),
              jsonRequestKey: exportedKey,
              origin: 'https://any-origin-should-work.com',
              types: MessageTypes,
              useEncryption: true,
            },
            errorMessage: null,
            isError: false,
            messageId: '2342552',
            type: InternalMessageTypes.postMessengerConnect,
          },
        }));
      }, 1000);
      const connectionDetails = await pendingConnection;
      expect(connectionDetails).toEqual({
        clientName: 'iframe-client',
        types: MessageTypes,
        useEncryption: true,
      });
    });

    test('should throw an error when allowAnyOrigin is not true with no origin specified', async () => {
      expect(() => {
        postMessenger.acceptConnections({ allowAnyOrigin: false });
      }).toThrow(/.*origin.*not.*specified.*/gi);
    });

    test('should accept connections from trusted origin only when specified', async () => {
      const windowRef = buildWindowRef();
      const trustedOrigin = 'https://only-this-origin.com';
      postMessenger.acceptConnections({ allowAnyOrigin: false, origin: trustedOrigin });
      await sleep(0); // move to bottom of stack since addListener from acceptConnections above is added async
      expect(postMessenger.connection).toEqual(null);
      windowRef.sendMessage(buildMessageEvent({
        data: {
          data: {
            clientName: 'iframe-client',
            iv: window.crypto.getRandomValues(new Uint8Array(16)),
            jsonRequestKey: exportedKey,
            origin: 'https://any-origin-should-work.com',
            types: MessageTypes,
            useEncryption: true,
          },
          errorMessage: null,
          isError: false,
          messageId: '2342552',
          type: InternalMessageTypes.postMessengerConnect,
        },
        origin: trustedOrigin,
      }));
      expect(postMessenger.connection).toEqual({
        clientName: 'iframe-client',
        types: MessageTypes,
        useEncryption: true,
      });
    });

    test('should fail to connect when received message is not from trusted origin', async () => {
      const windowRef = buildWindowRef();
      const trustedOrigin = 'https://only-this-origin.com';
      postMessenger.acceptConnections({ allowAnyOrigin: false, origin: trustedOrigin });
      await sleep(0); // move to bottom of stack since addListener from acceptConnections above is added async
      expect(postMessenger.connection).toEqual(null);
      windowRef.sendMessage(buildMessageEvent({
        data: {
          data: {
            clientName: 'iframe-client',
            iv: window.crypto.getRandomValues(new Uint8Array(16)),
            jsonRequestKey: exportedKey,
            origin: 'https://any-origin-should-work.com',
            types: MessageTypes,
            useEncryption: true,
          },
          errorMessage: null,
          isError: false,
          messageId: '2342552',
          type: InternalMessageTypes.postMessengerConnect,
        },
        origin: 'https://google.com',
      }));
      expect(postMessenger.connection).toEqual(null);
    });

    test('should bind responder and be called when corresponding message is recieved', async () => {
      const windowRef = buildWindowRef();
      postMessenger.acceptConnections({ allowAnyOrigin: true });
      await sleep(0); // move to bottom of stack since addListener from acceptConnections above is added async

      expect(postMessenger.connection).toEqual(null); // no connection should exist yet
      // simulate connection message from a root page client to this client:
      windowRef.sendMessage(buildMessageEvent({
        data: {
          data: {
            clientName: 'root-client',
            iv: window.crypto.getRandomValues(new Uint8Array(16)),
            jsonRequestKey: exportedKey,
            origin: 'https://any-origin-should-work.com',
            types: MessageTypes,
            useEncryption: true,
          },
          errorMessage: null,
          isError: false,
          messageId: '2342552',
          type: InternalMessageTypes.postMessengerConnect,
        },
      }));
      // verify connection received:
      expect(postMessenger.connection).toEqual({
        clientName: 'root-client',
        types: MessageTypes,
        useEncryption: true,
      });

      const mockResponder = jest.fn();
      postMessenger.bindResponders({ [MessageKeys.one]: mockResponder });
      await sleep(0); // move to bottom of stack since addListener from bindResponders above is added async
      const messageEvent = buildMessageEvent({
        data: {
          data: 'rYQvNe+52XQOnBbxkknwHryr7B1e+1/OPBm8BXyx7Kog4DHftBZ4cLEKo6bkEMyu4qKjOsYLnPNJQx4xO1tm2XY84ANCWnQu+gQHmrbeZnY=',
          errorMessage: null,
          isError: false,
          messageId: '23423425',
          type: MessageTypes.one,
        },
      });
      windowRef.sendMessage(messageEvent);
      await sleep(0); // move to bottom of stack since sendMessage is async
      expect(mockResponder).toHaveBeenCalledWith(JSON.parse(textDecoderResponse), messageEvent);
    });
  });

  describe('bindResponders', () => {
    let postMessenger: PostMessenger<typeof MessageTypes>;
    beforeEach(() => {
      postMessenger = new PostMessenger({
        clientName,
        types: MessageTypes,
        useEncryption: false,
      });
    });

    test('should fail if a reserved message responder is provided', () => {
      expect(() => {
        // @ts-expect-error: test for non ts consumers
        postMessenger.bindResponders({ postMessengerConnect: () => { return 'something'; } });
      }).toThrow(/.*reserved message type.*/gi);
    });

    test('should bind responder and be called when corresponding message is recieved', async () => {
      const mockResponder = jest.fn();
      const iframeWindow = appendIFrameAndGetWindow();
      postMessenger.setTarget(iframeWindow, targetOrigin);
      const windowRef = await beginListeningWithMock(postMessenger);
      postMessenger.bindResponders({ [MessageKeys.one]: mockResponder });
      const data = { resProp: true };
      const messageEvent = buildMessageEvent({
        data: {
          data,
          errorMessage: null,
          isError: false,
          messageId: '23423425',
          type: MessageTypes.one,
        },
      });
      windowRef.sendMessage(messageEvent);
      expect(mockResponder).toHaveBeenCalledWith(data, messageEvent);
    });
  });
});
