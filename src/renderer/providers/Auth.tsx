import { useState } from 'react';
import { AuthContext } from '../context/Auth';

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  let [authed, setAuthed] = useState(false);

  let signin = async (user: Auth): Promise<boolean> => {
    const response = await window.electron.login(user);
    setAuthed(true);

    if (response !== false) {
      console.log('signin response', response);
      localStorage.setItem('username', response);
      return true;
    }

    return response;
  };

  let register = async (user: Auth) => {
    return await window.electron.register(user);
  };

  let logout = async () => {
    setAuthed(false);
    localStorage.removeItem('username');
  };

  let value = { authed, signin, register, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
