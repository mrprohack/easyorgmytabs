# Popup & Dashboard UX/UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the popup and saved-sessions dashboard readable, self-explanatory and consistent, with no new background behaviour.

**Architecture:** One token layer in `styles.css` feeds shared components and both pages. The popup is re-laid out as three numbered sections (Organize, Clean up, Save) with preview badges and a tinted status bar. Dashboard cards gain relative time, a host summary, a Latest chip and status feedback. Two pure helpers go into `logic.js`; `background.js` is untouched.

**Tech Stack:** Plain HTML/CSS/JS (MV3, no build step), Node `assert` tests with jsdom, Playwright Chromium e2e (preinstalled locally, 1.62 pinned in CI).

**Spec:** `docs/superpowers/specs/2026-11-04-ux-overhaul-design.md`

## Global Constraints

- Popup `body` width **360px**; natural height **at most 560px** (hard Chrome cap 600px, also asserted for the worst case).
- Rendered text **at least 11px**; **no `!important`** except inside `@media (prefers-reduced-motion: reduce)`; every text colour **at least 4.5:1** on every surface it sits on; `#94a3b8` is never a text `color`.
- Type tokens: chip 11px, small 12px, body 13px, title 15px, heading 18px. Targets at least 36px (popup) and 32px (dashboard).
- No new `HANDLERS` action, no `background.js` / `manifest.json` / icon change, no version bump. `logic.js` stays plain-script compatible (no ES modules, no top-level await) and new helpers are added to its `module.exports`.
- Security rules stay: no `innerHTML` with saved data, `href` only after `isLinkable`, no `alert`/`confirm`.
- Preserve every ID, class and pinned string listed under "Contract preserved" in the spec. Action names are Title Case (`Close Duplicates`, `Sleep Idle Tabs`, `Undo Close`, `Save Session`, `Saved Sessions`); `By Date`, `By Website` and `Ungroup all` keep their current text.
- **Standard check** (run at the end of every task): `node test.js && node --check background.js && node --check logic.js && node --check popup.js && node --check session.js`. When e2e is runnable (Task 1 decides), also `node tests/e2e/regroup.e2e.js && node tests/e2e/session-dashboard.e2e.js`. Never reinstall Playwright locally.
- **Commits:** one per task on branch `ccr-a8ebd4d9-p0mji0`, then `git push -u origin ccr-a8ebd4d9-p0mji0`. Every commit message ends with these two trailer lines:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01H8EGaJs974AC1hhyMq3eXJ`
- `SCRATCH=/tmp/claude-0/-home-user-easyorgmytabs/020ee17f-717e-5478-a2c1-82b700a84753/scratchpad` holds screenshots and helper scripts. Nothing from it is committed.

## Review Focus

Most likely first; each line has its test in the named task.

1. Typing `/` inside the dashboard's add-link URL field must not steal focus to search (Task 6).
2. Worst-case popup height (shortcut warning visible plus a multi-line status) must stay within Chrome's 600px popup cap (Task 4).
3. A failed, rejected or malformed `PREVIEW` reply leaves the badges at `–`, never `undefined` or `NaN` (Task 3).
4. A success tone must not linger on a later error, including errors injected by `error-report.js` (Task 3, Task 6).
5. Very long hostnames in the card's host summary must not widen the page (Task 7).

## File Structure

| File | Responsibility |
| --- | --- |
| `styles.css` | Tokens (`:root`), shared components (`.btn`, `.input`, `.shortcut` chip, `.status` tones, focus ring), dashboard layout |
| `popup.css` | Popup layout only; consumes tokens |
| `popup.html` / `popup.js` | Three-section markup; badges, status tones, `refreshPreview()` |
| `error-report.js` | Clears the success tone when it reports an error |
| `session.js` | Card identity, Latest chip, feedback messages, `/` and `Esc` |
| `logic.js` | `relativeTime`, `hostSummary` (pure) |
| `tests/style.test.js` (new) | Token contrast and CSS lint |
| `tests/popup-ux.test.js`, `tests/dashboard-ux.test.js` (new) | jsdom behaviour for the new UI |
| `tests/e2e/helpers.js` (new) | `assertMinFontSize(page, label)` shared by both e2e files |
| `tests/helpers/chrome-stub.js` | Add `windows.create` to `makeBrowserChromeStub` |

---

### Task 1: Baseline and screenshot harness (no repo changes)

**Files:** none in the repo. Create `$SCRATCH/shots.js`.

**Interfaces:**
- Produces: `node $SCRATCH/shots.js <label>` writes 2x PNGs to `$SCRATCH/shots/<label>/`, and prints the popup `body` height. Later tasks and Task 8 reuse it.

- [ ] **Step 1:** Run `npm ci`, then `node test.js`. Expected: `all tests passed`. Then `git status --short` must be empty.
- [ ] **Step 2:** Run both e2e files. Expected: the lines `Chromium E2E passed: ...` and `Chromium session dashboard E2E passed: ...`. If Chromium cannot launch an extension here, paste the failure into your notes, mark e2e as CI-only for all later tasks, and continue (spec risk 4).
- [ ] **Step 3:** Write `$SCRATCH/shots.js`. It starts a tiny local http server for fixture pages, launches Chromium with the extension exactly as `tests/e2e/regroup.e2e.js` does, uses `deviceScaleFactor: 2`, and writes these files: `popup-idle.png`, `popup-mode-active.png` (after clicking By Website), `popup-shortcut-warning.png` (an `addInitScript` overrides `chrome.commands.getAll` to return one unassigned binding), `popup-error.png` (an `addInitScript` makes `chrome.runtime.sendMessage` resolve `{status:'error',error:'Quota exceeded'}` for a Close Duplicates click), `dashboard-1100.png`, `dashboard-360.png`, `dashboard-empty.png`. Popup shots use a 360x620 viewport and `fullPage: true`. Dashboard fixture: three saved sessions with 2-6 tabs each, mixed hosts, one very long title.
- [ ] **Step 4:** Run `node $SCRATCH/shots.js before`. Expected: seven non-empty PNGs and a printed popup height. Open `popup-idle.png` and `dashboard-1100.png` with Read to confirm they rendered the real pages.

No commit.

---

### Task 2: Design tokens and the contrast guard

**Files:**
- Modify: `styles.css` (add `:root` block at the very top)
- Create: `tests/style.test.js`

**Interfaces:**
- Produces: the CSS custom properties below; and in `tests/style.test.js` the helpers `parseRootTokens(css: string): Record<string, string>` (first `:root{}` block, values trimmed), `contrastRatio(fgHex: string, bgHex: string): number` (WCAG 2.x, 6-digit hex), `stripReducedMotion(css: string): string` (removes `@media (prefers-reduced-motion: reduce){...}` blocks with brace matching), and `lintCss(fileName: string): void` added in Task 4.

- [ ] **Step 1: Write the failing test** `tests/style.test.js`, runner-style (`module.exports = async function main()`), reading `styles.css` from the repo root:

```js
const REQUIRED = ['--fs-chip','--fs-sm','--fs-md','--fs-lg','--fs-xl','--fs-display','--text','--text-2','--text-muted',
  '--accent','--accent-strong','--accent-soft','--on-accent','--surface','--surface-glass','--border','--page-light','--page-dark',
  '--success','--success-soft','--danger','--danger-soft','--warn','--warn-soft','--sp-1','--sp-2','--sp-3','--sp-4','--sp-5',
  '--r-sm','--r-md','--r-lg','--r-xl','--target-popup','--target-dash','--focus-ring'];
