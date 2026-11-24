import { act, renderHook } from '@testing-library/react';
import { format } from 'date-fns';
import { REPORT_FILTER_KEYS } from 'types';

import { useCollectionSheet } from '../useCollectionSheet';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useCollectionSheet date reopen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 24, 12, 0, 0));
    (window as any).electron = {
      store: {
        get: jest.fn(() => ({})),
        set: jest.fn(),
      },
      getCharts: jest.fn(async () => [
        { id: 10, name: 'Agent A', parentId: 1, type: 'Asset' },
      ]),
      getAccounts: jest.fn(async () => [
        {
          id: 101,
          name: 'Shop 1',
          code: 1,
          chartId: 10,
          isActive: 1,
          type: 'Asset',
        },
      ]),
      getItemTypes: jest.fn(async () => []),
      getLedgerBalancesForAccountIdsAsOfDate: jest.fn(async () => ({})),
      getReceiptSumsForAccountIdsInRange: jest.fn(async () => ({})),
      getSaleBillsForAccountIdsInRange: jest.fn(async () => ({})),
      getAgentTours: jest.fn(async () => []),
      getTourCollectionsForAccountIds: jest.fn(async () => ({})),
      getTourBalancesForAccountIds: jest.fn(async () => ({})),
      getUntouredCollectionsForAccountIds: jest.fn(async () => ({})),
    } as any;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reopens All with stale to → loads receipts through today', async () => {
    (window.electron.store.get as jest.Mock).mockImplementation((key) => {
      if (key === REPORT_FILTER_KEYS.collectionSheet) {
        return {
          chartId: 10,
          presetValue: 'all',
          dateRange: {
            from: new Date(1926, 10, 10).toISOString(),
            to: new Date(2026, 10, 10).toISOString(),
          },
        };
      }
      return {};
    });

    const { result } = renderHook(() => useCollectionSheet());
    await flush();
    await flush();

    expect(result.current.catalogReady).toBe(true);
    expect(result.current.presetValue).toBe('all');
    expect(format(result.current.dateRange!.to!, 'yyyy-MM-dd')).toBe(
      '2026-11-24',
    );
    expect(
      window.electron.getReceiptSumsForAccountIdsInRange,
    ).toHaveBeenCalledWith([101], '1926-11-24', '2026-11-24');
  });

  it('custom marker keeps frozen range on reopen', async () => {
    (window.electron.store.get as jest.Mock).mockImplementation((key) => {
      if (key === REPORT_FILTER_KEYS.collectionSheet) {
        return {
          chartId: 10,
          presetValue: 'custom',
          dateRange: {
            from: new Date(2026, 9, 1).toISOString(),
            to: new Date(2026, 9, 15).toISOString(),
          },
        };
      }
      return {};
    });

    const { result } = renderHook(() => useCollectionSheet());
    await flush();
    await flush();

    // hydrate clears the custom marker to '' so the picker shows dates
    expect(result.current.presetValue).toBe('');
    expect(
      window.electron.getReceiptSumsForAccountIdsInRange,
    ).toHaveBeenCalledWith([101], '2026-10-01', '2026-10-15');
  });

  it('handleDateChange with All persists recomputed range intent', async () => {
    const { result } = renderHook(() => useCollectionSheet());
    await flush();
    await flush();

    act(() => {
      result.current.handleHeadChange('10');
    });
    await flush();

    act(() => {
      result.current.handleDateChange(
        {
          from: new Date(1926, 10, 24),
          to: new Date(2026, 10, 24),
        },
        'all',
      );
    });
    await flush();

    expect(window.electron.store.set).toHaveBeenCalledWith(
      REPORT_FILTER_KEYS.collectionSheet,
      expect.objectContaining({
        presetValue: 'all',
        chartId: 10,
      }),
    );
  });
});
