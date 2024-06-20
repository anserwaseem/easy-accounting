import type { DbUser, UserCredentials } from 'types';
import { store } from '../store';
import { decryptText, hashText } from '../utils/encrypt';
import { connect } from './Database.service';

const getUser = (username: string): DbUser | undefined => {
  const db = connect();

  const stm = db.prepare('SELECT * FROM users where username = @username');

  return stm.get({ username }) as DbUser | undefined;
};

export const login = (user: UserCredentials): boolean => {
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

export const register = (user: UserCredentials): boolean => {
  try {
    if (user.username.length < 4 || user.password.length < 4) {
      return false;
    }

    const userExists = getUser(user.username);
    if (userExists) {
      return false;
    }

    const passwordHash = hashText(user.password);
    if (passwordHash === false) {
      return false;
    }

    const registerUser = {
      username: user.username,
      password_hash: passwordHash,
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
    // eslint-disable-next-line no-console
    console.error(error);
    return false;
  }
};

export const logout = () => window.electron.store.delete('username');
