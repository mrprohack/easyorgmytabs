importScripts('logic.js');

const OWNED_GROUPS_KEY = 'organizerOwnedGroups';

function makeActionResult({ changed = 0, skipped = 0, code, status } = {}) {
  const result = {
    status: status || (changed > 0 ? 'ok' : 'noop'),
    changed,
    skipped
  };
  if (code) result.code = code;
  return result;
}

function hasExistingGroup(tab) {
  return Number.isInteger(tab?.groupId) && tab.groupId >= 0;
}

async function readOwnedGroups() {
  if (!chrome.storage?.session) return {};
  const data = await chrome.storage.session.get(OWNED_GROUPS_KEY);
  const registry = data?.[OWNED_GROUPS_KEY];
  return registry && typeof registry === 'object' && !Array.isArray(registry) ? registry : {};
}

async function writeOwnedGroups(registry) {
  if (!chrome.storage?.session) return;
  await chrome.storage.session.set({ [OWNED_GROUPS_KEY]: registry });
}

function removeOwnedEntriesForScope(registry, tabs, removedGroupIds = new Set()) {
  const next = { ...registry };
  const scopeWindows = new Set(tabs.map(tab => tab.windowId));
  const liveGroupIds = new Set(tabs.filter(hasExistingGroup).map(tab => String(tab.groupId)));

  for (const [groupId, metadata] of Object.entries(next)) {
    if (removedGroupIds.has(Number(groupId))) {
      delete next[groupId];
      continue;
    }
    if (scopeWindows.has(metadata?.windowId) && !liveGroupIds.has(groupId)) {
      delete next[groupId];
    }
  }
  return next;
}

async function prepareTabsForGrouping(tabs) {
  const registry = await readOwnedGroups();
  const ownedGroupIds = new Set();
  const ownedTabIds = [];
  let manualGroupedTabs = 0;

  for (const tab of tabs) {
    if (!hasExistingGroup(tab)) continue;
    const metadata = registry[String(tab.groupId)];
    if (metadata && metadata.windowId === tab.windowId) {
      ownedGroupIds.add(tab.groupId);
      if (tab.id !== undefined) ownedTabIds.push(tab.id);
    } else {
      manualGroupedTabs++;
    }
  }

  if (ownedTabIds.length > 0) {
    await chrome.tabs.ungroup(ownedTabIds);
  }

  const nextRegistry = removeOwnedEntriesForScope(registry, tabs, ownedGroupIds);
  if (JSON.stringify(nextRegistry) !== JSON.stringify(registry)) {
    await writeOwnedGroups(nextRegistry);
  }

  return {
    tabs: tabs.map(tab => ownedGroupIds.has(tab.groupId) ? { ...tab, groupId: -1 } : tab),
    regroupedTabs: ownedTabIds.length,
    manualGroupedTabs
  };
}

async function rememberCreatedGroups(createdGroups, mode) {
  if (createdGroups.length === 0) return;
  const registry = await readOwnedGroups();
  for (const group of createdGroups) {
    registry[String(group.groupId)] = { windowId: group.windowId, mode };
  }
  await writeOwnedGroups(registry);
}

async function groupingState() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const registry = await readOwnedGroups();
  const groups = new Map();

  for (const tab of tabs) {
    if (!hasExistingGroup(tab)) continue;
    const metadata = registry[String(tab.groupId)];
    if (!metadata || metadata.windowId !== tab.windowId) continue;
    if (!groups.has(tab.groupId)) groups.set(tab.groupId, { mode: metadata.mode, tabCount: 0 });
    groups.get(tab.groupId).tabCount++;
  }

  const modes = new Set([...groups.values()].map(group => group.mode).filter(Boolean));
  const mode = modes.size === 1 ? [...modes][0] : modes.size > 1 ? 'mixed' : null;
  const tabCount = [...groups.values()].reduce((sum, group) => sum + group.tabCount, 0);
  return { mode, groupCount: groups.size, tabCount };
}

async function viewSessions() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('session.html') });
  return 1;
}

async function undoClose() {
  try {
    await chrome.sessions.restore();
    return 1;
  } catch (e) {
    return 0;
  }
}

async function previewCounts() {
  const { sleepHours = DEFAULT_SLEEP_HOURS } = await chrome.storage.sync.get('sleepHours');
  const [tabs, inactive] = await Promise.all([
    chrome.tabs.query({ currentWindow: true }),
    chrome.tabs.query({ currentWindow: true, active: false, discarded: false })
  ]);
  const cutoff = Date.now() - sleepHours * 60 * 60 * 1000;
  return {
    duplicates: duplicateIdsToRemove(tabs).length,
    idle: inactive.filter(t => !t.audible && !t.pinned && t.lastAccessed && t.lastAccessed <= cutoff).length
  };
}

