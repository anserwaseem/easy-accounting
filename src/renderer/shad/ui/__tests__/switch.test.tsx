/**
 * @jest-environment jsdom
 */
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Switch } from '../switch';

describe('Switch component', () => {
  it('renders unchecked by default', () => {
    const { getByRole } = render(<Switch />);
    const switchEl = getByRole('switch');
    expect(switchEl).toHaveAttribute('aria-checked', 'false');
    expect(switchEl).toHaveAttribute('data-state', 'unchecked');
  });

  it('renders checked when specified', () => {
    const { getByRole } = render(<Switch checked />);
    const switchEl = getByRole('switch');
    expect(switchEl).toHaveAttribute('aria-checked', 'true');
    expect(switchEl).toHaveAttribute('data-state', 'checked');
  });

  it('calls onCheckedChange when clicked', () => {
    const onCheckedChange = jest.fn();
    const { getByRole } = render(
      <Switch checked={false} onCheckedChange={onCheckedChange} />,
    );
    fireEvent.click(getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('does not fire when disabled', () => {
    const onCheckedChange = jest.fn();
    const { getByRole } = render(
      <Switch checked={false} disabled onCheckedChange={onCheckedChange} />,
    );
    fireEvent.click(getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('toggles on space and enter keys', () => {
    const onCheckedChange = jest.fn();
    const { getByRole } = render(
      <Switch checked={false} onCheckedChange={onCheckedChange} />,
    );
    const switchEl = getByRole('switch');
    fireEvent.keyDown(switchEl, { key: ' ' });
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    fireEvent.keyDown(switchEl, { key: 'Enter' });
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });
});
