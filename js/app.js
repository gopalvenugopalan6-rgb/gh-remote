import { WebOSTV } from './webos.js';
import { store } from './store.js';
import { scanSubnet, likelySubnets, isValidHost } from './discover.js';
import { $, $$, toast, buzz, applyTheme, showPanel, setScreen, bindRepeat, flash, initials } from './ui.js';

const tv = new WebOSTV();
let apps = [];
let channels = [];
let currentAppId = null;
let liveTyping = false;
let scanAbort = null;

// ─── connection ────────────────────────────────────────────────────────────

function setStatus(state) {
  const dot = $('#status-dot');
  dot.className = 'dot' + (
    state === 'ready' ? ' is-ok' :
    state === 'connecting' || state === 'pairing' ? ' is-busy' :
    state === 'error' ? ' is-bad' : ''
  );
  $('#pairing').hidden = state !== 'pairing';
  $$('#app .key, #app .dkey, #app .rkey, #app .tile, #app .app-tile').forEach((el) => {
    el.toggleAttribute('disabled', state !== 'ready');
  });
}

tv.addEventListener('state', (e) => setStatus(e.detail.state));

tv.addEventListener('clientkey', (e) => {
  store.saveTV(e.detail.host, { clientKey: e.detail.clientKey, port: portOf(tv.endpoint) });
});

tv.addEventListener('disconnected', () => {
  if (tv.state !== 'idle') toast('Lost the TV. Reconnecting…', 'bad');
});

function portOf(endpoint) {
  try { return new URL(endpoint).port; } catch { return ''; }
}

async function connect(host) {
  const saved = store.getTV(host);
  setScreen('app');
  setStatus('connecting');
  $('#tv-name').textContent = (saved && saved.name) || host;
  try {
    await tv.connect(host, { clientKey: saved && saved.clientKey, port: saved && saved.port });
    store.saveTV(host, { port: portOf(tv.endpoint) });
    await afterConnect(host);
  } catch (err) {
    setScreen('setup');
    showConnectError(host, err);
  }
}

function showConnectError(host, err) {
  const box = $('#setup-error');
  box.hidden = false;
  box.textContent = `Could not reach ${host}. ${err.message}`;
  $('#cert-host').textContent = host;
  $('#cert-link').href = `https://${host}:3001`;
  $('#cert-note').open = true;
  $('#host-input').value = host;
}

async function afterConnect(host) {
  toast('Connected');
  buzz(14);
  $('#info-host').textContent = host;
  $('#info-endpoint').textContent = tv.endpoint;
  $('#info-paired').textContent = tv.clientKey ? 'yes' : 'no';

  // Open the pointer socket eagerly: every d-pad button needs it, and doing it
  // lazily means the very first press silently does nothing while it opens.
  tv.openPointer().catch(() => toast('Pointer socket unavailable — buttons may not work', 'bad'));

  subscribeVolume();
  subscribeForegroundApp();
  loadApps();
  loadInputs();
  if (window.matchMedia('(min-width: 900px)').matches) loadChannels();

  tv.softwareInfo()
    .then((info) => {
      const model = info.model_name || info.product_name;
      if (!model) return;
      $('#info-model').textContent = model;
      $('#tv-name').textContent = model;
      store.saveTV(host, { name: model });
    })
    .catch(() => {});
}

// ─── live state ────────────────────────────────────────────────────────────

function subscribeVolume() {
  const apply = (p) => {
    // webOS has shipped two shapes of this payload over the years.
    const v = p.volumeStatus || p;
    const level = v.volume;
    const muted = v.muteStatus ?? v.muted;
    if (typeof level === 'number') {
      const slider = $('#vol-slider');
      if (document.activeElement !== slider) slider.value = level;
      $('#vol-value').textContent = level;
    }
    if (typeof muted === 'boolean') {
      $('#mute-label').textContent = muted ? 'Unmute' : 'Mute';
      $('[data-act="toggleMute"]').classList.toggle('is-pressed', muted);
    }
  };
  try {
    tv.subscribe('ssap://audio/getVolume', apply);
  } catch {
    tv.getVolume().then(apply).catch(() => {});
  }
}

