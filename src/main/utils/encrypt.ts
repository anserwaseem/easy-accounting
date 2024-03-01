import { safeStorage } from 'electron';

/**
 * Encrypts a string using electron's safeStorage API
 * @param text The text to encrypt
 * @returns The encrypted text
 * @example const encrypted = hashText('my secret text');
 */
export function hashText(text: string) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return false;
    }

    return safeStorage.encryptString(text);
  } catch (err) {
    return false;
  }
}

/**
 * Decrypts a string using electron's safeStorage API
 * @param text The text to decrypt
 * @returns The decrypted text
 * @example const decrypted = decriptText('my secret text');
 */
export function decriptText(text: Buffer) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return false;
    }

    return safeStorage.decryptString(text);
  } catch (err) {
    return false;
  }
}
