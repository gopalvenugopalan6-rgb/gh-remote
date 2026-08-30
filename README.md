# gh-remote

A full-remote web app for **LG UHD AI ThinQ (webOS)** TVs, e.g. the LG 43UR80. It runs a small Node server on your laptop/PC and serves a phone-and-PC-friendly remote UI. The server talks to the TV over LG's webOS WebSocket remote protocol (port **3000**).

## How it works
- The Node server (`server.js`) connects to the TV at `ws://<tv_ip>:3000` and handles the webOS "register"/pairing handshake.
- It saves the TV's `client-key` in `config.json` after the first successful pair, so you don't re-pair every time.
- It serves the UI from `public/` and exposes two JSON APIs:
  - `POST /api/key`  `{ "key": "KEY_VOLUMEUP" }` — send a key press
  - `POST /api/text` `{ "text": "hello" }` — type text (search boxes etc.)
  - `GET  /api/status` — connection status + LAN IPs

## Setup
1. Install Node 16+.
2. `npm install` (pulls in `ws`).
3. **Set your TV's IP** in `config.json` → `tv_ip`. Find it on the TV: **Settings → Network → ... IP address**, or look it up in your router's device list.

## Run
```bash
npm start
```
The server listens on port `3000` of your PC. From any phone or PC **on the same Wi-Fi network**, open:
```
http://<your-pc-ip>:3000
```
(Your PC's IP is shown in the startup log, e.g. `http://192.168.1.74:3000`.)

### First-time pairing
The first time you open the app, the TV screen will show a **prompt to allow/accept** the connection — press *Allow/Yes* on the TV with its physical remote. After that the key is saved and pairing is remembered.

## Current status / TODOs (for the next chat)
- **The TV IP is a placeholder** (`192.168.1.88`) and has NOT been confirmed. A quick scan of `192.168.1.1–254` for open port `3000` found **nothing**, so either:
  - the TV is off, on a different subnet, or
  - the 43UR80 may not expose port 3000 from the default subnet / may need the TV's "mobile/TV remote" (network access) enabled in settings.
- **TODO:** Confirm the real TV IP. Options to try next:
  1. Re-scan after making sure the TV is on and "Allow remote control / network access" is enabled in the TV's settings (Settings → General → Mobile Device Management or similar).
  2. Check your router's DHCP lease list for the TV hostname.
  3. If port 3000 is closed, try the legacy TCP remote protocol on port **8080** (different protocol, not yet implemented).
- **TODO:** The repo is `gh-remote` (private). A collaborator account was requested but the username is unresolved (tried `glitch-dash266`, `glitch-spec226` — both return 404; exact username TBD).

## Key names supported
`KEY_POWER`, `KEY_INPUT`, `KEY_MUTE`, `KEY_HOME`, `KEY_EXIT`, `KEY_MENU`, `KEY_GUIDE`, `KEY_UP/DOWN/LEFT/RIGHT`, `KEY_ENTER`, `KEY_VOLUMEUP/DOWN`, `KEY_CHANNELUP/DOWN`, `KEY_RED/GREEN/YELLOW/BLUE`, `KEY_0`–`KEY_9`, `KEY_INFO`, `KEY_BACK`.