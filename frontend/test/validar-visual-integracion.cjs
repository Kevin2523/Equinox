// QA visual e integracion responsive para todas las rutas y modales en Chrome real.
// Usa servidor HTTP local y fixtures en memoria; sin base de datos ni mutacion real.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const bundle = path.resolve(__dirname, '../dist/equinox/browser');
const chrome = process.env.EQUINOX_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
].find(fs.existsSync);

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 }
];

const CLIENTE_1 = {
  id: 'c1',
  nombre: 'Elena Vargas',
  empresa: 'Grupo Pacífico S.A.',
  correo: 'elena@pacifico.pa',
  telefono: '+507 6123-4567',
  sitioWeb: 'https://pacifico.pa',
  estado: 'ACTIVO',
  notas: 'Cliente principal de arquitectura y branding.'
};

const PROYECTO_1 = {
  id: 'p1',
  clienteId: 'c1',
  nombre: 'San Carlos Surf Resort',
  estado: 'EN_PROGRESO',
  descripcion: 'Rediseño integral del portal de reservas y branding visual.',
  fechaEntrega: '2026-12-15T00:00:00.000Z',
  cliente: CLIENTE_1
};

const HITO_1 = {
  id: 'h1',
  proyectoId: 'p1',
  titulo: 'Arquitectura de información',
  completado: true,
  orden: 1
};

const TAREA_1 = {
  id: 't1',
  proyectoId: 'p1',
  titulo: 'Definir paleta y tokens de diseño',
  estado: 'EN_PROGRESO',
  prioridad: 'ALTA',
  fechaVencimiento: '2026-11-28T00:00:00.000Z',
  proyecto: PROYECTO_1
};

const FACTURA_1 = {
  id: 'f1',
  proyectoId: 'p1',
  clienteId: 'c1',
  numero: 'FAC-2026-001',
  estado: 'EMITIDA',
  moneda: 'USD',
  total: 2450,
  saldoPendiente: 1200,
  fechaEmision: '2026-11-01T00:00:00.000Z',
  fechaVencimiento: '2026-11-30T00:00:00.000Z',
  compartidaPortal: true,
  proyecto: PROYECTO_1,
  cliente: CLIENTE_1
};

const SESION_FOTO_1 = {
  id: 'sf1',
  clienteId: 'c1',
  titulo: 'Editorial Playa Venao',
  estado: 'ENTREGADA',
  fechaSesion: '2026-11-10T00:00:00.000Z',
  totalFotos: 2,
  publicadaPortal: true,
  cliente: CLIENTE_1,
  fotos: [
    { id: 'ph1', nombreOriginal: 'venao-01.jpg', url: '', orden: 1, seleccionada: true },
    { id: 'ph2', nombreOriginal: 'venao-02.jpg', url: '', orden: 2, seleccionada: false }
  ]
};

let authMode = 'PUBLIC'; // PUBLIC | ORG_GENERAL | ORG_FOTO | CLIENTE | ADMIN
let server, origin, browser, socket, sessionId, profile;
let seq = 0;
const pending = new Map();
const consoleErrors = [];

const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});

async function evalDOM(expression, awaitPromise = false) {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (reply.exceptionDetails) {
    throw new Error('DOM eval error: ' + JSON.stringify(reply.exceptionDetails));
  }
  return reply.result?.value;
}

const frame = () => evalDOM('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))', true);

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 430
  });
  await frame();
}

async function waitFor(condition, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await evalDOM(`(() => { try { return Boolean(${condition}); } catch { return false; } })()`);
    if (ok) return;
    await new Promise(r => setTimeout(r, 40));
  }
  throw new Error('Timeout esperando condicion: ' + condition);
}

async function pressKey(keyName) {
  const code = keyName === 'Escape' ? 27 : keyName === 'Tab' ? 9 : 13;
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: keyName,
    code: keyName,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: keyName,
    code: keyName,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code
  });
  await frame();
}

