// webOS SSAP client that runs in the browser.
//
// Two sockets are involved, and that is the whole trick of this protocol:
//   1. The control socket (wss://tv:3001) does register/pairing and all
//      "ssap://" service calls -- volume, apps, inputs, channels, power.
//   2. The pointer socket, whose URL you have to *ask the control socket for*
//      via ssap://com.webos.service.networkinput/getPointerInputSocket. Button
//      presses (UP/OK/BACK/HOME) and cursor moves go there as newline-delimited
//      text frames, not JSON. Sending button JSON to the control socket does
//      nothing at all, silently.

const REGISTER_MANIFEST = {
  manifestVersion: 1,
  appId: 'com.webos.app.gh-remote',
  vendorId: 'com.gh-remote',
  localizedAppNames: { '': 'gh-remote' },
  permissions: [
    'LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CLOSE', 'TEST_OPEN', 'TEST_PROTECTED',
    'CONTROL_AUDIO', 'CONTROL_DISPLAY', 'CONTROL_INPUT_JOYSTICK',
    'CONTROL_INPUT_MEDIA_RECORDING', 'CONTROL_INPUT_MEDIA_PLAYBACK',
    'CONTROL_INPUT_TV', 'CONTROL_POWER', 'READ_APP_STATUS', 'READ_CURRENT_CHANNEL',
    'READ_INPUT_DEVICE_LIST', 'READ_NETWORK_STATE', 'READ_RUNNING_APPS',
    'READ_TV_CHANNEL_LIST', 'WRITE_NOTIFICATION_TOAST', 'READ_POWER_STATE',
    'READ_COUNTRY_INFO', 'READ_SETTINGS', 'CONTROL_TV_SCREEN', 'CONTROL_TV_STANBY',
    'CONTROL_FAVORITE_GROUP', 'CONTROL_USER_INFO', 'CONTROL_INPUT_TEXT',
    'CONTROL_MOUSE_AND_KEYBOARD', 'READ_INSTALLED_APPS', 'CONTROL_INPUT_MEDIA',
  ],
  signatures: [{
    signatureVersion: 1,
    signature: 'eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsIm' +
      'ail3ZWJvcy5jb20iOiIyMDE0MDcxNyJ9',
  }],
};

// Ordered list of endpoints to try for a bare host. Newer sets (2018+, which
// includes the UR series) answer on 3001 over TLS with a self-signed cert;
// older ones use plain 3000. Trying both means one code path covers every TV.
export function endpointsFor(host, port) {
  if (port) {
    const secure = String(port) === '3001';
    return [`${secure ? 'wss' : 'ws'}://${host}:${port}`];
  }
  // From an https:// page the browser will refuse ws://, so do not waste a
  // 6-second timeout on an endpoint that cannot possibly succeed.
  const httpsPage = typeof location !== 'undefined' && location.protocol === 'https:';
  return httpsPage
    ? [`wss://${host}:3001`]
    : [`wss://${host}:3001`, `ws://${host}:3000`];
}

/** Build one pointer-socket text frame: "type:button\nname:UP\n\n" */
export function pointerFrame(type, payload = {}) {
  const lines = [`type:${type}`];
  for (const [k, v] of Object.entries(payload)) lines.push(`${k}:${v}`);
  return lines.join('\n') + '\n\n';
}

