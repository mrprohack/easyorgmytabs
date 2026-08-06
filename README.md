# Easy Organize My Tabs

A privacy-first Chrome and Microsoft Edge extension for searching, grouping, cleaning, saving, and restoring browser tabs.

## What is improved

- Fast search across tab titles, URLs, and domains
- Grouping by browser window or website domain
- Sorting by browser position, title, or domain
- Multi-select bulk actions: reload, pin, mute, and close
- Duplicate URL cleanup that removes tracking parameters and URL fragments
- Optional protection for pinned duplicate tabs
- Named sessions for the current window or every browser window
- Session restore, rename, delete, JSON export, and validated import
- System, light, and dark themes
- Accessible keyboard focus, semantic controls, and live status messages
- No analytics, advertising, remote scripts, network service, or host permissions
- Automated tests, static extension validation, and CI

## Install in Chrome

1. Download and extract the ZIP file.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted project folder containing `manifest.json`.
6. Pin **Easy Organize My Tabs** from the browser extensions menu.

## Install in Microsoft Edge

1. Download and extract the ZIP file.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted project folder containing `manifest.json`.

## Keyboard shortcut

The default shortcut is:

- Windows/Linux: `Ctrl+Shift+Y`
- macOS: `Command+Shift+Y`

Browser shortcut conflicts can be changed at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`.

## Permissions

The extension requests only:

- `tabs`: list and manage open tabs
- `storage`: save settings and tab sessions locally

It requests no website host access and contains no analytics or remote code.

## Development

Requirements:

- Node.js 20 or newer

Commands:

```bash
npm test
npm run validate
npm run check
```

No package installation is required because the project has no runtime or development dependencies.

## Project structure

```text
manifest.json                  Extension manifest
src/background.js              Badge and installation defaults
src/lib/core.js                Pure tab/session domain logic
src/lib/chrome-api.js          Chrome API adapter
src/lib/settings.js            Local settings/session persistence
src/popup/                     Main tab dashboard
src/options/                   Settings and saved-session manager
src/icons/                     Extension icons
tests/                         Unit and static validation tests
docs/superpowers/              Design and implementation plan
```

## Session export format

Exports use versioned JSON:

```json
{
  "version": 1,
  "exportedAt": "2026-08-06T12:00:00.000Z",
  "sessions": []
}
```

Imports are validated for format, URL safety, session count, window count, and tab count before being saved.

## Release packaging

To create an installable ZIP from the project root:

```bash
zip -r easy-organize-my-tabs-extension.zip manifest.json src README.md LICENSE PRIVACY.md -x "*.DS_Store"
```

## License

MIT License. See [LICENSE](LICENSE).