function getApiResponse(pathname) {
  if (pathname === '/api/autenticacion/yo') {
    if (authMode === 'ORG_GENERAL') {
      return {
        usuario: { id: 'u1', correo: 'studio@equinox.pa', nombre: 'Carlos', apellido: 'Mendoza', rolPlataforma: 'USUARIO' },
        sesion: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-1', rolOrganizacion: 'PROPIETARIO', tipoFreelance: 'GENERAL' }
      };
    }
    if (authMode === 'ORG_FOTO') {
      return {
        usuario: { id: 'u2', correo: 'foto@equinox.pa', nombre: 'Lucia', apellido: 'Solis', rolPlataforma: 'USUARIO' },
        sesion: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-2', rolOrganizacion: 'PROPIETARIO', tipoFreelance: 'FOTOGRAFIA' }
      };
    }
    if (authMode === 'CLIENTE') {
      return {
        usuario: { id: 'uc1', correo: 'elena@pacifico.pa', nombre: 'Elena', apellido: 'Vargas', rolPlataforma: 'USUARIO' },
        sesion: { tipoAcceso: 'CLIENTE', clienteId: 'c1', organizacionId: 'org-1', rolCliente: 'TITULAR' }
      };
    }
    if (authMode === 'ADMIN') {
      return {
        usuario: { id: 'adm1', correo: 'admin@equinox.pa', nombre: 'Super', apellido: 'Admin', rolPlataforma: 'ADMIN_GLOBAL', mfaHabilitado: true },
        sesion: { tipoAcceso: 'ADMIN_GLOBAL', rolPlataforma: 'ADMIN_GLOBAL', mfaVerificado: true }
      };
    }
    return null;
  }

  if (pathname.startsWith('/api/invitaciones/')) {
    return {
      valida: true,
      clienteNombre: 'Elena Vargas',
      organizacionNombre: 'Estudio Equinox',
      correo: 'elena@pacifico.pa'
    };
  }

  if (pathname === '/api/organizacion') {
    const isFoto = authMode === 'ORG_FOTO';
    return {
      id: isFoto ? 'org-2' : 'org-1',
      nombre: isFoto ? 'Atelier Fotográfico Solís' : 'Estudio Equinox',
      slug: isFoto ? 'atelier-solis' : 'estudio-equinox',
      tipoFreelance: isFoto ? 'FOTOGRAFIA' : 'GENERAL',
      colorPrimario: '#2563EB',
      colorSecundario: '#0F172A',
      mensajeBienvenida: 'Bienvenido a tu espacio privado de seguimiento.',
      portalMostrarFinanzas: true
    };
  }

  if (pathname === '/api/clientes') return [CLIENTE_1];
  if (pathname === '/api/proyectos') return [PROYECTO_1];
  if (pathname === '/api/proyectos/p1') return PROYECTO_1;
  if (pathname === '/api/proyectos/p1/hitos') return [HITO_1];
  if (pathname === '/api/proyectos/p1/comentarios') return [];
  if (pathname === '/api/proyectos/p1/archivos') return [];
  if (pathname === '/api/tareas') return [TAREA_1];
  if (pathname === '/api/facturas') return [FACTURA_1];
  if (pathname === '/api/facturas/totales') {
    return { totalesPorMoneda: [{ moneda: 'USD', totalFacturado: 2450, totalPagado: 1250, totalPendiente: 1200 }] };
  }
  if (pathname === '/api/sesiones-fotograficas') return [SESION_FOTO_1];
  if (pathname === '/api/sesiones-fotograficas/sf1') return SESION_FOTO_1;
  if (pathname === '/api/portal/yo') {
    return {
      cliente: CLIENTE_1,
      organizacion: {
        id: 'org-1',
        nombre: 'Estudio Equinox',
        tipoFreelance: 'GENERAL',
        colorPrimario: '#2563EB',
        colorSecundario: '#0F172A',
        mensajeBienvenida: 'Bienvenido a tu espacio privado de seguimiento.',
        portalMostrarFinanzas: true
      }
    };
  }
  if (pathname === '/api/portal/proyectos') return [PROYECTO_1];
  if (pathname === '/api/portal/proyectos/p1') return { ...PROYECTO_1, hitos: [HITO_1], comentarios: [], archivos: [] };
  if (pathname === '/api/portal/facturas') return [FACTURA_1];
  if (pathname === '/api/portal/sesiones') return [];

  if (pathname === '/api/admin/resumen') {
    return {
      organizaciones: {
        total: 4, activas: 3, suspendidas: 1,
        porTipoFreelance: { GENERAL: 2, DESARROLLO_SOFTWARE: 1, FOTOGRAFIA: 1, DISENO_GRAFICO: 0 },
        porEstadoSuscripcion: { SIN_SUSCRIPCION: 1, PRUEBA: 1, ACTIVA: 2, SUSPENDIDA: 0, CANCELADA: 0 }
      },
      usuarios: { total: 8, verificados: 7, conAccesoOrganizacion: 5, conAccesoCliente: 2, adminsGlobales: 1, sesionesActivas: 3 },
      operacion: { clientes: 14, proyectos: 9, facturas: 6, sesionesFotograficas: 3, fotos: 25 },
      auditoria: { eventosTotales: 12, eventosUltimas24h: 4 },
      actividadReciente: [{
        id: 'ev-1', accion: 'ORGANIZACION_ACTUALIZADA', entidad: 'Organizacion', entidadId: 'org-1',
        actorUsuarioId: 'adm1', actorCorreo: 'admin@equinox.pa', creadoEn: '2026-11-17T15:00:00.000Z'
      }]
    };
  }
  if (pathname === '/api/admin/organizaciones') {
    return {
      items: [{
        id: 'org-1', nombre: 'Estudio Equinox', slug: 'estudio-equinox',
        tipoFreelance: 'GENERAL', activa: true, estadoSuscripcion: 'ACTIVA', planNombre: 'Pro'
      }],
      total: 1, pagina: 1, limite: 20
    };
  }
  if (pathname === '/api/admin/usuarios') {
    return {
      items: [{
        id: 'u1', correo: 'studio@equinox.pa', nombre: 'Carlos', apellido: 'Mendoza',
        rolPlataforma: 'USUARIO', verificado: true, organizaciones: 1, sesionesActivas: 1
      }],
      total: 1, pagina: 1, limite: 20
    };
  }
  if (pathname === '/api/admin/suscripciones') {
    return {
      items: [{
        organizacionId: 'org-1', organizacionNombre: 'Estudio Equinox', estado: 'ACTIVA',
        planNombre: 'Pro', moneda: 'USD', montoMensual: 29, renovacionEn: '2026-12-01T00:00:00.000Z'
      }],
      total: 1, pagina: 1, limite: 20
    };
  }
  if (pathname === '/api/admin/auditoria') {
    return {
      items: [{
        id: 'ev-1', accion: 'ORGANIZACION_ACTUALIZADA', entidad: 'Organizacion', entidadId: 'org-1',
        actorUsuarioId: 'adm1', actorCorreo: 'admin@equinox.pa', creadoEn: '2026-11-17T15:00:00.000Z', detalle: {}
      }],
      total: 1, pagina: 1, limite: 20
    };
  }
  return [];
}

