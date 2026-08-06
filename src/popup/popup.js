import {
  createSession,
  duplicateTabIdsToClose,
  filterTabs,
  findDuplicateGroups,
  getDomain,
  groupTabs,
  sortTabs,
} from '../lib/core.js';
import {
  activateTab,
  closeTabs,
  getAllTabs,
  getCurrentWindowTabs,
  openOptionsPage,
  reloadTabs,
  updateTabs,
} from '../lib/chrome-api.js';
import { addSession, loadSettings, saveSettings } from '../lib/settings.js';

const state = {
  tabs: [],
  selected: new Set(),
  settings: null,
  query: '',
  busy: false,
};

const elements = {
  totalCount: document.querySelector('#total-count'),
  duplicateCount: document.querySelector('#duplicate-count'),
  selectedCount: document.querySelector('#selected-count'),
  searchInput: document.querySelector('#search-input'),
  groupSelect: document.querySelector('#group-select'),
  sortSelect: document.querySelector('#sort-select'),
  selectVisible: document.querySelector('#select-visible'),
  clearSelection: document.querySelector('#clear-selection'),
  closeDuplicates: document.querySelector('#close-duplicates'),
  bulkActions: document.querySelector('#bulk-actions'),
  tabGroups: document.querySelector('#tab-groups'),
  emptyState: document.querySelector('#empty-state'),
  saveWindow: document.querySelector('#save-window'),
  saveAll: document.querySelector('#save-all'),
  openOptions: document.querySelector('#open-options'),
  status: document.querySelector('#status'),
};

function applyTheme(theme) {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
}

function setStatus(message = '', isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('error', isError);
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll('button, select').forEach((control) => {
    control.disabled = busy;
  });
}

function visibleTabs() {
  return sortTabs(filterTabs(state.tabs, state.query), state.settings.sortBy);
}

function syncSelection() {
  const availableIds = new Set(state.tabs.map((tab) => tab.id));
  state.selected = new Set([...state.selected].filter((id) => availableIds.has(id)));
}

function createFavicon(tab) {
  if (!tab.favIconUrl) {
    const fallback = document.createElement('span');
    fallback.className = 'favicon-fallback';
    fallback.textContent = (getDomain(tab.url)[0] || '?').toUpperCase();
    fallback.setAttribute('aria-hidden', 'true');
    return fallback;
  }

  const image = document.createElement('img');
  image.className = 'favicon';
  image.src = tab.favIconUrl;
  image.alt = '';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => image.replaceWith(createFavicon({ ...tab, favIconUrl: '' })), { once: true });
  return image;
}

function iconButton(label, icon, handler, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = extraClass;
  button.textContent = icon;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', handler);
  return button;
}

async function runAction(action, ids) {
  const uniqueIds = [...new Set(ids)].filter(Number.isInteger);
  if (!uniqueIds.length) return;

  if (action === 'close' && state.settings.confirmBulkClose && uniqueIds.length > 1) {
    const confirmed = confirm(`Close ${uniqueIds.length} selected tabs?`);
    if (!confirmed) return;
  }

  setBusy(true);
  setStatus('Working…');
  try {
    if (action === 'close') await closeTabs(uniqueIds);
    if (action === 'reload') await reloadTabs(uniqueIds);
    if (action === 'pin') await updateTabs(uniqueIds, { pinned: true });
    if (action === 'unpin') await updateTabs(uniqueIds, { pinned: false });
    if (action === 'mute') await updateTabs(uniqueIds, { muted: true });
    if (action === 'unmute') await updateTabs(uniqueIds, { muted: false });
    if (action === 'close') uniqueIds.forEach((id) => state.selected.delete(id));
    await refreshTabs();
    setStatus(`${uniqueIds.length} tab${uniqueIds.length === 1 ? '' : 's'} updated.`);
  } catch (error) {
    setStatus(error.message || 'The tab action failed.', true);
  } finally {
    setBusy(false);
    render();
  }
}

function createTabRow(tab) {
  const row = document.createElement('article');
  row.className = 'tab-row';
  row.dataset.active = String(Boolean(tab.active));

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = state.selected.has(tab.id);
  checkbox.setAttribute('aria-label', `Select ${tab.title || tab.url}`);
  checkbox.addEventListener('change', () => {
    checkbox.checked ? state.selected.add(tab.id) : state.selected.delete(tab.id);
    render();
  });

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'tab-main';
  main.title = tab.url || tab.title;
  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || 'Untitled tab';
  const url = document.createElement('span');
  url.className = 'tab-url';
  url.textContent = getDomain(tab.url);
  main.append(title, url);
  main.addEventListener('click', async () => {
    try {
      await activateTab(tab);
      window.close();
    } catch (error) {
      setStatus(error.message || 'Could not activate this tab.', true);
    }
  });

  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  actions.append(
    iconButton(tab.pinned ? 'Unpin tab' : 'Pin tab', tab.pinned ? '◆' : '◇', () => runAction(tab.pinned ? 'unpin' : 'pin', [tab.id])),
    iconButton(tab.mutedInfo?.muted ? 'Unmute tab' : 'Mute tab', tab.mutedInfo?.muted ? '🔇' : '🔊', () => runAction(tab.mutedInfo?.muted ? 'unmute' : 'mute', [tab.id])),
    iconButton('Close tab', '×', () => runAction('close', [tab.id]), 'close-tab'),
  );

  row.append(checkbox, createFavicon(tab), main, actions);
  return row;
}

