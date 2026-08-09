importScripts('logic.js');
const HANDLERS = {
  ARRANGE_BY_DATE: arrangeByDate,
  ARRANGE_BY_WEBSITE: arrangeByWebsite,
  CLOSE_DUPLICATES: closeDuplicates,
  SLEEP_INACTIVE: sleepInactive,
  SAVE_SESSION: saveSession
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = HANDLERS[request?.action];
  if (!handler) return;

  handler()
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
  let created = 0;
  for (const { tabIds, title, color } of entries) {
    if (!tabIds.length) continue;
    try {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, { title, collapsed: true, color });
      created++;
    } catch (e) {
      console.error(`Failed to group tabs for "${title}":`, e);
    }
  }
  return created;
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

const DEFAULT_SLEEP_HOURS = 1;

async function sleepInactive() {
  const { sleepHours = DEFAULT_SLEEP_HOURS } = await chrome.storage.sync.get('sleepHours');
  const cutoff = Date.now() - sleepHours * 60 * 60 * 1000;
  const tabs = await chrome.tabs.query({ active: false, discarded: false });

  let slept = 0;
  for (const tab of tabs) {
    if (tab.audible || tab.pinned) continue; // Don't sleep playing media or pinned tabs
    if (!tab.lastAccessed || tab.lastAccessed > cutoff) continue;

    try {
      await chrome.tabs.discard(tab.id);
      slept++;
    } catch (e) {
      console.error("Failed to discard tab:", e);
    }
  }
  return slept;
}

async function saveSession() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tabsToSave = tabs.filter(t => !t.pinned && isRestorable(t.url));
  if (tabsToSave.length === 0) return 0;

  const sessionData = {
    date: new Date().toISOString(),
    tabs: tabsToSave.map(t => ({ title: t.title || t.url, url: t.url }))
  };

  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  savedSessions.unshift(sessionData);
  await chrome.storage.local.set({ savedSessions });

  // Open the dashboard before closing anything, or saving every tab closes the window.
  await chrome.tabs.create({ url: chrome.runtime.getURL('session.html') });
  await chrome.tabs.remove(tabsToSave.map(t => t.id));

  return tabsToSave.length;
}

