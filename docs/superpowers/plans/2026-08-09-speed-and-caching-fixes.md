# Speed & Caching-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tab Organizer Pro faster on large tab sets and eliminate stale/caching-style bugs (lost session writes, stale dashboard state, storage quota failures) — all covered by automated tests.

**Architecture:** Extract all pure helpers into a shared dependency-free `logic.js` (loaded by the service worker via `importScripts`, by popup/dashboard via a `<script>` tag, and by Node tests via `require`). Add a `runBatched()` concurrency limiter for tab/group API calls. Make the background service worker the single writer for `savedSessions` through a serialized write queue, with session caps and quota-error retry; the dashboard becomes a message-driven reader kept fresh by `chrome.storage.onChanged`. Tests run under plain Node `assert`; DOM surfaces are tested with jsdom (dev-only dependency).

**Tech Stack:** Chrome Extension Manifest V3, plain JavaScript (no build step), Node.js >= 20 with `node:assert`, jsdom (dev dependency only).

## Global Constraints

- `node test.js` MUST remain the single test command; it runs every `tests/*.test.js` file.
- No runtime dependencies. The only dependency is `jsdom` as a devDependency.
- Manifest permissions, popup buttons, action names, and keyboard command names MUST NOT change.
- All saved titles/URLs are attacker-controlled: never interpolate into `innerHTML`; set via `textContent`; assign `href` only after `isLinkable()` (http/https) passes.
- No `alert()`/`confirm()`; keep the popup status line and the dashboard's two-step inline delete confirm.
- Backend edge cases that must keep working: ignore `chrome://`-family URLs, never group or sleep pinned tabs, never sleep audible tabs, open the dashboard before closing tabs in `saveSession`.
- Keep the premium UI aesthetic; this plan changes no CSS and no HTML structure except adding one `<script src="logic.js">` tag per page.
- Each task ends with a commit on the `codex/speed-and-caching` branch.

## File Structure

- **Create:** `logic.js` — pure helpers only, no `chrome.*`, no DOM: `BLOCKED_SCHEMES`, `isRestorable`, `getDomain`, `getDateBucket`, `BUCKET_COLORS`, `TRACKING_PARAMS`, `dedupeKey`, `isLinkable`, `clampSleepHours`, `DEFAULT_SLEEP_HOURS`, `MAX_SAVED_SESSIONS`, `MAX_TABS_PER_SESSION`, `filterSessions`, `newSessionId`, `runBatched`, plus a CommonJS export guard.
- **Modify:** `background.js` — `importScripts('logic.js')` at the top; delete moved helpers; use `runBatched` in `createGroups`/`sleepInactive`; serialized session write queue, caps, quota retry; three new handlers `SESSION_DELETE`, `SESSION_ADD_TAB`, `SESSION_REMOVE_TAB`.
- **Modify:** `popup.html` / `session.html` — add `<script src="logic.js"></script>` before the page script.
- **Modify:** `popup.js` — use `clampSleepHours` from `logic.js`.
- **Modify:** `session.js` — read sessions from storage with `onChanged` sync; all mutations via `chrome.runtime.sendMessage`; debounced search using `filterSessions`.
- **Modify:** `test.js` — becomes a runner over `tests/*.test.js` (supports `node test.js <filter>`).
- **Create:** `tests/helpers/chrome-stub.js` — shared chrome mock factory (moved from current `test.js`, extended with in-flight tracking, delays, failure injection, quota errors, `onChanged`).
- **Create:** `tests/logic.test.js`, `tests/background.test.js`, `tests/dom.test.js`, `tests/load.test.js`.
- **Create:** `package.json` (script `test: node test.js`, devDependency `jsdom`) and `.gitignore` (`node_modules/`, `.superpowers/`, `.worktrees/`).
- **Modify:** `AGENTS.md` — update the File Structure section for `logic.js` and `tests/`.

### Shared Interfaces (lock these names — later tasks depend on them)

- `isRestorable(url) -> boolean`
- `getDomain(url) -> string`
- `getDateBucket(lastAccessed) -> string` (one of `Today`, `This Week`, `Last Week`, `This Month`, `Older`, `Unknown`)
- `dedupeKey(url) -> string`
- `isLinkable(url) -> boolean`
- `clampSleepHours(value) -> number` (finite, `0.25..168`, fallback `DEFAULT_SLEEP_HOURS`)
- `filterSessions(sessions, query) -> [{session, tabs}]`
- `newSessionId() -> string`
- `runBatched(items, limit, op, onError) -> Promise<number>` (number of successful ops; `onError(err, item, index)` called for each failure; throws `RangeError` if `limit < 1`)
- `DEFAULT_SLEEP_HOURS = 1`, `MAX_SAVED_SESSIONS = 50`, `MAX_TABS_PER_SESSION = 200`
- Background handlers (via `HANDLERS` map, receive the message object as first arg): `SAVE_SESSION`, `SESSION_DELETE({sessionId})`, `SESSION_ADD_TAB({sessionId, tab})`, `SESSION_REMOVE_TAB({sessionId, index})`
- Session identity: `s.id ?? s.date` — new sessions get `id` from `newSessionId()`; legacy sessions fall back to their `date` string.

---
### Task 1: Test scaffolding (runner, helpers, moved suite)

**Files:**
- Create: `package.json`, `.gitignore`, `tests/helpers/chrome-stub.js`, `tests/background.test.js`, `tests/logic.test.js`
- Modify: `test.js` (replace contents)

**Interfaces:**
- Consumes: nothing.
- Produces: `tests/background.test.js` and `tests/logic.test.js` each `module.exports = async function main()`; runner contract `node test.js [filter]`; helper factory `makeChromeStub(tabs, stored, opts)`.

- [ ] **Step 1: Create `package.json` and `.gitignore`**

`package.json`:
```json
{
  "name": "easyorgmytabs",
  "version": "1.1.0",
  "private": true,
  "description": "Tab Organizer Pro — Chrome extension",
  "scripts": { "test": "node test.js" },
  "devDependencies": { "jsdom": "^26.0.0" }
}
```

`.gitignore`:
```
node_modules/
.superpowers/
.worktrees/
```

- [ ] **Step 2: Write the runner `test.js`**

```js
// test.js — runs every suite in tests/. Usage: node test.js [filter]
const fs = require('fs');

async function main() {
  const filter = process.argv[2] || '';
  const files = fs.readdirSync('tests')
    .filter(f => f.endsWith('.test.js') && f.includes(filter))
    .sort();
  if (files.length === 0) {
    console.error(`No test files match "${filter}"`);
    process.exit(1);
  }
  let failed = 0;
  for (const file of files) {
    try {
      await require(`./tests/${file}`)();
      console.log(`ok   ${file}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${file}`);
      console.error(err);
    }
  }
  if (failed > 0) { console.error(`${failed} test file(s) failed`); process.exit(1); }
  console.log('all tests passed');
}

main();
```

