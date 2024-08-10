import crypto from 'crypto';

/**
 * Hashes a password using pbkdf2 implementation
 * @param password The password to hash
 * @returns The hashed password
 * @example const hashed = hashPassword('password123');
 * @see verifyPassword
 * @see https://nodejs.org/api/crypto.html#cryptopbkdf2syncpassword-salt-iterations-keylen-digest
 */
export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 1000, 64, 'sha512')
    .toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a password against a stored password hash using pbkdf2 implementation
 * @param inputPassword The password to verify
 * @param storedPassword The stored password
 * @returns Boolean indicating if the password is valid
 * @example const isValid = verifyPassword('password123', 'salt:hash');
 * @see hashPassword
 * @see https://nodejs.org/api/crypto.html#cryptopbkdf2syncpassword-salt-iterations-keylen-digest
 */
export function verifyPassword(inputPassword: string, storedPassword: string) {
  const [salt, hash] = storedPassword.split(':');
  const inputHash = crypto
    .pbkdf2Sync(inputPassword, salt, 1000, 64, 'sha512')
    .toString('hex');
  return hash === inputHash;
}
