const container = document.getElementById('sessions-container');
const statusEl = document.getElementById('status');
const searchInput = document.getElementById('search');
const clearSearchBtn = document.getElementById('clear-search');
const sessionCountEl = document.getElementById('session-count');
const tabCountEl = document.getElementById('tab-count');
const resultSummaryEl = document.getElementById('result-summary');

let sessions = [];
let searchTimer;

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

function plural(count, one, many) {
  return count === 1 ? one : many;
}

function sessionStats(items) {
  return (Array.isArray(items) ? items : []).reduce((stats, item) => {
    const tabs = Array.isArray(item?.tabs) ? item.tabs : [];
    stats.sessionCount += 1;
    stats.tabCount += tabs.length;
    return stats;
  }, { sessionCount: 0, tabCount: 0 });
}

function hostnameOf(pageUrl) {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function setDashboardStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function updateDashboardSummary(visibleResults) {
  const total = sessionStats(sessions);
  if (sessionCountEl) {
    sessionCountEl.textContent = `${total.sessionCount} ${plural(total.sessionCount, 'session', 'sessions')}`;
  }
  if (tabCountEl) {
    tabCountEl.textContent = `${total.tabCount} ${plural(total.tabCount, 'tab', 'tabs')}`;
  }

  const query = searchInput?.value.trim() || '';
  if (clearSearchBtn) clearSearchBtn.hidden = query.length === 0;
  if (!resultSummaryEl) return;

  const visible = sessionStats(visibleResults);
  if (query) {
    resultSummaryEl.textContent = `${visible.sessionCount} ${plural(visible.sessionCount, 'session', 'sessions')} · ${visible.tabCount} matching ${plural(visible.tabCount, 'tab', 'tabs')}`;
  } else {
    resultSummaryEl.textContent = `${visible.sessionCount} saved ${plural(visible.sessionCount, 'session', 'sessions')} · ${visible.tabCount} ${plural(visible.tabCount, 'tab', 'tabs')}`;
  }
}

function clearSearch() {
  if (!searchInput) return;
  clearTimeout(searchTimer);
  searchInput.value = '';
  render();
  searchInput.focus();
}

// Saved titles and URLs come from arbitrary pages, so they are only ever set
// as text or as a validated href — never interpolated into markup.
function faviconFallback(pageUrl) {
  const hostname = hostnameOf(pageUrl);
  const initial = (hostname[0] || '?').toUpperCase();
  return el('span', { className: 'favicon favicon-fallback', textContent: initial });
}

function linkRow(session, tab) {
  const displayTitle = tab.title || tab.url || 'Untitled tab';
  const host = hostnameOf(tab.url);
  const favicon = el('img', { className: 'favicon', src: faviconUrl(tab.url), alt: '', loading: 'lazy' });
  favicon.addEventListener('error', () => favicon.replaceWith(faviconFallback(tab.url)), { once: true });

  const link = el('a', {
    className: 'link',
    textContent: displayTitle,
    title: tab.url,
    target: '_blank',
    rel: 'noopener noreferrer'
  });
  if (isLinkable(tab.url)) link.href = tab.url;

  const copy = el('div', { className: 'link-copy' }, link);
  if (host) copy.append(el('span', { className: 'link-host', textContent: host }));

  const remove = el('button', { className: 'delete-link-btn', type: 'button', title: `Remove ${displayTitle}` }, icon(ICONS.close));
  remove.setAttribute('aria-label', `Remove ${displayTitle}`);
  remove.addEventListener('click', async () => {
    const index = session.tabs.indexOf(tab);
    if (index > -1) await mutate('SESSION_REMOVE_TAB', { sessionId: sessionIdOf(session), index });
  });

  return el('div', { className: 'link-row' }, favicon, copy, remove);
}

function addLinkForm(session) {
  const input = el('input', {
    type: 'url', required: true, className: 'input', placeholder: 'Paste URL…',
    ariaLabel: 'URL to add to this session'
  });

  const add = el('button', { type: 'submit', className: 'btn add-link-btn', title: 'Add tab' }, icon(ICONS.plus), el('span', { textContent: 'Add' }));
  add.setAttribute('aria-label', 'Add tab to session');

  const form = el('form', { className: 'add-link-form' }, input, add);
  form.setAttribute('aria-label', 'Add a tab to this session');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = input.value.trim();
    if (!isLinkable(url)) {
      input.setCustomValidity('Enter an http:// or https:// URL');
      input.reportValidity();
      input.setCustomValidity('');
      return;
    }
    const tab = { title: new URL(url).hostname, url };
    await mutate('SESSION_ADD_TAB', { sessionId: sessionIdOf(session), tab });
  });

  return form;
}

