# PostMessenger

`window.postMessage` is used to send messages between window objects on a page but receiving a response or acknowledgment is not built in. PostMessenger connects window objects and wraps `window.postMessage` messages in promises to make communication between windows easier to manage.

## Example Usage

Since this library is just a wrapper for `window.postMessage`, PostMessenger should work between any two windows objects that `window.postMessage` supports. As an example we will assume you are trying to connect a root page window and an iframe loaded there. The easiest way to get started is to connect the two windows by instantiating PostMessenger in scripts on both windows:

```javascript
// From the root page window:
import { PostMessenger } from '@croia/post-messenger';

const iframeSrc = 'https://some.app';
const iframe = document.createElement('iframe');
iframe.src = iframeSrc;
document.body.appendChild(iframe);

const postMessenger = new PostMessenger({
  // Declare the request types that the other window will expect to receive. In general request types
  // should be the exact same in both windows. PostMessenger will throw an error if you make a request
  // type that the connected window did not declare in their PostMessenger instance.
  types: {
    // These are just some example request types, call yours whatever you'd like.
    initializeSomeApp: 'mainApp:initializeTheApp',
    requestSomeDataFromTheApp: 'mainApp:requestSomeDataFromTheApp'
  },
  enableLogging: true,
  // Provide a name to help you distinguish either window object in the logs output in the console (if enabled above):
  clientName: 'parent-client',
  // Encryption is enabled by default but you may set it to `false` if you'd like (see notes in Message Encryption section below)
  useEncryption: false,
});

// Add functions to run when you receive a request from the iframe. Return values are sent back to the iframe and must be JSON serializable:
postMessenger.bindResponders({
  requestSomeDataFromTheApp: ({ someParam }) => {
    return someParam + 1;
  }
});

// Wait for connection from the iframe:
await postMessenger.acceptConnections({ origin: iframeSrc });

const response = await postMessenger.request(postMessenger.types.initializeSomeApp, {
  // include any data you want but it will need to be JSON serializable:
  someMessage: '1234',
});

console.log({ response });

// From the iframe:
import { PostMessenger } from '@croia/post-messenger';

const postMessenger = new PostMessenger({
  types: {
    initializeSomeApp: 'mainApp:initializeTheApp',
    requestSomeDataFromTheApp: 'mainApp:requestSomeDataFromTheApp'
  },
  enableLogging: true,
  clientName: 'child-client',
  useEncryption: false,
});

postMessenger.bindResponders({
  initializeSomeApp: ({ someMessage }) => {
    console.log({ someMessage });
    return true;
  }
});

// Initialize connection with the root window. PostMessenger will automatically retry 10 times which will help fix any race conditions if acceptConnections has not been set up yet in the root window. If you need to change this for some reason specify maxRetries option in connect:
await postMessenger.connect({
  targetOrigin: iframeSrc,
  targetWindow: iframe.contentWindow,
  // maxRetries: 20
});

const response = await postMessenger.request(postMessenger.types.requestSomeDataFromTheApp, 3);

console.log({ response }); // { response: 4 }
```

## Security

In general be sure to follow the security recommendations [here](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns). You should always specify both window origins when possible and PostMessenger will verify all messages are to and from the expected origin.
 
## Message encryption
Messages are encrypted by default which is useful when other potentially untrusted scripts are running on the same domain. For example if you're building an extension that needs to communicate from the root page to a trusted iframe you may not have control over all the scripts loaded by the root page. These scripts could intercept messages coming back from the trusted iframe to the root page domain. By default PostMessenger will generate an encryption key that is passed to the secondary trusted domain so it is known only to your script and the trusted domain. If this is not a concern for your app you can set `useEncryption: false`.

## acceptConnections

By default a specific root page `origin` must be provided `allowAnyOrigin` is `false` by default. If for some reason it's not possible to know in advance the domain of the root page that is sending the connection request you can pass `allowAnyOrigin: true` but be aware that any page could simulate a connection request to your app. You must take extra care in this case not to expose sensitive information or else ensure your app is only able to perform sensitive tasks using an API access key provided by the root page domain that a malicious third party wouldn't have.

## API Documentation

#### `setClientName(name: string): void`
Set the name of the client that is used by the logger.  

```javascript
postMessenger.setClientName('iframe-app');
```

#### `setTarget(target: string): void`
Set the `target` and `targetOrigin` of where messages using `.request` will go to.

```javascript
postMessenger.setTarget(iframe.current.contentWindow, 'https://iframe.domain/index.html');
```

#### `bindResponders(responders: Object): RemoveAllListeners`
Accepts an object of event types mapping to handlers that return promises. Adds listeners that expect messages sent by the request function above in order to return a corresponding messageI

```javascript
postMessenger.bindResponders({
  'my-message-type': (data) => {
    console.log(data);
  },
});
```

#### `request(type: string, data:? any): Promise<any>`
Sends a message and listens for a response matching a unique message id. Example:

```javascript
const { data  } = await postMessenger.request('request-type', { props });
```

#### `beginListening(validateOriginFn: func, enableLogging:? bool = false): void`
Begin listening for messages from other clients using `.postMessage`. The first required argument is used when receiving messages to validate that the origin is coming from a trusted source.

```javascript
postMessenger.beginListening(origin => origin === iFrameOrigin, process.env.NODE_ENV === 'development');
```

#### `stopListening(): void`
Stop listening for messages from other clients using `.postMessage`.

```javascript
postMessenger.stopListening();
```

#### `addListener(type: string, handlerFunction: func): RemoveListener`
Add a listener of a specified type that will get invoked if a listener of this type is posted to the current frame.

#### `removeListener(type: string, handlerFunction: func): void`
This function is returned by `addListener` and can be used to remove the listener for the specified `type` and `handlerFunction`.


## Configuration

#### `fromTypes`
The types of available messages to receive from other frames.

#### `toTypes`
The types of available messages to send to other frames.

## Development
1. `npm i` to download and install dependencies.
2. `npm run build` to build the files.
3. `npm run build:watch` to watch the files and build on change.

## Deployment
- TODO