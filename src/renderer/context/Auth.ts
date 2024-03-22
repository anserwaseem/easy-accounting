import { createContext } from 'react';

interface AuthContextValue {
  authed: boolean;
  signin: (user: Auth) => Promise<boolean>;
  register: (user: Auth) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  authed: false,
  signin: async () => false,
  register: async () => false,
  logout: async () => {},
});
