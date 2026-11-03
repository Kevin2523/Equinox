// Pruebas DOM en navegador real para /vista-previa-portal
// Verifica cambio rápido de proyectos, respuesta tardía de facturas, fallos de red y destrucción.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const bundle = path.resolve(__dirname, '../dist/equinox/browser');
const chrome = process.env.EQUINOX_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(fs.existsSync);

const cliente1 = { id: 'c1', nombre: 'Cliente Alfa S.A.', empresa: 'Alfa Corp', estado: 'ACTIVO' };
const cliente2 = { id: 'c2', nombre: 'Cliente Beta S.A.', empresa: 'Beta Corp', estado: 'ACTIVO' };
const proyecto1 = {
  id: 'p1',
  clienteId: 'c1',
  nombre: 'Proyecto Alfa Primero',
  descripcion: 'Alcance del proyecto uno',
  estado: 'ACTIVO',
  fechaInicio: '2026-10-01T00:00:00.000Z',
  fechaEntrega: '2026-11-30T00:00:00.000Z',
  presupuesto: '1500',
  moneda: 'USD',
  cliente: cliente1
};
const proyecto2 = {
  id: 'p2',
  clienteId: 'c2',
  nombre: 'Proyecto Beta Segundo',
  descripcion: 'Alcance del proyecto dos',
  estado: 'ACTIVO',
  fechaInicio: '2026-10-15T00:00:00.000Z',
  fechaEntrega: '2026-12-15T00:00:00.000Z',
  presupuesto: '2500',
  moneda: 'USD',
  cliente: cliente2
};

const pendientes = [];
const esperas = [];
let server, origin, browser, socket, sessionId, profile;
let sequence = 0;
const commands = new Map();
const traffic = [];
const completions = new Map();
let responseId = 0;

let interceptarFacturas = false;
let interceptarOrganizacion = false;
let facturasFicticias = null;
let organizacionFicticia = null;

const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence; commands.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});
const evaluate = async (expression, awaitPromise = false) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error('La aserción DOM no se cumplió: ' + JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const visible = (selector) => `!!document.querySelector(${JSON.stringify(selector)})`;
const waitDOM = (condition) => evaluate(`new Promise((resolve, reject) => {
  const ok = () => { try { return !!(${condition}); } catch { return false; } };
  if (ok()) { resolve(true); return; }
  const observer = new MutationObserver(() => { if (ok()) { observer.disconnect(); clearTimeout(deadline); resolve(true); } });
  const deadline = setTimeout(() => { observer.disconnect(); reject(new Error('DOM pendiente: ' + ${JSON.stringify(condition)})); }, 3500);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
})`, true);
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
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
  await evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(true)))', true);
}
async function go(route, width = 1100, height = 760) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin + route });
}

