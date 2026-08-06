# Project Context: Tab Organizer Pro (easyorgmytabs)

## Project Overview
This project is a premium Chrome Extension (Manifest V3) designed to help power users organize and manage their browser tabs efficiently. The extension provides a suite of tools for grouping tabs, deduplicating them, saving memory, and storing tab sessions for later use.

## Core Features & Architecture

### V1 Features (Organization)
- **Arrange by Date:** Groups all open tabs into collapsible Chrome Tab Groups based on when they were last accessed (e.g., Today, Yesterday, This Week, Last Week, Last Month, Older).
- **Arrange by Website:** Groups all open tabs into Chrome Tab Groups based on their base domain (e.g., youtube.com, google.com).

### V2 Features (Power-User Tools)
- **Close Duplicates:** Scans the active window and closes any tabs that share the exact same URL, keeping the first instance.
- **Sleep Inactive Tabs (Memory Saver):** Uses `chrome.tabs.discard()` to put tabs to sleep if they haven't been accessed in the last 1 hour. **Rules:** Never sleep pinned tabs, and never sleep tabs playing audio (`tab.audible`).
- **Save Session:** Saves all non-pinned, non-`chrome://` tabs to `chrome.storage.local`, closes them, and opens a local dashboard (`session.html`) to view and restore them later.

## File Structure & Responsibilities
- `manifest.json`: Manifest V3 configuration. Requires `tabs`, `tabGroups`, and `storage` permissions.
- `background.js`: The service worker. Handles all actual tab manipulation, grouping logic, discarding, and storage operations.
- `popup.html` & `popup.js`: The extension popup UI. Sends messages (e.g., `action: 'ARRANGE_BY_DATE'`) to the background script.
- `session.html` & `session.js`: A full-page dashboard UI to manage (restore/delete/add to) saved sessions.
- `styles.css`: Centralized stylesheet for the popup.
- `icon.svg` / `icon.png`: The extension branding assets.

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
- Do not use generic browser alerts for UI feedback; build custom UI or use the dashboard.
