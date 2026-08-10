const ACTIONS = {
  'btn-date': 'ARRANGE_BY_DATE',
  'btn-website': 'ARRANGE_BY_WEBSITE',
  'btn-ungroup': 'UNGROUP_ALL',
  'btn-dedupe': 'CLOSE_DUPLICATES',
  'btn-undo': 'UNDO_CLOSE',
  'btn-sleep': 'SLEEP_INACTIVE',
  'btn-session': 'SAVE_SESSION'
};

const SHORTCUT_BUTTONS = {
  ARRANGE_BY_DATE: 'btn-date',
  ARRANGE_BY_WEBSITE: 'btn-website',
  CLOSE_DUPLICATES: 'btn-dedupe',
  VIEW_SESSIONS: 'btn-view-sessions'
};

const ORGANIZE_ACTIONS = new Set(['ARRANGE_BY_DATE', 'ARRANGE_BY_WEBSITE', 'UNGROUP_ALL']);

// [singular, plural, nothing-happened]
const RESULT_TEXT = {
  ARRANGE_BY_DATE: ['group', 'groups', 'Nothing to arrange.'],
  ARRANGE_BY_WEBSITE: ['group', 'groups', 'Nothing to arrange.'],
  UNGROUP_ALL: ['grouped tab ungrouped', 'grouped tabs ungrouped', 'No grouped tabs to ungroup.'],
  CLOSE_DUPLICATES: ['duplicate closed', 'duplicates closed', 'No duplicates found.'],
  UNDO_CLOSE: ['tab restored', 'tabs restored', 'Nothing to restore.'],
  SLEEP_INACTIVE: ['tab slept', 'tabs slept', 'No idle tabs to sleep.'],
  SAVE_SESSION: ['tab saved', 'tabs saved', 'No tabs to save.']
};

function popupUnit(count, one, many) {
  return count === 1 ? one : many;
}

function preservedGroupsSuffix(result) {
  const preserved = result?.preservedGroupedTabs ?? 0;
  if (!preserved) return '';

  if (result?.regroupAll && result?.pinnedGroupedTabs > 0) {
    const pinned = result.pinnedGroupedTabs;
    return ` ${pinned} pinned grouped ${popupUnit(pinned, 'tab', 'tabs')} left unchanged.`;
  }

  return ` ${preserved} grouped ${popupUnit(preserved, 'tab', 'tabs')} left unchanged.`;
}

function pinnedGroupsSuffix(count) {
  if (!count) return '';
  return ` ${count} pinned grouped ${popupUnit(count, 'tab', 'tabs')} left unchanged.`;
}