before(async () => {
  assert.ok(chrome, 'Se necesita Chrome o Edge instalado');
  assert.ok(fs.existsSync(path.join(bundle, 'index.html')), 'Ejecuta npm.cmd run compilar primero.');

  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, origin).pathname;
    const reply = (status, body, marker) => {
      if (!res.writableEnded) {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...(marker ? { 'X-Equinox-Fixture': marker } : {})
        });
        res.end(JSON.stringify(body));
      }
    };

    if (pathname === '/api/autenticacion/yo') {
      const auth = req.headers['authorization'] || '';
      const isOrg2 = auth.includes('token-org-2');
      return reply(200, {
        usuario: { id: isOrg2 ? 'u2' : 'u1', nombre: isOrg2 ? 'Freelancer Org 2' : 'Freelancer de Prueba' },
        sesion: { tipoAcceso: 'ORGANIZACION', organizacionId: isOrg2 ? 'org-2' : 'org-test', rolOrganizacion: 'PROPIETARIO' }
      });
    }
    if (pathname === '/api/clientes') return reply(200, [cliente1, cliente2]);
    if (pathname === '/api/proyectos') return reply(200, [proyecto1, proyecto2]);
    if (pathname === '/api/proyectos/p1') return reply(200, proyecto1);
    if (pathname === '/api/proyectos/p2') return reply(200, proyecto2);
    if (!interceptarFacturas && pathname === '/api/facturas') return reply(200, facturasFicticias || []);
    if (pathname === '/api/facturas/totales') return reply(200, { totalesPorMoneda: [] });
    if (!interceptarOrganizacion && pathname === '/api/organizacion') {
      return reply(200, organizacionFicticia || {
        id: 'org-test',
        nombre: 'Estudio de Diseño',
        portalMostrarFinanzas: true,
        colorPrimario: '#3568F6',
        colorSecundario: '#0F172A',
        tipografia: 'DM Sans'
      });
    }

    if (pathname.startsWith('/api/')) {
      const bloques = [];
      req.on('data', (bloque) => bloques.push(bloque));
      req.on('end', () => {
        const request = { method: req.method, pathname, headers: req.headers, body: Buffer.concat(bloques).toString('utf8'), reply };
        const index = esperas.findIndex((w) => w.method === request.method && w.pathname === pathname);
        if (index >= 0) esperas.splice(index, 1)[0].resolve(request);
        else pendientes.push(request);
      });
      return;
    }

    const file = path.resolve(bundle, '.' + pathname);
    if (!file.startsWith(bundle + path.sep)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
      res.end(fs.readFileSync(file));
      return;
    }

    let html = fs.readFileSync(path.join(bundle, 'index.html'), 'utf8');
    html = html.replace(
      '<head>',
      `<head><script>window.__EQUINOX_API_ORIGIN__=location.origin;
        if(['/vista-previa-portal','/clientes','/proyectos','/portal','/finanzas'].includes(location.pathname)) {
          sessionStorage.setItem('equinox_sesion_token','sesion-ficticia-org');
        } else {
          sessionStorage.clear();
        }
      </script>`
    );
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://localhost:${server.address().port}`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'equinox-vp-dom-'));
  browser = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      'about:blank'
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
  );

  const wsUrl = await new Promise((resolve, reject) => {
    browser.on('error', reject);
    let text = '';
    browser.stderr.on('data', (data) => {
      text += data;
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolve(match[1]);
    });
  });

  socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) {
      const pending = commands.get(event.id);
      commands.delete(event.id);
      if (event.error) pending.reject(new Error('Error CDP: ' + event.error.code));
      else pending.resolve(event.result);
    } else if (event.method === 'Network.requestWillBeSent') {
      const url = new URL(event.params.request.url);
      if (url.origin === origin) {
        traffic.push({ id: event.params.requestId, method: event.params.request.method, pathname: url.pathname, done: false });
      }
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
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
});

afterEach(async () => {
  interceptarFacturas = false;
  interceptarOrganizacion = false;
  facturasFicticias = null;
  organizacionFicticia = null;
  for (const request of pendientes.splice(0)) request.reply(503, { error: 'Fin de test' });
});

