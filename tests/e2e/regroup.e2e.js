// Real Chromium acceptance test for explicit Regroup all behavior and popup layout.
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
    return tabs.map(tab => ({ id: tab.id, url: tab.url, groupId: tab.groupId, pinned: tab.pinned }));
  });
}

async function assertShortcutLayout(popup) {
  const checks = await popup.evaluate(() => {
    const intersects = (a, b) => !(
      a.right <= b.left || b.right <= a.left ||
      a.bottom <= b.top || b.bottom <= a.top
    );

    return [...document.querySelectorAll('.has-shortcut')].map(button => {
      const label = button.querySelector('.action-label');
      const chip = button.querySelector('.shortcut');
      const labelRect = label?.getBoundingClientRect();
      const chipRect = chip?.getBoundingClientRect();
      return {
        id: button.id,
        hasLabel: Boolean(labelRect),
        hasChip: Boolean(chipRect),
        overlap: labelRect && chipRect ? intersects(labelRect, chipRect) : true,
        label: labelRect ? { left: labelRect.left, top: labelRect.top, right: labelRect.right, bottom: labelRect.bottom } : null,
        chip: chipRect ? { left: chipRect.left, top: chipRect.top, right: chipRect.right, bottom: chipRect.bottom } : null
      };
    });
  });

  assert.ok(checks.length >= 4, 'all shortcut-bearing actions are included in the layout check');
  for (const check of checks) {
    assert.ok(check.hasLabel, `${check.id} has an action label`);
    assert.ok(check.hasChip, `${check.id} has a shortcut chip`);
    assert.strictEqual(check.overlap, false, `${check.id} shortcut must not overlap its label: ${JSON.stringify(check)}`);
  }
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
    const pinnedPage = await context.newPage();
    await Promise.all([
      manualPage.goto(`http://127.0.0.1:${port}/manual`),
      alphaPage.goto(`http://127.0.0.1:${port}/alpha`),
      betaPage.goto(`http://localhost:${port}/beta`),
      pinnedPage.goto(`http://127.0.0.1:${port}/pinned`)
    ]);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // A fresh browser profile should receive the four manifest suggestions.
    // The popup must then render Chrome's active values rather than hard-coded text.
    const registeredShortcuts = await popup.evaluate(async () => {
      const commands = await chrome.commands.getAll();
      return Object.fromEntries(commands.map(command => [command.name, command.shortcut || '']));
    });
    assert.strictEqual(registeredShortcuts.ARRANGE_BY_DATE, 'Alt+Shift+D');
    assert.strictEqual(registeredShortcuts.ARRANGE_BY_WEBSITE, 'Alt+Shift+W');
    assert.strictEqual(registeredShortcuts.CLOSE_DUPLICATES, 'Alt+Shift+X');
    assert.strictEqual(registeredShortcuts.VIEW_SESSIONS, 'Alt+Shift+S');
    await popup.waitForFunction(() => document.querySelector('#btn-date .shortcut')?.textContent === 'Alt+Shift+D');
    assert.strictEqual(await popup.locator('#btn-website .shortcut').textContent(), registeredShortcuts.ARRANGE_BY_WEBSITE);
    assert.strictEqual(await popup.locator('#btn-dedupe .shortcut').textContent(), registeredShortcuts.CLOSE_DUPLICATES);
    assert.strictEqual(await popup.locator('#btn-view-sessions .shortcut').textContent(), registeredShortcuts.VIEW_SESSIONS);
    assert.strictEqual(await popup.locator('#shortcut-warning').isHidden(), true, 'fresh-profile shortcuts are all assigned');

    // Chrome action popups are capped at 600px high. Keep the natural content
    // below that so the real toolbar popup does not need vertical scrolling.
    const popupHeight = await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
    assert.ok(popupHeight <= 600, `popup content is ${popupHeight}px high; keep it at or below 600px`);
    await assertShortcutLayout(popup);

    // Pinned tabs are never eligible for organization or ungroup-all behavior.
    await popup.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const target = tabs.find(tab => tab.url === targetUrl);
      if (!target?.id) throw new Error('pinned test tab not found');
      await chrome.tabs.update(target.id, { pinned: true });
    }, `http://127.0.0.1:${port}/pinned`);

    // Create a manual group that the extension did not create.
    const manualGroupId = await popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const manual = tabs.find(tab => tab.url?.includes('/manual'));
      if (!manual?.id) throw new Error('manual test tab not found');
      const groupId = await chrome.tabs.group({ tabIds: [manual.id] });
      await chrome.tabGroups.update(groupId, { title: 'Manual group', color: 'green' });
      return groupId;
    });

    // Default is OFF: organize only currently ungrouped tabs.
    assert.strictEqual(await popup.locator('#regroup-all-toggle').getAttribute('aria-checked'), 'false');
    assert.strictEqual(await popup.locator('#regroup-all-detail').textContent(), 'Only ungrouped tabs');

    await popup.locator('#btn-date').click();
    await waitForAction(popup);
    assert.match(await popup.locator('#status').textContent(), /Grouped into 1 group by Date\./);

    let tabs = await tabSnapshot(popup);
    const manualAfterDate = tabs.find(tab => tab.url?.includes('/manual'));
    const alphaAfterDate = tabs.find(tab => tab.url?.includes('/alpha'));
    const betaAfterDate = tabs.find(tab => tab.url?.includes('/beta'));
    const pinnedAfterDate = tabs.find(tab => tab.url?.includes('/pinned'));
    assert.strictEqual(manualAfterDate.groupId, manualGroupId, 'manual group survives Date while Regroup all is Off');
    assert.ok(alphaAfterDate.groupId >= 0, 'alpha is grouped by date');
    assert.strictEqual(alphaAfterDate.groupId, betaAfterDate.groupId, 'alpha and beta share the date group');
    assert.strictEqual(pinnedAfterDate.groupId, -1, 'pinned tab stays ungrouped');
    assert.strictEqual(pinnedAfterDate.pinned, true, 'pinned tab remains pinned');
    const dateGroupId = alphaAfterDate.groupId;

    // Add a new ungrouped tab after Date organization. Website with Off should
    // organize only this new tab and leave the manual/date groups unchanged.
    const freshPage = await context.newPage();
    await freshPage.goto(`http://127.0.0.1:${port}/fresh`);

    await popup.locator('#btn-website').click();
    await waitForAction(popup);
    const offStatus = await popup.locator('#status').textContent();
    assert.match(offStatus, /Grouped into 1 group by Website\./);
    assert.match(offStatus, /3 grouped tabs left unchanged\./);

    tabs = await tabSnapshot(popup);
    const manualAfterOffWebsite = tabs.find(tab => tab.url?.includes('/manual'));
    const alphaAfterOffWebsite = tabs.find(tab => tab.url?.includes('/alpha'));
    const betaAfterOffWebsite = tabs.find(tab => tab.url?.includes('/beta'));
    const freshAfterOffWebsite = tabs.find(tab => tab.url?.includes('/fresh'));
    const pinnedAfterOffWebsite = tabs.find(tab => tab.url?.includes('/pinned'));
    assert.strictEqual(manualAfterOffWebsite.groupId, manualGroupId, 'manual group is untouched when Off');
    assert.strictEqual(alphaAfterOffWebsite.groupId, dateGroupId, 'existing date group is untouched when Off');
    assert.strictEqual(betaAfterOffWebsite.groupId, dateGroupId, 'existing date group is untouched when Off');
    assert.ok(freshAfterOffWebsite.groupId >= 0, 'new ungrouped tab gets a website group');
    assert.strictEqual(pinnedAfterOffWebsite.groupId, -1, 'pinned tab is still excluded');

    // Turn ON: Website may now intentionally dissolve manual and extension
    // groups in the current window, then rebuild all non-pinned eligible tabs.
    await popup.locator('#regroup-all-toggle').click();
    await popup.waitForFunction(() => document.querySelector('#regroup-all-toggle')?.getAttribute('aria-checked') === 'true');
    assert.strictEqual(await popup.locator('#regroup-all-detail').textContent(), 'Rebuild all groups');

    await popup.locator('#btn-website').click();
    await waitForAction(popup);
    const onStatus = await popup.locator('#status').textContent();
    assert.match(onStatus, /Regrouped 4 tabs into 2 groups by Website\./);

    tabs = await tabSnapshot(popup);
    const manualAfterOnWebsite = tabs.find(tab => tab.url?.includes('/manual'));
    const alphaAfterOnWebsite = tabs.find(tab => tab.url?.includes('/alpha'));
    const betaAfterOnWebsite = tabs.find(tab => tab.url?.includes('/beta'));
    const freshAfterOnWebsite = tabs.find(tab => tab.url?.includes('/fresh'));
    const pinnedAfterOnWebsite = tabs.find(tab => tab.url?.includes('/pinned'));
    assert.notStrictEqual(manualAfterOnWebsite.groupId, manualGroupId, 'manual group is intentionally rebuilt when On');
    assert.ok(manualAfterOnWebsite.groupId >= 0, 'manual tab remains grouped after rebuild');
    assert.strictEqual(manualAfterOnWebsite.groupId, alphaAfterOnWebsite.groupId, 'same host joins the same website group');
    assert.strictEqual(manualAfterOnWebsite.groupId, freshAfterOnWebsite.groupId, 'fresh same-host tab joins the same website group');
    assert.ok(betaAfterOnWebsite.groupId >= 0, 'localhost tab is regrouped');
    assert.notStrictEqual(betaAfterOnWebsite.groupId, manualAfterOnWebsite.groupId, 'different host gets a different website group');
    assert.strictEqual(pinnedAfterOnWebsite.groupId, -1, 'pinned tab remains outside groups after On regroup');
    assert.strictEqual(pinnedAfterOnWebsite.pinned, true);
    assert.strictEqual(await popup.locator('#btn-website').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await popup.locator('#organize-mode').textContent(), 'Website active');

    // Create a brand-new manual/unknown group after the extension regroup. This
    // proves Ungroup all does not depend on the ownership registry.
    const lateManualPage = await context.newPage();
    await lateManualPage.goto(`http://localhost:${port}/late-manual`);
    const lateManualGroupId = await popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const manual = tabs.find(tab => tab.url?.includes('/late-manual'));
      if (!manual?.id) throw new Error('late manual test tab not found');
      const groupId = await chrome.tabs.group({ tabIds: [manual.id] });
      await chrome.tabGroups.update(groupId, { title: 'Late manual group', color: 'red' });
      return groupId;
    });
    assert.ok(lateManualGroupId >= 0, 'late manual group is created outside the extension registry');

    // Ungroup all ignores ownership and removes every non-pinned group in the
    // current window. Pinned tabs stay untouched.
    await popup.locator('#btn-ungroup').click();
    await waitForAction(popup);
    assert.match(await popup.locator('#status').textContent(), /Ungrouped 5 grouped tabs\./);

    tabs = await tabSnapshot(popup);
    for (const marker of ['/manual', '/alpha', '/beta', '/fresh', '/late-manual']) {
      assert.strictEqual(tabs.find(tab => tab.url?.includes(marker)).groupId, -1, `${marker} is ungrouped by Ungroup all`);
    }
    const pinnedAfterUngroup = tabs.find(tab => tab.url?.includes('/pinned'));
    assert.strictEqual(pinnedAfterUngroup.groupId, -1);
    assert.strictEqual(pinnedAfterUngroup.pinned, true, 'pinned tab remains pinned after Ungroup all');
    assert.strictEqual(await popup.locator('#organize-mode').textContent(), 'Not organized');

    // Recheck layout after state/copy changes so active/toggle styling cannot
    // reintroduce the shortcut overlap from the reported screenshot.
    await assertShortcutLayout(popup);
    const finalHeight = await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
    assert.ok(finalHeight <= 600, `final popup content is ${finalHeight}px high; keep it at or below 600px`);

    // The recovery button uses the same tabs.create route. Verify Chromium allows
    // this internal page so users with a collision can repair the binding.
    const shortcutSettingsTab = await popup.evaluate(async () => {
      const tab = await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      return { id: tab.id, url: tab.url };
    });
    assert.strictEqual(shortcutSettingsTab.url, 'chrome://extensions/shortcuts');
    if (shortcutSettingsTab.id !== undefined) {
      await popup.evaluate(tabId => chrome.tabs.remove(tabId), shortcutSettingsTab.id);
    }

    console.log(`Chromium E2E passed: Regroup Off -> On -> Ungroup all; active shortcuts verified; popup ${finalHeight}px high`);
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
