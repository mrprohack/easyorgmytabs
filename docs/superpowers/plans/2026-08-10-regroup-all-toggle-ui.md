# Regroup All Toggle UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a saved Regroup all On/Off mode, make Ungroup all explicit and reliable, and prevent shortcut badges from overlapping popup labels.

**Architecture:** Keep the current Manifest V3 background/message architecture. Add one boolean `regroupAll` preference in `chrome.storage.sync`; grouping handlers receive it explicitly and prepare current-window tabs either by preserving every existing group (Off) or ungrouping all non-pinned grouped tabs first (On). Replace ownership-only ungroup with explicit current-window ungroup-all, while retaining the ownership registry for active-mode metadata.

**Tech Stack:** Chrome Extensions Manifest V3, plain JavaScript, chrome.tabs/tabGroups/storage APIs, Node custom test runner, jsdom, Playwright Chromium.

## Global Constraints
- Regroup all defaults to `false`.
- Off means existing groups are untouched; only ungrouped eligible tabs are organized.
- On means all non-pinned grouped tabs in the current window are ungrouped before Date/Website grouping.
- Ungroup all removes all non-pinned grouped tabs from groups in the current window.
- Pinned tabs are never ungrouped.
- Popup/keyboard organize and ungroup actions are current-window only.
- Shortcut chips must not overlap labels.
- Popup natural content height must remain <= 600px.
- TDD: regression tests fail before production changes.

---

### Task 1: Background grouping mode

**Files:**
- Modify: `background.js`
- Test: `tests/reliability.test.js`
- Modify test helper only if needed: `tests/helpers/chrome-stub.js`

**Interfaces:**
- `prepareTabsForGrouping(tabs, { regroupAll = false })` -> `{ tabs, regroupedTabs, preservedGroupedTabs }`
- `arrangeByWebsiteResult({ currentWindow, regroupAll })`
- `arrangeByDateResult({ currentWindow, regroupAll })`
- `ungroupAllResult()` -> structured result for all non-pinned grouped tabs in current window.

- [ ] Write failing reliability tests proving Off preserves both manual and extension-owned existing groups.
- [ ] Write failing reliability tests proving On ungroups all non-pinned grouped tabs and regroups them by Date/Website.
- [ ] Write failing reliability tests proving pinned grouped tabs stay grouped.
- [ ] Write failing reliability test proving Ungroup all removes manual and extension-owned non-pinned groups.
- [ ] Run `node test.js reliability` and confirm RED.
- [ ] Implement minimal background behavior and action/result codes.
- [ ] Run `node test.js reliability` and confirm GREEN.
- [ ] Commit backend behavior.

### Task 2: Popup toggle and clear copy

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `popup.css`
- Test: `tests/popup-result.test.js`
- Test: `tests/dom.test.js`

**Interfaces:**
- Storage key: `regroupAll: boolean` in `chrome.storage.sync`.
- Popup Date/Website messages: `{ action, regroupAll }`.
- `Ungroup all` sends `{ action: 'UNGROUP_ALL' }`.

- [ ] Add failing popup tests for default Off, persisted On, correct Date/Website payload, Ungroup all action, and updated result copy.
- [ ] Add DOM assertions for toggle accessibility (`role="switch"`, `aria-checked`) and shortcut layout wrapper classes.
- [ ] Run popup/DOM tests and confirm RED.
- [ ] Add compact Regroup all switch row and rename Ungroup control.
- [ ] Persist the switch with `chrome.storage.sync` and include it in organize messages.
- [ ] Update result messages for preserved groups, regroup-all, and ungroup-all.
- [ ] Change shortcut layout to reserved grid/flex areas; remove absolute positioning that overlaps labels.
- [ ] Run popup/DOM tests and confirm GREEN.
- [ ] Commit popup behavior/UI.

### Task 3: Keyboard preference behavior

**Files:**
- Modify: `background.js`
- Test: `tests/background.test.js` or `tests/reliability.test.js`

**Interfaces:**
- Keyboard Date/Website actions read `chrome.storage.sync.get('regroupAll')` and pass the stored boolean to `executeAction`.

- [ ] Write failing test that a saved `regroupAll: true` preference is honored by keyboard organize commands.
- [ ] Run targeted test and confirm RED.
- [ ] Implement minimal keyboard preference read.
- [ ] Run targeted and full Node suites and confirm GREEN.
- [ ] Commit keyboard behavior.

### Task 4: Real Chromium regression and docs

**Files:**
- Modify: `tests/e2e/regroup.e2e.js`
- Modify: `README.md`
- Add/update ADR if needed under `docs/adr/`.

**Interfaces:**
- E2E uses actual Chrome `groupId` values and actual popup element rectangles.

- [ ] Extend Chromium E2E: create manual grouped tabs plus a pinned grouped tab.
- [ ] Verify Regroup all Off leaves existing groups unchanged and groups only ungrouped tabs.
- [ ] Toggle On and verify Date/Website rebuilds all non-pinned grouped tabs while pinned grouped tab remains grouped.
- [ ] Verify Ungroup all removes every non-pinned group and leaves pinned group intact.
- [ ] Assert each visible `.shortcut` rectangle does not intersect its action label rectangle.
- [ ] Assert popup natural height <= 600px.
- [ ] Update README/ADR copy to describe explicit Off/On semantics.
- [ ] Run full CI: `npm ci`, `npm test`, production `node --check`, Playwright Chromium E2E.
- [ ] Review PR diff for unrelated changes and destructive behavior outside explicit On/Ungroup all modes.
- [ ] Open PR ready for review with test evidence.
