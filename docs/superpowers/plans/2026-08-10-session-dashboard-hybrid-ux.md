# Saved Sessions Hybrid Dashboard UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `session.html` into a polished hybrid dashboard that is easier to scan and operate while preserving the existing saved-session model and background APIs.

**Architecture:** Keep the current plain-JavaScript rendering model and shared `styles.css`, but scope new presentation rules under `.dashboard`. `session.js` remains the only dashboard behavior layer and gains small helpers for summary metrics, host display, status updates, and search state. Existing `filterSessions()` and background session mutations remain unchanged.

**Tech Stack:** Chrome Extensions Manifest V3, HTML/CSS/vanilla JavaScript, Chrome storage/tabs/windows APIs, Node custom test runner, jsdom, Playwright Chromium.

## Global Constraints
- Do not change the saved-session schema, storage key, caps, or background message contracts.
- Keep the existing 150 ms search debounce and `filterSessions()` helper.
- Only validated http(s) URLs receive clickable hrefs.
- Restore in new window and Restore here keep their existing semantics.
- Delete keeps the existing two-click confirmation and three-second reset.
- Icon-only controls have explicit accessible names and at least 32×32 CSS px practical hit targets.
- Dashboard styling is scoped under `.dashboard` where practical.
- Desktop supports two session columns; narrow screens use one column.
- The page must not horizontally overflow at a 360 px viewport.
- TDD: new behavior/layout-contract tests are committed and verified failing before production changes.

---

### Task 1: Dashboard semantic shell, summary, and search UX

**Files:**
- Modify: `tests/dom.test.js`
- Modify: `session.html`
- Modify: `session.js`
- Modify: `styles.css`

**Interfaces:**
- `sessionStats(items)` returns `{ sessionCount, tabCount }`.
- `updateDashboardSummary(visibleResults)` updates `#session-count`, `#tab-count`, and `#result-summary`.
- `clearSearch()` empties `#search`, hides `#clear-search`, and re-renders immediately.

- [ ] **Step 1: Write failing jsdom assertions for the new semantic shell.**

Add assertions after the first dashboard load:

```js
assert.strictEqual(dom.window.document.documentElement.lang, 'en');
assert.ok(dom.window.document.querySelector('main.dashboard-main'));
assert.ok(dom.window.document.querySelector('.dashboard-subtitle'));
assert.strictEqual(dom.window.document.getElementById('session-count').textContent, '1 session');
assert.strictEqual(dom.window.document.getElementById('tab-count').textContent, '2 tabs');
assert.strictEqual(dom.window.document.getElementById('search').getAttribute('aria-controls'), 'sessions-container');
assert.ok(dom.window.document.getElementById('clear-search').getAttribute('aria-label'));
```

Add a second session to the fixture and assert plural summary copy. Search for `Safe`, wait 200 ms, then assert `#result-summary` reports one matching session/tab and `#clear-search` is visible. Click clear and assert all rows return.

- [ ] **Step 2: Run the targeted DOM suite and confirm RED.**

Run: `node test.js dom`

Expected: FAIL because the semantic shell, summary elements, and clear-search button do not exist.

- [ ] **Step 3: Implement the semantic HTML shell.**

Update `session.html` with `lang="en"`, viewport metadata, a `<main class="container dashboard-main">`, branded header/subtitle, summary chips, sticky search toolbar with a `<label>`, clear-search button, live result summary, existing status region, and `#sessions-container`.

- [ ] **Step 4: Implement summary/search helpers in `session.js`.**

Use helpers shaped like:

```js
function sessionStats(items) {
  return items.reduce((acc, item) => {
    const tabs = Array.isArray(item.tabs) ? item.tabs : (Array.isArray(item.session?.tabs) ? item.tabs : []);
    acc.sessionCount += 1;
    acc.tabCount += tabs.length;
    return acc;
  }, { sessionCount: 0, tabCount: 0 });
}

function setDashboardStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}
```

`render()` must update total summary from `sessions`, filtered result summary from `filterSessions(sessions, searchInput.value)`, and clear-button visibility from the trimmed query.

- [ ] **Step 5: Add dashboard-scoped header/search/summary CSS.**

Create polished header surfaces, summary chips, a sticky toolbar using `position: sticky; top: 0`, and visible `:focus-visible` styles. Keep selectors under `.dashboard`.

- [ ] **Step 6: Run `node test.js dom` and confirm GREEN.**

Expected: all existing dashboard behavior plus new semantic/search-summary assertions pass.

- [ ] **Step 7: Commit Task 1.**

```bash
git add session.html session.js styles.css tests/dom.test.js
git commit -m "feat: improve session dashboard navigation"
```

### Task 2: Session-card hierarchy, dense tab rows, and mutation cleanup

**Files:**
- Modify: `tests/dom.test.js`
- Modify: `session.js`
- Modify: `styles.css`

**Interfaces:**
- `hostnameOf(url)` returns normalized hostname without leading `www.`, or `''`.
- Each card is `article.session` with a stable heading id.
- Primary restore button class: `.btn-session-primary`.
- Secondary restore button class: `.btn-session-secondary`.
- Delete button class remains `.btn-danger` and gains `.btn-session-delete`.
- Tab hostname element class: `.link-host`.

- [ ] **Step 1: Write failing card/row accessibility and hierarchy tests.**

Assert:

```js
const card = dom.window.document.querySelector('article.session');
assert.ok(card);
assert.ok(card.getAttribute('aria-labelledby'));
assert.strictEqual(card.querySelector('.btn-session-primary').textContent.includes('Restore in new window'), true);
assert.strictEqual(card.querySelector('.btn-session-secondary').textContent.includes('Restore here'), true);
assert.ok(card.querySelector('.btn-session-delete'));
assert.strictEqual(card.querySelector('.link-host').textContent, 'a.com');
assert.match(card.querySelector('.delete-link-btn').getAttribute('aria-label'), /Remove Safe/);
```