async function navigate(route, mode) {
  authMode = mode;
  await setViewport(1280, 800);
  await send('Page.navigate', { url: origin + route });
  await waitFor(`location.pathname === ${JSON.stringify(route)} || (location.pathname !== '/' && document.body && document.body.innerText.trim().length > 20)`);
  await frame();
  await new Promise(r => setTimeout(r, 180));
}

async function inspectViewport(label, vp) {
  await setViewport(vp.width, vp.height);
  await new Promise(r => setTimeout(r, 60));
  const data = await evalDOM(`(() => {
    const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const offenders = [];
    const els = document.querySelectorAll('body *');
    for (const el of els) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right > window.innerWidth + 2 || rect.left < -2) {
        // Check if clipped by an ancestor with overflow hidden/clip/auto/scroll
        let clipped = false;
        let p = el.parentElement;
        while (p && p !== document.body && p !== document.documentElement) {
          const pst = getComputedStyle(p);
          if (['hidden', 'clip', 'auto', 'scroll'].includes(pst.overflowX) || ['hidden', 'clip'].includes(pst.overflow)) {
            const pr = p.getBoundingClientRect();
            if (pr.right <= window.innerWidth + 2 && pr.left >= -2) {
              clipped = true;
              break;
            }
          }
          p = p.parentElement;
        }
        if (!clipped) {
          offenders.push({
            tag: el.tagName,
            cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            vw: window.innerWidth
          });
        }
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      docOverflow,
      offenders: offenders.slice(0, 6)
    };
  })()`);

  if (data.docOverflow || data.offenders.length > 0) {
    return `${label} @ ${vp.width}x${vp.height}: scrollWidth=${data.scrollWidth} innerWidth=${data.innerWidth} offenders=${JSON.stringify(data.offenders)}`;
  }
  return null;
}

