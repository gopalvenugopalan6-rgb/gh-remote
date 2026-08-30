const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

const config = loadConfig();

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || config.port || '3000', 10);
const TV_IP = process.env.TV_IP || config.tv_ip || '';

let tvSocket = null;
let clientKey = null;
let connectAttempt = 0;
const connectTimeout = null;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function connectToTV() {
  if (!TV_IP) {
    log('TV IP not set. Edit config.json (tv_ip) or set TV_IP env.');
    return;
  }
  const url = `ws://${TV_IP}:3000`;
  log('Connecting to TV:', url);
  const ws = new WebSocket(url);

  ws.on('open', () => {
    connectAttempt = 0;
    log('Connected. Sending register...');
    sendRegister(ws);
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    handleMessage(ws, msg);
  });

  ws.on('error', (err) => {
    log('WebSocket error:', err.message);
    tvSocket = null;
  });

  ws.on('close', () => {
    log('Connection closed. Reconnecting in 5s...');
    tvSocket = null;
    setTimeout(connectToTV, 5000);
  });

  tvSocket = ws;
}

function sendRegister(ws) {
  const payload = {
    id: 'register',
    type: 'register',
    payload: {
      'client-key': clientKey || null,
      'pairing-key': null,
      'force-pairing': !clientKey,
      manifest: {
        manifestVersion: 1,
        appId: 'com.webos.app.gh-remote',
        permissions: [
          'LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'NETWORK', 'CONTROL_INPUT_TEXT',
          'CONTROL_MOUSE_AND_KEYBOARD', 'READ_INSTALLED_APPS', 'READ_SETTINGS',
          'READ_INPUT_DEVICE_LIST', 'READ_NETWORK_STATE', 'READ_TV_CHANNEL_LIST',
          'WRITE_RF_CHANNEL', 'READ_CURRENT_CHANNEL', 'READ_RUNNING_APPS',
          'READ_POWER_STATE', 'WRITE_POWER_STATE', 'READ_NOTIFICATIONS',
          'CONTROL_POWER', 'CONTROL_AUDIO', 'CONTROL_INPUT', 'CONTROL_INPUT_MEDIA_PLAYBACK',
          'CONTROL_POWER_STATE', 'CONTROL_TV_SCREEN', 'WEBOS_NOTIFICATION_PLAY',
          'WEBOS_VIEW_LOG', 'READ_TV_CURRENT_TIME', 'CONTROL_MEDIA_PLAYBACK',
        ],
        signatures: [],
        version: '1.0.0',
      },
    },
  };
  ws.send(JSON.stringify(payload));
}

function handleMessage(ws, msg) {
  if (msg.type === 'response') {
    if (msg.id === 'register' && msg.payload) {
      const p = msg.payload;
      if (p['client-key']) {
        clientKey = p['client-key'];
        config.client_key = clientKey;
        try {
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        } catch {}
        log('Paired. Client key saved.');
      }
      if (p['pairing-type']) {
        log('PAIRING REQUIRED: Accept the prompt on the TV screen.');
      }
    }
  }
}

function sendKey(key) {
  if (!tvSocket || tvSocket.readyState !== WebSocket.OPEN) {
    return { ok: false, error: 'Not connected to TV. Check config.json tv_ip and accept pairing.' };
  }
  const msg = {
    id: `key_${Date.now()}`,
    type: 'request',
    uri: 'ssap://com.webos.service.networkinput/insert_1q',
    payload: { type: 'key', value: key },
  };
  tvSocket.send(JSON.stringify(msg));
  return { ok: true, sent: key };
}

function sendText(text) {
  if (!tvSocket || tvSocket.readyState !== WebSocket.OPEN) {
    return { ok: false, error: 'Not connected to TV.' };
  }
  for (const ch of text) {
    const msg = {
      id: `text_${Date.now()}_${ch}`,
      type: 'request',
      uri: 'ssap://com.webos.service.networkinput/insert_1q',
      payload: { type: 'text', value: ch },
    };
    tvSocket.send(JSON.stringify(msg));
  }
  return { ok: true, text };
}

const STATIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(STATIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function lanIPs() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: !!(tvSocket && tvSocket.readyState === WebSocket.OPEN),
      tv_ip: TV_IP,
      client_key_saved: !!clientKey,
      lan_ips: lanIPs(),
      port: PORT,
    }));
    return;
  }

  if (req.method === 'POST' && p === '/api/key') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let key;
      try {
        key = JSON.parse(body).key;
      } catch {
        res.writeHead(400);
        res.end('bad request');
        return;
      }
      const result = sendKey(key);
      res.writeHead(result.ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (req.method === 'POST' && p === '/api/text') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let text;
      try {
        text = JSON.parse(body).text;
      } catch {
        res.writeHead(400);
        res.end('bad request');
        return;
      }
      const result = sendText(text);
      res.writeHead(result.ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  serveStatic(res, p);
});

server.listen(PORT, HOST, () => {
  log(`Server running at http://0.0.0.0:${PORT}`);
  log(`From your phone/PC on the same network, open: http://${lanIPs()[0] || '<your-ip>'}:${PORT}`);
  connectToTV();
});