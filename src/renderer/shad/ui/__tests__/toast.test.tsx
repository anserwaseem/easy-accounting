/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
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
