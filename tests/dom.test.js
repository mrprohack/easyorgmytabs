// dom.test.js ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â jsdom tests for session.html (popup sections added in Task 9)
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
    beforeParse(window) { window.chrome = stub; }
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
};