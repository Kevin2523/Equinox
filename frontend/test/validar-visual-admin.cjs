const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '../..');
const bundle = path.resolve(repoRoot, 'frontend/dist/equinox/browser');
const chrome = process.env.EQUINOX_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
].find(fs.existsSync);

const outDir = process.env.EQUINOX_EVIDENCIAS_DIR || path.join(os.tmpdir(), 'equinox-evidencias-admin');
fs.mkdirSync(outDir, { recursive: true });

let server, origin, browser, socket, sessionId, profile;
let sequence = 0;
const commands = new Map();
let modoUsuarioComun = false;

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
    const body = await evaluar('document.body?.innerText || ""');
    if (body && body.includes(texto)) return body;
    await new Promise((r) => setTimeout(r, 150));
  }
  const actual = await evaluar('document.body?.innerText || ""');
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

  if (url.pathname === '/api/autenticacion/yo') {
    if (modoUsuarioComun) {
      res.writeHead(200);
      res.end(JSON.stringify({
        usuario: { id: 'u-1', correo: 'user@demo.pa', nombre: 'Usuario', apellido: 'Comun', rolPlataforma: 'USUARIO' },
        sesion: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-1', rolOrganizacion: 'PROPIETARIO' }
      }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({
      usuario: { id: 'adm-1', correo: 'admin@equinox.pa', nombre: 'Super', apellido: 'Admin', rolPlataforma: 'ADMIN_GLOBAL', mfaHabilitado: true },
      sesion: { tipoAcceso: 'ADMIN_GLOBAL', rolPlataforma: 'ADMIN_GLOBAL', mfaVerificado: true }
    }));
    return;
  }

  if (url.pathname === '/api/autenticacion/inicio-sesion' && req.method === 'POST') {
    res.writeHead(200);
    res.end(JSON.stringify({
      mfaRequerido: true,
      estadoMfa: 'VERIFICAR',
      tokenDesafioMfa: 'mfa-chal-1',
      contexto: { tipoAcceso: 'ADMIN_GLOBAL', rolPlataforma: 'ADMIN_GLOBAL' },
      usuario: { id: 'adm-1', correo: 'admin@equinox.pa', nombre: 'Super', apellido: 'Admin', rolPlataforma: 'ADMIN_GLOBAL', mfaHabilitado: true }
    }));
    return;
  }

  if (url.pathname === '/api/autenticacion/admin/mfa/verificar' && req.method === 'POST') {
    res.writeHead(200);
    res.end(JSON.stringify({
      token: 'jwt-admin-fixture',
      contexto: { tipoAcceso: 'ADMIN_GLOBAL', rolPlataforma: 'ADMIN_GLOBAL', mfaVerificado: true },
      usuario: { id: 'adm-1', correo: 'admin@equinox.pa', nombre: 'Super', apellido: 'Admin', rolPlataforma: 'ADMIN_GLOBAL', mfaHabilitado: true }
    }));
    return;
  }

  if (url.pathname === '/api/admin/resumen') {
    res.writeHead(200);
    res.end(JSON.stringify({
      organizaciones: {
        total: 4,
        activas: 3,
        suspendidas: 1,
        porTipoFreelance: { GENERAL: 2, DESARROLLO_SOFTWARE: 1, FOTOGRAFIA: 1, DISENO_GRAFICO: 0 },
        porEstadoSuscripcion: { SIN_SUSCRIPCION: 1, PRUEBA: 1, ACTIVA: 2, SUSPENDIDA: 0, CANCELADA: 0 }
      },
      usuarios: { total: 8, verificados: 7, conAccesoOrganizacion: 5, conAccesoCliente: 2, adminsGlobales: 1, sesionesActivas: 3 },
      operacion: { clientes: 14, proyectos: 9, facturas: 6, sesionesFotograficas: 3, fotos: 25 },
      auditoria: { eventosTotales: 12, eventosUltimas24h: 4 },
      actividadReciente: [{
        id: 'ev-1', accion: 'ORGANIZACION_ACTUALIZADA', entidad: 'Organizacion', entidadId: 'org-1',
        actorUsuarioId: 'adm-1', actorCorreo: 'admin@equinox.pa', creadoEn: '2026-11-17T15:00:00.000Z'
      }]
    }));
    return;
  }

  if (url.pathname === '/api/admin/organizaciones/org-1') {
    res.writeHead(200);
    res.end(JSON.stringify({
      organizacion: {
        id: 'org-1', nombre: 'Estudio Demo PA', slug: 'estudio-demo', correoContacto: 'contacto@demo.pa',
        ruc: '12345-1-67890', moneda: 'PAB', tipoFreelance: 'FOTOGRAFIA', portalMostrarFinanzas: true,
        creadoEn: '2026-10-01T12:00:00.000Z', actualizadoEn: '2026-11-17T10:00:00.000Z',
        suspendidaEn: null, motivoSuspension: null,
        conteos: { miembros: 2, clientes: 8, proyectos: 5, facturas: 3, sesionesFotograficas: 2, fotos: 25 },
        miembros: [
          { id: 'm-1', rol: 'PROPIETARIO', creadoEn: '2026-10-01T12:00:00.000Z', usuario: { id: 'u-1', nombre: 'Ana', apellido: 'Pérez', correo: 'ana@demo.pa', ultimoAccesoEn: '2026-11-17T09:00:00.000Z' } }
        ],
        suscripcion: { id: 's-1', estado: 'ACTIVA', plan: { id: 'p-1', codigo: 'BASE_MANUAL', nombre: 'Plan Base' }, fechaInicio: '2026-11-01T00:00:00.000Z', fechaFin: null, modalidadGestion: 'MANUAL_SIN_COBRO' }
      }
    }));
    return;
  }

  if (url.pathname === '/api/admin/organizaciones') {
    res.writeHead(200);
    res.end(JSON.stringify({
      datos: [{
        id: 'org-1', nombre: 'Estudio Demo PA', slug: 'estudio-demo', correoContacto: 'contacto@demo.pa',
        ruc: '12345-1-67890', moneda: 'PAB', tipoFreelance: 'FOTOGRAFIA', portalMostrarFinanzas: true,
        creadoEn: '2026-10-01T12:00:00.000Z', actualizadoEn: '2026-11-17T10:00:00.000Z',
        conteos: { miembros: 2, clientes: 8, proyectos: 5, facturas: 3, sesionesFotograficas: 2 },
        propietarios: [{ id: 'u-1', nombre: 'Ana', apellido: 'Pérez', correo: 'ana@demo.pa' }],
        suscripcion: { id: 's-1', estado: 'ACTIVA', plan: { id: 'p-1', codigo: 'BASE_MANUAL', nombre: 'Plan Base' }, fechaInicio: '2026-11-01T00:00:00.000Z', fechaFin: null, modalidadGestion: 'MANUAL_SIN_COBRO' }
      }],
      paginacion: { pagina: 1, limite: 20, total: 1, totalPaginas: 1 }
    }));
    return;
  }

  if (url.pathname === '/api/admin/usuarios') {
    res.writeHead(200);
    res.end(JSON.stringify({
      datos: [{
        id: 'u-1', correo: 'ana@demo.pa', nombre: 'Ana', apellido: 'Pérez', telefono: '+507 6000-0000',
        rolPlataforma: 'USUARIO', correoVerificadoEn: '2026-10-01T12:00:00.000Z', ultimoAccesoEn: '2026-11-17T09:00:00.000Z',
        creadoEn: '2026-10-01T12:00:00.000Z', sesionesActivasCount: 1,
        membresias: [{ id: 'm-1', organizacionId: 'org-1', organizacionNombre: 'Estudio Demo PA', organizacionSlug: 'estudio-demo', rol: 'PROPIETARIO' }],
        accesosCliente: []
      }],
      paginacion: { pagina: 1, limite: 20, total: 1, totalPaginas: 1 }
    }));
    return;
  }

  if (url.pathname === '/api/admin/suscripciones/planes') {
    res.writeHead(200);
    res.end(JSON.stringify({
      datos: [{
        id: 'p-1', codigo: 'BASE_MANUAL', nombre: 'Plan Base', descripcion: 'Plan manual operativo',
        activo: true, esPlanPrueba: false, duracionSugeridaDias: null, orden: 1,
        modalidadGestion: 'MANUAL_SIN_COBRO', etiquetaCobro: 'Manual, sin cobro procesado',
        creadoEn: '2026-11-01T00:00:00.000Z', actualizadoEn: '2026-11-01T00:00:00.000Z'
      }],
      paginacion: { pagina: 1, limite: 20, total: 1, totalPaginas: 1 },
      modalidadGestion: 'MANUAL_SIN_COBRO', etiquetaCobro: 'Manual, sin cobro procesado'
    }));
    return;
  }

  if (url.pathname === '/api/admin/suscripciones') {
    res.writeHead(200);
    res.end(JSON.stringify({
      datos: [{
        organizacion: { id: 'org-1', nombre: 'Estudio Demo PA', slug: 'estudio-demo', correoContacto: 'contacto@demo.pa', tipoFreelance: 'FOTOGRAFIA' },
        suscripcion: {
          id: 's-1', estado: 'ACTIVA', plan: { id: 'p-1', codigo: 'BASE_MANUAL', nombre: 'Plan Base', esPlanPrueba: false },
          fechaInicio: '2026-11-01T00:00:00.000Z', fechaFin: null, referenciaManual: 'Acuerdo #12',
          modalidadGestion: 'MANUAL_SIN_COBRO', etiquetaCobro: 'Manual, sin cobro procesado'
        }
      }],
      paginacion: { pagina: 1, limite: 20, total: 1, totalPaginas: 1 },
      resumenEstados: { SIN_SUSCRIPCION: 0, PRUEBA: 0, ACTIVA: 1, SUSPENDIDA: 0, CANCELADA: 0 },
      modalidadGestion: 'MANUAL_SIN_COBRO', etiquetaCobro: 'Manual, sin cobro procesado'
    }));
    return;
  }

  if (url.pathname === '/api/admin/auditoria') {
    res.writeHead(200);
    res.end(JSON.stringify({
      datos: [{
        id: 'ev-1', actorUsuarioId: 'adm-1', actorCorreo: 'admin@equinox.pa',
        accion: 'SUSCRIPCION_ASIGNADA', entidad: 'Suscripcion', entidadId: 's-1',
        ip: '127.0.0.1', userAgent: 'Chrome', metadatos: { motivo: 'Alta manual inicial' },
        creadoEn: '2026-11-17T15:00:00.000Z'
      }],
      paginacion: { pagina: 1, limite: 20, total: 1, totalPaginas: 1 }
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'No encontrado en fixture' }));
}

async function iniciar() {
  assert(chrome, 'Chrome/Edge no encontrado en el equipo');
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return manejarApi(req, res);
    const reqPath = req.url.split('?')[0];
    let archivo = path.join(bundle, reqPath === '/' ? 'index.html' : reqPath);
    if (!fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) archivo = path.join(bundle, 'index.html');
    res.writeHead(200, { 'Content-Type': mime(archivo) });
    if (path.basename(archivo) === 'index.html') {
      const html = fs.readFileSync(archivo, 'utf8').replace('<head>', `<head><script>window.__EQUINOX_API_ORIGIN__="${origin}";</script>`);
      return res.end(html);
    }
    fs.createReadStream(archivo).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://localhost:${server.address().port}`;

  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'equinox-admin-qa-'));
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const match = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { browser.stderr.off('data', onData); resolve(match[1]); }
    };
    browser.stderr.on('data', onData);
    browser.once('exit', (c) => reject(new Error(`Browser exited ${c}`)));
  });

  socket = new WebSocket(wsUrl);
  await once(socket, 'open');
  const errors = [];
  socket.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && commands.has(msg.id)) {
      const { resolve, reject } = commands.get(msg.id);
      commands.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.text || 'Exception');
    }
  });

  const target = await send('Target.createTarget', { url: `${origin}/admin/acceso?motivo=sesion-vencida` }, null);
  sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // 1. Verificar /admin/acceso con aviso de sesión vencida
  await esperarTexto('Acceso Superadmin');
  await esperarTexto('Tu sesión administrativa expiró o fue revocada');
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, '01-admin-acceso-desktop.png'), Buffer.from(shot1.data, 'base64'));

  // 2. Simular login + MFA
  await evaluar(`
    (() => {
      const correo = document.querySelector('#admin-correo');
      const pass = document.querySelector('#admin-contrasena');
      correo.value = 'admin@equinox.pa'; correo.dispatchEvent(new Event('input'));
      pass.value = 'ClaveSuper123!'; pass.dispatchEvent(new Event('input'));
      document.querySelector('form').dispatchEvent(new Event('submit'));
    })()
  `);
  await esperarTexto('Verificación MFA requerida');
  await evaluar(`
    (() => {
      const code = document.querySelector('#mfa-verify-code');
      code.value = '123456'; code.dispatchEvent(new Event('input'));
      document.querySelector('form').dispatchEvent(new Event('submit'));
    })()
  `);

  // 3. Verificar /admin/resumen
  await esperarTexto('Resumen de plataforma');
  await esperarTexto('Modalidades de estudio');
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, '02-admin-resumen-desktop.png'), Buffer.from(shot2.data, 'base64'));

  // 4. Verificar /admin/suscripciones + aviso manual
  await evaluar(`document.querySelector('a[href="/admin/suscripciones"]').click()`);
  await esperarTexto('gestión manual, no se procesan pagos');
  await esperarTexto('Estudio Demo PA');
  const shot3 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, '03-admin-suscripciones-desktop.png'), Buffer.from(shot3.data, 'base64'));

  // 5. Verificar /admin/organizaciones (acceso independiente + confirmación suspender) y /admin/usuarios y /admin/auditoria
  await evaluar(`document.querySelector('a[href="/admin/organizaciones"]').click()`);
  await esperarTexto('Estudio Demo PA');
  await esperarTexto('Acceso activo');
  await evaluar(`document.querySelector('.orgs-kebab-btn').click()`);
  await evaluar(`Array.from(document.querySelectorAll('.orgs-popover-menu button')).find(b => b.textContent.includes('Suspender acceso')).click()`);
  await esperarTexto('Suspender acceso de Estudio Demo PA');
  await evaluar(`document.querySelector('.admin-modal-close').click()`);
  await evaluar(`document.querySelector('a[href="/admin/usuarios"]').click()`);
  await esperarTexto('Ana Pérez');
  await evaluar(`document.querySelector('a[href="/admin/auditoria"]').click()`);
  await esperarTexto('SUSCRIPCION_ASIGNADA');

  // 6. Verificar responsive móvil y tabletas (320..1440 + breakpoints +/-1)
  const verificarSinDesbordamiento = async (contexto) => {
    const hallazgos = await evaluar(`
      (() => {
        const vw = window.innerWidth;
        const docScrollW = document.documentElement.scrollWidth;
        const docClientW = document.documentElement.clientWidth;
        const problemas = [];
        if (docScrollW > docClientW) {
          problemas.push('page-overflow:' + docScrollW + '>' + docClientW);
        }
        for (const el of document.querySelectorAll('body *')) {
          const st = window.getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1) {
            problemas.push('clip-right:' + el.tagName.toLowerCase() + '.' + String(el.className || '').slice(0, 40));
          }
          if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && st.textOverflow !== 'ellipsis') {
            if (!['INPUT', 'TEXTAREA', 'SELECT', 'HTML', 'BODY'].includes(el.tagName)) {
              problemas.push('internal-overflow:' + el.tagName.toLowerCase() + '.' + String(el.className || '').slice(0, 40));
            }
          }
        }
        return Array.from(new Set(problemas));
      })()
    `);
    assert.equal(hallazgos.length, 0, `Desbordamiento en ${contexto}: ${hallazgos.join(', ')}`);
  };

  const viewportsResponsive = [
    [320, 640], [390, 844], [430, 932],
    [600, 900], [639, 900], [640, 900], [641, 900],
    [767, 1024], [768, 1024], [769, 1024], [820, 1180],
    [899, 1024], [900, 1024], [901, 1024],
    [980, 1024], [981, 1024], [1024, 768],
    [1080, 800], [1081, 800], [1180, 820], [1200, 800], [1280, 800], [1440, 900]
  ];

  const rutasAudit = [
    { href: '/admin/resumen', texto: 'Resumen de plataforma' },
    { href: '/admin/organizaciones', texto: 'Estudio Demo PA' },
    { href: '/admin/usuarios', texto: 'Ana Pérez' },
    { href: '/admin/suscripciones', texto: 'Plan Base' },
    { href: '/admin/auditoria', texto: 'SUSCRIPCION_ASIGNADA' }
  ];

  for (const ruta of rutasAudit) {
    await send('Page.navigate', { url: `${origin}${ruta.href}` });
    await esperarTexto(ruta.texto);
    for (const [w, h] of viewportsResponsive) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
      await new Promise((r) => setTimeout(r, 40));
      await verificarSinDesbordamiento(`${ruta.href} (${w}x${h})`);
    }
  }

  // Verificar modal detalle en tabletas (768x1024 y 820x1180) + cierre por Escape
  await send('Page.navigate', { url: `${origin}/admin/organizaciones` });
  await esperarTexto('Estudio Demo PA');
  for (const [w, h] of [[768, 1024], [820, 1180]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 60));
    await evaluar(`Array.from(document.querySelectorAll('.orgs-mobile-actions button')).find(b => b.textContent.includes('Ver detalle')).click()`);
    await esperarTexto('Miembros (1)');
    await verificarSinDesbordamiento(`/admin/organizaciones modal (${w}x${h})`);
    await evaluar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `${origin}/admin/resumen` });
  await esperarTexto('Resumen de plataforma');
  const shot4 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, '04-admin-resumen-mobile.png'), Buffer.from(shot4.data, 'base64'));

  // 7. Verificar estado 403 cuando usuario común intenta entrar a /admin
  modoUsuarioComun = true;
  await send('Page.navigate', { url: `${origin}/admin/resumen` });
  await esperarTexto('ERROR 403');
  await esperarTexto('Acceso restringido al panel Superadmin');
  const shot5 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, '05-admin-403.png'), Buffer.from(shot5.data, 'base64'));

  assert.equal(errors.length, 0, `Errores JS en consola: ${errors.join('; ')}`);
  console.log('OK: Validación visual y funcional /admin completada sin errores.');
}

iniciar().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  try { socket?.close(); } catch {}
  try { browser?.kill(); } catch {}
  try { server?.close(); } catch {}
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});
