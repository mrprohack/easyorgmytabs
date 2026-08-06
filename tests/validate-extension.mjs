import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

assert.equal(manifest.manifest_version, 3, 'manifest_version must be 3');
assert.equal(manifest.background?.service_worker, 'src/background.js', 'background service worker is required');
assert.equal(manifest.background?.type, 'module', 'background service worker must use ES modules');
assert.equal(manifest.action?.default_popup, 'src/popup/popup.html', 'popup entry point is required');
assert.equal(manifest.options_ui?.page, 'src/options/options.html', 'options entry point is required');
assert.deepEqual([...manifest.permissions].sort(), ['storage', 'tabs'], 'only storage and tabs permissions are allowed');
assert.equal(manifest.host_permissions, undefined, 'host permissions are not allowed');

const requiredFiles = [
  ...Object.values(manifest.icons ?? {}),
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  'src/lib/core.js',
  'src/lib/chrome-api.js',
  'src/lib/settings.js',
];

await Promise.all(requiredFiles.map((file) => access(path.join(root, file))));

for (const htmlFile of [manifest.action.default_popup, manifest.options_ui.page]) {
  const html = await readFile(path.join(root, htmlFile), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src=[\"']https?:/i, `${htmlFile} must not load remote scripts`);
}
console.log(`Extension validation passed (${requiredFiles.length} required files checked).`);
