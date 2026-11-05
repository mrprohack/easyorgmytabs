# Popup & Dashboard UX/UI Overhaul Design

- Status: Draft, awaiting spec review
- Date: 2026-11-04
- Scope decision: **A** (restyle and restructure existing UI only), approved in conversation

## Goal

Make the popup and the saved-sessions dashboard readable, self-explanatory and consistent, so a user can tell what each control does, what it will affect, and what happened afterwards, without adding any new background behaviour.

### Success criteria

1. No rendered text is smaller than 11px, there is no `!important` in the stylesheets (the single exception is the `prefers-reduced-motion` block, where it is the standard way to force motion off), and every text colour is at least 4.5:1 against every surface it can sit on.
2. The popup is 360px wide and at most 560px tall. The order Organize, then Clean up, then Save is visible at a glance, and each section states its scope.
3. Duplicate and idle-tab counts are visible before the user clicks, and results appear in a tinted status bar.
4. Dashboard cards can be told apart without names (relative time plus host summary), the newest session is marked, and every mutation is confirmed in the status line.
5. All Node/jsdom suites and both Chromium e2e flows pass, and before/after screenshots exist for both pages.

## Scope

**In:** `popup.html`, `popup.js`, `popup.css`, `session.html`, `session.js`, `styles.css`, two pure helpers in `logic.js`, tests, `README.md`, `AGENTS.md`.

**Out (explicit):** dark mode, session rename, undo for grouping, sleep or delete, onboarding, new surfaces (options page, side panel, tab-search palette), any new `HANDLERS` action or `background.js` change, manifest or version changes, icon changes.

## Audit (verified in code)

1. Popup text is 6.5-11px; toggle state, shortcut chips and safe-label are 6.5-7px; help text, tool labels and status are 9px.
2. `#94a3b8` (about 2.6:1 on white) is used for shortcut chips, regroup detail, safe-label, link host and visible-count text. `#6366f1` text on white is about 4.47:1, also under 4.5:1.
3. Close Duplicates, Ungroup all and Sleep run immediately. The only preview (`N duplicates · M idle tabs`) is written into the 9px status line and overwritten by the first action.
4. `Undo` only calls `chrome.sessions.restore()`: it reopens the last closed tab or window in any window. It cannot undo grouping, ungrouping or sleeping.
5. Window scope is real but unstated: Date, Website, Ungroup, Duplicates, Sleep and Save are all current-window (`executeAction` passes `currentWindow: request.allWindows !== true`).
6. `popup.css` overrides `styles.css` with `!important` (shortcut chip position, ungroup button) because `styles.css` still carries absolute-positioned chip rules and a 280px popup width that `popup.css` re-sets to 350px.
7. Dashboard cards are identified only by a timestamp. Restore in a new window, delete, add link and remove link give no feedback. Cards use `align-items: start`, so rows are ragged.
8. `AGENTS.md` is stale against the code: it says the arrange actions work across all windows and lists Alt+Shift+W/X; the code and README use current-window and Alt+Shift+G/K.

## Foundation

Tokens live in `:root` at the top of `styles.css` and are consumed by both pages. Values are starting points; `tests/style.test.js` is the arbiter for contrast.

| Group | Tokens |
| --- | --- |
| Type scale | chip 11px (monospace shortcut chips only), small 12px, body 13px, title 15px, heading 18px, display `clamp(24px, 4vw, 34px)` |
| Text | primary `#172033`, secondary `#475569`, muted `#5a677d` (4.6:1 on `#e2e8f0`, the darkest surface) |
| Accent | fill/border `#6366f1`; text, links and primary buttons `#4f46e5`; soft `#eef2ff` |
| Semantic | success `#15803d` on `#f0fdf4`, danger `#b91c1c` on `#fef2f2`, warning `#b45309` on `#fffbeb` |
| Surface | white, glass `rgba(255,255,255,.84)`, border `#dbe3ee` |
| Spacing / radii | 4, 8, 12, 16, 24px; radii 8, 10, 14, 18px |
| Targets / focus | popup targets at least 36px, dashboard at least 32px; one shared focus ring (3px indigo outline) on every interactive element |

Rules:

- `#94a3b8` may be used only for decorative, non-text elements.
- `styles.css` owns tokens, the base reset, and shared components: `.btn`, `.input`, the `.shortcut` chip (static, inline-flex), the `.status` bar (neutral, `.is-success`, `.error`) and the focus ring. `popup.css` and the dashboard section only arrange layout.
- Remove dead rules (`body.popup` 280px, absolute `.btn .shortcut`, and any of `.header`, `.container`, `.btn-row`, `.setting` that are no longer referenced). Check each by grep before deleting.
- The indigo glass identity stays. `AGENTS.md` UI section is rewritten to match the shipped tokens.