function subscribeForegroundApp() {
  try {
    tv.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo', (p) => {
      currentAppId = p.appId || null;
      updateNowPlaying();
      renderApps();
      if (currentAppId && currentAppId.includes('livetv')) refreshCurrentChannel();
      else $('#now-extra').textContent = '';
    });
  } catch {}
}

// The foreground-app subscription usually fires before the app list has
// arrived, so the label would otherwise be stuck showing a raw id like
// "com.webos.app.livetv". Both paths call this instead.
function updateNowPlaying() {
  const match = apps.find((a) => a.id === currentAppId);
  $('#now-app').textContent = match ? match.title : (currentAppId || 'Home');
}

function refreshCurrentChannel() {
  tv.getCurrentChannel()
    .then((c) => {
      $('#now-extra').textContent = c.channelName
        ? `${c.channelNumber || ''} ${c.channelName}`.trim()
        : '';
    })
    .catch(() => {});
}

// ─── apps ──────────────────────────────────────────────────────────────────

async function loadApps() {
  try {
    const res = await tv.listApps();
    apps = (res.launchPoints || []).map((a) => ({
      id: a.id,
      title: a.title || a.id,
      icon: a.largeIcon || a.icon || '',
    }));
    updateNowPlaying();
    renderApps();
  } catch (err) {
    $('#apps-empty').hidden = false;
    $('#apps-empty').textContent = `Could not load apps: ${err.message}`;
  }
}

function renderApps() {
  const grid = $('#app-grid');
  const term = $('#app-search').value.trim().toLowerCase();
  const favs = store.get('favorites');

  const list = apps
    .filter((a) => !term || a.title.toLowerCase().includes(term))
    .sort((a, b) => {
      const fa = favs.includes(a.id) ? 0 : 1;
      const fb = favs.includes(b.id) ? 0 : 1;
      return fa - fb || a.title.localeCompare(b.title);
    });

  $('#apps-empty').hidden = list.length > 0;
  if (!list.length && apps.length) $('#apps-empty').textContent = 'No app matches that search.';

  grid.replaceChildren(...list.map((app) => {
    const tile = document.createElement('button');
    tile.className = 'app-tile' + (app.id === currentAppId ? ' is-current' : '');
    tile.disabled = tv.state !== 'ready';

    // Icons are served by the TV over plain http. From an https page the
    // browser blocks that as mixed content, so a text fallback is not an
    // edge case here -- it is the normal path.
    if (app.icon && !app.icon.startsWith('http:')) {
      const img = document.createElement('img');
      img.src = app.icon;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.replaceWith(fallbackIcon(app.title));
      tile.append(img);
    } else {
      tile.append(fallbackIcon(app.title));
    }

    const name = document.createElement('span');
    name.className = 'app-name';
    name.textContent = app.title;
    tile.append(name);

    const fav = document.createElement('button');
    fav.className = 'fav-btn' + (favs.includes(app.id) ? ' is-fav' : '');
    fav.innerHTML = '<svg class="ic"><use href="#i-star"/></svg>';
    fav.setAttribute('aria-label', `Pin ${app.title}`);
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      store.toggleFavorite(app.id);
      renderApps();
    });
    tile.append(fav);

    tile.addEventListener('click', () => {
      buzz();
      tv.launchApp(app.id).catch((err) => toast(err.message, 'bad'));
    });
    return tile;
  }));
}

function fallbackIcon(title) {
  const div = document.createElement('div');
  div.className = 'app-icon-fallback';
  div.textContent = initials(title);
  return div;
}

// ─── inputs & channels ─────────────────────────────────────────────────────

