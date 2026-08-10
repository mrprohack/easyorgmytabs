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
  await new Promise(r => setTimeout(r, 0));
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

  // Preserve-groups result: tell the user existing manual groups were left untouched.
  stub = makeBrowserChromeStub();
  stub.runtime.sendMessage = async (msg) => {
    if (msg.action === 'PREVIEW') return { status: 'done', count: { duplicates: 0, idle: 0 } };
    if (msg.action === 'GROUPING_STATE') return { status: 'done', count: { mode: null, groupCount: 0, tabCount: 0 } };
    if (msg.action === 'ARRANGE_BY_WEBSITE') {
      return {
        status: 'done',
        count: 2,
        result: {
          status: 'ok', changed: 2, skipped: 3, code: 'PRESERVED_EXISTING_GROUPS',
          mode: 'website', regroupedTabs: 0, manualGroupedTabs: 3
        }
      };
    }
    return { status: 'done', count: 0 };
  };
  dom = await loadPopup(stub);
  dom.window.document.getElementById('btn-website').click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(
    dom.window.document.getElementById('status').textContent,
    'Grouped into 2 groups by Website. 3 manually grouped tabs preserved.'
  );

  // Regroup result makes the switch explicit instead of looking like a no-op.
  stub = makeBrowserChromeStub();
  let activeMode = 'date';
  stub.runtime.sendMessage = async (msg) => {
    if (msg.action === 'PREVIEW') return { status: 'done', count: { duplicates: 0, idle: 0 } };
    if (msg.action === 'GROUPING_STATE') {
      return { status: 'done', count: { mode: activeMode, groupCount: activeMode ? 2 : 0, tabCount: activeMode ? 5 : 0 } };
    }
    if (msg.action === 'ARRANGE_BY_WEBSITE') {
      activeMode = 'website';
      return {
        status: 'done',
        count: 2,
        result: {
          status: 'ok', changed: 2, skipped: 1, code: 'REGROUPED', mode: 'website',
          regroupedTabs: 5, manualGroupedTabs: 1
        }
      };
    }
    return { status: 'done', count: 0 };
  };
  dom = await loadPopup(stub);
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(dom.window.document.getElementById('btn-date').getAttribute('aria-pressed'), 'true');
  assert.ok(dom.window.document.getElementById('btn-date').classList.contains('active-mode'));
  assert.strictEqual(dom.window.document.getElementById('organize-mode').textContent, 'Date active');

  dom.window.document.getElementById('btn-website').click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(
    dom.window.document.getElementById('status').textContent,
    'Regrouped 5 tabs into 2 groups by Website. 1 manually grouped tab preserved.'
  );
  assert.strictEqual(dom.window.document.getElementById('btn-website').getAttribute('aria-pressed'), 'true');
  assert.strictEqual(dom.window.document.getElementById('btn-date').getAttribute('aria-pressed'), 'false');
  assert.strictEqual(dom.window.document.getElementById('organize-mode').textContent, 'Website active');

  // Ungroup organized is visible, sends the dedicated action, and clears active state.
  stub = makeBrowserChromeStub();
  activeMode = 'website';
  const sent = [];
  stub.runtime.sendMessage = async (msg) => {
    sent.push(msg.action);
    if (msg.action === 'PREVIEW') return { status: 'done', count: { duplicates: 0, idle: 0 } };
    if (msg.action === 'GROUPING_STATE') {
      return { status: 'done', count: { mode: activeMode, groupCount: activeMode ? 2 : 0, tabCount: activeMode ? 6 : 0 } };
    }
    if (msg.action === 'UNGROUP_ORGANIZED') {
      activeMode = null;
      return {
        status: 'done', count: 6,
        result: { status: 'ok', changed: 6, skipped: 2, code: 'UNGROUPED_ORGANIZED', mode: null, manualGroupedTabs: 2 }
      };
    }
    return { status: 'done', count: 0 };
  };
  dom = await loadPopup(stub);
  const ungroupBtn = dom.window.document.getElementById('btn-ungroup');
  assert.ok(ungroupBtn, 'Ungroup organized control exists');
  ungroupBtn.click();
  await new Promise(r => setTimeout(r, 10));
  assert.ok(sent.includes('UNGROUP_ORGANIZED'));
  assert.strictEqual(
    dom.window.document.getElementById('status').textContent,
    'Ungrouped 6 organized tabs. 2 manually grouped tabs preserved.'
  );
  assert.strictEqual(dom.window.document.getElementById('organize-mode').textContent, 'Not organized');
  assert.strictEqual(dom.window.document.getElementById('btn-website').getAttribute('aria-pressed'), 'false');
  assert.strictEqual(dom.window.document.getElementById('btn-date').getAttribute('aria-pressed'), 'false');
};
