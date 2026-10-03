import { test, expect } from '@playwright/test';

/**
 * Real Chromium, ES2022 async/await (vite build target). A transaction
 * does several awaited driver calls while a second RPC is already queued.
 * The second RPC must stay pending until the transaction rolls back, and
 * its insert must survive that rollback.
 *
 * Jest cannot see this: the root tsconfig downlevels async to Promise
 * chains, which hid a `Promise#then` ownership bug.
 */
test('transaction awaits do not deadlock and do not swallow a pending RPC', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => window.easyAccounting.ready);

  const result = await page.evaluate(async () => {
    const { debug } = window.easyAccounting;
    let holdAt = 0;
    let probeAt = 0;
    const holdPromise = debug('debug:txHold').then((value) => {
      holdAt = Date.now();
      return value as { innerCount: number };
    });
    const probePromise = debug('debug:txProbe').then((value) => {
      probeAt = Date.now();
      return value as { count: number };
    });
    const hold = await holdPromise;
    const probe = await probePromise;
    return { hold, probe, probeAfterHold: probeAt >= holdAt };
  });

  expect(result.hold.innerCount).toBe(1);
  expect(result.probe.count).toBe(1);
  expect(result.probeAfterHold).toBe(true);
});
