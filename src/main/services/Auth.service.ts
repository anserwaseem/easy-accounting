import { store } from '../main';
import { decryptText, hashText } from '../utils/encrypt';
import { connect } from './Database.service';

export const getUser = (username: string): User | undefined => {
  const db = connect();

  const stm = db.prepare('SELECT * FROM users where username = @username');

  return stm.get({ username }) as User | undefined;
};

export const login = (user: Auth): boolean => {
  const dbUser = getUser(user.username);

  if (!dbUser) {
    return false;
  }

  const result = decryptText(dbUser.password_hash);

  if (result === user.password) {
    store.set('username', user.username);
    return true;
  }

  return false;
};

export const register = (user: Auth): boolean => {
  try {
    if (user.username.length < 4 || user.password.length < 4) {
      return false;
    }

    const userExists = getUser(user.username);
    if (userExists) {
      return false;
    }

    const password_hash = hashText(user.password);
    if (password_hash === false) {
      return false;
    }

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

export const logout = () => window.electron.store.delete('username');
