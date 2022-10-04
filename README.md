# PostMessenger

## Description
window.postMessage is used to send messages between window objects on a page but receiving a response or acknowledgment is not built in. PostMessenger can connect window objects and wrap postMessage messages in promises to make communication easier to manage.
 
## Encryption
For cases in which other potentially untrusted scripts are running on the same domain, encryption can be used to prevent those scripts from reading messages. For example if you're building an extension that needs to communicate from the root page to a trusted iframe you may not have control over all the scripts loaded by the root page. These scripts could intercept messages coming back from the trusted iframe to the root page domain. If this is a concern for your app you can set `useEncryption: true` to dynamically generate an encryption key that is passed to the secondary trusted domain so it is known only to your script and the trusted domain.

## Example Usage
```javascript
import { PostMessenger } from '@coreymartin/post-messenger';

const types = { init: 'init' };

const postMessenger = new PostMessenger({
  types,
  enableLogging: __DEVELOPMENT__,
  // name to help distinguish window objects, used by logger:
  clientName: 'iframe-app',
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

