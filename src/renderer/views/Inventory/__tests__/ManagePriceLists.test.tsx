/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PriceListSummary } from '@/renderer/hooks/usePublishSettings';
import {
  ManagePriceLists,
  SEED_MULTIPLIER_STORE_KEY,
  SEED_ROUND_TO_STORE_KEY,
} from '../ManagePriceLists';

const mockPriceLists: PriceListSummary[] = [
  { id: 1, name: 'Wholesale', itemCount: 5, isActive: 1 },
];

describe('ManagePriceLists seed inputs persistence', () => {
  let store: Record<string, unknown> = {};

  beforeEach(() => {
    store = {};
    (
      window as unknown as {
        electron: {
          getPriceLists: jest.Mock;
          previewPriceListSeed: jest.Mock;
          applyPriceListSeed: jest.Mock;
          store: {
            get: jest.Mock;
            set: jest.Mock;
          };
        };
      }
    ).electron = {
      getPriceLists: jest.fn(async () => mockPriceLists),
      previewPriceListSeed: jest.fn(async () => ({
        changes: [{ inventoryId: 1, name: 'ITEM-1', from: 100, to: 125 }],
        skippedExisting: 0,
        skippedNoSource: 0,
        unchanged: 0,
      })),
      applyPriceListSeed: jest.fn(async () => ({
        applied: 1,
        plan: {
          changes: [{ inventoryId: 1, name: 'ITEM-1', from: 100, to: 125 }],
          skippedExisting: 0,
          skippedNoSource: 0,
          unchanged: 0,
        },
      })),
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

  it('uses default 1.2 multiplier and 10 roundTo when no preferences are stored', async () => {
    render(<ManagePriceLists filteredInventoryIds={[1]} open />);

    await waitFor(() => {
      expect(screen.getByText('Wholesale')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /set prices/i }));

    const multiplierInput = screen.getByLabelText(
      /multiply by/i,
    ) as HTMLInputElement;
    const roundToInput = screen.getByLabelText(
      /round to nearest/i,
    ) as HTMLInputElement;

    expect(multiplierInput.value).toBe('1.2');
    expect(roundToInput.value).toBe('10');
  });

  it('loads previously stored multiplier and roundTo preferences', async () => {
    store[SEED_MULTIPLIER_STORE_KEY] = '1.25';
    store[SEED_ROUND_TO_STORE_KEY] = '5';

    render(<ManagePriceLists filteredInventoryIds={[1]} open />);

    await waitFor(() => {
      expect(screen.getByText('Wholesale')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /set prices/i }));

    const multiplierInput = screen.getByLabelText(
      /multiply by/i,
    ) as HTMLInputElement;
    const roundToInput = screen.getByLabelText(
      /round to nearest/i,
    ) as HTMLInputElement;

    expect(multiplierInput.value).toBe('1.25');
    expect(roundToInput.value).toBe('5');
  });

  it('saves multiplier and roundTo preferences when seed is applied and remembers them when reopened', async () => {
    const { rerender } = render(
      <ManagePriceLists filteredInventoryIds={[1]} open />,
    );

    await waitFor(() => {
      expect(screen.getByText('Wholesale')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /set prices/i }));

    const multiplierInput = screen.getByLabelText(
      /multiply by/i,
    ) as HTMLInputElement;
    const roundToInput = screen.getByLabelText(
      /round to nearest/i,
    ) as HTMLInputElement;

    // Change to 1.25 and 5
    fireEvent.change(multiplierInput, { target: { value: '1.25' } });
    fireEvent.change(roundToInput, { target: { value: '5' } });

    // Preview first to enable Apply button
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /^apply$/i }),
      ).not.toBeDisabled();
    });

    // Apply
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      expect(window.electron.applyPriceListSeed).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ multiplier: 1.25, roundTo: 5 }),
        [1],
      );
    });

    expect(window.electron.store.set).toHaveBeenCalledWith(
      SEED_MULTIPLIER_STORE_KEY,
      '1.25',
    );
    expect(window.electron.store.set).toHaveBeenCalledWith(
      SEED_ROUND_TO_STORE_KEY,
      '5',
    );

    // Simulating closing and reopening the dialog
    rerender(<ManagePriceLists filteredInventoryIds={[1]} open={false} />);
    rerender(<ManagePriceLists filteredInventoryIds={[1]} open />);

    await waitFor(() => {
      expect(screen.getByText('Wholesale')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /set prices/i }));

    const reopenedMultiplier = screen.getByLabelText(
      /multiply by/i,
    ) as HTMLInputElement;
    const reopenedRoundTo = screen.getByLabelText(
      /round to nearest/i,
    ) as HTMLInputElement;

    // Should remember 1.25 and 5 instead of reverting to 1.2 and 10
    expect(reopenedMultiplier.value).toBe('1.25');
    expect(reopenedRoundTo.value).toBe('5');
  });
});
