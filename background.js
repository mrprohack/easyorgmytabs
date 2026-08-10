importScripts('logic.js');

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

// Groups tabIds under `title`, per window. Returns the number of groups created.
async function createGroups(entries) {
  const op = async (entry) => {
    const groupId = await chrome.tabs.group({ tabIds: entry.tabIds });
    await chrome.tabGroups.update(groupId, { title: entry.title, collapsed: true, color: entry.color });
  };
  return runBatched(
    entries,
    5,
    op,
    (err, entry) => console.error(`Failed to group tabs for "${entry.title}":`, err)
  );
}

async function arrangeByWebsiteResult({ currentWindow = false } = {}) {
  const tabs = await chrome.tabs.query(currentWindow ? { currentWindow: true } : {});
  const existingGroupCount = tabs.filter(hasExistingGroup).length;

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
  for (const domainGroups of Object.values(windowGroups)) {
    let colorIndex = 0;
    const entries = Object.entries(domainGroups).map(([domain, tabIds]) => ({
      tabIds,
      title: domain,
      color: colors[colorIndex++ % colors.length]
    }));
    created += await createGroups(entries);
  }

  return makeActionResult({
    changed: created,
    skipped: existingGroupCount,
    code: existingGroupCount > 0 ? 'PRESERVED_EXISTING_GROUPS' : undefined
  });
}

async function arrangeByWebsite(options = {}) {
  return (await arrangeByWebsiteResult(options)).changed;
}

async function arrangeByDateResult({ currentWindow = false } = {}) {
  const tabs = await chrome.tabs.query(currentWindow ? { currentWindow: true } : {});
  const existingGroupCount = tabs.filter(hasExistingGroup).length;

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
  for (const buckets of Object.values(groups)) {
    const entries = Object.keys(BUCKET_COLORS)
      .filter(bucket => buckets[bucket]?.length)
      .map(bucket => ({ tabIds: buckets[bucket], title: bucket, color: BUCKET_COLORS[bucket] }));
    created += await createGroups(entries);
  }

  return makeActionResult({
    changed: created,
    skipped: existingGroupCount,
    code: existingGroupCount > 0 ? 'PRESERVED_EXISTING_GROUPS' : undefined
  });
}

async function arrangeByDate(options = {}) {
  return (await arrangeByDateResult(options)).changed;
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

  let result;
  switch (action) {
    case 'ARRANGE_BY_WEBSITE':
      result = await arrangeByWebsiteResult({ currentWindow: request?.allWindows !== true });
      break;
    case 'ARRANGE_BY_DATE':
      result = await arrangeByDateResult({ currentWindow: request?.allWindows !== true });
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