Keep the existing unsafe-title and non-http href assertions.

- [ ] **Step 2: Run `node test.js dom` and confirm RED.**

Expected: FAIL because card semantics/classes/hostname metadata/accessibility labels are missing.

- [ ] **Step 3: Refactor `linkRow()` and `sessionCard()`.**

Add `hostnameOf(url)`, render title + host inside a `.link-copy` wrapper, and give remove buttons `type="button"`, `title`, and `ariaLabel`. Render semantic card header/action/body/footer sections. Keep all arbitrary title/URL insertion via `textContent` or validated href assignment only.

- [ ] **Step 4: Clean up mutation/status error handling.**

Replace nested `loadSessions().catch(...)` with a straight `try/await/catch` path:

```js
async function mutate(action, payload) {
  setDashboardStatus('');
  try {
    const response = await chrome.runtime.sendMessage({ action, ...payload });
    if (response?.status === 'error') throw new Error(response.error || 'Mutation failed');
    await loadSessions();
  } catch (err) {
    setDashboardStatus(err?.message || 'Something went wrong.', true);
  }
}
```

Use `setDashboardStatus()` for Restore here and initial load errors as well.

- [ ] **Step 5: Add card/action/tab-row CSS.**

Make the primary restore visually strongest, secondary restore neutral, Delete quieter and separated, rows dense with two-line truncating text, and icon-only remove controls at least 32×32 px. Ensure all `min-width: 0` boundaries needed for truncation are present.

- [ ] **Step 6: Run `node test.js dom` and full `npm test`.**

Expected: all suites pass.

- [ ] **Step 7: Commit Task 2.**

```bash
git add session.js styles.css tests/dom.test.js
git commit -m "feat: refine saved session cards"
```

### Task 3: Empty states and responsive Chromium acceptance

**Files:**
- Modify: `tests/dom.test.js`
- Create: `tests/e2e/session-dashboard.e2e.js`
- Modify: `.github/workflows/ci.yml`
- Modify: `styles.css`

**Interfaces:**
- Empty state uses `.empty-state` and `.empty-state-action` for no-match clear action.
- Chromium test writes `savedSessions` through `chrome.storage.local` from the extension page before reloading the dashboard.

- [ ] **Step 1: Add failing jsdom empty-state tests.**

For zero sessions assert the copy includes `Save Session`. For a query with no matches assert an `.empty-state-action` button exists; click it and assert the search query clears and sessions render again.

- [ ] **Step 2: Run `node test.js dom` and confirm RED.**

Expected: FAIL because the current empty states are plain text and have no clear action.

- [ ] **Step 3: Implement useful empty states and responsive CSS.**

Render structured empty-state heading/body. The no-match state includes a button wired to `clearSearch()`. Add a one-column breakpoint around 720 px and ensure dashboard/card/link containers use `box-sizing: border-box`, `min-width: 0`, and max-width constraints that prevent 360 px overflow.

- [ ] **Step 4: Create real Chromium session-dashboard E2E.**

The script loads the unpacked extension via persistent Chromium context, writes two representative sessions (including a very long title and one non-http URL) to `chrome.storage.local`, opens `session.html`, and asserts:

```js
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
assert.strictEqual(overflow, false);
assert.strictEqual(await page.locator('article.session').count(), 2);
```

At a desktop viewport, compare card top coordinates and assert two cards share a row. At 360 px width, assert the second card is below the first and `scrollWidth <= clientWidth`. Exercise search + clear, keyboard Tab focus into the primary restore control, Restore here opening linkable URLs, and two-click Delete.

- [ ] **Step 5: Add the dashboard E2E to CI.**

Replace the single E2E command with:

```yaml
      - name: Run Chromium extension E2E
        run: |
          node tests/e2e/regroup.e2e.js
          node tests/e2e/session-dashboard.e2e.js
```

- [ ] **Step 6: Run/verify CI RED if layout or behavior still fails, then fix only the failing dashboard behavior.**

Expected before final fixes: any real-browser layout/accessibility issue is visible as an E2E failure rather than being inferred from jsdom.

- [ ] **Step 7: Commit Task 3.**

```bash
git add tests/dom.test.js tests/e2e/session-dashboard.e2e.js .github/workflows/ci.yml styles.css session.js
git commit -m "test: cover saved sessions dashboard in Chromium"
```

### Task 4: Documentation, diff review, and final verification

**Files:**
- Modify: `README.md`
- Review: all changed files

**Interfaces:**
- README describes summary/search, responsive hybrid cards, restore hierarchy, and real Chromium dashboard coverage without changing product claims outside saved sessions.

- [ ] **Step 1: Update README saved-session and testing sections.**

Document the new summary/search/clear behavior, responsive cards, hostname rows, explicit restore choices, and the second Chromium E2E command.

- [ ] **Step 2: Run final exact-head verification.**

Required checks:

```bash
npm ci
npm test
node --check background.js
node --check logic.js
node --check popup.js
node --check session.js
npm install --no-save --package-lock=false playwright@1.62.0
npx playwright install --with-deps chromium
node tests/e2e/regroup.e2e.js
node tests/e2e/session-dashboard.e2e.js
```

- [ ] **Step 3: Review the PR diff.**

Confirm no saved-session schema/background contract changes, no popup styling regressions, no unsafe user-data interpolation, and no unrelated feature work.

- [ ] **Step 4: Push/open or update the PR and include TDD + real-browser evidence.**

Keep the branch unmerged until the user explicitly requests integration.
