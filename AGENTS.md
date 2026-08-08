# Project Context: Tab Organizer Pro (easyorgmytabs)

## Key Commands & Verification

- **Tests:** `node test.js` — the only automated check (no build step, no package.json, no linter).
- **How test.js works:** it `eval`s `background.js` in Node with a mocked `chrome` global (`storage`, `tabs`, `tabGroups`, `runtime`, `commands`). Two consequences:
  - `background.js` must stay plain-script compatible: **no ES modules, no top-level await**.
  - Any new top-level `chrome.*` API call in `background.js` must also be stubbed in `test.js` or the suite crashes.
- Run `node test.js` after any change to `background.js`, `test.js`, or popup/session status text.

## Architecture & Responsibilities
- `manifest.json`: MV3, permissions `tabs`, `tabGroups`, `storage`, `favicon`. Version 1.1.
- `background.js`: service worker; ALL tab manipulation lives here. Every action is an async function in the `HANDLERS` map (line 1) that returns a count, or rejects.
- `popup.html`/`popup.js`: sends `{ action }` messages, disables buttons while working, renders the returned count via `RESULT_TEXT` (singular/plural/none per action). Also holds the `sleepHours` threshold input.
- `session.html`/`session.js`: dashboard for saved sessions (restore/delete/add links/search).
- `styles.css`: shared by both — `body.popup` vs `body.dashboard` scope differences.

## Wiring Rules (easy to miss)
- **New action = 3 edits:** `background.js` `HANDLERS` + `popup.js` `ACTIONS` map + `popup.js` `RESULT_TEXT`. Missing any one fails silently (popup gets an empty reply and shows the "none" message).
- Reply contract: `{ status: 'done', count }` or `{ status: 'error', error }`; the listener returns `true` for async.
- **Keyboard shortcuts only exist for 3 of 5 actions:** `ARRANGE_BY_DATE` (Alt+Shift+D), `ARRANGE_BY_WEBSITE` (Alt+Shift+W), `CLOSE_DUPLICATES` (Alt+Shift+X). `chrome.commands.onCommand` dispatches command names straight into `HANDLERS`, so any new command name must match a handler name exactly.
- Saved sessions live in `chrome.storage.local.savedSessions` (array of `{date, tabs:[{title,url}]}`); the sleep threshold lives in `chrome.storage.sync.sleepHours` (default 1, clamped 0.25–168 by the popup).

## Behavior Gotchas
- **Scopes differ per action:** `ARRANGE_BY_*` group tabs **across all windows** (ungrouping every non-pinned tab in every window first, per-window groups); `CLOSE_DUPLICATES`, `SLEEP_INACTIVE`, and `SAVE_SESSION` are **current-window only**.
- **Date buckets** (from `getDateBucket`): `Today`, `This Week`, `Last Week`, `This Month`, `Older`, plus `Unknown` (missing/invalid `lastAccessed`). Note: no "Yesterday" bucket.
- **Skipped tabs:** pinned tabs are never grouped/slept/closed; tabs with non-restorable schemes (`chrome:`, `chrome-extension:`, `edge:`, `about:`, `devtools:`, `view-source:`, … — see `BLOCKED_SCHEMES`/`isRestorable`) are ignored for grouping and session-saving.
- **Close Duplicates:** strips the URL fragment plus tracking params (`utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_eid`) before comparing; keeps pinned copy → active copy → first; never closes a pinned tab.
- **Save Session ordering matters:** filters non-pinned restorable tabs, unshifts into `savedSessions` history, **opens the dashboard first, then closes the tabs** — closing first would close the whole window.
- **Sleep rules:** never sleeps pinned tabs, audible tabs, or the active tab.

## Security & UI Rules
- Saved tab titles/URLs are attacker-controlled page data. Never interpolate them into `innerHTML` — set via `textContent` and only assign an `href` after checking the scheme is `http(s)` (`isLinkable` in session.js). The only `innerHTML` is the `icon()` helper with hard-coded inline SVG paths.
- No `alert`/`confirm` anywhere: the popup has a status line; the dashboard Delete button uses a two-step inline confirm.
- Restore opens a fresh window via `chrome.windows.create({ url: [...], })`; favicons come from the extension `/_favicon/` API.

## UI / UX Design Guidelines (premium glass aesthetic — match exactly)
- Background: `linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)`.
- Buttons: white, `border-radius: 12px`, `box-shadow: 0 2px 4px rgb(0 0 0 / 0.05)`, hover `translateY(-2px)` + indigo shadow, inline SVG stroke icons (`stroke-width: 2`).
- Typography: `system-ui` stack; `#1e293b` primary, `#334155` buttons, `#3b82f6` links, `#6366f1` accent.
- Cards: frosted `rgba(255,255,255,0.6)` + `backdrop-filter: blur(12px)`, `border-radius: 16px`.

## Icons
- `icon.svg`: 128-unit viewBox with `rx="28"`; `.header img` uses `border-radius: 21.875%` to match the same curve — keep the two in sync.
- `icon16/32/48/128.png`: 16 & 32 use a simplified flat-card mark (offset cards mush below ~48px); 48 & 128 use the detailed mark. Regenerate all four together on any logo change.

## Repo History Notes
- A full `v2.0.0` rewrite (src/ layout, options page, node:test suite) was committed then **reverted** — HEAD is the flat V1 codebase; don't reintroduce the `src/` structure.
- `README.md` documents V1 features only — treat AGENTS.md as the authoritative design doc.