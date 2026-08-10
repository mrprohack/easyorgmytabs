const ACTIONS = {
  'btn-date': 'ARRANGE_BY_DATE',
  'btn-website': 'ARRANGE_BY_WEBSITE',
  'btn-ungroup': 'UNGROUP_ORGANIZED',
  'btn-dedupe': 'CLOSE_DUPLICATES',
  'btn-undo': 'UNDO_CLOSE',
  'btn-sleep': 'SLEEP_INACTIVE',
  'btn-session': 'SAVE_SESSION'
};

const ORGANIZE_ACTIONS = new Set(['ARRANGE_BY_DATE', 'ARRANGE_BY_WEBSITE', 'UNGROUP_ORGANIZED']);

// [singular, plural, nothing-happened]
const RESULT_TEXT = {
  ARRANGE_BY_DATE: ['group', 'groups', 'Nothing to arrange.'],
  ARRANGE_BY_WEBSITE: ['group', 'groups', 'Nothing to arrange.'],
  UNGROUP_ORGANIZED: ['organized tab ungrouped', 'organized tabs ungrouped', 'No Tab Organizer groups to ungroup.'],
  CLOSE_DUPLICATES: ['duplicate closed', 'duplicates closed', 'No duplicates found.'],
  UNDO_CLOSE: ['tab restored', 'tabs restored', 'Nothing to restore.'],
  SLEEP_INACTIVE: ['tab slept', 'tabs slept', 'No idle tabs to sleep.'],
  SAVE_SESSION: ['tab saved', 'tabs saved', 'No tabs to save.']
};

function popupUnit(count, one, many) {
  return count === 1 ? one : many;
}

function manualGroupsSuffix(count) {
  if (!count) return '';
  return ` ${count} manually grouped ${popupUnit(count, 'tab', 'tabs')} preserved.`;
}

function formatActionResponse(action, response) {
  const result = response?.result;
  const count = result?.changed ?? response?.count ?? 0;

  if (action === 'ARRANGE_BY_DATE' || action === 'ARRANGE_BY_WEBSITE') {
    const label = action === 'ARRANGE_BY_DATE' ? 'Date' : 'Website';
    const manualCount = result?.manualGroupedTabs ?? result?.skipped ?? 0;
    let text;

    if (result?.code === 'REGROUPED' && result.regroupedTabs > 0) {
      text = `Regrouped ${result.regroupedTabs} ${popupUnit(result.regroupedTabs, 'tab', 'tabs')} into ${count} ${popupUnit(count, 'group', 'groups')} by ${label}.`;
    } else if (count > 0) {
      text = `Grouped into ${count} ${popupUnit(count, 'group', 'groups')} by ${label}.`;
    } else {
      text = 'Nothing to arrange.';
    }
    return text + manualGroupsSuffix(manualCount);
  }

  if (action === 'UNGROUP_ORGANIZED') {
    const manualCount = result?.manualGroupedTabs ?? result?.skipped ?? 0;
    const text = count > 0
      ? `Ungrouped ${count} organized ${popupUnit(count, 'tab', 'tabs')}.`
      : 'No Tab Organizer groups to ungroup.';
    return text + manualGroupsSuffix(manualCount);
  }

  const [one, many, none] = RESULT_TEXT[action];
  const base = count === 0 ? none : `${count} ${count === 1 ? one : many}.`;

  if (result?.code === 'SESSION_CAP' && action === 'SAVE_SESSION' && result.skipped > 0) {
    const skippedUnit = result.skipped === 1 ? 'tab' : 'tabs';
    return `${base} ${result.skipped} ${skippedUnit} skipped (session limit).`;
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
  const modeEl = document.getElementById('organize-mode');
  const dateBtn = document.getElementById('btn-date');
  const websiteBtn = document.getElementById('btn-website');

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

  function applyGroupingState(state = {}) {
    const mode = state?.mode === 'date' || state?.mode === 'website' ? state.mode : null;
    const dateActive = mode === 'date';
    const websiteActive = mode === 'website';

    if (dateBtn) {
      dateBtn.setAttribute('aria-pressed', String(dateActive));
      dateBtn.classList.toggle('active-mode', dateActive);
    }
    if (websiteBtn) {
      websiteBtn.setAttribute('aria-pressed', String(websiteActive));
      websiteBtn.classList.toggle('active-mode', websiteActive);
    }
    if (modeEl) {
      modeEl.textContent = dateActive ? 'Date active' : websiteActive ? 'Website active' : 'Not organized';
      modeEl.classList.toggle('is-active', Boolean(mode));
    }
  }

  async function refreshGroupingState() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GROUPING_STATE' });
      if (response?.status === 'done' && response.count && typeof response.count === 'object') {
        applyGroupingState(response.count);
      }
    } catch (err) {
      console.error('Failed to read grouping state:', err);
    }
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
        if (ORGANIZE_ACTIONS.has(action)) await refreshGroupingState();
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

  // Active grouping state is independent of the preview status line.
  refreshGroupingState();

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