function createGroup(name, tabs) {
  const section = document.createElement('section');
  section.className = 'tab-group';

  const header = document.createElement('header');
  header.className = 'group-header';
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  const allSelected = tabs.length > 0 && tabs.every((tab) => state.selected.has(tab.id));
  const partlySelected = tabs.some((tab) => state.selected.has(tab.id)) && !allSelected;
  checkbox.checked = allSelected;
  checkbox.indeterminate = partlySelected;
  checkbox.setAttribute('aria-label', `Select all tabs in ${name}`);
  checkbox.addEventListener('change', () => {
    tabs.forEach((tab) => checkbox.checked ? state.selected.add(tab.id) : state.selected.delete(tab.id));
    render();
  });
  const heading = document.createElement('span');
  heading.textContent = name;
  label.append(checkbox, heading);
  const count = document.createElement('span');
  count.className = 'group-count';
  count.textContent = `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`;
  header.append(label, count);
  section.append(header, ...tabs.map(createTabRow));
  return section;
}

function render() {
  syncSelection();
  const visible = visibleTabs();
  const duplicates = findDuplicateGroups(state.tabs).reduce((sum, group) => sum + group.length - 1, 0);

  elements.totalCount.textContent = String(state.tabs.length);
  elements.duplicateCount.textContent = String(duplicates);
  elements.selectedCount.textContent = String(state.selected.size);
  elements.groupSelect.value = state.settings.groupBy;
  elements.sortSelect.value = state.settings.sortBy;
  elements.closeDuplicates.disabled = state.busy || duplicates === 0;
  elements.clearSelection.disabled = state.busy || state.selected.size === 0;
  elements.selectVisible.disabled = state.busy || visible.length === 0;
  elements.bulkActions.querySelectorAll('button').forEach((button) => {
    button.disabled = state.busy || state.selected.size === 0;
  });

  elements.tabGroups.replaceChildren(...groupTabs(visible, state.settings.groupBy).map(([name, tabs]) => createGroup(name, tabs)));
  elements.tabGroups.hidden = visible.length === 0;
  elements.emptyState.hidden = visible.length !== 0;
}

async function refreshTabs() {
  state.tabs = await getAllTabs();
  syncSelection();
  render();
}

async function saveSession(scope) {
  setBusy(true);
  try {
    const tabs = scope === 'window' ? await getCurrentWindowTabs() : await getAllTabs();
    if (!tabs.length) throw new Error('There are no tabs to save.');
    const defaultName = scope === 'window' ? `Window session — ${new Date().toLocaleDateString()}` : `All tabs — ${new Date().toLocaleDateString()}`;
    const name = prompt('Name this saved session:', defaultName);
    if (name === null) return;
    const session = createSession(tabs, name);
    await addSession(session);
    setStatus(`Saved “${session.name}” with ${tabs.length} tabs.`);
  } catch (error) {
    setStatus(error.message || 'Could not save this session.', true);
  } finally {
    setBusy(false);
    render();
  }
}

async function initialize() {
  try {
    const [settings, tabs] = await Promise.all([loadSettings(), getAllTabs()]);
    state.settings = settings;
    state.tabs = tabs;
    elements.searchInput.value = state.query;
    applyTheme(settings.theme);
    render();
  } catch (error) {
    state.settings = {
      theme: 'system', groupBy: 'window', sortBy: 'position', confirmBulkClose: true, preservePinnedDuplicates: true,
    };
    setStatus(error.message || 'Could not load browser tabs.', true);
    render();
  }
}

elements.searchInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  render();
});

elements.groupSelect.addEventListener('change', async (event) => {
  state.settings = await saveSettings({ groupBy: event.target.value });
  render();
});

elements.sortSelect.addEventListener('change', async (event) => {
  state.settings = await saveSettings({ sortBy: event.target.value });
  render();
});

elements.selectVisible.addEventListener('click', () => {
  visibleTabs().forEach((tab) => state.selected.add(tab.id));
  render();
});

elements.clearSelection.addEventListener('click', () => {
  state.selected.clear();
  render();
});

elements.closeDuplicates.addEventListener('click', async () => {
  const ids = duplicateTabIdsToClose(state.tabs, state.settings.preservePinnedDuplicates);
  if (!ids.length) return;
  await runAction('close', ids);
});

elements.bulkActions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-bulk-action]');
  if (button) runAction(button.dataset.bulkAction, [...state.selected]);
});

elements.saveWindow.addEventListener('click', () => saveSession('window'));
elements.saveAll.addEventListener('click', () => saveSession('all'));
elements.openOptions.addEventListener('click', openOptionsPage);

chrome.tabs.onCreated.addListener(refreshTabs);
chrome.tabs.onRemoved.addListener(refreshTabs);
chrome.tabs.onUpdated.addListener(refreshTabs);
chrome.tabs.onMoved.addListener(refreshTabs);

initialize();
