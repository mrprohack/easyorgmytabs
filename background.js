chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ARRANGE_BY_WEBSITE') {
    arrangeByWebsite().then(() => sendResponse({ status: 'done' }));
    return true;
  } else if (request.action === 'ARRANGE_BY_DATE') {
    // arrangeByDate(); // Will be implemented in Task 4
  }
});

async function ungroupAllTabs() {
  const tabs = await chrome.tabs.query({});
  const tabIds = tabs.map(t => t.id).filter(id => id !== undefined);
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
  
  const groups = {};
  for (const tab of tabs) {
    const domain = getDomain(tab.url);
    if (!groups[domain]) groups[domain] = [];
    groups[domain].push(tab.id);
  }

  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  let colorIndex = 0;

  for (const [domain, tabIds] of Object.entries(groups)) {
    if (tabIds.length > 0) {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, { 
        title: domain, 
        collapsed: true,
        color: colors[colorIndex % colors.length] 
      });
      colorIndex++;
    }
  }
}
