chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action === 'ARRANGE_BY_WEBSITE') {
    arrangeByWebsite()
      .then(() => sendResponse({ status: 'done' }))
      .catch((err) => sendResponse({ status: 'error', error: err?.message || String(err) }));
    return true;
  } else if (request?.action === 'ARRANGE_BY_DATE') {
    arrangeByDate()
      .then(() => sendResponse({ status: 'done' }))
      .catch((err) => sendResponse({ status: 'error', error: err?.message || String(err) }));
    return true;
  } else if (request?.action === 'CLOSE_DUPLICATES') {
    closeDuplicates()
      .then(() => sendResponse({ status: 'done' }))
      .catch((err) => sendResponse({ status: 'error', error: err?.message || String(err) }));
    return true;
  } else if (request?.action === 'SLEEP_INACTIVE') {
    sleepInactive()
      .then(() => sendResponse({ status: 'done' }))
      .catch((err) => sendResponse({ status: 'error', error: err?.message || String(err) }));
    return true;
  } else if (request?.action === 'SAVE_SESSION') {
    saveSession()
      .then(() => sendResponse({ status: 'done' }))
      .catch((err) => sendResponse({ status: 'error', error: err?.message || String(err) }));
    return true;
  }
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

function getDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname || 'New Tab';
  } catch (e) {
    return 'Other';
  }
}

async function arrangeByWebsite() {
  const tabs = await ungroupAllTabs();
  
  const windowGroups = {};
  for (const tab of tabs) {
    if (tab.pinned) continue; // Pinned tabs cannot be grouped in Chrome
    if (!windowGroups[tab.windowId]) windowGroups[tab.windowId] = {};
    const domain = getDomain(tab.url);
    if (!windowGroups[tab.windowId][domain]) windowGroups[tab.windowId][domain] = [];
    windowGroups[tab.windowId][domain].push(tab.id);
  }

  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

  for (const [windowId, domainGroups] of Object.entries(windowGroups)) {
    let colorIndex = 0;
    for (const [domain, tabIds] of Object.entries(domainGroups)) {
      if (tabIds.length > 0) {
        try {
          const groupId = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(groupId, { 
            title: domain, 
            collapsed: true,
            color: colors[colorIndex % colors.length] 
          });
          colorIndex++;
        } catch (e) {
          console.error(`Failed to group tabs for domain ${domain}:`, e);
        }
      }
    }
  }
}

function getDateBucket(lastAccessed) {
  if (!lastAccessed) return 'Unknown';
  
  const now = new Date();
  const accessedDate = new Date(lastAccessed);
  if (isNaN(accessedDate.getTime())) return 'Unknown';
  
  const diffTime = Math.abs(now - accessedDate);
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  
  if (diffDays < 1) return 'Today';
  if (diffDays < 7) return 'This Week';
  if (diffDays < 14) return 'Last Week';
  if (diffDays < 30) return 'This Month';
  return 'Older';
}

async function arrangeByDate() {
  const tabs = await ungroupAllTabs();
  
  const groups = {};
  for (const tab of tabs) {
    if (tab.pinned) continue;
    const bucket = getDateBucket(tab.lastAccessed);
    
    if (!groups[tab.windowId]) groups[tab.windowId] = {};
    if (!groups[tab.windowId][bucket]) groups[tab.windowId][bucket] = [];
    
    groups[tab.windowId][bucket].push(tab.id);
  }

  const bucketColors = {
    'Today': 'green',
    'This Week': 'blue',
    'Last Week': 'purple',
    'This Month': 'yellow',
    'Older': 'grey',
    'Unknown': 'grey'
  };

  const BUCKET_ORDER = ['Today', 'This Week', 'Last Week', 'This Month', 'Older', 'Unknown'];

  for (const windowId of Object.keys(groups)) {
    for (const bucket of BUCKET_ORDER) {
      const tabIds = groups[windowId]?.[bucket];
      if (tabIds && tabIds.length > 0) {
        try {
          const groupId = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(groupId, { 
            title: bucket, 
            collapsed: true,
            color: bucketColors[bucket]
          });
        } catch (e) {
          console.error(`Failed to group tabs for bucket ${bucket}:`, e);
        }
      }
    }
  }
}

async function closeDuplicates() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const seenUrls = new Set();
  const tabsToRemove = [];

  for (const tab of tabs) {
    if (seenUrls.has(tab.url)) {
      tabsToRemove.push(tab.id);
    } else {
      seenUrls.add(tab.url);
    }
  }

  if (tabsToRemove.length > 0) {
    await chrome.tabs.remove(tabsToRemove);
  }
}

async function sleepInactive() {
  const tabs = await chrome.tabs.query({ active: false, discarded: false });
  const now = new Date().getTime();
  
  for (const tab of tabs) {
    if (tab.audible || tab.pinned) continue; // Don't sleep playing media or pinned tabs
    
    const lastAccessed = tab.lastAccessed ? new Date(tab.lastAccessed).getTime() : now;
    const diffHours = (now - lastAccessed) / (1000 * 60 * 60);
    
    // Discard tabs not accessed in the last 1 hour
    if (diffHours > 1) {
      try {
        await chrome.tabs.discard(tab.id);
      } catch (e) {
        console.error("Failed to discard tab:", e);
      }
    }
  }
}

async function saveSession() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tabsToSave = tabs.filter(t => !t.pinned && !t.url.startsWith('chrome://'));
  
  const sessionData = {
    date: new Date().toISOString(),
    tabs: tabsToSave.map(t => ({ title: t.title, url: t.url }))
  };

  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  savedSessions.unshift(sessionData);
  
  await chrome.storage.local.set({ savedSessions });
  
  // Close the saved tabs
  await chrome.tabs.remove(tabsToSave.map(t => t.id));
  
  // Open the session viewer page
  await chrome.tabs.create({ url: chrome.runtime.getURL('session.html') });
}
