/**
 * @jest-environment jsdom
 *
 * The panel exists to make the inventory table narrower, and it only achieves
 * that if it lists what an item actually has rather than every attribute that
 * exists. A panel that renders all 14 definitions per row would be the wide
 * grid again, stacked vertically.
 */
import { render, screen } from '@testing-library/react';
import type { AttributeDefinition, InventoryItem } from 'types';
import { ItemDetailPanel } from '../ItemDetailPanel';

const def = (
  key: string,
  label: string,
  extra: Partial<AttributeDefinition> = {},
): AttributeDefinition =>
  ({
    id: 1,
    key,
    label,
    unit: null,
    valueType: 'text',
    sortOrder: 1,
    isActive: 1,
    isPublic: 1,
    ...extra,
  }) as AttributeDefinition;

const item = (overrides: Partial<InventoryItem> = {}): InventoryItem =>
  ({
    id: 1,
    name: 'ITEM-1',
    price: 100,
    quantity: 1,
    attributes: {},
    ...overrides,
  }) as InventoryItem;

describe('ItemDetailPanel', () => {
  it('lists only the attributes the item has a value for', () => {
    render(
      <ItemDetailPanel
        item={item({ attributes: { size: 'A4', colour: '' } })}
        attributeDefs={[
          def('size', 'Paper size'),
          def('colour', 'Colour'),
          def('weight', 'Weight'),
        ]}
      />,
    );

    expect(screen.getByText('Paper size')).toBeTruthy();
    expect(screen.getByText('A4')).toBeTruthy();
    // blank and absent values are both "does not apply", so neither is listed
    expect(screen.queryByText('Colour')).toBeNull();
    expect(screen.queryByText('Weight')).toBeNull();
  });

  it('shows the unit alongside the label when one is defined', () => {
    render(
      <ItemDetailPanel
        item={item({ attributes: { weight: 80 } })}
        attributeDefs={[def('weight', 'Weight', { unit: 'gsm' })]}
      />,
    );

    expect(screen.getByText('Weight (gsm)')).toBeTruthy();
    expect(screen.getByText('80')).toBeTruthy();
  });

  it('renders booleans as words rather than true/false', () => {
    render(
      <ItemDetailPanel
        item={item({ attributes: { laminated: true, zipped: false } })}
        attributeDefs={[
          def('laminated', 'Laminated', { valueType: 'bool' }),
          def('zipped', 'Zipped', { valueType: 'bool' }),
        ]}
      />,
    );

    expect(screen.getByText('Yes')).toBeTruthy();
    // false is a real answer, unlike blank, so it is shown
    expect(screen.getByText('No')).toBeTruthy();
  });

  it('says so plainly when the item has nothing to show', () => {
    render(
      <ItemDetailPanel
        item={item()}
        attributeDefs={[def('size', 'Paper size')]}
      />,
    );

    expect(screen.getByText(/No attributes set for this item/i)).toBeTruthy();
  });
});