async function loadInputs() {
  try {
    const res = await tv.getInputs();
    const list = res.devices || [];
    $('#input-list').replaceChildren(...list.map((input) => {
      const btn = document.createElement('button');
      btn.className = 'tile' + (input.connected === false ? ' is-empty' : '');
      btn.disabled = tv.state !== 'ready';
      btn.innerHTML = '<span class="tile-num"></span><span class="tile-name"></span>';
      // Input ids and labels come off the TV, so they go in as text, never markup.
      btn.querySelector('.tile-num').textContent = String(input.id || '').replace(/_/g, ' ');
      btn.querySelector('.tile-name').textContent =
        input.label + (input.connected === false ? ' · nothing plugged in' : '');
      btn.addEventListener('click', () => {
        buzz();
        tv.switchInput(input.id).catch((err) => toast(err.message, 'bad'));
      });
      return btn;
    }));
  } catch (err) {
    $('#input-list').replaceChildren(emptyRow(`Inputs unavailable: ${err.message}`));
  }
}

async function loadChannels() {
  try {
    const res = await tv.getChannels();
    channels = res.channelList || [];
    renderChannels();
  } catch (err) {
    // A TV with no aerial/cable tuned genuinely has no channel list. That is
    // not a bug to shout about.
    $('#channel-list').replaceChildren(emptyRow('No channel list on this TV.'));
  }
}

function renderChannels() {
  const term = $('#channel-search').value.trim().toLowerCase();
  const list = channels
    .filter((c) => !term || (c.channelName || '').toLowerCase().includes(term) || String(c.channelNumber).startsWith(term))
    .slice(0, 300);

  if (!list.length) {
    $('#channel-list').replaceChildren(emptyRow(channels.length ? 'No channel matches.' : 'No channels tuned.'));
    return;
  }

  $('#channel-list').replaceChildren(...list.map((c) => {
    const btn = document.createElement('button');
    btn.className = 'tile';
    btn.disabled = tv.state !== 'ready';
    btn.innerHTML = '<span class="tile-num"></span><span class="tile-name"></span>';
    btn.querySelector('.tile-num').textContent = c.channelNumber ?? '';
    btn.querySelector('.tile-name').textContent = c.channelName || c.channelId;
    btn.addEventListener('click', () => {
      buzz();
      tv.openChannel(c.channelId).catch((err) => toast(err.message, 'bad'));
    });
    return btn;
  }));
}

function emptyRow(text) {
  const p = document.createElement('p');
  p.className = 'empty-state';
  p.textContent = text;
  return p;
}

// ─── button wiring ─────────────────────────────────────────────────────────

const actions = {
  powerOff: () => tv.powerOff(),
  volumeUp: () => tv.volumeUp(),
  volumeDown: () => tv.volumeDown(),
  channelUp: () => tv.channelUp(),
  channelDown: () => tv.channelDown(),
  click: () => tv.click(),
  play: () => tv.play(),
  pause: () => tv.pause(),
  stop: () => tv.stop(),
  rewind: () => tv.rewind(),
  fastForward: () => tv.fastForward(),
  sendEnter: () => tv.sendEnter(),
  deleteCharacters: () => tv.deleteCharacters(1),
  toggleMute: async () => {
    const muted = $('#mute-label').textContent === 'Unmute';
    await tv.setMute(!muted);
  },
};

function run(promiseFactory) {
  Promise.resolve()
    .then(promiseFactory)
    .catch((err) => toast(err.message || 'Command failed', 'bad'));
}