const PAIRS = [['--text','--surface'],['--text-2','--surface'],['--text-muted','--surface'],['--text-muted','--page-light'],
  ['--text-muted','--page-dark'],['--text-muted','--accent-soft'],['--text-2','--page-dark'],['--accent-strong','--surface'],
  ['--accent-strong','--accent-soft'],['--accent-strong','--page-dark'],['--on-accent','--accent-strong'],
  ['--success','--success-soft'],['--danger','--danger-soft'],['--warn','--warn-soft']];
// assert every REQUIRED token exists; assert contrastRatio('#000000','#ffffff') rounds to 21;
// assert every PAIR is >= 4.5 with a message naming the pair and its ratio.
```

- [ ] **Step 2:** Run `node test.js style`. Expected: FAIL (missing tokens).
- [ ] **Step 3:** Add this `:root` block at the top of `styles.css` (values are pinned by the spec; if a pair fails the guard, darken that colour token until it passes and say so in the commit message):

```css
:root {
  --fs-chip: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px; --fs-xl: 18px; --fs-display: clamp(24px, 4vw, 34px);
  --text: #172033; --text-2: #475569; --text-muted: #5a677d;
  --accent: #6366f1; --accent-strong: #4f46e5; --accent-soft: #eef2ff; --on-accent: #ffffff;
  --surface: #ffffff; --surface-glass: rgba(255, 255, 255, 0.84); --border: #dbe3ee;
  --page-light: #f8fafc; --page-dark: #e2e8f0;
  --success: #15803d; --success-soft: #f0fdf4; --danger: #b91c1c; --danger-soft: #fef2f2; --warn: #b45309; --warn-soft: #fffbeb;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px;
  --r-sm: 8px; --r-md: 10px; --r-lg: 14px; --r-xl: 18px;
  --target-popup: 36px; --target-dash: 32px;
  --focus-ring: 0 0 0 3px rgba(99, 102, 241, 0.35);
}
```

- [ ] **Step 4:** Run the Standard check. Expected: all green; the tokens are inert so no page changes.
- [ ] **Step 5:** Commit `feat(styles): add design tokens and contrast guard`, push.

---

### Task 3: Popup markup and behaviour

**Files:**
- Modify: `popup.html`, `popup.js`, `error-report.js`, `tests/dom.test.js:253-259`
- Create: `tests/popup-ux.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 4 styles against exactly this markup):

