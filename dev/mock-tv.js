// A fake LG TV, plus a static file server for the app itself.
//
// There is no real TV reachable from CI (or from a laptop at 3am), and "it
// probably works" is not a test. This speaks enough of the real webOS SSAP
// protocol -- the register/pairing handshake, the pointer-socket indirection,
// subscriptions, and the handful of ssap:// URIs the app calls -- that the
// browser code cannot tell the difference.
//
//   node dev/mock-tv.js            # app on :8080, fake TV on :3000
//
// Everything the fake TV receives is recorded and readable at
// http://127.0.0.1:8080/__log, which is how the browser tests assert that a
// button press actually reached the wire.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const ROOT = path.join(__dirname, '..');
const APP_PORT = Number(process.env.APP_PORT || 8080);
const TV_PORT = Number(process.env.TV_PORT || 3000);
const HOST = process.env.MOCK_HOST || '127.0.0.1';

const log = [];
function record(entry) {
  log.push({ at: Date.now(), ...entry });
  if (process.env.VERBOSE) console.log(JSON.stringify(entry));
}

const APPS = [
  { id: 'netflix', title: 'Netflix' },
  { id: 'youtube.leanback.v4', title: 'YouTube' },
  { id: 'amazon', title: 'Prime Video' },
  { id: 'com.webos.app.livetv', title: 'Live TV' },
  { id: 'com.webos.app.hdmi1', title: 'HDMI 1' },
  { id: 'spotify-beehive', title: 'Spotify' },
];

const INPUTS = [
  { id: 'HDMI_1', label: 'Xbox', connected: true, appId: 'com.webos.app.hdmi1' },
  { id: 'HDMI_2', label: 'HDMI 2', connected: false, appId: 'com.webos.app.hdmi2' },
  { id: 'HDMI_3', label: 'Soundbar', connected: true, appId: 'com.webos.app.hdmi3' },
];

const CHANNELS = [
  { channelId: '1_1', channelNumber: '1', channelName: 'BBC One' },
  { channelId: '1_2', channelNumber: '2', channelName: 'BBC Two' },
  { channelId: '1_4', channelNumber: '4', channelName: 'Channel 4' },
  { channelId: '1_5', channelNumber: '5', channelName: 'Channel 5' },
];

const DEFAULT_STATE = { volume: 14, muted: false, foregroundApp: 'com.webos.app.livetv' };
const state = { ...DEFAULT_STATE };