function wireButtons(root = document) {
  $$('[data-btn]', root).forEach((el) => {
    const name = el.dataset.btn;
    const fire = () => run(() => tv.button(name).catch(() => {
      // Some button names differ across webOS versions; a declared fallback
      // gets one retry before the press is reported as failed.
      if (el.dataset.fallback) return tv.button(el.dataset.fallback);
      throw new Error(`${name} not accepted by this TV`);
    }));
    if (el.hasAttribute('data-repeat')) return bindRepeat(el, fire);
    el.addEventListener('click', () => { buzz(); flash(el); fire(); });
  });

  $$('[data-act]', root).forEach((el) => {
    const act = actions[el.dataset.act];
    if (!act) return;
    const fire = () => {
      if (el.dataset.confirm && !confirm(el.dataset.confirm)) return;
      run(act);
    };
    if (el.hasAttribute('data-repeat')) return bindRepeat(el, fire);
    el.addEventListener('click', () => { buzz(); flash(el); fire(); });
  });
}

// ─── trackpad ──────────────────────────────────────────────────────────────

function wireTrackpad() {
  const pad = $('#trackpad');
  const ripple = $('#trackpad-ripple');
  const pointers = new Map();
  let last = null;
  let startedAt = 0;
  let travelled = 0;
  let scrollAcc = 0;

  const speed = () => store.get('pointerSpeed');

  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      last = { x: e.clientX, y: e.clientY };
      startedAt = performance.now();
      travelled = 0;
      pad.classList.add('is-active');
    }
  });

  pad.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      // Two fingers = scroll. webOS wants discrete notches, not pixels, so
      // accumulate movement and emit one notch per ~28px.
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      scrollAcc += dy;
      const notch = 28;
      while (Math.abs(scrollAcc) >= notch) {
        const dir = scrollAcc > 0 ? 1 : -1;
        scrollAcc -= dir * notch;
        const value = store.get('naturalScroll') ? dir : -dir;
        run(() => tv.scroll(0, value));
      }
      return;
    }

    const dx = Math.round((e.clientX - last.x) * speed());
    const dy = Math.round((e.clientY - last.y) * speed());
    if (dx === 0 && dy === 0) return;
    travelled += Math.abs(dx) + Math.abs(dy);
    last = { x: e.clientX, y: e.clientY };
    run(() => tv.move(dx, dy));
  });

  const release = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size > 0) return;

    pad.classList.remove('is-active');
    scrollAcc = 0;
    const quick = performance.now() - startedAt < 260;
    if (quick && travelled < 12) {
      const rect = pad.getBoundingClientRect();
      ripple.style.left = `${e.clientX - rect.left}px`;
      ripple.style.top = `${e.clientY - rect.top}px`;
      ripple.classList.remove('is-firing');
      void ripple.offsetWidth; // restart the animation
      ripple.classList.add('is-firing');
      buzz(12);
      run(() => tv.click());
    }
  };

  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);

  // Desktop mouse wheel maps straight onto TV scroll.
  pad.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    run(() => tv.scroll(0, store.get('naturalScroll') ? dir : -dir));
  }, { passive: false });

  // Arrow keys work when the pad has focus -- keyboard users are not stuck.
  pad.addEventListener('keydown', (e) => {
    const map = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Enter: 'ENTER', Backspace: 'BACK' };
    if (!map[e.key]) return;
    e.preventDefault();
    run(() => tv.button(map[e.key]));
  });
}

// ─── text input ────────────────────────────────────────────────────────────

function wireTextInput() {
  const input = $('#text-input');
  const toggle = $('#text-live-toggle');

  const send = () => {
    const text = input.value;
    if (!text) return;
    run(async () => {
      await tv.insertText(text);
      input.value = '';
    });
  };

  $('#text-send').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });

  toggle.addEventListener('click', () => {
    liveTyping = !liveTyping;
    toggle.setAttribute('aria-pressed', String(liveTyping));
    toast(liveTyping ? 'Live typing on' : 'Live typing off');
  });

  input.addEventListener('input', () => {
    if (!liveTyping) return;
    const text = input.value;
    // replace:true rewrites the whole field each keystroke, which keeps the
    // TV in sync even when the user edits the middle of what they typed.
    run(() => tv.insertText(text, true));
  });
}