test('DOM: al cambiar de organización desaparecen marca y factura previas antes de responder la nueva API', { timeout: 15000 }, async () => {
  facturasFicticias = [{ id: 'f-org1', proyectoId: 'p1', numero: 'INV-ORG1', concepto: 'Prueba Org 1', monto: 10, moneda: 'PAB', visibleEnPortal: true, estado: 'ENVIADA' }];
  organizacionFicticia = { id: 'org-test', nombre: 'Marca Org 1', portalMostrarFinanzas: true, colorPrimario: '#123456' };
  await go('/vista-previa-portal');
  const detalle = await Promise.all([
    take('GET', '/api/proyectos/p1/hitos'), take('GET', '/api/proyectos/p1/archivos'), take('GET', '/api/proyectos/p1/comentarios')
  ]);
  for (const req of detalle) await finish(req, 200, []);
  await waitDOM('document.querySelector(".portal-header-brand")?.textContent.includes("Marca Org 1") && document.querySelector(".portal-invoices")?.textContent.includes("INV-ORG1")');

  interceptarFacturas = true;
  interceptarOrganizacion = true;
  await evaluate(`
    sessionStorage.setItem('equinox_sesion_token', 'token-org-2');
    window.__portalComponent.state.auth.sesionSubject.next({
      usuario: { id: 'u2', nombre: 'Usuario Org 2' },
      contexto: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-2', rolOrganizacion: 'PROPIETARIO' }
    });
  `);
  const pendienteFactura = await take('GET', '/api/facturas');
  const pendienteOrg1 = await take('GET', '/api/organizacion');
  await evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(true)))', true);
  const transicion = await evaluate(`({
    marca: document.querySelector('.portal-header-brand')?.textContent || '',
    facturas: document.querySelector('.portal-invoices')?.textContent || '',
    estadoMarca: window.__portalComponent.state.configuracion.nombreEstudio,
    estadoFacturas: window.__portalComponent.state.facturasReales.length
  })`);
  assert.equal(transicion.marca.includes('Marca Org 1'), false);
  assert.equal(transicion.facturas.includes('INV-ORG1'), false);
  assert.equal(transicion.estadoMarca, '');
  assert.equal(transicion.estadoFacturas, 0);
  await finish(pendienteFactura, 500, { error: 'Fallo ficticio' });
  await finish(pendienteOrg1, 500, { error: 'Fallo ficticio' });
  assert.equal((await evaluate('document.querySelector(".portal-header-brand")?.textContent || ""')).includes('Marca Org 1'), false);
});

test('DOM: al cerrar sesión se retiran inmediatamente marca y factura de la vista previa', { timeout: 15000 }, async () => {
  facturasFicticias = [{ id: 'f-cierre', proyectoId: 'p1', numero: 'INV-ANTES-CIERRE', concepto: 'Prueba', monto: 10, moneda: 'PAB', visibleEnPortal: true, estado: 'ENVIADA' }];
  organizacionFicticia = { id: 'org-test', nombre: 'Marca Antes Cierre', portalMostrarFinanzas: true };
  await go('/vista-previa-portal');
  const detalle = await Promise.all([
    take('GET', '/api/proyectos/p1/hitos'), take('GET', '/api/proyectos/p1/archivos'), take('GET', '/api/proyectos/p1/comentarios')
  ]);
  for (const req of detalle) await finish(req, 200, []);
  await waitDOM('document.querySelector(".portal-header-brand")?.textContent.includes("Marca Antes Cierre") && document.querySelector(".portal-invoices")?.textContent.includes("INV-ANTES-CIERRE")');
  await evaluate(`
    sessionStorage.clear();
    window.__portalComponent.state.auth.sesionSubject.next(null);
  `);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(true)))', true);
  const estado = await evaluate(`({
    marca: document.querySelector('.portal-header-brand')?.textContent || '',
    facturas: document.querySelector('.portal-invoices')?.textContent || '',
    configuracion: window.__portalComponent.state.configuracion.nombreEstudio,
    cantidad: window.__portalComponent.state.facturasReales.length
  })`);
  assert.equal(estado.marca.includes('Marca Antes Cierre'), false);
  assert.equal(estado.facturas.includes('INV-ANTES-CIERRE'), false);
  assert.equal(estado.configuracion, '');
  assert.equal(estado.cantidad, 0);
});

after(async () => {
  socket?.close();
  browser?.kill();
  server?.close();
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});

