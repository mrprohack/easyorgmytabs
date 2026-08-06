import { validateSessionImport } from '../lib/core.js';
import { restoreSession } from '../lib/chrome-api.js';
import {
  DEFAULT_SETTINGS,
  loadSessions,
  loadSettings,
  saveSessions,
  saveSettings,
} from '../lib/settings.js';

const state = {
  settings: { ...DEFAULT_SETTINGS },
  sessions: [],
};

const elements = {
  form: document.querySelector('#settings-form'),
  theme: document.querySelector('#theme'),
  groupBy: document.querySelector('#group-by'),
  sortBy: document.querySelector('#sort-by'),
  confirmBulkClose: document.querySelector('#confirm-bulk-close'),
  preservePinned: document.querySelector('#preserve-pinned'),
  resetSettings: document.querySelector('#reset-settings'),
  sessionSummary: document.querySelector('#session-summary'),
  sessionsList: document.querySelector('#sessions-list'),
  sessionsEmpty: document.querySelector('#sessions-empty'),
  importButton: document.querySelector('#import-button'),
  importFile: document.querySelector('#import-file'),
  exportAll: document.querySelector('#export-all'),
  status: document.querySelector('#status'),
};

let statusTimer;

function applyTheme(theme) {
  document.documentElement.removeAttribute('data-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
}

function setStatus(message, isError = false) {
  clearTimeout(statusTimer);
  elements.status.textContent = message;
  elements.status.classList.toggle('error', isError);
  elements.status.classList.add('visible');
  statusTimer = setTimeout(() => elements.status.classList.remove('visible'), 3500);
}

function syncForm() {
  elements.theme.value = state.settings.theme;
  elements.groupBy.value = state.settings.groupBy;
  elements.sortBy.value = state.settings.sortBy;
  elements.confirmBulkClose.checked = state.settings.confirmBulkClose;
  elements.preservePinned.checked = state.settings.preservePinnedDuplicates;
  applyTheme(state.settings.theme);
}

function sessionTabCount(session) {
  return session.windows.reduce((total, windowItem) => total + windowItem.tabs.length, 0);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportPayload(sessions) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions,
  };
}

async function persistSessions(nextSessions, message) {
  state.sessions = await saveSessions(nextSessions);
  renderSessions();
  setStatus(message);
}

function createSessionCard(session) {
  const card = document.createElement('article');
  card.className = 'session-card';
  card.dataset.sessionId = session.id;

  const details = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = session.name;
  title.title = session.name;
  const meta = document.createElement('p');
  meta.className = 'session-meta';
  const tabCount = sessionTabCount(session);
  meta.textContent = `${tabCount} tab${tabCount === 1 ? '' : 's'} · ${session.windows.length} window${session.windows.length === 1 ? '' : 's'} · ${formatDate(session.createdAt)}`;
  details.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'session-actions';
  const actionsConfig = [
    ['restore', 'Restore', 'primary-button'],
    ['rename', 'Rename', ''],
    ['export', 'Export', ''],
    ['delete', 'Delete', 'danger-button'],
  ];
  for (const [action, label, className] of actionsConfig) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.className = className;
    button.textContent = label;
    actions.append(button);
  }

  card.append(details, actions);
  return card;
}

function renderSessions() {
  const totalTabs = state.sessions.reduce((sum, session) => sum + sessionTabCount(session), 0);
  elements.sessionSummary.textContent = state.sessions.length
    ? `${state.sessions.length} saved session${state.sessions.length === 1 ? '' : 's'} containing ${totalTabs} tabs.`
    : 'No sessions saved.';
  elements.exportAll.disabled = state.sessions.length === 0;
  elements.sessionsList.replaceChildren(...state.sessions.map(createSessionCard));
  elements.sessionsList.hidden = state.sessions.length === 0;
  elements.sessionsEmpty.hidden = state.sessions.length !== 0;
}

async function handleSessionAction(action, session) {
  if (action === 'restore') {
    try {
      setStatus(`Restoring “${session.name}”…`);
      const count = await restoreSession(session);
      setStatus(`Restored ${count} tabs from “${session.name}”.`);
    } catch (error) {
      setStatus(error.message || 'Could not restore this session.', true);
    }
    return;
  }

  if (action === 'rename') {
    const nextName = prompt('Rename saved session:', session.name);
    if (nextName === null || !nextName.trim()) return;
    await persistSessions(
      state.sessions.map((item) => item.id === session.id ? { ...item, name: nextName.trim() } : item),
      'Session renamed.',
    );
    return;
  }

  if (action === 'export') {
    downloadJson(`easy-tabs-${session.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'session'}.json`, exportPayload([session]));
    setStatus('Session exported.');
    return;
  }

  if (action === 'delete') {
    if (!confirm(`Delete the saved session “${session.name}”?`)) return;
    await persistSessions(state.sessions.filter((item) => item.id !== session.id), 'Session deleted.');
  }
}

async function initialize() {
  try {
    const [settings, sessions] = await Promise.all([loadSettings(), loadSessions()]);
    state.settings = settings;
    state.sessions = sessions;
    syncForm();
    renderSessions();
  } catch (error) {
    syncForm();
    renderSessions();
    setStatus(error.message || 'Could not load extension settings.', true);
  }
}

elements.form.addEventListener('change', async () => {
  const next = {
    theme: elements.theme.value,
    groupBy: elements.groupBy.value,
    sortBy: elements.sortBy.value,
    confirmBulkClose: elements.confirmBulkClose.checked,
    preservePinnedDuplicates: elements.preservePinned.checked,
  };
  try {
    state.settings = await saveSettings(next);
    syncForm();
    setStatus('Preferences saved.');
  } catch (error) {
    setStatus(error.message || 'Could not save preferences.', true);
  }
});

elements.resetSettings.addEventListener('click', async () => {
  if (!confirm('Reset all preferences to their defaults?')) return;
  state.settings = await saveSettings({ ...DEFAULT_SETTINGS });
  syncForm();
  setStatus('Preferences reset.');
});

elements.sessionsList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  const card = event.target.closest('[data-session-id]');
  if (!button || !card) return;
  const session = state.sessions.find((item) => item.id === card.dataset.sessionId);
  if (session) handleSessionAction(button.dataset.action, session);
});

elements.exportAll.addEventListener('click', () => {
  if (!state.sessions.length) return;
  downloadJson(`easy-organize-tabs-${new Date().toISOString().slice(0, 10)}.json`, exportPayload(state.sessions));
  setStatus('All sessions exported.');
});

elements.importButton.addEventListener('click', () => elements.importFile.click());

elements.importFile.addEventListener('change', async () => {
  const [file] = elements.importFile.files;
  elements.importFile.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    setStatus('Import file must be smaller than 10 MB.', true);
    return;
  }

  try {
    const payload = validateSessionImport(JSON.parse(await file.text()));
    const importedIds = new Set(payload.sessions.map((session) => session.id));
    const merged = [...payload.sessions, ...state.sessions.filter((session) => !importedIds.has(session.id))].slice(0, 500);
    await persistSessions(merged, `Imported ${payload.sessions.length} session${payload.sessions.length === 1 ? '' : 's'}.`);
  } catch (error) {
    setStatus(error.message || 'The selected JSON file is invalid.', true);
  }
});

initialize();
