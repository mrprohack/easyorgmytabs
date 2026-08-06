// Self-check for background.js: node test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const noop = { addListener() {} };
globalThis.chrome = { runtime: { onMessage: noop }, commands: { onCommand: noop } };

// background.js is a plain service-worker script, so load it by evaluating it here.
eval(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'));

const HOUR = 60 * 60 * 1000;
const hoursAgo = h => Date.now() - h * HOUR;

// A chrome.* stub that records what the handler did, in order.
function mockChrome(tabs, stored = {}) {
  const state = {
    tabs: tabs.map((tab, i) => ({
      id: i + 1, windowId: 1, url: 'https://example.com/', title: 'Tab',
      pinned: false, active: false, audible: false, discarded: false,
      lastAccessed: Date.now(), ...tab
    })),
    log: [],
    groups: [],
    stored
  };

  const area = () => ({
    async get(key) { return key in state.stored ? { [key]: state.stored[key] } : {}; },
    async set(items) { Object.assign(state.stored, items); }
  });

  globalThis.chrome = {
    runtime: { onMessage: noop, getURL: p => `chrome-extension://test/${p}` },
    commands: { onCommand: noop },
    storage: { local: area(), sync: area() },
    tabGroups: {
      async update(groupId, props) { Object.assign(state.groups[groupId - 1], props); }
    },
    tabs: {
      async query(filter = {}) {
        return state.tabs.filter(tab => Object.entries(filter).every(([key, value]) =>
          key === 'currentWindow' ? tab.windowId === 1 : tab[key] === value));
      },
      async remove(ids) {
        state.log.push(['remove', ids]);
        state.tabs = state.tabs.filter(t => !ids.includes(t.id));
      },
      async create({ url }) { state.log.push(['create', url]); },
      async discard(id) { state.log.push(['discard', id]); },
      async ungroup() {},
      async group({ tabIds }) {
        state.groups.push({ tabIds });
        return state.groups.length;
      }
    }
  };
  return state;
}

// --- pure helpers ---------------------------------------------------------
assert.strictEqual(isRestorable('https://example.com/a'), true);
assert.strictEqual(isRestorable('chrome://newtab'), false);
assert.strictEqual(isRestorable('chrome-extension://abc/session.html'), false);
assert.strictEqual(isRestorable('about:blank'), false);
assert.strictEqual(isRestorable(undefined), false);

assert.strictEqual(dedupeKey('https://a.com/x#frag'), 'https://a.com/x');
assert.strictEqual(dedupeKey('https://a.com/x?utm_source=n&id=7'), 'https://a.com/x?id=7');
assert.notStrictEqual(dedupeKey('https://a.com/x?id=7'), dedupeKey('https://a.com/x?id=8'));
assert.strictEqual(dedupeKey('not a url'), 'not a url');

assert.strictEqual(getDomain('https://www.youtube.com/watch?v=1'), 'youtube.com');
assert.strictEqual(getDomain('garbage'), 'Other');

assert.strictEqual(getDateBucket(hoursAgo(2)), 'Today');
assert.strictEqual(getDateBucket(hoursAgo(24 * 3)), 'This Week');
assert.strictEqual(getDateBucket(hoursAgo(24 * 40)), 'Older');
assert.strictEqual(getDateBucket(undefined), 'Unknown');

// --- handlers -------------------------------------------------------------
async function main() {
  // closeDuplicates keeps the pinned copy and never closes a pinned tab.
  let state = mockChrome([
    { url: 'https://a.com/x' },
    { url: 'https://a.com/x#frag' },
    { url: 'https://a.com/x?utm_source=news', pinned: true },
    { url: 'https://b.com/' },
    { url: 'https://b.com/?id=1' }
  ]);
  assert.strictEqual(await closeDuplicates(), 2);
  assert.deepStrictEqual(state.log, [['remove', [1, 2]]]);

  // ...and falls back to the active copy when nothing is pinned.
  state = mockChrome([
    { url: 'https://a.com/x' },
    { url: 'https://a.com/x', active: true }
  ]);
  assert.strictEqual(await closeDuplicates(), 1);
  assert.deepStrictEqual(state.log, [['remove', [1]]]);

  // Two pinned copies: neither is closed, only the loose one is.
  state = mockChrome([
    { url: 'https://a.com/x', pinned: true },
    { url: 'https://a.com/x', pinned: true },
    { url: 'https://a.com/x' }
  ]);
  assert.strictEqual(await closeDuplicates(), 1);
  assert.deepStrictEqual(state.log, [['remove', [3]]]);

  // saveSession opens the dashboard before closing anything.
  state = mockChrome([
    { url: 'https://a.com/', title: 'A' },
    { url: 'https://b.com/', title: 'B', pinned: true },
    { url: 'chrome://newtab', title: 'New Tab' },
    { url: 'chrome-extension://abc/session.html', title: 'Saved Sessions' },
    { url: 'about:blank', title: '' },
    { url: 'devtools://devtools/inspector.html', title: 'DevTools' }
  ]);
  assert.strictEqual(await saveSession(), 1);
  assert.deepStrictEqual(state.log, [
    ['create', 'chrome-extension://test/session.html'],
    ['remove', [1]]
  ]);
  assert.deepStrictEqual(state.stored.savedSessions[0].tabs, [{ title: 'A', url: 'https://a.com/' }]);

  // Nothing saveable: no dashboard, no closed tabs.
  state = mockChrome([{ url: 'chrome://newtab' }, { url: 'https://b.com/', pinned: true }]);
  assert.strictEqual(await saveSession(), 0);
  assert.deepStrictEqual(state.log, []);

  // saveSession prepends to existing history.
  state = mockChrome([{ url: 'https://c.com/', title: 'C' }], { savedSessions: [{ date: 'old', tabs: [] }] });
  await saveSession();
  assert.strictEqual(state.stored.savedSessions.length, 2);
  assert.strictEqual(state.stored.savedSessions[1].date, 'old');

  // sleepInactive honours the stored threshold and the pinned/audible rules.
  state = mockChrome([
    { url: 'https://slow.com/', lastAccessed: hoursAgo(3) },
    { url: 'https://recent.com/', lastAccessed: hoursAgo(1) },
    { url: 'https://music.com/', lastAccessed: hoursAgo(5), audible: true },
    { url: 'https://pin.com/', lastAccessed: hoursAgo(5), pinned: true },
    { url: 'https://unknown.com/', lastAccessed: undefined }
  ], { sleepHours: 2 });
  assert.strictEqual(await sleepInactive(), 1);
  assert.deepStrictEqual(state.log, [['discard', 1]]);

  // Default threshold is 1 hour when nothing is stored.
  state = mockChrome([{ url: 'https://slow.com/', lastAccessed: hoursAgo(1.5) }]);
  assert.strictEqual(await sleepInactive(), 1);

  // arrangeByWebsite skips chrome:// and pinned tabs.
  state = mockChrome([
    { url: 'https://www.youtube.com/a' },
    { url: 'https://youtube.com/b' },
    { url: 'https://google.com/' },
    { url: 'chrome://newtab' },
    { url: 'https://pinned.com/', pinned: true }
  ]);
  assert.strictEqual(await arrangeByWebsite(), 2);
  assert.deepStrictEqual(state.groups, [
    { tabIds: [1, 2], title: 'youtube.com', collapsed: true, color: 'grey' },
    { tabIds: [3], title: 'google.com', collapsed: true, color: 'blue' }
  ]);

  // Separate windows get separate groups.
  state = mockChrome([
    { url: 'https://a.com/', windowId: 1 },
    { url: 'https://a.com/', windowId: 2 }
  ]);
  assert.strictEqual(await arrangeByWebsite(), 2);

  // arrangeByDate buckets in newest-first order.
  state = mockChrome([
    { url: 'https://old.com/', lastAccessed: hoursAgo(24 * 40) },
    { url: 'https://new.com/', lastAccessed: hoursAgo(1) },
    { url: 'chrome://newtab', lastAccessed: hoursAgo(1) }
  ]);
  assert.strictEqual(await arrangeByDate(), 2);
  assert.deepStrictEqual(state.groups.map(g => g.title), ['Today', 'Older']);
  assert.deepStrictEqual(state.groups[0].tabIds, [2]);

  console.log('ok');
}

main().catch(err => { console.error(err); process.exit(1); });
