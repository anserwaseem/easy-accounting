import type { DbUser, UserCredentials } from 'types';
import { store } from '../store';
import { hashPassword, verifyPassword } from '../utils/encrypt';
import { connect } from './Database.service';

const getUser = (username: string): DbUser | undefined => {
  const db = connect();
  const stm = db.prepare('SELECT * FROM users where username = @username');
  return stm.get({ username }) as DbUser | undefined;
};

const insertUser = (user: DbUser): void => {
  const db = connect();
  const stm = db.prepare(
    ` INSERT INTO users (username, password_hash, status)
      VALUES (@username, @password_hash, @status)`,
  );
  stm.run(user);
};

export const login = (user: UserCredentials): boolean => {
  const dbUser = getUser(user.username);
  if (!dbUser) {
    return false;
  }

  store.set('username', user.username);

  const isValid = verifyPassword(user.password, dbUser.password_hash);

  return isValid;
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

    const passwordHash = hashPassword(user.password);

    const registerUser = {
      username: user.username,
      password_hash: passwordHash,
      status: 1,
    };

    insertUser(registerUser);

    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return false;
  }
};

export const logout = () => store.delete('username');
