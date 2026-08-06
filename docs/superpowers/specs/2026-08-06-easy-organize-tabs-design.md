# Easy Organize My Tabs — Improved Release Design

## Goal

Create a polished, privacy-first Chrome/Edge Manifest V3 extension that helps users search, group, clean, save, and restore browser tabs without external services or tracking.

## Product scope

The extension provides one compact popup for everyday tab management and one options page for saved sessions and preferences.

### Core user workflows

1. Search open tabs by title, URL, or domain.
2. Group tabs by browser window or domain and sort them predictably.
3. Select tabs and perform bulk close, reload, pin, unpin, mute, or unmute actions.
4. Detect duplicate URLs and close redundant copies while preserving the earliest tab in each duplicate set.
5. Save the current window or every window as a named session.
6. Restore, rename, export, import, and delete saved sessions.
7. Configure theme, grouping, sorting, duplicate handling, and close confirmations.

## Architecture

- `src/lib/core.js` contains deterministic tab, duplicate, session, and import validation logic. It has no Chrome API dependency and is covered by Node tests.
- `src/lib/chrome-api.js` isolates Promise-based wrappers around Chrome extension APIs.
- `src/lib/settings.js` owns defaults and persisted settings/session access.
- `src/popup/` renders the tab dashboard and dispatches user actions.
- `src/options/` manages preferences and saved sessions.
- `src/background.js` maintains the action badge and handles installation defaults.

## Data model

### Settings

```js
{
  theme: "system" | "light" | "dark",
  groupBy: "window" | "domain" | "none",
  sortBy: "position" | "title" | "domain",
  confirmBulkClose: true,
  preservePinnedDuplicates: true
}
```

### Saved session

```js
{
  id: string,
  name: string,
  createdAt: string,
  windows: [
    {
      focused: boolean,
      tabs: [{ title: string, url: string, pinned: boolean }]
    }
  ]
}
```

## Security and privacy

- No host permissions, analytics, advertising, remote code, or network calls.
- Only `tabs` and `storage` permissions are requested.
- Imported session files are validated before storage.
- Unsafe and internal URLs are excluded from restoration when Chrome cannot open them.
- User-facing errors avoid exposing stack traces.

## Error handling

- All Chrome API calls are wrapped and caught at UI boundaries.
- Empty states explain what the user can do next.
- Destructive bulk close can require confirmation.
- Import rejects malformed JSON, oversized collections, and missing URL fields.

## Accessibility

- Semantic controls, visible keyboard focus, labels, status messaging, and minimum 44px primary targets.
- Theme follows the operating system by default and supports explicit light/dark choices.
- No interaction depends only on color.

## Testing

- Node built-in test runner covers tab normalization, searching, grouping, sorting, duplicate selection, session creation, and import validation.
- A static validation script verifies required extension files and manifest constraints.
- Manual checklist covers Chrome and Edge unpacked installation, popup actions, options persistence, session restore, and keyboard navigation.
