# Improvement Roadmap: Tab Organizer Pro

Status of this doc: planning only - no code changes yet. Anything below can be turned into a
full implementation plan (writing-plans) and executed with TDD when you pick it.

## Current State (verified 2026-08-09)

- Chrome Extension Manifest V3, v1.0. Permissions: `tabs`, `tabGroups`, `storage`, `favicon`.
- Features: Arrange by Date, Arrange by Website, Close Duplicates, Sleep Inactive Tabs,
  Save Session (keeps tabs open), Session Dashboard (search/restore/add/delete),
  View Saved Sessions popup button, 3 keyboard shortcuts.
- Architecture: `background.js` (HANDLERS map, serialized session writes, runBatched),
  `logic.js` (shared pure helpers), `popup.js`/`session.js` + `error-report.js`, 4 test
  suites (`node test.js`): logic, background, dom (jsdom), load (300-tab) - all green.

## Principles (constraints that stay)

- Premium glass aesthetic; no `alert`/`confirm`; XSS-safe rendering (textContent + http(s)-only href).
- `node test.js` stays the test command; every change ships with tests (TDD).
- Background edge cases: ignore chrome:// URLs, respect pinned tabs, catch async errors.
- No runtime dependencies; jsdom is dev-only.

---

## Phase 1 - Quick wins (low effort, high value)

| # | Item | Why | Effort | Risk |
|---|------|-----|--------|------|
| 1.1 | Add keyboard shortcuts for the missing actions: `SLEEP_INACTIVE`, `SAVE_SESSION`, and a new `VIEW_SESSIONS` background handler (commands can't run popup-only code) | Keyboard users currently only get 3 of 6 actions | S | L |
| 1.2 | Undo last action via `chrome.sessions` ("Undo last close"/restore) | Close Duplicates and Save Session are destructive; undo builds trust | M | M (new permission) |
| 1.3 | Action previews in the popup (e.g. "12 duplicates", "8 idle tabs" shown on hover/before run) | Users act on data, not guesses | M | L |
| 1.4 | Restore option in the dashboard: "open in current window" vs new window | Merging sessions into an existing window is a common workflow | S | L |
| 1.5 | Dark mode for popup + dashboard (CSS variables, persisted preference) | Premium feel, eye comfort; low risk since styles are centralized | M | L |
| 1.6 | Toolbar badge with actionable count (duplicates / sleepable tabs) | Visibility without opening the popup | M | M (badge on every tab event needs care) |

## Phase 2 - Power features

| # | Item | Why | Effort | Risk |
|---|------|-----|--------|------|
| 2.1 | Export/import sessions as JSON | Backup, device migration, share setups | M | L |
| 2.2 | Auto-save session when a window closes (opt-in setting) | Never lose a window of tabs again | M | M (needs onRemoved heuristics) |
| 2.3 | Context menu: "Sleep this tab", "Add tab to saved session" | Power-user reach without opening the popup | M | L |
| 2.4 | Options page: sleep exclusions, dedupe rules (trailing slash, case, keep-newest), default restore behavior | Current defaults are hard-coded | L | M |
| 2.5 | Dedupe improvements: normalize trailing slashes, optionally compare by domain only | Catches more real duplicates safely | S-M | M (false positives) |
| 2.6 | Quick tab search in the popup (type to find any tab, jump/close) | Power users live in the popup | L | L |
| 2.7 | Grouping presets: save a color/domain profile and re-apply | Arrange-by-website becomes reproducible | M | L |

## Phase 3 - Performance & scale

| # | Item | Why | Effort | Risk |
|---|------|-----|--------|------|
| 3.1 | Chunked dashboard rendering (render sessions in frames, not one 10k-row burst) | Caps allow 50 sessions x 200 tabs = 10k rows; first paint and search get slow | M | M (timing-sensitive tests) |
| 3.2 | Time budgets in the load suite (assert handlers finish under a generous bound) | Performance regressions become test failures | S | L |
| 3.3 | Favicon pipeline: dedupe identical URLs, cache last-good icon per page | Fewer requests, faster dashboard | S | L |
| 3.4 | Reuse/update DOM rows instead of full re-render on search | Smoother typing at scale | L | M |

## Phase 4 - Engineering quality & release

| # | Item | Why | Effort | Risk |
|---|------|-----|--------|------|
| 4.1 | Real-browser E2E smoke tests (Playwright loading the unpacked extension) | The shared-global redeclaration bug slipped through jsdom; a real-browser smoke test catches that class | M | L |
| 4.2 | GitHub Actions CI: run `node test.js` + `node --check` on every push | Protect master | S | L |
| 4.3 | Release packaging script (zip with only runtime files, version bump, changelog) + Web Store checklist (screenshots, description, privacy note: all data is local) | Ready for the store | S-M | L |
| 4.4 | Diagnostics entry (e.g. "Run self-check" in the dashboard: verify helpers, storage, and each handler) | Turns user reports into answers | M | L |
| 4.5 | Session restore resilience: retry/ignore dead URLs, report failures inline | Restore currently fails silently if one URL is rejected | S | L |

## Non-goals (deliberately out of scope for now)

- TypeScript rewrite (no build step is a feature).
- i18n (single-language product today).
- Cloud sync beyond `chrome.storage.sync` limits (sessions cap at 50x200; keep local).
- Over-engineering: no framework, no bundler, no new runtime deps.

## Suggested order & dependencies

1. Phase 1 first (1.1 -> 1.4 -> 1.6 -> 1.3/1.5): biggest value per effort, all independent.
2. 1.2 (Undo) pairs well with 2.5 (dedupe) since both touch Close Duplicates.
3. Phase 2 after Phase 1; 2.4 (options page) unlocks 2.2/2.5/2.7 defaults.
4. Phase 3 when the dashboard/load tests start hurting; 3.2 should land before 3.1 to catch regressions.
5. 4.1 and 4.2 early if you plan more feature work (safety net); 4.3 when you want a store release.

## Success criteria

- All four suites stay green after every phase (CI enforced in 4.2).
- 300-tab load suite includes time budgets (3.2) and stays under budget.
- A fresh install: every action works from popup, keyboard, and (new) context menu.
- Release package from 4.3 installs cleanly from an unpacked zip in a clean Chrome profile.