import { type PropsWithChildren } from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  Navigate,
  Outlet,
} from 'react-router-dom';

import { ThemeProvider, AuthProvider, useAuth } from './hooks';
import { Toaster } from './shad/ui/toaster';

import Nav from './components/Nav';
import Home from './views/Home';
import Login from './views/Login';
import Register from './views/Register';
import AccountsPage from './views/Accounts';
import LedgerPage from './views/Ledger';
import JournalsPage from './views/Journals';
import NewJournalPage from './views/NewJournal';
import JournalPage from './views/Journal';
import SettingsPage from './views/Settings';

export default function appRoutes() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter>
          <Routes>
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route element={<RequireAuth />}>
              <Route element={<Nav />}>
                <Route path="/" element={<Home />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="accounts">
                  <Route index element={<AccountsPage />} />
                  <Route path=":id" element={<LedgerPage />} />
                </Route>
                <Route path="journals">
                  <Route index element={<JournalsPage />} />
                  <Route path="new" element={<NewJournalPage />} />
                  <Route path=":id" element={<JournalPage />} />
                </Route>
              </Route>
            </Route>
          </Routes>
          <Toaster />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

function RequireAuth({ children }: PropsWithChildren) {
  const { authed } = useAuth();

  if (authed) {
    // if (authed || process.env.NODE_ENV === 'development') {
    return (
      <>
        {children}
        <Outlet />
      </>
    );
  }

  return <Navigate to="/login" replace />;
}
