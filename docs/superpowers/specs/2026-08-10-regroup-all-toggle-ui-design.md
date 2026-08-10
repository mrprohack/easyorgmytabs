# Regroup All Toggle and Ungroup All UX Design

## Goal
Fix shortcut-label overlap, make ungrouping predictable, and let users choose whether Date/Website organization should preserve existing groups or rebuild all grouped tabs in the current window.

## Approved behavior
- Add a **Regroup all** On/Off switch in the Organize card.
- Default is **Off**.
- **Off:** By Date / By Website organizes only currently ungrouped, non-pinned, restorable tabs. Every existing Chrome group is preserved, including groups previously created by Tab Organizer.
- **On:** By Date / By Website first ungroups every non-pinned grouped tab in the current window, then groups all eligible tabs by the selected mode.
- Replace **Ungroup organized** with **Ungroup all**.
- **Ungroup all:** ungroup every non-pinned grouped tab in the current window, regardless of ownership. Pinned tabs remain untouched.
- All three behaviors are current-window only.
- The owned-group session registry remains available for active-mode display but is no longer required for explicit Ungroup all or Regroup all On behavior.

## Popup UX
- Keep Date and Website as primary Organize actions.
- Place the Regroup all switch on its own compact row with a clear Off/On state and helper copy:
  - Off: `Only ungrouped tabs`
  - On: `Rebuild all groups`
- Rename the action to `Ungroup all` and state that it affects grouped, non-pinned tabs in the current window.
- Shortcut badges must use reserved layout space rather than absolute positioning over labels.
- On narrow buttons, shortcut chips may sit in a dedicated footer/right column but must never overlap the visible action label.
- Keep the natural popup height at or below 600px.

## Result copy
- Off grouping with preserved groups: `Grouped N groups by Website. X grouped tabs left unchanged.`
- On regroup: `Regrouped X tabs into N groups by Website.` (Date equivalent).
- Ungroup all: `Ungrouped X grouped tabs.`
- Nothing to ungroup: `No grouped tabs to ungroup.`

## Storage
- Store the Regroup all preference in `chrome.storage.sync` as `regroupAll` (boolean), default `false`.
- Popup sends the current boolean as `regroupAll` with Date/Website actions.
- Keyboard commands have no popup toggle context, so they read `regroupAll` from `chrome.storage.sync` and follow the saved preference.

## Safety
- Never ungroup pinned tabs.
- Never operate outside the current window for popup/keyboard organize and ungroup actions.
- When Regroup all is Off, no existing group is changed.
- When Regroup all is On or Ungroup all is clicked, the behavior is explicit and intentionally may dissolve manual groups in the current window.

## Verification
- Unit/reliability tests cover Off preserving all groups, On rebuilding manual + extension groups, and Ungroup all removing all non-pinned groups.
- Popup/jsdom tests cover toggle persistence, action payloads, copy, and shortcut layout classes.
- Real Playwright Chromium E2E covers Off -> On -> Ungroup all and verifies pinned grouped tabs remain grouped.
- Real-browser layout assertion keeps popup content <= 600px and detects shortcut/action-label overlap using element bounding boxes.
