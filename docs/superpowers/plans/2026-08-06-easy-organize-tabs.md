# Easy Organize My Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a dependency-free Manifest V3 browser extension for organizing, cleaning, saving, and restoring tabs.

**Architecture:** Keep deterministic domain logic in a testable pure module, isolate Chrome APIs behind adapters, and use separate popup/options controllers. Persist settings and sessions with `chrome.storage.local` and request no host permissions.

**Tech Stack:** HTML, CSS, modern JavaScript ES modules, Chrome Extension Manifest V3, Node.js built-in test runner.

## Global Constraints

- No runtime dependencies.
- No network requests, analytics, remote code, or host permissions.
- Support Chromium browsers implementing Manifest V3.
- Use `tabs` and `storage` permissions only.
- All destructive multi-tab closes honor the confirmation preference.

---

### Task 1: Core tab and session logic

**Files:**
- Create: `src/lib/core.js`
- Test: `tests/core.test.js`

**Interfaces:**
- Produces: `normalizeUrl`, `getDomain`, `filterTabs`, `sortTabs`, `groupTabs`, `findDuplicateGroups`, `duplicateTabIdsToClose`, `createSession`, `validateSessionImport`.

- [x] Write failing tests for URL normalization, filtering, sorting, grouping, duplicates, sessions, and imports.
- [x] Run `npm test` and confirm failure because `src/lib/core.js` is absent.
- [x] Implement the smallest pure functions that satisfy the tests.
- [x] Run `npm test` and confirm all core tests pass.
- [x] Commit the tested core logic.

### Task 2: Extension platform and persistence adapters

**Files:**
- Create: `manifest.json`
- Create: `src/lib/chrome-api.js`
- Create: `src/lib/settings.js`
- Create: `src/background.js`
- Create: `tests/validate-extension.mjs`

**Interfaces:**
- Produces: Promise-based tab/window/storage operations; `DEFAULT_SETTINGS`, `loadSettings`, `saveSettings`, `loadSessions`, `saveSessions`.

- [x] Write static validation that requires Manifest V3, action popup, background service worker, and only approved permissions.
- [x] Run validation and confirm it fails while the manifest is absent.
- [x] Add the manifest, adapters, defaults, and badge service worker.
- [x] Run all tests and static validation.
- [x] Commit the extension platform layer.

### Task 3: Popup tab dashboard

**Files:**
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.css`
- Create: `src/popup/popup.js`

**Interfaces:**
- Consumes: core functions, Chrome API adapter, settings storage.
- Produces: searchable grouped list, selection state, bulk actions, duplicate cleanup, and session-save actions.

- [x] Add semantic popup markup and status regions.
- [x] Add responsive accessible styling with system/light/dark themes.
- [x] Implement rendering, selection, per-tab actions, bulk actions, duplicate cleanup, and session saves.
- [x] Run tests and syntax checks.
- [x] Commit the popup dashboard.

### Task 4: Options and session manager

**Files:**
- Create: `src/options/options.html`
- Create: `src/options/options.css`
- Create: `src/options/options.js`

**Interfaces:**
- Consumes: import validator, Chrome API adapter, settings/session storage.
- Produces: saved preferences, session restore/delete/rename, JSON export/import.

- [x] Add accessible options markup and saved-session list.
- [x] Implement preference persistence and theme preview.
- [x] Implement session restore, rename, delete, export, and validated import.
- [x] Run tests and syntax checks.
- [x] Commit the options page.

### Task 5: Documentation, icons, and packaging

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `.github/workflows/ci.yml`
- Create: `src/icons/icon16.png`
- Create: `src/icons/icon32.png`
- Create: `src/icons/icon48.png`
- Create: `src/icons/icon128.png`
- Create: `MANUAL_TEST_CHECKLIST.md`

**Interfaces:**
- Produces: install instructions, contribution guidance, CI verification, and distributable extension assets.

- [x] Generate local icons and add manifest references.
- [x] Document installation, features, permissions, architecture, development, and release packaging.
- [x] Add CI running tests and extension validation.
- [x] Execute full test, validation, and syntax-check commands.
- [x] Create a ZIP excluding `.git`, tests, plans, and development-only files.
