function encodeBytes(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeBytes(encoded: string) {
  return Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
}

async function encryptionKey() {
  const encoded = Deno.env.get('SMTP_CONFIG_ENCRYPTION_KEY');
  if (!encoded) throw new Error('SMTP_CONFIG_ENCRYPTION_KEY is not configured in Edge Function secrets.');
  const bytes = decodeBytes(encoded);
  if (bytes.length !== 32) throw new Error('SMTP_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSmtpPassword(password: string) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(password));
  return `${encodeBytes(iv)}.${encodeBytes(new Uint8Array(ciphertext))}`;
}

export async function decryptSmtpPassword(ciphertext: string) {
  const [encodedIv, encodedValue] = ciphertext.split('.');
  if (!encodedIv || !encodedValue) throw new Error('Saved SMTP password is invalid.');
  const key = await encryptionKey();
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBytes(encodedIv) }, key, decodeBytes(encodedValue));
  return new TextDecoder().decode(plaintext);
}
