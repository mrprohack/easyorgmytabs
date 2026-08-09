// error-report.js — surfaces uncaught errors and rejected promises in the
// status line so failures are visible instead of console-only traces.
// Load this first in popup.html and session.html.
(function () {
  function show(message) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = message;
      status.classList.add('error');
    }
  }
  window.addEventListener('error', (event) => {
    show(event.message || 'Unknown script error.');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    show(reason?.message || String(reason) || 'Unhandled promise rejection.');
    event.preventDefault();
  });
})();