// ─── volume slider ─────────────────────────────────────────────────────────

function wireVolume() {
  const slider = $('#vol-slider');
  let pending = null;
  slider.addEventListener('input', () => {
    $('#vol-value').textContent = slider.value;
    // Dragging a slider fires dozens of events a second; the TV does not need
    // all of them and will fall behind if it gets them.
    clearTimeout(pending);
    pending = setTimeout(() => run(() => tv.setVolume(Number(slider.value))), 110);
  });
}

// ─── setup screen ──────────────────────────────────────────────────────────

function renderKnownTVs() {
  const known = store.knownTVs();
  $('#known-tvs').hidden = known.length === 0;
  $('#known-list').replaceChildren(...known.map((t) => {
    const btn = document.createElement('button');
    btn.className = 'tile';
    btn.innerHTML = '<span class="tile-name"></span><span class="tile-num"></span>';
    btn.querySelector('.tile-name').textContent = t.name || t.host;
    btn.querySelector('.tile-num').textContent = t.host;
    btn.addEventListener('click', () => connect(t.host));
    return btn;
  }));
}

function wireSetup() {
  const hostInput = $('#host-input');
  hostInput.value = store.get('lastHost') || '';

  const go = () => {
    const host = hostInput.value.trim();
    if (!isValidHost(host)) {
      $('#setup-error').hidden = false;
      $('#setup-error').textContent = 'That does not look like an IP address or hostname.';
      return;
    }
    $('#setup-error').hidden = true;
    connect(host);
  };

  $('#connect-btn').addEventListener('click', go);
  hostInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  hostInput.addEventListener('input', () => {
    const v = hostInput.value.trim();
    $('#cert-host').textContent = v || 'TV-IP';
    $('#cert-link').href = `https://${v}:3001`;
  });

  const subnetInput = $('#subnet-input');
  subnetInput.value = store.get('subnet') || likelySubnets(store.get('lastHost'))[0];

  $('#scan-btn').addEventListener('click', async () => {
    const btn = $('#scan-btn');
    if (scanAbort) { scanAbort.abort(); scanAbort = null; btn.textContent = 'Scan'; return; }

    const subnet = subnetInput.value.trim().replace(/\.$/, '');
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(subnet)) {
      toast('Enter the first three parts, like 192.168.1', 'bad');
      return;
    }
    store.set('subnet', subnet);

    scanAbort = new AbortController();
    btn.textContent = 'Stop';
    $('#scan-progress').hidden = false;
    $('#scan-results').replaceChildren();

    const results = await scanSubnet(subnet, {
      signal: scanAbort.signal,
      onProgress: ({ done, total, found }) => {
        $('#scan-bar').style.transform = `scaleX(${done / total})`;
        $('#scan-text').textContent = `${done} of ${total} checked · ${found.length} responding`;
        renderScanResults(found);
      },
    });

    scanAbort = null;
    btn.textContent = 'Scan';
    if (!results.length) {
      $('#scan-text').textContent = 'Nothing answered on port 3001. Is the TV switched on and on this network?';
    }
  });
}

function renderScanResults(found) {
  $('#scan-results').replaceChildren(...found.map((r) => {
    const btn = document.createElement('button');
    btn.className = 'tile';
    btn.innerHTML = '<span class="tile-name"></span><span class="tile-num"></span>';
    btn.querySelector('.tile-name').textContent = r.host;
    btn.querySelector('.tile-num').textContent = `${r.ms}ms`;
    btn.addEventListener('click', () => {
      $('#host-input').value = r.host;
      connect(r.host);
    });
    return btn;
  }));
}

// ─── settings drawer ───────────────────────────────────────────────────────

