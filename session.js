async function loadSessions() {
  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  const container = document.getElementById('sessions-container');
  
  if (savedSessions.length === 0) {
    container.innerHTML = '<div class="empty-state">No saved sessions yet. Time to clear some tabs!</div>';
    return;
  }

  container.innerHTML = savedSessions.map((session, sIndex) => `
    <div class="session">
      <div class="session-header">
        <h2>${new Date(session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' })}</h2>
        <div class="actions">
          <button class="btn-icon restore-btn" data-sindex="${sIndex}" title="Restore Session">
            <svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </button>
          <button class="btn-icon delete-session-btn" data-sindex="${sIndex}" title="Delete Session">
            <svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
      
      <div class="links-list">
        ${session.tabs.map((tab, tIndex) => `
          <div class="link-row">
            <a class="link" href="${tab.url}" target="_blank" title="${tab.title}">${tab.title}</a>
            <button class="delete-link-btn" data-sindex="${sIndex}" data-tindex="${tIndex}" title="Remove tab">
              <svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        `).join('')}
      </div>

      <form class="add-link-form" data-sindex="${sIndex}">
        <input type="url" required class="add-link-input" placeholder="Paste URL to add..." />
        <button type="submit" class="add-link-btn" title="Add Link">
          <svg viewBox="0 0 24 24" fill="none"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
        </button>
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
      if (confirm('Are you sure you want to delete this entire session?')) {
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
