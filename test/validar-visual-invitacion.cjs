const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');

const bundle = path.resolve(__dirname, '../frontend/dist/equinox/browser');
const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(fs.existsSync);

const outDir = path.resolve(__dirname, '../docs/evidencias/invitacion');
fs.mkdirSync(outDir, { recursive: true });

const fixtureGeneral = {
  correoEnmascarado: 'lo***@gmail.com',
  rol: 'TITULAR',
  expiraEn: '2099-01-01T00:00:00Z',
  cliente: { nombre: 'lolo', empresa: null },
  organizacion: { nombre: 'Jose FOTOS', logoUrl: null, tipoFreelance: 'GENERAL' },
  esUsuarioExistente: false
};

const fixtureFotografia = {
  correoEnmascarado: 'cliente***@estudiofoto.com',
  rol: 'TITULAR',
  expiraEn: '2099-01-01T00:00:00Z',
  cliente: { nombre: 'María González', empresa: 'Boutique Floral' },
  organizacion: { nombre: 'Luz & Arte Fotografía', logoUrl: null, tipoFreelance: 'FOTOGRAFIA' },
  esUsuarioExistente: false
};

let server, origin, browser, socket, sessionId, profile;
let sequence = 0;
const commands = new Map();
let currentFixture = fixtureGeneral;

const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence;
  commands.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});

const evaluate = async (expression, awaitPromise = false) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error('Error evaluando DOM: ' + JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
};

const waitDOM = (condition, timeoutMs = 4000) => evaluate(`new Promise((resolve, reject) => {
  const ok = () => { try { return !!(${condition}); } catch { return false; } };
  if (ok()) { resolve(true); return; }
  const observer = new MutationObserver(() => {
    if (ok()) { observer.disconnect(); clearTimeout(deadline); resolve(true); }
  });
  const deadline = setTimeout(() => { observer.disconnect(); reject(new Error('DOM timeout: ' + ${JSON.stringify(condition)})); }, ${timeoutMs});
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
})`, true);

async function screenshot(filename) {
  await evaluate(`Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect.getComputedTiming().iterations)).map(a => a.finished.catch(() => {})))`, true);
  const result = await send('Page.captureScreenshot', { format: 'png' });
  const targetPath = path.join(outDir, filename);
  fs.writeFileSync(targetPath, Buffer.from(result.data, 'base64'));
  console.log(`[Screenshot capturado] ${targetPath}`);
}