function wireSettings() {
  const drawer = $('#settings');
  const open = () => {
    drawer.hidden = false;
    $('#opt-haptics').checked = store.get('haptics');
    $('#opt-natural').checked = store.get('naturalScroll');
    $('#opt-speed').value = store.get('pointerSpeed');
  };

  $('#settings-btn').addEventListener('click', open);
  $('#tv-btn').addEventListener('click', open);
  $('#settings-close').addEventListener('click', () => { drawer.hidden = true; });
  drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.hidden = true; });

  $('#opt-haptics').addEventListener('change', (e) => store.set('haptics', e.target.checked));
  $('#opt-natural').addEventListener('change', (e) => store.set('naturalScroll', e.target.checked));
  $('#opt-speed').addEventListener('input', (e) => store.set('pointerSpeed', Number(e.target.value)));

  $$('.theme-swatch').forEach((btn) => {
    btn.addEventListener('click', () => { applyTheme(btn.dataset.themeValue); buzz(); });
  });

  // The palette button cycles, so trying all three is one tap each instead of
  // opening a drawer every time.
  $('#theme-btn').addEventListener('click', () => {
    const order = ['tactile', 'clean', 'panel'];
    const next = order[(order.indexOf(store.get('theme')) + 1) % order.length];
    applyTheme(next);
    toast(`Theme: ${next}`);
  });

  $('#reconnect-btn').addEventListener('click', () => {
    drawer.hidden = true;
    const host = store.get('lastHost');
    if (host) connect(host);
  });

  $('#switch-tv-btn').addEventListener('click', () => {
    drawer.hidden = true;
    tv.disconnect();
    renderKnownTVs();
    setScreen('setup');
  });

  $('#forget-btn').addEventListener('click', () => {
    const host = store.get('lastHost');
    if (!host || !confirm(`Forget ${host}? You will have to pair with the TV again.`)) return;
    store.forgetTV(host);
    tv.disconnect();
    drawer.hidden = true;
    renderKnownTVs();
    setScreen('setup');
  });

  $('#pairing-cancel').addEventListener('click', () => {
    tv.disconnect();
    $('#pairing').hidden = true;
    setScreen('setup');
  });
}

// ─── boot ──────────────────────────────────────────────────────────────────

function wireTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      showPanel(tab.dataset.tab);
      buzz();
      if (tab.dataset.tab === 'sources' && !channels.length) loadChannels();
    });
  });
}

function boot() {
  applyTheme(store.get('theme'));
  wireButtons();
  wireTabs();
  wireTrackpad();
  wireTextInput();
  wireVolume();
  wireSetup();
  wireSettings();
  renderKnownTVs();

  $('#app-search').addEventListener('input', renderApps);
  $('#channel-search').addEventListener('input', renderChannels);
  $('#apps-refresh').addEventListener('click', loadApps);
  $('#inputs-refresh').addEventListener('click', loadInputs);
  $('#channels-refresh').addEventListener('click', loadChannels);

  // On a wide screen every panel is a column, so nothing may stay hidden.
  const wide = window.matchMedia('(min-width: 900px)');
  const syncPanels = () => {
    if (wide.matches) {
      $$('.panel').forEach((p) => { p.hidden = false; });
      // The channel list is lazy because most TVs take a moment to produce it.
      // On a phone the sources tab triggers it; on a wide screen that panel is
      // simply always on screen, so nothing would ever ask for it.
      if (tv.state === 'ready' && !channels.length) loadChannels();
    } else {
      showPanel($('.tab.is-active').dataset.tab);
    }
  };
  wide.addEventListener('change', syncPanels);

  const last = store.get('lastHost');
  const auto = new URLSearchParams(location.search).get('tv') || last;
  if (auto && store.getTV(auto)) connect(auto);
  else setScreen('setup');

  syncPanels();
  setStatus('idle');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();

// Test hook. Kept off the deployed site: the browser tests always run against
// localhost, and a published page has no reason to hand every script on it a
// live handle to the TV connection.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.__ghRemote = { tv, store, connect, get apps() { return apps; } };
}
