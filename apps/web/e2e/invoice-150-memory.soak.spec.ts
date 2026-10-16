import { test, expect } from 'playwright-soak-test';
import type { Page, CDPSession } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PASSWORD = 'e2e-soak-password';

async function registerAndLogin(page: Page, username: string) {
  await page.goto('/');
  await page.evaluate(
    async ({ username: u, password }) => {
      const ok = await window.easyAccounting.api.register({
        username: u,
        password,
      });
      if (!ok) throw new Error('setup register() returned false');
    },
    { username, password: PASSWORD },
  );
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
  await page.locator('input[placeholder="Username"]').fill(username);
  await page.locator('input[placeholder="Password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 15_000 });
}

interface SnapshotAnalysis {
  counts: Record<string, number>;
  sizes: Record<string, number>;
}

function parseSnapshot(filePath: string): SnapshotAnalysis {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const { strings, nodes } = data;
  const nodeFields: string[] = data.snapshot.meta.node_fields;
  const nodeFieldCount = nodeFields.length;

  const typeOffset = nodeFields.indexOf('type');
  const nameOffset = nodeFields.indexOf('name');
  const sizeOffset = nodeFields.indexOf('self_size');

  const nodeTypes: string[] = data.snapshot.meta.node_types[typeOffset];

  const counts: Record<string, number> = {};
  const sizes: Record<string, number> = {};

  for (let i = 0; i < nodes.length; i += nodeFieldCount) {
    const typeIdx = nodes[i + typeOffset];
    const typeName = nodeTypes[typeIdx];
    const nameIdx = nodes[i + nameOffset];
    const name = typeof nameIdx === 'number' ? strings[nameIdx] : nameIdx;
    const size = nodes[i + sizeOffset];

    if (
      typeName === 'string' ||
      typeName === 'number' ||
      typeName === 'array'
    ) {
      continue;
    }

    const key = `${typeName}::${name}`;
    counts[key] = (counts[key] || 0) + 1;
    sizes[key] = (sizes[key] || 0) + size;
  }
  return { counts, sizes };
}

async function captureHeapSnapshot(
  client: CDPSession,
  filePath: string,
): Promise<void> {
  await client.send('HeapProfiler.enable');
  await client.send('HeapProfiler.collectGarbage');
  await client.send('HeapProfiler.collectGarbage');

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const writeStream = fs.createWriteStream(filePath, 'utf8');
  const chunkHandler = (params: { chunk: string }) => {
    writeStream.write(params.chunk);
  };
  client.on('HeapProfiler.addHeapSnapshotChunk', chunkHandler);

  await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  client.off('HeapProfiler.addHeapSnapshotChunk', chunkHandler);

  writeStream.end();
  await new Promise<void>((resolve, reject) => {
    writeStream.on('finish', () => resolve());
    writeStream.on('error', reject);
  });
}

test.describe('150-Item Invoice Multi-Cycle Memory Soak & Retainer Diagnostics', () => {
  test.use({
    soakOptions: {
      clock: false,
    },
  });

  test.setTimeout(300_000); // 5 minutes for 20 deep cycles with snapshot diffing

  test('20-cycle mount, edit, mutate, and unmount soak on 150-item invoice with heap snapshot analysis', async ({
    page,
  }, testInfo) => {
    const username = `inv150-soak-${Date.now()}`;
    await registerAndLogin(page, username);

    // 1. Seed 150 items and source invoice in single fast transaction
    const seedResult = await page.evaluate(async () => {
      return (await window.easyAccounting.debug(
        'debug:seed150InvoiceFixtures',
      )) as { invoiceId: number; totalAmount: number; itemCount: number };
    });

    expect(seedResult.itemCount).toBe(150);
    const invoiceId = seedResult.invoiceId;

    // 2. Setup CDP session for precision GC and Chrome DevTools heap snapshots
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');

    const snapshotsDir = path.join(testInfo.outputDir, 'heapsnapshots');
    const baselineSnapshotPath = path.join(
      snapshotsDir,
      'baseline-150-invoice.heapsnapshot',
    );
    const targetSnapshotPath = path.join(
      snapshotsDir,
      'target-150-invoice.heapsnapshot',
    );

    // Initial navigation to Sale Invoices list
    await page
      .getByRole('link', { name: 'Sale Invoices', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Sale Invoices' }),
    ).toBeVisible({ timeout: 15_000 });

    // Helper to perform a single mount, mutate, unmount cycle
    const runCycle = async (cycleNum: number) => {
      // Step A: Click Duplicate invoice on the 150-item row
      const duplicateBtn = page
        .getByRole('button', { name: 'Duplicate invoice' })
        .first();
      await expect(duplicateBtn).toBeVisible({ timeout: 15_000 });
      await duplicateBtn.click();

      // Step B: Wait for New Sale Invoice form to mount full RHF & Virtuoso table
      await expect(
        page.getByRole('heading', { name: 'New Sale Invoice' }),
      ).toBeVisible({ timeout: 15_000 });

      // Verify row 0 is loaded
      const row0Qty = page
        .locator('tbody tr[data-index="0"]')
        .locator('input[type="number"]');
      await expect(row0Qty).toBeVisible({ timeout: 10_000 });

      // Step C: Mutate row 0 quantity to trigger watchers and recalculations
      await row0Qty.fill(String(30 + (cycleNum % 10)));
      await row0Qty.press('Tab');
      await page.waitForTimeout(50);

      // Step D: Cancel to trigger complete form unmount & teardown
      const cancelBtn = page.getByRole('button', {
        name: 'Cancel',
        exact: true,
      });
      await expect(cancelBtn).toBeVisible();
      await cancelBtn.click();

      const discardBtn = page.getByRole('button', { name: 'Discard' });
      if (await discardBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await discardBtn.click();
      }

      // Ensure we navigate back to Sale Invoices list
      await expect(
        page.getByRole('heading', { name: 'Sale Invoices' }),
      ).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(50);
    };

    // 3. Warmup passes (3 cycles to warm JIT, caches, and component modules)
    console.log('Running 3 warmup cycles...');
    for (let w = 1; w <= 3; w++) {
      await runCycle(w);
    }

    // Force GC and take Baseline Snapshot
    console.log('Taking Baseline Heap Snapshot...');
    await captureHeapSnapshot(client, baselineSnapshotPath);
    const baselineMetrics = await client.send('Performance.getMetrics');
    const getMetric = (
      name: string,
      metrics: { metrics: Array<{ name: string; value: number }> },
    ) => metrics.metrics.find((m) => m.name === name)?.value || 0;

    const baseHeap = getMetric('JSHeapUsedSize', baselineMetrics);
    const baseNodes = getMetric('Nodes', baselineMetrics);
    const baseListeners = getMetric('JSEventListeners', baselineMetrics);
    console.log(
      `Baseline after warmup: Heap=${(baseHeap / 1024 / 1024).toFixed(
        2,
      )} MB, Nodes=${baseNodes}, Listeners=${baseListeners}`,
    );

    // 4. Run 20 cycles
    console.log('Running 20 soak cycles...');
    const samples: Array<{
      pass: number;
      heapMb: number;
      nodes: number;
      listeners: number;
    }> = [];

    for (let cycle = 1; cycle <= 20; cycle++) {
      const startCycleTime = Date.now();
      await runCycle(cycle);

      // Collect GC and sample every 5 passes
      if (cycle % 5 === 0 || cycle === 20) {
        await client.send('HeapProfiler.collectGarbage');
        const cycleMetrics = await client.send('Performance.getMetrics');
        const h = getMetric('JSHeapUsedSize', cycleMetrics);
        const n = getMetric('Nodes', cycleMetrics);
        const l = getMetric('JSEventListeners', cycleMetrics);
        samples.push({
          pass: cycle,
          heapMb: Number((h / 1024 / 1024).toFixed(2)),
          nodes: n,
          listeners: l,
        });
        console.log(
          `Pass ${cycle}/20 (${Date.now() - startCycleTime}ms): Heap=${(
            h /
            1024 /
            1024
          ).toFixed(2)} MB (${(((h - baseHeap) / baseHeap) * 100).toFixed(
            1,
          )}%), Nodes=${n} (Δ${n - baseNodes}), Listeners=${l} (Δ${
            l - baseListeners
          })`,
        );
      }
    }

    // 5. Force GC and capture Target Snapshot
    console.log('Taking Target Heap Snapshot after 20 passes...');
    await captureHeapSnapshot(client, targetSnapshotPath);
    const finalMetrics = await client.send('Performance.getMetrics');
    const finalHeap = getMetric('JSHeapUsedSize', finalMetrics);
    const finalNodes = getMetric('Nodes', finalMetrics);
    const finalListeners = getMetric('JSEventListeners', finalMetrics);

    const heapDriftPercent = ((finalHeap - baseHeap) / baseHeap) * 100;
    const nodeDrift = finalNodes - baseNodes;
    const listenerDrift = finalListeners - baseListeners;

    console.log(
      '\n============================================================',
    );
    console.log('20-CYCLE 150-ITEM INVOICE MEMORY SOAK SUMMARY');
    console.log('============================================================');
    console.log(
      `Baseline Heap:      ${(baseHeap / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(
      `Final Heap:         ${(finalHeap / 1024 / 1024).toFixed(2)} MB (Δ ${
        heapDriftPercent >= 0 ? '+' : ''
      }${heapDriftPercent.toFixed(2)}%)`,
    );
    console.log(`DOM Node Delta:     ${nodeDrift >= 0 ? '+' : ''}${nodeDrift}`);
    console.log(
      `EventListener Delta: ${listenerDrift >= 0 ? '+' : ''}${listenerDrift}`,
    );
    console.log('------------------------------------------------------------');

    // 6. Diff Baseline vs Target Snapshots
    console.log('\nAnalyzing Heap Snapshot Retainers & Diff...');
    const snap1 = parseSnapshot(baselineSnapshotPath);
    const snap2 = parseSnapshot(targetSnapshotPath);

    const diffs: Array<{ key: string; countDiff: number; sizeDiff: number }> =
      [];
    for (const key of Object.keys(snap2.counts)) {
      const count1 = snap1.counts[key] || 0;
      const count2 = snap2.counts[key];
      const size1 = snap1.sizes[key] || 0;
      const size2 = snap2.sizes[key];

      if (count2 > count1) {
        diffs.push({
          key,
          countDiff: count2 - count1,
          sizeDiff: size2 - size1,
        });
      }
    }

    diffs.sort((a, b) => b.sizeDiff - a.sizeDiff);

    console.log('\n--- Top 15 Growing Objects by Retained Size ---');
    diffs.slice(0, 15).forEach((d, idx) => {
      console.log(
        `${String(idx + 1).padStart(2, ' ')}. ${d.key}: +${
          d.countDiff
        } objects, +${(d.sizeDiff / 1024).toFixed(1)} KB`,
      );
    });

    const commonLeaks = diffs.filter(
      (d) =>
        d.key.toLowerCase().includes('detached') ||
        d.key.toLowerCase().includes('eventlistener') ||
        d.key.toLowerCase().includes('closure') ||
        d.key.toLowerCase().includes('context') ||
        d.key.toLowerCase().includes('fiber') ||
        d.key.toLowerCase().includes('subscription'),
    );

    commonLeaks.sort((a, b) => b.countDiff - a.countDiff);

    console.log(
      '\n--- Retained Leak Indicators (Detached DOM, Closures, Listeners) ---',
    );
    if (commonLeaks.length === 0) {
      console.log(
        'No detached DOM nodes or unexpected closure leaks detected.',
      );
    } else {
      commonLeaks.slice(0, 10).forEach((d) => {
        console.log(
          `  * ${d.key}: +${d.countDiff} items (+${(d.sizeDiff / 1024).toFixed(
            1,
          )} KB)`,
        );
      });
    }
    console.log(
      '============================================================\n',
    );

    // 7. Soak Assertions:
    // Listeners must be strictly 0 growth (no lingering global/window listeners)
    expect(listenerDrift).toBeLessThanOrEqual(0);
    // Nodes must not grow unbounded across 20 passes (max 50 for caching/router history)
    expect(nodeDrift).toBeLessThanOrEqual(50);
  });
});
