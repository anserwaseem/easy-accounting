import crypto from 'crypto';

/**
 * A service to handle encryption and decryption of text
 * @example const cryptoService = CryptoService.getInstance();
 */
export class CryptoService {
  private static instance: CryptoService | null = null; // Store the instance
  private salt: Buffer;

  private constructor() {
    this.salt = crypto.randomBytes(16);
  }

  /**
   * Get the instance of the CryptoService
   * @returns The instance of the CryptoService
   * @example const cryptoService = CryptoService.getInstance();
   */
  static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }

  /**
   * Encrypts a string using electron's safeStorage API
   * @param text The text to encrypt
   * @returns The encrypted text or false if an error occurs
   * @example const encrypted = hashText('my secret text');
   */
  encryptText(text: string) {
    return crypto.scryptSync(text, this.salt, 32);
  }

  /**
   * Decrypts a string using electron's safeStorage API
   * @param plainText The text to decrypt
   * @param hashed The hashed text
   * @returns The decrypted text
   * @example const decrypted = decryptText('my secret text');
   */
  decryptText(plainText: string, hashed: Buffer) {
    return crypto.scryptSync(plainText, this.salt, 32).equals(hashed);
  }
}
