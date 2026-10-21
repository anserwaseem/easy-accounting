/**
 * @jest-environment jsdom
 *
 * The advanced-capability gates are the whole point of the feature: a control
 * the owner has not unlocked must not be on screen, and a page behind a
 * capability must not be reachable by typing its URL. These tests cover the
 * two gates that do that (AdvancedControl and AdvancedRoute) against a
 * provider whose enabled set is set explicitly, so the assertions are about
 * the gate rather than about the store.
 */
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdvancedCapabilitiesProvider } from '@/renderer/hooks/useAdvancedCapabilities';
import { AdvancedControl } from '@/renderer/components/AdvancedControl';
import { AdvancedRoute } from '@/renderer/components/AdvancedRoute';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';

const getAdvancedCapabilities = jest.fn();

beforeEach(() => {
  getAdvancedCapabilities.mockReset();
  (window as unknown as { electron: unknown }).electron = {
    getAdvancedCapabilities,
    setAdvancedCapabilities: jest.fn(),
  };
});

const renderWith = (
  ui: React.ReactElement,
  capabilities: string[],
  initialEntry = '/',
) => {
  getAdvancedCapabilities.mockResolvedValue(capabilities);
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AdvancedCapabilitiesProvider>{ui}</AdvancedCapabilitiesProvider>
    </MemoryRouter>,
  );
};

describe('AdvancedControl', () => {
  it('hides the control when the capability is off', async () => {
    renderWith(
      <AdvancedControl capability={ADVANCED_CAPABILITIES.commissionModule}>
        <button type="button">Agent Commissions</button>
      </AdvancedControl>,
      [],
    );

    await waitFor(() => expect(getAdvancedCapabilities).toHaveBeenCalled());
    expect(screen.queryByText('Agent Commissions')).not.toBeInTheDocument();
  });

  it('shows the control when the capability is on', async () => {
    renderWith(
      <AdvancedControl capability={ADVANCED_CAPABILITIES.commissionModule}>
        <button type="button">Agent Commissions</button>
      </AdvancedControl>,
      [ADVANCED_CAPABILITIES.commissionModule],
    );

    expect(await screen.findByText('Agent Commissions')).toBeInTheDocument();
  });

  it('hides "Set opening stock" when that capability is off', async () => {
    renderWith(
      <AdvancedControl
        capability={ADVANCED_CAPABILITIES.inventorySetOpeningStock}
      >
        <button type="button">Set opening stock</button>
      </AdvancedControl>,
      [],
    );

    await waitFor(() => expect(getAdvancedCapabilities).toHaveBeenCalled());
    expect(screen.queryByText('Set opening stock')).not.toBeInTheDocument();
  });

  it('shows "Set starting qty" when that capability is on', async () => {
    renderWith(
      <AdvancedControl
        capability={ADVANCED_CAPABILITIES.vendorStockSetOpeningStock}
      >
        <button type="button">Set starting qty</button>
      </AdvancedControl>,
      [ADVANCED_CAPABILITIES.vendorStockSetOpeningStock],
    );

    expect(await screen.findByText('Set starting qty')).toBeInTheDocument();
  });
});

describe('AdvancedRoute', () => {
  const routes = (
    <Routes>
      <Route
        path="/reports/agent-commission"
        element={
          <AdvancedRoute
            capability={ADVANCED_CAPABILITIES.commissionModule}
            fallback="/reports"
          >
            <div>Commission report</div>
          </AdvancedRoute>
        }
      />
      <Route path="/reports" element={<div>Reports list</div>} />
    </Routes>
  );

  it('redirects away when the capability is off', async () => {
    renderWith(routes, [], '/reports/agent-commission');

    expect(await screen.findByText('Reports list')).toBeInTheDocument();
    expect(screen.queryByText('Commission report')).not.toBeInTheDocument();
  });

  it('renders the page when the capability is on', async () => {
    getAdvancedCapabilities.mockResolvedValue([
      ADVANCED_CAPABILITIES.commissionModule,
    ]);
    render(
      <MemoryRouter initialEntries={['/reports/agent-commission']}>
        <AdvancedCapabilitiesProvider>{routes}</AdvancedCapabilitiesProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Commission report')).toBeInTheDocument();
  });
});
