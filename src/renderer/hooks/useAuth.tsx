import {
  type PropsWithChildren,
  createContext,
  useState,
  useContext,
} from 'react';
import type { UserCredentials } from 'types';

interface AuthContextState {
  authed: boolean;
  signin: (user: UserCredentials) => Promise<boolean>;
  register: (user: UserCredentials) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextState>({
  authed: false,
  signin: async () => false,
  register: async () => false,
  logout: async () => {},
});

export const AuthProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [authed, setAuthed] = useState(false);

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

  const value = { authed, signin, register, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (context === undefined)
    throw new Error('useAuth must be used within a AuthProvider');

  return context;
};
