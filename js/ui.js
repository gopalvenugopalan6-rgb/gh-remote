// Small, dumb UI helpers. No TV knowledge lives here on purpose -- app.js owns
// the protocol wiring, this file owns pixels and feedback.

import { store } from './store.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer = null;

export function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (kind ? ` is-${kind}` : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'bad' ? 4200 : 2200);
}

export function buzz(ms = 8) {
  if (!store.get('haptics')) return;
  if (navigator.vibrate) navigator.vibrate(ms);
}

export function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  store.set('theme', name);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    // Read the resolved token so the browser chrome matches the theme instead
    // of staying whatever colour the first paint used.
    const bg = getComputedStyle(document.body).backgroundColor;
    if (bg) meta.setAttribute('content', bg);
  }
  $$('.theme-swatch').forEach((b) => b.classList.toggle('is-active', b.dataset.themeValue === name));
}

export function showPanel(name) {
  $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  $$('.tab').forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', String(active));
  });
}

export function setScreen(which) {
  $('#setup').hidden = which !== 'setup';
  $('#app').hidden = which !== 'app';
}

/**
 * Wire press-and-hold repeat onto any element marked [data-repeat].
 * Fires once immediately, then accelerates -- the way a real remote behaves
 * when you hold volume down.
 */
export function bindRepeat(el, fire) {
  let timer = null;
  let delay = 380;

  const step = () => {
    fire();
    delay = Math.max(90, delay * 0.72);
    timer = setTimeout(step, delay);
  };

  const start = (ev) => {
    if (timer) return;
    ev.preventDefault();
    el.classList.add('is-pressed');
    buzz();
    fire();
    delay = 380;
    timer = setTimeout(step, delay);
  };

  const stop = () => {
    clearTimeout(timer);
    timer = null;
    delay = 380;
    el.classList.remove('is-pressed');
  };

  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('pointerleave', stop);
  // Keyboard users get a plain single fire; holding Enter already repeats.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
  });
}

export function flash(el) {
  el.classList.add('is-pressed');
  setTimeout(() => el.classList.remove('is-pressed'), 110);
}

/** First letters of an app name, for when the TV gives us no usable icon. */
export function initials(name = '?') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
