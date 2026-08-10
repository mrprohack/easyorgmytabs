// Shared chrome mock for background handler tests.
// makeChromeStub(tabs, stored, opts) builds a fake chrome.* API and records
// what handlers do in `state.log`, `state.groups`, `state.stored`, and
// `state.sessionStored`.
const noop = { addListener() {} };

function makeChromeStub(tabs, stored = {}, opts = {}) {
  const state = {
    tabs: tabs.map((tab, i) => ({
      id: i + 1, windowId: 1, url: 'https://example.com/', title: 'Tab',
      pinned: false, active: false, audible: false, discarded: false,
      groupId: -1, lastAccessed: Date.now(), ...tab
    })),
    log: [],
    groups: [],
    stored,
    sessionStored: opts.sessionStored || {},
    inFlight: { discard: 0, group: 0 },
    maxInFlight: { discard: 0, group: 0 },
    setCount: 0
  };

  let nextGroupId = Math.max(0, ...state.tabs.map(tab => Number.isInteger(tab.groupId) ? tab.groupId : -1)) + 1;

  const area = (target, { quotaAware = false } = {}) => ({
    async get(key) {
      if (Array.isArray(key)) {
        return Object.fromEntries(key.filter(k => k in target).map(k => [k, target[k]]));
      }
      if (key && typeof key === 'object') {
        const result = { ...key };
        for (const k of Object.keys(key)) if (k in target) result[k] = target[k];
        return result;
      }
      if (key === null || key === undefined) return { ...target };
      return key in target ? { [key]: target[key] } : {};
    },
    async set(items) {
      if (opts.setLatencyMs) await new Promise(r => setTimeout(r, opts.setLatencyMs));
      if (quotaAware && opts.quotaFailures > 0) {
        opts.quotaFailures--;
        throw new Error('Quota bytes exceeded');
      }
      state.setCount++;
      Object.assign(target, items);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete target[key];
    },
    async clear() {
      for (const key of Object.keys(target)) delete target[key];
    }
  });

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  globalThis.chrome = {
    runtime: { onMessage: noop, getURL: p => `chrome-extension://test/${p}` },
    commands: { onCommand: noop },
    storage: {
      local: area(state.stored, { quotaAware: true }),
      sync: area(state.stored),
      session: area(state.sessionStored)
    },
    tabGroups: {
      async update(groupId, props) {
        const group = state.groups.find(item => item.id === groupId);
        if (!group) throw new Error(`Unknown group ${groupId}`);
        Object.assign(group, props);
        return group;
      }
    },
    sessions: {
      async restore() {
        if (opts.noSessions) throw new Error('No recently closed sessions');
        state.log.push(['restore']);
        return {};
      }
    },
    tabs: {
      async query(filter = {}) {
        return state.tabs.filter(tab => Object.entries(filter).every(([key, value]) =>
          key === 'currentWindow' ? tab.windowId === 1 : tab[key] === value));
      },
      async remove(ids) {
        const list = Array.isArray(ids) ? ids : [ids];
        state.log.push(['remove', list]);
        state.tabs = state.tabs.filter(t => !list.includes(t.id));
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
      async ungroup(ids) {
        const list = Array.isArray(ids) ? ids : [ids];
        state.log.push(['ungroup', list]);
        for (const tab of state.tabs) {
          if (list.includes(tab.id)) tab.groupId = -1;
        }
        state.groups = state.groups.filter(group =>
          state.tabs.some(tab => tab.groupId === group.id)
        );
      },
      async group({ tabIds }) {
        state.inFlight.group++;
        state.maxInFlight.group = Math.max(state.maxInFlight.group, state.inFlight.group);
        try {
          if (opts.delayMs) await delay(opts.delayMs);
          if (opts.failGroupIds && tabIds.some(id => opts.failGroupIds.has(id))) {
            throw new Error(`group failed for tab ${tabIds}`);
          }
          const groupId = nextGroupId++;
          const matchingTabs = state.tabs.filter(tab => tabIds.includes(tab.id));
          const windowId = matchingTabs[0]?.windowId ?? 1;
          for (const tab of matchingTabs) tab.groupId = groupId;
          state.groups.push({ id: groupId, windowId, tabIds: [...tabIds] });
          return groupId;
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
  const sessionStored = {};
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
    _sessionStored: sessionStored,
    _emit: (changes) => { for (const fn of listeners) fn(changes, 'local'); },
    storage: {
      local,
      session: {
        async get(key) { return key in sessionStored ? { [key]: sessionStored[key] } : {}; },
        async set(items) { Object.assign(sessionStored, items); }
      },
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
    },
    tabs: {
      async create({ url }) { stored._created = stored._created || []; stored._created.push(url); }
    }
  };
}

module.exports = { makeChromeStub, makeBrowserChromeStub };
