# ADR 0002: Smart Regroup Extension-Owned Groups

- Status: Superseded by ADR 0003
- Date: 2026-08-10

## Context

ADR 0001 protected every existing Chrome Tab Group. That fixed accidental destruction of user-created groups, but it also created a UX dead-end: after Tab Organizer grouped tabs by Date, choosing Website could not reorganize those same tabs because the extension could not distinguish its own groups from manual groups.

## Previous decision

Tab Organizer recorded every Chrome Tab Group it successfully created in `chrome.storage.session` under `organizerOwnedGroups`. The registry was keyed by Chrome group ID and stored the group's window ID and organization mode (`date` or `website`). Date/Website regrouping and `UNGROUP_ORGANIZED` mutated only groups proven to be extension-owned.

This protected unknown/manual groups, but it made ungrouping dependent on temporary ownership state. After an extension/browser reload or for a manually-created group, the popup could report that there were no Tab Organizer groups even though grouped tabs were visibly present.

## Superseding decision

ADR 0003 replaces ownership-dependent mutation with an explicit user-controlled policy:

- Regroup all Off preserves every existing group and organizes only ungrouped tabs.
- Regroup all On intentionally rebuilds every non-pinned group in the current window.
- Ungroup all intentionally removes every non-pinned group in the current window.
- The temporary ownership registry remains only for active-mode metadata and is not required to authorize explicit regroup/ungroup operations.

See `docs/adr/0003-explicit-regroup-all-mode.md` for the active decision and verification strategy.
