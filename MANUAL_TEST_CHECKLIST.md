# Manual Test Checklist

## Installation

- [ ] Chrome loads the extracted folder without manifest errors.
- [ ] Edge loads the extracted folder without manifest errors.
- [ ] The toolbar icon and tab-count badge appear.
- [ ] The popup opens with `Ctrl+Shift+Y` or the configured shortcut.

## Popup

- [ ] Search matches tab title, full URL, and domain without case sensitivity.
- [ ] Window, domain, and no-group modes render correctly.
- [ ] Position, title, and domain sorting render correctly.
- [ ] Selecting one tab updates the selected counter.
- [ ] Selecting an entire group selects only that group.
- [ ] Reload, pin, mute, and close work for selected tabs.
- [ ] Per-tab activate, pin, mute, and close controls work.
- [ ] Duplicate cleanup keeps one normalized URL copy.
- [ ] Pinned duplicate protection follows the saved preference.
- [ ] Saving the current window creates a named session.
- [ ] Saving all windows preserves separate window groups.
- [ ] Empty search results show an explanatory empty state.

## Options and sessions

- [ ] Theme changes apply immediately and persist after reopening.
- [ ] Grouping and sorting defaults persist in the popup.
- [ ] Bulk-close and pinned-duplicate preferences persist.
- [ ] Reset defaults restores all five default preferences.
- [ ] Restoring a session creates its saved windows and tabs.
- [ ] Pinned tabs are pinned after restoration.
- [ ] Rename and delete actions update the session list.
- [ ] Exported JSON opens as valid JSON.
- [ ] A valid exported JSON file imports successfully.
- [ ] Malformed, oversized, or unsafe imported session data is rejected.

## Accessibility and privacy

- [ ] Every interactive control is reachable by keyboard.
- [ ] Focus indicators are clearly visible in light and dark themes.
- [ ] Browser accessibility inspection finds labeled buttons and inputs.
- [ ] Network inspection shows no extension-originated analytics or API calls.
- [ ] Manifest requests only `tabs` and `storage` permissions.
