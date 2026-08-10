# Tab Organizer Pro

A Chrome extension (Manifest V3) that organizes messy browser tabs into clean, color-coded Chrome Tab Groups, deduplicates tabs, frees memory, and saves tab sessions for later.

## Features

### Organize
- **By Website** - groups eligible tabs in the current window by base domain (for example `youtube.com`).
- **By Date** - groups eligible tabs in the current window by last access: Today, This Week, Last Week, This Month, Older, and Unknown.
- **Regroup all: Off (default)** - Date/Website touches only currently ungrouped tabs. Every existing Chrome Tab Group is left unchanged, whether it was created manually or by Tab Organizer.
- **Regroup all: On** - Date/Website first ungroups every non-pinned grouped tab in the current window, then rebuilds all eligible tabs using the selected mode.
- **Ungroup all** - removes every non-pinned grouped tab from its group in the current window, regardless of who created the group.
- **Pinned tabs stay safe** - pinned tabs are never grouped, regrouped, or ungrouped automatically.
- **Current-window scope** - popup and keyboard organization actions affect only the browser window you are actively using.

### Power tools
- **Close Duplicates** - closes duplicate tabs in the current window after stripping URL fragments and tracking parameters (`utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_eid`). Keeps the pinned copy, then the active one, then the first; pinned tabs are never closed.
- **Undo Close** - restores the most recently closed tab or window (`chrome.sessions`).
- **Sleep Inactive Tabs** - discards idle tabs in the current window to free memory. Threshold is configurable (0.25-168 hours, default 1). Never sleeps pinned, audible, or active tabs.
- **Save Session** - saves non-pinned, restorable tabs in the current window and opens the dashboard; your tabs stay open. A session stores at most 200 tabs and the popup reports any tabs skipped by that limit.
- **Session Dashboard** - search, restore, add links to, or delete saved sessions. Restore can open a fresh window or restore into the current window.

### Keyboard shortcuts
| Shortcut | Action |
| --- | --- |
| Alt+Shift+D | Group by Date using the saved Regroup all preference |
| Alt+Shift+W | Group by Website using the saved Regroup all preference |
| Alt+Shift+X | Close Duplicates |
| Alt+Shift+S | View Saved Sessions |

## Installation

1. Clone or download this repository and extract it.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder.
5. Pin **Tab Organizer Pro** from the extensions menu.

## Usage

- Open the popup and choose **By Date** or **By Website**.
- Leave **Regroup all** Off when you want existing groups preserved and only loose tabs organized.
- Turn **Regroup all** On when you want the selected Date/Website mode to replace all non-pinned grouping in the current window.
- Use **Ungroup all** to dissolve all non-pinned groups in the current window without relying on extension ownership history.
- The popup shows the saved On/Off state and reports what was grouped, regrouped, preserved, or ungrouped.
- Set the sleep threshold with **Sleep tabs idle over ... hours**.
- Saved sessions are managed from `session.html`.

## Architecture

- **background.js** - MV3 service worker. Popup/keyboard requests go through `executeAction()` and return structured results (`status`, `changed`, `skipped`, optional `code`). Grouping, ungrouping, dedupe, sleeping, and session storage live here.
- **Explicit regroup policy** - `regroupAll` is stored in `chrome.storage.sync` and defaults to `false`. Off preserves all existing groups; On explicitly allows rebuilding all non-pinned groups in the current window. Keyboard Date/Website commands read the same saved preference.
- **Owned-group registry** - group IDs created by Tab Organizer are still stored temporarily in `chrome.storage.session` so the popup can derive active-mode state. Mutation safety no longer depends on that registry: explicit Regroup all/Ungroup all behavior is authoritative.
- **logic.js** - pure helpers for URL filtering, dedupe keys, date buckets, session filtering, sleep-hour clamping, and bounded concurrency.
- **popup.html / popup.js / popup.css** - compact popup UI with the Regroup all switch, Date/Website controls, Ungroup all, active-mode state, tools, sessions, and non-overlapping shortcut chips.
- **session.html / session.js** - saved-sessions dashboard. Mutations go through background messages; `chrome.storage.onChanged` keeps open dashboards synchronized.
- **Storage** - sessions use `chrome.storage.local`; `sleepHours` and `regroupAll` use `chrome.storage.sync`; temporary group-mode ownership metadata uses `chrome.storage.session`.
- **Security** - saved titles/URLs are rendered with `textContent`, and saved hrefs are assigned only for http(s) URLs.
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

Runs every Node/jsdom suite in `tests/` except `tests/e2e/`:

```bash
node test.js logic        # pure helpers
node test.js background   # service-worker handlers with chrome.* mocked
node test.js reliability  # Regroup all Off/On, Ungroup all, session regressions
node test.js popup-result # toggle persistence, action payloads, result feedback
node test.js dom          # popup + dashboard via jsdom
node test.js load         # 300-tab acceptance scenarios
```

Syntax-check production scripts:

```bash
node --check background.js && node --check logic.js && node --check session.js && node --check popup.js
```

### Real Chromium acceptance test

CI loads the unpacked extension into Playwright Chromium and verifies:
- Regroup all Off preserves existing manual/extension groups and organizes only ungrouped tabs.
- Regroup all On rebuilds all non-pinned groups by the selected mode.
- Ungroup all removes extension-created and unknown/manual groups.
- pinned tabs remain excluded.
- shortcut chips do not overlap their action labels using real DOM bounding boxes.
- popup natural height remains at or below 600px.

```bash
npm install --no-save --package-lock=false playwright@1.62.0
npx playwright install --with-deps chromium
node tests/e2e/regroup.e2e.js
```

GitHub Actions runs the Node/jsdom/load suite, syntax checks, and real Chromium acceptance test on pull requests and pushes to `master`.

## Built With

- HTML/CSS/JavaScript
- Chrome Extensions API (Manifest V3)
- Node.js + jsdom
- Playwright Chromium for end-to-end extension verification

## License

MIT License