- [ ] **Step 3: Move the existing chrome mock into `tests/helpers/chrome-stub.js`**

Copy the `mockChrome` function from the current `test.js` verbatim into the helper, rename it `makeChromeStub`, keep the same `state` shape (`tabs`, `log`, `groups`, `stored`), and `module.exports = { makeChromeStub }`. Do not change behavior in this task.

- [ ] **Step 4: Move the existing handler tests into `tests/background.test.js`**

The current `test.js` body (the `assert` blocks from `isRestorable` through the final `arrangeByDate` assertions, plus the `main()` function) moves to `tests/background.test.js` unchanged — including the `eval(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'))` loader and the `globalThis.chrome` setup — except:
- Replace the local `mockChrome(...)` calls with `makeChromeStub(...)` from the helper.
- Wrap everything in `module.exports = async function main() { ... }` (the trailing `console.log('ok')` goes away — the runner prints per-file results).

- [ ] **Step 5: Create an empty `tests/logic.test.js`**

```js
// logic.test.js — pure helper tests (filled in from Task 2 onward)
module.exports = async function main() {
  console.log('(logic tests added in Task 2)');
};
```

- [ ] **Step 6: Run `npm install` then `node test.js`**

Expected: `ok   background.test.js` and `ok   logic.test.js`, final line `all tests passed`. If any assertion fails, the move was wrong — fix the move, do not touch production code.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore test.js tests/
git commit -m "test: scaffold multi-file test runner with shared chrome stub"
```

---

### Task 2: Extract `logic.js` (pure helpers)

**Files:**
- Create: `logic.js`
- Modify: `background.js` (add `importScripts` line, delete moved helper definitions), `tests/background.test.js` (loader), `tests/logic.test.js` (real tests)

**Interfaces:**
- Consumes: Task 1 scaffolding.
- Produces: `logic.js` with the module export guard:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BLOCKED_SCHEMES, isRestorable, getDomain, getDateBucket, BUCKET_COLORS, TRACKING_PARAMS, dedupeKey, isLinkable, clampSleepHours, DEFAULT_SLEEP_HOURS, MAX_SAVED_SESSIONS, MAX_TABS_PER_SESSION, filterSessions, newSessionId, runBatched };
}
```

- [ ] **Step 1: Write the failing tests in `tests/logic.test.js`**

Replace the placeholder with literal-assertion tests for each helper (expectations derived by hand, not from background.js):

```js
// logic.test.js
const assert = require('assert');
const L = require('../logic.js');

module.exports = async function main() {
  // isRestorable
  assert.strictEqual(L.isRestorable('https://example.com/a'), true);
  assert.strictEqual(L.isRestorable('chrome://newtab'), false);
  assert.strictEqual(L.isRestorable('chrome-extension://abc/session.html'), false);
  assert.strictEqual(L.isRestorable('about:blank'), false);
  assert.strictEqual(L.isRestorable('edge://settings'), false);
  assert.strictEqual(L.isRestorable('view-source:https://a.com'), false);
  assert.strictEqual(L.isRestorable(undefined), false);
  assert.strictEqual(L.isRestorable('not a url'), false);

  // dedupeKey
  assert.strictEqual(L.dedupeKey('https://a.com/x#frag'), 'https://a.com/x');
  assert.strictEqual(L.dedupeKey('https://a.com/x?utm_source=n&id=7'), 'https://a.com/x?id=7');
  assert.strictEqual(L.dedupeKey('https://a.com/x?fbclid=1&id=7'), 'https://a.com/x?id=7');
  assert.strictEqual(L.dedupeKey('https://a.com/x?gclid=1&id=7'), 'https://a.com/x?id=7');
  assert.strictEqual(L.dedupeKey('https://a.com/x?msclkid=1&id=7'), 'https://a.com/x?id=7');
  assert.strictEqual(L.dedupeKey('https://a.com/x?mc_eid=1&id=7'), 'https://a.com/x?id=7');
  assert.notStrictEqual(L.dedupeKey('https://a.com/x?id=7'), L.dedupeKey('https://a.com/x?id=8'));
  assert.strictEqual(L.dedupeKey('not a url'), 'not a url');

  // getDomain
  assert.strictEqual(L.getDomain('https://www.youtube.com/watch?v=1'), 'youtube.com');
  assert.strictEqual(L.getDomain('https://youtube.com/b'), 'youtube.com');
  assert.strictEqual(L.getDomain('garbage'), 'Other');

  // getDateBucket + BUCKET_COLORS keys
  const HOUR = 60 * 60 * 1000;
  const hoursAgo = h => Date.now() - h * HOUR;
  assert.strictEqual(L.getDateBucket(hoursAgo(2)), 'Today');
  assert.strictEqual(L.getDateBucket(hoursAgo(24 * 3)), 'This Week');
  assert.strictEqual(L.getDateBucket(hoursAgo(24 * 10)), 'Last Week');
  assert.strictEqual(L.getDateBucket(hoursAgo(24 * 20)), 'This Month');
  assert.strictEqual(L.getDateBucket(hoursAgo(24 * 40)), 'Older');
  assert.strictEqual(L.getDateBucket(undefined), 'Unknown');
  assert.strictEqual(L.getDateBucket('garbage'), 'Unknown');
  for (const bucket of ['Today', 'This Week', 'Last Week', 'This Month', 'Older', 'Unknown']) {
    assert.ok(typeof L.BUCKET_COLORS[bucket] === 'string', `missing color for ${bucket}`);
  }

  // isLinkable
  assert.strictEqual(L.isLinkable('https://a.com/'), true);
  assert.strictEqual(L.isLinkable('http://a.com/'), true);
  assert.strictEqual(L.isLinkable('javascript:alert(1)'), false);
  assert.strictEqual(L.isLinkable('chrome://newtab'), false);
  assert.strictEqual(L.isLinkable('data:text/html,x'), false);

  // clampSleepHours
  assert.strictEqual(L.clampSleepHours(2), 2);
  assert.strictEqual(L.clampSleepHours('2.5'), 2.5);
  assert.strictEqual(L.clampSleepHours(0), L.DEFAULT_SLEEP_HOURS);
  assert.strictEqual(L.clampSleepHours(-5), 0.25);
  assert.strictEqual(L.clampSleepHours(1000), 168);
  assert.strictEqual(L.clampSleepHours('abc'), L.DEFAULT_SLEEP_HOURS);
  assert.strictEqual(L.clampSleepHours(undefined), L.DEFAULT_SLEEP_HOURS);

  // filterSessions
  const sessions = [
    { date: 'a', tabs: [{ title: 'Alpha', url: 'https://a.com/' }, { title: 'Beta', url: 'https://b.com/' }] },
    { date: 'b', tabs: [{ title: 'Gamma', url: 'https://c.com/' }] }
  ];
  assert.deepStrictEqual(L.filterSessions(sessions, '').map(e => e.session.date), ['a', 'b']);
  assert.deepStrictEqual(L.filterSessions(sessions, '').map(e => e.tabs.length), [2, 1]);
  const hit = L.filterSessions(sessions, 'alpha');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].session.date, 'a');
  assert.strictEqual(hit[0].tabs.length, 1);
  assert.strictEqual(L.filterSessions(sessions, 'https://c.com').length, 1);
  assert.strictEqual(L.filterSessions(sessions, 'zzz').length, 0);
  assert.strictEqual(L.filterSessions([], 'x').length, 0);

  // newSessionId
  assert.strictEqual(typeof L.newSessionId(), 'string');
  assert.notStrictEqual(L.newSessionId(), L.newSessionId());

  // constants
  assert.strictEqual(L.DEFAULT_SLEEP_HOURS, 1);
  assert.ok(L.MAX_SAVED_SESSIONS >= 1);
  assert.ok(L.MAX_TABS_PER_SESSION >= 1);
};
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test.js logic`
Expected: `FAIL logic.test.js` with `Cannot find module '../logic.js'`. The failure is expected because `logic.js` does not exist yet.

