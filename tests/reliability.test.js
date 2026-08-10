// reliability.test.js - regressions for safe organization and session limits.
const assert = require('assert');
const { makeChromeStub } = require('./helpers/chrome-stub.js');

let messageListener;
let commandListener;
globalThis.chrome = {
  runtime: {
    onMessage: { addListener(fn) { messageListener = fn; } },
    getURL: p => `chrome-extension://test/${p}`
  },
  commands: { onCommand: { addListener(fn) { commandListener = fn; } } }
};

require('./helpers/load-background.js')();

function sendMessage(request) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`No response for ${request.action}`)), 1000);
    const asyncResponse = messageListener(request, {}, response => {
      clearTimeout(timeout);
      resolve(response);
    });
    assert.strictEqual(asyncResponse, true, 'message listener must keep the response channel open');
  });
}

module.exports = async function main() {
  // Production organize messages are scoped to the current window by default.
  let state = makeChromeStub([
    { url: 'https://one.example/a', windowId: 1, groupId: -1 },
    { url: 'https://two.example/b', windowId: 2, groupId: -1 }
  ]);
  let response = await sendMessage({ action: 'ARRANGE_BY_WEBSITE', regroupAll: false });
  assert.strictEqual(response.status, 'done');
  assert.strictEqual(response.count, 1, 'only the current window should be organized');
  assert.strictEqual(state.groups.length, 1);
  assert.deepStrictEqual(state.groups[0].tabIds, [1]);

  // Regroup all OFF: every existing group is preserved, regardless of ownership.
  state = makeChromeStub([
    { url: 'https://alpha.example/a', groupId: -1, lastAccessed: Date.now() },
    { url: 'https://beta.example/b', groupId: -1, lastAccessed: Date.now() }
  ]);
  response = await sendMessage({ action: 'ARRANGE_BY_DATE', regroupAll: false });
  assert.strictEqual(response.count, 1, 'same-date tabs start in one date group');
  const ownedDateGroupId = state.tabs[0].groupId;
  assert.ok(ownedDateGroupId >= 0);
  assert.strictEqual(Object.keys(state.sessionStored.organizerOwnedGroups || {}).length, 1, 'date group ownership is recorded');

  response = await sendMessage({ action: 'ARRANGE_BY_WEBSITE', regroupAll: false });
  assert.strictEqual(response.count, 0, 'Off must not rebuild an existing Tab Organizer group');
  assert.strictEqual(state.tabs[0].groupId, ownedDateGroupId);
  assert.strictEqual(state.tabs[1].groupId, ownedDateGroupId);
  assert.deepStrictEqual(state.log.filter(([op]) => op === 'ungroup'), [], 'Off never ungroups existing groups');
  assert.deepStrictEqual(response.result, {
    status: 'noop',
    changed: 0,
    skipped: 2,
    code: 'PRESERVED_EXISTING_GROUPS',
    mode: 'website',
    regroupAll: false,
    regroupedTabs: 0,
    preservedGroupedTabs: 2,
    pinnedGroupedTabs: 0
  });

  // Regroup all ON: rebuild every non-pinned grouped tab, including manual/unknown groups.
  response = await sendMessage({ action: 'ARRANGE_BY_WEBSITE', regroupAll: true });
  assert.strictEqual(response.count, 2, 'On rebuilds the date-grouped tabs by website');
  assert.deepStrictEqual(state.log.filter(([op]) => op === 'ungroup'), [['ungroup', [1, 2]]]);
  assert.deepStrictEqual(state.groups.map(group => group.title).sort(), ['alpha.example', 'beta.example']);
  assert.deepStrictEqual(response.result, {
    status: 'ok',
    changed: 2,
    skipped: 0,
    code: 'REGROUPED_ALL',
    mode: 'website',
    regroupAll: true,
    regroupedTabs: 2,
    preservedGroupedTabs: 0,
    pinnedGroupedTabs: 0
  });

  // Off organizes only ungrouped tabs while both manual and pinned groups remain unchanged.
  state = makeChromeStub([
    { url: 'https://manual.example/a', groupId: 90, lastAccessed: Date.now() },
    { url: 'https://pinned.example/a', groupId: 91, pinned: true, lastAccessed: Date.now() },
    { url: 'https://fresh.example/b', groupId: -1, lastAccessed: Date.now() }
  ]);
  response = await sendMessage({ action: 'ARRANGE_BY_WEBSITE', regroupAll: false });
  assert.strictEqual(response.count, 1);
  assert.strictEqual(state.tabs[0].groupId, 90, 'manual group remains untouched when Off');
  assert.strictEqual(state.tabs[1].groupId, 91, 'pinned group remains untouched when Off');
  assert.ok(state.tabs[2].groupId >= 0, 'ungrouped tab is organized when Off');
  assert.deepStrictEqual(state.log.filter(([op]) => op === 'ungroup'), []);
  assert.strictEqual(response.result.preservedGroupedTabs, 2);
  assert.strictEqual(response.result.pinnedGroupedTabs, 1);

  // On dissolves every non-pinned group but never the pinned grouped tab.
  response = await sendMessage({ action: 'ARRANGE_BY_DATE', regroupAll: true });
  const ungroupedIds = state.log.filter(([op]) => op === 'ungroup').flatMap(([, ids]) => ids);
  assert.ok(ungroupedIds.includes(1), 'manual grouped tab is rebuilt when On');
  assert.ok(ungroupedIds.includes(3), 'extension grouped tab is rebuilt when On');
  assert.ok(!ungroupedIds.includes(2), 'pinned grouped tab is never ungrouped');
  assert.strictEqual(state.tabs[1].groupId, 91, 'pinned group id is preserved');
  assert.strictEqual(response.result.regroupAll, true);
  assert.strictEqual(response.result.regroupedTabs, 2);
  assert.strictEqual(response.result.pinnedGroupedTabs, 1);

  // Grouping state still exposes the active organizer mode for popup highlighting.
  response = await sendMessage({ action: 'GROUPING_STATE' });
  assert.strictEqual(response.status, 'done');
  assert.strictEqual(response.count.mode, 'date');
  assert.ok(response.count.groupCount >= 1);

  // Ungroup all removes every non-pinned group, regardless of ownership, and preserves pinned groups.
  state = makeChromeStub([
    { url: 'https://manual-one.example/a', groupId: 70 },
    { url: 'https://manual-two.example/b', groupId: 71 },
    { url: 'https://pinned.example/c', groupId: 72, pinned: true }
  ]);
  response = await sendMessage({ action: 'UNGROUP_ALL' });
  assert.strictEqual(response.count, 2);
  assert.deepStrictEqual(response.result, {
    status: 'ok',
    changed: 2,
    skipped: 1,
    code: 'UNGROUPED_ALL',
    mode: null,
    pinnedGroupedTabs: 1
  });
  assert.strictEqual(state.tabs[0].groupId, -1);
  assert.strictEqual(state.tabs[1].groupId, -1);
  assert.strictEqual(state.tabs[2].groupId, 72);
  assert.deepStrictEqual(state.log.filter(([op]) => op === 'ungroup'), [['ungroup', [1, 2]]]);

  // Keyboard Date/Website commands honor the saved Regroup all preference.
  assert.strictEqual(typeof commandListener, 'function', 'keyboard command listener remains registered');
  state = makeChromeStub([
    { url: 'https://manual.example/a', groupId: 80 },
    { url: 'https://fresh.example/b', groupId: -1 }
  ], { regroupAll: true });
  commandListener('ARRANGE_BY_WEBSITE');
  await new Promise(r => setTimeout(r, 20));
  assert.ok(state.log.some(([op, ids]) => op === 'ungroup' && ids.includes(1)), 'keyboard command reads saved regroupAll=true');
  assert.ok(state.tabs[0].groupId >= 0 && state.tabs[0].groupId !== 80, 'manual group was rebuilt by keyboard command');

  // Saving more than MAX_TABS_PER_SESSION reports what was actually stored.
  const tooMany = Array.from({ length: 250 }, (_, i) => ({
    url: `https://tab${i}.example/`,
    title: `Tab ${i}`
  }));
  state = makeChromeStub(tooMany);
  response = await sendMessage({ action: 'SAVE_SESSION' });
  assert.strictEqual(state.stored.savedSessions[0].tabs.length, 200);
  assert.strictEqual(response.count, 200);
  assert.deepStrictEqual(response.result, {
    status: 'partial',
    changed: 200,
    skipped: 50,
    code: 'SESSION_CAP'
  });

  // Adding to a full session must not claim success or silently drop the new tab.
  const fullTabs = Array.from({ length: 200 }, (_, i) => ({
    title: `Saved ${i}`,
    url: `https://saved${i}.example/`
  }));
  state = makeChromeStub([], {
    savedSessions: [{ id: 'full', date: '2026-08-10T00:00:00.000Z', tabs: fullTabs }]
  });
  response = await sendMessage({
    action: 'SESSION_ADD_TAB',
    sessionId: 'full',
    tab: { title: 'Overflow', url: 'https://overflow.example/' }
  });
  assert.strictEqual(response.count, 0);
  assert.strictEqual(state.stored.savedSessions[0].tabs.length, 200);
  assert.strictEqual(state.stored.savedSessions[0].tabs.some(t => t.url === 'https://overflow.example/'), false);
  assert.deepStrictEqual(response.result, {
    status: 'noop',
    changed: 0,
    skipped: 1,
    code: 'SESSION_CAP'
  });
};