test('DOM: cambio rápido de proyecto invalida respuesta tardía del proyecto anterior y conserva el proyecto vigente', { timeout: 15000 }, async () => {
  await go('/vista-previa-portal');

  // Esperar primera carga del detalle de p1
  const reqHitosP1 = await take('GET', '/api/proyectos/p1/hitos');
  const reqArchivosP1 = await take('GET', '/api/proyectos/p1/archivos');
  const reqComentariosP1 = await take('GET', '/api/proyectos/p1/comentarios');

  // Asegurar que el selector de proyectos esté presente en el DOM
  await waitDOM(visible('.portal-project-list .btn-tab-project'));

  // Cambiar rápidamente al Proyecto 2 antes de responder p1
  await click('.portal-project-list .btn-tab-project:last-child');

  // Tomar las solicitudes de p2
  const reqHitosP2 = await take('GET', '/api/proyectos/p2/hitos');
  const reqArchivosP2 = await take('GET', '/api/proyectos/p2/archivos');
  const reqComentariosP2 = await take('GET', '/api/proyectos/p2/comentarios');

  // Responder primero p2 exitosamente con sus datos
  await finish(reqHitosP2, 200, [
    { id: 'h2', proyectoId: 'p2', titulo: 'Hito Vigente de Proyecto Beta', estado: 'EN_PROGRESO', visibleEnPortal: true }
  ]);
  await finish(reqArchivosP2, 200, []);
  await finish(reqComentariosP2, 200, []);

  // Verificar que el DOM de p2 muestre su propio hito vigente
  await waitDOM('document.querySelector(".portal-milestones")?.textContent.includes("Hito Vigente de Proyecto Beta")');
  assert.equal(await evaluate('document.querySelector(".portal-p-head h2")?.textContent'), 'Proyecto Beta Segundo');

  // AHORA responder tardíamente las solicitudes del proyecto 1
  await finish(reqHitosP1, 200, [
    { id: 'h1', proyectoId: 'p1', titulo: 'Hito Tardo de Proyecto Alfa', estado: 'COMPLETADO', visibleEnPortal: true }
  ]);
  await finish(reqArchivosP1, 200, []);
  await finish(reqComentariosP1, 200, []);

  // Comprobar en el DOM renderizado:
  // El detalle NO debe haber sido sobrescrito por la respuesta tardía de p1
  const textoHitos = await evaluate('document.querySelector(".portal-milestones")?.textContent || ""');
  assert.equal(textoHitos.includes('Hito Tardo de Proyecto Alfa'), false, 'La respuesta tardía de p1 no debe sobrescribir el DOM de p2');
  assert.equal(textoHitos.includes('Hito Vigente de Proyecto Beta'), true, 'El hito vigente de p2 debe permanecer en el DOM');
});

test('DOM: llegada tardía de facturas actualiza reactivamente la vista previa sin dejarla vacía ni mostrar facturas ajenas', { timeout: 15000 }, async () => {
  interceptarFacturas = true;
  await go('/vista-previa-portal');

  // Tomar /api/facturas para retenerlo
  const reqFacturas = await take('GET', '/api/facturas');

  // Responder hitos y archivos de p1 inmediatamente
  const reqHitosP1 = await take('GET', '/api/proyectos/p1/hitos');
  const reqArchivosP1 = await take('GET', '/api/proyectos/p1/archivos');
  const reqComentariosP1 = await take('GET', '/api/proyectos/p1/comentarios');

  await finish(reqHitosP1, 200, [{ id: 'h1', proyectoId: 'p1', titulo: 'Hito 1', estado: 'COMPLETADO', visibleEnPortal: true }]);
  await finish(reqArchivosP1, 200, []);
  await finish(reqComentariosP1, 200, []);

  // El detalle ya concluyó pero las facturas aún no han llegado.
  // El DOM muestra el estado vacío inicial de facturas.
  await waitDOM('document.querySelector(".portal-invoices")?.textContent.includes("No hay facturas compartidas")');

  // AHORA llega la respuesta tardía de /api/facturas con una factura para p1 y una para p2
  await finish(reqFacturas, 200, [
    { id: 'f-p1', proyectoId: 'p1', numero: 'INV-0088', concepto: 'Factura Tardía de Alfa', monto: 1500, moneda: 'USD', visibleEnPortal: true, estado: 'ENVIADA', fechaEmision: '2026-11-01', fechaVencimiento: '2026-11-30' },
    { id: 'f-p2', proyectoId: 'p2', numero: 'INV-AJENA', concepto: 'Factura de Proyecto Beta', monto: 9999, moneda: 'USD', visibleEnPortal: true, estado: 'ENVIADA', fechaEmision: '2026-11-01', fechaVencimiento: '2026-11-30' }
  ]);

  // Verificar en el DOM renderizado:
  // La vista previa debe reaccionar a la llegada de las facturas y mostrar INV-0088
  // Y NO debe mostrar la factura del proyecto p2 (INV-AJENA)
  await waitDOM('document.querySelector(".portal-invoices")?.textContent.includes("INV-0088")');
  const textoFacturas = await evaluate('document.querySelector(".portal-invoices")?.textContent || ""');
  assert.equal(textoFacturas.includes('INV-0088'), true, 'El DOM debe mostrar la factura de p1 tras la llegada tardía');
  assert.equal(textoFacturas.includes('INV-AJENA'), false, 'El DOM NO debe mostrar facturas ajenas de p2');
});

