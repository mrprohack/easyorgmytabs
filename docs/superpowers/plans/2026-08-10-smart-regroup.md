# Smart Regroup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Date and Website grouping switchable in one click while preserving manual Chrome tab groups.

**Architecture:** Track only extension-created Chrome group IDs in `chrome.storage.session`. Organization actions clear owned groups in the current window before building the requested grouping mode; unknown groups remain untouched. The popup reads a grouping-state action and renders a dedicated organize section with Date, Website, and Ungroup controls.

**Tech Stack:** Manifest V3, Chrome tabs/tabGroups/storage APIs, plain JavaScript, jsdom, Node test runner.

## Global Constraints
- Current-window behavior for production organization actions.
- Manual groups must never be ungrouped without explicit ownership evidence.
- Ownership is group-ID based, never title/color based.
- TDD: regression tests fail before production changes.
- Keep `npm test` and syntax checks green.

---

### Task 1: Chrome test stub supports group ownership
**Files:** Modify `tests/helpers/chrome-stub.js`; Test `tests/reliability.test.js`.

- [ ] Add separate `storage.session` state to the stub.
- [ ] Make `tabs.group()` update matching tabs' `groupId` and return stable group IDs.
- [ ] Make `tabs.ungroup()` log IDs and reset only those tabs to `groupId: -1`.
- [ ] Add failing Date -> Website regroup and manual-group-preservation tests.
- [ ] Run `node test.js reliability` and verify RED.

### Task 2: Owned-group registry and smart regroup
**Files:** Modify `background.js`; Test `tests/reliability.test.js`.

Interfaces:
- `readOwnedGroups()` -> object keyed by group ID.
- `writeOwnedGroups(registry)` -> Promise<void>.
- `prepareTabsForGrouping(tabs)` -> `{ tabs, regroupedTabs, manualGroupedTabs }` after ungrouping owned groups only.
- `rememberCreatedGroups(createdGroups, mode)` records `{ windowId, mode }`.
- `ungroupOrganizedResult()` -> structured action result.
- `groupingState()` -> `{ mode, groupCount, tabCount }`.

- [ ] Implement registry in `chrome.storage.session`.
- [ ] Make create-group path return created group IDs internally while preserving legacy numeric `createGroups()` behavior.
- [ ] Before Date/Website organization, ungroup owned groups in scope and make those tabs eligible again.
- [ ] Preserve unknown/manual groups.
- [ ] Add `UNGROUP_ORGANIZED` and `GROUPING_STATE` message actions.
- [ ] Return `mode`, `regroupedTabs`, and `manualGroupedTabs` metadata where relevant.
- [ ] Run `node test.js reliability` and verify GREEN.

### Task 3: Popup regroup UX
**Files:** Modify `popup.html`, `popup.js`, `styles.css`; Test `tests/popup-result.test.js`, `tests/dom.test.js`.

- [ ] Add failing tests for the ungroup control, active mode state, and regroup result copy.
- [ ] Run popup/DOM tests and verify RED.
- [ ] Add an `Organize` section with Date and Website primary controls, helper copy, active-mode pill, and secondary Ungroup action.
- [ ] Separate `Power tools` visually below organization.
- [ ] Query `GROUPING_STATE` on popup load and after organization/ungroup actions.
- [ ] Highlight the active Date/Website button using `aria-pressed` and `.active-mode`.
- [ ] Render regroup and manual-preservation result copy.
- [ ] Run popup/DOM tests and verify GREEN.

### Task 4: Documentation and full verification
**Files:** Modify `README.md`, `docs/adr/0001-preserve-user-tab-groups.md` or add follow-up ADR if clearer.

- [ ] Document smart regroup and safe Ungroup behavior.
- [ ] Run full GitHub Actions CI: `npm ci`, `npm test`, and all production `node --check` commands.
- [ ] Review the PR diff for accidental manual-group destruction or unrelated changes.
- [ ] Update PR description with TDD evidence and final verification.