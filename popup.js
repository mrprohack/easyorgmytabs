const btnDate = document.getElementById('btn-date');
const btnWebsite = document.getElementById('btn-website');
const btnDedupe = document.getElementById('btn-dedupe');
const btnSleep = document.getElementById('btn-sleep');
const buttons = [btnDate, btnWebsite, btnDedupe, btnSleep].filter(Boolean);

async function triggerAction(action) {
  buttons.forEach(b => b.disabled = true);
  try {
    await chrome.runtime.sendMessage({ action });
  } catch (err) {
    console.error('Failed to send message:', err);
  } finally {
    buttons.forEach(b => b.disabled = false);
  }
}

if (btnDate) {
  btnDate.addEventListener('click', () => triggerAction('ARRANGE_BY_DATE'));
}

if (btnWebsite) {
  btnWebsite.addEventListener('click', () => triggerAction('ARRANGE_BY_WEBSITE'));
}

if (btnDedupe) {
  btnDedupe.addEventListener('click', () => triggerAction('CLOSE_DUPLICATES'));
}

if (btnSleep) {
  btnSleep.addEventListener('click', () => triggerAction('SLEEP_INACTIVE'));
}