function formatActionResponse(action, response) {
  const result = response?.result;
  const count = result?.changed ?? response?.count ?? 0;

  if (action === 'ARRANGE_BY_DATE' || action === 'ARRANGE_BY_WEBSITE') {
    const label = action === 'ARRANGE_BY_DATE' ? 'Date' : 'Website';
    let text;

    if (result?.code === 'REGROUPED_ALL' && result.regroupedTabs > 0) {
      text = `Regrouped ${result.regroupedTabs} ${popupUnit(result.regroupedTabs, 'tab', 'tabs')} into ${count} ${popupUnit(count, 'group', 'groups')} by ${label}.`;
    } else if (count > 0) {
      text = `Grouped into ${count} ${popupUnit(count, 'group', 'groups')} by ${label}.`;
    } else {
      text = 'Nothing to arrange.';
    }
    return text + preservedGroupsSuffix(result);
  }

  if (action === 'UNGROUP_ALL') {
    const text = count > 0
      ? `Ungrouped ${count} grouped ${popupUnit(count, 'tab', 'tabs')}.`
      : 'No grouped tabs to ungroup.';
    return text + pinnedGroupsSuffix(result?.pinnedGroupedTabs ?? 0);
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
  const regroupToggle = document.getElementById('regroup-all-toggle');
  const regroupDetail = document.getElementById('regroup-all-detail');
  const regroupState = document.getElementById('regroup-all-state');
  const shortcutWarning = document.getElementById('shortcut-warning');
  const shortcutsSettingsBtn = document.getElementById('btn-shortcuts-settings');
  let regroupAll = false;

  if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') {
    if (statusEl) {
      statusEl.textContent = 'Extension APIs unavailable - open this from the toolbar popup.';
    }
    return;
  }

  function setStatus(text, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('error', isError);
  }

  function applyRegroupAll(value) {
    regroupAll = value === true;
    if (regroupToggle) {
      regroupToggle.setAttribute('aria-checked', String(regroupAll));
      regroupToggle.classList.toggle('is-on', regroupAll);
    }
    if (regroupState) regroupState.textContent = regroupAll ? 'On' : 'Off';
    if (regroupDetail) regroupDetail.textContent = regroupAll ? 'Rebuild all groups' : 'Only ungrouped tabs';
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

  async function refreshShortcutState() {
    if (typeof chrome.commands?.getAll !== 'function') return;

    try {
      const registered = await chrome.commands.getAll();
      const shortcuts = new Map((registered || []).map(command => [command.name, command.shortcut || '']));
      let missing = 0;

      for (const [command, buttonId] of Object.entries(SHORTCUT_BUTTONS)) {
        const button = document.getElementById(buttonId);
        const chip = button?.querySelector('.shortcut');
        if (!button || !chip) continue;

        const shortcut = shortcuts.get(command) || '';
        const unassigned = shortcut.length === 0;
        chip.textContent = shortcut || 'Not assigned';
        button.classList.toggle('shortcut-unassigned', unassigned);
        button.title = unassigned
          ? 'Keyboard shortcut is not assigned in Chrome'
          : `Keyboard shortcut: ${shortcut}`;
        if (unassigned) missing++;
      }

      if (shortcutWarning) {
        shortcutWarning.hidden = missing === 0;
        shortcutWarning.textContent = missing === 0
          ? ''
          : `${missing} keyboard ${popupUnit(missing, 'shortcut is', 'shortcuts are')} not assigned in Chrome.`;
      }
    } catch (err) {
      console.error('Failed to read keyboard shortcuts:', err);
    }
  }

  async function triggerAction(action) {
    buttons.forEach(b => b.disabled = true);
    if (regroupToggle) regroupToggle.disabled = true;
    setStatus('Working…');
    try {
      const request = { action };
      if (action === 'ARRANGE_BY_DATE' || action === 'ARRANGE_BY_WEBSITE') {
        request.regroupAll = regroupAll;
      }
      const response = await chrome.runtime.sendMessage(request);
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
      if (regroupToggle) regroupToggle.disabled = false;
    }
  }

  for (const [id, action] of Object.entries(ACTIONS)) {
    document.getElementById(id)?.addEventListener('click', () => triggerAction(action));
  }

  regroupToggle?.addEventListener('click', async () => {
    const previous = regroupAll;
    const next = !regroupAll;
    applyRegroupAll(next);
    try {
      await chrome.storage.sync.set({ regroupAll: next });
      setStatus(next
        ? 'Regroup all is On. Date/Website will rebuild existing non-pinned groups.'
        : 'Regroup all is Off. Date/Website will touch only ungrouped tabs.');
    } catch (err) {
      applyRegroupAll(previous);
      console.error('Failed to save regroupAll:', err);
      setStatus(err?.message || 'Failed to save Regroup all.', true);
    }
  });

  shortcutsSettingsBtn?.addEventListener('click', async () => {
    try {
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      window.close();
    } catch (err) {
      console.error('Failed to open Chrome keyboard shortcut settings:', err);
      setStatus('Open chrome://extensions/shortcuts in Chrome to assign or change shortcuts.', true);
    }
  });

  // Preview: show duplicate/idle counts when the popup opens.
  chrome.runtime.sendMessage({ action: 'PREVIEW' }).then((response) => {
    if (response?.status === 'done' && response.count && typeof response.count === 'object') {
      setStatus(`${response.count.duplicates} duplicates · ${response.count.idle} idle tabs`);
    }
  }).catch(() => {});

  // Active grouping state is independent of the preview status line.
  refreshGroupingState();

  // Show Chrome's active bindings instead of assuming manifest suggestions won.
  refreshShortcutState();

  // Regroup all is a saved preference used by both popup and keyboard actions.
  chrome.storage.sync.get('regroupAll').then(({ regroupAll: savedRegroupAll = false }) => {
    applyRegroupAll(savedRegroupAll === true);
  }).catch((err) => {
    console.error('Failed to read regroupAll:', err);
    applyRegroupAll(false);
  });

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