test('DOM: fallo de carga de un proyecto anterior no contamina el proyecto vigente ni muestra error espurio', { timeout: 15000 }, async () => {
  await go('/vista-previa-portal');

  // Interceptar solicitudes iniciales de p1
  const reqHitosP1 = await take('GET', '/api/proyectos/p1/hitos');
  const reqArchivosP1 = await take('GET', '/api/proyectos/p1/archivos');
  const reqComentariosP1 = await take('GET', '/api/proyectos/p1/comentarios');

  // Esperar a que el selector esté listo y cambiar a p2
  await waitDOM(visible('.portal-project-list .btn-tab-project'));
  await click('.portal-project-list .btn-tab-project:last-child');

  // Interceptar y responder con éxito p2
  const reqHitosP2 = await take('GET', '/api/proyectos/p2/hitos');
  const reqArchivosP2 = await take('GET', '/api/proyectos/p2/archivos');
  const reqComentariosP2 = await take('GET', '/api/proyectos/p2/comentarios');

  await finish(reqHitosP2, 200, [
    { id: 'h2-ok', proyectoId: 'p2', titulo: 'Hito Exitoso de P2', estado: 'EN_PROGRESO', visibleEnPortal: true }
  ]);
  await finish(reqArchivosP2, 200, []);
  await finish(reqComentariosP2, 200, []);

  // Confirmar que p2 se renderizó correctamente
  await waitDOM('document.querySelector(".portal-milestones")?.textContent.includes("Hito Exitoso de P2")');

  // Ahora responder p1 con fallo 500
  await finish(reqHitosP1, 500, { error: 'Error del servidor en p1' });
  await finish(reqArchivosP1, 500, { error: 'Error del servidor en p1' });
  await finish(reqComentariosP1, 500, { error: 'Error del servidor en p1' });

  // Comprobar que en p2 NO apareció mensaje de error de carga y se mantiene el contenido vigente
  const errorVisible = await evaluate('!!document.querySelector(".portal-error-text")');
  assert.equal(errorVisible, false, 'El error del proyecto anterior descartado no debe mostrarse en la vista del proyecto vigente');
  const tituloVigente = await evaluate('document.querySelector(".portal-p-head h2")?.textContent');
  assert.equal(tituloVigente, 'Proyecto Beta Segundo');
});

