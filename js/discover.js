// Finding the TV from inside a browser tab.
//
// The honest constraints, because they shape everything here:
//   * SSDP/mDNS are multicast. Page JavaScript cannot send multicast. So the
//     usual "discover the TV" code that a Node server would use is off limits.
//   * The browser will not tell a page its own LAN address any more (the old
//     WebRTC candidate leak is gone in current Chrome/Safari), so we cannot
//     even guess the subnet without asking.
//   * On an https:// page a wss:// handshake to an untrusted self-signed cert
//     fails with the *same* opaque error as a host that does not exist.
//
// What is left is timing. A machine that is listening completes the TCP
// handshake and then rejects the TLS layer -- fast, usually well under a
// second. A dead address never answers at all and we hit our own timeout. So
// "errored quickly" is a decent proxy for "something is listening on 3001".
// It is a heuristic, it is labelled as one in the UI, and the manual IP box is
// always right there next to it.

const FAST_FAIL_MS = 2200;   // errored sooner than this => something answered
const SCAN_TIMEOUT_MS = 3500;
const BATCH_SIZE = 24;       // browsers cap parallel sockets; stay under it

/** Probe one address. Resolves {host, live, ms}. Never rejects. */
export function probe(host, port = 3001, timeout = SCAN_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = performance.now();
    const scheme = String(port) === '3001' ? 'wss' : 'ws';
    let ws;
    let settled = false;

    const done = (live) => {
      if (settled) return;
      settled = true;
      const ms = Math.round(performance.now() - started);
      try { ws && ws.close(); } catch {}
      resolve({ host, port, live, ms });
    };

    try {
      ws = new WebSocket(`${scheme}://${host}:${port}`);
    } catch {
      done(false);
      return;
    }

    const timer = setTimeout(() => done(false), timeout);

    // An actual open is the strongest possible signal (plain ws, or a cert the
    // user already trusted).
    ws.onopen = () => { clearTimeout(timer); done(true); };
    ws.onerror = () => {
      clearTimeout(timer);
      done(performance.now() - started < FAST_FAIL_MS);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      done(performance.now() - started < FAST_FAIL_MS);
    };
  });
}

/**
 * Sweep a /24. `subnet` is the first three octets, e.g. "192.168.1".
 * onProgress({done, total, found}) fires as batches complete.
 */
export async function scanSubnet(subnet, { port = 3001, onProgress, signal } = {}) {
  const hosts = [];
  for (let i = 1; i <= 254; i++) hosts.push(`${subnet}.${i}`);

  const found = [];
  let done = 0;

  for (let i = 0; i < hosts.length; i += BATCH_SIZE) {
    if (signal && signal.aborted) break;
    const batch = hosts.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((h) => probe(h, port)));
    for (const r of results) if (r.live) found.push(r);
    done += batch.length;
    if (onProgress) onProgress({ done, total: hosts.length, found: [...found] });
  }

  // Fastest responder first -- the real TV usually answers quickest.
  return found.sort((a, b) => a.ms - b.ms);
}

/** Guess likely subnets so the scan box is prefilled with something useful. */
export function likelySubnets(lastHost) {
  const guesses = ['192.168.1', '192.168.0', '10.0.0', '192.168.2', '172.20.10'];
  if (lastHost) {
    const base = lastHost.split('.').slice(0, 3).join('.');
    if (base && !guesses.includes(base)) guesses.unshift(base);
    else if (base) {
      guesses.splice(guesses.indexOf(base), 1);
      guesses.unshift(base);
    }
  }
  return guesses;
}

export function isValidHost(value) {
  if (!value) return false;
  const v = value.trim();
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(v)) {
    return v.split('.').every((o) => Number(o) >= 0 && Number(o) <= 255);
  }
  // Allow a hostname too -- some routers give the TV a resolvable name.
  return /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}$/.test(v);
}
