// background.test.js â€” handler behavior tests via the chrome stub.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeChromeStub } = require('./helpers/chrome-stub.js');

const noop = { addListener() {} };
globalThis.chrome = { runtime: { onMessage: noop }, commands: { onCommand: noop } };

// background.js is a plain service-worker script, so load it by evaluating it
// here. The real service worker gets its helpers via importScripts('logic.js');
// in tests we strip that line and expose the same helpers as globals.
const logic = require('../logic.js');
Object.assign(globalThis, logic);
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8')
  .replace(/^\uFEFF?importScripts\([^)]*\);\s*/, '');
eval(source);

const HOUR = 60 * 60 * 1000;
const hoursAgo = h => Date.now() - h * HOUR;

module.exports = async function main() {
  // --- pure helpers (covered in depth by logic.test.js; smoke here) --------
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

  // --- handlers ------------------------------------------------------------
  // closeDuplicates keeps the pinned copy and never closes a pinned tab.
  let state = makeChromeStub([
    { url: 'https://a.com/x' },
    { url: 'https://a.com/x#frag' },
    { url: 'https://a.com/x?utm_source=news', pinned: true },
    { url: 'https://b.com/' },
    { url: 'https://b.com/?id=1' }
  ]);
  assert.strictEqual(await closeDuplicates(), 2);
  assert.deepStrictEqual(state.log, [['remove', [1, 2]]]);

  // ...and falls back to the active copy when nothing is pinned.
  state = makeChromeStub([
    { url: 'https://a.com/x' },
    { url: 'https://a.com/x', active: true }
  ]);
  assert.strictEqual(await closeDuplicates(), 1);
  assert.deepStrictEqual(state.log, [['remove', [1]]]);

  // Two pinned copies: neither is closed, only the loose one is.
  state = makeChromeStub([
    { url: 'https://a.com/x', pinned: true },
    { url: 'https://a.com/x', pinned: true },
    { url: 'https://a.com/x' }
  ]);
  assert.strictEqual(await closeDuplicates(), 1);
  assert.deepStrictEqual(state.log, [['remove', [3]]]);

  // saveSession opens the dashboard before closing anything.
  state = makeChromeStub([
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
  state = makeChromeStub([{ url: 'chrome://newtab' }, { url: 'https://b.com/', pinned: true }]);
  assert.strictEqual(await saveSession(), 0);
  assert.deepStrictEqual(state.log, []);

  // saveSession prepends to existing history.
  state = makeChromeStub([{ url: 'https://c.com/', title: 'C' }], { savedSessions: [{ date: 'old', tabs: [] }] });
  await saveSession();
  assert.strictEqual(state.stored.savedSessions.length, 2);
  assert.strictEqual(state.stored.savedSessions[1].date, 'old');

  // sleepInactive honours the stored threshold and the pinned/audible rules.
  state = makeChromeStub([
    { url: 'https://slow.com/', lastAccessed: hoursAgo(3) },
    { url: 'https://recent.com/', lastAccessed: hoursAgo(1) },
    { url: 'https://music.com/', lastAccessed: hoursAgo(5), audible: true },
    { url: 'https://pin.com/', lastAccessed: hoursAgo(5), pinned: true },
    { url: 'https://unknown.com/', lastAccessed: undefined }
  ], { sleepHours: 2 });
  assert.strictEqual(await sleepInactive(), 1);
  assert.deepStrictEqual(state.log, [['discard', 1]]);

  // Default threshold is 1 hour when nothing is stored.
  state = makeChromeStub([{ url: 'https://slow.com/', lastAccessed: hoursAgo(1.5) }]);
  assert.strictEqual(await sleepInactive(), 1);

  // arrangeByWebsite skips chrome:// and pinned tabs.
  state = makeChromeStub([
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
  state = makeChromeStub([
    { url: 'https://a.com/', windowId: 1 },
    { url: 'https://a.com/', windowId: 2 }
  ]);
  assert.strictEqual(await arrangeByWebsite(), 2);

  // arrangeByDate buckets in newest-first order.
  state = makeChromeStub([
    { url: 'https://old.com/', lastAccessed: hoursAgo(24 * 40) },
    { url: 'https://new.com/', lastAccessed: hoursAgo(1) },
    { url: 'chrome://newtab', lastAccessed: hoursAgo(1) }
  ]);
  assert.strictEqual(await arrangeByDate(), 2);
  assert.deepStrictEqual(state.groups.map(g => g.title), ['Today', 'Older']);
  assert.deepStrictEqual(state.groups[0].tabIds, [2]);
};