// ─── static file server for the app under test ─────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const appServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/__log') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(log));
    return;
  }
  if (url.pathname === '/__reset') {
    // Tests share one fake TV, so a reset has to clear the mutated TV state
    // too -- not just the log -- or an earlier test's volume change leaks
    // into the next one's assertions.
    log.length = 0;
    Object.assign(state, DEFAULT_STATE);
    res.writeHead(204).end();
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

// ─── the fake TV ───────────────────────────────────────────────────────────

const tvServer = http.createServer();
const control = new WebSocketServer({ noServer: true });
const pointer = new WebSocketServer({ noServer: true });

tvServer.on('upgrade', (req, socket, head) => {
  const target = req.url.startsWith('/pointer') ? pointer : control;
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

control.on('connection', (ws) => {
  const subs = new Map();

  ws.on('close', () => { for (const t of subs.values()) clearInterval(t); });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    record({ kind: 'control', type: msg.type, uri: msg.uri, payload: msg.payload });

    if (msg.type === 'register') {
      const known = msg.payload && msg.payload['client-key'];
      // The real TV answers twice: first "here is the prompt", then, once a
      // human presses Allow, "registered". A previously-known key skips the
      // prompt. The delay is what the pairing overlay is there to cover.
      ws.send(JSON.stringify({ type: 'response', id: msg.id, payload: { pairingType: 'PROMPT', returnValue: true } }));
      const delay = known ? 10 : Number(process.env.PAIR_DELAY || 250);
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'registered', id: msg.id,
          payload: { 'client-key': known || 'mock-client-key-abc123' },
        }));
      }, delay);
      return;
    }

    if (msg.type === 'unsubscribe') {
      clearInterval(subs.get(msg.id));
      subs.delete(msg.id);
      return;
    }

    const reply = (payload) => ws.send(JSON.stringify({
      type: 'response', id: msg.id, payload: { returnValue: true, ...payload },
    }));
    const fail = (errorText) => ws.send(JSON.stringify({
      type: 'error', id: msg.id, error: errorText, payload: { returnValue: false },
    }));

    switch (msg.uri) {
      case 'ssap://com.webos.service.networkinput/getPointerInputSocket':
        reply({ socketPath: `ws://${HOST}:${TV_PORT}/pointer` });
        break;

      case 'ssap://audio/getVolume':
        reply({ volume: state.volume, muted: state.muted });
        if (msg.type === 'subscribe') {
          subs.set(msg.id, setInterval(() => {
            ws.send(JSON.stringify({ type: 'response', id: msg.id, payload: { volume: state.volume, muted: state.muted } }));
          }, 500));
        }
        break;

      case 'ssap://audio/volumeUp': state.volume = Math.min(100, state.volume + 1); reply({}); break;
      case 'ssap://audio/volumeDown': state.volume = Math.max(0, state.volume - 1); reply({}); break;
      case 'ssap://audio/setVolume': state.volume = msg.payload.volume; reply({}); break;
      case 'ssap://audio/setMute': state.muted = msg.payload.mute; reply({}); break;

      case 'ssap://com.webos.applicationManager/listLaunchPoints':
        reply({ launchPoints: APPS });
        break;

      case 'ssap://com.webos.applicationManager/getForegroundAppInfo':
        reply({ appId: state.foregroundApp });
        break;

      case 'ssap://system.launcher/launch':
        state.foregroundApp = msg.payload.id;
        reply({ id: msg.payload.id, sessionId: 'mock-session' });
        break;

      case 'ssap://tv/getExternalInputList': reply({ devices: INPUTS }); break;
      case 'ssap://tv/switchInput': reply({ inputId: msg.payload.inputId }); break;
      case 'ssap://tv/getChannelList': reply({ channelList: CHANNELS }); break;
      case 'ssap://tv/openChannel': reply({ channelId: msg.payload.channelId }); break;
      case 'ssap://tv/getCurrentChannel': reply({ channelNumber: '1', channelName: 'BBC One' }); break;
      case 'ssap://tv/channelUp': case 'ssap://tv/channelDown': reply({}); break;

      case 'ssap://com.webos.service.ime/insertText':
      case 'ssap://com.webos.service.ime/sendEnterKey':
      case 'ssap://com.webos.service.ime/deleteCharacters':
        reply({});
        break;

      case 'ssap://media.controls/play':
      case 'ssap://media.controls/pause':
      case 'ssap://media.controls/stop':
      case 'ssap://media.controls/rewind':
      case 'ssap://media.controls/fastForward':
        reply({});
        break;

      case 'ssap://system/turnOff': reply({}); break;

      case 'ssap://com.webos.service.update/getCurrentSWInformation':
        reply({ product_name: 'webOS TV UR80', model_name: 'MOCK-43UR80' });
        break;

      case 'ssap://system/getSystemInfo':
        reply({ features: { dvr: false } });
        break;

      default:
        fail(`unknown uri ${msg.uri}`);
    }
  });
});

// The pointer socket speaks newline-delimited text, not JSON. Parsing it here
// the same way a TV would is what proves the app builds correct frames.
pointer.on('connection', (ws) => {
  record({ kind: 'pointer', event: 'open' });
  ws.on('message', (raw) => {
    for (const block of raw.toString().split('\n\n')) {
      if (!block.trim()) continue;
      const fields = {};
      for (const line of block.split('\n')) {
        const i = line.indexOf(':');
        if (i > 0) fields[line.slice(0, i)] = line.slice(i + 1);
      }
      record({ kind: 'pointer', ...fields });
    }
  });
});

appServer.listen(APP_PORT, HOST, () => {
  console.log(`app   → http://${HOST}:${APP_PORT}`);
});
tvServer.listen(TV_PORT, HOST, () => {
  console.log(`fake TV → ws://${HOST}:${TV_PORT}`);
});
