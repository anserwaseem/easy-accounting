import { MemoryRouter, Route, Routes, Navigate } from 'react-router-dom';

import Home from './views/Home';
import Login from './views/Login';
import Register from './views/Register';
import { useContext } from 'react';
import { AuthContext } from './context/Auth';
import AuthProvider from './providers/Auth';
import { ThemeProvider } from './hooks';
import { Toaster } from './shad/ui/toaster';
import Nav from './components/Nav';
import Account from './views/Account';
import LedgerPage from './views/Ledger';

export default function appRoutes() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
      <AuthProvider>
        <MemoryRouter>
          <Routes>
            <Route path="/login" Component={Login} />
            <Route path="/register" Component={Register} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Nav children={<Home />} />
                </RequireAuth>
              }
            />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <Nav children={<Account />} />
                </RequireAuth>
              }
            />
            <Route
              path="/account/:id"
              element={
                <RequireAuth>
                  <Nav children={<LedgerPage />} />
                </RequireAuth>
              }
            />
          </Routes>
          <Toaster />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  let { authed } = useContext(AuthContext);

  if (authed || process.env.NODE_ENV === 'development') return children;

  return <Navigate to="/login" replace />;
}
