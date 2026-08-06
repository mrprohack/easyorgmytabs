async function loadSessions() {
  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  const container = document.getElementById('sessions-container');
  
  if (savedSessions.length === 0) {
    container.innerHTML = '<p>No saved sessions yet.</p>';
    return;
  }

  container.innerHTML = savedSessions.map((session, index) => `
    <div class="session">
      <h2>Session from ${new Date(session.date).toLocaleString()}</h2>
      <button class="restore-btn" data-index="${index}">Restore All</button>
      <div style="margin-top: 12px;">
        ${session.tabs.map(tab => `<a class="link" href="${tab.url}" target="_blank">${tab.title}</a>`).join('')}
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = e.target.getAttribute('data-index');
      const session = savedSessions[idx];
      for (const tab of session.tabs) {
        chrome.tabs.create({ url: tab.url, active: false });
      }
    });
  });
}

loadSessions();
