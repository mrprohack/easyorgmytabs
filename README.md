# Tab Organizer Pro

A premium Chrome extension (Manifest V3) that organizes messy browser tabs into clean, color-coded Chrome Tab Groups - plus power-user tools to deduplicate tabs, free memory, and store tab sessions for later.

## Features

### Organize
- **Arrange by Website** - groups eligible tabs in the current window by base domain (e.g. youtube.com) into collapsed, color-coded tab groups.
- **Arrange by Date** - groups eligible tabs in the current window by last access: Today, This Week, Last Week, This Month, Older (plus Unknown for missing data).
- **Safe by default** - pinned tabs, non-restorable URLs, and tabs already inside a Chrome Tab Group are left untouched. Existing groups are preserved instead of being silently destroyed.

### Power tools
- **Close Duplicates** - closes duplicate tabs in the current window after stripping URL fragments and tracking parameters (utm_*, fbclid, gclid, msclkid, mc_eid). Keeps the pinned copy, then the active one, then the first; pinned tabs are never closed.
- **Undo Close** - restores the most recently closed tab or window (chrome.sessions).
- **Sleep Inactive Tabs** - discards idle tabs in the current window to free memory. Threshold is configurable (0.25-168 hours, default 1). Never sleeps pinned, audible, or active tabs.
- **Save Session** - saves non-pinned, restorable tabs in the current window and opens the dashboard; your tabs stay open. A session stores at most 200 tabs and the popup reports any tabs skipped by that limit.
- **Session Dashboard** - a full-page dashboard to search, restore, add links to, or delete saved sessions. Restore reopens all tabs in a fresh window, or **Restore here** reopens them in the current window. The popup's **View Saved Sessions** button opens the dashboard anytime.

### Keyboard shortcuts
| Shortcut | Action |
| --- | --- |
| Alt+Shift+D | Arrange by Date |
| Alt+Shift+W | Arrange by Website |
| Alt+Shift+X | Close Duplicates |
| Alt+Shift+S | View Saved Sessions |

## Installation

The extension installs via Developer Mode in Chrome:

1. Clone or download this repository and extract it.
2. Open Chrome and go to chrome://extensions/.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Pin **Tab Organizer Pro** from the puzzle-piece menu.

## Usage

- Click the extension icon to open the popup, then pick an action; the status line reports what changed and, when relevant, what was skipped or preserved.
- On open, the popup previews how many duplicate and idle tabs are ready.
- Set the sleep threshold with the **idle over ... hours** field in the popup.
- Saved sessions appear in the dashboard (session.html). Use the search box to filter tabs, the trash button to delete a session (two-step confirm), and the form to paste in a link manually.

## Architecture

- **background.js** - the MV3 service worker. Core handlers retain their numeric return API for focused tests, while popup/keyboard entry points run through `executeAction()` with safe defaults and structured results (`status`, `changed`, `skipped`, optional `code`). Tab grouping, discarding, deduplication, and session storage live here.
- **logic.js** - pure, dependency-free helpers shared by the service worker (`importScripts`), the popup/dashboard (`script` tag), and the tests (`require`): URL filtering, dedupe keys, date buckets, session filtering, sleep-hour clamping, and the `runBatched()` concurrency limiter used for tab/group API calls.
- **popup.html / popup.js** - the popup UI: action buttons, status line, structured result feedback, and sleep threshold.
- **session.html / session.js** - the saved-sessions dashboard. It never writes storage directly; mutations go through background messages (`SESSION_DELETE`, `SESSION_ADD_TAB`, `SESSION_REMOVE_TAB`), and `chrome.storage.onChanged` keeps every open dashboard in sync.
- **Storage** - sessions live in `chrome.storage.local` (capped at 50 sessions, 200 tabs per session, newest first). All writes are serialized through one write queue in the service worker, with a quota-error retry that trims history. The sleep threshold lives in `chrome.storage.sync`.
- **Security** - saved titles/URLs are attacker-controlled page data: they are rendered as `textContent` only, and hrefs are assigned only for http(s) URLs. No alerts or confirms anywhere; the dashboard uses inline two-step confirm.
- **Decision records** - architecture decisions live under `docs/adr/`.

## Development

### Setup

```bash
npm install
```

### Test

```bash
node test.js        # or: npm test
```

Runs every suite in `tests/`; add a filter to run one:

```bash
node test.js logic        # pure helpers
node test.js background   # service worker handlers (chrome.* mocked)
node test.js reliability  # safe organization + session limit regressions
node test.js popup-result # structured popup feedback
node test.js dom          # popup + dashboard via jsdom
node test.js load         # 300-tab acceptance scenarios
```

Syntax-check the production scripts:

```bash
node --check background.js && node --check logic.js && node --check session.js && node --check popup.js
```

GitHub Actions runs the full test suite and syntax checks on pull requests and pushes to `master`.

## Built With

- HTML/CSS/JavaScript
- Chrome Extensions API (Manifest V3)
- Node.js + jsdom for the test suite (dev dependency only)

## License

MIT License
