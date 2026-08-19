/**
 * @jest-environment jsdom
 *
 * Two things are worth pinning here.
 *
 * What an empty box means: a blank price takes the item off that list, which is
 * not the same as a price of zero. One says "not sold here", the other says
 * "free". Getting it wrong either hides a product or publishes it at nothing.
 *
 * And that nothing saves until Submit. An earlier version wrote each price when
 * the box lost focus, so a price typed by mistake could not be abandoned:
 * closing the dialog kept it, and the only way out was quitting the app.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { InventoryItem } from '@/types';
import type { PriceListSummary } from '@/renderer/hooks/usePublishSettings';
import { ItemPriceLists } from '../ItemPriceLists';
import { changedListPrices } from '../inventoryBulkEdit';

const lists = [
  { id: 1, name: 'Retail' },
  { id: 2, name: 'Wholesale' },
] as unknown as PriceListSummary[];

const row = (listPrices: Record<number, number> = {}) =>
  ({
    id: 7,
    name: 'ITEM-7',
    price: 100,
    listPrices,
  }) as unknown as InventoryItem;

describe('ItemPriceLists', () => {
  it('shows what it is given, and nothing where there is no price', () => {
    render(
      <ItemPriceLists
        priceLists={lists}
        values={{ 1: '810', 2: '' }}
        onChange={jest.fn()}
      />,
    );
    expect((screen.getByLabelText('Retail') as HTMLInputElement).value).toBe(
      '810',
    );
    expect((screen.getByLabelText('Wholesale') as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('reports typing upward instead of saving it', () => {
    const onChange = jest.fn();
    render(
      <ItemPriceLists priceLists={lists} values={{}} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText('Retail'), {
      target: { value: '1800' },
    });
    expect(onChange).toHaveBeenCalledWith(1, '1800');
  });

  it('renders nothing when no price lists are configured', () => {
    const { container } = render(
      <ItemPriceLists priceLists={[]} values={{}} onChange={jest.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('changedListPrices', () => {
  it('sends only what actually changed', () => {
    expect(
      changedListPrices(lists, { 1: '1800', 2: '' }, row({ 1: 810 })),
    ).toEqual([{ priceListId: 1, price: 1800 }]);
  });

  it('sends nothing when the typed values match what is stored', () => {
    expect(
      changedListPrices(lists, { 1: '810', 2: '' }, row({ 1: 810 })),
    ).toEqual([]);
  });

  it('sends null for a cleared price, so the item leaves that list', () => {
    expect(changedListPrices(lists, { 1: '', 2: '' }, row({ 1: 810 }))).toEqual(
      [{ priceListId: 1, price: null }],
    );
  });

  it('treats zero as a real price rather than a removal', () => {
    expect(
      changedListPrices(lists, { 1: '0', 2: '' }, row({ 1: 810 })),
    ).toEqual([{ priceListId: 1, price: 0 }]);
  });

  it('drops text that is not a number rather than sending NaN', () => {
    expect(
      changedListPrices(lists, { 1: 'abc', 2: '' }, row({ 1: 810 })),
    ).toEqual([]);
  });

  it('ignores surrounding whitespace', () => {
    expect(
      changedListPrices(lists, { 1: '  810  ', 2: '' }, row({ 1: 810 })),
    ).toEqual([]);
  });
});
