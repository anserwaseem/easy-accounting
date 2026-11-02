import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, useState } from 'react';

import { InvoiceType } from '@/types';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';
import { AuthProvider, ThemeProvider } from './hooks';
import { AdvancedCapabilitiesProvider } from './hooks/useAdvancedCapabilities';
import { AdvancedRoute } from './components/AdvancedRoute';
import { Toaster } from './shad/ui/toaster';
import { consumeJoinHashFromWindow } from './lib/joinLink';
import { AuthCheck } from './components/AuthCheck';
import { InvalidRoute } from './views/InvalidRoute';

import { RouteLoadingFallback } from './components/RouteLoadingFallback';
import Sidebar from './components/Sidebar';
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
import QuotationsPage from './views/Quotations';
import ReportsPage from './views/Reports';
import TrialBalancePage from './views/Reports/TrialBalance';
import AccountBalancesPage from './views/Reports/AccountBalances';
import LedgerReportPage from './views/Reports/LedgerReport';
import BillsAgingPage from './views/Reports/BillsAging';

const BackupToastListener = lazy(
  () => import('./components/BackupToastListener'),
);

const PrintableInvoiceScreen = lazy(
  () => import('./views/PrintableInvoiceScreen'),
);
const AverageEquityBalancesPage = lazy(
  () => import('./views/Reports/AverageEquityBalances'),
);
const InventoryHealthReportPage = lazy(
  () => import('./views/Reports/InventoryHealth'),
);
const StockAsOfReportPage = lazy(() => import('./views/Reports/StockAsOf'));
const SalesPerformanceReportPage = lazy(
  () => import('./views/Reports/SalesPerformance'),
);
const PurchasesByVendorPage = lazy(
  () => import('./views/Reports/PurchasesByVendor'),
);
const SalesByCustomerPage = lazy(
  () => import('./views/Reports/SalesByCustomer'),
);
const VendorStockPage = lazy(() => import('./views/VendorStock'));
const NewVendorIssuePage = lazy(
  () => import('./views/VendorStock/NewVendorIssue'),
);
const VendorStockActivityPage = lazy(
  () => import('./views/Reports/VendorStockActivity'),
);
const ImportPage = lazy(() => import('./views/Import'));
const JoinSyncPage = lazy(() => import('./views/JoinSync'));
const CollectionSheetPage = lazy(
  () => import('./views/Reports/CollectionSheet'),
);
const AgentCommissionReportPage = lazy(
  () => import('./views/Reports/AgentCommission'),
);

const AppRoutes: React.FC = () => {
  const [joinInvite] = useState(() => consumeJoinHashFromWindow());

  return (
    <ThemeProvider>
      <AuthProvider>
        <AdvancedCapabilitiesProvider>
          <MemoryRouter
            initialEntries={
              joinInvite
                ? [{ pathname: '/join-sync', state: { joinInvite } }]
                : ['/']
            }
          >
            <Suspense fallback={<RouteLoadingFallback />}>
              <Routes>
                <Route path="login" element={<Login />} />
                <Route path="register" element={<Register />} />
                <Route path="import" element={<ImportPage />} />
                <Route path="join-sync" element={<JoinSyncPage />} />
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
                    <Route path="vendor-stock">
                      <Route index element={<VendorStockPage />} />
                      <Route
                        path="issues/new"
                        element={<NewVendorIssuePage />}
                      />
                      <Route
                        path="issues/:id/edit"
                        element={<NewVendorIssuePage />}
                      />
                    </Route>
                    <Route path="reports">
                      <Route index element={<ReportsPage />} />
                      <Route
                        path="trial-balance"
                        element={<TrialBalancePage />}
                      />
                      <Route
                        path="account-balances"
                        element={<AccountBalancesPage />}
                      />
                      <Route
                        path="ledger-report"
                        element={<LedgerReportPage />}
                      />
                      <Route
                        path="average-equity-balances"
                        element={<AverageEquityBalancesPage />}
                      />
                      <Route path="bills-aging" element={<BillsAgingPage />} />
                      <Route
                        path="collection-sheet"
                        element={<CollectionSheetPage />}
                      />
                      <Route
                        path="inventory-health"
                        element={<InventoryHealthReportPage />}
                      />
                      <Route
                        path="stock-as-of"
                        element={<StockAsOfReportPage />}
                      />
                      <Route
                        path="sales-performance"
                        element={
                          <AdvancedRoute
                            capability={
                              ADVANCED_CAPABILITIES.salesPerformanceReport
                            }
                          >
                            <SalesPerformanceReportPage />
                          </AdvancedRoute>
                        }
                      />
                      <Route
                        path="sales-by-customer"
                        element={<SalesByCustomerPage />}
                      />
                      <Route
                        path="purchases-by-vendor"
                        element={<PurchasesByVendorPage />}
                      />
                      <Route
                        path="vendor-stock-activity"
                        element={<VendorStockActivityPage />}
                      />
                      <Route
                        path="agent-commission"
                        element={
                          <AdvancedRoute
                            capability={ADVANCED_CAPABILITIES.commissionModule}
                          >
                            <AgentCommissionReportPage />
                          </AdvancedRoute>
                        }
                      />
                    </Route>
                    <Route path="purchase/invoices">
                      <Route
                        index
                        element={
                          <InvoicesPage invoiceType={InvoiceType.Purchase} />
                        }
                      />
                      <Route
                        path="new"
                        element={
                          <NewInvoicePage invoiceType={InvoiceType.Purchase} />
                        }
                      />
                      <Route
                        path=":id/edit"
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
                        element={
                          <InvoicesPage invoiceType={InvoiceType.Sale} />
                        }
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
                        path=":id/edit"
                        element={
                          <NewInvoicePage
                            invoiceType={InvoiceType.Sale}
                            key={`${InvoiceType.Sale}-edit`}
                          />
                        }
                      />
                      <Route
                        path=":id"
                        element={<InvoicePage invoiceType={InvoiceType.Sale} />}
                      />
                    </Route>
                    <Route path="sale/returns">
                      <Route
                        index
                        element={
                          <InvoicesPage
                            invoiceType={InvoiceType.Sale}
                            saleReturns
                          />
                        }
                      />
                      <Route
                        path="new"
                        element={
                          <NewInvoicePage
                            invoiceType={InvoiceType.Sale}
                            saleReturn
                            key="sale-return-new"
                          />
                        }
                      />
                    </Route>
                    <Route
                      path="sale/quotations"
                      element={
                        <QuotationsPage invoiceType={InvoiceType.Sale} />
                      }
                    />
                    <Route
                      path="purchase/quotations"
                      element={
                        <QuotationsPage invoiceType={InvoiceType.Purchase} />
                      }
                    />
                  </Route>
                  <Route
                    path="invoices/:id/print"
                    element={<PrintableInvoiceScreen />}
                  />
                </Route>
                <Route path="*" element={<InvalidRoute />} />
              </Routes>
            </Suspense>
            <Toaster />
            <BackupToastListener />
          </MemoryRouter>
        </AdvancedCapabilitiesProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default AppRoutes;
