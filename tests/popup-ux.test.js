// popup-ux.test.js - three-step popup structure, preview badges, status tones.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeBrowserChromeStub } = require('./helpers/chrome-stub.js');

const ROOT = path.join(__dirname, '..');
const src = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

async function loadPopup(stub, { errorReport = false } = {}) {
  const dom = new JSDOM(src('popup.html'), {
    url: 'chrome-extension://test/',
    runScripts: 'outside-only',
    beforeParse(window) { window.chrome = stub; }
  });
  if (errorReport) dom.window.eval(src('error-report.js'));
  dom.window.eval(src('logic.js'));
  dom.window.eval(src('popup.js'));
  await tick();
  return dom;
}

// A stub whose PREVIEW reply is chosen by the test; every other action answers `others`.
function stubWith(preview, others = { status: 'done', count: 0 }) {
  const stub = makeBrowserChromeStub();
  const sent = [];
  stub.runtime.sendMessage = async (msg) => {
    sent.push(msg);
    if (msg.action === 'PREVIEW') return typeof preview === 'function' ? preview(sent) : preview;
    if (msg.action === 'GROUPING_STATE') return { status: 'done', count: { mode: null, groupCount: 0, tabCount: 0 } };
    return typeof others === 'function' ? others(msg) : others;
  };
  return { stub, sent };
}

const classes = (el) => ({ success: el.classList.contains('is-success'), error: el.classList.contains('error') });

