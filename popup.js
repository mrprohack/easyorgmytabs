const ACTIONS = {
  'btn-date': 'ARRANGE_BY_DATE',
  'btn-website': 'ARRANGE_BY_WEBSITE',
  'btn-dedupe': 'CLOSE_DUPLICATES',
  'btn-undo': 'UNDO_CLOSE',
  'btn-sleep': 'SLEEP_INACTIVE',
  'btn-session': 'SAVE_SESSION'
};

// [singular, plural, nothing-happened]
const RESULT_TEXT = {
  ARRANGE_BY_DATE: ['group', 'groups', 'Nothing to arrange.'],
  ARRANGE_BY_WEBSITE: ['group', 'groups', 'Nothing to arrange.'],
  CLOSE_DUPLICATES: ['duplicate closed', 'duplicates closed', 'No duplicates found.'],
  UNDO_CLOSE: ['tab restored', 'tabs restored', 'Nothing to restore.'],
  SLEEP_INACTIVE: ['tab slept', 'tabs slept', 'No idle tabs to sleep.'],
  SAVE_SESSION: ['tab saved', 'tabs saved', 'No tabs to save.']
};

function formatActionResponse(action, response) {
  const [one, many, none] = RESULT_TEXT[action];
  const result = response?.result;
  const count = result?.changed ?? response?.count ?? 0;
  const base = count === 0 ? none : `${count} ${count === 1 ? one : many}.`;

  if (result?.code === 'SESSION_CAP' && action === 'SAVE_SESSION' && result.skipped > 0) {
    const skippedUnit = result.skipped === 1 ? 'tab' : 'tabs';
    return `${base} ${result.skipped} ${skippedUnit} skipped (session limit).`;
  }

  if (
    result?.code === 'PRESERVED_EXISTING_GROUPS' &&
    result.skipped > 0 &&
    (action === 'ARRANGE_BY_DATE' || action === 'ARRANGE_BY_WEBSITE')
  ) {
    const skippedUnit = result.skipped === 1 ? 'tab' : 'tabs';
    return `${base} ${result.skipped} ${skippedUnit} already grouped and preserved.`;
  }

  return base;
}

// All wiring lives in initPopup() so a missing element or API can never blank
// the whole popup with an uncaught top-level error; failures land in the
// status line instead.
function initPopup() {
  const statusEl = document.getElementById('status');
  const buttons = Object.keys(ACTIONS).map(id => document.getElementById(id)).filter(Boolean);
  const sleepHoursInput = document.getElementById('sleep-hours');

  if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') {
    if (statusEl) {
      statusEl.textContent = 'Extension APIs unavailable - open this from the toolbar popup.';
    }
    return;
  }

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', isError);
  }

  async function triggerAction(action) {
    buttons.forEach(b => b.disabled = true);
    setStatus('Working…');
    try {
      const response = await chrome.runtime.sendMessage({ action });
      if (response?.status === 'error') {
        setStatus(response.error || 'Something went wrong.', true);
      } else if (response === undefined) {
        setStatus('Background not responding. Reload the extension.', true);
      } else {
        setStatus(formatActionResponse(action, response));
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setStatus(err?.message || 'Something went wrong.', true);
    } finally {
      buttons.forEach(b => b.disabled = false);
    }
  }

  for (const [id, action] of Object.entries(ACTIONS)) {
    document.getElementById(id)?.addEventListener('click', () => triggerAction(action));
  }

  // Preview: show duplicate/idle counts when the popup opens.
  chrome.runtime.sendMessage({ action: 'PREVIEW' }).then((response) => {
    if (response?.status === 'done' && response.count && typeof response.count === 'object') {
      setStatus(`${response.count.duplicates} duplicates · ${response.count.idle} idle tabs`);
    }
  }).catch(() => {});

  // View Saved Sessions opens the dashboard in a new tab (no background round-trip).
  document.getElementById('btn-view-sessions')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('session.html') });
    window.close();
  });

  if (!sleepHoursInput) return;

  // Sleep threshold, shared with background.js via chrome.storage.sync.
  chrome.storage.sync.get('sleepHours').then(({ sleepHours = 1 }) => {
    sleepHoursInput.value = sleepHours;
  }).catch((err) => {
    console.error('Failed to read sleepHours:', err);
    setStatus(err?.message || 'Failed to read the sleep threshold.', true);
  });

  sleepHoursInput.addEventListener('change', async () => {
    if (typeof clampSleepHours !== 'function') {
      setStatus('logic.js failed to load - reload the extension.', true);
      return;
    }
    const hours = clampSleepHours(sleepHoursInput.value);
    sleepHoursInput.value = hours;
    await chrome.storage.sync.set({ sleepHours: hours });
    setStatus(`Sleeping tabs idle over ${hours}h.`);
  });
}

try {
  initPopup();
} catch (err) {
  console.error('popup init failed:', err);
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = err?.message || 'Popup failed to load.';
    statusEl.classList.add('error');
  }
}
