/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { APP_VERSION } from '@/lib/appVersion';
import SettingsPage from '../index';

jest.mock('../PublishSettings', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="publish-settings">Publish Settings Mock</div>
  ),
}));

jest.mock('../BackupSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="backup-settings">Backup Settings Mock</div>,
}));

describe('SettingsPage', () => {
  let store: Record<string, unknown> = {};

  beforeEach(() => {
    store = {
      'companyProfile.name': 'Test Company',
      'companyProfile.address': '123 Main Street',
      'companyProfile.phone': '+92 300 0000000',
      'companyProfile.email': 'info@test.com',
      'companyProfile.nameUrdu': 'ٹیسٹ کمپنی',
      'companyProfile.addressUrdu': 'مین سٹریٹ',
      'companyProfile.whatsapp': '03001234567',
      'companyProfile.website': 'https://test.com',
      'companyProfile.printNote': 'Standard test note',
      'companyProfile.printNoteUrdu': 'ٹیسٹ نوٹ',
      'print.locale': 'en',
      'print.showPartyBalances': true,
      'print.showAgent': true,
      'print.showBillBalance': true,
      'print.englishLabelOverrides': {},
      'print.urduLabelOverrides': {},
      debitCreditDefaultLabel: '0',
      'invoice.blockSaveWhenSplitTypedAccountMissing': true,
    };

    (
      window as unknown as {
        electron: {
          supportsBackup?: true;
          getAppVersion: () => Promise<string>;
          store: {
            get: (key: string, defaultVal?: unknown) => unknown;
            set: (key: string, val: unknown) => void;
          };
        };
      }
    ).electron = {
      supportsBackup: true,
      getAppVersion: jest.fn().mockResolvedValue(APP_VERSION),
      store: {
        get: jest.fn((key: string, defaultVal?: unknown) =>
          store[key] !== undefined ? store[key] : defaultVal,
        ),
        set: jest.fn((key: string, val: unknown) => {
          store[key] = val;
        }),
      },
    };
  });

  const renderSettings = async () => {
    const view = render(<SettingsPage />);
    await screen.findByTestId('app-version');
    return view;
  };

  it('renders all four settings tabs', async () => {
    await renderSettings();

    expect(screen.getByRole('tab', { name: /company/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /invoicing/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /rules/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /sync/i })).toBeInTheDocument();
  });

  it('shows the running app version in the header', async () => {
    await renderSettings();

    expect(screen.getByTestId('app-version')).toHaveTextContent(
      `Version ${APP_VERSION}`,
    );
  });

  it('populates company details from store', async () => {
    await renderSettings();

    expect(screen.getByDisplayValue('Test Company')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ٹیسٹ کمپنی')).toBeInTheDocument();
    expect(screen.getByDisplayValue('123 Main Street')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+92 300 0000000')).toBeInTheDocument();
  });

  it('tracks dirty state and allows reset', async () => {
    await renderSettings();

    expect(
      screen.queryByText(/you have unsaved changes/i),
    ).not.toBeInTheDocument();

    const companyNameInput = screen.getByDisplayValue('Test Company');
    fireEvent.change(companyNameInput, {
      target: { value: 'New Company Name' },
    });

    expect(screen.getByText(/you have unsaved changes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reset/i }));

    expect(
      screen.queryByText(/you have unsaved changes/i),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Test Company')).toBeInTheDocument();
  });

  it('saves changes and updates electron store', async () => {
    await renderSettings();

    const companyNameInput = screen.getByDisplayValue('Test Company');
    fireEvent.change(companyNameInput, {
      target: { value: 'Updated Company' },
    });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveButton);

    expect(window.electron.store.set).toHaveBeenCalledWith(
      'companyProfile.name',
      'Updated Company',
    );
    expect(
      screen.queryByText(/you have unsaved changes/i),
    ).not.toBeInTheDocument();
  });

  it('switches to Invoicing tab and displays print configuration', async () => {
    await renderSettings();

    const invoicingTab = screen.getByRole('tab', { name: /invoicing/i });
    act(() => {
      invoicingTab.focus();
      fireEvent.keyDown(invoicingTab, { key: 'Enter' });
    });

    expect(screen.getByText(/invoice print layout/i)).toBeInTheDocument();
    expect(screen.getByText(/show customer balances/i)).toBeInTheDocument();
    expect(screen.getByText(/show sales agent/i)).toBeInTheDocument();
    expect(screen.getByText(/print language format/i)).toBeInTheDocument();
  });

  it('switches to Rules tab and displays validation constraint switch', async () => {
    await renderSettings();

    const rulesTab = screen.getByRole('tab', { name: /rules/i });
    act(() => {
      rulesTab.focus();
      fireEvent.keyDown(rulesTab, { key: 'Enter' });
    });

    expect(
      screen.getByText(/accounting validation rules/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/strict split-type account requirement/i),
    ).toBeInTheDocument();
  });

  it('switches to Sync tab and renders PublishSettings and BackupSettings', async () => {
    await renderSettings();

    const syncTab = screen.getByRole('tab', { name: /sync/i });
    act(() => {
      syncTab.focus();
      fireEvent.keyDown(syncTab, { key: 'Enter' });
    });

    expect(screen.getByTestId('publish-settings')).toBeInTheDocument();
    expect(screen.getByTestId('backup-settings')).toBeInTheDocument();
  });
});
