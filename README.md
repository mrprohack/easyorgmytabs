# Tab Organizer Pro

A premium Chrome extension (Manifest V3) that organizes messy browser tabs into clean, color-coded Chrome Tab Groups - plus power-user tools to deduplicate tabs, free memory, and store tab sessions for later.

## Features

### Organize
- **By Website** - groups eligible tabs in the current window by base domain (for example `youtube.com`) into collapsed, color-coded tab groups.
- **By Date** - groups eligible tabs in the current window by last access: Today, This Week, Last Week, This Month, Older (plus Unknown for missing data).
- **Smart Regroup** - switch from Date to Website, or Website to Date, in one click. Tab Organizer removes only the groups it previously created, then rebuilds those tabs using the newly selected mode.
- **Ungroup organized** - removes only groups owned by Tab Organizer in the current window.
- **Manual groups stay safe** - manually-created or otherwise unknown Chrome Tab Groups are never inferred from their title or color and are left untouched. If ownership tracking is unavailable or was cleared, the extension chooses preservation over destructive regrouping.
- **Current-window scope** - popup and keyboard organization actions affect only the browser window you are actively using.

### Power tools
- **Close Duplicates** - closes duplicate tabs in the current window after stripping URL fragments and tracking parameters (`utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_eid`). Keeps the pinned copy, then the active one, then the first; pinned tabs are never closed.
- **Undo Close** - restores the most recently closed tab or window (`chrome.sessions`).
- **Sleep Inactive Tabs** - discards idle tabs in the current window to free memory. Threshold is configurable (0.25-168 hours, default 1). Never sleeps pinned, audible, or active tabs.
- **Save Session** - saves non-pinned, restorable tabs in the current window and opens the dashboard; your tabs stay open. A session stores at most 200 tabs and the popup reports any tabs skipped by that limit.
- **Session Dashboard** - a full-page dashboard to search, restore, add links to, or delete saved sessions. Restore reopens all tabs in a fresh window, or **Restore here** reopens them in the current window. The popup's **View Saved Sessions** button opens the dashboard anytime.

### Keyboard shortcuts
| Shortcut | Action |
| --- | --- |
| Alt+Shift+D | Group by Date / regroup owned tabs by Date |
| Alt+Shift+W | Group by Website / regroup owned tabs by Website |
| Alt+Shift+X | Close Duplicates |
| Alt+Shift+S | View Saved Sessions |

## Installation

The extension installs via Developer Mode in Chrome:

1. Clone or download this repository and extract it.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Pin **Tab Organizer Pro** from the puzzle-piece menu.

## Usage

- Open the extension popup and choose **By Date** or **By Website** in the **Organize** card.
- The active mode is shown directly in the popup. Selecting the other mode automatically regroups only Tab Organizer-owned groups.
- Use **Ungroup organized** when you want Tab Organizer's current groups removed without disturbing manual Chrome groups.
- The status line reports what was grouped/regrouped, how many tabs were ungrouped, and whether manual groups were preserved.
- On open, the popup also previews how many duplicate and idle tabs are ready.
- Set the sleep threshold with the **Sleep tabs idle over ... hours** field.
- Saved sessions appear in the dashboard (`session.html`). Use the search box to filter tabs, the trash button to delete a session (two-step confirm), and the form to paste in a link manually.

## Architecture

- **background.js** - the MV3 service worker. Core handlers retain their numeric return API for focused tests, while popup/keyboard entry points run through `executeAction()` with safe defaults and structured results (`status`, `changed`, `skipped`, optional `code`). Smart regrouping, tab grouping, discarding, deduplication, and session storage live here.
- **Owned-group registry** - group IDs created by Tab Organizer are stored in `chrome.storage.session` with the owning window and grouping mode (`date` or `website`). A switch in grouping mode ungroups only live groups found in that registry. Unknown groups are treated as user-owned and preserved.
- **logic.js** - pure, dependency-free helpers shared by the service worker (`importScripts`), the popup/dashboard (`script` tag), and the tests (`require`): URL filtering, dedupe keys, date buckets, session filtering, sleep-hour clamping, and the `runBatched()` concurrency limiter used for tab/group API calls.
- **popup.html / popup.js / popup.css** - popup UI with a dedicated Organize card, active-mode state, smart regroup/ungroup feedback, power tools, sessions, and sleep threshold.
- **session.html / session.js** - the saved-sessions dashboard. It never writes storage directly; mutations go through background messages (`SESSION_DELETE`, `SESSION_ADD_TAB`, `SESSION_REMOVE_TAB`), and `chrome.storage.onChanged` keeps every open dashboard in sync.
- **Storage** - sessions live in `chrome.storage.local` (capped at 50 sessions, 200 tabs per session, newest first). All writes are serialized through one write queue in the service worker, with a quota-error retry that trims history. The sleep threshold lives in `chrome.storage.sync`; temporary group ownership lives in `chrome.storage.session`.
- **Security** - saved titles/URLs are attacker-controlled page data: they are rendered as `textContent` only, and hrefs are assigned only for http(s) URLs. No alerts or confirms anywhere; the dashboard uses inline two-step confirm.
- **Decision records** - architecture decisions live under `docs/adr/`.

## Development

### Setup

```bash
npm install
```

### Node / DOM test suite

```bash
node test.js        # or: npm test
```

Runs every Node/jsdom suite in `tests/` except `tests/e2e/`; add a filter to run one:

```bash
node test.js logic        # pure helpers
node test.js background   # service worker handlers (chrome.* mocked)
node test.js reliability  # smart regroup, manual-group safety + session limits
node test.js popup-result # structured popup feedback and active-mode UX
node test.js dom          # popup + dashboard via jsdom
node test.js load         # 300-tab acceptance scenarios
```

Syntax-check the production scripts:

```bash
node --check background.js && node --check logic.js && node --check session.js && node --check popup.js
```

### Real Chromium smart-regroup test

The CI workflow also loads the unpacked extension into Playwright Chromium and runs the exact Date -> Website -> Ungroup flow while asserting that a separately-created manual Chrome group is preserved.

```bash
npm install --no-save --package-lock=false playwright@1.62.0
npx playwright install --with-deps chromium
node tests/e2e/regroup.e2e.js
```

GitHub Actions runs the Node/jsdom/load suite, syntax checks, and the real Chromium smart-regroup test on pull requests and pushes to `master`.

## Built With

- HTML/CSS/JavaScript
- Chrome Extensions API (Manifest V3)
- Node.js + jsdom for the standard test suite
- Playwright Chromium for CI end-to-end extension verification

## License

MIT License