- [ ] **Step 3: Create `logic.js`**

Move these definitions verbatim from `background.js` into `logic.js` (they are pure — no `chrome.*`, no DOM): `BLOCKED_SCHEMES`, `isRestorable`, `getDomain`, `getDateBucket`, `BUCKET_COLORS`, `TRACKING_PARAMS`, `dedupeKey`. Add these new pure helpers (do NOT add `runBatched` yet — that is Task 3):

```js
// Shared pure helpers. No chrome.* or DOM references — safe for the service
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BLOCKED_SCHEMES, isRestorable, getDomain, getDateBucket, BUCKET_COLORS,
    TRACKING_PARAMS, dedupeKey, isLinkable, clampSleepHours, DEFAULT_SLEEP_HOURS,
    MAX_SAVED_SESSIONS, MAX_TABS_PER_SESSION, filterSessions, newSessionId
  };
}
```

- [ ] **Step 4: Wire `background.js` to use `logic.js`**

Add as the first line of `background.js`:
```js
importScripts('logic.js');
```
Then delete from `background.js` every definition moved in Step 3 (`BLOCKED_SCHEMES`, `isRestorable`, `getDomain`, `getDateBucket`, `BUCKET_COLORS`, `TRACKING_PARAMS`, `dedupeKey`). The rest of `background.js` stays unchanged in this task.

- [ ] **Step 5: Update the `tests/background.test.js` loader**

Before evaluating `background.js`, strip the `importScripts` line and expose the shared helpers as globals (they are globals in the real service worker too):

```js
const logic = require('../logic.js');
Object.assign(globalThis, logic);
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8')
  .replace(/^importScripts\([^)]*\);\s*/, '');
eval(source);
```

- [ ] **Step 6: Run the full suite**

Run: `node test.js`
Expected: `ok   background.test.js`, `ok   logic.test.js`, `all tests passed`. The moved behavior is unchanged, so every old assertion must still pass.

- [ ] **Step 7: Commit**

```bash
git add logic.js background.js tests/
git commit -m "refactor: extract pure helpers into shared logic.js"
```

---

### Task 3: `runBatched` concurrency limiter

**Files:**
- Modify: `tests/logic.test.js`, `logic.js`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `runBatched(items, limit, op, onError) -> Promise<number>` — starts items in order across `min(limit, items.length)` workers; `op(item, index)` may be async; each rejection is passed to `onError(err, item, index)` and does not abort the batch; resolves with the count of successful ops; `RangeError` if `limit < 1`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/logic.test.js` inside `main()`:

```js
  // runBatched: concurrency capped at limit
  let active = 0, maxActive = 0, started = [];
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const result = await L.runBatched([1, 2, 3, 4, 5], 2, async (item) => {
    active++;
    maxActive = Math.max(maxActive, active);
    started.push(item);
    await delay(5);
    active--;
  });
  assert.strictEqual(result, 5);
  assert.strictEqual(maxActive, 2, 'never more than 2 ops in flight');
  assert.deepStrictEqual(started, [1, 2, 3, 4, 5]);

  // runBatched: failures are counted out and do not abort the batch
  const failed = [];
  const okCount = await L.runBatched(['a', 'b', 'c'], 3,
    async (item) => { if (item === 'b') throw new Error('boom'); },
    (err, item) => failed.push(item));
  assert.strictEqual(okCount, 2);
  assert.deepStrictEqual(failed, ['b']);

  // runBatched: empty input resolves 0; bad limit throws
  assert.strictEqual(await L.runBatched([], 5, async () => {}), 0);
  assert.throws(() => L.runBatched([1], 0, async () => {}), RangeError);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test.js logic`
Expected: `FAIL logic.test.js` — first failure is `L.runBatched is not a function` (feature missing). That is the expected RED.

- [ ] **Step 3: Implement `runBatched`**

Add to `logic.js` before the export guard, and add `runBatched` to the `module.exports` list:

```js
async function runBatched(items, limit, op, onError = () => {}) {
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return succeeded;
}
```

- [ ] **Step 4: Run the focused test**

Run: `node test.js logic`
Expected: `ok   logic.test.js`. Then run `node test.js` — everything green.

- [ ] **Step 5: Commit**

```bash
git add logic.js tests/logic.test.js
git commit -m "feat: add runBatched concurrency limiter"
```

---

### Task 4: Batch `sleepInactive` discards

**Files:**
- Modify: `tests/background.test.js`, `tests/helpers/chrome-stub.js`, `background.js`

**Interfaces:**
- Consumes: `runBatched`, `DEFAULT_SLEEP_HOURS` from `logic.js`.
- Produces: `sleepInactive()` — same message contract (returns slept count), but discards run through `runBatched` with limit 10.

- [ ] **Step 1: Extend the chrome stub with in-flight tracking**

In `tests/helpers/chrome-stub.js`, change the mock's `tabs.discard` and `tabs.group` to track concurrency:

```js
// in state: inFlight: { discard: 0, group: 0 }, maxInFlight: { discard: 0, group: 0 }
async function track(key, fn) {
  state.inFlight[key]++;
  state.maxInFlight[key] = Math.max(state.maxInFlight[key], state.inFlight[key]);
  try { return await fn(); }
  finally { state.inFlight[key]--; }
}
```
Use it in `discard` and `group`. Give the stub a `delayMs` option (default 0) applied inside `discard` and `group` so concurrency is observable. Keep all existing fields and log entries identical for existing assertions.

- [ ] **Step 2: Write the failing tests**

Append to `tests/background.test.js`:

```js
  // sleepInactive discards in parallel batches of at most 10.
  state = makeChromeStub(
    Array.from({ length: 25 }, (_, i) => ({
      url: `https://slow${i}.com/`, lastAccessed: hoursAgo(5)
    })),
    { sleepHours: 1 },
    { delayMs: 2 }
  );
  assert.strictEqual(await sleepInactive(), 25);
  assert.strictEqual(state.log.filter(([op]) => op === 'discard').length, 25);
  assert.ok(state.maxInFlight.discard > 1, 'discards should overlap');
  assert.ok(state.maxInFlight.discard <= 10, 'at most 10 concurrent discards');