test('DOM: cierre o destrucción del componente con solicitudes pendientes no arroja errores ni causa mutaciones residuales', { timeout: 15000 }, async () => {
  await go('/vista-previa-portal');

  // Interceptar las solicitudes de p1
  const reqHitosP1 = await take('GET', '/api/proyectos/p1/hitos');
  const reqArchivosP1 = await take('GET', '/api/proyectos/p1/archivos');
  const reqComentariosP1 = await take('GET', '/api/proyectos/p1/comentarios');

  // Destruir el componente navegando al CRM principal (ej. /proyectos) antes de que concluyan
  await click('.portal-client-info button'); // "← Volver al CRM"

  // Responder las solicitudes retenidas después de haber abandonado la página
  await finish(reqHitosP1, 200, [
    { id: 'h1-tardio', proyectoId: 'p1', titulo: 'Hito Huérfano', estado: 'COMPLETADO', visibleEnPortal: true }
  ]);
  await finish(reqArchivosP1, 200, []);
  await finish(reqComentariosP1, 200, []);

  // Verificar que la navegación al CRM ocurrió y no hay rastro ni excepciones en la pantalla
  await waitDOM('document.location.pathname === "/dashboard" || document.location.pathname === "/hoy"');
  const hayErrores = await evaluate('!!window.__ERROR_NO_CONTROLADO__');
  assert.equal(hayErrores, false, 'No deben ocurrir errores no controlados tras destruir el componente');
});

test('DOM: facturas de una sesión cerrada no se publican en el portal tras recibir respuesta tardía', { timeout: 15000 }, async () => {
  interceptarFacturas = true;
  await go('/vista-previa-portal');

  // Interceptar la solicitud de facturas de la sesión 1
  const reqFacturasOrg1 = await take('GET', '/api/facturas');

  // Responder hitos y archivos de p1 de la sesión 1
  const reqHitosP1 = await take('GET', '/api/proyectos/p1/hitos');
  const reqArchivosP1 = await take('GET', '/api/proyectos/p1/archivos');
  const reqComentariosP1 = await take('GET', '/api/proyectos/p1/comentarios');
  await finish(reqHitosP1, 200, [{ id: 'h1', proyectoId: 'p1', titulo: 'Hito 1', estado: 'COMPLETADO', visibleEnPortal: true }]);
  await finish(reqArchivosP1, 200, []);
  await finish(reqComentariosP1, 200, []);

  // Esperar a que el portal muestre el estado sin facturas
  await waitDOM('document.querySelector(".portal-invoices")?.textContent.includes("No hay facturas compartidas")');

  // Cerrar la sesión mientras la petición de facturas de Org 1 sigue en vuelo
  await evaluate(`
    sessionStorage.clear();
    window.__portalComponent.state.auth.sesionSubject.next(null);
  `);

  // AHORA responde tardíamente la solicitud de facturas de la sesión cerrada
  await finish(reqFacturasOrg1, 200, [
    { id: 'f-p1-org1', proyectoId: 'p1', numero: 'INV-ORG1-SECRETA', concepto: 'Factura Confidencial Org 1', monto: 9999, moneda: 'USD', visibleEnPortal: true, estado: 'ENVIADA', fechaEmision: '2026-11-01', fechaVencimiento: '2026-11-30' }
  ]);

  // Esperar un ciclo para que cualquier emisión reactiva se procese
  await evaluate('new Promise(resolve => setTimeout(resolve, 300))', true);

  // Verificar en el DOM: La factura de la sesión cerrada NO debe aparecer
  const textoFacturas = await evaluate('document.querySelector(".portal-invoices")?.textContent || ""');
  const numFacturasEnEstado = await evaluate('window.__portalComponent.state.facturasReales.length');
  assert.equal(numFacturasEnEstado, 0, 'No debe haber facturas en estado compartido tras cerrar sesión');
  assert.equal(textoFacturas.includes('INV-ORG1-SECRETA'), false, 'La factura confidencial de la sesión cerrada no debe renderizarse en el portal');
});

