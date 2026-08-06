const btnDate = document.getElementById('btn-date');
const btnWebsite = document.getElementById('btn-website');
const buttons = [btnDate, btnWebsite].filter(Boolean);

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
