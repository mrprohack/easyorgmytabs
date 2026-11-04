// dashboard-ux.test.js - card identity, Latest chip, status feedback, keyboard shortcuts.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeBrowserChromeStub } = require('./helpers/chrome-stub.js');

const ROOT = path.join(__dirname, '..');
const src = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

const DAY = 864e5;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }); // same default locale as session.js
const tabs = (...urls) => urls.map((url, i) => ({ title: `Tab ${i + 1}`, url }));

async function loadDashboard(savedSessions, stubTweak) {
  const stub = makeBrowserChromeStub({ savedSessions });
  if (stubTweak) stubTweak(stub);
  const dom = new JSDOM(src('session.html'), {
    url: 'chrome-extension://test/',
    runScripts: 'outside-only',
    beforeParse(window) { window.chrome = stub; }
  });
  for (const file of ['error-report.js', 'logic.js', 'session.js']) dom.window.eval(src(file));
  await tick();
  return { dom, stub, document: dom.window.document };
}

const classes = (el) => ({ success: el.classList.contains('is-success'), error: el.classList.contains('error') });

module.exports = async function main() {
  // identity: meta carries tab count and age; host summary names the distinct hosts
  let { document } = await loadDashboard([
    { date: iso(3), tabs: tabs('https://www.a.com/x', 'https://a.com/y', 'https://b.com/') },
    { date: iso(40), tabs: tabs('https://c.com/') }
  ]);
  let cards = [...document.querySelectorAll('article.session')];
  assert.strictEqual(cards[0].querySelector('.meta').textContent, `3 tabs · ${rtf.format(-3, 'day')}`);
  assert.strictEqual(cards[0].querySelector('.session-hosts').textContent, 'a.com · b.com');
  assert.strictEqual(cards[1].querySelector('.meta').textContent, `1 tab · ${rtf.format(-1, 'month')}`);
  assert.ok(cards[0].querySelector('.meta').nextElementSibling.classList.contains('session-hosts'), 'hosts follow the meta line');

  // Latest chip: only on the newest card, and only when no search is active
  assert.deepStrictEqual(cards.map(card => !!card.querySelector('.session-badge')), [true, false]);
  assert.strictEqual(cards[0].querySelector('.session-badge').textContent, 'Latest');
  const search = document.getElementById('search');
  search.value = 'c.com';
  search.dispatchEvent(new (document.defaultView.Event)('input'));
  await tick(200);
  assert.strictEqual(document.querySelectorAll('article.session').length, 1);
  assert.strictEqual(document.querySelectorAll('.session-badge').length, 0, 'no Latest chip while searching');
  document.getElementById('clear-search').click();
  await tick();
  cards = [...document.querySelectorAll('article.session')];
  assert.deepStrictEqual(cards.map(card => !!card.querySelector('.session-badge')), [true, false]);

  // identity edge cases: capped hosts, non-linkable-only sessions, a corrupt date
  ({ document } = await loadDashboard([
    { date: iso(1), tabs: tabs(...['a', 'b', 'c', 'd', 'e'].map(h => `https://${h}.com/`)) },
    { date: iso(2), tabs: tabs('javascript:alert(1)') },
    { date: 'garbage', tabs: tabs('https://x.com/') }
  ]));
  cards = [...document.querySelectorAll('article.session')];
  assert.strictEqual(cards[0].querySelector('.session-hosts').textContent, 'a.com · b.com · c.com · +2 more');
  assert.strictEqual(cards[1].querySelector('.session-hosts'), null, 'no host line without linkable hosts');
  assert.strictEqual(cards.length, 3, 'a corrupt date must not stop the card rendering');
  assert.strictEqual(cards[2].querySelector('.meta').textContent, '1 tab', 'no age label for an unparsable date');

  // feedback: Restore in a new window (plural, singular, linkable tabs only)
  let stub;
  ({ document, stub } = await loadDashboard([
    { date: iso(1), tabs: tabs('https://a.com/', 'javascript:alert(1)', 'https://b.com/') },
    { date: iso(2), tabs: tabs('https://c.com/') }
  ]));
  let status = document.getElementById('status');
  document.querySelectorAll('.btn-session-primary')[0].click();
  await tick();
  assert.deepStrictEqual(stub._stored._windows, [['https://a.com/', 'https://b.com/']]);
  assert.strictEqual(status.textContent, 'Opened 2 tabs in a new window.');
  assert.deepStrictEqual(classes(status), { success: true, error: false });
  document.querySelectorAll('.btn-session-primary')[1].click();
  await tick();
  assert.strictEqual(status.textContent, 'Opened 1 tab in a new window.');

  // feedback: add link, remove tab, delete session (each success is tinted, none leaves a stale error)
  ({ document, stub } = await loadDashboard([{ date: iso(1), tabs: tabs('https://a.com/') }]));
  status = document.getElementById('status');
  const input = document.querySelector('.add-link-form input');
  input.value = 'https://new.com/';
  document.querySelector('.add-link-form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.strictEqual(status.textContent, 'Added new.com to this session.');
  assert.deepStrictEqual(classes(status), { success: true, error: false });
  document.querySelector('.delete-link-btn').click();
  await tick();
  assert.strictEqual(status.textContent, 'Removed tab.');
  assert.deepStrictEqual(classes(status), { success: true, error: false });
  const del = document.querySelector('.btn-session-delete');
  del.click();
  del.click();
  await tick();
  assert.strictEqual(status.textContent, 'Session deleted.');
  assert.deepStrictEqual(classes(status), { success: true, error: false });

  // a success tone never lingers on a later error (mutation error, then an uncaught script error)
  stub.runtime.sendMessage = async () => ({ status: 'error', error: 'Quota exceeded' });
  const del2 = document.querySelector('.btn-session-delete');
  del2.click();
  del2.click();
  await tick();
  assert.strictEqual(status.textContent, 'Quota exceeded');
  assert.deepStrictEqual(classes(status), { success: false, error: true });
  stub.runtime.sendMessage = async () => ({ status: 'done', count: 1 });
  const del3 = document.querySelector('.btn-session-delete');
  del3.click();
  del3.click();
  await tick();
  assert.deepStrictEqual(classes(status), { success: true, error: false });
  document.defaultView.dispatchEvent(new document.defaultView.ErrorEvent('error', { message: 'Boom' }));
  assert.strictEqual(status.textContent, 'Boom');
  assert.deepStrictEqual(classes(status), { success: false, error: true });

  // keyboard: "/" focuses search, but never while typing in a field and never with a modifier
  ({ document } = await loadDashboard([{ date: iso(1), tabs: tabs('https://a.com/') }]));
  const win = document.defaultView;
  const searchField = document.getElementById('search');
  const slash = new win.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
  document.body.dispatchEvent(slash);
  assert.strictEqual(document.activeElement, searchField, '"/" moves focus to search');
  assert.strictEqual(slash.defaultPrevented, true);

  const urlField = document.querySelector('.add-link-form input');
  urlField.focus();
  const typed = new win.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
  urlField.dispatchEvent(typed);
  assert.strictEqual(typed.defaultPrevented, false, 'typing "/" in the URL field is left alone');
  assert.strictEqual(document.activeElement, urlField, 'focus stays in the URL field');

  document.activeElement.blur();
  const withCtrl = new win.KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true, cancelable: true });
  document.body.dispatchEvent(withCtrl);
  assert.strictEqual(withCtrl.defaultPrevented, false);
  assert.notStrictEqual(document.activeElement, searchField);

  // keyboard: Escape clears a non-empty search
  searchField.value = 'x';
  searchField.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.strictEqual(searchField.value, '');
  assert.strictEqual(document.getElementById('clear-search').hidden, true);

  // corrupt storage: bad entries must not blank the dashboard, and the remaining rows must keep
  // the indices the background uses for SESSION_REMOVE_TAB
  const sent = [];
  ({ document, stub } = await loadDashboard([
    { date: iso(1) },                                                                    // no tabs at all
    { date: iso(2), tabs: tabs('https://ok.com/') },                                     // healthy
    null,                                                                                // not an object
    { date: iso(3), tabs: 'nope' },                                                      // tabs is not an array
    { date: iso(4), tabs: [null, { title: 'Second', url: 'https://second.com/' }] }      // a null tab entry
  ], (s) => { s.runtime.sendMessage = async (msg) => { sent.push(msg); return { status: 'done', count: 1 }; }; }));
  assert.strictEqual(document.getElementById('status').textContent, '', 'corrupt entries must not surface as an error');
  cards = [...document.querySelectorAll('article.session')];
  assert.strictEqual(cards.length, 4, 'the non-object entry is skipped; every object entry still renders');
  assert.strictEqual(document.getElementById('session-count').textContent, '4 sessions');
  assert.strictEqual(cards[1].querySelector('.link').textContent, 'Tab 1', 'the healthy session is unaffected');
  assert.strictEqual(cards[3].querySelectorAll('.link-row').length, 2, 'a null tab keeps its row so indices stay aligned');
  cards[3].querySelectorAll('.delete-link-btn')[1].click();
  await tick();
  assert.strictEqual(sent.find(m => m.action === 'SESSION_REMOVE_TAB').index, 1, 'removal targets the stored index, not a filtered one');
};
