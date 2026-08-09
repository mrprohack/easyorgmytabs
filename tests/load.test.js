// load.test.js - large-tab-set acceptance tests: counts, concurrency caps.
const assert = require('assert');
const { makeChromeStub } = require('./helpers/chrome-stub.js');
const loadBackground = require('./helpers/load-background.js');

const noop = { addListener() {} };
globalThis.chrome = { runtime: { onMessage: noop }, commands: { onCommand: noop } };
loadBackground();
const HOUR = 60 * 60 * 1000;
const hoursAgo = h => Date.now() - h * HOUR;

module.exports = async function main() {
  // 300 tabs across 5 windows by website: every restorable tab lands in a group.
  const tabs = [];
  for (let w = 1; w <= 5; w++) {
    for (let i = 0; i < 60; i++) {
      tabs.push({ url: `https://site${i % 30}.com/page${i}`, windowId: w });
    }
  }
  let state = makeChromeStub(tabs, {}, { delayMs: 1 });
  let created = await arrangeByWebsite();
  assert.strictEqual(created, 5 * 30);
  assert.strictEqual(state.groups.length, 150);
  assert.ok(state.maxInFlight.group <= 5);
  assert.strictEqual(state.groups.reduce((n, g) => n + g.tabIds.length, 0), 300);

  // 300 idle tabs: all discarded, never more than 10 in flight.
  state = makeChromeStub(
    Array.from({ length: 300 }, (_, i) => ({ url: `https://s${i}.com/`, lastAccessed: hoursAgo(5) })),
    { sleepHours: 1 },
    { delayMs: 1 }
  );
  assert.strictEqual(await sleepInactive(), 300);
  assert.strictEqual(state.log.filter(([op]) => op === 'discard').length, 300);
  assert.ok(state.maxInFlight.discard <= 10);

  // 300 tabs with 150 duplicate pairs: exactly 150 removed, one remove call.
  const dupTabs = [];
  for (let i = 0; i < 150; i++) {
    dupTabs.push({ url: `https://dup${i}.com/` });
    dupTabs.push({ url: `https://dup${i}.com/?utm_source=x` });
  }
  state = makeChromeStub(dupTabs);
  assert.strictEqual(await closeDuplicates(), 150);
  const removes = state.log.filter(([op]) => op === 'remove');
  assert.strictEqual(removes.length, 1);
  assert.strictEqual(removes[0][1].length, 150);

  // 40 consecutive saves: all land, newest first, unique ids.
  const shared = {};
  for (let i = 0; i < 40; i++) {
    state = makeChromeStub([{ url: `https://seq${i}.com/`, title: `T${i}` }], shared, { setLatencyMs: 1 });
    await saveSession();
  }
  assert.strictEqual(shared.savedSessions.length, 40);
  assert.strictEqual(shared.savedSessions[0].tabs[0].url, 'https://seq39.com/');
  const ids = new Set(shared.savedSessions.map(s => s.id));
  assert.strictEqual(ids.size, 40);

  console.log('  load suite: 300-tab scenarios passed');
};