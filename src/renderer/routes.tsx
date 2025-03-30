import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { InvoiceType } from '@/types';
import { AuthProvider, ThemeProvider } from './hooks';
import { Toaster } from './shad/ui/toaster';
import BackupToastListener from './components/BackupToastListener';

import Sidebar from './components/Sidebar';
import { AuthCheck } from './components/AuthCheck';
import Home from './views/Home';
import AccountsPage from './views/Accounts';
import InventoryPage from './views/Inventory';
import JournalPage from './views/Journal';
import JournalsPage from './views/Journals';
import LedgerPage from './views/Ledger';
import Login from './views/Login';
import NewInvoicePage from './views/NewInvoice';
import NewJournalPage from './views/NewJournal';
import Register from './views/Register';
import SettingsPage from './views/Settings';
import InvoicesPage from './views/Invoices';
import InvoicePage from './views/Invoice';
import { InvalidRoute } from './views/InvalidRoute';
import PrintableInvoiceScreen from './views/PrintableInvoiceScreen';
import ReportsPage from './views/Reports';

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
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="purchase/invoices">
                <Route
                  index
                  element={<InvoicesPage invoiceType={InvoiceType.Purchase} />}
                />
                <Route
                  path="new"
                  element={
                    <NewInvoicePage invoiceType={InvoiceType.Purchase} />
                  }
                />
                <Route
                  path=":id"
                  element={
                    <InvoicePage
                      invoiceType={InvoiceType.Purchase}
                      key={InvoiceType.Purchase}
                    />
                  }
                />
              </Route>
              <Route path="sale/invoices">
                <Route
                  index
                  element={<InvoicesPage invoiceType={InvoiceType.Sale} />}
                />
                <Route
                  path="new"
                  element={
                    <NewInvoicePage
                      invoiceType={InvoiceType.Sale}
                      key={InvoiceType.Sale}
                    />
                  }
                />
                <Route
                  path=":id"
                  element={<InvoicePage invoiceType={InvoiceType.Sale} />}
                />
              </Route>
              <Route path="reports" element={<ReportsPage />} />
            </Route>
            <Route
              path="invoices/:id/print"
              element={<PrintableInvoiceScreen />}
            />
          </Route>
          <Route path="*" element={<InvalidRoute />} />
        </Routes>
        <Toaster />
        <BackupToastListener />
      </MemoryRouter>
    </AuthProvider>
  </ThemeProvider>
);

export default AppRoutes;
