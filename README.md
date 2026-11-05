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
- **Undo Close** - restores the most recently closed tab or window from any window (`chrome.sessions`).
- **Sleep Inactive Tabs** - discards idle tabs in the current window to free memory. Threshold is configurable (0.25-168 hours, default 1). Never sleeps pinned, audible, or active tabs.
- **Save Session** - saves non-pinned, restorable tabs in the current window and opens the dashboard; your tabs stay open. A session stores at most 200 tabs and the popup reports any tabs skipped by that limit.
- **Session Dashboard** - a responsive saved-workspace dashboard with live session/tab totals, sticky search and clear controls (press `/` to jump to search, `Esc` to clear it), dense title + hostname rows, and explicit restore choices. Sessions are unnamed, so each card shows its age ("3 days ago"), a one-line summary of the sites it holds, and a **Latest** chip on the newest session. **Restore in new window** is the primary action, **Restore here** opens linkable tabs in the current window, Delete keeps a two-step confirmation, and every action is confirmed in the status line.

### Keyboard shortcuts
| Shortcut | Action |
| --- | --- |
| Alt+Shift+D | Group by Date using the saved Regroup all preference |
| Alt+Shift+G | Group by Website using the saved Regroup all preference |
| Alt+Shift+K | Close Duplicates |
| Alt+Shift+S | View Saved Sessions |

The popup reads Chrome's active command bindings instead of assuming the manifest suggestion was accepted. If Chrome leaves a command unassigned or you remap it, the chip shows the real value and an amber banner appears. Use **Shortcuts** in the popup header to display the exact `chrome://extensions/shortcuts` address when a binding needs repair.

## Installation

1. Clone or download this repository and extract it.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder.
5. Pin **Tab Organizer Pro** from the extensions menu.

## Usage

- Open the popup. It reads top to bottom as three numbered steps: **1 Organize**, **2 Clean up**, **3 Save**. Each section says whether it acts on **This window**; **Undo Close** is marked **Any window** because it reopens the last closed tab or window wherever it was.
- In **Organize**, choose **By Date** or **By Website**. The active mode shows a check mark and a **Date active** / **Website active** pill.
- Leave **Regroup all** Off when you want existing groups preserved and only loose tabs organized.
- Turn **Regroup all** On when you want the selected Date/Website mode to replace all non-pinned grouping in the current window.
- Use **Ungroup all** to dissolve all non-pinned groups in the current window without relying on extension ownership history.
- The popup shows the saved On/Off state. Results appear in the status bar at the bottom (green when something changed, red for errors) and report what was grouped, regrouped, preserved, or ungrouped.
- **Close Duplicates** and **Sleep Idle Tabs** show a badge with how many tabs they would affect, so you can see the effect before you click. The badges refresh after each action and when you change the threshold.
- The popup also shows Chrome's active keyboard shortcuts; an unassigned command is labeled **Not assigned** instead of showing a shortcut that does not work. Use **Shortcuts** in the header to see the Chrome shortcut-manager address without opening a blank privileged tab.
- Set the sleep threshold in the **Sleep Idle Tabs** row (**after N h**).
- Open **Saved Sessions** to see live session/tab totals. Search filters both tab titles and URLs; use **Clear** (or `Esc`) to return to all sessions, and `/` to jump back to the search box.
- Saved-session cards use two columns on wider screens and one column on narrower screens, with rows aligned across columns. Each card shows its tab count and age, the sites it holds, and the newest session carries a **Latest** chip. Each tab shows its title and hostname, with a compact remove control.
- Use **Restore in new window** for a separate workspace, **Restore here** for the current window, or the two-step **Delete** action to remove a saved session.

## Architecture

