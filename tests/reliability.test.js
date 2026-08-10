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
  let response = await sendMessage({ action: 'ARRANGE_BY_WEBSITE' });
  assert.strictEqual(response.status, 'done');
  assert.strictEqual(response.count, 1, 'only the current window should be organized');
  assert.strictEqual(state.groups.length, 1);
  assert.deepStrictEqual(state.groups[0].tabIds, [1]);

  // Existing user-created groups are preserved; only ungrouped tabs are organized.
  state = makeChromeStub([
    { url: 'https://manual.example/a', groupId: 42 },
    { url: 'https://fresh.example/b', groupId: -1 }
  ]);
  response = await sendMessage({ action: 'ARRANGE_BY_WEBSITE' });
  assert.strictEqual(response.count, 1);
  assert.strictEqual(state.groups.length, 1);
  assert.deepStrictEqual(state.groups[0].tabIds, [2]);
  assert.strictEqual(state.tabs[0].groupId, 42, 'manual group remains untouched');

  // Structured result explains manual groups that were preserved.
  assert.deepStrictEqual(response.result, {
    status: 'ok',
    changed: 1,
    skipped: 1,
    code: 'PRESERVED_EXISTING_GROUPS',
    mode: 'website',
    regroupedTabs: 0,
    manualGroupedTabs: 1
  });

  // Switching Date -> Website automatically replaces only extension-owned groups.
  state = makeChromeStub([
    { url: 'https://alpha.example/a', groupId: -1, lastAccessed: Date.now() },
    { url: 'https://beta.example/b', groupId: -1, lastAccessed: Date.now() }
  ]);
  response = await sendMessage({ action: 'ARRANGE_BY_DATE' });
  assert.strictEqual(response.count, 1, 'same-date tabs start in one date group');
  assert.strictEqual(Object.keys(state.sessionStored.organizerOwnedGroups || {}).length, 1, 'date group ownership is recorded');

  response = await sendMessage({ action: 'ARRANGE_BY_WEBSITE' });
  assert.strictEqual(response.count, 2, 'the same tabs can be regrouped by website');
  assert.deepStrictEqual(response.result, {
    status: 'ok',
    changed: 2,
    skipped: 0,
    code: 'REGROUPED',
    mode: 'website',
    regroupedTabs: 2,
    manualGroupedTabs: 0
  });
  assert.deepStrictEqual(state.log.filter(([op]) => op === 'ungroup'), [['ungroup', [1, 2]]]);
  assert.deepStrictEqual(state.groups.map(group => group.title).sort(), ['alpha.example', 'beta.example']);
  assert.strictEqual(Object.keys(state.sessionStored.organizerOwnedGroups || {}).length, 2, 'replacement website groups are owned');

  // Switching modes never touches a manual group in the same window.
  state = makeChromeStub([
    { url: 'https://manual.example/a', groupId: 90, lastAccessed: Date.now() },
    { url: 'https://alpha.example/a', groupId: -1, lastAccessed: Date.now() },
    { url: 'https://beta.example/b', groupId: -1, lastAccessed: Date.now() }
  ]);
  await sendMessage({ action: 'ARRANGE_BY_DATE' });
  response = await sendMessage({ action: 'ARRANGE_BY_WEBSITE' });
  assert.strictEqual(state.tabs[0].groupId, 90, 'manual group survives Date -> Website');
  assert.ok(!state.log.filter(([op]) => op === 'ungroup').flatMap(([, ids]) => ids).includes(1), 'manual tab is never ungrouped');
  assert.strictEqual(response.result.regroupedTabs, 2);
  assert.strictEqual(response.result.manualGroupedTabs, 1);

  // Grouping state exposes the active organizer mode for popup highlighting.
  response = await sendMessage({ action: 'GROUPING_STATE' });
  assert.deepStrictEqual(response, {
    status: 'done',
    count: { mode: 'website', groupCount: 2, tabCount: 2 }
  });

  // Ungroup removes only extension-owned groups and leaves manual groups alone.
  response = await sendMessage({ action: 'UNGROUP_ORGANIZED' });
  assert.strictEqual(response.count, 2);
  assert.deepStrictEqual(response.result, {
    status: 'ok',
    changed: 2,
    skipped: 1,
    code: 'UNGROUPED_ORGANIZED',
    mode: null,
    manualGroupedTabs: 1
  });
  assert.strictEqual(state.tabs[0].groupId, 90);
  assert.strictEqual(state.tabs[1].groupId, -1);
  assert.strictEqual(state.tabs[2].groupId, -1);
  assert.deepStrictEqual(state.sessionStored.organizerOwnedGroups, {});

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

  assert.strictEqual(typeof commandListener, 'function', 'keyboard command listener remains registered');
};
