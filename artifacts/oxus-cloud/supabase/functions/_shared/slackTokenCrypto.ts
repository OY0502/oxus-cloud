import { decryptSecret, encryptSecret, hasEncryptionKey } from "./encryption.ts";

const KEY_ENV = "SLACK_BOT_TOKEN_ENCRYPTION_KEY";

export async function encryptSlackBotToken(plaintext: string): Promise<string> {
  return encryptSecret(plaintext, KEY_ENV);
}

export async function decryptSlackBotToken(encrypted: string): Promise<string> {
  return decryptSecret(encrypted, KEY_ENV);
}

export function hasSlackBotTokenEncryptionKey(): boolean {
  return hasEncryptionKey(KEY_ENV);
}
