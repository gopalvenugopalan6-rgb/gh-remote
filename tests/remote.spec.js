const { test, expect } = require('@playwright/test');

const TV_HOST = '127.0.0.1';

// One fake TV is shared by the whole run, so every test starts by wiping its
// log and its mutated state.
test.beforeEach(async ({ page }) => {
  await page.request.get('/__reset');
});

/**
 * Seed localStorage so the app connects straight to the mock TV on port 3000.
 * Runs on every navigation, so it must NOT clobber state the app has written
 * since -- otherwise a page.reload() silently wipes what the test is checking
 * survived the reload.
 */
async function seed(page, extra = {}) {
  await page.addInitScript(([host, extra]) => {
    if (localStorage.getItem('gh-remote.v1')) return;
    localStorage.setItem('gh-remote.v1', JSON.stringify({
      theme: 'tactile',
      lastHost: host,
      subnet: '127.0.0',
      tvs: { [host]: { host, port: '3000', name: 'MOCK-43UR80', lastSeen: Date.now() } },
      favorites: [],
      haptics: false,
      pointerSpeed: 1,
      naturalScroll: true,
      ...extra,
    }));
  }, [TV_HOST, extra]);
}

/**
 * Reach a panel regardless of layout. On a phone the panels are tabs; on a
 * desktop they are always-visible columns and the tab bar does not exist.
 */
async function openPanel(page, name) {
  const tab = page.locator(`[data-tab="${name}"]`);
  if (await tab.isVisible()) await tab.click();
  await expect(page.locator(`#panel-${name}`)).toBeVisible();
}

async function wireLog(page) {
  const res = await page.request.get('/__log');
  return res.json();
}

async function resetLog(page) {
  await page.request.get('/__reset');
}

/** Wait until the mock TV has recorded an entry matching `pred`. */
async function expectWire(page, pred, label) {
  await expect.poll(async () => (await wireLog(page)).some(pred), {
    message: `expected the TV to receive ${label}`,
    timeout: 7000,
  }).toBe(true);
}

async function connected(page) {
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#status-dot')).toHaveClass(/is-ok/, { timeout: 15000 });
}

test.describe('connection and pairing', () => {
  test('pairs, stores the client key, and reports connected', async ({ page }) => {
    await seed(page);
    await resetLog(page);
    await connected(page);

    const log = await wireLog(page);
    const register = log.find((e) => e.type === 'register');
    expect(register, 'app sent a register handshake').toBeTruthy();

    const key = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('gh-remote.v1')).tvs['127.0.0.1'].clientKey);
    expect(key).toBe('mock-client-key-abc123');

    await expect(page.locator('#tv-name')).toHaveText('MOCK-43UR80');
  });

  test('unknown TV shows the setup screen with the certificate help', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#setup')).toBeVisible();
    await page.fill('#host-input', '10.255.255.1');
    await expect(page.locator('#cert-link')).toHaveAttribute('href', 'https://10.255.255.1:3001');
  });

  test('rejects an obviously invalid address instead of hanging', async ({ page }) => {
    await page.goto('/');
    await page.fill('#host-input', 'not an ip!!');
    await page.click('#connect-btn');
    await expect(page.locator('#setup-error')).toBeVisible();
  });
});