```

- [ ] **Step 3: Run to verify it fails**

Run: `node test.js background`
Expected: `FAIL background.test.js` on `maxInFlight.discard > 1` — the current loop awaits each discard sequentially, so max in-flight is 1. This is the expected RED.

- [ ] **Step 4: Implement the batched `sleepInactive`**

Replace the body of `sleepInactive` in `background.js`:

```js
async function sleepInactive() {
  const { sleepHours = DEFAULT_SLEEP_HOURS } = await chrome.storage.sync.get('sleepHours');
  const cutoff = Date.now() - sleepHours * 60 * 60 * 1000;
  const tabs = await chrome.tabs.query({ active: false, discarded: false });
  const idleIds = tabs
    .filter(t => !t.audible && !t.pinned && t.lastAccessed && t.lastAccessed <= cutoff)
    .map(t => t.id);
  return runBatched(
    idleIds,
    10,
    id => chrome.tabs.discard(id),
    (err, id) => console.error(`Failed to discard tab ${id}:`, err)
  );
}
```
Delete the local `DEFAULT_SLEEP_HOURS` constant from `background.js` (it now comes from `logic.js` via the import).

- [ ] **Step 5: Run the focused test**

Run: `node test.js background`
Expected: `ok   background.test.js` (both the new batching assertions and all moved assertions, including the pinned/audible/threshold rules).

- [ ] **Step 6: Commit**

```bash
git add background.js tests/background.test.js tests/helpers/chrome-stub.js
git commit -m "perf: batch tab discards in sleepInactive with runBatched"
```

---

### Task 5: Batch `createGroups` group creation

**Files:**
- Modify: `tests/background.test.js`, `background.js`

**Interfaces:**
- Consumes: `runBatched` from `logic.js`.
- Produces: `createGroups(entries) -> Promise<number>` — same contract (count of groups created), entries processed through `runBatched` with limit 5; per-entry failures logged and skipped.

- [ ] **Step 1: Write the failing tests**

Append to `tests/background.test.js`:

```js
  // createGroups creates groups in parallel batches of at most 5.
  const manyEntries = Array.from({ length: 20 }, (_, i) => ({
    tabIds: [i + 1], title: `site${i}.com`, color: 'grey'
  }));
  state = makeChromeStub([], {}, { delayMs: 2 });
  assert.strictEqual(await createGroups(manyEntries), 20);
  assert.strictEqual(state.groups.length, 20);
  assert.ok(state.maxInFlight.group > 1, 'group calls should overlap');
  assert.ok(state.maxInFlight.group <= 5, 'at most 5 concurrent group calls');

  // A failing group entry does not abort the batch and is not counted.
  state = makeChromeStub([], {}, { failGroupIds: new Set([2]) });
  const ok = await createGroups([
    { tabIds: [1], title: 'ok.com', color: 'grey' },
    { tabIds: [2], title: 'bad.com', color: 'grey' },
    { tabIds: [3], title: 'fine.com', color: 'grey' }
  ]);
  assert.strictEqual(ok, 2);
  assert.strictEqual(state.groups.length, 2);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test.js background`
Expected: `FAIL` on `maxInFlight.group > 1` (current loop is sequential). Expected RED.

- [ ] **Step 3: Implement batched `createGroups`**

Replace the body of `createGroups` in `background.js`:

```js
async function createGroups(entries) {
  const op = async (entry) => {
    const groupId = await chrome.tabs.group({ tabIds: entry.tabIds });
    await chrome.tabGroups.update(groupId, { title: entry.title, collapsed: true, color: entry.color });
  };
  return runBatched(
    entries,
    5,
    op,
    (err, entry) => console.error(`Failed to group tabs for "${entry.title}":`, err)
  );
}
```

- [ ] **Step 4: Make the existing arrange tests order-independent**

The existing `arrangeByWebsite`/`arrangeByDate` assertions deep-compare `state.groups` in array order. With concurrency, creation order across groups is not guaranteed. Replace those assertions with order-independent comparisons — e.g. sort both sides by `title` before comparing, or build a `Map(title -> tabIds)`. Keep the tab-set assertions exact. For `arrangeByWebsite`, expected after sorting: `google.com -> [3]`, `youtube.com -> [1, 2]`. For `arrangeByDate`: `Today -> [2]`, `Older -> [1]` (sorted by title).

- [ ] **Step 5: Run the focused test**

Run: `node test.js background`
Expected: `ok   background.test.js`.

- [ ] **Step 6: Commit**

```bash
git add background.js tests/background.test.js
git commit -m "perf: batch tab-group creation with runBatched"
```

---

### Task 6: Durable, capped `saveSession` writes

**Files:**
- Modify: `tests/background.test.js`, `tests/helpers/chrome-stub.js`, `background.js`

**Interfaces:**
- Consumes: `MAX_SAVED_SESSIONS`, `MAX_TABS_PER_SESSION`, `newSessionId`, `isRestorable` from `logic.js`.
- Produces (internal to `background.js`): `readSavedSessions() -> Promise<Array>`, `writeSavedSessions(sessions) -> Promise<void>` (quota-retry trims to `Math.ceil(MAX_SAVED_SESSIONS / 2)`), `enqueueSessionWrite(task) -> Promise` (serializes session writes), `applySessionCap(sessions) -> Array` (slices to `MAX_SAVED_SESSIONS`).

- [ ] **Step 1: Extend the stub for quota failures and set latency**

In `tests/helpers/chrome-stub.js`:
- Add option `quotaFailures: number` — the next N `storage.local.set` calls reject with `new Error('Quota bytes exceeded')` before storing; later sets succeed.
- Add option `setLatencyMs` (default 0) — `storage.local.set` awaits this delay before storing, so concurrent write interleavings are observable.
- Add a `state.setCount` counter incremented on every `storage.local.set`.

- [ ] **Step 2: Write the failing tests**

Append to `tests/background.test.js`:

```js
  // saveSession caps the stored history at MAX_SAVED_SESSIONS, keeping newest.
  const capTabs = Array.from({ length: 60 }, (_, i) => ({ url: `https://cap${i}.com/`, title: `T${i}` }));
  state = makeChromeStub(capTabs);
  assert.strictEqual(await saveSession(), 60);
  assert.strictEqual(state.stored.savedSessions.length, 50);
  assert.strictEqual(state.stored.savedSessions[0].tabs[0].url, 'https://cap59.com/');
  assert.strictEqual(state.stored.savedSessions[49].tabs[0].url, 'https://cap10.com/');

  // saveSession never closes tabs when the storage write fails.
  state = makeChromeStub(
    [{ url: 'https://a.com/', title: 'A' }],
    {},
    { quotaFailures: 1 } // initial write fails, retry succeeds
  );
  assert.strictEqual(await saveSession(), 1);
  assert.deepStrictEqual(state.log, [
    ['create', 'chrome-extension://test/session.html'],
    ['remove', [1]]
  ]);
  assert.strictEqual(state.stored.savedSessions.length, 1);

  // ...and when the retry also fails, nothing is closed and an error surfaces.
  state = makeChromeStub(
    [{ url: 'https://a.com/', title: 'A' }],
    {},
    { quotaFailures: 3 }
  );
  await assert.rejects(() => saveSession(), /quota/i);
  assert.deepStrictEqual(state.log, []);
  assert.strictEqual(state.stored.savedSessions, undefined);

  // A session with more than MAX_TABS_PER_SESSION tabs is truncated on save.
  const tooMany = Array.from({ length: 250 }, (_, i) => ({ url: `https://t${i}.com/`, title: `T${i}` }));
  state = makeChromeStub(tooMany);
  await saveSession();
  assert.strictEqual(state.stored.savedSessions[0].tabs.length, 200);
