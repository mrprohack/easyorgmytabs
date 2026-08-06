async function triggerAction(action, btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ action });
  } catch (err) {
    console.error('Failed to send message:', err);
  } finally {
    btn.disabled = false;
  }
}

const btnDate = document.getElementById('btn-date');
const btnWebsite = document.getElementById('btn-website');

if (btnDate) {
  btnDate.addEventListener('click', () => triggerAction('ARRANGE_BY_DATE', btnDate));
}

if (btnWebsite) {
  btnWebsite.addEventListener('click', () => triggerAction('ARRANGE_BY_WEBSITE', btnWebsite));
}