test('DOM: la vista previa reorganiza su layout en tablet y móvil sin desbordamiento horizontal', { timeout: 15000 }, async () => {
  // 1. Escritorio (1200x800)
  await go('/vista-previa-portal', 1200, 800);
  const reqHitosP1 = await take('GET', '/api/proyectos/p1/hitos');
  const reqArchivosP1 = await take('GET', '/api/proyectos/p1/archivos');
  const reqComentariosP1 = await take('GET', '/api/proyectos/p1/comentarios');
  await finish(reqHitosP1, 200, [{ id: 'h1', proyectoId: 'p1', titulo: 'Hito 1', estado: 'COMPLETADO', visibleEnPortal: true }]);
  await finish(reqArchivosP1, 200, []);
  await finish(reqComentariosP1, 200, []);

  await waitDOM(visible('.portal-detail-grid .portal-milestones'));

  const desktop = await evaluate(`(() => {
    const tabs = document.querySelector('.portal-project-list').getBoundingClientRect();
    const card = document.querySelector('.portal-project-card').getBoundingClientRect();
    const milestones = document.querySelector('.portal-milestones').getBoundingClientRect();
    const deliverables = document.querySelector('.portal-deliverables').getBoundingClientRect();
    return {
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
      tabsAboveCard: tabs.bottom <= card.top + 10,
      centeredTabs: Math.abs((tabs.left + tabs.right) / 2 - (window.innerWidth / 2)) < 35,
      centeredCard: Math.abs((card.left + card.right) / 2 - (window.innerWidth / 2)) < 35,
      twoColumnGrid: deliverables.left >= milestones.right - 10
    };
  })()`);

  assert.equal(desktop.pageFits, true, 'El escritorio no debe tener desbordamiento horizontal');
  assert.equal(desktop.tabsAboveCard, true, 'Las pestañas de proyecto deben ubicarse arriba de la tarjeta');
  assert.equal(desktop.centeredTabs, true, 'Las pestañas deben quedar centradas horizontalmente en la pantalla');
  assert.equal(desktop.centeredCard, true, 'La tarjeta del proyecto debe quedar centrada horizontalmente');
  assert.equal(desktop.twoColumnGrid, true, 'Hitos y entregables deben presentarse en dos columnas en escritorio');

  // 2. Tablet (768x1024)
  await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(true)))', true);

  const tablet = await evaluate(`(() => {
    const tabs = document.querySelector('.portal-project-list').getBoundingClientRect();
    const card = document.querySelector('.portal-project-card').getBoundingClientRect();
    const milestones = document.querySelector('.portal-milestones').getBoundingClientRect();
    const deliverables = document.querySelector('.portal-deliverables').getBoundingClientRect();
    return {
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
      stackedWorkspace: card.top >= tabs.bottom - 10,
      stackedGrid: deliverables.top >= milestones.bottom - 10
    };
  })()`);

  assert.equal(tablet.pageFits, true, 'En tablet no debe haber desbordamiento horizontal');
  assert.equal(tablet.stackedWorkspace, true, 'En tablet las pestañas se ubican arriba y la tarjeta de proyecto debajo');
  assert.equal(tablet.stackedGrid, true, 'En tablet los hitos y entregables se apilan verticalmente');

  // 3. Móvil (390x844 - iPhone)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(true)))', true);

  const mobile = await evaluate(`(() => {
    const header = document.querySelector('.portal-custom-header').getBoundingClientRect();
    const card = document.querySelector('.portal-project-card').getBoundingClientRect();
    const milestones = document.querySelector('.portal-milestones').getBoundingClientRect();
    const deliverables = document.querySelector('.portal-deliverables').getBoundingClientRect();
    return {
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
      headerFits: header.right <= window.innerWidth + 2,
      cardFits: card.right <= window.innerWidth + 2,
      stackedGrid: deliverables.top >= milestones.bottom - 10
    };
  })()`);

  assert.equal(mobile.pageFits, true, 'En móvil no debe haber desbordamiento horizontal (scrollWidth <= innerWidth)');
  assert.equal(mobile.headerFits, true, 'La cabecera debe mantenerse dentro de la pantalla del móvil');
  assert.equal(mobile.cardFits, true, 'La tarjeta del proyecto debe mantenerse dentro de la pantalla del móvil');
  assert.equal(mobile.stackedGrid, true, 'En móvil los entregables deben apilarse debajo de los hitos');
});