- **background.js** - MV3 service worker. Popup/keyboard requests go through `executeAction()` and return structured results (`status`, `changed`, `skipped`, optional `code`). Grouping, ungrouping, dedupe, sleeping, and session storage live here.
- **Explicit regroup policy** - `regroupAll` is stored in `chrome.storage.sync` and defaults to `false`. Off preserves all existing groups; On explicitly allows rebuilding all non-pinned groups in the current window. Keyboard Date/Website commands read the same saved preference.
- **Owned-group registry** - group IDs created by Tab Organizer are still stored temporarily in `chrome.storage.session` so the popup can derive active-mode state. Mutation safety no longer depends on that registry: explicit Regroup all/Ungroup all behavior is authoritative.
- **logic.js** - pure helpers for URL filtering, dedupe keys, date buckets, session filtering, sleep-hour clamping, bounded concurrency, and the dashboard's `relativeTime` and `hostSummary`.
- **popup.html / popup.js / popup.css** - compact popup UI in three numbered sections (Organize, Clean up, Save) with scope chips, the Regroup all switch, active-mode state, preview badges fed by the existing `PREVIEW` action, a tinted status bar (neutral, success, error), live `chrome.commands.getAll()` shortcut chips, and reliable shortcut-repair guidance. Natural height stays at or below 560px (Chrome caps popups at 600px).
- **session.html / session.js** - responsive saved-sessions dashboard with semantic session cards (age, host summary, Latest chip), live totals/search context, dense tab rows, accessible action hierarchy, status-line feedback, `/` and `Esc` shortcuts, and background-message mutations. `chrome.storage.onChanged` keeps open dashboards synchronized.
- **styles.css** - the design tokens (`:root`: type scale, text/accent/semantic colours, spacing, radii, targets, focus ring), shared components (`.btn`, `.input`, the `.shortcut` chip, the `.status` tones, one focus ring) and the dashboard layout. `popup.css` only arranges the popup. The dashboard is two-column on desktop, one-column on narrow screens, and constrains long tab text and long hostnames to avoid horizontal overflow.
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
node test.js shortcuts    # active/remapped/unassigned Chrome command bindings
node test.js popup-ux     # three-step popup structure, preview badges, status tones
node test.js dashboard-ux # card identity, Latest chip, status feedback, / and Esc
node test.js dom          # popup + dashboard semantics/interactions via jsdom
node test.js style        # design tokens, 4.5:1 contrast pairs, CSS lint (11px floor, no !important)
node test.js load         # 300-tab acceptance scenarios
```

Syntax-check production scripts:

```bash
node --check background.js && node --check logic.js && node --check session.js && node --check popup.js
```

### Real Chromium acceptance tests

CI loads the unpacked extension into Playwright Chromium and runs two real-browser acceptance flows.

The popup/regroup test verifies:
- a fresh profile registers the verified Date/Website/Duplicates/Saved Sessions shortcut defaults and the popup displays Chrome's active bindings.
- Regroup all Off preserves existing manual/extension groups and organizes only ungrouped tabs.
- Regroup all On rebuilds all non-pinned groups by the selected mode.
- Ungroup all removes extension-created and unknown/manual groups.
- pinned tabs remain excluded.
- shortcut chips do not overlap their action labels using real DOM bounding boxes.
- shortcut-repair guidance keeps the popup usable instead of opening a blank privileged tab.
- popup natural height remains at or below 560px, and at or below Chrome's 600px popup cap in the worst case (shortcut warning banner plus a three-line result).
- the preview badges fill in with numbers, and no visible popup text renders below 11px.

The saved-sessions dashboard test verifies:
- two-column desktop cards become one column at a 360 px viewport.
- the page has no horizontal overflow, including with very long saved tab titles and very long hostnames.
- the newest card carries the Latest chip, and a long host summary is clipped to one line with an ellipsis.
- no visible dashboard text renders below 11px at 1100px or 360px.
- live totals, search filtering, and Clear work in the real extension.
- keyboard order reaches the primary restore action before destructive Delete.
- focus-visible styling is present for keyboard users.
- Restore here opens only linkable URLs.
- Delete requires two clicks before the session is removed.

```bash
npm install --no-save --package-lock=false playwright@1.62.0
npx playwright install --with-deps chromium
node tests/e2e/regroup.e2e.js
node tests/e2e/session-dashboard.e2e.js
```

GitHub Actions runs the Node/jsdom/load suite, syntax checks, and both real Chromium acceptance tests on pull requests and pushes to `master`.

## Built With

- HTML/CSS/JavaScript
- Chrome Extensions API (Manifest V3)
- Node.js + jsdom
- Playwright Chromium for end-to-end extension verification

## License

MIT License
