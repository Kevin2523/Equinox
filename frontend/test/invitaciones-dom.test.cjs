// Navegador real contra el bundle Angular y un servidor HTTP exclusivamente ficticio.
// Requiere compilar antes. No importa backend, Prisma, .env ni perfiles del usuario.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const bundle = path.resolve(__dirname, '../dist/equinox/browser');
const chrome = process.env.EQUINOX_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(fs.existsSync);
const cliente = (id) => ({ id, nombre: `Cliente ficticio ${id}`, correo: `${id}@example.invalid`, estado: 'ACTIVO', _count: { proyectos: 0 } });
const invitacion = (id = 'i1', estado = 'PENDIENTE') => ({ id, correo: 'cuenta@example.invalid', rol: 'TITULAR', estado, expiraEn: '2099-01-01T00:00:00Z' });
const publica = { correoEnmascarado: 'c***@example.invalid', rol: 'TITULAR', cliente: { nombre: 'Cliente ficticio', empresa: null }, organizacion: { nombre: 'Estudio ficticio', logoUrl: null }, esUsuarioExistente: false, expiraEn: '2099-01-01T00:00:00Z' };
const proyectoVisual = { id: 'p-ficticio', clienteId: 'a', nombre: 'Proyecto visual ficticio', descripcion: 'Descripción de prueba', estado: 'ACTIVO', fechaInicio: '2026-10-01T00:00:00.000Z', fechaEntrega: '2026-11-30T00:00:00.000Z', presupuesto: '500', moneda: 'PAB', cliente: cliente('a') };
const pendientes = [];
const esperas = [];
let server, origin, browser, socket, sessionId, profile;
let sequence = 0;
const commands = new Map();
const traffic = [];
const completions = new Map();
let responseId = 0;
let paginaFixture = '';
const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence; commands.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});
const evaluate = async (expression, awaitPromise = false) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error('La aserción DOM no se cumplió (sin volcar el contenido de la página).');
  return result.result.value;
};
const visible = (selector) => `!!document.querySelector(${JSON.stringify(selector)})`;
const waitDOM = (condition) => evaluate(`new Promise((resolve, reject) => {
  const ok = () => { try { return !!(${condition}); } catch { return false; } };
  if (ok()) { resolve(true); return; }
  const observer = new MutationObserver(() => { if (ok()) { observer.disconnect(); clearTimeout(deadline); resolve(true); } });
  const deadline = setTimeout(() => { observer.disconnect(); reject(new Error('DOM pendiente')); }, 2500);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
})`, true);
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const fill = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const take = (method, pathname) => new Promise((resolve) => {
  const index = pendientes.findIndex((r) => r.method === method && r.pathname === pathname);
  if (index >= 0) resolve(pendientes.splice(index, 1)[0]);
  else esperas.push({ method, pathname, resolve });
});
async function finish(request, status, body) {
  const marker = String(++responseId);
  const completed = new Promise((resolve) => { completions.set(marker, resolve); });
  request.reply(status, body, marker);
  await completed;
  // Solo sincroniza la aserción con el siguiente frame; no provoca un evento Angular.
  await evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(true)))', true);
}
async function go(route, width = 1100, height = 760) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin + route });
}
async function crm() {
  await go('/clientes');
  await waitDOM(visible('.client-card'));
  await click('.client-card .client-card-foot button:last-child');
  await waitDOM(visible('.invitation-modal'));
  return take('GET', '/api/clientes/a/invitaciones');
}
async function prepararFormulario(lista = []) {
  (await crm()).reply(200, lista);
  // Introducir correo es parte de preparar el formulario, nunca de actualizar un resultado.
  await fill('#invitacion-correo', 'cuenta@example.invalid');
  await waitDOM('!document.querySelector(".invitation-modal button[type=submit]").disabled');
}
async function screenshot(name) {
  if (!process.env.EQUINOX_TEST_ARTIFACTS) return;
  await evaluate(`Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect.getComputedTiming().iterations)).map(a => a.finished.catch(() => {})))`, true);
  const dir = path.resolve(process.env.EQUINOX_TEST_ARTIFACTS);
  fs.mkdirSync(dir, { recursive: true });
  const result = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(result.data, 'base64'));
}

