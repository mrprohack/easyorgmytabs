export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  groupBy: 'window',
  sortBy: 'position',
  confirmBulkClose: true,
  preservePinnedDuplicates: true,
});

const SETTINGS_KEY = 'settings';
const SESSIONS_KEY = 'sessions';

function storage() {
  if (!globalThis.chrome?.storage?.local) throw new Error('Extension storage is unavailable.');
  return chrome.storage.local;
}

export async function loadSettings() {
  const result = await storage().get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] ?? {}) };
}

export async function saveSettings(partialSettings) {
  const next = { ...(await loadSettings()), ...partialSettings };
  await storage().set({ [SETTINGS_KEY]: next });
  return next;
}

export async function loadSessions() {
  const result = await storage().get(SESSIONS_KEY);
  return Array.isArray(result[SESSIONS_KEY]) ? result[SESSIONS_KEY] : [];
}

export async function saveSessions(sessions) {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  await storage().set({ [SESSIONS_KEY]: safeSessions });
  return safeSessions;
}

export async function addSession(session) {
  const sessions = await loadSessions();
  const next = [session, ...sessions.filter((item) => item.id !== session.id)].slice(0, 500);
  await saveSessions(next);
  return next;
}

export async function ensureDefaults() {
  const current = await storage().get([SETTINGS_KEY, SESSIONS_KEY]);
  const updates = {};
  if (!current[SETTINGS_KEY]) updates[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
  if (!Array.isArray(current[SESSIONS_KEY])) updates[SESSIONS_KEY] = [];
  if (Object.keys(updates).length) await storage().set(updates);
}