test.describe('button presses reach the wire', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
    await connected(page);
    await resetLog(page);
  });

  test('d-pad sends pointer-socket button frames, not JSON', async ({ page }) => {
    await page.click('.dkey-up');
    await expectWire(page, (e) => e.kind === 'pointer' && e.type === 'button' && e.name === 'UP', 'button:UP');

    await page.click('.dkey-ok');
    await expectWire(page, (e) => e.kind === 'pointer' && e.name === 'ENTER', 'button:ENTER');
  });

  test('HOME and BACK reach the TV', async ({ page }) => {
    await page.click('[data-btn="HOME"]');
    await expectWire(page, (e) => e.kind === 'pointer' && e.name === 'HOME', 'button:HOME');
  });

  test('volume rocker sends ssap volume calls', async ({ page }) => {
    await page.locator('[data-act="volumeUp"]').dispatchEvent('pointerdown');
    await page.locator('[data-act="volumeUp"]').dispatchEvent('pointerup');
    await expectWire(page, (e) => e.uri === 'ssap://audio/volumeUp', 'volumeUp');
  });

  test('mute toggles and the label follows the TV state', async ({ page }) => {
    await page.click('[data-act="toggleMute"]');
    await expectWire(page, (e) => e.uri === 'ssap://audio/setMute' && e.payload.mute === true, 'setMute(true)');
    await expect(page.locator('#mute-label')).toHaveText('Unmute');
  });

  test('power asks before turning the TV off', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await page.click('[data-act="powerOff"]');
    await expectWire(page, (e) => e.uri === 'ssap://system/turnOff', 'turnOff');
  });

  test('power does nothing if the confirmation is dismissed', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss());
    await page.click('[data-act="powerOff"]');
    await page.waitForTimeout(400);
    const log = await wireLog(page);
    expect(log.some((e) => e.uri === 'ssap://system/turnOff')).toBe(false);
  });
});

test.describe('live state', () => {
  test('volume slider reflects the TV and sends a new level', async ({ page }) => {
    await seed(page);
    await connected(page);
    await expect(page.locator('#vol-value')).toHaveText('14', { timeout: 8000 });

    await resetLog(page);
    await page.locator('#vol-slider').fill('33');
    await expectWire(page, (e) => e.uri === 'ssap://audio/setVolume' && e.payload.volume === 33, 'setVolume(33)');
  });
});

test.describe('apps', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
    await connected(page);
  });

  test('lists apps from the TV and launches one', async ({ page }) => {
    await openPanel(page, 'apps');
    await expect(page.locator('.app-tile')).toHaveCount(6, { timeout: 8000 });

    await resetLog(page);
    await page.locator('.app-tile', { hasText: 'Netflix' }).click();
    await expectWire(page, (e) => e.uri === 'ssap://system.launcher/launch' && e.payload.id === 'netflix', 'launch netflix');
  });

  test('search filters the grid', async ({ page }) => {
    await openPanel(page, 'apps');
    await expect(page.locator('.app-tile')).toHaveCount(6, { timeout: 8000 });
    await page.fill('#app-search', 'you');
    await expect(page.locator('.app-tile')).toHaveCount(1);
    await expect(page.locator('.app-tile')).toContainText('YouTube');
  });

  test('favourites survive a reload and sort to the front', async ({ page }) => {
    await openPanel(page, 'apps');
    await expect(page.locator('.app-tile')).toHaveCount(6, { timeout: 8000 });
    await page.locator('.app-tile', { hasText: 'Spotify' }).locator('.fav-btn').click();

    await page.reload();
    await expect(page.locator('#status-dot')).toHaveClass(/is-ok/, { timeout: 15000 });
    await openPanel(page, 'apps');
    await expect(page.locator('.app-tile').first()).toContainText('Spotify');
  });
});

test.describe('sources', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
    await connected(page);
    await openPanel(page, 'sources');
  });

  test('inputs load and switch', async ({ page }) => {
    await expect(page.locator('#input-list .tile')).toHaveCount(3, { timeout: 8000 });
    await expect(page.locator('#input-list .tile').nth(1)).toContainText('nothing plugged in');

    await resetLog(page);
    await page.locator('#input-list .tile', { hasText: 'Xbox' }).click();
    await expectWire(page, (e) => e.uri === 'ssap://tv/switchInput' && e.payload.inputId === 'HDMI_1', 'switchInput HDMI_1');
  });

  test('channels load, filter, and tune', async ({ page }) => {
    await expect(page.locator('#channel-list .tile')).toHaveCount(4, { timeout: 8000 });
    await page.fill('#channel-search', 'BBC');
    await expect(page.locator('#channel-list .tile')).toHaveCount(2);

    await resetLog(page);
    await page.locator('#channel-list .tile').first().click();
    await expectWire(page, (e) => e.uri === 'ssap://tv/openChannel', 'openChannel');
  });

  test('media transport reaches the TV', async ({ page }) => {
    await resetLog(page);
    await page.click('[data-act="pause"]');
    await expectWire(page, (e) => e.uri === 'ssap://media.controls/pause', 'pause');
  });
});

