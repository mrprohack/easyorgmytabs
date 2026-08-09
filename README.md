# Tab Organizer Pro

A premium Chrome extension (Manifest V3) that organizes messy browser tabs into clean, color-coded Chrome Tab Groups - plus power-user tools to deduplicate tabs, free memory, and store tab sessions for later.

## Features

### Organize
- **Arrange by Website** - groups every tab in your windows by base domain (e.g. youtube.com) into collapsed, color-coded tab groups. Works across all windows, per window.
- **Arrange by Date** - groups tabs by last access: Today, This Week, Last Week, This Month, Older (plus Unknown for missing data).

### Power tools
- **Close Duplicates** - closes duplicate tabs in the current window after stripping URL fragments and tracking parameters (utm_*, fbclid, gclid, msclkid, mc_eid). Keeps the pinned copy, then the active one, then the first; pinned tabs are never closed.
- **Sleep Inactive Tabs** - discards idle tabs in the current window to free memory. Threshold is configurable (0.25-168 hours, default 1). Never sleeps pinned, audible, or active tabs.
- **Save Session** - saves every non-pinned, restorable tab in the current window as a session, opens the dashboard, then closes the tabs.
- **Session Dashboard** - a full-page dashboard to search, restore, add links to, or delete saved sessions. Restore reopens all tabs in a fresh window.

### Keyboard shortcuts
| Shortcut | Action |
| --- | --- |
| Alt+Shift+D | Arrange by Date |
| Alt+Shift+W | Arrange by Website |
| Alt+Shift+X | Close Duplicates |

## Installation

The extension installs via Developer Mode in Chrome:

1. Clone or download this repository and extract it.
2. Open Chrome and go to chrome://extensions/.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Pin **Tab Organizer Pro** from the puzzle-piece menu.

## Usage

- Click the extension icon to open the popup, then pick an action; the status line reports what happened.
- Set the sleep threshold with the **idle over ... hours** field in the popup.
- Saved sessions appear in the dashboard (session.html). Use the search box to filter tabs, the trash button to delete a session (two-step confirm), and the form to paste in a link manually.

## Architecture

- **background.js** - the MV3 service worker. Every action is an async function in the HANDLERS map and returns a count. Tab grouping, discarding, deduplication, and session storage all live here.
- **logic.js** - pure, dependency-free helpers shared by the service worker (importScripts), the popup/dashboard (script tag), and the tests (require): URL filtering, dedupe keys, date buckets, session filtering, sleep-hour clamping, and the runBatched() concurrency limiter used for tab/group API calls.
- **popup.html / popup.js** - the popup UI: action buttons, status line, sleep threshold.
- **session.html / session.js** - the saved-sessions dashboard. It never writes storage directly; mutations go through background messages (SESSION_DELETE / SESSION_ADD_TAB / SESSION_REMOVE_TAB), and chrome.storage.onChanged keeps every open dashboard in sync.
- **Storage** - sessions live in chrome.storage.local (capped at 50 sessions, 200 tabs per session, newest first). All writes are serialized through one write queue in the service worker, with a quota-error retry that trims history. The sleep threshold lives in chrome.storage.sync.
- **Security** - saved titles/URLs are attacker-controlled page data: they are rendered as textContent only, and hrefs are assigned only for http(s) URLs. No alerts or confirms anywhere; the dashboard uses inline two-step confirm.

## Development

### Setup

```bash
npm install
```

### Test

```bash
node test.js        # or: npm test
```

Runs every suite in tests/; add a filter to run one:

```bash
node test.js logic        # pure helpers
node test.js background   # service worker handlers (chrome.* mocked)
node test.js dom          # popup + dashboard via jsdom
node test.js load         # 300-tab acceptance scenarios
```

Syntax-check the production scripts:

```bash
node --check background.js && node --check logic.js && node --check session.js && node --check popup.js
```

## Built With

- HTML/CSS/JavaScript
- Chrome Extensions API (Manifest V3)
- Node.js + jsdom for the test suite (dev dependency only)

## License

MIT License