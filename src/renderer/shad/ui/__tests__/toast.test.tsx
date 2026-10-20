/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import {
  ADVANCED_CAPABILITIES,
  advancedCapabilityError,
} from '@/core/advancedCapabilities';
import { Toaster } from '../toaster';
import { toast, dismissAllToasts } from '../use-toast';

describe('Toast System - Error and Warning Formatting', () => {
  beforeEach(() => {
    act(() => {
      dismissAllToasts();
    });
  });

  afterEach(() => {
    act(() => {
      dismissAllToasts();
    });
  });

  it('automatically strips Electron IPC prefix and nested Error from destructive toast description', async () => {
    render(<Toaster />);

    act(() => {
      toast({
        title: 'Reversal Failed',
        description:
          "Error invoking remote method 'journal:reverse': Error: Cannot reverse an invoice-linked journal directly. Please return the invoice instead.",
        variant: 'destructive',
      });
    });

    expect(screen.getByText('Reversal Failed')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Cannot reverse an invoice-linked journal directly. Please return the invoice instead.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Error invoking remote method/),
    ).not.toBeInTheDocument();
  });

  it('automatically handles Error object passed as description', async () => {
    render(<Toaster />);

    act(() => {
      toast({
        title: 'Delete Failed',
        description: new Error(
          "Error invoking remote method 'journal:deleteManual': Error: Cannot delete an invoice-linked journal.",
        ),
        variant: 'destructive',
      });
    });

    expect(screen.getByText('Delete Failed')).toBeInTheDocument();
    expect(
      screen.getByText('Cannot delete an invoice-linked journal.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Error invoking remote method/),
    ).not.toBeInTheDocument();
  });

  it('renders destructive variant with red styling and alert icon', () => {
    const { container } = render(<Toaster />);

    act(() => {
      toast({
        title: 'Error Occurred',
        description: 'Failed to process request',
        variant: 'destructive',
      });
    });

    expect(screen.getByText('Error Occurred')).toBeInTheDocument();
    expect(screen.getByText('Failed to process request')).toBeInTheDocument();

    // Verify error icon is rendered
    const icon = container.querySelector('svg.text-red-600');
    expect(icon).toBeInTheDocument();
  });

  it('renders warning variant with amber styling and warning icon', () => {
    const { container } = render(<Toaster />);

    act(() => {
      toast({
        title: 'Duplicate Detected',
        description: 'Account code already exists',
        variant: 'warning',
      });
    });

    expect(screen.getByText('Duplicate Detected')).toBeInTheDocument();
    const icon = container.querySelector('svg.text-amber-600');
    expect(icon).toBeInTheDocument();
  });

  it('renders success variant with emerald styling and success icon', () => {
    const { container } = render(<Toaster />);

    act(() => {
      toast({
        title: 'Success',
        description: 'Journal saved successfully',
        variant: 'success',
      });
    });

    expect(screen.getByText('Success')).toBeInTheDocument();
    const icon = container.querySelector('svg.text-emerald-600');
    expect(icon).toBeInTheDocument();
  });
});

describe('Toast System - Advanced control refusals', () => {
  beforeEach(() => {
    act(() => {
      dismissAllToasts();
    });
  });

  afterEach(() => {
    act(() => {
      dismissAllToasts();
    });
  });

  it('replaces the raw refusal with a message the person can act on', () => {
    render(<Toaster />);

    act(() => {
      toast({
        title: 'Delete Failed',
        description: advancedCapabilityError(
          ADVANCED_CAPABILITIES.journalDelete,
        ),
        variant: 'destructive',
      });
    });

    expect(screen.getByText('Turned off on this device')).toBeInTheDocument();
    expect(screen.getByText(/Delete a journal/)).toBeInTheDocument();
    // the caller's own title and the raw id are both gone
    expect(screen.queryByText('Delete Failed')).not.toBeInTheDocument();
    expect(screen.queryByText(/journal\.delete/)).not.toBeInTheDocument();
  });

  it('replaces a refusal that arrives wrapped in the Electron IPC prefix', () => {
    render(<Toaster />);

    act(() => {
      toast({
        title: 'Reversal Failed',
        description: `Error invoking remote method 'journal:reverse': Error: ${advancedCapabilityError(
          ADVANCED_CAPABILITIES.journalReverse,
        )}`,
        variant: 'destructive',
      });
    });

    expect(screen.getByText('Turned off on this device')).toBeInTheDocument();
    expect(screen.getByText(/Reverse a journal/)).toBeInTheDocument();
  });

  it('leaves an ordinary failure alone', () => {
    render(<Toaster />);

    act(() => {
      toast({
        title: 'Delete Failed',
        description: 'Cannot delete an invoice-linked journal.',
        variant: 'destructive',
      });
    });

    expect(screen.getByText('Delete Failed')).toBeInTheDocument();
    expect(
      screen.getByText('Cannot delete an invoice-linked journal.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Turned off on this device'),
    ).not.toBeInTheDocument();
  });

  it('does not style a refusal as a failure', () => {
    // the action did not fail, it was turned off, so the red styling
    // would be the wrong signal
    const { container } = render(<Toaster />);

    act(() => {
      toast({
        title: 'Delete Failed',
        description: advancedCapabilityError(
          ADVANCED_CAPABILITIES.journalDelete,
        ),
        variant: 'destructive',
      });
    });

    expect(container.querySelector('svg.text-red-600')).not.toBeInTheDocument();
    expect(container.querySelector('svg.text-amber-600')).toBeInTheDocument();
  });
});