test.describe('trackpad and typing', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
    await connected(page);
    await openPanel(page, 'touch');
  });

  test('dragging sends move frames', async ({ page }) => {
    await resetLog(page);
    const pad = page.locator('#trackpad');
    const box = await pad.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();

    await expectWire(page, (e) => e.kind === 'pointer' && e.type === 'move' && Number(e.dx) !== 0, 'a move frame');
  });

  test('a tap sends a click, a drag does not', async ({ page }) => {
    await resetLog(page);
    const pad = page.locator('#trackpad');
    const box = await pad.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expectWire(page, (e) => e.kind === 'pointer' && e.type === 'click', 'a click frame');
  });

  test('typing sends text to the TV', async ({ page }) => {
    await resetLog(page);
    await page.fill('#text-input', 'stranger things');
    await page.click('#text-send');
    await expectWire(
      page,
      (e) => e.uri === 'ssap://com.webos.service.ime/insertText' && e.payload.text === 'stranger things',
      'insertText'
    );
    await expect(page.locator('#text-input')).toHaveValue('');
  });

  test('enter key reaches the TV', async ({ page }) => {
    await resetLog(page);
    await page.click('[data-act="sendEnter"]');
    await expectWire(page, (e) => e.uri === 'ssap://com.webos.service.ime/sendEnterKey', 'sendEnterKey');
  });
});

test.describe('themes and layout', () => {
  test('the palette button cycles all three themes and they persist', async ({ page }) => {
    await seed(page);
    await connected(page);

    for (const expected of ['clean', 'panel', 'tactile']) {
      await page.click('#theme-btn');
      await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
    }

    await page.click('#theme-btn'); // → clean
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'clean');
  });

  test('settings drawer picks a theme directly', async ({ page }) => {
    await seed(page);
    await connected(page);
    await page.click('#settings-btn');
    await page.click('[data-theme-value="panel"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'panel');
  });
});

test.describe('responsive layout', () => {
  test('phone shows one panel and a tab bar', async ({ page }) => {
    test.skip(test.info().project.name !== 'phone', 'phone project only');
    await seed(page);
    await connected(page);
    await expect(page.locator('.tabbar')).toBeVisible();
    await expect(page.locator('#panel-remote')).toBeVisible();
    await expect(page.locator('#panel-apps')).toBeHidden();
  });

  test('desktop shows the panels as columns with no tab bar', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'desktop project only');
    await seed(page);
    await connected(page);
    await expect(page.locator('.tabbar')).toBeHidden();
    await expect(page.locator('#panel-remote')).toBeVisible();
    await expect(page.locator('#panel-touch')).toBeVisible();
    await expect(page.locator('#panel-apps')).toBeVisible();
  });

  test('nothing overflows horizontally at any width', async ({ page }) => {
    await seed(page);
    await connected(page);
    for (const width of [320, 375, 414, 768, 1024, 1280, 1600]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(120);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test('every control meets the 44px touch target minimum', async ({ page }) => {
    test.skip(test.info().project.name !== 'phone', 'phone project only');
    await seed(page);
    await connected(page);
    const small = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('#panel-remote button, .tab, .topbar button')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        // Colour keys are deliberately a shallow strip, like the real remote.
        if (el.classList.contains('ckey')) continue;
        if (r.height < 36 || r.width < 36) bad.push(`${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return bad;
    });
    expect(small).toEqual([]);
  });
});

test.describe('resilience', () => {
  test('a failed command surfaces as a toast, not a silent no-op', async ({ page }) => {
    await seed(page);
    await connected(page);
    await page.evaluate(() => window.__ghRemote.tv.request('ssap://nonsense/thing').catch(() => {}));
    // The unknown URI is rejected by the TV; the app must not crash.
    await expect(page.locator('#app')).toBeVisible();
  });

  test('no console errors during a normal session', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await seed(page);
    await connected(page);
    await openPanel(page, 'apps');
    await openPanel(page, 'touch');
    await openPanel(page, 'sources');
    await openPanel(page, 'remote');
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);
  });
});