export class WebOSTV extends EventTarget {
  constructor({ connectTimeout = 6000 } = {}) {
    super();
    this.socket = null;
    this.pointer = null;
    this.host = null;
    this.endpoint = null;
    this.clientKey = null;
    this.state = 'idle'; // idle | connecting | pairing | ready | error
    this.connectTimeout = connectTimeout;
    this._seq = 0;
    this._pending = new Map();      // id -> {resolve, reject}
    this._subscriptions = new Map(); // id -> handler
    this._pointerWanted = false;
    this._closedByUs = false;
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  setState(state, detail) {
    this.state = state;
    this.emit('state', { state, ...detail });
  }

  get connected() {
    return this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Try each candidate endpoint in order until one opens and registers.
   * Resolves once the TV has issued (or re-accepted) a client key.
   */
  async connect(host, { port, clientKey } = {}) {
    this.disconnect();
    this._closedByUs = false;
    this.host = host;
    this.clientKey = clientKey || null;

    const candidates = endpointsFor(host, port);
    let lastError = null;

    for (const url of candidates) {
      this.setState('connecting', { endpoint: url });
      try {
        await this._openSocket(url);
        this.endpoint = url;
        return await this._register();
      } catch (err) {
        lastError = err;
      }
    }

    this.setState('error', { error: lastError });
    throw lastError || new Error('Could not reach the TV.');
  }

  _openSocket(url) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }

      // A rejected self-signed certificate and an unreachable host look
      // IDENTICAL to page JavaScript -- the browser refuses to say which.
      // The UI turns this into the "trust the certificate" hint.
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`No answer from ${url} within ${this.connectTimeout}ms`));
      }, this.connectTimeout);

      ws.onopen = () => {
        clearTimeout(timer);
        this.socket = ws;
        ws.onmessage = (ev) => this._onMessage(ev.data);
        ws.onclose = () => this._onClose();
        ws.onerror = () => {};
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Connection to ${url} failed`));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        reject(new Error(`Connection to ${url} closed before it opened`));
      };
    });
  }

  _register() {
    return new Promise((resolve, reject) => {
      const id = `register_${++this._seq}`;
      const payload = {
        forcePairing: false,
        pairingType: 'PROMPT',
        manifest: REGISTER_MANIFEST,
      };
      if (this.clientKey) payload['client-key'] = this.clientKey;

      // Pairing waits on a human pressing Allow with the physical remote, so
      // it gets a much longer leash than the socket handshake did.
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('The TV never confirmed pairing. Accept the prompt on screen and retry.'));
      }, 60000);

      this._pending.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this._send({ id, type: 'register', payload });
    });
  }

  _send(obj) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to the TV.');
    }
    this.socket.send(JSON.stringify(obj));
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'registered') {
      const key = msg.payload && msg.payload['client-key'];
      if (key) {
        this.clientKey = key;
        this.emit('clientkey', { host: this.host, clientKey: key });
      }
      this.setState('ready', { endpoint: this.endpoint });
      const waiter = this._pending.get(msg.id);
      if (waiter) {
        this._pending.delete(msg.id);
        waiter.resolve({ clientKey: key, endpoint: this.endpoint });
      }
      if (this._pointerWanted) this.openPointer().catch(() => {});
      return;
    }

    // A plain "response" to the register id means the TV is showing the
    // Allow/Deny prompt; the real answer arrives later as "registered".
    if (msg.type === 'response' && String(msg.id).startsWith('register_')) {
      if (msg.payload && msg.payload.pairingType) this.setState('pairing', {});
      return;
    }

    const sub = this._subscriptions.get(msg.id);
    if (sub) {
      sub(msg.payload || {}, msg);
      return;
    }

    const waiter = this._pending.get(msg.id);
    if (!waiter) return;
    this._pending.delete(msg.id);

    if (msg.type === 'error' || (msg.payload && msg.payload.returnValue === false)) {
      waiter.reject(new Error(msg.error || (msg.payload && msg.payload.errorText) || 'TV rejected the request'));
    } else {
      waiter.resolve(msg.payload || {});
    }
  }

  _onClose() {
    const wasReady = this.state === 'ready';
    this.socket = null;
    this._closePointer();
    for (const [, waiter] of this._pending) waiter.reject(new Error('Connection closed'));
    this._pending.clear();
    this._subscriptions.clear();
    if (!this._closedByUs) this.setState(wasReady ? 'idle' : this.state, { dropped: true });
    this.emit('disconnected', {});
  }

  disconnect() {
    this._closedByUs = true;
    this._closePointer();
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
    this.setState('idle', {});
  }

  /** One-shot SSAP call. */
  request(uri, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = `req_${++this._seq}`;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Timed out: ${uri}`));
      }, 10000);
      this._pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this._send({ id, type: 'request', uri, payload });
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  /** Standing subscription -- handler fires on every update the TV pushes. */
  subscribe(uri, handler, payload = {}) {
    const id = `sub_${++this._seq}`;
    this._subscriptions.set(id, handler);
    this._send({ id, type: 'subscribe', uri, payload });
    return () => {
      this._subscriptions.delete(id);
      try { this._send({ id, type: 'unsubscribe' }); } catch {}
    };
  }

  // --- pointer socket ------------------------------------------------------

  async openPointer() {
    this._pointerWanted = true;
    if (this.pointer && this.pointer.readyState === WebSocket.OPEN) return this.pointer;
    const res = await this.request('ssap://com.webos.service.networkinput/getPointerInputSocket');
    if (!res.socketPath) throw new Error('TV did not return a pointer socket path');
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(res.socketPath);
      const timer = setTimeout(() => { ws.close(); reject(new Error('Pointer socket timed out')); }, this.connectTimeout);
      ws.onopen = () => {
        clearTimeout(timer);
        this.pointer = ws;
        this.emit('pointer', { open: true });
        resolve(ws);
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Pointer socket failed')); };
      ws.onclose = () => { if (this.pointer === ws) { this.pointer = null; this.emit('pointer', { open: false }); } };
    });
  }

  _closePointer() {
    if (this.pointer) {
      try { this.pointer.close(); } catch {}
      this.pointer = null;
    }
  }

  async _pointerSend(type, payload) {
    const ws = this.pointer && this.pointer.readyState === WebSocket.OPEN
      ? this.pointer
      : await this.openPointer();
    ws.send(pointerFrame(type, payload));
  }

  button(name) { return this._pointerSend('button', { name }); }
  click() { return this._pointerSend('click'); }
  move(dx, dy, drag = false) { return this._pointerSend('move', { dx, dy, down: drag ? 1 : 0 }); }
  scroll(dx, dy) { return this._pointerSend('scroll', { dx, dy }); }

  // --- high level commands -------------------------------------------------

  volumeUp() { return this.request('ssap://audio/volumeUp'); }
  volumeDown() { return this.request('ssap://audio/volumeDown'); }
  setVolume(volume) { return this.request('ssap://audio/setVolume', { volume }); }
  setMute(mute) { return this.request('ssap://audio/setMute', { mute }); }
  getVolume() { return this.request('ssap://audio/getVolume'); }

  channelUp() { return this.request('ssap://tv/channelUp'); }
  channelDown() { return this.request('ssap://tv/channelDown'); }
  getChannels() { return this.request('ssap://tv/getChannelList'); }
  openChannel(channelId) { return this.request('ssap://tv/openChannel', { channelId }); }
  getCurrentChannel() { return this.request('ssap://tv/getCurrentChannel'); }

  getInputs() { return this.request('ssap://tv/getExternalInputList'); }
  switchInput(inputId) { return this.request('ssap://tv/switchInput', { inputId }); }

  listApps() { return this.request('ssap://com.webos.applicationManager/listLaunchPoints'); }
  launchApp(id, params) { return this.request('ssap://system.launcher/launch', params ? { id, params } : { id }); }
  closeApp(id) { return this.request('ssap://system.launcher/close', { id }); }
  getForegroundApp() { return this.request('ssap://com.webos.applicationManager/getForegroundAppInfo'); }

  play() { return this.request('ssap://media.controls/play'); }
  pause() { return this.request('ssap://media.controls/pause'); }
  stop() { return this.request('ssap://media.controls/stop'); }
  rewind() { return this.request('ssap://media.controls/rewind'); }
  fastForward() { return this.request('ssap://media.controls/fastForward'); }

  insertText(text, replace = false) {
    return this.request('ssap://com.webos.service.ime/insertText', { text, replace });
  }
  sendEnter() { return this.request('ssap://com.webos.service.ime/sendEnterKey'); }
  deleteCharacters(count = 1) {
    return this.request('ssap://com.webos.service.ime/deleteCharacters', { count });
  }

  // Power OFF works. Power ON does not and cannot: waking a TV needs a
  // Wake-on-LAN magic packet over UDP, and browsers cannot send UDP.
  powerOff() { return this.request('ssap://system/turnOff'); }
  turnOffScreen() { return this.request('ssap://com.webos.service.tvpower/power/turnOffScreen'); }

  toast(message) { return this.request('ssap://system.notifications/createToast', { message }); }
  systemInfo() { return this.request('ssap://system/getSystemInfo'); }
  softwareInfo() { return this.request('ssap://com.webos.service.update/getCurrentSWInformation'); }
}