async function run() {
  assert.ok(chrome, 'Chrome/Edge no encontrado');
  assert.ok(fs.existsSync(path.join(bundle, 'index.html')), 'Falta dist; ejecuta npm run compilar');

  server = http.createServer((req, res) => {
    const url = new URL(req.url, origin || 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const payload = getApiResponse(url.pathname);
      if (payload === null && url.pathname === '/api/autenticacion/yo') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ mensaje: 'No autenticado' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(payload));
    }

    const filePath = path.resolve(bundle, '.' + url.pathname);
    if (filePath.startsWith(bundle + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const type = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      return res.end(fs.readFileSync(filePath));
    }

    const tokenScript = authMode === 'PUBLIC'
      ? `window.__EQUINOX_API_ORIGIN__=location.origin;sessionStorage.removeItem('equinox_sesion_token');`
      : `window.__EQUINOX_API_ORIGIN__=location.origin;sessionStorage.setItem('equinox_sesion_token','fixture-token');`;
    const html = fs.readFileSync(path.join(bundle, 'index.html'), 'utf8')
      .replace('<head>', `<head><script>${tokenScript}</script>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = `http://localhost:${server.address().port}`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'equinox-qa-int-'));
  browser = spawn(chrome, [
    '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    browser.on('error', reject);
    browser.stderr.on('data', d => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) resolve(m[1]);
    });
  });

  socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };

  const { targetInfos } = await send('Target.getTargets', {}, null);
  const page = targetInfos.find(t => t.type === 'page') || targetInfos[0];
  sessionId = (await send('Target.attachToTarget', { targetId: page.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable');
  await send('Runtime.enable');

  socket.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params?.exceptionDetails?.text || 'Runtime exception');
    }
  });

  const issues = [];

  const routesToTest = [
    { route: '/inicio-sesion', mode: 'PUBLIC' },
    { route: '/registro', mode: 'PUBLIC' },
    { route: '/recuperar-contrasena', mode: 'PUBLIC' },
    { route: '/invitacion/tok-demo', mode: 'PUBLIC' },
    { route: '/admin/acceso', mode: 'PUBLIC' },
    { route: '/admin/sin-acceso', mode: 'PUBLIC' },
    { route: '/ruta-inexistente', mode: 'PUBLIC' },
    { route: '/dashboard', mode: 'ORG_GENERAL' },
    { route: '/clientes', mode: 'ORG_GENERAL' },
    { route: '/proyectos', mode: 'ORG_GENERAL' },
    { route: '/tareas', mode: 'ORG_GENERAL' },
    { route: '/finanzas', mode: 'ORG_GENERAL' },
    { route: '/configuracion', mode: 'ORG_GENERAL' },
    { route: '/vista-previa-portal', mode: 'ORG_GENERAL' },
    { route: '/clientes', mode: 'ORG_FOTO', label: '/clientes (FOTOGRAFIA)' },
    { route: '/portal', mode: 'CLIENTE' },
    { route: '/admin/resumen', mode: 'ADMIN' },
    { route: '/admin/organizaciones', mode: 'ADMIN' },
    { route: '/admin/usuarios', mode: 'ADMIN' },
    { route: '/admin/suscripciones', mode: 'ADMIN' },
    { route: '/admin/auditoria', mode: 'ADMIN' }
  ];

  for (const item of routesToTest) {
    await navigate(item.route, item.mode);
    const actualPath = await evalDOM('location.pathname');
    console.log(`ROUTE ${item.label || item.route} -> ${actualPath}`);
    for (const vp of VIEWPORTS) {
      const issue = await inspectViewport(`${item.label || item.route} [${actualPath}]`, vp);
      if (issue) {
        issues.push(issue);
        console.log('ISSUE:', issue);
      }
    }
  }

  // Test global overlays & topbar interactions at 320, 390, 768, 1280
  await navigate('/clientes', 'ORG_GENERAL');
  await waitFor('document.querySelector("app-topbar")');
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[4], VIEWPORTS[5]]) {
    await setViewport(vp.width, vp.height);

    // 1. Mobile nav drawer (<= 780)
    if (vp.width <= 780) {
      await evalDOM('document.querySelector(".mobile-toggle").click()');
      await waitFor('document.querySelector(".mobile-nav-drawer")');
      const drawerIssue = await inspectViewport('mobile-nav-drawer', vp);
      if (drawerIssue) { issues.push(drawerIssue); console.log('ISSUE:', drawerIssue); }
      await pressKey('Escape');
    }

    // 2. Profile dropdown
    await evalDOM('document.querySelector(".profile-menu-wrap .profile").click()');
    await waitFor('document.querySelector(".profile-dropdown")');
    const profIssue = await inspectViewport('profile-dropdown', vp);
    if (profIssue) { issues.push(profIssue); console.log('ISSUE:', profIssue); }
    await pressKey('Escape');

    // 3. Notifications popover
    await evalDOM('document.querySelector(".notif-bell").click()');
    await waitFor('document.querySelector(".notif-popover")');
    const notifIssue = await inspectViewport('notif-popover', vp);
    if (notifIssue) { issues.push(notifIssue); console.log('ISSUE:', notifIssue); }
    await pressKey('Escape');

    // 4. Search overlay + Escape
    await evalDOM('document.querySelector("#openSearch").click()');
    await waitFor('document.querySelector(".search-overlay")');
    const searchIssue = await inspectViewport('search-overlay', vp);
    if (searchIssue) { issues.push(searchIssue); console.log('ISSUE:', searchIssue); }
    await pressKey('Escape');
    await waitFor('!document.querySelector(".search-overlay")');
  }

  // 4b. Test quick-modal (.quick-modal) on /dashboard at 1280 and page modals at 320, 390, 768, 1280
  await navigate('/dashboard', 'ORG_GENERAL');
  await setViewport(1280, 800);
  await evalDOM('document.querySelector("#createBtn")?.click()');
  await waitFor('document.querySelector(".quick-modal")');
  const qmIssue = await inspectViewport('quick-modal@/dashboard', VIEWPORTS[5]);
  if (qmIssue) { issues.push(qmIssue); console.log('ISSUE:', qmIssue); }
  await pressKey('Escape');
  await waitFor('!document.querySelector(".quick-modal")');

  const modalRoutes = [
    { route: '/clientes', btnText: 'Nuevo cliente' },
    { route: '/proyectos', btnText: 'Nuevo proyecto' },
    { route: '/tareas', btnText: 'Nueva tarea' },
    { route: '/finanzas', btnText: 'Nueva factura' }
  ];
  for (const mr of modalRoutes) {
    await navigate(mr.route, 'ORG_GENERAL');
    for (const vp of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[4], VIEWPORTS[5]]) {
      await setViewport(vp.width, vp.height);
      const clicked = await evalDOM(`(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent && b.textContent.includes(${JSON.stringify(mr.btnText)}));
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      if (clicked) {
        await waitFor('document.querySelector(".overlay, .modal-backdrop, .quick-modal, .modal-card")');
        const mIssue = await inspectViewport(`modal@${mr.route}`, vp);
        if (mIssue) { issues.push(mIssue); console.log('ISSUE:', mIssue); }
        await pressKey('Escape');
        await new Promise(r => setTimeout(r, 80));
      }
    }
  }

  // 5. Check switch-control in /configuracion & portal-hero SVG
  await navigate('/configuracion', 'ORG_GENERAL');
  const cfgCheck = await evalDOM(`(() => {
    const sw = document.querySelector('#portalFacturasSwitchRapido');
    const r = sw ? sw.getBoundingClientRect() : null;
    const before = sw ? getComputedStyle(sw, '::before') : null;
    return {
      switchRect: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      hasBeforeContent: before ? before.content : null
    };
  })()`);

  await navigate('/portal', 'CLIENTE');
  const heroCheck = await evalDOM(`(() => {
    const hero = document.querySelector('.portal-hero');
    const svg = document.querySelector('.camera-hero-svg');
    const hr = hero ? hero.getBoundingClientRect() : null;
    const sr = svg ? svg.getBoundingClientRect() : null;
    return {
      heroOverflow: hero ? getComputedStyle(hero).overflow : null,
      heroRect: hr ? { w: Math.round(hr.width), h: Math.round(hr.height) } : null,
      svgRect: sr ? { w: Math.round(sr.width), h: Math.round(sr.height) } : null
    };
  })()`);

  // 6. Check Hoy (/dashboard) layout at 320, 390, 768, 1280
  await navigate('/dashboard', 'ORG_GENERAL');
  const hoyChecks = {};
  for (const w of [320, 390, 768, 1280]) {
    await setViewport(w, 800);
    hoyChecks[w] = await evalDOM(`(() => {
      const frame = document.querySelector('.map-frame');
      const insp = document.querySelector('.inspector');
      const fr = frame ? frame.getBoundingClientRect() : null;
      const ir = insp ? insp.getBoundingClientRect() : null;
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        mapFrameH: fr ? Math.round(fr.height) : null,
        inspectorTop: ir ? Math.round(ir.top) : null
      };
    })()`);
  }

  console.log('CFG_CHECK:', JSON.stringify(cfgCheck));
  console.log('HERO_CHECK:', JSON.stringify(heroCheck));
  console.log('HOY_CHECKS:', JSON.stringify(hoyChecks));
  console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors));
  console.log('ISSUES_COUNT:', issues.length);
  for (const iss of issues) console.log('ISSUE:', iss);

  if (consoleErrors.length > 0 || issues.length > 0) {
    process.exitCode = 1;
  }
}

run().finally(async () => {
  try { socket?.close(); } catch {}
  try { browser?.kill(); } catch {}
  try { server?.close(); } catch {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});