before(async () => {
  assert.ok(chrome, 'Se necesita Chrome/Edge instalado o EQUINOX_TEST_BROWSER; no se descarga software.');
  assert.ok(fs.existsSync(path.join(bundle, 'index.html')), 'Ejecuta npm.cmd run compilar primero.');
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, origin).pathname;
    const reply = (status, body, marker) => { if (!res.writableEnded) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(marker ? { 'X-Equinox-Fixture': marker } : {}) }); res.end(JSON.stringify(body)); } };
    if (pathname === '/api/autenticacion/yo') return reply(200, { usuario: { id: 'u-test', nombre: 'Usuario ficticio' }, sesion: paginaFixture === '/portal'
      ? { tipoAcceso: 'CLIENTE', organizacionId: 'o-test', clienteId: 'a', rolCliente: 'TITULAR' }
      : { tipoAcceso: 'ORGANIZACION', organizacionId: 'o-test', rolOrganizacion: 'PROPIETARIO' } });
    if (pathname === '/api/clientes') return reply(200, [cliente('a'), cliente('b')]);
    if (pathname === '/api/proyectos') return reply(200, paginaFixture === '/proyectos' ? [proyectoVisual] : []);
    if (paginaFixture === '/portal') {
      if (pathname === '/api/portal') return reply(200, { cliente: { id: 'a', nombre: 'Cliente ficticio', empresa: null }, estudio: { nombre: 'Estudio ficticio', logoUrl: null, colorPrimario: '#3568f6', colorSecundario: null, tipografia: null } });
      if (pathname === '/api/portal/proyectos') return reply(200, [proyectoVisual]);
      if (pathname === '/api/portal/proyectos/p-ficticio') return reply(200, proyectoVisual);
      if (pathname === '/api/portal/proyectos/p-ficticio/hitos') return reply(200, [{ id: 'h-ficticio', titulo: 'Hito ficticio', descripcion: null, estado: 'PENDIENTE', orden: 1, fechaObjetivo: null, completadoEn: null }]);
      if (pathname === '/api/portal/proyectos/p-ficticio/archivos' || pathname === '/api/portal/proyectos/p-ficticio/comentarios' || pathname === '/api/portal/facturas') return reply(200, []);
    }
    if (pathname.startsWith('/api/')) {
      // No proxy ni conexión a una API externa: todas las respuestas salen de fixtures.
      const request = { method: req.method, pathname, reply };
      const index = esperas.findIndex((w) => w.method === request.method && w.pathname === pathname);
      if (index >= 0) esperas.splice(index, 1)[0].resolve(request); else pendientes.push(request);
      return;
    }
    const file = path.resolve(bundle, '.' + pathname);
    if (!file.startsWith(bundle + path.sep)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
      res.end(fs.readFileSync(file)); return;
    }
    if (['/clientes', '/proyectos', '/portal'].includes(pathname)) paginaFixture = pathname;
    let html = fs.readFileSync(path.join(bundle, 'index.html'), 'utf8');
    html = html.replace('<head>', `<head><script>window.__EQUINOX_API_ORIGIN__=location.origin;
      if(['/clientes','/proyectos','/portal'].includes(location.pathname)) sessionStorage.setItem('equinox_sesion_token','sesion-ficticia'); else sessionStorage.clear();</script>`);
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://localhost:${server.address().port}`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'equinox-dom-'));
  browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    browser.on('error', reject);
    let text = '';
    browser.stderr.on('data', (data) => { text += data; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
  });
  socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) {
      const pending = commands.get(event.id); commands.delete(event.id);
      if (event.error) pending.reject(new Error('Error CDP: ' + event.error.code)); else pending.resolve(event.result);
    } else if (event.method === 'Network.requestWillBeSent') {
      const url = new URL(event.params.request.url);
      if (url.origin === origin) traffic.push({ id: event.params.requestId, method: event.params.request.method, pathname: url.pathname, done: false });
    } else if (event.method === 'Network.responseReceived') {
      const marker = Object.entries(event.params.response.headers).find(([name]) => name.toLowerCase() === 'x-equinox-fixture')?.[1];
      const entry = traffic.findLast((r) => r.id === event.params.requestId);
      if (entry && marker) { entry.complete = completions.get(marker); completions.delete(marker); }
    } else if (event.method === 'Network.loadingFinished') {
      const entry = traffic.findLast((r) => r.id === event.params.requestId);
      if (entry) { entry.done = true; entry.complete?.(); }
    } else if (event.method === 'Fetch.requestPaused') {
      const url = new URL(event.params.request.url);
      const own = url.origin === origin;
      void send(own ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: event.params.requestId, ...(!own ? { errorReason: 'BlockedByClient' } : {}) });
    }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
});
afterEach(async () => {
  for (const request of pendientes.splice(0)) request.reply(503, { error: 'Fin de fixture' });
  esperas.length = 0;
  if (sessionId) await send('Page.navigate', { url: 'about:blank' });
  traffic.length = 0;
});
after(async () => {
  if (socket?.readyState === WebSocket.OPEN) { await send('Browser.close', {}, null).catch(() => {}); socket.close(); }
  if (browser && browser.exitCode === null) await once(browser, 'exit');
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  // Solo el directorio temporal creado por esta prueba; nunca un perfil real.
  if (profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('equinox-dom-')) {
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('DOM: consulta pública 200 muestra formulario sin otra interacción', { timeout: 15000 }, async (t) => {
  await go('/invitacion/token-ficticio');
  const request = await take('GET', '/api/invitaciones/token-ficticio');
  await waitDOM('document.body.textContent.includes("Consultando invitación")');
  request.reply(200, publica);
  try {
    await waitDOM('!!document.querySelector("#invite-nombre") && !document.body.textContent.includes("Consultando invitación")');
  } catch (error) {
    t.diagnostic(JSON.stringify(await evaluate(`(() => { const c=window.ng?.getComponent(document.querySelector('app-invitacion')); return {
      zoneDisponible: !!window.Zone, estadoRecibido: !!c?.invitacion, cargandoEnComponente: c?.cargando,
      formulariosEnDOM: document.querySelectorAll('.invitation-card form').length,
      cargaEnDOM: document.body.textContent.includes('Consultando invitación') }; })()`)));
    throw error;
  }
  await screenshot('consulta-publica');
});

for (const [motivo, mensaje] of [['La invitación ha sido revocada', 'fue revocada'], ['La invitación ha expirado', 'venció']]) {
test(`DOM: 410 ${mensaje} abandona carga y muestra estado terminal`, { timeout: 15000 }, async () => {
  await go('/invitacion/token-ficticio');
  (await take('GET', '/api/invitaciones/token-ficticio')).reply(410, { error: motivo });
  await waitDOM(`document.body.textContent.includes(${JSON.stringify(mensaje)}) && !document.body.textContent.includes("Consultando invitación")`);
  assert.equal(await evaluate(visible('.invitation-card form')), false);
  assert.equal(await evaluate(visible('.invitation-card button')), false);
});
}

test('DOM: listar invitaciones termina carga y representa la respuesta', { timeout: 15000 }, async () => {
  (await crm()).reply(200, [invitacion()]);
  await waitDOM('document.querySelectorAll(".invitation-list li").length === 1 && !document.querySelector(".invitation-modal").textContent.includes("Cargando invitaciones")');
});

test('DOM: crear muestra enlace y libera envío mientras lista sigue pendiente; layout móvil', { timeout: 15000 }, async () => {
  await prepararFormulario();
  await evaluate('document.querySelector(".invitation-modal form").requestSubmit()');
  const request = await take('POST', '/api/clientes/a/invitaciones');
  await waitDOM('document.querySelector(".invitation-modal button[type=submit]").textContent.includes("Creando")');
  request.reply(201, { invitacion: invitacion(), enlaceInvitacion: origin + '/invitacion/token-ficticio' });
  const refresh = await take('GET', '/api/clientes/a/invitaciones');
  await waitDOM('!!document.querySelector("#enlace-invitacion") && !document.querySelector(".invitation-modal button[type=submit]").textContent.includes("Creando")');
  assert.equal(await evaluate('document.querySelector(".invitation-modal").textContent.includes("Cargando invitaciones")'), true);
  refresh.reply(200, [invitacion()]);
  await waitDOM('!document.querySelector(".invitation-modal button[type=submit]").disabled');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 550, deviceScaleFactor: 1, mobile: false });
  const layout = await evaluate(`(() => { const modal=document.querySelector('.invitation-modal'); modal.scrollTop=0;
    const actions=modal.querySelector('form .modal-actions').getBoundingClientRect();
    const message=modal.querySelector('.auth-success').getBoundingClientRect();
    return { overlap: actions.bottom > message.top, scroll: modal.scrollHeight > modal.clientHeight }; })()`);
  assert.equal(layout.overlap, false, 'El botón no debe superponerse al mensaje');
  assert.equal(layout.scroll, true);
  await evaluate('document.querySelector(".invitation-modal").scrollTop=200');
  await screenshot('invitacion-modal-movil');
});

test('DOM: reenviar y revocar actualizan operación y lista', { timeout: 15000 }, async () => {
  await prepararFormulario([invitacion()]);
  await click('.invitation-actions button:first-child');
  (await take('POST', '/api/clientes/a/invitaciones/i1/reenviar')).reply(200, { invitacion: invitacion(), enlaceInvitacion: origin + '/invitacion/token-ficticio' });
  (await take('GET', '/api/clientes/a/invitaciones')).reply(200, [invitacion()]);
  await waitDOM('!!document.querySelector("#enlace-invitacion") && !document.querySelector(".invitation-actions button").disabled');
  await click('.invitation-actions button:nth-child(2)');
  await click('.invitation-actions button:nth-child(2)');
  (await take('POST', '/api/clientes/a/invitaciones/i1/revocar')).reply(200, { mensaje: 'Revocada', invitacion: { id: 'i1', estado: 'REVOCADA' } });
  (await take('GET', '/api/clientes/a/invitaciones')).reply(200, [invitacion('i1', 'REVOCADA')]);
  await waitDOM('document.querySelector(".invitation-list").textContent.includes("REVOCADA") && !document.querySelector(".invitation-actions")');
});

test('DOM: error público recuperable y aceptación sin sesión automática', { timeout: 15000 }, async () => {
  await go('/invitacion/token-ficticio');
  (await take('GET', '/api/invitaciones/token-ficticio')).reply(503, { error: 'Fallo ficticio' });
  await waitDOM(visible('.invitation-card .auth-error button'));
  await click('.invitation-card .auth-error button');
  (await take('GET', '/api/invitaciones/token-ficticio')).reply(200, publica);
  await waitDOM(visible('#invite-nombre'));
  await fill('#invite-nombre', 'Persona ficticia'); await fill('#invite-password', 'clave-ficticia');
  await evaluate('document.querySelector(".invitation-card form").requestSubmit()');
  (await take('POST', '/api/invitaciones/token-ficticio/aceptar')).reply(422, { error: 'Datos inválidos' });
  await waitDOM('!!document.querySelector("form .auth-error") && !document.querySelector("form button[type=submit]").disabled');
  await evaluate('document.querySelector(".invitation-card form").requestSubmit()');
  (await take('POST', '/api/invitaciones/token-ficticio/aceptar')).reply(200, { mensaje: 'Acceso vinculado', clienteId: 'a', rol: 'TITULAR' });
  await waitDOM(visible('.invitation-success a'));
  assert.equal(await evaluate('sessionStorage.getItem("equinox_sesion_token") === null'), true);
  assert.equal(await evaluate('document.querySelector(".invitation-success a").getAttribute("href")'), '/inicio-sesion');
});

test('DOM: error de lista y errores de mutación liberan botones y permiten reintentar', { timeout: 15000 }, async () => {
  (await crm()).reply(503, { error: 'Fallo ficticio' });
  await waitDOM(visible('.invitation-modal .api-state-error button'));
  await click('.invitation-modal .api-state-error button');
  (await take('GET', '/api/clientes/a/invitaciones')).reply(200, []);
  await waitDOM('!document.querySelector(".invitation-modal button[type=submit]").disabled');
  await evaluate('document.querySelector(".invitation-modal form").requestSubmit()');
  (await take('POST', '/api/clientes/a/invitaciones')).reply(422, { error: 'Datos inválidos' });
  await waitDOM('!!document.querySelector(".invitation-modal > .auth-error") && !document.querySelector(".invitation-modal button[type=submit]").disabled');
  await evaluate('document.querySelector(".invitation-modal form").requestSubmit()');
  (await take('POST', '/api/clientes/a/invitaciones')).reply(201, { invitacion: invitacion(), enlaceInvitacion: origin + '/invitacion/token-ficticio' });
  (await take('GET', '/api/clientes/a/invitaciones')).reply(200, [invitacion()]);
  await waitDOM(visible('.invitation-actions'));
  await click('.invitation-actions button:first-child');
  (await take('POST', '/api/clientes/a/invitaciones/i1/reenviar')).reply(503, { error: 'Fallo ficticio' });
  await waitDOM('!!document.querySelector(".invitation-modal > .auth-error") && !document.querySelector(".invitation-actions button").disabled');
  await click('.invitation-actions button:nth-child(2)');
  await click('.invitation-actions button:nth-child(2)');
  (await take('POST', '/api/clientes/a/invitaciones/i1/revocar')).reply(409, { error: 'Estado cambiado' });
  await waitDOM('document.querySelector(".invitation-modal > .auth-error").textContent.includes("cambió de estado") && !document.querySelector(".invitation-actions button").disabled');
});

for (const accion of ['crear', 'reenviar', 'revocar']) {
 for (const status of [200, 503]) {
  test(`DOM: respuesta tardía ${status} de ${accion} no modifica otro cliente ni un modal cerrado`, { timeout: 15000 }, async () => {
    await prepararFormulario([invitacion()]);
    let endpoint = '/api/clientes/a/invitaciones';
    if (accion === 'crear') await evaluate('document.querySelector(".invitation-modal form").requestSubmit()');
    else if (accion === 'reenviar') { endpoint += '/i1/reenviar'; await click('.invitation-actions button:first-child'); }
    else { endpoint += '/i1/revocar'; await click('.invitation-actions button:nth-child(2)'); await click('.invitation-actions button:nth-child(2)'); }
    const antigua = await take('POST', endpoint);
    await click('.invitation-modal .close');
    await click('.client-card:nth-child(2) .client-card-foot button:last-child');
    const actual = await take('GET', '/api/clientes/b/invitaciones');
    await finish(antigua, status, status === 200 ? { invitacion: invitacion(), enlaceInvitacion: origin + '/invitacion/token-ficticio-antiguo' } : { error: 'Fallo antiguo' });
    assert.equal(await evaluate('document.querySelector("#invitation-title").textContent.includes("ficticio b")'), true);
    assert.equal(await evaluate(visible('#enlace-invitacion')), false);
    assert.equal(await evaluate(visible('.invitation-modal > .auth-success')), false);
    assert.equal(await evaluate(visible('.invitation-modal > .auth-error')), false);
    assert.equal(await evaluate('document.querySelector(".invitation-modal").textContent.includes("Cargando invitaciones")'), true);
    assert.equal(traffic.filter((r) => r.method === 'GET' && r.pathname === '/api/clientes/b/invitaciones').length, 1);
    await click('.invitation-modal .close');
    await finish(actual, 200, [invitacion()]);
    assert.equal(await evaluate(visible('.invitation-modal')), false);
  });
 }
}

test('DOM: cerrar y reabrir el mismo cliente invalida la mutación anterior sin liberar la nueva', { timeout: 15000 }, async () => {
  await prepararFormulario();
  await evaluate('document.querySelector(".invitation-modal form").requestSubmit()');
  const anterior = await take('POST', '/api/clientes/a/invitaciones');
  await click('.invitation-modal .close');
  await click('.client-card .client-card-foot button:last-child');
  (await take('GET', '/api/clientes/a/invitaciones')).reply(200, []);
  await waitDOM('!document.querySelector(".invitation-modal button[type=submit]").disabled');
  await evaluate('document.querySelector(".invitation-modal form").requestSubmit()');
  const actual = await take('POST', '/api/clientes/a/invitaciones');
  await finish(anterior, 503, { error: 'Fallo antiguo' });
  assert.equal(await evaluate('document.querySelector(".invitation-modal button[type=submit]").textContent.includes("Creando")'), true);
  assert.equal(await evaluate(visible('.invitation-modal > .auth-error')), false);
  actual.reply(201, { invitacion: invitacion(), enlaceInvitacion: origin + '/invitacion/token-ficticio-nuevo' });
  (await take('GET', '/api/clientes/a/invitaciones')).reply(200, []);
  await waitDOM(visible('#enlace-invitacion'));
});

test('DOM: formulario de cliente conserva scroll y acciones sticky en pantalla baja', { timeout: 15000 }, async () => {
  await go('/clientes', 390, 550); await waitDOM(visible('.client-card'));
  await click('.page-title button'); await waitDOM(visible('#cliente-nombre'));
  const layout = await evaluate(`(() => { const modal=document.querySelector('.quick-modal'); const actions=modal.querySelector('.modal-actions');
    modal.scrollTop=modal.scrollHeight; const rect=actions.getBoundingClientRect();
    return { scroll: modal.scrollHeight>modal.clientHeight, sticky: getComputedStyle(actions).position, visible: rect.bottom<=innerHeight && rect.top>=0 }; })()`);
  assert.equal(layout.scroll, true); assert.equal(layout.sticky, 'sticky'); assert.equal(layout.visible, true);
  await screenshot('cliente-modal-scroll');
});

test('DOM: búsqueda y miniatura del proyecto no desbordan su contenedor', { timeout: 15000 }, async () => {
  await go('/proyectos', 1440, 900);
  await waitDOM(visible('.project-grid-card'));
  const layout = await evaluate(`(() => { const icon=document.querySelector('.search-input-pill svg');
    const card=document.querySelector('.project-grid-card'); const thumb=card.querySelector('.p-node-thumb');
    const i=icon.getBoundingClientRect(), c=card.getBoundingClientRect(), t=thumb.getBoundingClientRect();
    return { iconWidth:i.width, iconHeight:i.height, thumbInside:t.left>=c.left && t.right<=c.right && t.top>=c.top && t.bottom<=c.bottom,
      decoration:getComputedStyle(thumb,'::before').content }; })()`);
  assert.equal(layout.iconWidth, 18);
  assert.equal(layout.iconHeight, 18);
  assert.equal(layout.thumbInside, true);
  assert.equal(layout.decoration, 'none');
  await screenshot('proyectos-layout');
});

test('DOM: un proyecto del portal usa el ancho disponible y reorganiza su detalle en móvil', { timeout: 15000 }, async () => {
  await go('/portal', 1440, 900);
  await waitDOM(visible('.portal-detail-grid .portal-milestones li'));
  const desktop = await evaluate(`(() => { const w=document.querySelector('.portal-workspace').getBoundingClientRect();
    const d=document.querySelector('.portal-project-detail').getBoundingClientRect();
    const cards=[...document.querySelectorAll('.portal-detail-grid > section')].map(el=>el.getBoundingClientRect());
    return { detailWidth:d.width, workspaceWidth:w.width, twoColumns:cards.length===2 && cards[1].left>cards[0].left }; })()`);
  assert.ok(desktop.detailWidth >= desktop.workspaceWidth - 2);
  assert.equal(desktop.twoColumns, true);
  await screenshot('portal-escritorio');
  await go('/portal', 390, 780);
  await waitDOM(visible('.portal-detail-grid .portal-milestones li'));
  const mobile = await evaluate(`(() => { const cards=[...document.querySelectorAll('.portal-detail-grid > section')].map(el=>el.getBoundingClientRect());
    const brand=document.querySelector('.client-shell-nav .brand').getBoundingClientRect();
    const title=document.querySelector('.client-shell-nav > span').getBoundingClientRect();
    const logout=document.querySelector('.client-shell-nav > button').getBoundingClientRect();
    return { stacked:cards.length===2 && cards[1].top>=cards[0].bottom, pageFits:document.documentElement.scrollWidth<=innerWidth,
      headerSeparated:title.top>=brand.bottom && logout.left>=brand.right }; })()`);
  assert.equal(mobile.stacked, true);
  assert.equal(mobile.pageFits, true);
  assert.equal(mobile.headerSeparated, true);
  await screenshot('portal-movil');
});