module.exports = async function main() {
  // structure: three numbered sections with honest scope labels
  let { stub } = stubWith({ status: 'done', count: { duplicates: 0, idle: 0 } });
  let dom = await loadPopup(stub);
  let document = dom.window.document;
  assert.strictEqual(document.querySelectorAll('section.popup-section').length, 3);
  assert.deepStrictEqual([...document.querySelectorAll('.step-badge')].map(n => n.textContent), ['1', '2', '3']);
  assert.deepStrictEqual([...document.querySelectorAll('.scope-chip')].map(n => n.textContent), ['This window', 'This window']);
  assert.deepStrictEqual([...document.querySelectorAll('.section-heading h2')].map(n => n.textContent), ['Organize', 'Clean up', 'Save']);
  for (const [id, label] of [['btn-dedupe', 'Close Duplicates'], ['btn-sleep', 'Sleep Idle Tabs'], ['btn-undo', 'Undo Close'], ['btn-session', 'Save Session'], ['btn-view-sessions', 'Saved Sessions']]) {
    assert.strictEqual(document.querySelector(`#${id} .action-label`).textContent, label);
  }
  assert.strictEqual(document.querySelector('#btn-undo .tool-hint').textContent, 'Any window');
  assert.strictEqual(document.querySelector('button #sleep-hours'), null, 'the threshold input is not nested inside a button');
  assert.ok(document.getElementById('sleep-hours').getAttribute('aria-label'));
  assert.ok(document.querySelector('.popup-header #btn-shortcuts-settings'), 'shortcuts link lives in the header');
  assert.strictEqual(document.querySelectorAll('.has-shortcut').length, 4);

  // badges: '–' until PREVIEW answers, then the counts; the status line stays empty
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  ({ stub } = stubWith(async () => { await gate; return { status: 'done', count: { duplicates: 3, idle: 2 } }; }));
  dom = await loadPopup(stub);
  document = dom.window.document;
  assert.strictEqual(document.getElementById('badge-duplicates').textContent, '–');
  assert.strictEqual(document.getElementById('badge-idle').textContent, '–');
  release();
  await tick();
  assert.strictEqual(document.getElementById('badge-duplicates').textContent, '3');
  assert.strictEqual(document.getElementById('badge-idle').textContent, '2');
  assert.strictEqual(document.getElementById('status').textContent, '');

  // a failed, rejected or malformed PREVIEW leaves the badges at '–' (never undefined/NaN) and raises no error
  const badPreviews = [
    async () => { throw new Error('nope'); },
    () => ({ status: 'error', error: 'Quota exceeded' }),
    () => ({ status: 'done', count: 1 }),
    () => ({ status: 'done', count: { duplicates: undefined, idle: null } })
  ];
  for (const preview of badPreviews) {
    ({ stub } = stubWith(preview));
    dom = await loadPopup(stub, { errorReport: true });
    document = dom.window.document;
    assert.strictEqual(document.getElementById('badge-duplicates').textContent, '–');
    assert.strictEqual(document.getElementById('badge-idle').textContent, '–');
    assert.strictEqual(document.getElementById('status').textContent, '', 'a bad preview must not surface as an error');
  }

  // badges refresh after Close Duplicates
  ({ stub } = stubWith(
    (sent) => ({ status: 'done', count: sent.filter(m => m.action === 'PREVIEW').length === 1 ? { duplicates: 3, idle: 2 } : { duplicates: 0, idle: 2 } }),
    { status: 'done', count: 3 }
  ));
  dom = await loadPopup(stub);
  document = dom.window.document;
  assert.strictEqual(document.getElementById('badge-duplicates').textContent, '3');
  document.getElementById('btn-dedupe').click();
  await tick();
  assert.strictEqual(document.getElementById('badge-duplicates').textContent, '0');

  // badges refresh after the sleep threshold changes
  let sent;
  ({ stub, sent } = stubWith({ status: 'done', count: { duplicates: 1, idle: 4 } }));
  dom = await loadPopup(stub);
  document = dom.window.document;
  assert.strictEqual(sent.filter(m => m.action === 'PREVIEW').length, 1);
  const hours = document.getElementById('sleep-hours');
  hours.value = '2';
  hours.dispatchEvent(new dom.window.Event('change'));
  await tick();
  assert.strictEqual(sent.filter(m => m.action === 'PREVIEW').length, 2);

  // status tones: success, then error, then nothing-to-do - classes never accumulate
  ({ stub } = stubWith({ status: 'done', count: { duplicates: 0, idle: 0 } }, { status: 'done', count: 3 }));
  dom = await loadPopup(stub);
  document = dom.window.document;
  const status = document.getElementById('status');
  document.getElementById('btn-dedupe').click();
  await tick();
  assert.strictEqual(status.textContent, '3 duplicates closed.');
  assert.deepStrictEqual(classes(status), { success: true, error: false });
  stub.runtime.sendMessage = async () => ({ status: 'error', error: 'Quota exceeded' });
  document.getElementById('btn-dedupe').click();
  await tick();
  assert.deepStrictEqual(classes(status), { success: false, error: true });
  stub.runtime.sendMessage = async () => ({ status: 'done', count: 0 });
  document.getElementById('btn-dedupe').click();
  await tick();
  assert.strictEqual(status.textContent, 'No duplicates found.');
  assert.deepStrictEqual(classes(status), { success: false, error: false });

  // error-report: an uncaught error after a success must replace the success tone
  ({ stub } = stubWith({ status: 'done', count: { duplicates: 0, idle: 0 } }, { status: 'done', count: 3 }));
  dom = await loadPopup(stub, { errorReport: true });
  document = dom.window.document;
  document.getElementById('btn-dedupe').click();
  await tick();
  assert.deepStrictEqual(classes(document.getElementById('status')), { success: true, error: false });
  dom.window.dispatchEvent(new dom.window.ErrorEvent('error', { message: 'Boom' }));
  assert.strictEqual(document.getElementById('status').textContent, 'Boom');
  assert.deepStrictEqual(classes(document.getElementById('status')), { success: false, error: true });

  // aria-busy tracks a running action
  stub = makeBrowserChromeStub();
  stub.runtime.sendMessage = async () => { await tick(50); return { status: 'done', count: 1 }; };
  dom = await loadPopup(stub);
  document = dom.window.document;
  document.getElementById('btn-dedupe').click();
  await tick(10);
  assert.strictEqual(document.body.getAttribute('aria-busy'), 'true');
  await tick(120);
  assert.strictEqual(document.body.getAttribute('aria-busy'), 'false');
};
