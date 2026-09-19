/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BackupSettings from '../BackupSettings';

jest.mock('renderer/shad/ui/use-toast', () => ({
  toast: jest.fn(),
}));

describe('BackupSettings', () => {
  const getBackupConfig = jest.fn();
  const saveBackupConfig = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    getBackupConfig.mockResolvedValue({
      supabaseUrl: 'https://saved.supabase.co',
      hasAnonKey: true,
      encryptionAvailable: true,
    });
    saveBackupConfig.mockImplementation(
      async (input: { supabaseUrl?: string }) => ({
        supabaseUrl: input.supabaseUrl ?? '',
        hasAnonKey: true,
        encryptionAvailable: true,
      }),
    );
    (
      window as unknown as {
        electron: {
          getBackupConfig: typeof getBackupConfig;
          saveBackupConfig: typeof saveBackupConfig;
        };
      }
    ).electron = { getBackupConfig, saveBackupConfig };
  });

  it('loads stored url and saves edits without sending an untouched key', async () => {
    render(<BackupSettings />);

    const urlInput = await screen.findByLabelText(/project url/i);
    expect(urlInput).toHaveValue('https://saved.supabase.co');

    fireEvent.change(urlInput, {
      target: { value: 'https://other.supabase.co' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /save backup settings/i }),
    );

    await waitFor(() => {
      expect(saveBackupConfig).toHaveBeenCalledWith({
        supabaseUrl: 'https://other.supabase.co',
      });
    });
  });

  it('includes a typed anon key on save', async () => {
    render(<BackupSettings />);

    const urlInput = await screen.findByLabelText(/project url/i);
    fireEvent.change(screen.getByLabelText(/anon public api key/i), {
      target: { value: 'new-anon' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /save backup settings/i }),
    );

    await waitFor(() => {
      expect(saveBackupConfig).toHaveBeenCalledWith({
        supabaseUrl: (urlInput as HTMLInputElement).value,
        anonKey: 'new-anon',
      });
    });
  });
});
