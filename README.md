# PostMessenger

## Description
`window.postMessage` is used to send messages between window objects on a page but receiving a response or acknowledgment is not built in. PostMessenger can connect window objects and wrap `window.postMessage` messages in promises to make communication between windows easier to manage.
 
## Message encryption
For cases in which other potentially untrusted scripts are running on the same domain, encryption can be used to prevent those scripts from reading messages. For example if you're building an extension that needs to communicate from the root page to a trusted iframe you may not have control over all the scripts loaded by the root page. These scripts could intercept messages coming back from the trusted iframe to the root page domain. By default PostMessenger will generate an encryption key that is passed to the secondary trusted domain so it is known only to your script and the trusted domain. If this is not a concern for your app you can set `useEncryption: false`

## acceptConnections

By default a specific root page `origin` must be provided `allowAnyOrigin` is `false` by default. If for some reason it's not possible to know in advance the domain of the root page that is sending the connection request you can pass `allowAnyOrigin: true` but be aware that any page could simulate a connection request to your app. You must take extra care in this case not to expose sensitive information or else ensure your app is only able to perform sensitive tasks using an API access key provided by the root page domain that a malicious third party wouldn't have.

## Example Usage
```javascript
// Usage from the root page:
import { PostMessenger } from '@croia/post-messenger';

const types = { init: 'init' };

const postMessenger = new PostMessenger({
  types,
  enableLogging: __DEVELOPMENT__,
  // name to help distinguish window objects, used by logger:
  clientName: 'some-app',
  useEncryption: false,
});

// set the target iframe and url to post messages to with .request
postMessenger.setTarget(window.parent, parentOriginUrl);

// add responders, functions to run when a request of a certain type is received
postMessenger.bindResponders({
  [postMessenger.types.openApp]: (data) => {
    openApp();
    // return values are serialized and passed back to window that made the request
    return true;
  },
});

// begin listening and accept all messages
postMessenger.beginListening(() => true, __DEVELOPMENT__);

// send the request from the base page
postMessenger.request(postMessenger.types.openApp, { options });
```

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

