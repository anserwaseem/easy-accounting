/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Chart, UpdateAccount } from 'types';
import { EditAccount } from '../editAccount';

jest.mock('renderer/shad/ui/use-toast', () => ({
  toast: jest.fn(),
}));

describe('EditAccount - Copy Discount Profile', () => {
  const insertAccountMock = jest.fn().mockResolvedValue(true);
  const refetchAccountsMock = jest.fn();

  const charts: Chart[] = [
    {
      id: 1,
      name: 'Current Asset',
      type: 'Asset',
      userId: 1,
    } as unknown as Chart,
  ];

  const mockAccountWithProfile: UpdateAccount = {
    id: 10,
    name: 'Original Account',
    headName: 'Current Asset',
    code: 'ORIG-10',
    address: 'Original Address',
    phone1: '123456',
    phone2: '654321',
    goodsName: 'Carrier Goods',
    nameUrdu: 'اصل اکاؤنٹ',
    addressUrdu: 'اصل پتہ',
    goodsNameUrdu: 'مال',
    isActive: true,
    tracksVendorStock: false,
    discountProfileId: 42,
    discountProfileName: 'Wholesale Tier 1',
    discountProfileIsActive: true,
  };

  beforeAll(() => {
    // jsdom implements no ResizeObserver; radix popper/dialog measures with one
    (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {} // eslint-disable-line class-methods-use-this

      unobserve() {} // eslint-disable-line class-methods-use-this

      disconnect() {} // eslint-disable-line class-methods-use-this
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (
      window as unknown as {
        electron: {
          insertAccount: jest.Mock;
          updateAccount: jest.Mock;
          hasJournalEntries: jest.Mock;
          store: {
            get: jest.Mock;
            set: jest.Mock;
          };
        };
      }
    ).electron = {
      insertAccount: insertAccountMock,
      updateAccount: jest.fn().mockResolvedValue(true),
      hasJournalEntries: jest.fn().mockResolvedValue(false),
      store: {
        get: jest.fn().mockReturnValue('Current Asset'),
        set: jest.fn(),
      },
    };
  });

  it('copies discount profile when creating a copy of an account', async () => {
    render(
      <EditAccount
        row={{ original: mockAccountWithProfile }}
        refetchAccounts={refetchAccountsMock}
        charts={charts}
      />,
    );

    // Open edit dialog to find "Create a copy"
    const editBtn = screen.getByRole('button', { name: /edit account/i });
    fireEvent.click(editBtn);

    const copyBtn = await screen.findByRole('button', {
      name: /create a copy/i,
    });
    fireEvent.click(copyBtn);

    // Now the "Create New Account" dialog opens
    expect(await screen.findByText('Create New Account')).toBeInTheDocument();

    // Verify discount policy banner shows the copied profile name
    expect(screen.getByText('Wholesale Tier 1')).toBeInTheDocument();
    expect(screen.getByText('Discount Policy')).toBeInTheDocument();

    // Change account name so it's a new account
    const nameInput = screen.getByDisplayValue('Original Account');
    fireEvent.change(nameInput, { target: { value: 'Copied Account' } });

    // Submit the form
    const submitBtn = screen.getByRole('button', { name: /submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(insertAccountMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Copied Account',
          discountProfileId: 42,
        }),
      );
    });
  });

  it('copies null discount profile when source account has no discount profile', async () => {
    const mockAccountWithoutProfile: UpdateAccount = {
      ...mockAccountWithProfile,
      id: 11,
      name: 'Account No Profile',
      discountProfileId: null,
      discountProfileName: null,
    };

    render(
      <EditAccount
        row={{ original: mockAccountWithoutProfile }}
        refetchAccounts={refetchAccountsMock}
        charts={charts}
      />,
    );

    const editBtn = screen.getByRole('button', { name: /edit account/i });
    fireEvent.click(editBtn);

    const copyBtn = await screen.findByRole('button', {
      name: /create a copy/i,
    });
    fireEvent.click(copyBtn);

    expect(await screen.findByText('Create New Account')).toBeInTheDocument();

    // Policy banner should not be present
    expect(screen.queryByText('Discount Policy')).not.toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(insertAccountMock).toHaveBeenCalledWith(
        expect.objectContaining({
          discountProfileId: null,
        }),
      );
    });
  });
});
