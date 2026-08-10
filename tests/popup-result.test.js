// popup-result.test.js - structured background results must be visible to users.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeBrowserChromeStub } = require('./helpers/chrome-stub.js');

const ROOT = path.join(__dirname, '..');

async function loadPopup(stub) {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8'), {
    url: 'chrome-extension://test/',
    runScripts: 'outside-only',
    beforeParse(window) { window.chrome = stub; }
  });
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'logic.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 10));
  return dom;
}

module.exports = async function main() {
  // Session cap: show both what was saved and what was skipped.
  let stub = makeBrowserChromeStub();
  stub.runtime.sendMessage = async (msg) => {
    if (msg.action === 'PREVIEW') return { status: 'done', count: { duplicates: 0, idle: 0 } };
    if (msg.action === 'GROUPING_STATE') return { status: 'done', count: { mode: null, groupCount: 0, tabCount: 0 } };
    if (msg.action === 'SAVE_SESSION') {
      return {
        status: 'done',
        count: 200,
        result: { status: 'partial', changed: 200, skipped: 50, code: 'SESSION_CAP' }
      };
    }
    return { status: 'done', count: 0 };
  };
  let dom = await loadPopup(stub);
  dom.window.document.getElementById('btn-session').click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(
    dom.window.document.getElementById('status').textContent,
    '200 tabs saved. 50 tabs skipped (session limit).'
  );

  // Regroup all defaults Off and Date/Website sends that explicit preference.
  stub = makeBrowserChromeStub();
  const sent = [];
  stub.runtime.sendMessage = async (msg) => {
    sent.push(msg);
    if (msg.action === 'PREVIEW') return { status: 'done', count: { duplicates: 0, idle: 0 } };
    if (msg.action === 'GROUPING_STATE') return { status: 'done', count: { mode: null, groupCount: 0, tabCount: 0 } };
    if (msg.action === 'ARRANGE_BY_WEBSITE') {
      return {
        status: 'done', count: 2,
        result: {
          status: 'ok', changed: 2, skipped: 3, code: 'PRESERVED_EXISTING_GROUPS',
          mode: 'website', regroupAll: false, regroupedTabs: 0,
          preservedGroupedTabs: 3, pinnedGroupedTabs: 0
        }
      };
    }
    return { status: 'done', count: 0 };
  };
  dom = await loadPopup(stub);
  const toggle = dom.window.document.getElementById('regroup-all-toggle');
  assert.ok(toggle, 'Regroup all toggle exists');
  assert.strictEqual(toggle.getAttribute('role'), 'switch');
  assert.strictEqual(toggle.getAttribute('aria-checked'), 'false');
  assert.strictEqual(dom.window.document.getElementById('regroup-all-detail').textContent, 'Only ungrouped tabs');

  dom.window.document.getElementById('btn-website').click();
  await new Promise(r => setTimeout(r, 10));
  const websiteMessage = sent.find(m => m.action === 'ARRANGE_BY_WEBSITE');
  assert.deepStrictEqual(websiteMessage, { action: 'ARRANGE_BY_WEBSITE', regroupAll: false });
  assert.strictEqual(
    dom.window.document.getElementById('status').textContent,
    'Grouped into 2 groups by Website. 3 grouped tabs left unchanged.'
  );

  // Persisted On state is restored, can be toggled, and is sent with organize actions.
  stub = makeBrowserChromeStub({ regroupAll: true });
  const sentOn = [];
  stub.runtime.sendMessage = async (msg) => {
    sentOn.push(msg);
    if (msg.action === 'PREVIEW') return { status: 'done', count: { duplicates: 0, idle: 0 } };
    if (msg.action === 'GROUPING_STATE') return { status: 'done', count: { mode: 'website', groupCount: 2, tabCount: 5 } };
    if (msg.action === 'ARRANGE_BY_DATE') {
      return {
        status: 'done', count: 1,
        result: {
          status: 'ok', changed: 1, skipped: 0, code: 'REGROUPED_ALL',
          mode: 'date', regroupAll: true, regroupedTabs: 5,
          preservedGroupedTabs: 0, pinnedGroupedTabs: 0
        }
      };
    }
    return { status: 'done', count: 0 };
  };
  dom = await loadPopup(stub);
  const onToggle = dom.window.document.getElementById('regroup-all-toggle');
  assert.strictEqual(onToggle.getAttribute('aria-checked'), 'true');
  assert.strictEqual(dom.window.document.getElementById('regroup-all-detail').textContent, 'Rebuild all groups');

  dom.window.document.getElementById('btn-date').click();
  await new Promise(r => setTimeout(r, 10));
  const dateMessage = sentOn.find(m => m.action === 'ARRANGE_BY_DATE');
  assert.deepStrictEqual(dateMessage, { action: 'ARRANGE_BY_DATE', regroupAll: true });
  assert.strictEqual(
    dom.window.document.getElementById('status').textContent,
    'Regrouped 5 tabs into 1 group by Date.'
  );

  onToggle.click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(onToggle.getAttribute('aria-checked'), 'false');
  assert.strictEqual(stub._syncStored.regroupAll, false, 'toggle persists to chrome.storage.sync');

  // Ungroup all sends the ownership-independent action and reports pinned exclusions.
  stub = makeBrowserChromeStub();
  const ungroupSent = [];
  stub.runtime.sendMessage = async (msg) => {
    ungroupSent.push(msg);
    if (msg.action === 'PREVIEW') return { status: 'done', count: { duplicates: 0, idle: 0 } };
    if (msg.action === 'GROUPING_STATE') return { status: 'done', count: { mode: null, groupCount: 0, tabCount: 0 } };
    if (msg.action === 'UNGROUP_ALL') {
      return {
        status: 'done', count: 6,
        result: { status: 'ok', changed: 6, skipped: 1, code: 'UNGROUPED_ALL', mode: null, pinnedGroupedTabs: 1 }
      };
    }
    return { status: 'done', count: 0 };
  };
  dom = await loadPopup(stub);
  const ungroupBtn = dom.window.document.getElementById('btn-ungroup');
  assert.ok(ungroupBtn, 'Ungroup all control exists');
  assert.match(ungroupBtn.textContent, /Ungroup all/);
  ungroupBtn.click();
  await new Promise(r => setTimeout(r, 10));
  assert.ok(ungroupSent.some(m => m.action === 'UNGROUP_ALL'));
  assert.strictEqual(
    dom.window.document.getElementById('status').textContent,
    'Ungrouped 6 grouped tabs. 1 pinned grouped tab left unchanged.'
  );
};
