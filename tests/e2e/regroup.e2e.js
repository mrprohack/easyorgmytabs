// Real Chromium acceptance test for the smart regroup workflow.
// CI installs Playwright transiently so the production package stays dependency-light.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => resolve(server.address().port));
  });
}

async function waitForAction(page) {
  await page.waitForFunction(() => {
    const text = document.getElementById('status')?.textContent || '';
    return text && text !== 'Working…';
  });
}

async function tabSnapshot(page) {
  return page.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.map(tab => ({ id: tab.id, url: tab.url, groupId: tab.groupId }));
  });
}

async function main() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${req.url}</title><h1>${req.url}</h1>`);
  });
  const port = await listen(server);
  const extensionPath = path.resolve(__dirname, '..', '..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyorgmytabs-e2e-'));

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

    const manualPage = await context.newPage();
    const alphaPage = await context.newPage();
    const betaPage = await context.newPage();
    await Promise.all([
      manualPage.goto(`http://127.0.0.1:${port}/manual`),
      alphaPage.goto(`http://127.0.0.1:${port}/alpha`),
      betaPage.goto(`http://localhost:${port}/beta`)
    ]);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // Chrome action popups are capped at 600px high. Keep the natural content
    // below that so the real toolbar popup does not need vertical scrolling.
    const popupHeight = await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
    assert.ok(popupHeight <= 600, `popup content is ${popupHeight}px high; keep it at or below 600px`);

    const manualGroupId = await popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const manual = tabs.find(tab => tab.url?.includes('/manual'));
      if (!manual?.id) throw new Error('manual test tab not found');
      const groupId = await chrome.tabs.group({ tabIds: [manual.id] });
      await chrome.tabGroups.update(groupId, { title: 'Manual group', color: 'green' });
      return groupId;
    });

    // First organize by date. Alpha + beta should become one owned date group.
    await popup.locator('#btn-date').click();
    await waitForAction(popup);
    assert.match(await popup.locator('#status').textContent(), /Grouped into 1 group by Date\./);

    let tabs = await tabSnapshot(popup);
    const manualAfterDate = tabs.find(tab => tab.url?.includes('/manual'));
    const alphaAfterDate = tabs.find(tab => tab.url?.includes('/alpha'));
    const betaAfterDate = tabs.find(tab => tab.url?.includes('/beta'));
    assert.strictEqual(manualAfterDate.groupId, manualGroupId, 'manual group survives date organization');
    assert.ok(alphaAfterDate.groupId >= 0, 'alpha is grouped by date');
    assert.strictEqual(alphaAfterDate.groupId, betaAfterDate.groupId, 'alpha and beta share the date group');

    // The original bug: switching to Website must now replace the owned date group.
    await popup.locator('#btn-website').click();
    await waitForAction(popup);
    const websiteStatus = await popup.locator('#status').textContent();
    assert.match(websiteStatus, /Regrouped 2 tabs into 2 groups by Website\./);
    assert.match(websiteStatus, /1 manually grouped tab preserved\./);

    tabs = await tabSnapshot(popup);
    const manualAfterWebsite = tabs.find(tab => tab.url?.includes('/manual'));
    const alphaAfterWebsite = tabs.find(tab => tab.url?.includes('/alpha'));
    const betaAfterWebsite = tabs.find(tab => tab.url?.includes('/beta'));
    assert.strictEqual(manualAfterWebsite.groupId, manualGroupId, 'manual group survives website regroup');
    assert.ok(alphaAfterWebsite.groupId >= 0 && betaAfterWebsite.groupId >= 0, 'regrouped tabs remain grouped');
    assert.notStrictEqual(alphaAfterWebsite.groupId, betaAfterWebsite.groupId, 'different hosts get different website groups');
    assert.strictEqual(await popup.locator('#btn-website').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await popup.locator('#organize-mode').textContent(), 'Website active');

    // Explicit Ungroup removes only groups owned by Tab Organizer Pro.
    await popup.locator('#btn-ungroup').click();
    await waitForAction(popup);
    assert.match(await popup.locator('#status').textContent(), /Ungrouped 2 organized tabs\./);

    tabs = await tabSnapshot(popup);
    const manualAfterUngroup = tabs.find(tab => tab.url?.includes('/manual'));
    const alphaAfterUngroup = tabs.find(tab => tab.url?.includes('/alpha'));
    const betaAfterUngroup = tabs.find(tab => tab.url?.includes('/beta'));
    assert.strictEqual(manualAfterUngroup.groupId, manualGroupId, 'manual group survives explicit ungroup');
    assert.strictEqual(alphaAfterUngroup.groupId, -1, 'alpha owned group is removed');
    assert.strictEqual(betaAfterUngroup.groupId, -1, 'beta owned group is removed');
    assert.strictEqual(await popup.locator('#organize-mode').textContent(), 'Not organized');

    console.log(`Chromium E2E passed: Date -> Website -> Ungroup, manual group preserved; popup ${popupHeight}px high`);
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