```

- [ ] **Step 3: Run to verify it fails**

Run: `node test.js background`
Expected: `FAIL` on the first new assertion — today there is no cap, no retry, and `saveSession` closes tabs even when storage rejects. Expected RED.

- [ ] **Step 4: Implement the storage layer in `background.js`**

Add before `saveSession`:

```js
let sessionWriteChain = Promise.resolve();

function enqueueSessionWrite(task) {
  const run = sessionWriteChain.then(task, task);
  sessionWriteChain = run.catch(() => {});
  return run;
}

function applySessionCap(sessions) {
  return sessions.slice(0, MAX_SAVED_SESSIONS);
}

async function readSavedSessions() {
  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  return Array.isArray(savedSessions) ? savedSessions : [];
}

async function writeSavedSessions(sessions) {
  try {
    await chrome.storage.local.set({ savedSessions: sessions });
  } catch (err) {
    if (!/quota/i.test(String(err?.message || err))) throw err;
    await chrome.storage.local.set({ savedSessions: applySessionCap(sessions).slice(0, Math.ceil(MAX_SAVED_SESSIONS / 2)) });
  }
}
```

Replace `saveSession` with:

```js
async function saveSession() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tabsToSave = tabs.filter(t => !t.pinned && isRestorable(t.url));
  if (tabsToSave.length === 0) return 0;

  const sessionData = {
    id: newSessionId(),
    date: new Date().toISOString(),
    tabs: tabsToSave.slice(0, MAX_TABS_PER_SESSION).map(t => ({ title: t.title || t.url, url: t.url }))
  };

  await enqueueSessionWrite(async () => {
    const saved = await readSavedSessions();
    saved.unshift(sessionData);
    await writeSavedSessions(applySessionCap(saved));
  });

  // Open the dashboard before closing anything, or saving every tab closes the window.
  await chrome.tabs.create({ url: chrome.runtime.getURL('session.html') });
  await chrome.tabs.remove(tabsToSave.map(t => t.id));

  return tabsToSave.length;
}
```

Behavior notes: the write happens before the dashboard opens; if the write throws, the handler reports `{status:'error'}` and no tabs are closed (the existing message listener already catches rejections).

- [ ] **Step 5: Run the focused test**

Run: `node test.js background`
Expected: `ok`. The pre-existing `saveSession` tests (dashboard-before-close ordering, prepend order, nothing-to-save) must still pass.

- [ ] **Step 6: Commit**

```bash
git add background.js tests/background.test.js tests/helpers/chrome-stub.js
git commit -m "fix: serialize session writes, cap history, retry on quota errors"
```

---

### Task 7: Session mutation handlers in the background

**Files:**
- Modify: `tests/background.test.js`, `background.js`

**Interfaces:**
- Consumes: `readSavedSessions`, `writeSavedSessions`, `enqueueSessionWrite`, `applySessionCap`, `isLinkable`, `MAX_TABS_PER_SESSION` from `logic.js`.
- Produces: `HANDLERS.SESSION_DELETE({sessionId}) -> Promise<number>` (1 if a session was removed, 0 otherwise), `HANDLERS.SESSION_ADD_TAB({sessionId, tab}) -> Promise<number>`, `HANDLERS.SESSION_REMOVE_TAB({sessionId, index}) -> Promise<number>`. All writes go through `enqueueSessionWrite`. Session identity: `(s.id ?? s.date) === sessionId`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/background.test.js`:

```js
  // SESSION_DELETE removes the matching session (id or legacy date).
  state = makeChromeStub([], { savedSessions: [
    { id: 'x1', date: 'd1', tabs: [{ title: 'A', url: 'https://a.com/' }] },
    { date: 'legacy-date', tabs: [{ title: 'B', url: 'https://b.com/' }] }
  ]});
  assert.strictEqual(await HANDLERS.SESSION_DELETE({ sessionId: 'x1' }), 1);
  assert.deepStrictEqual(state.stored.savedSessions.map(s => s.date), ['legacy-date']);
  assert.strictEqual(await HANDLERS.SESSION_DELETE({ sessionId: 'legacy-date' }), 1);
  assert.strictEqual(state.stored.savedSessions.length, 0);
  assert.strictEqual(await HANDLERS.SESSION_DELETE({ sessionId: 'nope' }), 0);

  // SESSION_ADD_TAB appends a linkable tab and rejects non-linkable URLs.
  state = makeChromeStub([], { savedSessions: [{ id: 's1', date: 'd1', tabs: [] }] });
  assert.strictEqual(await HANDLERS.SESSION_ADD_TAB({ sessionId: 's1', tab: { title: 'New', url: 'https://new.com/' } }), 1);
  assert.deepStrictEqual(state.stored.savedSessions[0].tabs, [{ title: 'New', url: 'https://new.com/' }]);
  assert.strictEqual(await HANDLERS.SESSION_ADD_TAB({ sessionId: 's1', tab: { title: 'Bad', url: 'javascript:alert(1)' } }), 0);
  assert.strictEqual(state.stored.savedSessions[0].tabs.length, 1);
  assert.strictEqual(await HANDLERS.SESSION_ADD_TAB({ sessionId: 'missing', tab: { title: 'X', url: 'https://x.com/' } }), 0);

  // SESSION_REMOVE_TAB splices by index and deletes the session when empty.
  state = makeChromeStub([], { savedSessions: [
    { id: 's1', date: 'd1', tabs: [{ title: 'A', url: 'https://a.com/' }, { title: 'B', url: 'https://b.com/' }] }
  ]});
  assert.strictEqual(await HANDLERS.SESSION_REMOVE_TAB({ sessionId: 's1', index: 0 }), 1);
  assert.deepStrictEqual(state.stored.savedSessions[0].tabs.map(t => t.title), ['B']);
  assert.strictEqual(await HANDLERS.SESSION_REMOVE_TAB({ sessionId: 's1', index: 9 }), 0);
  assert.strictEqual(await HANDLERS.SESSION_REMOVE_TAB({ sessionId: 's1', index: 0 }), 1);
  assert.strictEqual(state.stored.savedSessions.length, 0);

  // Concurrent saveSession + SESSION_ADD_TAB: both writes land, no corruption.
  state = makeChromeStub(
    [{ url: 'https://a.com/', title: 'A' }],
    {},
    { setLatencyMs: 5 }
  );
  await Promise.all([
    saveSession(),
    HANDLERS.SESSION_ADD_TAB({ sessionId: 'ghost', tab: { title: 'X', url: 'https://x.com/' } })
  ]);
  assert.strictEqual(state.stored.savedSessions.length, 1);
  assert.strictEqual(state.stored.savedSessions[0].tabs[0].url, 'https://a.com/');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test.js background`
