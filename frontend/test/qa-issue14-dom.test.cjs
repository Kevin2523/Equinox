// QA issue 14: navegador Chrome real, API ficticia y bundle compilado; sin base de datos.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const bundle = path.resolve(__dirname, '../dist/equinox/browser');
const chrome = process.env.EQUINOX_TEST_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const client = { id: 'c1', nombre: 'Cliente Ficticio', empresa: 'Empresa de Prueba', estado: 'ACTIVO' };
const project = { id: 'p1', clienteId: 'c1', nombre: 'San Carlos Surf Resort', estado: 'ACTIVO', descripcion: 'Proyecto QA', cliente: client };
let hitosStatus = 200;
let hitosPayload = [];
let demorarHitos = false;
const hitosEnEspera = [];
let resolverSolicitudHitos;
let server, origin, browser, socket, sessionId, profile, nextId = 0;
const pending = new Map();
const exceptions = [];
const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});
async function evalDOM(expression, awaitPromise = false) {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}
const frame = () => evalDOM('new Promise(resolve => requestAnimationFrame(() => resolve(true)))', true);
const wait = (condition) => evalDOM(`new Promise((resolve, reject) => {
  const started = performance.now();
  const check = () => {
    try { if (${condition}) return resolve(true); } catch { /* Navegación aún en curso. */ }
    if (performance.now() - started > 5000) return reject(new Error('DOM pendiente: ' + ${JSON.stringify(condition)}));
    setTimeout(check, 25);
  };
  check();
})`, true);
const click = selector => evalDOM(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function key(keyName, modifiers = 0) {
  const code = keyName === 'Tab' ? 9 : keyName === 'Escape' ? 27 : 13;
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code: keyName, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers });
  if (keyName === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: keyName, code: keyName, windowsVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: code, modifiers });
  await frame();
}
async function go(route, width = 1280, height = 800) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin + route });
  await wait('document.querySelector("#openSearch") || document.querySelector(".portal-custom-header")');
}
async function viewport(width, height = 800) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await frame();
}
function fit(label, result) {
  assert.ok(result.width <= result.viewport + 1, `${label}: scrollWidth ${result.width} > viewport ${result.viewport}`);
}
before(async () => {
  assert.ok(chrome, 'Chrome o Edge requerido');
  assert.ok(fs.existsSync(path.join(bundle, 'index.html')), 'Compilar primero: npm.cmd run compilar');
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/proyectos/p1/hitos') {
        if (demorarHitos) { hitosEnEspera.push(res); resolverSolicitudHitos?.(); resolverSolicitudHitos = undefined; return; }
        res.writeHead(hitosStatus, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(hitosPayload));
      }
      const payload = pathname === '/api/autenticacion/yo'
        ? { usuario: { id: 'u1', nombre: 'Persona de Prueba' }, sesion: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-test', rolOrganizacion: 'PROPIETARIO' } }
        : pathname === '/api/clientes' ? [client]
        : pathname === '/api/proyectos' ? [project]
        : pathname === '/api/proyectos/p1' ? project
        : pathname === '/api/organizacion' ? { id: 'org-test', nombre: 'Estudio Ficticio', portalMostrarFinanzas: true }
        : pathname === '/api/facturas/totales' ? { totalesPorMoneda: [] } : [];
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(payload));
    }
    const file = path.resolve(bundle, '.' + pathname);
    if (file.startsWith(bundle + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
      return res.end(fs.readFileSync(file));
    }
    const html = fs.readFileSync(path.join(bundle, 'index.html'), 'utf8').replace('<head>', `<head><script>window.__EQUINOX_API_ORIGIN__=location.origin;sessionStorage.setItem('equinox_sesion_token','sesion-ficticia-org');</script>`);
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://localhost:${server.address().port}`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'equinox-issue14-'));
  browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    browser.on('error', reject);
    let text = '';
    browser.stderr.on('data', data => { text += data; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
  });
  socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) {
      const task = pending.get(event.id); pending.delete(event.id);
      if (event.error) task.reject(new Error(JSON.stringify(event.error))); else task.resolve(event.result);
    } else if (event.method === 'Runtime.exceptionThrown') {
      exceptions.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    } else if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error' && event.params.entry.source === 'javascript') {
      exceptions.push(event.params.entry.text);
    } else if (event.method === 'Fetch.requestPaused') {
      const own = new URL(event.params.request.url).origin === origin;
      void send(own ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: event.params.requestId, ...(!own ? { errorReason: 'BlockedByClient' } : {}) }).catch(error => exceptions.push(String(error)));
    }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
});
after(async () => { socket?.close(); browser?.kill(); server?.close(); try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
afterEach(() => {
  for (const res of hitosEnEspera.splice(0)) {
    if (!res.writableEnded) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{}'); }
  }
  hitosStatus = 200; hitosPayload = []; demorarHitos = false; resolverSolicitudHitos = undefined;
});

test('Hoy: la consulta pendiente muestra carga sin afirmar que no hay hitos', { timeout: 15000 }, async () => {
  demorarHitos = true;
  const solicitudRecibida = new Promise(resolve => { resolverSolicitudHitos = resolve; });
  await go('/hoy');
  await wait('document.querySelector(".v-timeline-section [role=status]")');
  await solicitudRecibida;
  assert.ok(hitosEnEspera.length > 0);
  assert.equal(await evalDOM('!!document.querySelector(".v-timeline-empty")'), false);
  assert.equal(await evalDOM('!!document.querySelector(".vtb-progress-box")'), false);
  for (const res of hitosEnEspera.splice(0)) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('[]');
  }
  demorarHitos = false;
  await wait('document.querySelector(".v-timeline-empty")');
});

test('Hoy: proyecto ACTIVO sin hitos ni tareas muestra estado vacío y ningún avance inventado', { timeout: 15000 }, async () => {
  await go('/hoy');
  await wait('document.querySelector(".v-timeline-banner") && document.querySelector(".v-timeline-empty")');
  const vista = await evalDOM(`({
    titulo: document.querySelector('.v-timeline-banner h2')?.textContent?.trim(),
    texto: document.querySelector('.v-timeline-section')?.innerText || '',
    hitos: document.querySelectorAll('.v-timeline-track .v-timeline-item').length,
    vacio: document.querySelector('.v-timeline-empty')?.innerText || '',
    progreso: document.querySelector('.vtb-progress-box')?.innerText || ''
  })`);
  assert.equal(vista.titulo, 'San Carlos Surf Resort');
  assert.equal(vista.hitos, 0, 'No debe representar fases como hitos registrados');
  assert.match(vista.vacio, /no hay hitos registrados/i);
  assert.match(vista.vacio, /primer hito/i);
  assert.equal(vista.progreso.includes('50%'), false);
  assert.equal(/Apertura y vinculación|Validación y aprobación|Entrega final y cierre/.test(vista.texto), false);
});

test('Hoy: fallo al consultar hitos muestra error y reintento, no estado vacío', { timeout: 15000 }, async () => {
  hitosStatus = 503;
  hitosPayload = { error: 'Fallo ficticio' };
  await go('/hoy');
  await wait('document.querySelector(".v-timeline-error")');
  assert.equal(await evalDOM('!!document.querySelector(".v-timeline-empty")'), false);
  assert.equal(await evalDOM('document.querySelectorAll(".v-timeline-track .v-timeline-item").length'), 0);
  hitosStatus = 200;
  hitosPayload = [{ id: 'h1', proyectoId: 'p1', titulo: 'Entrega real', descripcion: null, estado: 'COMPLETADO', visibleEnPortal: false, fechaObjetivo: null }];
  await click('.v-timeline-error button');
  await wait('document.querySelector(".v-timeline-track")?.textContent.includes("Entrega real")');
  assert.equal(await evalDOM('!!document.querySelector(".v-timeline-error")'), false);
});

test('Hoy: solo los hitos de la API determinan el porcentaje y las tarjetas', { timeout: 15000 }, async () => {
  hitosPayload = [
    { id: 'h1', proyectoId: 'p1', titulo: 'Boceto aprobado', descripcion: null, estado: 'COMPLETADO', visibleEnPortal: false, fechaObjetivo: null },
    { id: 'h2', proyectoId: 'p1', titulo: 'Entrega pendiente', descripcion: null, estado: 'PENDIENTE', visibleEnPortal: false, fechaObjetivo: null }
  ];
  await go('/hoy');
  await wait('document.querySelector(".v-timeline-track")?.textContent.includes("Entrega pendiente")');
  const vista = await evalDOM(`({ titulos: [...document.querySelectorAll('.v-timeline-track .v-timeline-item h3')].map(e => e.textContent.trim()), progreso: document.querySelector('.vtb-progress-box')?.textContent || '' })`);
  assert.deepEqual(vista.titulos, ['Boceto aprobado', 'Entrega pendiente']);
  assert.match(vista.progreso, /50%/);
});

test('modales de páginas: cliente y proyecto retienen y restauran foco con Escape y overlay', { timeout: 30000 }, async () => {
  for (const [route, opener, modal] of [
    ['/clientes', '.page-title button', '.overlay .quick-modal'],
    ['/proyectos', '.page-title button', '.overlay .modal-formulario-amplio']
  ]) {
    await go(route);
    await wait(`document.querySelector(${JSON.stringify(opener)}) && !document.querySelector(${JSON.stringify(opener)}).disabled && !document.querySelector('.overlay')`);
    for (const closeBy of ['Escape', 'overlay']) {
      await evalDOM(`document.querySelector(${JSON.stringify(opener)}).focus()`);
      await click(opener);
      await wait(`document.querySelector(${JSON.stringify(modal)})`);
      assert.equal(await evalDOM(`(() => { const d = document.querySelector(${JSON.stringify(modal)}); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!d.getAttribute('aria-labelledby') && d.contains(document.activeElement); })()`), true, `${route}: diálogo etiquetado y foco interno`);
      await evalDOM(`document.querySelector(${JSON.stringify(modal)} + ' button:last-of-type').focus()`);
      await key('Tab');
      assert.equal(await evalDOM(`document.querySelector(${JSON.stringify(modal)}).contains(document.activeElement)`), true, `${route}: Tab contenido`);
      if (closeBy === 'Escape') await key('Escape'); else await click('.overlay');
      await wait(`!document.querySelector(${JSON.stringify(modal)})`);
      assert.equal(await evalDOM(`document.activeElement === document.querySelector(${JSON.stringify(opener)})`), true, `${route}: foco restaurado tras ${closeBy}`);
    }
  }
});

test('cliente: sitio web opcional no bloquea un dominio sin protocolo', async () => {
  await go('/clientes');
  await wait('document.querySelector(".page-title button") && !document.querySelector(".page-title button").disabled');
  await click('.page-title button');
  await wait('document.querySelector("#cliente-web")');
  const input = await evalDOM(`(() => {
    const web = document.querySelector('#cliente-web');
    web.value = 'www.ejemplo.com';
    web.dispatchEvent(new Event('input', { bubbles: true }));
    return { type: web.type, valid: web.checkValidity(), optional: !web.required, value: web.value };
  })()`);
  assert.deepEqual(input, { type: 'text', valid: true, optional: true, value: 'www.ejemplo.com' });
  assert.equal(await evalDOM(`(() => { const web = document.querySelector('#cliente-web'); web.value = ''; web.dispatchEvent(new Event('input', { bubbles: true })); return web.checkValidity(); })()`), true);
  await key('Escape');
});

test('búsqueda: Tab y Shift+Tab quedan dentro, Enter abre resultado y cierre restaura foco', { timeout: 20000 }, async () => {
  await go('/hoy');
  await evalDOM('document.querySelector("#openSearch").focus()');
  await click('#openSearch');
  await wait('document.querySelector(".search-modal-box")');
  const selector = '.search-modal-box';
  assert.equal(await evalDOM(`document.querySelector('${selector}').contains(document.activeElement)`), true);
  await wait('document.querySelector(".search-modal-box .search-result-row")');
  await evalDOM(`document.querySelector('${selector} .search-result-row:last-child').focus()`);
  await key('Tab');
  assert.equal(await evalDOM(`document.querySelector('${selector}').contains(document.activeElement)`), true, 'Tab no sale del modal');
  await evalDOM(`document.querySelector('${selector} #globalSearchInput').focus()`);
  await key('Tab', 8);
  assert.equal(await evalDOM(`document.querySelector('${selector}').contains(document.activeElement)`), true, 'Shift+Tab no sale del modal');
  await wait('document.querySelector(".search-result-row")');
  await evalDOM(`document.querySelector('${selector} .search-result-row').focus()`);
  assert.equal(await evalDOM('document.activeElement?.matches(".search-result-row")'), true);
  await key('Enter');
  await wait('!document.querySelector(".search-modal-box")');
  assert.notEqual(await evalDOM('document.activeElement === document.body'), true, 'Enter deja foco útil');
  await evalDOM('document.querySelector("#openSearch").focus()');
  await click('#openSearch');
  await wait('document.querySelector(".search-modal-box")');
  await key('Escape');
  await wait('!document.querySelector(".search-modal-box")');
  assert.equal(await evalDOM('document.activeElement?.id'), 'openSearch');
});

test('creación: trampa de foco y restauración; acciones alcanzables a 390×560', { timeout: 20000 }, async () => {
  await go('/hoy', 390, 560);
  await wait('document.querySelector("#createBtn")');
  await evalDOM('document.querySelector("#createBtn").focus()');
  await click('#createBtn');
  await wait('document.querySelector(".quick-modal")');
  assert.equal(await evalDOM('document.querySelector(".quick-modal").contains(document.activeElement)'), true);
  await evalDOM('document.querySelector(".quick-modal .modal-choices button:last-child").focus()');
  await key('Tab');
  assert.equal(await evalDOM('document.querySelector(".quick-modal").contains(document.activeElement)'), true);
  await evalDOM('document.querySelector(".quick-modal .close").focus()');
  await key('Tab', 8);
  assert.equal(await evalDOM('document.querySelector(".quick-modal").contains(document.activeElement)'), true);
  for (const type of ['Cliente', 'Proyecto', 'Tarea', 'Factura']) {
    await wait('document.querySelector(".modal-choices")');
    await evalDOM(`[...document.querySelectorAll('.modal-choices button')].find(b => b.textContent.includes(${JSON.stringify(type)})).click()`);
    await wait('document.querySelector(".quick-modal .modal-actions .btn-primary")');
    const layout = await evalDOM(`(() => {
      const modal = document.querySelector('.quick-modal'), action = modal.querySelector('.modal-actions .btn-primary');
      const box = modal.getBoundingClientRect(), button = action.getBoundingClientRect();
      return { width: document.documentElement.scrollWidth, viewport: innerWidth, buttonWidth: button.width,
        reachable: button.bottom <= innerHeight + 1 || (getComputedStyle(modal).overflowY !== 'hidden' && modal.scrollHeight > modal.clientHeight && box.top < innerHeight) };
    })()`);
    fit(`Formulario ${type}`, layout);
    assert.ok(layout.buttonWidth > 0 && layout.reachable, `Acción ${type} no alcanzable a 390×560: ${JSON.stringify(layout)}`);
    await click('.quick-modal .back-link');
  }
  await key('Escape');
  await wait('!document.querySelector(".quick-modal")');
  assert.equal(await evalDOM('document.activeElement?.id'), 'createBtn');
});

test('vistas principales: 390, 768, 1280 sin overflow horizontal ni excepciones JS', { timeout: 60000 }, async () => {
  const findings = [];
  for (const route of ['/hoy', '/clientes', '/proyectos', '/tareas', '/finanzas', '/vista-previa-portal']) {
    await go(route);
    await frame();
    for (const width of [390, 768, 1280]) {
      await viewport(width, width === 390 ? 560 : 800);
      const result = await evalDOM('({ width: document.documentElement.scrollWidth, viewport: innerWidth, path: location.pathname, content: document.body.innerText.length })');
      assert.ok(result.path === route || (route === '/hoy' && result.path === '/dashboard'), `Ruta inesperada: ${route} -> ${result.path}`);
      assert.ok(result.content > 100, `Sin contenido visible en ${route}`);
      if (result.width > width + 1) findings.push(`${route}@${width}: ${result.width}px; ${JSON.stringify(await evalDOM(`([...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 2 && getComputedStyle(e).position !== 'fixed').slice(0, 8).map(e => ({ tag: e.tagName, className: typeof e.className === 'string' ? e.className : '', right: Math.round(e.getBoundingClientRect().right) })))`))}`);
    }
  }
  assert.deepEqual(exceptions, [], 'Excepciones JavaScript en consola');
  assert.deepEqual(findings, [], `Overflow horizontal: ${findings.join(', ')}`);
});
