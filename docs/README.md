---
layout: default
---

# PostMessenger

`window.postMessage` is used to send messages between window objects on a page but receiving a response or acknowledgment is not built in. PostMessenger connects window objects and wraps `window.postMessage` messages in promises to make communication between windows easier to manage.

## Example Usage

Since this library is just a wrapper, PostMessenger should work between any two windows objects that postMessage supports. As an example we will assume you are trying to connect a root page window and an iframe loaded there. The easiest way to get started is to connect the two windows by instantiating PostMessenger in scripts on both windows. From the root page window:

```javascript
import { PostMessenger } from '@croia/post-messenger';

// Create and append the iframe to communicate with:
const iframeSrc = 'https://some.app';
const iframe = document.createElement('iframe');
iframe.src = iframeSrc;
document.body.appendChild(iframe);

const postMessenger = new PostMessenger({
  requestNames: {
    // These are just some example request names, call yours whatever you'd like.
    initializeIFrame: 'mainApp:initializeIFrame',
    requestDataFromRootWindow: 'mainApp:requestDataFromRootWindow',
    asyncRequestFromRootWindow: 'mainApp:asyncRequestFromRootWindow',
  },
  enableLogging: true,
  // Help identify this instance in the logs with a name:
  clientName: 'parent-client',
});

// Functions to run after receiving a request from the connected window with a matching requestName key
postMessenger.bindResponders({
  requestDataFromRootWindow: ({ someParam }) => {
    // You can return data back to the other window but it should be JSON serializable
    return someParam + 1;
  },
  // Return a promise and PostMessenger will await it for you and return any errors to the other window
  asyncRequestFromRootWindow: async ({ someValue }) => {
    const result = await makeAnAsyncRequest(someValue);
    return result;
  }
});

// Wait for connection from the iframe:
await postMessenger.acceptConnections({ origin: iframeSrc });

// Now that we are connected we can send and await requests to the iframe
const response = await postMessenger.request(postMessenger.requestNames.initializeIFrame, {
  // include any data you'd like but it will need to be JSON serializable:
  someMessage: '1234',
});

console.log({ response }); // { response: true } (iframe responder returns true, see example below)
```

From the iframe:

```javascript
import { PostMessenger } from '@croia/post-messenger';

const postMessenger = new PostMessenger({
  types: {
    initializeIFrame: 'mainApp:initializeTheApp',
    requestDataFromRootWindow: 'mainApp:requestDataFromRootWindow',
    asyncRequestFromRootWindow: 'mainApp:asyncRequestFromRootWindow',
  },
  enableLogging: true,
  clientName: 'child-client',
});

postMessenger.bindResponders({
  initializeIFrame: ({ someMessage }) => {
    console.log({ someMessage }); // { someMessage: '1234' }
    return true;
  }
});

// Initialize connection with the root window
await postMessenger.connect({
  targetOrigin: 'https://root-page.app',
  // The root window is the iframe parent, window.parent
  targetWindow: window.parent,
});

// Now that we are connected we can send and await requests to the root window
const response = await postMessenger.request(
  postMessenger.requestNames.requestDataFromRootWindow,
  3,
);

console.log({ response }); // { response: 4 }
```

## PostMessenger constructor options
`clientName` (string, optional), default `'unknown'`: A name for the PostMessenger instance that is useful for distinguishing clients in the console logs (if enabled).

`enableLogging` (boolean, optional), default `false`: If true will output logs when sending or receiving requests and the associated data.

`maxResponseTime` in milliseconds (number, optional), default `10000`: The max amount of time to wait before considering a request failed and rejecting the promise. Possible reasons for a timeout include the window being disconnected after the connection was established or an async request taking too long. Alternatively you can provide this as an option to an individual request call if you expect a specific request to take longer, e.g.

```javascript
const slowReq = await postMessenger.request(
  postMessenger.requestNames.slowReq,
  { maxResponseTime: 20000 },
);
```

`requestNames` ({ [string]: string }, required): Map where the values are the names of requests that are sent or received by the current window or the window you are connecting to. For example if you need to fetch some data in the iframe from the root page you might have a request name `fetchDataFromRootPage`. In general the `requestNames` option should be the exact same in both windows, containing the names of all requests sent between the two.

Providing the request names up front instead of sending and listening for arbtrary messages provides an advantage if you're using TypeScript. If so, PostMessenger will validate that the keys provided to the request and bindResponders functions exist on the `requestNames` provided when creating the PostMessenger instance. There are a couple other benefits to providing the names up front, such as validating the connected window is expecting the requestName and throwing an error immediately if not, and also allowing multiple PostMessenger instances to avoid request name collisions (e.g. by prefixing request names with "appOne:" or "appTwo:"). However these two issues could be resolved automatically in a future release by handling all requests through a common request wrapper unique to each instance, and requestNames would then be optional for additional type safety.

`useEncryption` (boolean, optional), default `true`: See Message Encryption section below for more details.

## PostMessenger.connect options

`targetOrigin` (string, required): The origin of the window to send the message to, either the URI or '*'. See also https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#targetorigin.

`targetWindow` (Window, required): Window to call postMessage on.

`maxRetries` (number, optional), default `10`: If the first connection attempt is unsuccessful (the window calling `connect` fails to receive a response from the specified window), PostMessenger will automatically retry once every 500 milliseconds up to the `maxRetries` value. This may help resolve minor race conditions when acceptConnections has not been set up yet in the root window.

## Security

In general be sure to follow the security recommendations [here](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns). You should always specify both window origins when possible and PostMessenger will verify all messages are to and from the expected origin.
 
## Message encryption
Messages are encrypted by default which is useful when other potentially untrusted scripts are running on the same domain. For example if you're building an extension that needs to communicate from the root page to a trusted iframe you may not have control over all the scripts loaded by the root page. These scripts could intercept messages coming back from the trusted iframe to the root page domain. By default PostMessenger will generate an encryption key that is passed to the secondary trusted domain so it is known only to your script and the trusted domain. If this is not a concern for your app you can set `useEncryption: false`.

## acceptConnections

By default a specific root page `origin` must be provided `allowAnyOrigin` is `false` by default. If for some reason it's not possible to know in advance the domain of the root page that is sending the connection request you can pass `allowAnyOrigin: true` but be aware that any page could simulate a connection request to your app. You must take extra care in this case not to expose sensitive information or else ensure your app is only able to perform sensitive tasks using an API access key provided by the root page domain that a malicious third party wouldn't have.
