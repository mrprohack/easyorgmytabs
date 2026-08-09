// logic.test.js
const assert = require('assert');
const L = require('../logic.js');

module.exports = async function main() {
  // isRestorable
  assert.strictEqual(L.isRestorable('https://example.com/a'), true);
  assert.strictEqual(L.isRestorable('chrome://newtab'), false);
  assert.strictEqual(L.isRestorable('chrome-extension://abc/session.html'), false);
  assert.strictEqual(L.isRestorable('about:blank'), false);
  assert.strictEqual(L.isRestorable('edge://settings'), false);
  assert.strictEqual(L.isRestorable('view-source:https://a.com'), false);
  assert.strictEqual(L.isRestorable(undefined), false);
  assert.strictEqual(L.isRestorable('not a url'), false);

  // dedupeKey
  assert.strictEqual(L.dedupeKey('https://a.com/x#frag'), 'https://a.com/x');
  assert.strictEqual(L.dedupeKey('https://a.com/x?utm_source=n&id=7'), 'https://a.com/x?id=7');
  assert.strictEqual(L.dedupeKey('https://a.com/x?fbclid=1&id=7'), 'https://a.com/x?id=7');
  assert.strictEqual(L.dedupeKey('https://a.com/x?gclid=1&id=7'), 'https://a.com/x?id=7');
  assert.strictEqual(L.dedupeKey('https://a.com/x?msclkid=1&id=7'), 'https://a.com/x?id=7');
  assert.strictEqual(L.dedupeKey('https://a.com/x?mc_eid=1&id=7'), 'https://a.com/x?id=7');
  assert.notStrictEqual(L.dedupeKey('https://a.com/x?id=7'), L.dedupeKey('https://a.com/x?id=8'));
  assert.strictEqual(L.dedupeKey('not a url'), 'not a url');

  // getDomain
  assert.strictEqual(L.getDomain('https://www.youtube.com/watch?v=1'), 'youtube.com');
  assert.strictEqual(L.getDomain('https://youtube.com/b'), 'youtube.com');
  assert.strictEqual(L.getDomain('garbage'), 'Other');

  // getDateBucket + BUCKET_COLORS keys
  const HOUR = 60 * 60 * 1000;
  const hoursAgo = h => Date.now() - h * HOUR;
  assert.strictEqual(L.getDateBucket(hoursAgo(2)), 'Today');
  assert.strictEqual(L.getDateBucket(hoursAgo(24 * 3)), 'This Week');
  assert.strictEqual(L.getDateBucket(hoursAgo(24 * 10)), 'Last Week');
  assert.strictEqual(L.getDateBucket(hoursAgo(24 * 20)), 'This Month');
  assert.strictEqual(L.getDateBucket(hoursAgo(24 * 40)), 'Older');
  assert.strictEqual(L.getDateBucket(undefined), 'Unknown');
  assert.strictEqual(L.getDateBucket('garbage'), 'Unknown');
  for (const bucket of ['Today', 'This Week', 'Last Week', 'This Month', 'Older', 'Unknown']) {
    assert.ok(typeof L.BUCKET_COLORS[bucket] === 'string', `missing color for ${bucket}`);
  }

  // isLinkable
  assert.strictEqual(L.isLinkable('https://a.com/'), true);
  assert.strictEqual(L.isLinkable('http://a.com/'), true);
  assert.strictEqual(L.isLinkable('javascript:alert(1)'), false);
  assert.strictEqual(L.isLinkable('chrome://newtab'), false);
  assert.strictEqual(L.isLinkable('data:text/html,x'), false);

  // clampSleepHours
  assert.strictEqual(L.clampSleepHours(2), 2);
  assert.strictEqual(L.clampSleepHours('2.5'), 2.5);
  assert.strictEqual(L.clampSleepHours(0), L.DEFAULT_SLEEP_HOURS);
  assert.strictEqual(L.clampSleepHours(-5), 0.25);
  assert.strictEqual(L.clampSleepHours(1000), 168);
  assert.strictEqual(L.clampSleepHours('abc'), L.DEFAULT_SLEEP_HOURS);
  assert.strictEqual(L.clampSleepHours(undefined), L.DEFAULT_SLEEP_HOURS);

  // filterSessions
  const sessions = [
    { date: 'a', tabs: [{ title: 'Alpha', url: 'https://a.com/' }, { title: 'Beta', url: 'https://b.com/' }] },
    { date: 'b', tabs: [{ title: 'Gamma', url: 'https://c.com/' }] }
  ];
  assert.deepStrictEqual(L.filterSessions(sessions, '').map(e => e.session.date), ['a', 'b']);
  assert.deepStrictEqual(L.filterSessions(sessions, '').map(e => e.tabs.length), [2, 1]);
  const hit = L.filterSessions(sessions, 'alpha');
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].session.date, 'a');
  assert.strictEqual(hit[0].tabs.length, 1);
  assert.strictEqual(L.filterSessions(sessions, 'https://c.com').length, 1);
  assert.strictEqual(L.filterSessions(sessions, 'zzz').length, 0);
  assert.strictEqual(L.filterSessions([], 'x').length, 0);

  // newSessionId
  assert.strictEqual(typeof L.newSessionId(), 'string');
  assert.notStrictEqual(L.newSessionId(), L.newSessionId());

  // constants
  assert.strictEqual(L.DEFAULT_SLEEP_HOURS, 1);
  assert.ok(L.MAX_SAVED_SESSIONS >= 1);
  assert.ok(L.MAX_TABS_PER_SESSION >= 1);
  // runBatched: concurrency capped at limit
  let active = 0, maxActive = 0, started = [];
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const result = await L.runBatched([1, 2, 3, 4, 5], 2, async (item) => {
    active++;
    maxActive = Math.max(maxActive, active);
    started.push(item);
    await delay(5);
    active--;
  });
  assert.strictEqual(result, 5);
  assert.strictEqual(maxActive, 2, 'never more than 2 ops in flight');
  assert.deepStrictEqual(started, [1, 2, 3, 4, 5]);

  // runBatched: failures are counted out and do not abort the batch
  const failed = [];
  const okCount = await L.runBatched(['a', 'b', 'c'], 3,
    async (item) => { if (item === 'b') throw new Error('boom'); },
    (err, item) => failed.push(item));
  assert.strictEqual(okCount, 2);
  assert.deepStrictEqual(failed, ['b']);

  // runBatched: empty input resolves 0; bad limit throws
  assert.strictEqual(await L.runBatched([], 5, async () => {}), 0);
  assert.throws(() => L.runBatched([1], 0, async () => {}), RangeError);
};