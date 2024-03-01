import { decriptText, hashText } from '../utils/encrypt';
import { connect } from './Database.service';

export const getUser = (username: string): User | undefined => {
  const db = connect();

  const stm = db.prepare('SELECT * FROM users where username = @username');

  return stm.get({ username }) as User | undefined;
};

export const login = (user: Auth): false | string => {
  const dbUser = getUser(user.username);

  if (!dbUser) {
    return false;
  }

  const passwordCheck = decriptText(dbUser.password_hash);

  if (passwordCheck !== user.password) {
    return false;
  }

  const token = hashText(user.username);
  if (token === false) {
    return token;
  }

  return token.toString('base64');
};

export const register = (user: Auth): boolean => {
  try {
    const checkUser = getUser(user.username);

    if (checkUser) {
      return false;
    }

    const db = connect();

    const registerUser = {
      username: user.username,
      password_hash: hashText(user.password),
      status: 1,
    };

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