## Popup

Width 360px, natural height at most 560px (estimated at about 535px; the e2e test enforces it). Fallback if exceeded: tool rows drop from 40px to 36px.

```
┌─────────────────────────────────────┐
│ ▣ Tab Organizer       ⌨ Shortcuts   │ header; #btn-shortcuts-settings moves here
│ ⚠ 1 shortcut not assigned…          │ #shortcut-warning, visible only when needed
│ ┌ 1  Organize · This window  [Date active]
│ │ ┌─────────────┐ ┌─────────────┐   │
│ │ │ By Date   ✓ │ │ By Website  │   │ aria-pressed; active = check icon + text
│ │ │ Alt+Shift+D │ │ Alt+Shift+G │   │
│ │ └─────────────┘ └─────────────┘   │
│ │ Regroup all                   (○) │
│ │ Only ungrouped tabs               │ #regroup-all-detail keeps its exact strings
│ │ Ungroup all                       │ quiet secondary row
│ ├ 2  Clean up · This window          │
│ │ Close Duplicates  [3] Alt+Shift+K │ #badge-duplicates from PREVIEW
│ │ Sleep Idle Tabs   [5]  after [1] h│ #badge-idle; #sleep-hours sits in its row
│ │ ───────────────────────────────── │
│ │ Undo Close              Any window│ hint: reopens last closed tab or window
│ ├ 3  Save                            │
│ │ [Save Session] [Saved Sessions ⌥S]│
│ └ ✓ Grouped into 4 groups by Website.│ #status: tinted bar, role=status
└─────────────────────────────────────┘
```

### Structure

Three `section.popup-section` blocks, each with a numbered step badge, an `h2` (keeping `#organize-heading` and `#tools-heading`), and a scope chip. The scope chip reads "This window" for Organize and Clean up; the Undo row sits below a hairline divider with its own "Any window" hint so the scope claim stays true.

New elements: `#badge-duplicates`, `#badge-idle`. Action names follow the README (Title Case). The sleep threshold is a `div.tool-row` containing `#btn-sleep` plus a sibling label wrapping `#sleep-hours` (no interactive element nested inside a button). The input's accessible name is "Sleep tabs idle over (hours)".

### Behaviour changes in `popup.js` (UI only, no new messages)

- `setStatus(text, ...)` supports three tones: neutral, success (`.is-success`) and error (`.error`, unchanged). Counts greater than 0 produce success; "Nothing to ..." results stay neutral.
- The on-open `PREVIEW` result fills the two badges instead of `#status`. `#status` is empty on open.
- `refreshPreview()` re-sends the existing `PREVIEW` action after Close Duplicates, Sleep, Undo Close and a sleep-threshold change, so badges never go stale. Failures are silent, as today.
- Badges show the number even at 0 (muted). Buttons are never disabled at 0, because the existing tests click them and expect "No duplicates found." and similar messages.
- While an action runs: all buttons and the toggle are disabled (as today), `#status` shows `Working…`, and `aria-busy` is set on `body`.
- Shortcut chips keep reading live `chrome.commands.getAll()` values; unassigned chips keep the amber style and "Not assigned" text.

### States to design and test

Idle, working, success, nothing-to-do, error, shortcut-warning visible, background not responding.

## Dashboard

Class hooks and DOM order are preserved. In particular nothing focusable is added between `#search` and the first `.btn-session-primary` (the e2e keyboard-order test), and `.btn-session-delete` stays after the restore buttons.

- **Card identity:** `.meta` becomes `N tabs · 3 days ago`. A new `p.session-hosts` shows up to three distinct hosts and `+N more`. The newest session (index 0) shows a `Latest` chip when no search is active.
- **Pure helpers in `logic.js`** (unit-tested, exported): `relativeTime(date, now, locale)` using `Intl.RelativeTimeFormat` with `numeric: 'auto'`, and `hostSummary(tabs, max = 3)` built on `getDomain` that returns `{ hosts, more }`. Names must not collide with `session.js` or `popup.js` globals (they share one scope in the browser; an existing regression test covers this).
- **Feedback in the status line:** `Opened N tab(s) in a new window.`, `Opened N tab(s) in this window.` (existing, unchanged), `Session deleted.`, `Added <host> to this session.`, `Removed tab.` Errors keep the existing path. `mutate()` takes an optional success message.
- **Keyboard:** `/` focuses search when focus is not already in an input; `Esc` in a non-empty search clears it.
- **Layout:** the grid uses `align-items: stretch` with the tab list flexing, so rows align. Breakpoints stay at 760px (one column) and 480px. Type: tab title 13px, host and meta 12px, eyebrow 11px.
- **Status bar:** the dashboard status uses the same shared `.status` component as the popup.

