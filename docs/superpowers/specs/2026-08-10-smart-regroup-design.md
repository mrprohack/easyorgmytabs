# Smart Regroup UX Design

## Goal
Let users switch between Date and Website organization in one click without destroying manually-created Chrome tab groups.

## Behavior
- Popup and keyboard organization actions operate on the current window.
- Groups created by Tab Organizer Pro are tracked in `chrome.storage.session` by group ID, window ID, and mode (`date` or `website`).
- Choosing Date or Website first ungroups only Tab Organizer Pro-owned groups in the current window, then rebuilds eligible tabs using the selected mode.
- Manual Chrome groups are never ungrouped. If ownership tracking is missing, an existing group is treated as manual.
- `UNGROUP_ORGANIZED` removes only extension-owned groups in the current window.
- `GROUPING_STATE` reports the active extension-owned grouping mode for the current window so the popup can highlight it.
- Ownership state is pruned against live groups/tabs as actions run.

## Popup UX
- Put organization controls in a dedicated `Organize` section.
- Show Date and Website as the two primary grouping choices.
- Add a secondary `Ungroup organized` action.
- Show a small mode indicator: `Date active`, `Website active`, or `Not organized`.
- Explain that switching modes is safe and preserves manual groups.
- Keep power tools in a separate section.

## Result copy
- Fresh grouping: `Grouped into N groups by Website.` / `Grouped into N groups by Date.`
- Regroup: `Regrouped X tabs into N groups by Website.` / Date equivalent.
- Manual preservation suffix: `Y manually grouped tabs preserved.`
- Ungroup: `Ungrouped X organized tabs.`

## Safety
- Never ungroup pinned tabs or manual groups.
- Never infer ownership from group title or color.
- If session ownership state disappears after extension reload/browser restart, preserve all existing groups.
- Keep legacy numeric handler return values for existing direct tests; structured message results carry richer metadata.

## Tests
- Date -> Website regroups extension-owned groups.
- Website -> Date regroups extension-owned groups.
- Manual groups remain untouched during regroup.
- Ungroup organized removes only extension-owned groups.
- Grouping state exposes the active mode.
- Popup shows active state, regroup copy, and ungroup control.
- Existing 300-tab, session, dedupe, DOM, and reliability suites remain green.