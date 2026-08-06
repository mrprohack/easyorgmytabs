function ensureChromeApi(path) {
  const parts = path.split('.');
  let value = globalThis.chrome;
  for (const part of parts) value = value?.[part];
  if (!value) throw new Error(`Chrome API ${path} is unavailable.`);
  return value;
}

export async function queryTabs(queryInfo = {}) {
  ensureChromeApi('tabs.query');
  return chrome.tabs.query(queryInfo);
}

export async function getAllTabs() {
  return queryTabs({});
}

export async function getCurrentWindowTabs() {
  return queryTabs({ currentWindow: true });
}

export async function activateTab(tab) {
  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
    throw new Error('Cannot activate an invalid tab.');
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

export async function closeTabs(tabIds) {
  const ids = [...new Set(tabIds)].filter(Number.isInteger);
  if (ids.length) await chrome.tabs.remove(ids);
}

export async function reloadTabs(tabIds) {
  const ids = [...new Set(tabIds)].filter(Number.isInteger);
  await Promise.all(ids.map((id) => chrome.tabs.reload(id)));
}

export async function updateTabs(tabIds, properties) {
  const ids = [...new Set(tabIds)].filter(Number.isInteger);
  await Promise.all(ids.map((id) => chrome.tabs.update(id, properties)));
}

export async function openOptionsPage() {
  await chrome.runtime.openOptionsPage();
}

function isRestorableUrl(value) {
  try {
    return ['http:', 'https:', 'file:', 'ftp:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export async function restoreSession(session) {
  if (!session?.windows?.length) throw new Error('This saved session is empty.');

  let createdCount = 0;
  for (const [windowIndex, savedWindow] of session.windows.entries()) {
    const tabs = savedWindow.tabs.filter((tab) => isRestorableUrl(tab.url));
    if (!tabs.length) continue;

    const createdWindow = await chrome.windows.create({
      url: tabs.map((tab) => tab.url),
      focused: windowIndex === 0,
    });

    const createdTabs = createdWindow.tabs ?? await chrome.tabs.query({ windowId: createdWindow.id });
    await Promise.all(createdTabs.map((createdTab, tabIndex) => {
      if (!tabs[tabIndex]?.pinned || !Number.isInteger(createdTab.id)) return Promise.resolve();
      return chrome.tabs.update(createdTab.id, { pinned: true });
    }));
    createdCount += tabs.length;
  }

  if (!createdCount) throw new Error('The session contains no restorable web URLs.');
  return createdCount;
}
