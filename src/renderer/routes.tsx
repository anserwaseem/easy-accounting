import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { EnsembleApp } from '@ensembleui/react-runtime';

import { ThemeProvider, AuthProvider } from './hooks';
import { Toaster } from './shad/ui/toaster';

import Sidebar from './components/Sidebar';
import Home from './views/Home';
import Login from './views/Login';
import Register from './views/Register';
import AccountsPage from './views/Accounts';
import LedgerPage from './views/Ledger';
import JournalsPage from './views/Journals';
import NewJournalPage from './views/NewJournal';
import JournalPage from './views/Journal';
import SettingsPage from './views/Settings';
import { AuthCheck } from './components/AuthCheck';
import { notesApp } from './ensemble';

const AppRoutes: React.FC = () => (
  <ThemeProvider>
    <AuthProvider>
      <MemoryRouter>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route element={<AuthCheck />}>
            <Route element={<Sidebar />}>
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
          <Route
            path="/notes/index.html"
            element={
              <EnsembleApp
                appId="notesApp"
                application={notesApp}
                path="/notes"
              />
            }
          />
        </Routes>
        <Toaster />
      </MemoryRouter>
    </AuthProvider>
  </ThemeProvider>
);

export default AppRoutes;
// if (window.location.pathname.includes('index.html')) {
//   window.location.pathname = '/';
// }