function findSession(saved, sessionId) {
  return saved.find(s => sessionIdOf(s) === sessionId);
}

async function sessionDelete(request = {}) {
  const { sessionId } = request;
  if (!sessionId) return 0;
  return enqueueSessionWrite(async () => {
    const saved = await readSavedSessions();
    const next = saved.filter(s => sessionIdOf(s) !== sessionId);
    if (next.length === saved.length) return 0;
    await writeSavedSessions(applySessionCap(next));
    return 1;
  });
}

async function sessionAddTabResult(request = {}) {
  const { sessionId, tab } = request;
  if (!sessionId || !tab || !isLinkable(tab.url)) return makeActionResult();

  return enqueueSessionWrite(async () => {
    const saved = await readSavedSessions();
    const session = findSession(saved, sessionId);
    if (!session) return makeActionResult();

    if (session.tabs.length >= MAX_TABS_PER_SESSION) {
      return makeActionResult({
        status: 'noop',
        changed: 0,
        skipped: 1,
        code: 'SESSION_CAP'
      });
    }

    session.tabs.push({ title: tab.title || tab.url, url: tab.url });
    await writeSavedSessions(applySessionCap(saved));
    return makeActionResult({ changed: 1 });
  });
}

async function sessionAddTab(request = {}) {
  return (await sessionAddTabResult(request)).changed;
}

async function sessionRemoveTab(request = {}) {
  const { sessionId, index } = request;
  return enqueueSessionWrite(async () => {
    const saved = await readSavedSessions();
    const session = findSession(saved, sessionId);
    if (!session || !Number.isInteger(index) || index < 0 || index >= session.tabs.length) return 0;
    session.tabs.splice(index, 1);
    if (session.tabs.length === 0) saved.splice(saved.indexOf(session), 1);
    await writeSavedSessions(applySessionCap(saved));
    return 1;
  });
}

// Groups tabIds under `title`, per window and returns successful group IDs.
async function createGroupsDetailed(entries) {
  const createdGroups = [];
  const op = async (entry) => {
    const groupId = await chrome.tabs.group({ tabIds: entry.tabIds });
    await chrome.tabGroups.update(groupId, { title: entry.title, collapsed: true, color: entry.color });
    createdGroups.push({ groupId, windowId: entry.windowId, tabIds: entry.tabIds });
  };
  const count = await runBatched(
    entries,
    5,
    op,
    (err, entry) => console.error(`Failed to group tabs for "${entry.title}":`, err)
  );
  return { count, groups: createdGroups };
}

// Legacy numeric helper retained for direct tests/internal callers.
async function createGroups(entries) {
  return (await createGroupsDetailed(entries)).count;
}

function buildGroupingResult({ created, mode, regroupedTabs, manualGroupedTabs }) {
  const code = regroupedTabs > 0
    ? 'REGROUPED'
    : manualGroupedTabs > 0
      ? 'PRESERVED_EXISTING_GROUPS'
      : undefined;
  const result = makeActionResult({
    changed: created,
    skipped: manualGroupedTabs,
    code,
    status: created > 0 ? 'ok' : regroupedTabs > 0 ? 'partial' : undefined
  });
  result.mode = mode;
  result.regroupedTabs = regroupedTabs;
  result.manualGroupedTabs = manualGroupedTabs;
  return result;
}

async function arrangeByWebsiteResult({ currentWindow = false } = {}) {
  const queriedTabs = await chrome.tabs.query(currentWindow ? { currentWindow: true } : {});
  const prepared = await prepareTabsForGrouping(queriedTabs);
  const tabs = prepared.tabs;

  const windowGroups = {};
  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (hasExistingGroup(tab)) continue;
    if (!isRestorable(tab.url)) continue;
    if (!windowGroups[tab.windowId]) windowGroups[tab.windowId] = {};
    const domain = getDomain(tab.url);
    if (!windowGroups[tab.windowId][domain]) windowGroups[tab.windowId][domain] = [];
    windowGroups[tab.windowId][domain].push(tab.id);
  }

  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  let created = 0;
  const createdGroups = [];

  for (const [windowId, domainGroups] of Object.entries(windowGroups)) {
    let colorIndex = 0;
    const entries = Object.entries(domainGroups).map(([domain, tabIds]) => ({
      tabIds,
      title: domain,
      color: colors[colorIndex++ % colors.length],
      windowId: Number(windowId)
    }));
    const detail = await createGroupsDetailed(entries);
    created += detail.count;
    createdGroups.push(...detail.groups);
  }

  await rememberCreatedGroups(createdGroups, 'website');
  return buildGroupingResult({
    created,
    mode: 'website',
    regroupedTabs: prepared.regroupedTabs,
    manualGroupedTabs: prepared.manualGroupedTabs
  });
}