function sessionHeadingId(session) {
  const safe = String(sessionIdOf(session)).replace(/[^a-zA-Z0-9_-]/g, '-');
  return `session-heading-${safe || 'saved'}`;
}

function sessionCard(session, visibleTabs) {
  const headingId = sessionHeadingId(session);
  const sessionDate = new Date(session.date).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const count = session.tabs.length;

  const restore = el('button', { className: 'btn btn-session-primary', type: 'button' }, icon(ICONS.restore), el('span', { textContent: 'Restore in new window' }));
  restore.addEventListener('click', () => {
    const urls = session.tabs.map(tab => tab.url).filter(isLinkable);
    if (urls.length) chrome.windows.create({ url: urls });
  });

  const restoreHere = el('button', { className: 'btn btn-session-secondary btn-restore-here', type: 'button' }, icon(ICONS.restore), el('span', { textContent: 'Restore here' }));
  restoreHere.addEventListener('click', async () => {
    const urls = session.tabs.map(tab => tab.url).filter(isLinkable);
    if (!urls.length) return;
    for (const url of urls) await chrome.tabs.create({ url });
    setDashboardStatus(`Opened ${urls.length} ${plural(urls.length, 'tab', 'tabs')} in this window.`);
  });

  const removeLabel = el('span', { textContent: 'Delete' });
  const remove = el('button', { className: 'btn btn-danger btn-session-delete', type: 'button' }, icon(ICONS.trash), removeLabel);
  remove.setAttribute('aria-label', `Delete session saved ${sessionDate}`);
  let armed = false;
  let resetTimer;
  remove.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      removeLabel.textContent = 'Confirm delete?';
      remove.classList.add('armed');
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        armed = false;
        removeLabel.textContent = 'Delete';
        remove.classList.remove('armed');
      }, 3000);
      return;
    }
    clearTimeout(resetTimer);
    await mutate('SESSION_DELETE', { sessionId: sessionIdOf(session) });
  });

  const article = el('article', { className: 'session' },
    el('header', { className: 'session-card-header' },
      el('div', { className: 'session-heading-group' },
        el('p', { className: 'session-eyebrow', textContent: 'Saved workspace' }),
        el('h2', { id: headingId, textContent: sessionDate }),
        el('p', { className: 'meta', textContent: `${count} ${plural(count, 'tab', 'tabs')}` })
      ),
      el('div', { className: 'session-danger-zone' }, remove)
    ),
    el('div', { className: 'session-actions' }, restore, restoreHere),
    el('div', { className: 'session-tabs-heading' },
      el('span', { textContent: 'Tabs' }),
      el('span', { className: 'session-visible-count', textContent: `${visibleTabs.length} shown` })
    ),
    el('div', { className: 'links-list' }, ...visibleTabs.map(tab => linkRow(session, tab))),
    el('footer', { className: 'session-card-footer' }, addLinkForm(session))
  );
  article.setAttribute('aria-labelledby', headingId);
  return article;
}

function emptyState(query) {
  const state = el('div', { className: 'empty-state' });
  if (query) {
    state.append(
      el('h2', { textContent: 'No saved tabs match that search.' }),
      el('p', { textContent: `Nothing matched “${query}”. Try another term or clear the search.` })
    );
    const clear = el('button', { type: 'button', className: 'btn empty-state-action', textContent: 'Clear search' });
    clear.addEventListener('click', clearSearch);
    state.append(clear);
  } else {
    state.append(
      el('h2', { textContent: 'No saved sessions yet.' }),
      el('p', { textContent: 'Use Save Session from the Tab Organizer popup and your saved workspace will appear here.' })
    );
  }
  return state;
}

function render() {
  if (!container || !searchInput) return;
  const visible = filterSessions(sessions, searchInput.value);
  const query = searchInput.value.trim();
  updateDashboardSummary(visible);
  container.textContent = '';

  if (visible.length === 0) {
    container.append(emptyState(query));
    return;
  }

  for (const { session, tabs } of visible) {
    container.append(sessionCard(session, tabs));
  }
}

searchInput?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 150);
});
clearSearchBtn?.addEventListener('click', clearSearch);

async function loadSessions() {
  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  sessions = Array.isArray(savedSessions) ? savedSessions : [];
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.savedSessions) {
    sessions = Array.isArray(changes.savedSessions.newValue) ? changes.savedSessions.newValue : [];
    render();
  }
});

async function mutate(action, payload) {
  setDashboardStatus('');
  try {
    const response = await chrome.runtime.sendMessage({ action, ...payload });
    if (response?.status === 'error') throw new Error(response.error || 'Mutation failed');
    await loadSessions();
  } catch (err) {
    setDashboardStatus(err?.message || 'Something went wrong.', true);
  }
}

loadSessions().catch((err) => {
  setDashboardStatus(err?.message || 'Failed to load sessions.', true);
});
