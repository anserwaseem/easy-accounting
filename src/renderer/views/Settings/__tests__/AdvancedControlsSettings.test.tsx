/**
 * @jest-environment jsdom
 *
 * The Settings panel is the only place advanced controls can be turned on,
 * so it is also the only place the owner learns what exists. Three things
 * are worth pinning down with a test:
 *
 *  - every capability is listed somewhere, so nothing is invisible
 *  - the destructive ones are marked, because that is the difference the
 *    owner is making when they turn one on
 *  - the search filters the list rather than hiding the group headings
 *    and leaving an empty box behind
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AdvancedCapabilitiesProvider } from '@/renderer/hooks/useAdvancedCapabilities';
import {
  ALL_ADVANCED_CAPABILITIES,
  ADVANCED_CAPABILITY_LABELS,
  DESTRUCTIVE_ADVANCED_CAPABILITIES,
} from '@/core/advancedCapabilities';
import AdvancedControlsSettings from '../AdvancedControlsSettings';

const getAdvancedCapabilities = jest.fn();

beforeEach(() => {
  getAdvancedCapabilities.mockReset();
  getAdvancedCapabilities.mockResolvedValue([]);
  (window as unknown as { electron: unknown }).electron = {
    getAdvancedCapabilities,
    setAdvancedCapabilities: jest.fn().mockResolvedValue(undefined),
  };
});

const renderPanel = () =>
  render(
    <AdvancedCapabilitiesProvider>
      <AdvancedControlsSettings />
    </AdvancedCapabilitiesProvider>,
  );

describe('AdvancedControlsSettings', () => {
  it('lists every capability with its label', async () => {
    renderPanel();

    await waitFor(() => expect(getAdvancedCapabilities).toHaveBeenCalled());
    for (const capability of ALL_ADVANCED_CAPABILITIES) {
      expect(
        screen.getByText(ADVANCED_CAPABILITY_LABELS[capability]),
      ).toBeInTheDocument();
    }
  });

  it('marks the capabilities that change records', async () => {
    renderPanel();

    await waitFor(() => expect(getAdvancedCapabilities).toHaveBeenCalled());
    // one marker per destructive capability, and no more
    expect(screen.getAllByText('Changes records')).toHaveLength(
      DESTRUCTIVE_ADVANCED_CAPABILITIES.length,
    );
  });

  it('filters the list by the label the owner reads', async () => {
    renderPanel();

    await waitFor(() => expect(getAdvancedCapabilities).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Search the advanced controls'), {
      target: { value: 'return a' },
    });

    expect(screen.getByText('Return a sale invoice')).toBeInTheDocument();
    expect(screen.getByText('Return a purchase invoice')).toBeInTheDocument();
    expect(screen.queryByText('Delete a journal')).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    renderPanel();

    await waitFor(() => expect(getAdvancedCapabilities).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Search the advanced controls'), {
      target: { value: 'nothing matches this' },
    });

    expect(screen.getByText(/No advanced control matches/)).toBeInTheDocument();
  });
});
