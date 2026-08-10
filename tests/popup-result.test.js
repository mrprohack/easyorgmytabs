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

  // Preserve-groups result: tell the user existing groups were left untouched.
  stub = makeBrowserChromeStub();
  stub.runtime.sendMessage = async (msg) => {
    if (msg.action === 'PREVIEW') return { status: 'done', count: { duplicates: 0, idle: 0 } };
    if (msg.action === 'ARRANGE_BY_WEBSITE') {
      return {
        status: 'done',
        count: 2,
        result: { status: 'ok', changed: 2, skipped: 3, code: 'PRESERVED_EXISTING_GROUPS' }
      };
    }
    return { status: 'done', count: 0 };
  };
  dom = await loadPopup(stub);
  dom.window.document.getElementById('btn-website').click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(
    dom.window.document.getElementById('status').textContent,
    '2 groups. 3 tabs already grouped and preserved.'
  );
};
