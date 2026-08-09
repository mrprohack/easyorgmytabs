# Project Context: Tab Organizer Pro (easyorgmytabs)

## Project Overview
This project is a premium Chrome Extension (Manifest V3) designed to help power users organize and manage their browser tabs efficiently. The extension provides a suite of tools for grouping tabs, deduplicating them, saving memory, and storing tab sessions for later use.

## Core Features & Architecture

### V1 Features (Organization)
- **Arrange by Date:** Groups all open tabs into collapsible Chrome Tab Groups based on when they were last accessed (e.g., Today, Yesterday, This Week, Last Week, Last Month, Older).
- **Arrange by Website:** Groups all open tabs into Chrome Tab Groups based on their base domain (e.g., youtube.com, google.com).

### V2 Features (Power-User Tools)
- **Close Duplicates:** Scans the active window and closes tabs sharing the same URL once the fragment and campaign params (`utm_*`, `fbclid`, â€¦) are stripped. Keeps the pinned copy, else the active one, else the first; never closes a pinned tab.
- **Sleep Inactive Tabs (Memory Saver):** Uses `chrome.tabs.discard()` on tabs idle longer than the threshold in `chrome.storage.sync.sleepHours` (default 1). **Rules:** Never sleep pinned tabs, and never sleep tabs playing audio (`tab.audible`).
- **Save Session:** Saves all non-pinned, restorable tabs to `chrome.storage.local`, opens the dashboard (`session.html`), then closes them. Order matters â€” closing first can close the whole window.
- **Keyboard shortcuts:** `commands` in the manifest reuse the same action names as the messages, so `chrome.commands.onCommand` dispatches through the same `HANDLERS` map.

## File Structure & Responsibilities
- `manifest.json`: Manifest V3 configuration. Requires `tabs`, `tabGroups`, `storage`, and `favicon` permissions.
- `background.js`: The service worker. Handles all actual tab manipulation, grouping logic, discarding, and storage operations. Every action lives in the `HANDLERS` map and returns a count that the popup turns into its status line. All `savedSessions` writes are serialized through `enqueueSessionWrite` in the service worker; the dashboard mutates via messages (`SESSION_DELETE`/`SESSION_ADD_TAB`/`SESSION_REMOVE_TAB`) and reads via `chrome.storage.onChanged`.
- `popup.html` & `popup.js`: The extension popup UI. Sends messages (e.g., `action: 'ARRANGE_BY_DATE'`) to the background script and reports the resulting count inline.
- `session.html` & `session.js`: A full-page dashboard UI to manage (restore/delete/add to/search) saved sessions. Never writes storage directly — mutations go through background messages, and `chrome.storage.onChanged` keeps the view fresh.
- `styles.css`: Centralized stylesheet shared by both surfaces â€” `body.popup` and `body.dashboard` scope the differences.
- `test.js`: `node test.js [filter]` — runner over `tests/*.test.js` (logic, background, dom via jsdom, load).
- `logic.js`: Pure helpers shared by service worker (`importScripts`), popup/dashboard (`<script>`), and tests (`require`): `isRestorable`, `dedupeKey`, `getDomain`, `getDateBucket`, `isLinkable`, `clampSleepHours`, `filterSessions`, `newSessionId`, `runBatched`, session limits (`MAX_SAVED_SESSIONS`, `MAX_TABS_PER_SESSION`).
- `tests/helpers/chrome-stub.js`: Shared chrome mock (`makeChromeStub`, `makeBrowserChromeStub`).
- `tests/helpers/load-background.js`: Loads `background.js` into Node tests with `logic.js` helpers exposed.
- `icon.svg`: Vector mark used by the popup and dashboard headers. Its `rx="28"` on a 128-unit viewBox is why `.header img` uses `border-radius: 21.875%` â€” keep the two in sync or the CSS corner clips a different curve than the artwork.
- `icon16/32/48/128.png`: Raster icons for the toolbar, extensions page, and store. 16 and 32 use a simplified flat-card mark because the offset cards turn to mush below ~48px; 48 and 128 use the detailed mark. Regenerate all four together if the logo changes.

## UI / UX Design Guidelines
The user prefers a **unified, premium aesthetic** across all UI surfaces (popup and dashboard).

- **Theme:** Premium minimal/glass aesthetic.
- **Backgrounds:** Use a soft, modern gradient: `linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)`.
- **Buttons:** Pill-shaped white buttons with soft shadows (`box-shadow: 0 2px 4px rgba(0,0,0,0.05);`), crisp SVG iconography, and subtle hover translations (`translateY(-2px)`).
- **Typography:** `system-ui` sans-serif stack. Clean, highly legible text with high contrast (`#1e293b` for primary, `#334155` for buttons, `#3b82f6` for links).
- **Cards/Containers:** Frosted translucent panels or clean white boxes with generous padding and border-radius (`16px`).

## Agent Instructions
- When making UI changes, ensure they exactly match the established premium aesthetic outlined above.
- When making backend changes to `background.js`, always account for edge cases: ignore `chrome://` URLs for tab groups, respect pinned tabs, and catch asynchronous errors gracefully.
- Do not use generic browser alerts for UI feedback; build custom UI or use the dashboard. `alert`/`confirm` are out â€” the popup has a status line and the dashboard's Delete button uses a two-step inline confirm.
- Saved tab titles and URLs are attacker-controlled page data. Never interpolate them into `innerHTML`; set them via `textContent` and only assign an `href` after checking the scheme is `http(s)`.
