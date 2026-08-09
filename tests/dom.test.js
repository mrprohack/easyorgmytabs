// dom.test.js - jsdom tests for popup/session surfaces.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeBrowserChromeStub } = require('./helpers/chrome-stub.js');

const ROOT = path.join(__dirname, '..');

async function loadPage(htmlFile, scriptFiles, stub) {
  const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
  const dom = new JSDOM(html, {
    url: 'chrome-extension://test/',
    runScripts: 'outside-only',
    beforeParse(window) { if (stub) window.chrome = stub; }
  });
  for (const file of scriptFiles) {
    dom.window.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  await new Promise(r => setTimeout(r, 0));
  return dom;
}

module.exports = async function main() {
  // dashboard: renders sessions as textContent with http(s)-only hrefs
  const stub = makeBrowserChromeStub({
    savedSessions: [{
      date: '2026-08-09T10:00:00.000Z',
      tabs: [
        { title: 'Safe', url: 'https://a.com/' },
        { title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' }
      ]
    }]
  });
  let dom = await loadPage('session.html', ['logic.js', 'session.js'], stub);
  // placeholders must be proper UTF-8, never mojibake
  assert.strictEqual(dom.window.document.getElementById('search').placeholder, 'Search saved tabs…');
  assert.strictEqual(dom.window.document.querySelector('.add-link-form input').placeholder, 'Paste URL…');
  let links = [...dom.window.document.querySelectorAll('.link')];
  assert.strictEqual(links.length, 2);
  assert.strictEqual(links[0].textContent, 'Safe');
  assert.strictEqual(links[0].href, 'https://a.com/');
  assert.strictEqual(links[1].textContent, '<img src=x onerror=alert(1)>');
  assert.ok(!links[1].querySelector('img'), 'no img element from title');
  assert.strictEqual(links[1].getAttribute('href'), null, 'non-http URL gets no href');

  // dashboard: search filters via filterSessions, debounced
  dom.window.document.getElementById('search').value = 'Safe';
  dom.window.document.getElementById('search').dispatchEvent(new dom.window.Event('input'));
  await new Promise(r => setTimeout(r, 200));
  links = [...dom.window.document.querySelectorAll('.link')];
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].textContent, 'Safe');

  // dashboard: storage.onChanged re-renders when another context changes data
  dom.window.document.getElementById('search').value = ''; // clear the search from the previous section
  stub._stored.savedSessions = [{ date: '2026-08-09T11:00:00.000Z', tabs: [{ title: 'Fresh', url: 'https://fresh.com/' }] }];
  stub._emit({ savedSessions: { oldValue: [], newValue: stub._stored.savedSessions } });
  await new Promise(r => setTimeout(r, 0));
  links = [...dom.window.document.querySelectorAll('.link')];
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].textContent, 'Fresh');

  // dashboard: add-tab form sends SESSION_ADD_TAB with a validated URL
  const messages = [];
  stub.runtime.sendMessage = async (msg) => { messages.push(msg); return { status: 'done', count: 1 }; };
  const input = dom.window.document.querySelector('.add-link-form input');
  const form = dom.window.document.querySelector('.add-link-form');
  input.value = 'https://new.com/';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(messages[0].action, 'SESSION_ADD_TAB');
  assert.strictEqual(messages[0].sessionId, '2026-08-09T11:00:00.000Z');
  assert.strictEqual(messages[0].tab.title, 'new.com');
  assert.strictEqual(messages[0].tab.url, 'https://new.com/');

  // dashboard: two-step delete confirm, then SESSION_DELETE
  const deleteStub = makeBrowserChromeStub({
    savedSessions: [{ date: '2026-08-09T10:00:00.000Z', tabs: [{ title: 'A', url: 'https://a.com/' }] }]
  });
  const deleteMessages = [];
  deleteStub.runtime.sendMessage = async (msg) => { deleteMessages.push(msg); return { status: 'done', count: 1 }; };
  dom = await loadPage('session.html', ['logic.js', 'session.js'], deleteStub);
  const removeBtn = dom.window.document.querySelector('.btn-row .btn-danger');
  removeBtn.click();
  assert.strictEqual(removeBtn.textContent.includes('Confirm'), true);
  removeBtn.click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(deleteMessages.length, 1);
  assert.strictEqual(deleteMessages[0].action, 'SESSION_DELETE');
  assert.strictEqual(deleteMessages[0].sessionId, '2026-08-09T10:00:00.000Z');
  // dashboard: mutation errors surface in the status line, not silently
  const errStub = makeBrowserChromeStub({
    savedSessions: [{ date: '2026-08-09T10:00:00.000Z', tabs: [{ title: 'A', url: 'https://a.com/' }] }]
  });
  errStub.runtime.sendMessage = async () => ({ status: 'error', error: 'Quota exceeded' });
  dom = await loadPage('session.html', ['logic.js', 'session.js'], errStub);
  const dashboardStatus = dom.window.document.getElementById('status');
  const dangerBtn = dom.window.document.querySelector('.btn-row .btn-danger');
  dangerBtn.click(); // arm
  dangerBtn.click(); // confirm -> mutation fails
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(dashboardStatus.textContent, 'Quota exceeded');
  assert.ok(dashboardStatus.classList.contains('error'));

  // popup: without extension APIs the popup shows a clear message instead of throwing
  dom = await loadPage('popup.html', ['logic.js', 'popup.js'], null);
  const noApiStatus = dom.window.document.getElementById('status');
  assert.strictEqual(noApiStatus.textContent, 'Extension APIs unavailable - open this from the toolbar popup.');

  // dashboard: a storage read failure shows in the status line instead of throwing
  const failStub = makeBrowserChromeStub();
  failStub.storage.local.get = async () => { throw new Error('Storage read failed'); };
  dom = await loadPage('session.html', ['logic.js', 'session.js'], failStub);
  await new Promise(r => setTimeout(r, 0));
  const failStatus = dom.window.document.getElementById('status');
  assert.strictEqual(failStatus.textContent, 'Storage read failed');


  // regression: logic.js + session.js run in ONE shared scope in a real browser.
  // A later const destructuring of a logic.js function name is a SyntaxError there.
  const logicSrc = fs.readFileSync(path.join(ROOT, 'logic.js'), 'utf8');
  const sessionSrc = fs.readFileSync(path.join(ROOT, 'session.js'), 'utf8');
  const popupSrc = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  const scopeDom = new JSDOM('<!doctype html><p id="status"></p><input id="search"><input id="sleep-hours"><div id="sessions-container"></div>', {
    url: 'chrome-extension://test/',
    runScripts: 'outside-only',
    beforeParse(window) { window.chrome = makeBrowserChromeStub(); }
  });
  assert.doesNotThrow(() => scopeDom.window.eval(logicSrc + '\n' + sessionSrc), 'session.js must not redeclare logic.js names');
  assert.doesNotThrow(() => scopeDom.window.eval(logicSrc + '\n' + popupSrc), 'popup.js must not redeclare logic.js names');
  // error-report: uncaught errors and rejections show in the status line
  dom = await loadPage('session.html', ['error-report.js', 'logic.js', 'session.js'], makeBrowserChromeStub({ savedSessions: [] }));
  const erStatus = dom.window.document.getElementById('status');
  dom.window.dispatchEvent(new dom.window.ErrorEvent('error', { message: 'Boom' }));
  assert.strictEqual(erStatus.textContent, 'Boom');
  assert.ok(erStatus.classList.contains('error'));
  const rejection = new dom.window.Event('unhandledrejection');
  rejection.reason = new dom.window.Error('Rejecto');
  dom.window.dispatchEvent(rejection);
  assert.strictEqual(erStatus.textContent, 'Rejecto');

  // popup: View Saved Sessions opens the dashboard and closes the popup
  const viewStub = makeBrowserChromeStub();
  let closed = false;
  dom = await loadPage('popup.html', ['error-report.js', 'logic.js', 'popup.js'], viewStub);
  dom.window.close = () => { closed = true; };
  const viewBtn = dom.window.document.getElementById('btn-view-sessions');
  assert.ok(viewBtn, 'view sessions button exists');
  viewBtn.click();
  await new Promise(r => setTimeout(r, 10));
  assert.deepStrictEqual(viewStub._stored._created, ['chrome-extension://test/session.html']);
  assert.strictEqual(closed, true);
  // popup: success and error status lines, buttons re-enabled
  const popupStub = makeBrowserChromeStub();
  const sendLog = [];
  popupStub.runtime.sendMessage = async (msg) => { sendLog.push(msg); return { status: 'done', count: 3 }; };
  dom = await loadPage('popup.html', ['logic.js', 'popup.js'], popupStub);
  const status = dom.window.document.getElementById('status');
  dom.window.document.getElementById('btn-dedupe').click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(status.textContent, '3 duplicates closed.');
  assert.strictEqual(dom.window.document.querySelectorAll('button:disabled').length, 0);

  popupStub.runtime.sendMessage = async () => ({ status: 'error', error: 'Quota exceeded' });
  dom.window.document.getElementById('btn-dedupe').click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(status.textContent, 'Quota exceeded');
  assert.ok(status.classList.contains('error'));

  // popup: sleep-hours clamp uses logic.js clampSleepHours
  const setLog = [];
  popupStub.storage.sync.set = async (items) => { setLog.push(items); };
  const sleepInput = dom.window.document.getElementById('sleep-hours');
  sleepInput.value = '500';
  sleepInput.dispatchEvent(new dom.window.Event('change'));
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(setLog.length, 1);
  assert.strictEqual(setLog[0].sleepHours, 168);
  assert.strictEqual(sleepInput.value, '168');

  // popup: status shows the proper "Working…" text while an action runs
  const slowStub = makeBrowserChromeStub();
  slowStub.runtime.sendMessage = async () => { await new Promise(r => setTimeout(r, 50)); return { status: 'done', count: 1 }; };
  dom = await loadPage('popup.html', ['logic.js', 'popup.js'], slowStub);
  const slowStatus = dom.window.document.getElementById('status');
  dom.window.document.getElementById('btn-dedupe').click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(slowStatus.textContent, 'Working…');
  await new Promise(r => setTimeout(r, 60));

  // popup: a silent background is reported as not responding, not as "nothing found"
  const deadStub = makeBrowserChromeStub();
  deadStub.runtime.sendMessage = async () => undefined;
  dom = await loadPage('popup.html', ['logic.js', 'popup.js'], deadStub);
  const deadStatus = dom.window.document.getElementById('status');
  dom.window.document.getElementById('btn-dedupe').click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(deadStatus.textContent, 'Background not responding. Reload the extension.');
  assert.ok(deadStatus.classList.contains('error'));
};