/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { APP_VERSION } from '@/lib/appVersion';
import { useAppVersion } from '../useAppVersion';

describe('useAppVersion', () => {
  beforeEach(() => {
    (
      window as unknown as {
        electron: { getAppVersion?: () => Promise<string> };
      }
    ).electron = {};
  });

  it('shows the shared package.json version with no ipc', () => {
    const { result } = renderHook(() => useAppVersion());
    expect(result.current).toBe(APP_VERSION);
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  it('overlays a desktop ipc version when present', async () => {
    (
      window as unknown as {
        electron: { getAppVersion: () => Promise<string> };
      }
    ).electron.getAppVersion = jest.fn().mockResolvedValue('9.9.9');

    const { result } = renderHook(() => useAppVersion());
    expect(result.current).toBe(APP_VERSION);
    await waitFor(() => {
      expect(result.current).toBe('9.9.9');
    });
  });

  it('keeps the shared version when ipc fails', async () => {
    (
      window as unknown as {
        electron: { getAppVersion: () => Promise<string> };
      }
    ).electron.getAppVersion = jest.fn().mockRejectedValue(new Error('no ipc'));

    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => {
      expect(window.electron.getAppVersion).toHaveBeenCalled();
    });
    expect(result.current).toBe(APP_VERSION);
  });
});
