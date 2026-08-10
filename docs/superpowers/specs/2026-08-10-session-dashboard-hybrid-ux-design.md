# Saved Sessions Hybrid Dashboard UX Design

- Status: Approved in conversation
- Date: 2026-08-10

## Goal
Make `session.html` faster to scan, safer to operate, more accessible, and visually consistent with Tab Organizer Pro while retaining a dense power-user layout for many saved sessions and tabs.

## Scope
This redesign changes only the saved-sessions dashboard surface and its rendering/tests. The saved-session data model, storage keys, background message contracts, session caps, and restore semantics remain unchanged.

## Information architecture

### Page header
- Keep the Tab Organizer icon and `Saved Sessions` as the H1.
- Add one short explanatory subtitle.
- Show live summary metrics for total saved sessions and total saved tabs.

### Search and results toolbar
- Use a sticky dashboard toolbar below the header.
- Search keeps the existing 150 ms debounce.
- Add an accessible clear-search button that appears only when a query exists.
- Show live result context: total sessions/tabs when unfiltered; matching session/tab counts when filtered.
- Search must continue matching through the existing `filterSessions()` helper rather than duplicating filtering logic.

### Session cards
Each session card has:
- semantic article/card structure;
- saved date/time and tab count in a compact header;
- `Restore in new window` as the primary action;
- `Restore here` as a secondary action;
- a visually quieter destructive `Delete` action separated from restore actions;
- dense tab rows;
- an add-link utility row at the bottom.

### Tab rows
Each saved tab row shows:
- favicon/fallback initial;
- title as the main line;
- normalized hostname as secondary metadata when available;
- compact icon-only remove action with an explicit `aria-label` containing the tab title or hostname.

Link safety remains unchanged: only validated http(s) URLs receive href values, and arbitrary page titles/URLs are never interpolated as HTML.

### Empty states
- No sessions: explain that saved sessions will appear here after using Save Session.
- No search matches: show query-aware copy plus a `Clear search` action.

## Interaction and hierarchy
- Restore actions must visually dominate Delete.
- Delete retains the existing inline two-step confirmation and three-second reset window.
- Restore here continues opening only linkable URLs and reports the number opened in the live status region.
- Mutation success/failure continues through the existing background actions: `SESSION_DELETE`, `SESSION_ADD_TAB`, and `SESSION_REMOVE_TAB`.
- Loading/mutation errors use the existing live status element; refactor the nested mutation error path for clarity without changing external behavior.

## Accessibility
- Add `lang="en"`, responsive viewport metadata, and semantic page landmarks.
- Search has a visible or screen-reader label, `aria-controls`, and a clear button with an accessible name.
- Session cards use article/headings with stable relationships.
- Icon-only controls have explicit accessible names.
- All actionable controls have visible `:focus-visible` treatment.
- Minimum practical pointer target for icon-only controls: 32×32 CSS px.
- Status remains `role="status" aria-live="polite"`.

## Responsive layout
- Desktop: two-column session card grid when space allows.
- Narrow widths: one-column cards.
- No horizontal page overflow at 360 px viewport width.
- Tab titles/hostnames truncate rather than widening cards.
- Sticky search toolbar must not obscure focused content.

## Visual style
Use a hybrid direction:
- polished, modern page header and card surfaces;
- compact tab rows and restrained spacing for density;
- existing system font and extension palette;
- no new runtime UI framework, icon package, or build step;
- dashboard selectors should be scoped under `.dashboard` where practical so the open popup work remains independent.

## Data and rendering helpers
Keep the existing plain-JavaScript architecture. Add small pure/render helpers only where they improve readability/testability, such as:
- `sessionStats(items)` -> `{ sessionCount, tabCount }`;
- `hostnameOf(url)` -> display hostname or empty string;
- `setDashboardStatus(text, isError = false)`;
- `updateDashboardSummary(visibleResults)`.

Do not change `filterSessions()` or the saved-session schema.

## Testing

### jsdom
Extend `tests/dom.test.js` to verify:
- page semantic/header/search structure;
- total session/tab summary;
- filtered result summary and clear-search behavior;
- session action hierarchy/classes;
- hostname secondary text;
- remove-button accessible label;
- no unsafe href for non-http(s) URL;
- restore-here behavior;
- delete confirmation and mutation errors;
- empty and no-match states.

### Real Chromium
Add a saved-sessions Playwright acceptance scenario that loads the unpacked extension and `session.html`, injects representative saved-session data, and verifies:
- no horizontal overflow at desktop and 360 px widths;
- two-column-to-one-column responsive card behavior;
- search filtering + clear interaction;
- focus-visible keyboard navigation reaches primary/session controls;
- restore-here opens the expected linkable URLs;
- delete requires two clicks;
- long titles do not create horizontal overflow.

## Non-goals
- Renaming sessions.
- Reordering sessions or tabs.
- Import/export.
- Bulk delete/restore.
- New persistence schema.
- Framework migration.
- Changes to popup grouping UX.
