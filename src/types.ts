
export type ValidateOriginFn = (origin: string) => boolean;

export type Listener = (data: any, event: WindowEventMap['message']) => void;
export type Listeners = Record<string, Listener[]>;
export type RemoveListener = () => void;
export type RemoveAllResponders = () => void;

export type RequestOptions = {
  maxResponseTime?: number;
};

/* ideally we'd use global error here but some errors thrown by extension don't have `name` */
export type Error = {
  message: string;
};
/* eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types */
export const isError = (e: any): e is Error => Boolean(e.message);

export type MessageName<T> = keyof T;

export type Responders<T> = {
  [key in MessageName<T>]?: (data: any, event: WindowEventMap['message']) => Promise<any> | any;
};

export type RequestMessage<T> = {
  type: string;
  messageId: string;
  data: T;
  isError: boolean;
  errorMessage: string | null;
};

export const isRequestMessage = <T>(msg: RequestMessage<T>): msg is RequestMessage<T> => Boolean(
  msg &&
  typeof msg === 'object' &&
  !Array.isArray(msg) &&
  typeof msg.type === 'string' &&
  typeof msg.messageId === 'string' &&
  typeof msg.isError === 'boolean' &&
  typeof msg.errorMessage !== 'undefined',
);

export type PostMessengerArgs<T> = {
  clientName: string;
  enableLogging?: boolean;
  useEncryption?: boolean;
  maxResponseTime?: number;
  types: T;
};

export type ConnectMessage = {
  useEncryption: boolean;
  iv?: Uint8Array;
  jsonRequestKey?: JsonWebKey;
  requestKey;
  types: Record<string, string>;
  clientName: string;
  origin: string;
};

export type ConnectArgs = {
  targetWindow: Window;
  targetOrigin: string;
  maxRetries?: number;
};

export type EncryptionValues = {
  algorithm: {
    iv: Uint8Array;
    name: 'AES-CBC';
  } | null;
  iv: Uint8Array | null;
  requestKey: CryptoKey | null;
};

export type AcceptConnectionsArgs = {
  allowAnyOrigin?: boolean;
  fromClientName?: string | null;
  origin?: string;
};

export type ConnectionDetails = {
  useEncryption: boolean;
  clientName: string;
  types: Record<string, string>;
};

export enum InternalMessageTypes {
  postMessengerConnect = 'post-messenger-connect',
}

export type ValidateRequest = (data: any) => boolean;