Expected: `FAIL` — `HANDLERS.SESSION_DELETE is not a function`. Expected RED.

- [ ] **Step 3: Implement the handlers**

Add to `background.js` before the `HANDLERS` map:

```js
function findSession(saved, sessionId) {
  return saved.find(s => (s.id ?? s.date) === sessionId);
}

async function sessionDelete(request = {}) {
  const { sessionId } = request;
  if (!sessionId) return 0;
  return enqueueSessionWrite(async () => {
    const saved = await readSavedSessions();
    const next = saved.filter(s => (s.id ?? s.date) !== sessionId);
    if (next.length === saved.length) return 0;
    await writeSavedSessions(applySessionCap(next));
    return 1;
  });
}

async function sessionAddTab(request = {}) {
  const { sessionId, tab } = request;
  if (!sessionId || !tab || !isLinkable(tab.url)) return 0;
  return enqueueSessionWrite(async () => {
    const saved = await readSavedSessions();
    const session = findSession(saved, sessionId);
    if (!session) return 0;
    session.tabs.push({ title: tab.title || tab.url, url: tab.url });
    session.tabs = session.tabs.slice(0, MAX_TABS_PER_SESSION);
    await writeSavedSessions(applySessionCap(saved));
    return 1;
  });
}

async function sessionRemoveTab(request = {}) {
  const { sessionId, index } = request;
  return enqueueSessionWrite(async () => {
    const saved = await readSavedSessions();
    const session = findSession(saved, sessionId);
    if (!session || !Number.isInteger(index) || index < 0 || index >= session.tabs.length) return 0;
    session.tabs.splice(index, 1);
    if (session.tabs.length === 0) saved.splice(saved.indexOf(session), 1);
    await writeSavedSessions(applySessionCap(saved));
    return 1;
  });
}
```

Add the three actions to the `HANDLERS` map. Change the message listener so handlers receive the request object:

```js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = HANDLERS[request?.action];
  if (!handler) return;
  handler(request)
    .then((count) => sendResponse({ status: 'done', count }))
    .catch((err) => sendResponse({ status: 'error', error: err?.message || String(err) }));
  return true;
});
```
The command listener stays as-is (`HANDLERS[command]?.()` works because every handler defaults its argument to `{}`).

- [ ] **Step 4: Run the focused test**

Run: `node test.js background`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add background.js tests/background.test.js
git commit -m "feat: session mutation handlers in background, serialized writes"
```

---

### Task 8: Dashboard sync & mutation rework (`session.js`)

**Files:**
- Modify: `session.html`, `session.js`
- Create: `tests/dom.test.js`, extend `tests/helpers/chrome-stub.js` (browser-style stub)

**Interfaces:**
- Consumes: `filterSessions`, `isLinkable` from `logic.js`; background handlers from Task 7; `makeBrowserChromeStub` from the helper.
- Produces: dashboard behavior — mutations via `chrome.runtime.sendMessage`, reload from storage after each mutation, `chrome.storage.onChanged` re-render, debounced search (150 ms), no direct `chrome.storage.local.set` in `session.js`.

- [ ] **Step 1: Add a browser-style chrome stub for DOM tests**

In `tests/helpers/chrome-stub.js` add `makeBrowserChromeStub({ savedSessions })`:

```js
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
```

- [ ] **Step 2: Write the failing DOM tests**

Create `tests/dom.test.js`:

```js
// dom.test.js — jsdom tests for popup/session surfaces
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeBrowserChromeStub } = require('./helpers/chrome-stub.js');

const ROOT = path.join(__dirname, '..');

