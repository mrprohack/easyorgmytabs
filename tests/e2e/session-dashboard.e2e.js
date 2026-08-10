// Real Chromium acceptance test for the saved-sessions dashboard UX.
// CI installs Playwright transiently so production stays dependency-light.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0', () => resolve(server.address().port));
  });
}

async function noHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${label} overflows horizontally: ${JSON.stringify(metrics)}`);
}

async function main() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${req.url}</title><h1>${req.url}</h1>`);
  });
  const port = await listen(server);
  const extensionPath = path.resolve(__dirname, '..', '..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyorgmytabs-session-e2e-'));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
    const extensionId = serviceWorker.url().split('/')[2];
    assert.ok(extensionId, 'Manifest V3 service worker exposes an extension id');

    const longTitle = 'A very long saved tab title '.repeat(18).trim();
    const fixture = [
      {
        id: 'e2e-session-one',
        date: '2026-08-09T10:00:00.000Z',
        tabs: [
          { title: 'Alpha workspace', url: `http://127.0.0.1:${port}/alpha` },
          { title: 'Unsafe saved value', url: 'javascript:alert(1)' }
        ]
      },
      {
        id: 'e2e-session-two',
        date: '2026-08-08T12:00:00.000Z',
        tabs: [
          { title: longTitle, url: `http://localhost:${port}/beta` },
          { title: 'Gamma workspace', url: `http://127.0.0.1:${port}/gamma` }
        ]
      }
    ];

    await serviceWorker.evaluate(async (savedSessions) => {
      await chrome.storage.local.set({ savedSessions });
    }, fixture);

    const dashboard = await context.newPage();
    await dashboard.setViewportSize({ width: 1100, height: 820 });
    await dashboard.goto(`chrome-extension://${extensionId}/session.html`);
    await dashboard.waitForFunction(() => document.querySelectorAll('article.session').length === 2);

    assert.strictEqual(await dashboard.locator('#session-count').textContent(), '2 sessions');
    assert.strictEqual(await dashboard.locator('#tab-count').textContent(), '4 tabs');
    await noHorizontalOverflow(dashboard, 'desktop dashboard');

    const cards = dashboard.locator('article.session');
    const firstBox = await cards.nth(0).boundingBox();
    const secondBox = await cards.nth(1).boundingBox();
    assert.ok(firstBox && secondBox, 'desktop session cards have layout boxes');
    assert.ok(Math.abs(firstBox.y - secondBox.y) <= 2, `desktop cards should share a row: ${firstBox.y} vs ${secondBox.y}`);
    assert.ok(Math.abs(firstBox.x - secondBox.x) > 20, 'desktop cards occupy separate columns');

    // Search filters through the real dashboard and Clear restores both cards.
    await dashboard.locator('#search').fill('Gamma workspace');
    await dashboard.waitForTimeout(220);
    assert.strictEqual(await cards.count(), 1);
    assert.strictEqual(await dashboard.locator('#result-summary').textContent(), '1 session · 1 matching tab');
    assert.strictEqual(await dashboard.locator('#clear-search').isVisible(), true);
    await dashboard.locator('#clear-search').click();
    await dashboard.waitForFunction(() => document.querySelectorAll('article.session').length === 2);
    assert.strictEqual(await dashboard.locator('#search').inputValue(), '');

    // Keyboard order follows action hierarchy: search -> primary restore, with a
    // visible focus outline supplied by :focus-visible.
    await dashboard.locator('#search').focus();
    await dashboard.keyboard.press('Tab');
    const focused = await dashboard.evaluate(() => ({
      className: document.activeElement?.className || '',
      text: document.activeElement?.textContent || ''
    }));
    assert.match(focused.className, /btn-session-primary/, `primary restore should follow search in keyboard order: ${JSON.stringify(focused)}`);
    const outlineStyle = await dashboard.locator('.btn-session-primary').first().evaluate(el => getComputedStyle(el).outlineStyle);
    assert.notStrictEqual(outlineStyle, 'none', 'keyboard-focused primary action has a visible focus outline');

    // Restore here opens only the linkable tab from the first session.
    const newPagePromise = context.waitForEvent('page');
    await cards.nth(0).locator('.btn-restore-here').click();
    const restoredPage = await newPagePromise;
    await restoredPage.waitForLoadState('domcontentloaded');
    assert.strictEqual(restoredPage.url(), `http://127.0.0.1:${port}/alpha`);
    assert.strictEqual(await dashboard.locator('#status').textContent(), 'Opened 1 tab in this window.');

    // Delete remains a two-step destructive action.
    const deleteButton = cards.nth(0).locator('.btn-session-delete');
    await deleteButton.click();
    assert.strictEqual(await cards.count(), 2, 'first click only arms delete');
    assert.match(await deleteButton.textContent(), /Confirm delete/);
    await deleteButton.click();
    await dashboard.waitForFunction(() => document.querySelectorAll('article.session').length === 1);
    assert.strictEqual(await dashboard.locator('#session-count').textContent(), '1 session');

    // Narrow viewport stacks cards and long titles never widen the page. Restore
    // the two-card fixture first so the breakpoint can be measured.
    await serviceWorker.evaluate(async (savedSessions) => {
      await chrome.storage.local.set({ savedSessions });
    }, fixture);
    await dashboard.waitForFunction(() => document.querySelectorAll('article.session').length === 2);
    await dashboard.setViewportSize({ width: 360, height: 780 });
    await dashboard.waitForTimeout(100);
    await noHorizontalOverflow(dashboard, '360px dashboard');

    const mobileFirst = await cards.nth(0).boundingBox();
    const mobileSecond = await cards.nth(1).boundingBox();
    assert.ok(mobileFirst && mobileSecond, 'mobile cards have layout boxes');
    assert.ok(mobileSecond.y > mobileFirst.y + 20, 'mobile cards stack into one column');

    const longLink = dashboard.locator('.link').filter({ hasText: 'A very long saved tab title' }).first();
    const longMetrics = await longLink.evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    assert.ok(longMetrics.scrollWidth >= longMetrics.clientWidth, 'long title is constrained inside its row');
    await noHorizontalOverflow(dashboard, 'dashboard after long-title measurement');

    console.log('Chromium session dashboard E2E passed: responsive grid, search, keyboard hierarchy, restore, delete, and overflow safety');
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
