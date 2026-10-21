/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import { Toaster } from '@/renderer/shad/ui/toaster';
import {
  ADVANCED_CAPABILITIES,
  advancedCapabilityError,
} from '@/core/advancedCapabilities';
import { handleAsync } from '../utils';

describe('handleAsync', () => {
  beforeEach(() => {
    // the error path logs to the console, which is noise in the test output
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the refusal as a turned-off control, not a failure', async () => {
    render(<Toaster />);

    await act(async () => {
      await handleAsync(
        () =>
          Promise.reject(
            new Error(
              advancedCapabilityError(ADVANCED_CAPABILITIES.journalDelete),
            ),
          ),
        {
          errorMessage: 'Failed to delete journal',
          getErrorMessage: () => 'An unexpected error occurred',
        },
      );
    });

    expect(screen.getByText('Turned off on this device')).toBeInTheDocument();
    expect(screen.getByText(/Delete a journal/)).toBeInTheDocument();
    // the caller's own wording would have buried the refusal
    expect(
      screen.queryByText('An unexpected error occurred'),
    ).not.toBeInTheDocument();
  });

  it('uses the caller wording for an ordinary failure', async () => {
    render(<Toaster />);

    await act(async () => {
      await handleAsync(
        () => Promise.reject(new Error('Account name and code must be unique')),
        {
          errorMessage: 'Failed to create account',
          getErrorMessage: () => 'Account name and code must be unique',
        },
      );
    });

    expect(
      screen.getByText('Account name and code must be unique'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Turned off on this device'),
    ).not.toBeInTheDocument();
  });
});