async function loadPage(htmlFile, scriptFiles, stub) {
  const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
  const dom = new JSDOM(html, {
    url: 'chrome-extension://test/',
    runScripts: 'outside-only',
    beforeParse(window) { window.chrome = stub; }
  });
  for (const file of scriptFiles) {
    dom.window.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  await new Promise(r => setTimeout(r, 0));
  return dom;
}

module.exports = async function main() {
  // dashboard: renders sessions as textContent with http(s)-only hrefs
  const stub = makeBrowserChromeStub({
    savedSessions: [{
      date: '2026-08-09T10:00:00.000Z',
      tabs: [
        { title: 'Safe', url: 'https://a.com/' },
        { title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' }
      ]
    }]
  });
  let dom = await loadPage('session.html', ['logic.js', 'session.js'], stub);
  let links = [...dom.window.document.querySelectorAll('.link')];
  assert.strictEqual(links.length, 2);
  assert.strictEqual(links[0].textContent, 'Safe');
  assert.strictEqual(links[0].href, 'https://a.com/');
  assert.strictEqual(links[1].textContent, '<img src=x onerror=alert(1)>');
  assert.ok(!links[1].querySelector('img'), 'no img element from title');
  assert.strictEqual(links[1].getAttribute('href'), null, 'non-http URL gets no href');

  // dashboard: search filters via filterSessions, debounced
  dom.window.document.getElementById('search').value = 'Safe';
  dom.window.document.getElementById('search').dispatchEvent(new dom.window.Event('input'));
  await new Promise(r => setTimeout(r, 200));
  links = [...dom.window.document.querySelectorAll('.link')];
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].textContent, 'Safe');

  // dashboard: storage.onChanged re-renders when another context changes data
  stub._stored.savedSessions = [{ date: '2026-08-09T11:00:00.000Z', tabs: [{ title: 'Fresh', url: 'https://fresh.com/' }] }];
  stub._emit({ savedSessions: { oldValue: [], newValue: stub._stored.savedSessions } });
  await new Promise(r => setTimeout(r, 0));
  links = [...dom.window.document.querySelectorAll('.link')];
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].textContent, 'Fresh');

  // dashboard: add-tab form sends SESSION_ADD_TAB with a validated URL
  const messages = [];
  stub.runtime.sendMessage = async (msg) => { messages.push(msg); return { status: 'done', count: 1 }; };
  let input = dom.window.document.querySelector('.add-link-form input');
  let form = dom.window.document.querySelector('.add-link-form');
  input.value = 'https://new.com/';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 10));
  assert.deepStrictEqual(messages[0].action, 'SESSION_ADD_TAB');
  assert.deepStrictEqual(messages[0].sessionId, '2026-08-09T11:00:00.000Z');
  assert.deepStrictEqual(messages[0].tab, { title: 'new.com', url: 'https://new.com/' });

  // dashboard: two-step delete confirm, then SESSION_DELETE
  const deleteStub = makeBrowserChromeStub({
    savedSessions: [{ date: '2026-08-09T10:00:00.000Z', tabs: [{ title: 'A', url: 'https://a.com/' }] }]
  });
  const deleteMessages = [];
  deleteStub.runtime.sendMessage = async (msg) => { deleteMessages.push(msg); return { status: 'done', count: 1 }; };
  dom = await loadPage('session.html', ['logic.js', 'session.js'], deleteStub);
  const removeBtn = dom.window.document.querySelector('.btn-row .btn-danger');
  removeBtn.click();
  assert.strictEqual(removeBtn.textContent.includes('Confirm'), true);
  removeBtn.click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(deleteMessages.length, 1);
  assert.deepStrictEqual(deleteMessages[0], { action: 'SESSION_DELETE', sessionId: '2026-08-09T10:00:00.000Z' });

  // popup: success and error status lines, buttons re-enabled
  const popupStub = makeBrowserChromeStub();
  const sendLog = [];
  popupStub.runtime.sendMessage = async (msg) => { sendLog.push(msg); return { status: 'done', count: 3 }; };
  dom = await loadPage('popup.html', ['logic.js', 'popup.js'], popupStub);
  const status = dom.window.document.getElementById('status');
  dom.window.document.getElementById('btn-dedupe').click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(status.textContent, '3 duplicates closed.');
  assert.strictEqual(dom.window.document.querySelectorAll('button:disabled').length, 0);

  popupStub.runtime.sendMessage = async () => ({ status: 'error', error: 'Quota exceeded' });
  dom.window.document.getElementById('btn-dedupe').click();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(status.textContent, 'Quota exceeded');
  assert.ok(status.classList.contains('error'));

  // popup: sleep-hours clamp uses logic.js clampSleepHours
  const setLog = [];
  popupStub.storage.sync.set = async (items) => { setLog.push(items); };
  const sleepInput = dom.window.document.getElementById('sleep-hours');
  sleepInput.value = '500';
  sleepInput.dispatchEvent(new dom.window.Event('change'));
  await new Promise(r => setTimeout(r, 10));
  assert.deepStrictEqual(setLog, [{ sleepHours: 168 }]);
  assert.strictEqual(sleepInput.value, '168');
};
```

- [ ] **Step 3: Run to verify it fails**

Run: `node test.js dom`
Expected: `FAIL` — currently `session.js` writes storage directly and has no `onChanged` listener, no debounce, no messages; `popup.js` writes the raw clamped value inline. The failures must be behavior failures (missing re-render, no message sent, wrong status), not setup errors. If `jsdom` is missing, run `npm install` first.

- [ ] **Step 4: Update `session.html`**

Add `<script src="logic.js"></script>` immediately before the existing `<script src="session.js"></script>` tag.

- [ ] **Step 5: Rewrite the storage-facing parts of `session.js`**

- Add `const { filterSessions, isLinkable } = window;` after the top-level element lookups (logic.js globals).
- Delete the local `isLinkable` function and the `persist()` function.
- Replace the load + render wiring at the bottom with:

```js
async function loadSessions() {
  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  sessions = Array.isArray(savedSessions) ? savedSessions : [];
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.savedSessions) {
    sessions = changes.savedSessions.newValue || [];
    render();
  }
});

async function mutate(action, payload) {
  const response = await chrome.runtime.sendMessage({ action, ...payload });
  if (response?.status === 'error') throw new Error(response.error || 'Mutation failed');
  await loadSessions();
}
```

- Link-row remove button: replace the direct splice + `persist()` with:

```js
remove.addEventListener('click', async () => {
  const index = session.tabs.indexOf(tab);
  if (index > -1) await mutate('SESSION_REMOVE_TAB', { sessionId: session.id ?? session.date, index });
});
```

- Add-link form submit: replace `session.tabs.push(...); await persist();` with:

```js
session.tabs.push({ title: new URL(url).hostname, url });
await mutate('SESSION_ADD_TAB', { sessionId: session.id ?? session.date, tab: session.tabs[session.tabs.length - 1] });
```

- Delete button: replace `sessions.splice(...); await persist();` with:

```js
await mutate('SESSION_DELETE', { sessionId: session.id ?? session.date });
```

- `render()`: replace the inline filter block with `const visible = filterSessions(sessions, query);` and render each entry as `sessionCard(entry.session, entry.tabs)`.

- Debounce search:

```js
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 150);
});
```

- [ ] **Step 6: Run the DOM tests**

Run: `node test.js dom`
Expected: `ok   dom.test.js`. If the `sessionId` literal differs (e.g. the fixture date), fix the test's literal, never weaken the assertion.

- [ ] **Step 7: Run the full suite**

Run: `node test.js` — all files green.

- [ ] **Step 8: Commit**

```bash
git add session.html session.js tests/dom.test.js tests/helpers/chrome-stub.js
git commit -m "fix: dashboard syncs via storage.onChanged, mutations through background"
```

---

### Task 9: Popup clamp + status polish

**Files:**
- Modify: `popup.html`, `popup.js`, `tests/dom.test.js`

**Interfaces:**
- Consumes: `clampSleepHours` from `logic.js`; the popup DOM tests already written in Task 8.

- [ ] **Step 1: Run the popup DOM tests (written in Task 8)**

Run: `node test.js dom`
Expected: `FAIL` on the popup sections — the popup still clamps inline and does not load `logic.js`. Expected RED.

- [ ] **Step 2: Update `popup.html`**

Add `<script src="logic.js"></script>` immediately before the existing `<script src="popup.js"></script>` tag.

- [ ] **Step 3: Update `popup.js`**

Replace the sleep-hours handler with:

```js
const sleepHoursInput = document.getElementById('sleep-hours');
const { clampSleepHours } = window;

chrome.storage.sync.get('sleepHours').then(({ sleepHours = 1 }) => {
  sleepHoursInput.value = sleepHours;
});

