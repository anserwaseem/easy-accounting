/**
 * @jest-environment jsdom
 *
 * The "What counts as payment" tab writes account.collectionRole, and the
 * main process refuses that write while the advanced capability is off.
 * Before this gate existed, the switch stayed on screen and every flip
 * came back as an error toast, so the two layers disagreed.
 *
 * These tests cover the two halves of that disagreement: the switch (and
 * its column) go away when the capability is off, and the read side (which
 * accounts count, and why) stays either way, because the employee still
 * needs to know what the sheet is counting.
 */
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AdvancedCapabilitiesProvider } from '@/renderer/hooks/useAdvancedCapabilities';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';
import { CollectionSourcesReview } from '../CollectionSourcesReview';

const getAdvancedCapabilities = jest.fn();
const getCollectionSources = jest.fn();

const source = {
  accountId: 7,
  // a different chart from the agent's (chart 1), so this reads as a
  // cash/bank account rather than a transfer between the agent's own shops
  chartId: 2,
  name: 'Cash in hand',
  headName: 'Assets',
  headType: 'Asset',
  headParentId: null,
  collectionRole: null,
  entries: 1,
  maxShopsPerEntry: 1,
  amount: 5000,
  shops: 2,
};

beforeEach(() => {
  getAdvancedCapabilities.mockReset();
  getCollectionSources.mockReset();
  getCollectionSources.mockResolvedValue([source]);
  (window as unknown as { electron: unknown }).electron = {
    getAdvancedCapabilities,
    setAdvancedCapabilities: jest.fn(),
    getCollectionSources,
  };
});

const renderWith = (capabilities: string[]) => {
  getAdvancedCapabilities.mockResolvedValue(capabilities);
  return render(
    <AdvancedCapabilitiesProvider>
      <CollectionSourcesReview
        chartId={1}
        range={{ from: '2026-01-01', to: '2026-01-31' }}
        onChanged={jest.fn()}
      />
    </AdvancedCapabilitiesProvider>,
  );
};

describe('CollectionSourcesReview', () => {
  it('hides the payment switch when the capability is off', async () => {
    renderWith([]);

    await waitFor(() => expect(getAdvancedCapabilities).toHaveBeenCalled());
    await screen.findByText('Cash in hand');

    expect(
      screen.queryByLabelText('Cash in hand counts as payment'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Payment')).not.toBeInTheDocument();
  });

  it('still shows which accounts count when the capability is off', async () => {
    renderWith([]);

    // the read side is what the employee needs to understand the sheet:
    // the account name and the reason it does or does not count
    expect(await screen.findByText('Cash in hand')).toBeInTheDocument();
    expect(
      screen.getByText(/Cash, bank or clearing account/),
    ).toBeInTheDocument();
  });

  it('shows the payment switch when the capability is on', async () => {
    renderWith([ADVANCED_CAPABILITIES.accountCollectionRole]);

    expect(
      await screen.findByLabelText('Cash in hand counts as payment'),
    ).toBeInTheDocument();
    expect(screen.getByText('Payment')).toBeInTheDocument();
  });
});
