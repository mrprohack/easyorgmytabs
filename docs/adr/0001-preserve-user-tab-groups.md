# ADR 0001: Preserve Existing User Tab Groups

- Status: Accepted
- Date: 2026-08-10

## Context

The original organizer queried tabs across every browser window, ungrouped non-pinned tabs, then rebuilt groups. That made Arrange by Website and Arrange by Date capable of destroying groups the user created manually and of changing windows the user was not actively working in.

## Decision

Production popup and keyboard organization actions use the current window by default.

Tabs with an existing Chrome `groupId` are preserved and are not moved into newly generated groups. Ungrouped, non-pinned, restorable tabs remain eligible for organization.

The background message boundary returns a structured action result with `changed`, `skipped`, `status`, and an optional `code`. When existing groups are preserved, the result uses `PRESERVED_EXISTING_GROUPS` so the popup can explain what happened.

The low-level `arrangeByWebsite()` and `arrangeByDate()` functions retain their all-window default for compatibility with the existing direct test API; production entry points call their detailed variants with current-window scope.

## Consequences

- Manual groups are no longer silently destroyed.
- Popup and keyboard actions are safer and more predictable.
- Existing direct unit/load tests remain compatible while production behavior is stricter.
- A future explicit “organize all windows” or “reorganize existing groups” feature can be added as an opt-in mode instead of changing the safe default.

## Verification

`tests/reliability.test.js` covers current-window scope and preservation of existing groups. GitHub Actions runs the full Node test suite plus syntax checks on every pull request.
