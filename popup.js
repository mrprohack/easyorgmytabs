document.getElementById('btn-date').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'ARRANGE_BY_DATE' });
});

document.getElementById('btn-website').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'ARRANGE_BY_WEBSITE' });
});