async function arrangeByWebsite(options = {}) {
  return (await arrangeByWebsiteResult(options)).changed;
}

async function arrangeByDateResult({ currentWindow = false } = {}) {
  const queriedTabs = await chrome.tabs.query(currentWindow ? { currentWindow: true } : {});
  const prepared = await prepareTabsForGrouping(queriedTabs);
  const tabs = prepared.tabs;

  const groups = {};
  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (hasExistingGroup(tab)) continue;
    if (!isRestorable(tab.url)) continue;
    const bucket = getDateBucket(tab.lastAccessed);

    if (!groups[tab.windowId]) groups[tab.windowId] = {};
    if (!groups[tab.windowId][bucket]) groups[tab.windowId][bucket] = [];
    groups[tab.windowId][bucket].push(tab.id);
  }

  let created = 0;
  const createdGroups = [];
  for (const [windowId, buckets] of Object.entries(groups)) {
    const entries = Object.keys(BUCKET_COLORS)
      .filter(bucket => buckets[bucket]?.length)
      .map(bucket => ({
        tabIds: buckets[bucket],
        title: bucket,
        color: BUCKET_COLORS[bucket],
        windowId: Number(windowId)
      }));
    const detail = await createGroupsDetailed(entries);
    created += detail.count;
    createdGroups.push(...detail.groups);
  }

  await rememberCreatedGroups(createdGroups, 'date');
  return buildGroupingResult({
    created,
    mode: 'date',
    regroupedTabs: prepared.regroupedTabs,
    manualGroupedTabs: prepared.manualGroupedTabs
  });
}

async function arrangeByDate(options = {}) {
  return (await arrangeByDateResult(options)).changed;
}

async function ungroupOrganizedResult() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const registry = await readOwnedGroups();
  const ownedGroupIds = new Set();
  const ownedTabIds = [];
  let manualGroupedTabs = 0;

  for (const tab of tabs) {
    if (!hasExistingGroup(tab)) continue;
    const metadata = registry[String(tab.groupId)];
    if (metadata && metadata.windowId === tab.windowId) {
      ownedGroupIds.add(tab.groupId);
      if (tab.id !== undefined) ownedTabIds.push(tab.id);
    } else {
      manualGroupedTabs++;
    }
  }

  if (ownedTabIds.length > 0) await chrome.tabs.ungroup(ownedTabIds);
  const nextRegistry = removeOwnedEntriesForScope(registry, tabs, ownedGroupIds);
  if (JSON.stringify(nextRegistry) !== JSON.stringify(registry)) await writeOwnedGroups(nextRegistry);

  const result = makeActionResult({
    changed: ownedTabIds.length,
    skipped: manualGroupedTabs,
    code: ownedTabIds.length > 0
      ? 'UNGROUPED_ORGANIZED'
      : manualGroupedTabs > 0
        ? 'PRESERVED_EXISTING_GROUPS'
        : undefined
  });
  result.mode = null;
  result.manualGroupedTabs = manualGroupedTabs;
  return result;
}

async function ungroupOrganized() {
  return (await ungroupOrganizedResult()).changed;
}

async function closeDuplicates() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tabsToRemove = duplicateIdsToRemove(tabs);
  if (tabsToRemove.length > 0) {
    await chrome.tabs.remove(tabsToRemove);
  }
  return tabsToRemove.length;
}

async function sleepInactive() {
  const { sleepHours = DEFAULT_SLEEP_HOURS } = await chrome.storage.sync.get('sleepHours');
  const cutoff = Date.now() - sleepHours * 60 * 60 * 1000;
  const tabs = await chrome.tabs.query({ currentWindow: true, active: false, discarded: false });
  const idleIds = tabs
    .filter(t => !t.audible && !t.pinned && t.lastAccessed && t.lastAccessed <= cutoff)
    .map(t => t.id);
  return runBatched(
    idleIds,
    10,
    id => chrome.tabs.discard(id),
    (err, id) => console.error(`Failed to discard tab ${id}:`, err)
  );
}

