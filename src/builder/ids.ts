export function createId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let token = "";

  for (const byte of bytes) {
    token += byte.toString(16).padStart(2, "0");
  }

  return `${prefix}_${token}`;
}
