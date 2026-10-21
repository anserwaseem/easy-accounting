import {
  ADVANCED_CAPABILITIES,
  ADVANCED_CAPABILITIES_STORE_KEY,
  ADVANCED_CAPABILITY_ERROR_MARKER,
} from '../../../core/advancedCapabilities';

jest.mock('../../store', () => {
  const values = new Map<string, unknown>();
  return {
    store: {
      get: jest.fn((key: string) => values.get(key)),
      set: jest.fn((key: string, value: unknown) => {
        values.set(key, value);
      }),
      __values: values,
    },
  };
});

// eslint-disable-next-line import/first
import {
  getEnabledAdvancedCapabilities,
  requireAdvancedCapability,
  setEnabledAdvancedCapabilities,
} from '../advancedCapabilities';

// eslint-disable-next-line import/first
import { store } from '../../store';

const storeValues = (store as unknown as { __values: Map<string, unknown> })
  .__values;

describe('advanced capabilities store', () => {
  beforeEach(() => {
    storeValues.clear();
    (store.get as jest.Mock).mockClear();
    (store.set as jest.Mock).mockClear();
  });

  it('starts with nothing enabled', () => {
    expect(getEnabledAdvancedCapabilities().size).toBe(0);
  });

  it('round-trips the enabled set', () => {
    setEnabledAdvancedCapabilities([ADVANCED_CAPABILITIES.journalReverse]);
    expect(store.set).toHaveBeenCalledWith(ADVANCED_CAPABILITIES_STORE_KEY, [
      ADVANCED_CAPABILITIES.journalReverse,
    ]);
    expect(
      getEnabledAdvancedCapabilities().has(
        ADVANCED_CAPABILITIES.journalReverse,
      ),
    ).toBe(true);
  });

  it('throws from the guard when the capability is off', () => {
    expect(() =>
      requireAdvancedCapability(ADVANCED_CAPABILITIES.accountDelete),
    ).toThrow(/advanced control/i);
  });

  it('does not throw from the guard when the capability is on', () => {
    setEnabledAdvancedCapabilities([ADVANCED_CAPABILITIES.accountDelete]);
    expect(() =>
      requireAdvancedCapability(ADVANCED_CAPABILITIES.accountDelete),
    ).not.toThrow();
  });

  it('names the action so the message points somewhere useful', () => {
    // the capability id means nothing to a shop owner, the label does
    expect(() =>
      requireAdvancedCapability(ADVANCED_CAPABILITIES.inventoryDelete),
    ).toThrow(/Delete an inventory item/);
    expect(() =>
      requireAdvancedCapability(ADVANCED_CAPABILITIES.inventoryDelete),
    ).toThrow(/Settings/);
  });

  it('carries the marker the renderer recognizes', () => {
    // the renderer turns the refusal into a message the person can act
    // on, and it finds it by this marker
    expect(() =>
      requireAdvancedCapability(ADVANCED_CAPABILITIES.inventoryDelete),
    ).toThrow(ADVANCED_CAPABILITY_ERROR_MARKER);
  });
});
