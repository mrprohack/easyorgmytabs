// shortcuts.test.js - popup must reflect Chrome's active command bindings.
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
  await new Promise(resolve => setTimeout(resolve, 20));
  return dom;
}

module.exports = async function main() {
  const stub = makeBrowserChromeStub();
  stub.commands = {
    async getAll() {
      return [
        { name: 'ARRANGE_BY_DATE', shortcut: 'Ctrl+Shift+9' },
        { name: 'ARRANGE_BY_WEBSITE', shortcut: '' },
        { name: 'CLOSE_DUPLICATES', shortcut: 'Alt+Shift+X' },
        { name: 'VIEW_SESSIONS', shortcut: 'Alt+Shift+S' }
      ];
    }
  };

  const dom = await loadPopup(stub);
  const document = dom.window.document;

  // The popup must show what Chrome actually registered, not stale manifest text.
  assert.strictEqual(document.querySelector('#btn-date .shortcut').textContent, 'Ctrl+Shift+9');
  assert.strictEqual(document.querySelector('#btn-website .shortcut').textContent, 'Not assigned');
  assert.ok(document.getElementById('btn-website').classList.contains('shortcut-unassigned'));

  // A missing binding needs an explicit recovery path instead of silently failing.
  const warning = document.getElementById('shortcut-warning');
  assert.ok(warning, 'shortcut warning exists');
  assert.strictEqual(warning.hidden, false);
  assert.match(warning.textContent, /1 keyboard shortcut is not assigned in Chrome/i);

  const settings = document.getElementById('btn-shortcuts-settings');
  assert.ok(settings, 'keyboard-shortcut help button exists');
  settings.click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepStrictEqual(stub._stored._created || [], [], 'shortcut help must not open a blank chrome:// tab');
  assert.strictEqual(
    document.getElementById('status').textContent,
    'Open chrome://extensions/shortcuts in the address bar to assign or change shortcuts.'
  );
};