const container = document.getElementById('sessions-container');
const statusEl = document.getElementById('status');
const searchInput = document.getElementById('search');

let sessions = [];

function faviconUrl(pageUrl) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return url.href;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(Boolean));
  return node;
}

// `path` is always a constant from this file, never user data.
function icon(path) {
  const wrapper = document.createElement('span');
  wrapper.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="${path}"/></svg>`;
  return wrapper.firstElementChild;
}

const ICONS = {
  restore: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  close: 'M6 18L18 6M6 6l12 12',
  plus: 'M12 4v16m8-8H4'
};

// Saved titles and URLs come from arbitrary pages, so they are only ever set
// as text or as a validated href — never interpolated into markup.

// Chrome serves a generic globe for pages it has no favicon for, but the request
// still fails for unindexed or non-http URLs — fall back to an initial so the row
// keeps its alignment instead of losing the icon entirely.
function faviconFallback(pageUrl) {
  let initial = '?';
  try {
    initial = (new URL(pageUrl).hostname.replace(/^www\./, '')[0] || '?').toUpperCase();
  } catch (e) {
    // keep '?'
  }
  return el('span', { className: 'favicon favicon-fallback', textContent: initial });
}

function linkRow(session, tab) {
  const favicon = el('img', { className: 'favicon', src: faviconUrl(tab.url), alt: '', loading: 'lazy' });
  favicon.addEventListener('error', () => favicon.replaceWith(faviconFallback(tab.url)), { once: true });

  const link = el('a', {
    className: 'link',
    textContent: tab.title || tab.url,
    title: tab.url,
    target: '_blank',
    rel: 'noopener noreferrer'
  });
  if (isLinkable(tab.url)) link.href = tab.url;

  const remove = el('button', { className: 'delete-link-btn', title: 'Remove tab' }, icon(ICONS.close));
  remove.addEventListener('click', async () => {
    const index = session.tabs.indexOf(tab);
    if (index > -1) await mutate('SESSION_REMOVE_TAB', { sessionId: sessionIdOf(session), index });
  });

  return el('div', { className: 'link-row' }, favicon, link, remove);
}

function addLinkForm(session) {
  const input = el('input', { type: 'url', required: true, className: 'input', placeholder: 'Paste URL…' });

  const form = el('form', { className: 'add-link-form' },
    input,
    el('button', { type: 'submit', className: 'btn add-link-btn', title: 'Add tab' }, icon(ICONS.plus))
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!isLinkable(url)) {
      input.setCustomValidity('Enter an http:// or https:// URL');
      input.reportValidity();
      input.setCustomValidity(''); // the bubble stays up; don't leave the field stuck invalid
      return;
    }
    const tab = { title: new URL(url).hostname, url };
    await mutate('SESSION_ADD_TAB', { sessionId: sessionIdOf(session), tab });
  });

  return form;
}

function sessionCard(session, visibleTabs) {
  const restore = el('button', { className: 'btn' }, icon(ICONS.restore), 'Restore');
  restore.addEventListener('click', () => {
    const urls = session.tabs.map(t => t.url).filter(isLinkable);
    if (urls.length) chrome.windows.create({ url: urls });
  });

  // Restore here: reopen the session into the dashboard's own window.
  const restoreHere = el('button', { className: 'btn btn-restore-here' }, icon(ICONS.restore), 'Restore here');
  restoreHere.addEventListener('click', async () => {
    const urls = session.tabs.map(t => t.url).filter(isLinkable);
    if (!urls.length) return;
    for (const url of urls) {
      await chrome.tabs.create({ url });
    }
    statusEl.textContent = `Opened ${urls.length} tab${urls.length === 1 ? '' : 's'} in this window.`;
    statusEl.classList.remove('error');
  });

  // Inline two-step confirm instead of a browser dialog.
  const removeLabel = el('span', { textContent: 'Delete' });
  const remove = el('button', { className: 'btn btn-danger' }, icon(ICONS.trash), removeLabel);
  let armed = false;
  remove.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      removeLabel.textContent = 'Confirm?';
      remove.classList.add('armed');
      setTimeout(() => {
        armed = false;
        removeLabel.textContent = 'Delete';
        remove.classList.remove('armed');
      }, 3000);
      return;
    }
    await mutate('SESSION_DELETE', { sessionId: sessionIdOf(session) });
  });

  const count = session.tabs.length;
  return el('div', { className: 'session' },
    el('h2', {
      textContent: new Date(session.date).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      })
    }),
    el('p', { className: 'meta', textContent: `${count} tab${count === 1 ? '' : 's'}` }),
    el('div', { className: 'btn-row' }, restore, restoreHere, remove),
    el('div', { className: 'links-list' }, ...visibleTabs.map(tab => linkRow(session, tab))),
    addLinkForm(session)
  );
}

function render() {
  const visible = filterSessions(sessions, searchInput.value);
  container.textContent = '';

  if (visible.length === 0) {
    container.append(el('div', {
      className: 'empty-state',
      textContent: searchInput.value.trim() ? 'No saved tabs match that search.' : 'No saved sessions yet.'
    }));
    return;
  }

  for (const { session, tabs } of visible) {
    container.append(sessionCard(session, tabs));
  }
}

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 150);
});

async function loadSessions() {
  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  sessions = Array.isArray(savedSessions) ? savedSessions : [];
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.savedSessions) {
    sessions = changes.savedSessions.newValue || [];
    render();
  }
});

async function mutate(action, payload) {
  statusEl.textContent = '';
  statusEl.classList.remove('error');
  try {
    const response = await chrome.runtime.sendMessage({ action, ...payload });
    if (response?.status === 'error') throw new Error(response.error || 'Mutation failed');
    await loadSessions().catch((err) => {
  statusEl.textContent = err?.message || 'Failed to load sessions.';
  statusEl.classList.add('error');
});
  } catch (err) {
    statusEl.textContent = err?.message || 'Something went wrong.';
    statusEl.classList.add('error');
  }
}

loadSessions().catch((err) => {
  statusEl.textContent = err?.message || 'Failed to load sessions.';
  statusEl.classList.add('error');
});