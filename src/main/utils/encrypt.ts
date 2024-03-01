import bcrypt from 'bcryptjs';

/**
 * Encrypts a string using electron's safeStorage API
 * @param text The text to encrypt
 * @returns The encrypted text or false if an error occurs
 * @example const encrypted = hashText('my secret text');
 */
export async function hashText(text: string) {
  try {
    return await bcrypt.hash(text, 10);
  } catch (err) {
    return false;
  }
}

/**
 * Decrypts a string using electron's safeStorage API
 * @param plainText The text to decrypt
 * @param hashed The hashed text
 * @returns The decrypted text
 * @example const decrypted = decryptText('my secret text');
 */
export async function decryptText(plainText: string, hashed: string) {
  try {
    return await bcrypt.compare(plainText, hashed);
  } catch (err) {
    return false;
  }
}
