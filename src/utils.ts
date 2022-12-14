export function ab2str(ab: ArrayBuffer): string {
  const arr = Array.from(new Uint16Array(ab));
  return String.fromCharCode.apply(null, arr);
}

export function str2ab(str: string): ArrayBuffer {
  const buf = new ArrayBuffer(str.length * 2); // 2 bytes for each char
  const bufView = new Uint16Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i += 1) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

export function encodeBase64(text: string): string {
  const codeUnits = new Uint16Array(text.length);
  for (let i = 0; i < codeUnits.length; i++) {
    codeUnits[i] = text.charCodeAt(i);
  }
  return btoa(String.fromCharCode(...new Uint8Array(codeUnits.buffer)));
}

export function decodeBase64(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return String.fromCharCode(...new Uint16Array(bytes.buffer));
}

export function hasOwnProperty(obj: unknown, prop: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

export function objectKeyMap<T extends string>(obj: Record<string, string>): { [K in T]: K; } {
  const objectKeys = {};
  Object.keys(obj).forEach((objectKey) => {
    objectKeys[objectKey] = objectKey;
  });
  return objectKeys as { [K in T]: K; };
}

export function shallowCompare(objA: Record<string, unknown>, objB: Record<string, unknown>): boolean {
  return (
    Object.keys(objA).length === Object.keys(objB).length &&
    Object.keys(objA).every(key =>
      hasOwnProperty(objB, key) && objA[key] === objB[key],
    )
  );
}

export function isUndef(value: unknown): value is undefined {
  return value === undefined;
}
