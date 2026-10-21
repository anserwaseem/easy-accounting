/**
 * @jest-environment jsdom
 *
 * The Reports index is where the owner finds a report, so a report behind a
 * capability has to disappear from this list rather than lead to a page that
 * says "not available".
 */
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { AdvancedCapabilitiesProvider } from '@/renderer/hooks/useAdvancedCapabilities';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';

// the component under test (after mocks)
// eslint-disable-next-line import/first
import ReportsPage from '../index';

const getAdvancedCapabilities = jest.fn();

beforeEach(() => {
  getAdvancedCapabilities.mockReset();
  (window as unknown as { electron: unknown }).electron = {
    getAdvancedCapabilities,
    setAdvancedCapabilities: jest.fn().mockResolvedValue(undefined),
  };
});

const renderPage = (capabilities: string[]) => {
  getAdvancedCapabilities.mockResolvedValue(capabilities);
  return render(
    <MemoryRouter>
      <AdvancedCapabilitiesProvider>
        <ReportsPage />
      </AdvancedCapabilitiesProvider>
    </MemoryRouter>,
  );
};

describe('ReportsPage', () => {
  it('hides the sales performance report when its capability is off', async () => {
    renderPage([]);

    await waitFor(() => expect(getAdvancedCapabilities).toHaveBeenCalled());
    expect(screen.queryByText('Sales Performance')).not.toBeInTheDocument();
    // the other reports are untouched
    expect(screen.getByText('Trial Balance')).toBeInTheDocument();
    expect(screen.getByText('Bills Aging')).toBeInTheDocument();
  });

  it('shows the sales performance report when its capability is on', async () => {
    renderPage([ADVANCED_CAPABILITIES.salesPerformanceReport]);

    expect(await screen.findByText('Sales Performance')).toBeInTheDocument();
  });
});
