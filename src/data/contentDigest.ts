export function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function utf8ByteLength(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

export async function calculateTextSha256(text: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(digest);
}
