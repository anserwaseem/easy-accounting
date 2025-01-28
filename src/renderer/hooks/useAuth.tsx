import { size } from 'lodash';
import {
  type PropsWithChildren,
  createContext,
  useState,
  useContext,
  useMemo,
} from 'react';
import type { UserCredentials } from 'types';

interface AuthContextState {
  authed: boolean;
  signin: (user: UserCredentials) => Promise<boolean>;
  register: (user: UserCredentials) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextState | undefined>(
  undefined,
);

export const AuthProvider: React.FC<PropsWithChildren> = ({
  children,
}: PropsWithChildren) => {
  const [authed, setAuthed] = useState(
    size(window.electron.store.get('username')) > 0,
  );

  const signin = async (user: UserCredentials): Promise<boolean> => {
    const response = await window.electron.login(user);

    if (response !== false) {
      setAuthed(true);
      return true;
    }

    return false;
  };

  const register = async (user: UserCredentials): Promise<boolean> =>
    !!(await window.electron.register(user));

  const logout = async (): Promise<void> => {
    setAuthed(false);
    await window.electron.logout();
  };

  const value = useMemo(() => ({ authed, signin, register, logout }), [authed]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (context === undefined)
    throw new Error('useAuth must be used within a AuthProvider');

  return context;
};
