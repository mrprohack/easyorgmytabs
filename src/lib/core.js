const TRACKING_KEYS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
]);

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeUrl(value) {
  const raw = cleanText(value);
  if (!raw) return '';

  try {
    const url = new URL(raw);
    url.hash = '';

    for (const key of [...url.searchParams.keys()]) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('utm_') || TRACKING_KEYS.has(lowerKey)) {
        url.searchParams.delete(key);
      }
    }

    url.searchParams.sort();
    url.hostname = url.hostname.toLowerCase();

    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }

    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }

    return url.toString();
  } catch {
    return raw;
  }
}

export function getDomain(value) {
  const raw = cleanText(value);
  if (!raw) return 'Other';

  try {
    const url = new URL(raw);
    if (!['http:', 'https:', 'ftp:', 'file:'].includes(url.protocol)) {
      return `${url.protocol}//`;
    }
    if (url.hostname) {
      return url.hostname.toLowerCase().replace(/^www\./, '');
    }
    if (url.protocol) {
      return `${url.protocol}//`;
    }
  } catch {
    return 'Other';
  }

  return 'Other';
}

export function filterTabs(tabs, query) {
  const needle = cleanText(query).toLowerCase();
  if (!needle) return [...tabs];

  return tabs.filter((tab) => {
    const searchable = [tab.title, tab.url, getDomain(tab.url)]
      .map((item) => cleanText(item).toLowerCase())
      .join(' ');
    return searchable.includes(needle);
  });
}

function comparePosition(a, b) {
  return (a.windowId ?? 0) - (b.windowId ?? 0) || (a.index ?? 0) - (b.index ?? 0);
}

function compareText(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

export function sortTabs(tabs, sortBy = 'position') {
  const result = [...tabs];
  result.sort((a, b) => {
    if (sortBy === 'title') {
      return compareText(cleanText(a.title), cleanText(b.title)) || comparePosition(a, b);
    }
    if (sortBy === 'domain') {
      return compareText(getDomain(a.url), getDomain(b.url))
        || compareText(cleanText(a.title), cleanText(b.title))
        || comparePosition(a, b);
    }
    return comparePosition(a, b);
  });
  return result;
}

export function groupTabs(tabs, groupBy = 'window') {
  if (groupBy === 'none') return [['All tabs', [...tabs]]];

  const groups = new Map();
  for (const tab of tabs) {
    const key = groupBy === 'domain'
      ? getDomain(tab.url)
      : `Window ${tab.windowId ?? 'Unknown'}`;
    const group = groups.get(key) ?? [];
    group.push(tab);
    groups.set(key, group);
  }

  return [...groups.entries()].sort(([a], [b]) => {
    if (groupBy === 'window') {
      const aNumber = Number(a.replace(/\D+/g, '')) || 0;
      const bNumber = Number(b.replace(/\D+/g, '')) || 0;
      return aNumber - bNumber;
    }
    return compareText(a, b);
  });
}

export function findDuplicateGroups(tabs) {
  const byUrl = new Map();

  for (const tab of tabs) {
    const key = normalizeUrl(tab.url);
    if (!key) continue;
    const group = byUrl.get(key) ?? [];
    group.push(tab);
    byUrl.set(key, group);
  }

  return [...byUrl.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort(comparePosition));
}

export function duplicateTabIdsToClose(tabs, preservePinned = true) {
  return findDuplicateGroups(tabs).flatMap((group) => {
    let keep = group[0];
    if (preservePinned) {
      keep = group.find((tab) => Boolean(tab.pinned)) ?? keep;
    }
    return group.filter((tab) => tab.id !== keep.id).map((tab) => tab.id);
  });
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSession(tabs, name = 'Saved session') {
  const grouped = new Map();
  for (const tab of sortTabs(tabs, 'position')) {
    if (!cleanText(tab.url)) continue;
    const windowId = tab.windowId ?? 0;
    const windowTabs = grouped.get(windowId) ?? [];
    windowTabs.push({
      title: cleanText(tab.title) || cleanText(tab.url),
      url: cleanText(tab.url),
      pinned: Boolean(tab.pinned),
    });
    grouped.set(windowId, windowTabs);
  }

  return {
    id: makeId(),
    name: cleanText(name) || 'Saved session',
    createdAt: new Date().toISOString(),
    windows: [...grouped.entries()].map(([windowId, windowTabs]) => ({
      focused: tabs.some((tab) => tab.windowId === windowId && tab.active),
      tabs: windowTabs,
    })),
  };
}

function validateRestorableUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'file:', 'ftp:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeImportedSession(session, index) {
  if (!session || typeof session !== 'object') {
    throw new Error(`Session ${index + 1} is invalid.`);
  }
  if (!Array.isArray(session.windows) || session.windows.length === 0 || session.windows.length > 100) {
    throw new Error(`Session ${index + 1} must contain 1–100 windows.`);
  }

  let tabCount = 0;
  const windows = session.windows.map((windowItem, windowIndex) => {
    if (!windowItem || !Array.isArray(windowItem.tabs) || windowItem.tabs.length === 0 || windowItem.tabs.length > 2000) {
      throw new Error(`Window ${windowIndex + 1} in session ${index + 1} has an invalid tab list.`);
    }

    const importedTabs = windowItem.tabs.map((tab, tabIndex) => {
      if (!tab || !validateRestorableUrl(tab.url)) {
        throw new Error(`Tab ${tabIndex + 1} in session ${index + 1} requires a valid URL.`);
      }
      tabCount += 1;
      return {
        title: cleanText(tab.title) || tab.url,
        url: tab.url.trim(),
        pinned: Boolean(tab.pinned),
      };
    });

    return {
      focused: Boolean(windowItem.focused),
      tabs: importedTabs,
    };
  });

  if (tabCount > 5000) throw new Error(`Session ${index + 1} exceeds 5,000 tabs.`);

  return {
    id: typeof session.id === 'string' && session.id.trim() ? session.id.trim() : makeId(),
    name: cleanText(session.name) || `Imported session ${index + 1}`,
    createdAt: Number.isNaN(Date.parse(session.createdAt)) ? new Date().toISOString() : new Date(session.createdAt).toISOString(),
    windows,
  };
}

export function validateSessionImport(payload) {
  if (!payload || typeof payload !== 'object' || payload.version !== 1 || !Array.isArray(payload.sessions)) {
    throw new Error('This is not a supported Easy Organize My Tabs export.');
  }
  if (payload.sessions.length > 500) {
    throw new Error('An import can contain at most 500 sessions.');
  }

  return {
    version: 1,
    exportedAt: Number.isNaN(Date.parse(payload.exportedAt)) ? new Date().toISOString() : new Date(payload.exportedAt).toISOString(),
    sessions: payload.sessions.map(sanitizeImportedSession),
  };
}
