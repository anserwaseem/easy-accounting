import { renderHook, waitFor } from '@testing-library/react';
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

    expect(result.current[0]).toBe(-1);

    await waitFor(() => {
      expect(result.current[0]).toBe(904);
    });

    expect(getNextInvoiceNumber).toHaveBeenCalledWith(InvoiceType.Sale);
    expect(getNextInvoiceNumber).toHaveBeenCalledTimes(1);
  });
});
