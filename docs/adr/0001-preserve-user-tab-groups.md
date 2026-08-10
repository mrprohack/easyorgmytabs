# ADR 0001: Preserve Existing User Tab Groups

- Status: Accepted; extended by ADR 0002
- Date: 2026-08-10

## Context

The original organizer queried tabs across every browser window, ungrouped non-pinned tabs, then rebuilt groups. That made Arrange by Website and Arrange by Date capable of destroying groups the user created manually and of changing windows the user was not actively working in.

## Decision

Production popup and keyboard organization actions use the current window by default.

Chrome groups that Tab Organizer cannot prove it owns are preserved and are not moved into newly generated groups. Ungrouped, non-pinned, restorable tabs remain eligible for organization.

ADR 0002 extends this rule by allowing the extension to track the group IDs it creates during the current browser session. Those owned groups may be safely replaced when the user switches between Date and Website organization, while unknown/manual groups remain protected.

The background message boundary returns structured action results so the popup can explain changed, regrouped, skipped, and preserved tabs.

The low-level `arrangeByWebsite()` and `arrangeByDate()` functions retain their numeric compatibility API for focused tests; production entry points use the safer structured action boundary.

## Consequences

- Manual and unknown groups are never silently destroyed.
- Switching Date <-> Website can still be a one-click operation for groups created by Tab Organizer.
- Popup and keyboard actions are current-window scoped and predictable.
- If ownership state is missing, the extension chooses preservation rather than destructive inference.
- Existing direct unit/load tests remain compatible while production behavior is stricter.

## Verification

`tests/reliability.test.js` covers current-window scope, ownership-aware regrouping, and preservation of manual groups. `tests/e2e/regroup.e2e.js` verifies Date -> Website -> Ungroup in real Chromium while a separately-created manual group remains untouched. GitHub Actions runs the full Node suite, syntax checks, and Chromium E2E on every pull request.
