/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Chart } from 'types';
import { AccountForm } from '../accountForm';

jest.mock('renderer/shad/ui/use-toast', () => ({
  toast: jest.fn(),
}));

describe('AccountForm - Account Code Guardrails & Warnings', () => {
  const charts: Chart[] = [
    {
      id: 1,
      name: 'Current Asset',
      type: 'Asset',
      userId: 1,
    } as unknown as Chart,
    {
      id: 2,
      name: 'Tariq Ali Parties',
      type: 'Asset',
      userId: 1,
    } as unknown as Chart,
  ];

  beforeAll(() => {
    (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {} // eslint-disable-line class-methods-use-this

      unobserve() {} // eslint-disable-line class-methods-use-this

      disconnect() {} // eslint-disable-line class-methods-use-this
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without warning when code is empty', () => {
    (
      window as unknown as {
        electron: { checkAccountCode: jest.Mock };
      }
    ).electron = {
      checkAccountCode: jest.fn().mockResolvedValue([]),
    };

    render(<AccountForm charts={charts} onSubmit={jest.fn()} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('In use')).not.toBeInTheDocument();
  });

  it('displays warning alert and badge when a duplicate code is entered', async () => {
    const checkAccountCodeMock = jest.fn().mockImplementation(async (code) => {
      if (String(code).trim().toLowerCase() === 'bwp-ashrafia') {
        return [
          {
            id: 2377,
            name: 'MAKTABA ASHRAFIA',
            code: 'Bwp-ashrafia',
            headName: 'Tariq Ali Parties',
            isActive: true,
          },
        ];
      }
      return [];
    });

    (
      window as unknown as {
        electron: { checkAccountCode: jest.Mock };
      }
    ).electron = {
      checkAccountCode: checkAccountCodeMock,
    };

    render(<AccountForm charts={charts} onSubmit={jest.fn()} />);

    const codeInput = screen.getByPlaceholderText('e.g. 1001');
    fireEvent.change(codeInput, { target: { value: 'Bwp-ashrafia' } });

    await waitFor(() => {
      expect(screen.getByText('In use')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/is already in use by an active account/i),
    ).toBeInTheDocument();
    expect(screen.getByText('MAKTABA ASHRAFIA')).toBeInTheDocument();
    expect(screen.getByText('(Tariq Ali Parties)')).toBeInTheDocument();
  });

  it('clears warning when the code is modified back to a unique value', async () => {
    const checkAccountCodeMock = jest.fn().mockImplementation(async (code) => {
      if (String(code).trim() === 'DUP-10') {
        return [
          {
            id: 10,
            name: 'Existing Customer',
            code: 'DUP-10',
            headName: 'Current Asset',
            isActive: true,
          },
        ];
      }
      return [];
    });

    (
      window as unknown as {
        electron: { checkAccountCode: jest.Mock };
      }
    ).electron = {
      checkAccountCode: checkAccountCodeMock,
    };

    render(<AccountForm charts={charts} onSubmit={jest.fn()} />);

    const codeInput = screen.getByPlaceholderText('e.g. 1001');
    fireEvent.change(codeInput, { target: { value: 'DUP-10' } });

    await waitFor(() => {
      expect(screen.getByText('In use')).toBeInTheDocument();
    });

    // Change to unique code
    fireEvent.change(codeInput, { target: { value: 'UNIQUE-99' } });

    await waitFor(() => {
      expect(screen.queryByText('In use')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('intercepts submit with a confirmation prompt when code is duplicated, and allows "Save Anyway"', async () => {
    const onSubmitMock = jest.fn().mockResolvedValue(undefined);
    (
      window as unknown as {
        electron: { checkAccountCode: jest.Mock };
      }
    ).electron = {
      checkAccountCode: jest.fn().mockResolvedValue([
        {
          id: 50,
          name: 'Colliding Account',
          code: 'COLLIDE-1',
          headName: 'Current Asset',
          isActive: true,
        },
      ]),
    };

    render(
      <AccountForm
        charts={charts}
        onSubmit={onSubmitMock}
        initialValues={{
          headName: 'Current Asset',
          accountName: 'New Shop',
          accountCode: 'COLLIDE-1',
        }}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: 'Submit' });
    fireEvent.click(submitBtn);

    // Prompt should appear, onSubmit should NOT be called yet
    await waitFor(() => {
      expect(
        screen.getByText(/is already in use\. Save anyway\?/i),
      ).toBeInTheDocument();
    });
    expect(onSubmitMock).not.toHaveBeenCalled();

    // Clicking "Save Anyway" submits
    const saveAnywayBtn = screen.getByRole('button', { name: /save anyway/i });
    fireEvent.click(saveAnywayBtn);

    await waitFor(() => {
      expect(onSubmitMock).toHaveBeenCalledTimes(1);
    });
  });

  it('allows canceling the duplicate prompt to change the code', async () => {
    const onSubmitMock = jest.fn().mockResolvedValue(undefined);
    (
      window as unknown as {
        electron: { checkAccountCode: jest.Mock };
      }
    ).electron = {
      checkAccountCode: jest.fn().mockResolvedValue([
        {
          id: 50,
          name: 'Colliding Account',
          code: 'COLLIDE-1',
          headName: 'Current Asset',
          isActive: true,
        },
      ]),
    };

    render(
      <AccountForm
        charts={charts}
        onSubmit={onSubmitMock}
        initialValues={{
          headName: 'Current Asset',
          accountName: 'New Shop',
          accountCode: 'COLLIDE-1',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(
        screen.getByText(/is already in use\. Save anyway\?/i),
      ).toBeInTheDocument();
    });

    // Clicking "Change Code" cancels prompt
    const changeCodeBtn = screen.getByRole('button', { name: /change code/i });
    fireEvent.click(changeCodeBtn);

    expect(
      screen.queryByText(/is already in use\. Save anyway\?/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(onSubmitMock).not.toHaveBeenCalled();
  });

  it('passes excludeAccountId when editing an existing account to exclude self', async () => {
    const checkAccountCodeMock = jest.fn().mockResolvedValue([]);
    (
      window as unknown as {
        electron: { checkAccountCode: jest.Mock };
      }
    ).electron = {
      checkAccountCode: checkAccountCodeMock,
    };

    render(
      <AccountForm
        charts={charts}
        onSubmit={jest.fn()}
        initialValues={{
          id: 42,
          headName: 'Current Asset',
          accountName: 'My Account',
          accountCode: 'SAME-CODE',
        }}
      />,
    );

    const codeInput = screen.getByPlaceholderText('e.g. 1001');
    fireEvent.change(codeInput, { target: { value: 'NEW-CODE' } });

    await waitFor(() => {
      expect(checkAccountCodeMock).toHaveBeenCalledWith('NEW-CODE', 42);
    });
  });
});
