/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { DateCell } from '../DateCell';

describe('DateCell', () => {
  it('shows the app-wide date format', () => {
    render(<DateCell value="2026-02-03" />);
    expect(screen.getByText('03 Feb, 2026')).toBeInTheDocument();
  });

  it('carries the full date with hour and minute as the hover title', () => {
    render(<DateCell value="2026-02-03 14:05:09" />);
    expect(screen.getByTitle('03 Feb, 2026, 02:05 PM')).toBeInTheDocument();
  });

  it('shows the fallback and no title when there is no date', () => {
    const { container } = render(<DateCell value={null} fallback="—" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('omits the title for an unparseable value but keeps it visible', () => {
    const { container } = render(<DateCell value="not a date" />);
    expect(screen.getByText('not a date')).toBeInTheDocument();
    expect(container.querySelector('[title]')).toBeNull();
  });
});
