importScripts('logic.js');
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

async function sessionAddTab(request = {}) {
  const { sessionId, tab } = request;
  if (!sessionId || !tab || !isLinkable(tab.url)) return 0;
  return enqueueSessionWrite(async () => {
    const saved = await readSavedSessions();
    const session = findSession(saved, sessionId);
    if (!session) return 0;
    session.tabs.push({ title: tab.title || tab.url, url: tab.url });
    session.tabs = session.tabs.slice(0, MAX_TABS_PER_SESSION);
    await writeSavedSessions(applySessionCap(saved));
    return 1;
  });
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
const HANDLERS = {
  ARRANGE_BY_DATE: arrangeByDate,
  ARRANGE_BY_WEBSITE: arrangeByWebsite,
  CLOSE_DUPLICATES: closeDuplicates,
  SLEEP_INACTIVE: sleepInactive,
  SAVE_SESSION: saveSession,
  SESSION_DELETE: sessionDelete,
  SESSION_ADD_TAB: sessionAddTab,
  SESSION_REMOVE_TAB: sessionRemoveTab
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = HANDLERS[request?.action];
  if (!handler) return;
  handler(request)
    .then((count) => sendResponse({ status: 'done', count }))
    .catch((err) => sendResponse({ status: 'error', error: err?.message || String(err) }));
  return true;
});

// Command names match the message actions above.
chrome.commands.onCommand.addListener((command) => {
  HANDLERS[command]?.().catch((err) => console.error(`${command} failed:`, err));
});

async function ungroupAllTabs() {
  const tabs = await chrome.tabs.query({});
  const tabIds = tabs.filter(t => t.id !== undefined && !t.pinned).map(t => t.id);
  if (tabIds.length > 0) {
    try {
      await chrome.tabs.ungroup(tabIds);
    } catch (e) {
      // Ignore errors if tabs were already ungrouped
    }
  }
  return tabs;
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
async function arrangeByWebsite() {
  const tabs = await ungroupAllTabs();

  const windowGroups = {};
  for (const tab of tabs) {
    if (tab.pinned) continue; // Pinned tabs cannot be grouped in Chrome
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
  return created;
}

async function arrangeByDate() {
  const tabs = await ungroupAllTabs();

  const groups = {};
  for (const tab of tabs) {
    if (tab.pinned) continue;
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
  return created;
}

async function closeDuplicates() {
  const tabs = await chrome.tabs.query({ currentWindow: true });

  const byUrl = new Map();
  for (const tab of tabs) {
    const key = dedupeKey(tab.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(tab);
  }

  const tabsToRemove = [];
  for (const copies of byUrl.values()) {
    if (copies.length < 2) continue;
    // Keep the pinned copy if there is one, then the active one, then whatever came first.
    const keeper = copies.find(t => t.pinned) || copies.find(t => t.active) || copies[0];
    tabsToRemove.push(...copies.filter(t => t !== keeper && !t.pinned).map(t => t.id));
  }

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
async function saveSession() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tabsToSave = tabs.filter(t => !t.pinned && isRestorable(t.url));
  if (tabsToSave.length === 0) return 0;

  const sessionData = {
    id: newSessionId(),
    date: new Date().toISOString(),
    tabs: tabsToSave.slice(0, MAX_TABS_PER_SESSION).map(t => ({ title: t.title || t.url, url: t.url }))
  };

  await enqueueSessionWrite(async () => {
    const saved = await readSavedSessions();
    saved.unshift(sessionData);
    await writeSavedSessions(applySessionCap(saved));
  });

  // Open the dashboard before closing anything, or saving every tab closes the window.
  await chrome.tabs.create({ url: chrome.runtime.getURL('session.html') });
  await chrome.tabs.remove(tabsToSave.map(t => t.id));

  return tabsToSave.length;
}
