/**
 * Encrypts a string using base64
 * @param text The text to encrypt
 * @returns The encrypted text
 * @example const encrypted = hashText('my secret text');
 */
export function hashText(text: string) {
  try {
    return Buffer.from(text, 'base64');
  } catch (err) {
    return false;
  }
}

/**
 * Decrypts a string using base64
 * @param text The text to decrypt
 * @returns The decrypted text
 * @example const decrypted = decryptText('my secret text');
 */
export function decryptText(text: Buffer) {
  try {
    return text.toString('base64');
  } catch (err) {
    return false;
  }
}
