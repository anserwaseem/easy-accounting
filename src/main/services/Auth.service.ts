import { CryptoService } from '../utils/encrypt';
import { connect } from './Database.service';

export const getUser = (username: string): User | undefined => {
  const db = connect();

  const stm = db.prepare('SELECT * FROM users where username = @username');

  return stm.get({ username }) as User | undefined;
};

export const login = async (user: Auth): Promise<false | string> => {
  const dbUser = getUser(user.username);

  if (!dbUser) {
    return false;
  }

  const result = CryptoService.getInstance().decryptText(
    user.password,
    dbUser.password_hash,
  );
  if (result === false) {
    return false;
  }

  // TODO: Return a token made from the username instead of the username itself
  const token = user.username;
  return token;
};

export const register = async (user: Auth): Promise<boolean> => {
  try {
    const userExists = getUser(user.username);

    if (userExists) {
      return false;
    }

    const password_hash = CryptoService.getInstance().encryptText(
      user.password,
    );

    const registerUser = {
      username: user.username,
      password_hash: password_hash,
      status: 1,
    };

    const db = connect();
    const stm = db.prepare(
      `INSERT INTO users (username, password_hash, status)
    VALUES (@username, @password_hash, @status)`,
    );
    stm.run(registerUser);

    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};
