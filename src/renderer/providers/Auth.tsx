import { useState } from 'react';
import { AuthContext } from '../context/Auth';

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authed, setAuthed] = useState(false);

  const signin = async (user: Auth): Promise<boolean> => {
    const response = await window.electron.login(user);

    if (response !== false) {
      setAuthed(true);
      return true;
    }

    return false;
  };

  const register = async (user: Auth): Promise<boolean> =>
    !!(await window.electron.register(user));

  const logout = async (): Promise<void> => {
    setAuthed(false);
    await window.electron.logout();
  };

  const value = { authed, signin, register, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
