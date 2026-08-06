import { ensureDefaults } from './lib/settings.js';

let badgeTimer;

async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});
    const text = tabs.length > 999 ? '999+' : String(tabs.length);
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  } catch (error) {
    console.warn('Could not update tab badge:', error);
  }
}

function scheduleBadgeUpdate() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(updateBadge, 120);
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);
chrome.tabs.onCreated.addListener(scheduleBadgeUpdate);
chrome.tabs.onRemoved.addListener(scheduleBadgeUpdate);
chrome.tabs.onAttached.addListener(scheduleBadgeUpdate);
chrome.tabs.onDetached.addListener(scheduleBadgeUpdate);
chrome.tabs.onUpdated.addListener(scheduleBadgeUpdate);
chrome.windows.onCreated.addListener(scheduleBadgeUpdate);
chrome.windows.onRemoved.addListener(scheduleBadgeUpdate);

updateBadge();
