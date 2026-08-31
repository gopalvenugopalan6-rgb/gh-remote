// Everything persistent lives in localStorage. There is no server, so this is
// the only storage that exists -- and it is per-device, which is exactly right
// for a client key the TV issued to *this* browser.

const KEY = 'gh-remote.v1';

const DEFAULTS = {
  theme: 'tactile',
  lastHost: '',
  subnet: '192.168.1',
  tvs: {},        // host -> { host, name, port, clientKey, lastSeen }
  favorites: [],  // app ids pinned to the top of the app grid
  haptics: true,
  pointerSpeed: 1.6,
  naturalScroll: true,
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    // Private mode, disabled storage, corrupt JSON -- all mean "use defaults"
    // rather than "break the remote".
    return { ...DEFAULTS };
  }
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
  return state;
}

export const store = {
  get all() { return read(); },

  get(key) { return read()[key]; },

  set(key, value) {
    const state = read();
    state[key] = value;
    return write(state);
  },

  patch(partial) {
    return write({ ...read(), ...partial });
  },

  getTV(host) {
    return read().tvs[host] || null;
  },

  saveTV(host, fields) {
    const state = read();
    state.tvs[host] = { host, ...(state.tvs[host] || {}), ...fields, lastSeen: Date.now() };
    state.lastHost = host;
    return write(state);
  },

  forgetTV(host) {
    const state = read();
    delete state.tvs[host];
    if (state.lastHost === host) state.lastHost = '';
    return write(state);
  },

  knownTVs() {
    return Object.values(read().tvs).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  },

  toggleFavorite(appId) {
    const state = read();
    const i = state.favorites.indexOf(appId);
    if (i === -1) state.favorites.push(appId);
    else state.favorites.splice(i, 1);
    return write(state);
  },
};