```
header.popup-header > .brand (img, h1 "Tab Organizer") + button#btn-shortcuts-settings.shortcut-settings-btn (svg + "Shortcuts", aria-label "Keyboard shortcuts")
p#shortcut-warning.shortcut-warning[role=status][hidden]
section.popup-section.organize-section[aria-labelledby=organize-heading]
  header.section-heading > span.step-badge "1", h2#organize-heading "Organize", span.scope-chip "This window", span#organize-mode.mode-pill
  div.organize-actions > button#btn-date.btn.organize-btn.has-shortcut, button#btn-website.btn.organize-btn.has-shortcut   (unchanged inner structure)
  div.regroup-row (unchanged ids: #regroup-all-toggle, #regroup-all-state, #regroup-all-detail)
  button#btn-ungroup.btn.btn-ungroup > svg + span.action-label "Ungroup all"
section.popup-section.tools-section[aria-labelledby=tools-heading]
  header.section-heading > span.step-badge "2", h2#tools-heading "Clean up", span.scope-chip "This window"
  div.tool-list >
    div.tool-row > button#btn-dedupe.btn.tool-btn.has-shortcut > svg, span.action-label "Close Duplicates", span#badge-duplicates.tool-badge "–", span.shortcut
    div.tool-row > button#btn-sleep.btn.tool-btn > svg, span.action-label "Sleep Idle Tabs", span#badge-idle.tool-badge "–"
                 + label.threshold "after" input#sleep-hours.input[aria-label="Sleep tabs idle over (hours)"] "h"
  div.tool-list.tool-list-secondary > div.tool-row > button#btn-undo.btn.tool-btn > svg, span.action-label "Undo Close", span.tool-hint "Any window"
section.popup-section.save-section[aria-labelledby=save-heading]
  header.section-heading > span.step-badge "3", h2#save-heading "Save"
  div.session-row > button#btn-session.btn.session-btn ("Save Session"), button#btn-view-sessions.btn.session-btn.has-shortcut ("Saved Sessions" + span.shortcut)
p#status.status[role=status][aria-live=polite]
```

  Removed classes and elements: `.section-help`, `.safe-label`, `.tool-grid`, `.compact-tool`, `.inline-setting`, `.compact-heading`, `.eyebrow`, `.shortcut-health`. `#sleep-hours` must not be a descendant of any `button`.
  `popup.js`: `setStatus(text: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void` (toggles `.is-success` and `.error`, mutually exclusive; update the existing `setStatus(..., true)` callers to `'error'`); `refreshPreview(): Promise<void>`.

- [ ] **Step 1: Write the failing tests.** In `tests/popup-ux.test.js`, copy the `loadPopup(stub)` helper from `tests/shortcuts.test.js:11-20` (also eval `error-report.js` first in the tests that need it) and add these named cases:

```js
// structure
assert.strictEqual(document.querySelectorAll('section.popup-section').length, 3);
assert.deepStrictEqual([...document.querySelectorAll('.step-badge')].map(n => n.textContent), ['1', '2', '3']);
assert.deepStrictEqual([...document.querySelectorAll('.scope-chip')].map(n => n.textContent), ['This window', 'This window']);
assert.deepStrictEqual([...document.querySelectorAll('.section-heading h2')].map(n => n.textContent), ['Organize', 'Clean up', 'Save']);
for (const [id, label] of [['btn-dedupe','Close Duplicates'],['btn-sleep','Sleep Idle Tabs'],['btn-undo','Undo Close'],['btn-session','Save Session'],['btn-view-sessions','Saved Sessions']])
  assert.strictEqual(document.querySelector(`#${id} .action-label`).textContent, label);