sleepHoursInput.addEventListener('change', async () => {
  const hours = clampSleepHours(sleepHoursInput.value);
  sleepHoursInput.value = hours;
  await chrome.storage.sync.set({ sleepHours: hours });
  setStatus(`Sleeping tabs idle over ${hours}h.`);
});
```

- [ ] **Step 4: Run the DOM tests**

Run: `node test.js dom`
Expected: `ok`. (If `sleep-hours` is not the element id in `popup.html`, update the test's selector to match.)

- [ ] **Step 5: Run the full suite**

Run: `node test.js` — all green.

- [ ] **Step 6: Commit**

```bash
git add popup.html popup.js tests/dom.test.js
git commit -m "refactor: popup sleep-hours clamp uses shared logic.js helper"
```

---

### Task 10: Load/performance acceptance tests

**Files:**
- Create: `tests/load.test.js`, `tests/helpers/load-background.js`
- Modify: `tests/background.test.js` (use the shared loader)

**Interfaces:**
- Consumes: `makeChromeStub` with in-flight tracking; `arrangeByWebsite`, `sleepInactive`, `closeDuplicates`, `saveSession` via the eval loader.

- [ ] **Step 1: Extract the shared loader**

Create `tests/helpers/load-background.js`:

```js
// Loads background.js into the current process with logic.js helpers exposed.
const fs = require('fs');
const path = require('path');
const logic = require('../../logic.js');

module.exports = function loadBackground() {
  Object.assign(globalThis, logic);
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'background.js'), 'utf8')
    .replace(/^importScripts\([^)]*\);\s*/, '');
  eval(source);
};
```
Update `tests/background.test.js` to use it (delete its inline loader).

- [ ] **Step 2: Write the load tests**

Create `tests/load.test.js`:

```js
// load.test.js — large-tab-set acceptance tests: counts, concurrency caps.
const assert = require('assert');
const { makeChromeStub } = require('./helpers/chrome-stub.js');
const loadBackground = require('./helpers/load-background.js');

loadBackground();
const HOUR = 60 * 60 * 1000;
const hoursAgo = h => Date.now() - h * HOUR;

module.exports = async function main() {
  // 300 tabs across 5 windows by website: every restorable tab lands in a group.
  const tabs = [];
  for (let w = 1; w <= 5; w++) {
    for (let i = 0; i < 60; i++) {
      tabs.push({ url: `https://site${i % 30}.com/page${i}`, windowId: w });
    }
  }
  let state = makeChromeStub(tabs, {}, { delayMs: 1 });
  let created = await arrangeByWebsite();
  assert.strictEqual(created, 5 * 30);
  assert.strictEqual(state.groups.length, 150);
  assert.ok(state.maxInFlight.group <= 5);
  assert.strictEqual(state.groups.reduce((n, g) => n + g.tabIds.length, 0), 300);

  // 300 idle tabs: all discarded, never more than 10 in flight.
  state = makeChromeStub(
    Array.from({ length: 300 }, (_, i) => ({ url: `https://s${i}.com/`, lastAccessed: hoursAgo(5) })),
    { sleepHours: 1 },
    { delayMs: 1 }
  );
  assert.strictEqual(await sleepInactive(), 300);
  assert.strictEqual(state.log.filter(([op]) => op === 'discard').length, 300);
  assert.ok(state.maxInFlight.discard <= 10);

  // 300 tabs with 150 duplicate pairs: exactly 150 removed, one remove call.
  const dupTabs = [];
  for (let i = 0; i < 150; i++) {
    dupTabs.push({ url: `https://dup${i}.com/` });
    dupTabs.push({ url: `https://dup${i}.com/?utm_source=x` });
  }
  state = makeChromeStub(dupTabs);
  assert.strictEqual(await closeDuplicates(), 150);
  const removes = state.log.filter(([op]) => op === 'remove');
  assert.strictEqual(removes.length, 1);
  assert.strictEqual(removes[0][1].length, 150);

  // 40 consecutive saves: all land, newest first, unique ids.
  state = makeChromeStub(
    Array.from({ length: 40 }, (_, i) => ({ url: `https://seq${i}.com/`, title: `T${i}` })),
    {},
    { setLatencyMs: 1 }
  );
  for (let i = 0; i < 40; i++) {
    await saveSession();
  }
  assert.strictEqual(state.stored.savedSessions.length, 40);
  assert.strictEqual(state.stored.savedSessions[0].tabs[0].url, 'https://seq39.com/');
  const ids = new Set(state.stored.savedSessions.map(s => s.id));
  assert.strictEqual(ids.size, 40);

  console.log('  load suite: 300-tab scenarios passed');
};
```

- [ ] **Step 3: Run the load tests**

Run: `node test.js load`
Expected: `ok   load.test.js`. (These assert behavior already implemented in Tasks 4–7; if any fail, the earlier task regressed — fix the regression, do not weaken the test.)

- [ ] **Step 4: Run the full suite**

Run: `node test.js` — all five files green.

- [ ] **Step 5: Commit**

```bash
git add tests/load.test.js tests/helpers/load-background.js tests/background.test.js
git commit -m "test: add 300-tab load acceptance suite"
```

---

### Task 11: Docs, final verification, and review handoff

**Files:**
- Modify: `AGENTS.md`, `README.md` (only if it documents the test command or file structure)

**Interfaces:**
- Consumes: everything from Tasks 1–10.

- [ ] **Step 1: Update `AGENTS.md`**

In the File Structure section:
- Add `logic.js` — "pure helpers shared by service worker (`importScripts`), popup/dashboard (`<script>`), and tests (`require`): `isRestorable`, `dedupeKey`, `getDomain`, `getDateBucket`, `isLinkable`, `clampSleepHours`, `filterSessions`, `newSessionId`, `runBatched`, session limits (`MAX_SAVED_SESSIONS`, `MAX_TABS_PER_SESSION`)."
- Replace the `test.js` line with: "`test.js`: `node test.js [filter]` — runner over `tests/*.test.js` (logic, background, dom via jsdom, load)."
- Add: "`tests/helpers/chrome-stub.js` — shared chrome mock; `tests/helpers/load-background.js` — background.js eval loader."
- Note under background.js: "all `savedSessions` writes are serialized through `enqueueSessionWrite` in the service worker; the dashboard mutates via messages (`SESSION_DELETE`/`SESSION_ADD_TAB`/`SESSION_REMOVE_TAB`) and reads via `chrome.storage.onChanged`."
- Note under session.html/session.js: "never writes storage directly."

- [ ] **Step 2: Final full-suite run**

Run: `node test.js` from the repo root.
Expected: `ok` for `background.test.js`, `dom.test.js`, `load.test.js`, `logic.test.js` and final `all tests passed`. Output must be pristine (no warnings, no stray console noise beyond the runner's lines).

- [ ] **Step 3: Syntax check all production scripts**

Run: `node --check background.js && node --check logic.js && node --check session.js && node --check popup.js` — all must exit 0.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: update file structure and test runner docs"
```

- [ ] **Step 5: Hand off to review**

Run the final two-axis code review against the merge-base of `master` (the branch point). Fix round(s) per the review skill, then present completion with `finishing-a-development-branch` options.

