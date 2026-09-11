import { act, renderHook, waitFor } from '@testing-library/react';
import { InvoiceType } from 'types';
import { useNewInvoiceNextNumber } from '../hooks/useNewInvoiceNextNumber';

describe('useNewInvoiceNextNumber', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('loads next invoice number from window.electron when still at sentinel -1', async () => {
    const getNextInvoiceNumber = jest.fn().mockResolvedValue(904);

    (
      window as unknown as { electron: { getNextInvoiceNumber: jest.Mock } }
    ).electron = { getNextInvoiceNumber };

    const { result } = renderHook(() =>
      useNewInvoiceNextNumber(InvoiceType.Sale),
    );

    expect(result.current.nextInvoiceNumber).toBe(-1);

    await waitFor(() => {
      expect(result.current.nextInvoiceNumber).toBe(904);
    });

    expect(getNextInvoiceNumber).toHaveBeenCalledWith(InvoiceType.Sale);
    expect(getNextInvoiceNumber).toHaveBeenCalledTimes(1);
  });

  it('refreshNextInvoiceNumber re-fetches even after initial load', async () => {
    const getNextInvoiceNumber = jest
      .fn()
      .mockResolvedValueOnce(904)
      .mockResolvedValueOnce(910);

    (
      window as unknown as { electron: { getNextInvoiceNumber: jest.Mock } }
    ).electron = { getNextInvoiceNumber };

    const { result } = renderHook(() =>
      useNewInvoiceNextNumber(InvoiceType.Sale),
    );

    await waitFor(() => {
      expect(result.current.nextInvoiceNumber).toBe(904);
    });

    await act(async () => {
      const next = await result.current.refreshNextInvoiceNumber();
      expect(next).toBe(910);
    });

    expect(result.current.nextInvoiceNumber).toBe(910);
    expect(getNextInvoiceNumber).toHaveBeenCalledTimes(2);
  });

  it('refreshNextInvoiceNumber is a no-op when disabled (edit mode)', async () => {
    const getNextInvoiceNumber = jest.fn().mockResolvedValue(904);

    (
      window as unknown as { electron: { getNextInvoiceNumber: jest.Mock } }
    ).electron = { getNextInvoiceNumber };

    const { result } = renderHook(() =>
      useNewInvoiceNextNumber(InvoiceType.Sale, false),
    );

    expect(result.current.nextInvoiceNumber).toBeUndefined();

    await act(async () => {
      const next = await result.current.refreshNextInvoiceNumber();
      expect(next).toBeUndefined();
    });

    expect(getNextInvoiceNumber).not.toHaveBeenCalled();
  });
});
