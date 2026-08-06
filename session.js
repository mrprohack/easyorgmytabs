async function loadSessions() {
  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  const container = document.getElementById('sessions-container');
  
  if (savedSessions.length === 0) {
    container.innerHTML = '<div class="empty-state">No saved sessions.</div>';
    return;
  }

  container.innerHTML = savedSessions.map((session, sIndex) => `
    <div class="session">
      <div class="session-header">
        <h2>${new Date(session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' })}</h2>
        <div class="actions">
          <button class="btn restore-btn" data-sindex="${sIndex}">Restore</button>
          <button class="btn delete-session-btn" data-sindex="${sIndex}">Delete</button>
        </div>
      </div>
      
      <div class="links-list">
        ${session.tabs.map((tab, tIndex) => `
          <div class="link-row">
            <a class="link" href="${tab.url}" target="_blank" title="${tab.title}">${tab.title}</a>
            <button class="delete-link-btn" data-sindex="${sIndex}" data-tindex="${tIndex}" title="Remove">✕</button>
          </div>
        `).join('')}
      </div>

      <form class="add-link-form" data-sindex="${sIndex}">
        <input type="url" required class="add-link-input" placeholder="Paste URL..." />
        <button type="submit" class="add-link-btn">Add</button>
      </form>
    </div>
  `).join('');

  attachEventListeners(savedSessions);
}

function attachEventListeners(savedSessions) {
  // Restore Session
  document.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const sIndex = e.currentTarget.getAttribute('data-sindex');
      for (const tab of savedSessions[sIndex].tabs) {
        chrome.tabs.create({ url: tab.url, active: false });
      }
    });
  });

  // Delete Session
  document.querySelectorAll('.delete-session-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (confirm('Are you sure you want to delete this session?')) {
        const sIndex = e.currentTarget.getAttribute('data-sindex');
        savedSessions.splice(sIndex, 1);
        await chrome.storage.local.set({ savedSessions });
        loadSessions();
      }
    });
  });

  // Delete Link
  document.querySelectorAll('.delete-link-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const sIndex = e.currentTarget.getAttribute('data-sindex');
      const tIndex = e.currentTarget.getAttribute('data-tindex');
      savedSessions[sIndex].tabs.splice(tIndex, 1);
      
      // If session is empty, remove it
      if (savedSessions[sIndex].tabs.length === 0) {
        savedSessions.splice(sIndex, 1);
      }
      
      await chrome.storage.local.set({ savedSessions });
      loadSessions();
    });
  });

  // Add Link
  document.querySelectorAll('.add-link-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sIndex = e.currentTarget.getAttribute('data-sindex');
      const input = e.currentTarget.querySelector('.add-link-input');
      const url = input.value.trim();
      
      if (url) {
        savedSessions[sIndex].tabs.push({ title: url, url: url });
        await chrome.storage.local.set({ savedSessions });
        loadSessions();
      }
    });
  });
}

loadSessions();
