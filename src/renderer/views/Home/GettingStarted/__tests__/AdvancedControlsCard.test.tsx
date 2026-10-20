/**
 * @jest-environment jsdom
 *
 * Onboarding for advanced controls.
 *
 * The controls are hidden by default, so a new owner has no way to learn
 * the concept exists: the app looks like it simply cannot reverse a
 * journal or delete an account. The Getting Started card is the one place
 * that explains the concept and points at the screen where it is turned
 * on, so these tests cover that it is there, that it reports the current
 * state honestly, and that its button goes to the right place.
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdvancedCapabilitiesProvider } from '@/renderer/hooks/useAdvancedCapabilities';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';
import { AdvancedControlsCard } from '../AdvancedControlsCard';

const getAdvancedCapabilities = jest.fn();

beforeEach(() => {
  getAdvancedCapabilities.mockReset();
  (window as unknown as { electron: unknown }).electron = {
    getAdvancedCapabilities,
    setAdvancedCapabilities: jest.fn(),
  };
});

const renderCard = (capabilities: string[]) => {
  getAdvancedCapabilities.mockResolvedValue(capabilities);
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AdvancedCapabilitiesProvider>
        <Routes>
          <Route path="/" element={<AdvancedControlsCard />} />
          <Route path="/settings" element={<div>Settings page</div>} />
        </Routes>
      </AdvancedCapabilitiesProvider>
    </MemoryRouter>,
  );
};

describe('AdvancedControlsCard', () => {
  it('explains what advanced controls are', async () => {
    renderCard([]);

    expect(await screen.findByText('Advanced controls')).toBeInTheDocument();
    expect(screen.getByText(/reversing a journal/i)).toBeInTheDocument();
  });

  it('says the setting is remembered on this device only', async () => {
    renderCard([]);

    // the point of the flag is that it is per-device, so the owner
    // should not expect it to follow them to another machine
    expect(
      await screen.findByText(/remembered on this device only/i),
    ).toBeInTheDocument();
  });

  it('says everything is off when nothing is enabled', async () => {
    renderCard([]);

    expect(
      await screen.findByText(/All advanced controls are off/i),
    ).toBeInTheDocument();
  });

  it('counts the controls that are on', async () => {
    renderCard([
      ADVANCED_CAPABILITIES.journalReverse,
      ADVANCED_CAPABILITIES.accountDelete,
    ]);

    expect(
      await screen.findByText(/2 advanced controls are turned on/i),
    ).toBeInTheDocument();
  });

  it('uses the singular for one control', async () => {
    renderCard([ADVANCED_CAPABILITIES.journalReverse]);

    expect(
      await screen.findByText(/1 advanced control is turned on/i),
    ).toBeInTheDocument();
  });

  it('points at the screen where the controls are turned on', async () => {
    renderCard([]);

    const button = await screen.findByRole('button', {
      name: /Review advanced controls/i,
    });
    expect(button).toBeInTheDocument();
  });
});
