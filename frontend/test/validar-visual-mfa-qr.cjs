const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const QRCode = require(path.resolve(__dirname, '../node_modules/qrcode'));
const { PNG } = require(path.resolve(__dirname, '../node_modules/pngjs'));

const repoRoot = 'C:/Users/kjmg2/Documents/hermes/equinox';
const bundle = path.resolve(repoRoot, 'frontend/dist/equinox/browser');
const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(fs.existsSync);

const FICTIONAL_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const FICTIONAL_OTPAUTH = `otpauth://totp/Equinox%3Aadmin-fixture%40equinox.test?secret=${FICTIONAL_SECRET}&issuer=Equinox&algorithm=SHA1&digits=6&period=30`;

let server, origin, browser, socket, sessionId, profile;
let sequence = 0;
const commands = new Map();

const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence;
  commands.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});

const evaluar = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result?.value;
};

const esperarTexto = async (texto, timeoutMs = 8000) => {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const body = await evaluar('document.body.innerText');
    if (body && body.toLowerCase().includes(texto.toLowerCase())) return body;
    await new Promise((r) => setTimeout(r, 150));
  }
  const actual = await evaluar('document.body.innerText');
  throw new Error(`No apareció "${texto}" en ${timeoutMs}ms. Contenido actual: ${String(actual).slice(0, 350)}`);
};

const mime = (archivo) => ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
}[path.extname(archivo)] || 'application/octet-stream');

