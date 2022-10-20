const cryptoKeyMock = {
  algorithm: { length: 256, name: 'AES-CBC' },
  extractable: true,
  type: 'secret',
  usages: ['encrypt', 'decrypt'],
};

export const exportedKey = {
  alg: 'A256CBC',
  ext: true,
  k: 'sIs9QIClRRbJlk8Ov1oKAOHkF_WVtApnkVYYjw-JwZM',
  key_ops: ['encrypt', 'decrypt'],
  kty: 'oct',
};

// See https://bit.ly/3eLTTjg. In >= node 15 we can assign this to window.crypto.webcrypto
Object.defineProperty(global.self, 'crypto', {
  value: {
    getRandomValues: (): Uint8Array => new Uint8Array([15, 177, 95, 199, 168, 147, 123, 246, 43, 133, 14, 112, 205, 210, 235, 113]),
    subtle: {
      decrypt: (): Promise<number[]> => Promise.resolve([32123]),
      encrypt: (): Promise<number[]> => Promise.resolve([
        55821, 22175, 31567, 37244, 33611, 45482, 30160, 23024, 41052, 59302, 26244, 56502, 15797, 48944, 7077, 40078,
      ]),
      exportKey: (): Promise<any> => Promise.resolve(exportedKey),
      generateKey: (): Promise<any> => Promise.resolve(cryptoKeyMock),
      importKey: (): Promise<any> => Promise.resolve(cryptoKeyMock),
    },
  },
});

export class TextEncoder {
  encode(): string { return 'sjdnfnsdf'; }
}

export const textDecoderResponse = '{"a":"something"}';
export class TextDecoder {
  decode(): string { return textDecoderResponse; }
}
