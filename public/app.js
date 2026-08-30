const statusEl = document.getElementById('status');

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

function refreshStatus() {
  fetch('/api/status')
    .then((r) => r.json())
    .then((s) => {
      setStatus(
        s.connected ? 'TV connected' : 'TV offline',
        s.connected ? 'ok' : 'bad'
      );
    })
    .catch(() => setStatus('server offline', 'bad'));
}

function sendKey(key) {
  fetch('/api/key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
    .then((r) => r.json())
    .then((res) => {
      if (!res.ok) setStatus(res.error || 'error', 'bad');
    })
    .catch(() => setStatus('request failed', 'bad'));
}

document.querySelectorAll('[data-key]').forEach((btn) => {
  btn.addEventListener('click', () => sendKey(btn.dataset.key));
});

refreshStatus();
setInterval(refreshStatus, 5000);