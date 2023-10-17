import { MemoryRouter, Route, Routes, Navigate } from 'react-router-dom';

import Home from './views/Home';
import Login from './views/Login';
import Register from './views/Register';
import { useContext } from 'react';
import { AuthContext } from './context/Auth';
import AuthProvider from './providers/Auth';
import { ThemeProvider } from './hooks';
import { Toaster } from './shad/ui/toaster';

export default function appRoutes() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
      <AuthProvider>
        <MemoryRouter>
          <Routes>
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Home />
                </RequireAuth>
              }
            />
            <Route path="/login" Component={Login} />
            <Route path="/register" Component={Register} />
          </Routes>
          <Toaster />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  let { authed } = useContext(AuthContext);

  if (
    // process.env.NODE_ENV === 'development' ||
    authed
  )
    return children;

  return <Navigate to="/login" replace />;
}
