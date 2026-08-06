chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ARRANGE_BY_WEBSITE') {
    arrangeByWebsite()
      .then(() => sendResponse({ status: 'done' }))
      .catch((err) => sendResponse({ status: 'error', error: err ? err.message : String(err) }));
    return true;
  } else if (request.action === 'ARRANGE_BY_DATE') {
    // arrangeByDate(); // Will be implemented in Task 4
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