assert.strictEqual(document.querySelector('#btn-undo .tool-hint').textContent, 'Any window');
assert.strictEqual(document.querySelector('button #sleep-hours'), null);
assert.ok(document.querySelector('.popup-header #btn-shortcuts-settings'));
// badges: '–' until PREVIEW answers; then '3' / '2'; #status is '' on open
// badges stay '–' (no throw) when PREVIEW rejects, returns {status:'error'}, or returns count: 1   [Review Focus 3]
// badges refresh: PREVIEW answers {3,2} then {0,2}; after clicking #btn-dedupe → '#badge-duplicates' is '0'
// badges refresh after #sleep-hours change: PREVIEW message count goes from 1 to 2
// tones: dedupe count 3 → #status has is-success, not error; then {status:'error'} → error, not is-success; count 0 → neither class
// error-report: after a success, dispatch ErrorEvent('Boom') → #status has error and not is-success   [Review Focus 4]
// aria-busy: with a 50ms sendMessage, document.body aria-busy is 'true' at 10ms and 'false' after 80ms
```

  In `tests/dom.test.js` replace the assertion at line 259 with: `#status` text is `''`, `#badge-duplicates` is `'3'`, `#badge-idle` is `'2'`; update the comment above it to "preview counts render into the badges on open".
- [ ] **Step 2:** Run `node test.js popup-ux` and `node test.js dom`. Expected: both FAIL.
- [ ] **Step 3:** Rewrite `popup.html` to the markup above (reuse the existing inline SVG paths; add a small keyboard icon path for the Shortcuts button; titles via `title` attributes). In `popup.js` implement: tone-aware `setStatus`; success tone when `(response.result?.changed ?? response.count ?? 0) > 0`, neutral otherwise; `refreshPreview()` that sends `{ action: 'PREVIEW' }`, writes `String(count.duplicates)` / `String(count.idle)` only when `status === 'done'` and `count` is an object, and swallows failures; call it once at init, and (not awaited) after a successful CLOSE_DUPLICATES, SLEEP_INACTIVE or UNDO_CLOSE and after the sleep-threshold `change` handler's storage write; remove the status-line preview; set `document.body` `aria-busy` true/false around `triggerAction`. In `error-report.js` also `classList.remove('is-success')`.
- [ ] **Step 4:** Run `node test.js`. Expected: all pass, including `popup-result`, `shortcuts` and `dom`.
- [ ] **Step 5:** Run the Standard check (CSS is stale until Task 4, so skip e2e here), then commit `feat(popup): three-step markup, preview badges, status tones`, push.

---

### Task 4: Popup styling

**Files:**
- Modify: `styles.css` (shared components; remove popup-era rules), `popup.css` (rewrite), `tests/style.test.js`, `tests/e2e/regroup.e2e.js`
- Create: `tests/e2e/helpers.js`

**Interfaces:**
- Consumes: Task 2 tokens; Task 3 markup.
- Produces: shared `.status` tones (`.status`, `.status.is-success`, `.status.error`) and static `.shortcut` chip in `styles.css` (Task 7 relies on both); `lintCss(fileName)`; `assertMinFontSize(page: Page, label: string): Promise<void>` in `tests/e2e/helpers.js`.

- [ ] **Step 1: Write the failing checks.**
  `tests/style.test.js`: add `lintCss(fileName)` (strip `/* */` comments first) asserting, with the file name in each message: every `px` value inside every `font-size` declaration is at least 11; `stripReducedMotion(css)` contains no `!important`; no `color: #94a3b8` (regex `/(^|[;{\s])color\s*:\s*#94a3b8/i`). Call `lintCss('popup.css')` from `main()`.
  `tests/e2e/helpers.js`: `assertMinFontSize` walks visible text nodes under `document.body` and asserts every parent's computed `font-size` is at least 11px, listing offenders in the message.
  `tests/e2e/regroup.e2e.js`: change both `600` height limits (lines ~121 and ~246) to `560`; after the shortcut checks add `await popup.waitForFunction(() => /^\d+$/.test(document.getElementById('badge-duplicates').textContent))`; call `assertMinFontSize(popup, 'popup')` next to each `assertShortcutLayout`; add the worst-case check [Review Focus 2]:

```js
await popup.evaluate(() => {
  const w = document.getElementById('shortcut-warning'); w.hidden = false;
  w.textContent = '2 keyboard shortcuts are not assigned in Chrome.';
  document.getElementById('status').textContent =
    'Regrouped 12 tabs into 4 groups by Website. 3 grouped tabs left unchanged. 1 pinned grouped tab left unchanged.';
});
const worst = await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
assert.ok(worst <= 600, `worst-case popup is ${worst}px; Chrome caps popups at 600px`);
```

- [ ] **Step 2:** Run `node test.js style` (FAIL on `popup.css` font sizes and `!important`). If e2e is runnable, `node tests/e2e/regroup.e2e.js` also fails on the new height and badge checks.
- [ ] **Step 3:** Rewrite `popup.css` and the shared parts of `styles.css`, using only tokens:
  - `body.popup` is 360px wide, `box-sizing: border-box`, padding `--sp-3`, vertical gap `--sp-2`. Move the `body.popup` rules out of `styles.css` and delete the old 280px block.
  - Sections are frosted cards (`--surface-glass`, `--r-lg`, 1px `--border`). The step badge is a 20px accent circle. `.scope-chip` and `.mode-pill` are 12px pills (`.mode-pill.is-active` uses `--accent-soft` with `--accent-strong`). Section `h2` is `--fs-md` bold in `--text`.
  - Organize buttons are a 2-column grid, min-height 56px, label 13px bold with the shortcut chip on the second line. `.organize-btn.active-mode .action-label::after` adds a `✓`.
  - `.tool-row` is a flex row with min-height 40px (fall back to `--target-popup`, 36px, only if the 560px limit is missed). Its `.tool-btn` flexes to fill the row and lays out icon, label, badge and chip as a grid; in the sleep row `.threshold` sits at the right edge of the row, outside the button. `.tool-badge` is a 12px pill (muted at `–` or `0`). `.tool-hint` is 12px `--text-muted`. `.threshold` is 12px with a 52px-wide input. `.tool-list-secondary` has a hairline top border.
  - Any rule that sets `display` on an element that is toggled with the `hidden` attribute (`.shortcut-warning`) needs a companion `.shortcut-warning[hidden] { display: none; }`, because `!important` is not allowed.
  - `.shortcut` in `styles.css` becomes a static inline-flex 11px monospace chip (no absolute position); `.shortcut-unassigned .shortcut` keeps the amber style (`--warn` on `--warn-soft`).
  - `.status` is a bar with min-height `--target-popup`, 12px text; `.is-success` uses `--success`/`--success-soft`; `.error` uses `--danger`/`--danger-soft`; define `.error` after `.is-success`. `.shortcut-warning` is a `--warn` banner above Organize.
  - Every interactive element gets the focus ring (`outline: 2px solid var(--accent); box-shadow: var(--focus-ring)`) on `:focus-visible`. Keep a plain `prefers-reduced-motion` block with no `!important`.
  - Remove from `styles.css` the rules that only served the old popup: `body.popup`, the absolute `.btn .shortcut`, `.setting*`, `.popup .btn*`, and the old `.status` rules. Grep each selector across `*.html` and `*.js` before deleting.
- [ ] **Step 4:** Run `node test.js` (expected: all pass) and, if runnable, `node tests/e2e/regroup.e2e.js` (expected: passes, prints a height at or under 560). Run `node $SCRATCH/shots.js wip`, open `popup-idle.png`, `popup-mode-active.png`, `popup-shortcut-warning.png`, `popup-error.png` with Read, and fix any clipping, overlap or unreadable text before committing.
- [ ] **Step 5:** Run the Standard check, commit `feat(popup): token-based styling, legible type, tinted status bar`, push.

---

### Task 5: Pure helpers in `logic.js`

**Files:**
- Modify: `logic.js` (functions plus the `module.exports` block), `tests/logic.test.js`

**Interfaces:**
- Produces:

```js
function relativeTime(date, now = Date.now(), locale = undefined) // -> string; '' for invalid input
function hostSummary(tabs, max = 3)                               // -> { hosts: string[], more: number }
```

- [ ] **Step 1: Write the failing tests** in `tests/logic.test.js` (append inside `main`), with `const NOW = Date.UTC(2026, 10, 4, 12, 0, 0)`, `const ago = (ms) => new Date(NOW - ms).toISOString()`, `const MIN = 60e3, HR = 36e5, DAY = 864e5`:

```js
assert.strictEqual(L.relativeTime(ago(30e3), NOW, 'en'), 'just now');
assert.strictEqual(L.relativeTime(new Date(NOW + 2 * MIN).toISOString(), NOW, 'en'), 'just now'); // clock skew
assert.strictEqual(L.relativeTime(ago(5 * MIN), NOW, 'en'), '5 minutes ago');
assert.strictEqual(L.relativeTime(ago(HR), NOW, 'en'), '1 hour ago');
assert.strictEqual(L.relativeTime(ago(2 * HR), NOW, 'en'), '2 hours ago');
assert.strictEqual(L.relativeTime(ago(26 * HR), NOW, 'en'), 'yesterday');
assert.strictEqual(L.relativeTime(ago(3 * DAY), NOW, 'en'), '3 days ago');
assert.strictEqual(L.relativeTime(ago(29 * DAY), NOW, 'en'), '29 days ago');
assert.strictEqual(L.relativeTime(ago(45 * DAY), NOW, 'en'), 'last month');
assert.strictEqual(L.relativeTime(ago(100 * DAY), NOW, 'en'), '3 months ago');
assert.strictEqual(L.relativeTime(ago(400 * DAY), NOW, 'en'), 'last year');
assert.strictEqual(L.relativeTime(ago(800 * DAY), NOW, 'en'), '2 years ago');
assert.strictEqual(L.relativeTime(NOW - 3 * DAY, NOW, 'en'), '3 days ago');          // number input
assert.strictEqual(L.relativeTime(new Date(NOW - 3 * DAY), NOW, 'en'), '3 days ago'); // Date input
assert.strictEqual(L.relativeTime('garbage', NOW, 'en'), '');
assert.strictEqual(L.relativeTime(undefined, NOW, 'en'), '');
assert.strictEqual(L.relativeTime(null, NOW, 'en'), '');   // null must not be read as the 1970 epoch
assert.strictEqual(L.relativeTime('', NOW, 'en'), '');
const tab = (url) => ({ url });
assert.deepStrictEqual(L.hostSummary([tab('https://www.a.com/x'), tab('https://a.com/y'), tab('https://b.com'), tab('javascript:alert(1)')]), { hosts: ['a.com', 'b.com'], more: 0 });
assert.deepStrictEqual(L.hostSummary(['a', 'b', 'c', 'd', 'e'].map(h => tab(`https://${h}.com`))), { hosts: ['a.com', 'b.com', 'c.com'], more: 2 });
assert.deepStrictEqual(L.hostSummary([]), { hosts: [], more: 0 });
assert.deepStrictEqual(L.hostSummary([tab(undefined)]), { hosts: [], more: 0 });
```

- [ ] **Step 2:** Run `node test.js logic`. Expected: FAIL (`relativeTime is not a function`).
- [ ] **Step 3:** Implement both functions in `logic.js` and add them to `module.exports`. `relativeTime`: `null`, `undefined` and `''` give `''` (do not let `new Date(null)` become the epoch); otherwise parse with `new Date(date)`, and an invalid date gives `''`; difference under 60s (including future dates) gives `'just now'`; then `Intl.RelativeTimeFormat(locale, { numeric: 'auto' })` with minutes (under 1h), hours (under 24h), days (under 30d), months (`floor(days / 30)`, under 365d) and years (`floor(days / 365)`), always negative. `hostSummary`: only `isLinkable` URLs, host from `getDomain`, distinct in first-seen order, `more = distinct - hosts.length`.
- [ ] **Step 4:** Run `node test.js`. Expected: all pass, including the `dom` scope-collision regression (eval of `logic.js` + `session.js` + `popup.js` together).
- [ ] **Step 5:** Run the Standard check, commit `feat(logic): add relativeTime and hostSummary helpers`, push.

---

### Task 6: Dashboard behaviour

**Files:**
- Modify: `session.js`, `tests/helpers/chrome-stub.js` (add to the object returned by `makeBrowserChromeStub`: `windows: { async create({ url }) { stored._windows = stored._windows || []; stored._windows.push(url); } }`)
- Create: `tests/dashboard-ux.test.js`

**Interfaces:**
- Consumes: Task 5 `relativeTime`, `hostSummary`; Task 4 `.status.is-success`.
- Produces (Task 7 styles these): `p.session-hosts` inside `.session-heading-group` after `.meta`; `span.session-badge` ("Latest") as the second grid column of `.session-card-header`; `setDashboardStatus(text: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void`; `mutate(action: string, payload: object, successMessage?: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests** in `tests/dashboard-ux.test.js` (copy `loadPage` from `tests/dom.test.js:8-22`; build dates from `Date.now()`; compute expected relative strings with `new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })` so the test follows the default locale):

```js
// identity
assert.strictEqual(card.querySelector('.meta').textContent, `2 tabs · ${rtf.format(-3, 'day')}`);   // session dated 3 days ago
assert.strictEqual(card.querySelector('.session-hosts').textContent, 'a.com · b.com');            // tabs a.com, www.a.com, b.com
assert.strictEqual(fiveHostCard.querySelector('.session-hosts').textContent, 'a.com · b.com · c.com · +2 more');
assert.strictEqual(jsOnlyCard.querySelector('.session-hosts'), null);
assert.strictEqual(badCard.querySelector('.meta').textContent, '1 tab');   // date 'garbage': card still renders, no ' · '
// Latest chip
assert.deepStrictEqual([...document.querySelectorAll('article.session')].map(a => !!a.querySelector('.session-badge')), [true, false]);
// while searching (query matching only session two) there is no .session-badge anywhere; after clearing it is back on card one
// feedback (each also asserts #status has class is-success and not error)
'Opened 2 tabs in a new window.'     // Restore in new window; stub._stored._windows deep-equals [[url1, url2]]
'Opened 1 tab in a new window.'      // singular
'Session deleted.'                   // two clicks on .btn-session-delete
'Added new.com to this session.'     // add-link form with https://new.com/
'Removed tab.'                       // .delete-link-btn
// tone does not linger: after a success, a mutate error ('Quota exceeded') leaves class error and no is-success   [Review Focus 4]
// keyboard   [Review Focus 1]
const slash = new dom.window.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
dom.window.document.body.dispatchEvent(slash);
assert.strictEqual(dom.window.document.activeElement, search);
assert.strictEqual(slash.defaultPrevented, true);
// '/' dispatched on the add-link input: defaultPrevented false and activeElement stays the input
// Ctrl+'/' on body: defaultPrevented false, search not focused
// 'Escape' keydown on #search with value 'x': value becomes '' and #clear-search is hidden
```

- [ ] **Step 2:** Run `node test.js dashboard-ux`. Expected: FAIL.
- [ ] **Step 3:** Implement in `session.js`: `setDashboardStatus` tones (update its existing callers; error paths use `'error'`); `.meta` text `N tab(s)` plus ` · ${relativeTime(session.date)}` only when non-empty; `p.session-hosts` text `hosts.join(' · ')` plus ` · +${more} more` (omit the element when `hosts` is empty); `sessionCard(session, visibleTabs, { isLatest })` with `isLatest = session === sessions[0] && query === ''`; make "Restore in new window" async with try/catch and the singular/plural message; pass success messages through `mutate` (set after `loadSessions()` succeeds); `document` keydown handler for `/` (ignore when `event.target` is an `INPUT`, `TEXTAREA`, `SELECT` or content-editable element, or when `ctrlKey`/`metaKey`/`altKey` is set) and `searchInput` keydown handler for `Escape` that calls `clearSearch()` when the value is non-empty.
- [ ] **Step 4:** Run `node test.js`. Expected: all pass, including the existing dashboard assertions in `dom.test.js`.
- [ ] **Step 5:** Run the Standard check, commit `feat(dashboard): card identity, Latest chip, feedback and keyboard shortcuts`, push.

---

### Task 7: Dashboard styling and dead-CSS removal

**Files:**
- Modify: `styles.css`, `tests/style.test.js`, `tests/e2e/session-dashboard.e2e.js`

**Interfaces:**
- Consumes: Task 4 shared `.status`, `.shortcut`, `assertMinFontSize`; Task 6 markup (`.session-hosts`, `.session-badge`).

- [ ] **Step 1: Write the failing checks.** In `tests/style.test.js` add `lintCss('styles.css')` to `main()`. In `tests/e2e/session-dashboard.e2e.js`: add to session two a fifth tab with a very long host, `{ title: 'Long host', url: 'http://' + 'a'.repeat(50) + '.' + 'b'.repeat(50) + '.localhost:' + port + '/x' }`, and update the `'4 tabs'` assertion to `'5 tabs'`. Then add:
  - after the desktop overflow check, assert `cards.nth(0).locator('.session-badge')` has text `Latest` and `cards.nth(1).locator('.session-badge')` has count 0;
  - assert `cards.nth(0).locator('.session-hosts')` is visible;
  - call `assertMinFontSize(dashboard, 'dashboard 1100')` and again after the 360px viewport switch, next to the existing `noHorizontalOverflow` calls [Review Focus 5 is the long-host fixture plus those overflow checks];
  - assert the first card's `.session-hosts` computed `text-overflow` is `ellipsis`.
- [ ] **Step 2:** Run `node test.js style` (FAIL: `styles.css` has 9-10px sizes and `#94a3b8` text colours) and, if runnable, the dashboard e2e (FAIL on the new assertions).
- [ ] **Step 3:** Restyle the dashboard section of `styles.css` with tokens only:
  - Text sizes: tab title 13px; `.meta`, `.session-hosts`, `.link-host`, `.result-summary`, `.summary-chip`, `.session-visible-count` and buttons 12px; `.session-eyebrow` and `.dashboard-eyebrow` 11px in `--accent-strong`; the favicon-fallback initial 11px. All text colours come from `--text`, `--text-2`, `--text-muted`, `--accent-strong`; remove every `#94a3b8` text colour.
  - `.session-hosts` is one line (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`) in `--text-muted`. `.session-badge` is a 12px `--accent-soft` pill with `--accent-strong` text, aligned top-right of the header.
  - The grid uses `align-items: stretch`, with `.session` as a flex column and `.links-list` as `flex: 1 1 auto` (keep its max-height cap). Breakpoints (760px, 480px) and the DOM order are unchanged.
  - `.dashboard-status` reuses the shared `.status` tones. Keyboard focus uses the shared focus ring; the primary-restore outline must stay non-`none` (existing e2e check).
  - Delete the now-dead `.header*` rules and `.btn-row`, after grepping every selector across `*.html` and `*.js` (list the greps in the commit body). Keep `.container` (used by `session.html`).
- [ ] **Step 4:** Run `node test.js` (expected: all pass) and, if runnable, the dashboard e2e (expected: passes, including 2 columns at 1100px, 1 at 360px, no overflow, keyboard order, two-step delete). Run `node $SCRATCH/shots.js wip`, open `dashboard-1100.png`, `dashboard-360.png`, `dashboard-empty.png` with Read, and fix any visual defect.
- [ ] **Step 5:** Run the Standard check, commit `feat(dashboard): token-based styling, aligned cards, dead CSS removed`, push.

---

### Task 8: Docs, final verification, after screenshots

**Files:**
- Modify: `README.md`, `AGENTS.md`

- [ ] **Step 1: README.** Update: the popup description (three numbered sections with scope chips, preview badges, tinted status bar, `Shortcuts` in the header), the dashboard bullets (relative time, host summary, Latest chip, status feedback, `/` focuses search, `Esc` clears it), and the Development section (`node test.js style`, `popup-ux`, `dashboard-ux`; mention `tests/e2e/helpers.js`). Check the shortcut table still lists Alt+Shift+D/G/K/S.
- [ ] **Step 2: AGENTS.md.** Fix the stale claims: `ARRANGE_BY_*` are current-window (not all windows); shortcuts are D/G/K/S (not W/X); manifest version is 1.1.0. Add `popup.css`, the tokens in `styles.css`, and the new test files to the architecture and test-suite notes. Rewrite "UI / UX Design Guidelines" to the shipped system: token names and values, the 11px type floor, the 4.5:1 contrast rule, `#94a3b8` decorative only, status tones, 36px/32px targets, and the indigo glass identity. Keep the file's existing terse style.
- [ ] **Step 3: Final verification.** Run the Standard check including both e2e files. Run `git diff --name-only origin/master...HEAD` and confirm it lists none of `background.js`, `manifest.json`, `icon*`. Run `node $SCRATCH/shots.js after`.
- [ ] **Step 4:** Open the seven "after" PNGs with Read, compare against the "before" set from Task 1, and fix any defect found (re-run the affected task's checks). Send the key before/after pairs (`popup-idle`, `popup-mode-active`, `dashboard-1100`, `dashboard-360`) to the user with SendUserFile.
- [ ] **Step 5:** Commit `docs: describe the new popup and dashboard UX; fix stale AGENTS.md claims`, push, and report: test counts, popup height, any e2e that could only run in CI, and the before/after screenshots.
