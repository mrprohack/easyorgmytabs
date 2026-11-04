# Project Context: Tab Organizer Pro (easyorgmytabs)

## Key Commands & Verification

- **Tests:** `node test.js` (or `npm test`) runs every suite in `tests/` (logic, background, reliability, popup-result, shortcuts, popup-ux, dashboard-ux, dom via jsdom, style, load); `npm install` brings the only dev dependency (jsdom). No build step, no linter. Real-Chromium e2e flows live in `tests/e2e/` and run in CI (`node tests/e2e/regroup.e2e.js`, `node tests/e2e/session-dashboard.e2e.js`).
- **How test.js works:** it `eval`s `background.js` in Node with a mocked `chrome` global (`storage`, `tabs`, `tabGroups`, `runtime`, `commands`). Two consequences:
  - `background.js` must stay plain-script compatible: **no ES modules, no top-level await**.
  - Any new top-level `chrome.*` API call in `background.js` must also be stubbed in `test.js` or the suite crashes.
- Run `node test.js` after any change to `background.js`, `test.js`, popup/session status text, or any `.css` file (the `style` suite lints the stylesheets and checks contrast).

## Architecture & Responsibilities
- `manifest.json`: MV3, permissions `tabs`, `tabGroups`, `storage`, `favicon`, `sessions`. Version 1.1.0.
- `background.js`: service worker; ALL tab manipulation lives here. Every action is an async function in the `HANDLERS` map that returns a count, or rejects.
- `popup.html`/`popup.js`/`popup.css`: three numbered sections (Organize, Clean up, Save). Sends `{ action }` messages, disables buttons while working (`aria-busy` on `body`), renders results via `formatActionResponse` / `RESULT_TEXT` into the `#status` bar (tone: neutral, success, error). Fills the `#badge-duplicates` / `#badge-idle` preview badges from `PREVIEW`. Also holds the `sleepHours` threshold input (inside the Sleep Idle Tabs row, never nested in a button).
- `session.html`/`session.js`: dashboard for saved sessions (restore/delete/add links/search). Cards show age (`relativeTime`), a host summary (`hostSummary`) and a `Latest` chip; `/` focuses search and `Esc` clears it; every mutation is confirmed in the status line.
- `styles.css`: design tokens (`:root`), shared components (`.btn`, `.input`, `.shortcut` chip, `.status` tones, focus ring) and the dashboard layout. `popup.css` is popup layout only.

## Wiring Rules (easy to miss)
- **New action = 3 edits:** `background.js` `HANDLERS` + `popup.js` `ACTIONS` map + `popup.js` `RESULT_TEXT`. Missing any one fails silently (popup gets an empty reply and shows the "none" message).
- Reply contract: `{ status: 'done', count }` or `{ status: 'error', error }`; the listener returns `true` for async.
- **Keyboard shortcuts:** `ARRANGE_BY_DATE` (Alt+Shift+D), `ARRANGE_BY_WEBSITE` (Alt+Shift+G), `CLOSE_DUPLICATES` (Alt+Shift+K), `VIEW_SESSIONS` (Alt+Shift+S). The popup shows Chrome's live bindings (`chrome.commands.getAll()`), not these suggestions. `SLEEP_INACTIVE` and `SAVE_SESSION` are assignable but have no suggested key. `chrome.commands.onCommand` dispatches command names straight into `HANDLERS`, so any new command name must match a handler name exactly.
- Saved sessions live in `chrome.storage.local.savedSessions` (array of `{date, tabs:[{title,url}]}`); the sleep threshold lives in `chrome.storage.sync.sleepHours` (default 1, clamped 0.25–168 by the popup).

## Behavior Gotchas
- **Scopes:** `ARRANGE_BY_*`, `UNGROUP_ALL`, `CLOSE_DUPLICATES`, `SLEEP_INACTIVE`, `SAVE_SESSION` and the `PREVIEW` counts act on the **current window** (`executeAction` passes `currentWindow: request.allWindows !== true`). `UNDO_CLOSE` is browser-wide: it reopens the last closed tab/window from any window, which is why the popup labels it "Any window". `ARRANGE_BY_*` honour the saved `regroupAll` preference (`chrome.storage.sync`, default false = leave existing groups alone).
- **Date buckets** (from `getDateBucket`): `Today`, `This Week`, `Last Week`, `This Month`, `Older`, plus `Unknown` (missing/invalid `lastAccessed`). Note: no "Yesterday" bucket.
- **Skipped tabs:** pinned tabs are never grouped/slept/closed; tabs with non-restorable schemes (`chrome:`, `chrome-extension:`, `edge:`, `about:`, `devtools:`, `view-source:`, … — see `BLOCKED_SCHEMES`/`isRestorable`) are ignored for grouping and session-saving.
- **Close Duplicates:** strips the URL fragment plus tracking params (`utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_eid`) before comparing; keeps pinned copy → active copy → first; never closes a pinned tab. `duplicateIdsToRemove` in `logic.js` is the pure core used by both the action and the popup preview.
- **Undo Close:** `UNDO_CLOSE` restores the most recently closed tab/window via `chrome.sessions.restore()` (needs the `sessions` permission).
- **Popup preview:** `PREVIEW` returns `{ duplicates, idle }` counts without mutating anything. The popup shows them in the two badges (`–` until a well-formed reply arrives; failures are silent) and re-requests them after Close Duplicates, Sleep, Undo Close and a threshold change.
- **Save Session:** filters non-pinned restorable tabs, unshifts into `savedSessions` history, and opens the dashboard. **Tabs are never closed by saving.**
- **Sleep rules:** never sleeps pinned tabs, audible tabs, or the active tab.
- **Dashboard data hygiene:** `normalizeSessions` (session.js) skips non-object sessions, treats a missing/invalid `tabs` as empty, and swaps a non-object tab for an empty placeholder. It must never *filter* tabs: the dashboard sends `SESSION_REMOVE_TAB` with the tab's array index, so removing entries would make a removal hit the wrong stored tab.