## Contract preserved

All current IDs, class hooks and pinned strings stay: every ID and class selector used in `tests/*.js` and `tests/e2e/*.js` (popup: `btn-date`, `btn-website`, `btn-ungroup`, `btn-dedupe`, `btn-undo`, `btn-sleep`, `btn-session`, `btn-view-sessions`, `regroup-all-toggle`, `regroup-all-detail`, `organize-mode`, `sleep-hours`, `status`, `shortcut-warning`, `btn-shortcuts-settings`, `.shortcut`, `.has-shortcut` on the same four buttons, `.action-label`; dashboard: `main.dashboard-main`, `article.session`, `.link`, `.link-host`, `.btn-session-primary`, `.btn-session-secondary`, `.btn-restore-here`, `.btn-session-delete`, `.btn-danger`, `.delete-link-btn`, `.add-link-form`, `.empty-state`, `.empty-state-action`, `#search`, `#clear-search`, `#session-count`, `#tab-count`, `#result-summary`), plus the strings `Only ungrouped tabs`, `Rebuild all groups`, `Date active`, `Website active`, `Not organized`, `Confirm delete?`, `Working…`, the search placeholder and every result message produced by `formatActionResponse`.

### Intentional test changes (the only ones)

| Test | Change |
| --- | --- |
| `tests/dom.test.js` "preview counts render into the status line on open" | Assert `#badge-duplicates` is `3`, `#badge-idle` is `2`, and `#status` is empty on open |
| `tests/e2e/regroup.e2e.js` popup height (two assertions) | Limit goes from 600px to 560px |

## Verification plan

1. **Baseline before any code change:** `npm ci`, `node test.js`, both e2e files against the preinstalled Chromium, and 2x "before" screenshots (popup: idle, mode active, shortcut warning, error; dashboard: 1100px, 360px, empty). Screenshots go to the session scratchpad, not the repo.
2. **New unit tests:**
   - `tests/style.test.js` (auto-discovered by `test.js`): fails on any `font-size` under 11px, any `!important` outside an `@media (prefers-reduced-motion: reduce)` block, any `color` using `#94a3b8`, and any token text/surface pair under 4.5:1 (including the darkest page-gradient stop).
   - `tests/logic.test.js`: `relativeTime` and `hostSummary` cases.
   - `tests/dom.test.js`: popup sections, scope chips, badges and tones; dashboard Latest chip, host summary, `/` and `Esc`, feedback messages.
3. **E2E (Chromium):** popup height at most 560px, chips do not overlap labels (extended to `#btn-dedupe` and `#btn-view-sessions`), badges update after Close Duplicates, and a runtime check that no visible text computes below 11px on either page. Existing dashboard assertions (two columns at 1100px, one at 360px, no horizontal overflow, keyboard order, two-step delete) stay.
4. **After each milestone:** `node test.js`, `node --check` on the four scripts, both e2e files, and a screenshot review.

## Work sequence

| Milestone | Content | Done when |
| --- | --- | --- |
| M0 | Baseline run and "before" screenshots | Results recorded, no code changed |
| M1 | Tokens and shared components in `styles.css`, `tests/style.test.js`; pages still render | Style test passes on the new token layer; existing suites unchanged |
| M2 | Popup: HTML restructure, `popup.css` rewrite, `popup.js` changes, test updates | Popup suites and e2e green at 560px |
| M3 | Dashboard: `session.js`, `styles.css`, `logic.js` helpers, tests | Dashboard suites and e2e green |
| M4 | Dead CSS removed, README and `AGENTS.md` updated, "after" screenshots, final full run | Everything green, before/after delivered |

Each milestone is its own commit; no version bump unless requested.

## Risks

1. **560px budget** at larger type. Mitigation: the 36px-row fallback above; the e2e test enforces it.
2. **Strings pinned by tests.** Mitigation: the contract list above; only the two listed test changes are intended.
3. **Shared global scope** between `logic.js`, `popup.js` and `session.js` in a real browser. Mitigation: the existing scope regression test, plus unique helper names.
4. **Local Playwright is 1.63; CI pins 1.62.** CI is the arbiter for e2e. If extension e2e cannot run headless here, rely on jsdom plus screenshots locally and CI for the real-browser check, and say so in the report.
5. **Locale-dependent relative time.** The helper takes `now` and `locale` so tests are deterministic.

## Docs to update in M4

- `README.md`: popup and dashboard descriptions, shortcut table check, usage section.
- `AGENTS.md`: fix the stale scope and shortcut claims (current-window; Alt+Shift+D/G/K/S), add `popup.css`, tokens and `style.test.js` to the architecture notes, and rewrite the UI guidelines to the shipped tokens.

## Open questions

None blocking.