function manejarApi(req, res) {
  const url = new URL(req.url, origin);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const bodyStr = Buffer.concat(chunks).toString('utf8');
    const body = bodyStr ? JSON.parse(bodyStr) : {};

    if (url.pathname === '/api/autenticacion/inicio-sesion' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({
        mfaRequerido: true,
        estadoMfa: 'CONFIGURAR',
        tokenDesafioMfa: 'mfa-setup-chal-fixture',
        contexto: { tipoAcceso: 'ADMIN_GLOBAL', rolPlataforma: 'ADMIN_GLOBAL' },
        usuario: { id: 'adm-fixture', correo: 'admin-fixture@equinox.test', nombre: 'Admin', apellido: 'Fixture', rolPlataforma: 'ADMIN_GLOBAL', mfaHabilitado: false }
      }));
      return;
    }

    if (url.pathname === '/api/autenticacion/admin/mfa/iniciar-configuracion' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({
        secretoBase32: FICTIONAL_SECRET,
        otpauthUrl: FICTIONAL_OTPAUTH,
        emisor: 'Equinox',
        cuenta: 'admin-fixture@equinox.test'
      }));
      return;
    }

    if (url.pathname === '/api/autenticacion/admin/mfa/confirmar-configuracion' && req.method === 'POST') {
      if (body.codigoTotp !== '654321') {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Código TOTP inválido o expirado' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        token: 'jwt-admin-fixture',
        contexto: { tipoAcceso: 'ADMIN_GLOBAL', rolPlataforma: 'ADMIN_GLOBAL', mfaVerificado: true },
        usuario: { id: 'adm-fixture', correo: 'admin-fixture@equinox.test', nombre: 'Admin', apellido: 'Fixture', rolPlataforma: 'ADMIN_GLOBAL', mfaHabilitado: true },
        codigosRecuperacion: ['AAAAA-11111', 'BBBBB-22222', 'CCCCC-33333', 'DDDDD-44444']
      }));
      return;
    }

    if (url.pathname === '/api/autenticacion/yo') {
      res.writeHead(200);
      res.end(JSON.stringify({
        usuario: { id: 'adm-fixture', correo: 'admin-fixture@equinox.test', nombre: 'Admin', apellido: 'Fixture', rolPlataforma: 'ADMIN_GLOBAL', mfaHabilitado: true },
        sesion: { tipoAcceso: 'ADMIN_GLOBAL', rolPlataforma: 'ADMIN_GLOBAL', mfaVerificado: true }
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Ruta mock no encontrada: ' + url.pathname }));
  });
}

async function main() {
  assert.ok(chrome, 'Chrome o Edge no encontrado');
  assert.ok(fs.existsSync(bundle), 'No existe build en frontend/dist/equinox/browser');

  server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    if (reqUrl.pathname.startsWith('/api/')) return manejarApi(req, res);

    const rel = reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname.replace(/^\/+/, '');
    let archivo = path.join(bundle, rel);
    if (!fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      archivo = path.join(bundle, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': mime(archivo) });
    fs.createReadStream(archivo).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://localhost:${server.address().port}`;

  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'equinox-qa-mfa-qr-'));
  browser = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('Timeout DevTools: ' + stderr)), 12000);
    browser.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });

  socket = new WebSocket(wsUrl);
  await once(socket, 'open');
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data.toString());
    if (msg.id && commands.has(msg.id)) {
      const { resolve, reject } = commands.get(msg.id);
      commands.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__EQUINOX_API_ORIGIN__ = ${JSON.stringify(origin)};`
  });
  await send('Runtime.enable');
  await send('Network.enable');

  const externalRequests = [];
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data.toString());
    if (msg.method === 'Network.requestWillBeSent') {
      const reqUrl = msg.params?.request?.url || '';
      if (reqUrl.startsWith('http') && !reqUrl.startsWith(origin) && !reqUrl.startsWith('https://fonts.')) {
        externalRequests.push(reqUrl);
      }
    }
  });

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${origin}/admin/acceso` });
  await esperarTexto('Acceso Superadmin');

  // Login con fixture
  await evaluar(`(() => {
    const email = document.querySelector('#admin-correo');
    const pass = document.querySelector('#admin-contrasena');
    email.value = 'admin-fixture@equinox.test';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    pass.value = 'ClaveFixture#2026';
    pass.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form button[type="submit"]').click();
  })()`);

  await esperarTexto('Configurar autenticador TOTP');

  // 1. Verificar QR local generado y secreto oculto por defecto
  const estadoInicial = await evaluar(`(() => {
    const img = document.querySelector('img.admin-mfa-qr-img');
    const manualPanel = document.querySelector('#mfa-manual-secret-panel');
    const toggleBtn = document.querySelector('.admin-mfa-toggle-btn');
    const html = document.body.innerHTML;
    return {
      qrSrc: img ? img.getAttribute('src') : null,
      qrWidth: img ? img.getBoundingClientRect().width : 0,
      qrHeight: img ? img.getBoundingClientRect().height : 0,
      manualPanelPresente: Boolean(manualPanel),
      ariaExpanded: toggleBtn ? toggleBtn.getAttribute('aria-expanded') : null,
      secretoEnDom: html.includes('${FICTIONAL_SECRET}'),
      secretoEnUrl: window.location.href.includes('${FICTIONAL_SECRET}'),
      secretoEnStorage: JSON.stringify(localStorage).includes('${FICTIONAL_SECRET}') || JSON.stringify(sessionStorage).includes('${FICTIONAL_SECRET}')
    };
  })()`);

  assert.ok(estadoInicial.qrSrc && estadoInicial.qrSrc.startsWith('data:image/png;base64,'), 'QR debe generarse localmente como data URL PNG');
  assert.ok(estadoInicial.qrWidth >= 190 && estadoInicial.qrHeight >= 190, 'QR debe ser suficientemente grande');
  assert.equal(estadoInicial.manualPanelPresente, false, 'La clave manual debe estar oculta por defecto');
  assert.equal(estadoInicial.ariaExpanded, 'false');
  assert.equal(estadoInicial.secretoEnDom, false, 'El secreto no debe estar en el DOM sin acción del usuario');
  assert.equal(estadoInicial.secretoEnUrl, false, 'El secreto no debe estar en la URL');
  assert.equal(estadoInicial.secretoEnStorage, false, 'El secreto no debe persistir en storage');
  assert.equal(externalRequests.length, 0, 'No debe haber peticiones externas al generar QR');

  // Verificar que el PNG del QR generado en navegador decodifica exactamente los módulos de FICTIONAL_OTPAUTH
  const base64Png = estadoInicial.qrSrc.replace(/^data:image\/png;base64,/, '');
  const png = PNG.sync.read(Buffer.from(base64Png, 'base64'));
  assert.equal(png.width, 240);
  assert.equal(png.height, 240);

  const qrEsperado = QRCode.create(FICTIONAL_OTPAUTH, { errorCorrectionLevel: 'M' });
  const totalModulos = qrEsperado.modules.size;
  const margin = 2;
  const scale = png.width / (totalModulos + margin * 2);
  for (let row = 0; row < totalModulos; row++) {
    for (let col = 0; col < totalModulos; col++) {
      const x = Math.floor((col + margin + 0.5) * scale);
      const y = Math.floor((row + margin + 0.5) * scale);
      const idx = (y * png.width + x) * 4;
      const r = png.data[idx];
      const esOscuroEnPng = r < 128;
      const esOscuroEsperado = Boolean(qrEsperado.modules.get(row, col));
      assert.equal(esOscuroEnPng, esOscuroEsperado, `Módulo QR (${row},${col}) no coincide`);
    }
  }

  // 2. Mostrar clave manual y volver a ocultar
  await evaluar(`document.querySelector('.admin-mfa-toggle-btn').click()`);
  await esperarTexto('mantén esta clave confidencial');
  const estadoVisible = await evaluar(`(() => ({
    manualPanelPresente: Boolean(document.querySelector('#mfa-manual-secret-panel')),
    ariaExpanded: document.querySelector('.admin-mfa-toggle-btn')?.getAttribute('aria-expanded'),
    muestraSecreto: document.querySelector('.admin-mfa-secret-code')?.textContent?.trim()
  }))()`);
  assert.equal(estadoVisible.manualPanelPresente, true);
  assert.equal(estadoVisible.ariaExpanded, 'true');
  assert.equal(estadoVisible.muestraSecreto, FICTIONAL_SECRET);

  await evaluar(`document.querySelector('.admin-mfa-toggle-btn').click()`);
  const ocultoDeNuevo = await evaluar(`Boolean(document.querySelector('#mfa-manual-secret-panel'))`);
  assert.equal(ocultoDeNuevo, false);

  // 3. Responsive móvil (375x812) sin overflow horizontal
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  const mobileMetrics = await evaluar(`(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    qrWidth: document.querySelector('img.admin-mfa-qr-img')?.getBoundingClientRect().width || 0
  }))()`);
  assert.ok(mobileMetrics.scrollWidth <= mobileMetrics.innerWidth, `Overflow horizontal en móvil: ${mobileMetrics.scrollWidth} > ${mobileMetrics.innerWidth}`);
  assert.ok(mobileMetrics.qrWidth >= 180, 'QR debe mantenerse legible en móvil');

  // 4. Error con código TOTP inválido y éxito con código TOTP válido -> códigos de recuperación
  await evaluar(`(() => {
    const inp = document.querySelector('#mfa-setup-code');
    inp.value = '111111';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form button[type="submit"]').click();
  })()`);
  await esperarTexto('Código TOTP inválido o expirado');

  await evaluar(`(() => {
    const inp = document.querySelector('#mfa-setup-code');
    inp.value = '654321';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form button[type="submit"]').click();
  })()`);
  await esperarTexto('Guarda tus códigos de recuperación');

  const secretoTrasConfirmar = await evaluar(`document.body.innerHTML.includes('${FICTIONAL_SECRET}')`);
  assert.equal(secretoTrasConfirmar, false, 'El secreto debe limpiarse tras confirmar configuración');

  console.log('[validar-visual-mfa-qr] Todas las validaciones visuales y de seguridad pasaron correctamente.');
}

main()
  .catch((err) => {
    console.error('[validar-visual-mfa-qr] Error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { socket?.close(); } catch {}
    try { browser?.kill('SIGKILL'); } catch {}
    try { server?.close(); } catch {}
    try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  });
