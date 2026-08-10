# ADR 0002: Smart Regroup Extension-Owned Groups

- Status: Accepted
- Date: 2026-08-10

## Context

ADR 0001 protected every existing Chrome Tab Group. That fixed accidental destruction of user-created groups, but it also created a UX dead-end: after Tab Organizer grouped tabs by Date, choosing Website could not reorganize those same tabs because the extension could not distinguish its own groups from manual groups.

A safe switch needs an ownership signal that does not rely on group titles, colors, tab URLs, or other heuristics that a user could also create.

## Decision

Tab Organizer records every Chrome Tab Group it successfully creates in `chrome.storage.session` under `organizerOwnedGroups`. The registry is keyed by Chrome group ID and stores the group's window ID and organization mode (`date` or `website`).

Before a Date or Website action runs, the extension checks the current-window tabs against that registry:

1. Tabs in a live registry-owned group are ungrouped and become eligible for the new organization mode.
2. Tabs in groups that are not present in the registry are treated as manual/unknown and are preserved.
3. Newly-created groups are written back to the registry with their mode and window.
4. Stale owned-group entries in the current scope are pruned as actions run.

The `UNGROUP_ORGANIZED` action uses the same ownership registry and removes only Tab Organizer-owned groups in the current window.

The `GROUPING_STATE` action derives the active mode from live owned groups so the popup can show `Date active`, `Website active`, or `Not organized`.

## Failure policy

Ownership is never guessed from title, color, or layout. If `chrome.storage.session` is unavailable or ownership state has been cleared, existing groups are considered unknown and are preserved. The fallback may prevent automatic regrouping, but it cannot destroy a manual group.

## Consequences

- Date -> Website and Website -> Date become one-click operations for extension-owned groups.
- User-created groups remain protected.
- `Ungroup organized` is safe enough to expose directly in the popup because its scope is ownership-based.
- Ownership intentionally follows Chrome's browser-session group IDs instead of being durable configuration.
- Popup feedback can distinguish fresh grouping, regrouping, ungrouping, and preserved manual tabs.

## Verification

- `tests/reliability.test.js` verifies owned-group registration, Date -> Website regrouping, grouping state, explicit ungroup, and manual-group preservation.
- `tests/popup-result.test.js` verifies active-mode state and result copy.
- `tests/e2e/regroup.e2e.js` loads the extension in real Playwright Chromium, creates a separate manual group, then verifies Date -> Website -> Ungroup without altering that manual group.
