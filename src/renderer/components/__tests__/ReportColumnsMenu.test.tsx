/**
 * @jest-environment jsdom
 *
 * The column sheet has to stay a dialog with a scrolling list. A plain
 * overlay let the rows grow past the panel, so the last columns and Done
 * sat off screen with no scroll.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ReportColumnsMenu } from '../ReportColumnsMenu';
import type { ReportColumnOption } from '../ReportColumnsMenu';

const columns: ReportColumnOption[] = [
  { id: 'shop', label: 'Shop' },
  { id: 'city', label: 'City' },
  { id: 'code', label: 'Code' },
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `tour-${index}`,
    label: `Tour ${index + 1}`,
  })),
];

const Harness = () => {
  const [included, setIncluded] = useState<ReadonlySet<string>>(
    () => new Set(columns.map((column) => column.id)),
  );

  return (
    <ReportColumnsMenu
      columns={columns}
      included={included}
      onToggle={(id, next) => {
        setIncluded((prev) => {
          const updated = new Set(prev);
          if (next) updated.add(id);
          else updated.delete(id);
          return updated;
        });
      }}
      onToggleAll={(next) => {
        setIncluded(
          next ? new Set(columns.map((column) => column.id)) : new Set(),
        );
      }}
    />
  );
};

const openSheet = () => {
  fireEvent.click(screen.getByRole('button', { name: /columns/i }));
};

describe('ReportColumnsMenu', () => {
  it('opens a dialog whose list scrolls inside a fixed-height panel', () => {
    render(<Harness />);
    openSheet();

    const dialog = screen.getByRole('dialog', { name: 'Columns' });
    expect(dialog.className).toContain('flex-col');
    expect(dialog.className).toContain('overflow-hidden');
    expect(dialog.className).toContain('h-full');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const list = screen.getByRole('list', { name: 'Columns' });
    expect(list.className).toContain('overflow-y-auto');
    expect(list.className).toContain('min-h-0');
    expect(list.className).toContain('flex-1');
    expect(screen.getAllByRole('checkbox')).toHaveLength(columns.length);
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('filters columns and toggles only the matches', () => {
    render(<Harness />);
    openSheet();

    fireEvent.change(screen.getByRole('textbox', { name: 'Find a column' }), {
      target: { value: 'tour 1' },
    });

    expect(
      screen.getByRole('checkbox', { name: 'Tour 1' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Tour 10' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Shop' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Tour 2' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide matches' }));
    expect(screen.getByRole('checkbox', { name: 'Tour 1' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tour 10' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('checkbox', { name: 'Shop' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tour 1' })).not.toBeChecked();
  });

  it('pins the list in a bottom sheet on a narrow viewport', () => {
    const original = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    try {
      render(<Harness />);
      openSheet();

      const dialog = screen.getByRole('dialog', { name: 'Columns' });
      expect(dialog.className).toContain('rounded-t-2xl');
      expect(dialog.className).toContain('h-[min(92dvh,100%)]');
      expect(dialog.className).toContain('overflow-hidden');
      expect(screen.getByRole('button', { name: 'Done' }).className).toContain(
        'w-full',
      );
    } finally {
      window.matchMedia = original;
    }
  });

  it('moves between columns with arrow keys and closes on escape', () => {
    render(<Harness />);
    openSheet();

    const shop = screen.getByRole('checkbox', { name: 'Shop' });
    shop.focus();
    fireEvent.keyDown(shop, { key: 'ArrowDown' });
    expect(screen.getByRole('checkbox', { name: 'City' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