let sessionWriteChain = Promise.resolve();

function enqueueSessionWrite(task) {
  const run = sessionWriteChain.then(task, task);
  sessionWriteChain = run.catch(() => {});
  return run;
}

function applySessionCap(sessions) {
  return sessions.slice(0, MAX_SAVED_SESSIONS);
}

async function readSavedSessions() {
  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  return Array.isArray(savedSessions) ? savedSessions : [];
}

async function writeSavedSessions(sessions) {
  try {
    await chrome.storage.local.set({ savedSessions: sessions });
  } catch (err) {
    if (!/quota/i.test(String(err?.message || err))) throw err;
    await chrome.storage.local.set({ savedSessions: applySessionCap(sessions).slice(0, Math.ceil(MAX_SAVED_SESSIONS / 2)) });
  }
}

async function saveSessionResult() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tabsToSave = tabs.filter(t => !t.pinned && isRestorable(t.url));
  if (tabsToSave.length === 0) return makeActionResult();

  const storedTabs = tabsToSave.slice(0, MAX_TABS_PER_SESSION).map(t => ({
    title: t.title || t.url,
    url: t.url
  }));
  const skipped = tabsToSave.length - storedTabs.length;
  const sessionData = {
    id: newSessionId(),
    date: new Date().toISOString(),
    tabs: storedTabs
  };

  await enqueueSessionWrite(async () => {
    const saved = await readSavedSessions();
    saved.unshift(sessionData);
    await writeSavedSessions(applySessionCap(saved));
  });

  // Open the dashboard so the new session is visible immediately;
  // tabs stay open - saving never closes them.
  await chrome.tabs.create({ url: chrome.runtime.getURL('session.html') });

  return makeActionResult({
    status: skipped > 0 ? 'partial' : 'ok',
    changed: storedTabs.length,
    skipped,
    code: skipped > 0 ? 'SESSION_CAP' : undefined
  });
}

async function saveSession() {
  return (await saveSessionResult()).changed;
}

// HANDLERS keeps the existing numeric core API for tests and internal callers.
const HANDLERS = {
  ARRANGE_BY_DATE: arrangeByDate,
  ARRANGE_BY_WEBSITE: arrangeByWebsite,
  UNGROUP_ORGANIZED: ungroupOrganized,
  GROUPING_STATE: groupingState,
  CLOSE_DUPLICATES: closeDuplicates,
  SLEEP_INACTIVE: sleepInactive,
  SAVE_SESSION: saveSession,
  SESSION_DELETE: sessionDelete,
  SESSION_ADD_TAB: sessionAddTab,
  SESSION_REMOVE_TAB: sessionRemoveTab,
  VIEW_SESSIONS: viewSessions,
  UNDO_CLOSE: undoClose,
  PREVIEW: previewCounts
};

// UI/keyboard entry points use safe defaults and structured results.
async function executeAction(request = {}) {
  const action = request?.action;

  if (action === 'PREVIEW') {
    return { status: 'done', count: await previewCounts() };
  }
  if (action === 'GROUPING_STATE') {
    return { status: 'done', count: await groupingState() };
  }

  let result;
  switch (action) {
    case 'ARRANGE_BY_WEBSITE':
      result = await arrangeByWebsiteResult({ currentWindow: request?.allWindows !== true });
      break;
    case 'ARRANGE_BY_DATE':
      result = await arrangeByDateResult({ currentWindow: request?.allWindows !== true });
      break;
    case 'UNGROUP_ORGANIZED':
      result = await ungroupOrganizedResult();
      break;
    case 'SAVE_SESSION':
      result = await saveSessionResult();
      break;
    case 'SESSION_ADD_TAB':
      result = await sessionAddTabResult(request);
      break;
    default: {
      const handler = HANDLERS[action];
      if (!handler) return null;
      const changed = await handler(request);
      result = makeActionResult({ changed: typeof changed === 'number' ? changed : 0 });
    }
  }

  return { status: 'done', count: result.changed, result };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!HANDLERS[request?.action]) return;
  executeAction(request)
    .then((response) => sendResponse(response))
    .catch((err) => sendResponse({ status: 'error', error: err?.message || String(err) }));
  return true;
});

// Keyboard commands use the same safe defaults as popup actions.
chrome.commands.onCommand.addListener((command) => {
  if (!HANDLERS[command]) return;
  executeAction({ action: command })
    .catch((err) => console.error(`${command} failed:`, err));
});