## Test Suite
- `test.js`: `node test.js [filter]` — runner over `tests/*.test.js` (logic, background, reliability, popup-result, shortcuts, popup-ux, dashboard-ux, dom via jsdom, style, load).
- `logic.js`: Pure helpers shared by service worker, popup/dashboard (`<script>`), and tests (`require`): `isRestorable`, `dedupeKey`, `getDomain`, `getDateBucket`, `isLinkable`, `clampSleepHours`, `filterSessions`, `newSessionId`, `sessionIdOf`, `runBatched`, `relativeTime`, `hostSummary`, session limits (`MAX_SAVED_SESSIONS`, `MAX_TABS_PER_SESSION`). Because it shares one browser scope with `popup.js`/`session.js`, a new helper name must not collide with theirs (a `dom` test guards this).
- `tests/style.test.js`: token contrast guard (every text/surface pair at least 4.5:1) and CSS lint for `popup.css` and `styles.css` (11px type floor, no `!important` outside `prefers-reduced-motion`, no `#94a3b8` as a text colour).
- `tests/popup-ux.test.js`, `tests/dashboard-ux.test.js`: jsdom behaviour for the popup (structure, badges, tones) and dashboard (card identity, Latest chip, feedback, `/` and `Esc`).
- `tests/e2e/*.e2e.js` + `tests/e2e/helpers.js`: real Chromium; `assertMinFontSize` fails on any visible text under 11px.
- `tests/helpers/chrome-stub.js`: Shared chrome mock (`makeChromeStub`, `makeBrowserChromeStub`, which also stubs `windows.create`).
- `tests/helpers/load-background.js`: Loads `background.js` into Node tests with `logic.js` helpers exposed.
- `tests/load.test.js`: 300-tab load acceptance suite (grouping, discarding, dedupe, save caps).

## Security & UI Rules
- Saved tab titles/URLs are attacker-controlled page data. Never interpolate them into `innerHTML` — set via `textContent` and only assign an `href` after checking the scheme is `http(s)` (`isLinkable` in session.js). The only `innerHTML` is the `icon()` helper with hard-coded inline SVG paths.
- No `alert`/`confirm` anywhere: the popup has a status line; the dashboard Delete button uses a two-step inline confirm.
- Restore opens a fresh window via `chrome.windows.create({ url: [...], })`; favicons come from the extension `/_favicon/` API.

## UI / UX Design Guidelines (premium glass aesthetic, defined by the tokens in `styles.css`)
- **Use the tokens in `:root` at the top of `styles.css`; don't hard-code.** Type: `--fs-chip` 11px (monospace shortcut chips only), `--fs-sm` 12px, `--fs-md` 13px, `--fs-lg` 15px, `--fs-xl` 18px. Text: `--text` `#172033`, `--text-2` `#475569`, `--text-muted` `#5a677d`. Accent: `--accent` `#6366f1` for fills and borders only, `--accent-strong` `#4f46e5` for text, links and primary buttons. Semantic: `--success`, `--danger`, `--warn`, each with a `-soft` background. Spacing 4/8/12/16/24px, radii 8/10/14/18px.
- **Floors (enforced by `tests/style.test.js` and the e2e font check):** no rendered text under 11px; no `!important` outside the `prefers-reduced-motion` block; every text/surface token pair at least 4.5:1; `#94a3b8` is decorative only, never a text colour.
- **Popup layout:** 360px wide, at most 560px tall (Chrome caps popups at 600px; the e2e also checks a worst case with the warning banner and a three-line result). Primary actions are at least 36px high; the header Shortcuts link and the Regroup toggle are 30px. Three numbered sections with scope chips; keep the "This window" / "Any window" labels truthful. Dashboard targets are at least 32px.
- **Status bar:** one shared `.status` component with neutral, `.is-success` and `.error` tones; set the tone only through `setStatus` (popup) / `setDashboardStatus` (dashboard) so the two classes stay mutually exclusive. It collapses when empty in the popup.
- **Look:** page gradient `--page-light` to `--page-dark`; frosted cards (`--surface-glass` + `backdrop-filter: blur(12px)`); white buttons with a subtle shadow and an indigo hover lift; inline SVG stroke icons (`stroke-width: 2`); one shared focus ring (`:where(button, input, a):focus-visible`: 2px opaque `--accent` outline). Don't override it with translucent outlines (focus indicators need 3:1); the dashboard search input draws no outline, so `.search-control:focus-within` carries the same ring. `.status` uses `overflow-wrap: anywhere` so a hostname in a message never widens a page.

## Icons
- `icon.svg`: 128-unit viewBox with `rx="28"` (21.875%). The popup `.brand img` (28px, 8px radius) and `.dashboard-brand img` (46px, 12px radius) approximate that curve — revisit them on any logo change.
- `icon16/32/48/128.png`: 16 & 32 use a simplified flat-card mark (offset cards mush below ~48px); 48 & 128 use the detailed mark. Regenerate all four together on any logo change.

## Repo History Notes
- A full `v2.0.0` rewrite (src/ layout, options page, node:test suite) was committed then **reverted** — HEAD is the flat V1 codebase; don't reintroduce the `src/` structure.
- `README.md` documents the current feature set; treat AGENTS.md as the authoritative design doc.