async function runVisualTests() {
  console.log('[Visual QA] Iniciando servidor estático y mock API...');
  
  server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/invitaciones/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(currentFixture));
      return;
    }

    let filePath = path.join(bundle, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(bundle, 'index.html');
    }

    const ext = path.extname(filePath);
    if (ext === '.html' || !ext) {
      let html = fs.readFileSync(path.join(bundle, 'index.html'), 'utf8');
      html = html.replace('<head>', `<head><script>window.__EQUINOX_API_ORIGIN__=location.origin;</script>`);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://localhost:${server.address().port}`;

  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'equinox-visual-'));
  browser = spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--disable-gpu',
    '--no-first-run',
    '--user-data-dir=' + profile,
    'about:blank'
  ]);

  const stderr = [];
  browser.stderr.on('data', (d) => stderr.push(d));
  let devtoolsUrl;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const match = Buffer.concat(stderr).toString().match(/ws:\/\/[^\s]+/);
    if (match) { devtoolsUrl = match[0]; break; }
  }
  assert.ok(devtoolsUrl, 'DevTools URL no encontrada');

  socket = new WebSocket(devtoolsUrl);
  await new Promise((resolve) => { socket.addEventListener('open', resolve); });

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.id && commands.has(data.id)) {
      const { resolve, reject } = commands.get(data.id);
      commands.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    }
  });

  const target = await send('Target.getTargets');
  const pageTarget = target.targetInfos.find((t) => t.type === 'page');
  const session = await send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
  sessionId = session.sessionId;

  await send('Page.enable');
  await send('DOM.enable');

  // ==========================================
  // Test 1: Desktop - Modalidad General (Referencia visual)
  // ==========================================
  console.log('[Visual QA 1] Cargando Desktop (1280x800) - Modalidad General...');
  currentFixture = fixtureGeneral;
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin + '/invitacion/token-visual-general' });

  await waitDOM('!!document.querySelector("#invite-nombre")');
  await waitDOM('document.body.textContent.includes("Un espacio")');
  await waitDOM('document.body.textContent.includes("lo***@gmail.com")');

  const desktopTitle = await evaluate('document.querySelector(".hero-title")?.textContent');
  const desktopSubtitle = await evaluate('document.querySelector(".hero-subtitle")?.textContent');
  const desktopEyebrow = await evaluate('document.querySelector(".eyebrow-badge")?.textContent');
  const desktopRole = await evaluate('document.querySelector(".role-value")?.textContent');
  const desktopTag = await evaluate('document.querySelector(".hero-tag")?.textContent');

  assert.match(desktopTitle, /Un espacio/);
  assert.match(desktopSubtitle, /Tu proyecto y tu equipo/);
  assert.equal(desktopEyebrow.trim(), 'ACCESO AL PORTAL');
  assert.equal(desktopRole.trim(), 'Titular');
  assert.match(desktopTag, /PORTAL DE CLIENTES/);

  // Escribir en formulario para visualizar datos llenos
  await evaluate(`(() => {
    const n = document.querySelector("#invite-nombre");
    n.value = "Carlos";
    n.dispatchEvent(new Event('input', { bubbles: true }));
    const a = document.querySelector("#invite-apellido");
    a.value = "Santana";
    a.dispatchEvent(new Event('input', { bubbles: true }));
    const p = document.querySelector("#invite-password");
    p.value = "ClaveSegura123!";
    p.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  await screenshot('01-desktop-invitacion-general.png');

  // Test mostrar/ocultar contraseña
  console.log('[Visual QA 1b] Probando alternador de contraseña (eye button)...');
  const typeBefore = await evaluate('document.querySelector("#invite-password").getAttribute("type")');
  assert.equal(typeBefore, 'password');

  await evaluate('document.querySelector(".password-toggle-btn").click()');
  const typeAfter = await evaluate('document.querySelector("#invite-password").getAttribute("type")');
  assert.equal(typeAfter, 'text');

  await screenshot('01b-desktop-password-visible.png');

  // ==========================================
  // Test 2: Desktop - Modalidad FOTOGRAFIA (Copy adaptado)
  // ==========================================
  console.log('[Visual QA 2] Cargando Desktop (1280x800) - Modalidad Fotografía...');
  currentFixture = fixtureFotografia;
  await send('Page.navigate', { url: origin + '/invitacion/token-visual-foto' });

  await waitDOM('document.body.textContent.includes("Luz & Arte Fotografía")');
  const fotoSubtitle = await evaluate('document.querySelector(".hero-subtitle")?.textContent');
  console.log(`[Fotografía Subtitle]: "${fotoSubtitle?.trim()}"`);
  assert.match(fotoSubtitle, /sesiones y fotografías/);
  assert.ok(!fotoSubtitle.includes('proyecto'), 'No debe prometer proyectos en fotografía');
  assert.ok(!fotoSubtitle.includes('equipo'), 'No debe prometer equipo en fotografía');

  await screenshot('02-desktop-invitacion-fotografia.png');

  // ==========================================
  // Test 3: Mobile (390x844) - Modalidad Fotografía
  // ==========================================
  console.log('[Visual QA 3] Cargando Mobile (390x844)...');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: origin + '/invitacion/token-visual-foto-mobile' });

  await waitDOM('!!document.querySelector("#invite-nombre")');
  await screenshot('03-mobile-invitacion-fotografia.png');

  // ==========================================
  // Test 4: Mobile (390x844) - Modalidad General
  // ==========================================
  console.log('[Visual QA 4] Cargando Mobile General...');
  currentFixture = fixtureGeneral;
  await send('Page.navigate', { url: origin + '/invitacion/token-visual-general-mobile' });
  await waitDOM('!!document.querySelector("#invite-nombre")');
  await screenshot('04-mobile-invitacion-general.png');

  console.log('✓ Visual QA completado con éxito. Todas las capturas guardadas en docs/evidencias/invitacion/');

  // Cleanup
  if (socket) socket.close();
  if (server) server.close();
  if (browser) {
    browser.kill();
    await once(browser, 'exit').catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 200));
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
}

runVisualTests().catch(async (err) => {
  console.error('Error en Visual QA:', err);
  if (browser) {
    browser.kill();
    await once(browser, 'exit').catch(() => {});
  }
  if (server) server.close();
  await new Promise((r) => setTimeout(r, 200));
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  process.exit(1);
});
