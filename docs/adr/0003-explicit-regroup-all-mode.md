# ADR 0003: Explicit Regroup All Mode

- Status: Accepted
- Date: 2026-08-10

## Context

Ownership-aware regrouping protected manual Chrome Tab Groups, but mutation behavior depended on temporary `chrome.storage.session` ownership metadata. A visible group could therefore be impossible to ungroup from the popup when ownership state was missing, and users could not explicitly choose between preserving all groups and rebuilding all groups.

The popup also needs a rule that is easy to understand before a destructive grouping action occurs.

## Decision

Add a persisted boolean preference named `regroupAll` in `chrome.storage.sync`, defaulting to `false`.

### Regroup all Off

Date and Website organization operate only on currently ungrouped, non-pinned, restorable tabs in the current window. Every existing Chrome Tab Group is preserved, regardless of whether it was created by the extension or manually.

### Regroup all On

Date and Website organization first ungroup every non-pinned grouped tab in the current window, then rebuild all eligible tabs with the selected grouping strategy. This is an explicit user choice and may dissolve manual groups.

### Ungroup all

`UNGROUP_ALL` ungroups every non-pinned grouped tab in the current window, regardless of ownership metadata. Pinned tabs remain untouched.

### Keyboard commands

Date and Website keyboard commands read the saved `regroupAll` preference and apply the same semantics as the popup.

### Ownership registry

The `organizerOwnedGroups` registry in `chrome.storage.session` remains useful for deriving active-mode metadata. It no longer authorizes or blocks explicit Regroup all/Ungroup all mutations.

## UI consequences

- The Organize card exposes a `Regroup all` switch with explicit Off/On copy.
- Off says `Only ungrouped tabs`.
- On says `Rebuild all groups`.
- `Ungroup organized` is replaced by `Ungroup all`.
- Status messages say when grouped tabs were left unchanged.
- Shortcut chips use reserved layout space instead of absolute positioning so they cannot cover action labels.

## Safety

- Pinned tabs are never grouped, regrouped, or ungrouped by these actions.
- Popup and keyboard organization stay current-window scoped.
- Destructive regrouping of manual groups occurs only when the user has explicitly enabled Regroup all or clicked Ungroup all.

## Verification

- `tests/reliability.test.js` covers Off preserving all groups, On rebuilding non-pinned groups, Ungroup all ignoring ownership, pinned exclusions, and keyboard preference handling.
- `tests/popup-result.test.js` covers switch persistence, organize payloads, Ungroup all, and result copy.
- `tests/e2e/regroup.e2e.js` loads the real extension in Playwright Chromium and verifies Off -> On -> Ungroup all, including removal of a manual/unknown group created after extension regrouping.
- The Chromium test checks real DOM rectangles to ensure shortcut chips do not overlap labels and keeps popup natural height at or below 600px.
