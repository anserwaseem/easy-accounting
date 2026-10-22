/**
 * @jest-environment jsdom
 */
import {
  getPrintEnvironment,
  getPrintHelp,
  getPrintHint,
  type PrintEnvironment,
} from '../mobilePrint';

const setUserAgent = (userAgent: string) => {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  });
};

const setTouchPoints = (maxTouchPoints: number) => {
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  });
};

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const IOS_CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1';
const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

describe('getPrintEnvironment', () => {
  it('reads chrome on android as an android phone with a print api', () => {
    setUserAgent(ANDROID_UA);
    const environment = getPrintEnvironment();
    expect(environment.isAndroid).toBe(true);
    expect(environment.isIos).toBe(false);
    expect(environment.isIosChrome).toBe(false);
    expect(environment.hasPrintApi).toBe(true);
  });

  it('reads chrome on ios as an ios browser whose print api does nothing', () => {
    setUserAgent(IOS_CHROME_UA);
    const environment = getPrintEnvironment();
    expect(environment.isIos).toBe(true);
    expect(environment.isIosChrome).toBe(true);
    expect(environment.isAndroid).toBe(false);
  });

  it('reads safari on ios as ios but not chrome', () => {
    setUserAgent(IOS_SAFARI_UA);
    const environment = getPrintEnvironment();
    expect(environment.isIos).toBe(true);
    expect(environment.isIosChrome).toBe(false);
  });

  it('reads an ipad reporting a mac user agent with touch as an ios device', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    );
    setTouchPoints(5);
    expect(getPrintEnvironment().isIos).toBe(true);
    setTouchPoints(0);
  });
});

describe('getPrintHelp', () => {
  const base: PrintEnvironment = {
    isIos: false,
    isIosChrome: false,
    isAndroid: false,
    isStandalone: false,
    hasPrintApi: true,
  };

  it('sends chrome on ios to the browser share sheet', () => {
    const help = getPrintHelp({ ...base, isIos: true, isIosChrome: true });
    expect(help.title).toMatch(/browser menu/i);
    expect(help.steps.join(' ')).toMatch(/Save to Files/);
  });

  it('tells an android user that the print screen saves the pdf', () => {
    const help = getPrintHelp({ ...base, isAndroid: true });
    expect(help.title).toMatch(/PDF/i);
    expect(help.steps.join(' ')).toMatch(/Save as PDF/);
  });

  it('falls back to the browser print command', () => {
    const help = getPrintHelp(base);
    expect(help.steps.join(' ')).toMatch(/Ctrl\+P|Cmd\+P/);
  });
});

describe('getPrintHint', () => {
  const base: PrintEnvironment = {
    isIos: false,
    isIosChrome: false,
    isAndroid: false,
    isStandalone: false,
    hasPrintApi: true,
  };

  it('has no hint on a desktop, where the print dialog explains itself', () => {
    expect(getPrintHint(base)).toBeNull();
  });

  it('points an android user at the Save as PDF destination', () => {
    expect(getPrintHint({ ...base, isAndroid: true })).toMatch(/Save as PDF/);
  });

  it('warns a chrome on ios user that the page cannot print itself', () => {
    expect(getPrintHint({ ...base, isIos: true, isIosChrome: true })).toMatch(
      /cannot print/i,
    );
  });
});
