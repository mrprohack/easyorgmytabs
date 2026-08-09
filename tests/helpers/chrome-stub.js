// Shared chrome mock for background handler tests.
// makeChromeStub(tabs, stored, opts) builds a fake chrome.* API and records
// what handlers do in `state.log`, `state.groups`, and `state.stored`.
const noop = { addListener() {} };

function makeChromeStub(tabs, stored = {}, opts = {}) {
  const state = {
    tabs: tabs.map((tab, i) => ({
      id: i + 1, windowId: 1, url: 'https://example.com/', title: 'Tab',
      pinned: false, active: false, audible: false, discarded: false,
      lastAccessed: Date.now(), ...tab
    })),
    log: [],
    groups: [],
    stored,
    inFlight: { discard: 0, group: 0 },
    maxInFlight: { discard: 0, group: 0 },
    setCount: 0
  };

  const area = () => ({
    async get(key) { return key in state.stored ? { [key]: state.stored[key] } : {}; },
    async set(items) {
      if (opts.setLatencyMs) await new Promise(r => setTimeout(r, opts.setLatencyMs));
      if (opts.quotaFailures > 0) {
        opts.quotaFailures--;
        throw new Error('Quota bytes exceeded');
      }
      state.setCount++;
      Object.assign(state.stored, items);
    }
  });

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  globalThis.chrome = {
    runtime: { onMessage: noop, getURL: p => `chrome-extension://test/${p}` },
    commands: { onCommand: noop },
    storage: { local: area(), sync: area() },
    tabGroups: {
      async update(groupId, props) { Object.assign(state.groups[groupId - 1], props); }
    },
    tabs: {
      async query(filter = {}) {
        return state.tabs.filter(tab => Object.entries(filter).every(([key, value]) =>
          key === 'currentWindow' ? tab.windowId === 1 : tab[key] === value));
      },
      async remove(ids) {
        state.log.push(['remove', ids]);
        state.tabs = state.tabs.filter(t => !ids.includes(t.id));
      },
      async create({ url }) { state.log.push(['create', url]); },
      async discard(id) {
        state.inFlight.discard++;
        state.maxInFlight.discard = Math.max(state.maxInFlight.discard, state.inFlight.discard);
        try {
          if (opts.delayMs) await delay(opts.delayMs);
          state.log.push(['discard', id]);
        } finally {
          state.inFlight.discard--;
        }
      },
      async ungroup() {},
      async group({ tabIds }) {
        state.inFlight.group++;
        state.maxInFlight.group = Math.max(state.maxInFlight.group, state.inFlight.group);
        try {
          if (opts.delayMs) await delay(opts.delayMs);
          if (opts.failGroupIds && tabIds.some(id => opts.failGroupIds.has(id))) {
            throw new Error(`group failed for tab ${tabIds}`);
          }
          state.groups.push({ tabIds });
          return state.groups.length;
        } finally {
          state.inFlight.group--;
        }
      }
    }
  };
  return state;
}


// Browser-style stub for jsdom tests of popup.html / session.html.
function makeBrowserChromeStub({ savedSessions = [] } = {}) {
  const stored = { savedSessions };
  const listeners = new Set();
  const local = {
    async get(key) { return key in stored ? { [key]: stored[key] } : {}; },
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        const old = stored[k];
        stored[k] = v;
        for (const fn of listeners) fn({ [k]: { oldValue: old, newValue: v } }, 'local');
      }
    }
  };
  return {
    _stored: stored,
    _emit: (changes) => { for (const fn of listeners) fn(changes, 'local'); },
    storage: {
      local,
      sync: {
        async get() { return { sleepHours: 1 }; },
        async set() {},
        onChanged: { addListener() {} }
      },
      onChanged: { addListener: (fn) => listeners.add(fn) }
    },
    runtime: {
      getURL: p => `chrome-extension://test/${p}`,
      async sendMessage() { return { status: 'done', count: 1 }; }
    }
  };
}

module.exports = { makeChromeStub, makeBrowserChromeStub };
