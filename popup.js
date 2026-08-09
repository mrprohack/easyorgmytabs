const ACTIONS = {
  'btn-date': 'ARRANGE_BY_DATE',
  'btn-website': 'ARRANGE_BY_WEBSITE',
  'btn-dedupe': 'CLOSE_DUPLICATES',
  'btn-sleep': 'SLEEP_INACTIVE',
  'btn-session': 'SAVE_SESSION'
};

// [singular, plural, nothing-happened]
const RESULT_TEXT = {
  ARRANGE_BY_DATE: ['group', 'groups', 'Nothing to arrange.'],
  ARRANGE_BY_WEBSITE: ['group', 'groups', 'Nothing to arrange.'],
  CLOSE_DUPLICATES: ['duplicate closed', 'duplicates closed', 'No duplicates found.'],
  SLEEP_INACTIVE: ['tab slept', 'tabs slept', 'No idle tabs to sleep.'],
  SAVE_SESSION: ['tab saved', 'tabs saved', 'No tabs to save.']
};

const statusEl = document.getElementById('status');
const buttons = Object.keys(ACTIONS).map(id => document.getElementById(id)).filter(Boolean);

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function triggerAction(action) {
  buttons.forEach(b => b.disabled = true);
  setStatus('Workingâ€¦');
  try {
    const response = await chrome.runtime.sendMessage({ action });
    const [one, many, none] = RESULT_TEXT[action];
    if (response?.status === 'error') {
      setStatus(response.error || 'Something went wrong.', true);
    } else {
      const count = response?.count ?? 0;
      setStatus(count === 0 ? none : `${count} ${count === 1 ? one : many}.`);
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

// Sleep threshold, shared with background.js via chrome.storage.sync.
const sleepHoursInput = document.getElementById('sleep-hours');
const { clampSleepHours } = window;

chrome.storage.sync.get('sleepHours').then(({ sleepHours = 1 }) => {
  sleepHoursInput.value = sleepHours;
});

sleepHoursInput.addEventListener('change', async () => {
  const hours = clampSleepHours(sleepHoursInput.value);
  sleepHoursInput.value = hours;
  await chrome.storage.sync.set({ sleepHours: hours });
  setStatus(`Sleeping tabs idle over ${hours}h.`);
});
