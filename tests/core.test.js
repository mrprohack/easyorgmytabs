import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  duplicateTabIdsToClose,
  filterTabs,
  findDuplicateGroups,
  getDomain,
  groupTabs,
  normalizeUrl,
  sortTabs,
  validateSessionImport,
} from '../src/lib/core.js';

const tabs = [
  { id: 1, windowId: 1, index: 0, title: 'OpenAI', url: 'https://openai.com/?utm_source=x', pinned: true },
  { id: 2, windowId: 1, index: 1, title: 'Docs', url: 'https://developer.chrome.com/docs/extensions', pinned: false },
  { id: 3, windowId: 2, index: 0, title: 'OpenAI copy', url: 'https://openai.com/#top', pinned: false },
];

test('normalizeUrl removes fragments and tracking parameters', () => {
  assert.equal(normalizeUrl('https://Example.com/path/?utm_source=x&b=2#hello'), 'https://example.com/path?b=2');
});

test('getDomain returns a readable label for web and internal URLs', () => {
  assert.equal(getDomain('https://www.example.com/page'), 'example.com');
  assert.equal(getDomain('chrome://extensions'), 'chrome://');
  assert.equal(getDomain('not a url'), 'Other');
});

test('filterTabs matches title, URL, and domain case-insensitively', () => {
  assert.deepEqual(filterTabs(tabs, 'CHROME').map((tab) => tab.id), [2]);
  assert.deepEqual(filterTabs(tabs, 'openai.com').map((tab) => tab.id), [1, 3]);
});

test('sortTabs supports position, title, and domain ordering without mutating input', () => {
  const original = tabs.map((tab) => tab.id);
  assert.deepEqual(sortTabs(tabs, 'position').map((tab) => tab.id), [1, 2, 3]);
  assert.deepEqual(sortTabs(tabs, 'title').map((tab) => tab.id), [2, 1, 3]);
  assert.deepEqual(sortTabs(tabs, 'domain').map((tab) => tab.id), [2, 1, 3]);
  assert.deepEqual(tabs.map((tab) => tab.id), original);
});

test('groupTabs groups by window, domain, or a single all-tabs group', () => {
  assert.deepEqual(groupTabs(tabs, 'window').map(([key, items]) => [key, items.length]), [['Window 1', 2], ['Window 2', 1]]);
  assert.deepEqual(groupTabs(tabs, 'domain').map(([key, items]) => [key, items.length]), [['developer.chrome.com', 1], ['openai.com', 2]]);
  assert.deepEqual(groupTabs(tabs, 'none')[0][0], 'All tabs');
});

test('duplicate detection normalizes tracking parameters and fragments', () => {
  const groups = findDuplicateGroups(tabs);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((tab) => tab.id), [1, 3]);
});

test('duplicate cleanup keeps the earliest tab and can preserve pinned duplicates', () => {
  assert.deepEqual(duplicateTabIdsToClose(tabs, true), [3]);
  const reversedPins = tabs.map((tab) => ({ ...tab, pinned: tab.id === 3 }));
  assert.deepEqual(duplicateTabIdsToClose(reversedPins, true), [1]);
  assert.deepEqual(duplicateTabIdsToClose(reversedPins, false), [3]);
});

test('createSession stores restorable fields grouped by window', () => {
  const session = createSession(tabs, 'Research');
  assert.equal(session.name, 'Research');
  assert.equal(session.windows.length, 2);
  assert.deepEqual(Object.keys(session.windows[0].tabs[0]), ['title', 'url', 'pinned']);
});

test('validateSessionImport accepts a valid export and rejects malformed data', () => {
  const session = createSession(tabs, 'Valid');
  const valid = validateSessionImport({ version: 1, sessions: [session] });
  assert.equal(valid.sessions.length, 1);
  assert.throws(() => validateSessionImport({ version: 1, sessions: [{ name: 'Bad', windows: [{ tabs: [{}] }] }] }), /valid URL/);
  assert.throws(() => validateSessionImport({ version: 1, sessions: new Array(501).fill(session) }), /500 sessions/);
});
