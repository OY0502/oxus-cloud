/** AES-GCM encryption for ClickUp OAuth tokens at rest. */

async function getEncryptionKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("CLICKUP_OAUTH_TOKEN_ENCRYPTION_KEY")?.trim();
  if (!secret) {
    throw new Error("CLICKUP_OAUTH_TOKEN_ENCRYPTION_KEY is not configured.");
  }
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptClickupToken(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

export async function decryptClickupToken(encrypted: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = base64ToBytes(encrypted);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

export function hasClickupTokenEncryptionKey(): boolean {
  return !!Deno.env.get("CLICKUP_OAUTH_TOKEN_ENCRYPTION_KEY")?.trim();
}
