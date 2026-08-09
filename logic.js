// Shared pure helpers. No chrome.* or DOM references â€” safe for the service
// worker (importScripts), popup/dashboard (<script>), and Node tests (require).

const BLOCKED_SCHEMES = [
  'chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-untrusted:',
  'edge:', 'about:', 'devtools:', 'view-source:'
];

function isRestorable(url) {
  try {
    return !BLOCKED_SCHEMES.includes(new URL(url).protocol);
  } catch (e) {
    return false;
  }
}

function getDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname || 'New Tab';
  } catch (e) {
    return 'Other';
  }
}

function getDateBucket(lastAccessed) {
  if (!lastAccessed) return 'Unknown';
  const now = new Date();
  const accessedDate = new Date(lastAccessed);
  if (isNaN(accessedDate.getTime())) return 'Unknown';
  const diffDays = Math.abs(now - accessedDate) / (1000 * 60 * 60 * 24);
  if (diffDays < 1) return 'Today';
  if (diffDays < 7) return 'This Week';
  if (diffDays < 14) return 'Last Week';
  if (diffDays < 30) return 'This Month';
  return 'Older';
}

const BUCKET_COLORS = {
  'Today': 'green',
  'This Week': 'blue',
  'Last Week': 'purple',
  'This Month': 'yellow',
  'Older': 'grey',
  'Unknown': 'grey'
};

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|msclkid$|mc_eid$)/;

function dedupeKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const name of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(name)) parsed.searchParams.delete(name);
    }
    return parsed.href;
  } catch (e) {
    return url;
  }
}

function isLinkable(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch (e) {
    return false;
  }
}

const DEFAULT_SLEEP_HOURS = 1;
const MAX_SAVED_SESSIONS = 50;
const MAX_TABS_PER_SESSION = 200;

function clampSleepHours(value) {
  const n = Number(value);
  const hours = Number.isFinite(n) && n !== 0 ? n : DEFAULT_SLEEP_HOURS;
  return Math.min(168, Math.max(0.25, hours));
}

function filterSessions(sessions, query) {
  const q = query.trim().toLowerCase();
  return sessions
    .map(session => ({
      session,
      tabs: q ? session.tabs.filter(t => `${t.title} ${t.url}`.toLowerCase().includes(q)) : session.tabs
    }))
    .filter(entry => !q || entry.tabs.length > 0);
}

function newSessionId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function runBatched(items, limit, op, onError = () => {}) {
  if (limit < 1) throw new RangeError('limit must be >= 1');
  let next = 0;
  let succeeded = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        await op(items[index], index);
        succeeded++;
      } catch (err) {
        onError(err, items[index], index);
      }
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
    .then(() => succeeded);
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BLOCKED_SCHEMES, isRestorable, getDomain, getDateBucket, BUCKET_COLORS,
    TRACKING_PARAMS, dedupeKey, isLinkable, clampSleepHours, DEFAULT_SLEEP_HOURS,
    MAX_SAVED_SESSIONS, MAX_TABS_PER_SESSION, filterSessions, newSessionId, runBatched
  };
}
