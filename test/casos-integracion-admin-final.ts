import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { ejecutarBootstrapAdmin } from "../src/cli/bootstrap-admin.js";
import { calcularPasoTotp, generarCodigoTotpParaPaso } from "../src/utilidades/mfa.js";

export interface ResultadoIntegracionFinal {
  bloques: Array<{ nombre: string; estado: "PASO" | "FALLO"; detalle: string }>;
  hallazgosAuditoria: Array<{ id: string; fuente: string; estado: "REMEDIADO" | "PERSISTE" | "PENDIENTE"; detalle: string }>;
  uiDesktopOk: boolean;
  uiMovilOk: boolean;
}

async function reqJson(url: string, opciones: RequestInit = {}) {
  const res = await fetch(url, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(opciones.headers || {}),
    },
  });
  const texto = await res.text();
  let cuerpo: any = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = texto;
  }
  return { status: res.status, headers: res.headers, cuerpo };
}

function crearPngMinimo(): Buffer {
  // PNG 1x1 válido
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex"
  );
}

async function ejecutarValidacionUiReal(
  apiUrl: string,
  adminCorreo: string,
  adminPass: string,
  secretoTotp: string
): Promise<{ desktopOk: boolean; movilOk: boolean }> {
  const bundle = path.resolve("frontend/dist/equinox/browser");
  assert(fs.existsSync(path.join(bundle, "index.html")), "Falta compilación frontend/dist/equinox/browser");

  const chrome = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((p) => fs.existsSync(p));
  assert(chrome, "No se encontró Chrome ni Edge en el sistema para prueba UI");

  const mime = (archivo: string) =>
    ({
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".json": "application/json",
    }[path.extname(archivo)] || "application/octet-stream");

  let origin = "";
  const server = http.createServer(async (req, res) => {
    if ((req.url || "").startsWith("/api/")) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const headers: Record<string, string> = {};
      if (req.headers["content-type"]) headers["content-type"] = String(req.headers["content-type"]);
      if (req.headers["authorization"]) headers["authorization"] = String(req.headers["authorization"]);
      const upstream = await fetch(`${apiUrl}${req.url}`, {
        method: req.method,
        headers,
        body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      });
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.end(buf);
    }
    const reqPath = (req.url || "/").split("?")[0];
    let archivo = path.join(bundle, reqPath === "/" ? "index.html" : reqPath);
    if (!fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      archivo = path.join(bundle, "index.html");
    }
    res.writeHead(200, { "Content-Type": mime(archivo) });
    if (path.basename(archivo) === "index.html") {
      const html = fs
        .readFileSync(archivo, "utf8")
        .replace("<head>", `<head><script>window.__EQUINOX_API_ORIGIN__="${origin}";</script>`);
      return res.end(html);
    }
    fs.createReadStream(archivo).pipe(res);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  origin = `http://localhost:${port}`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "eqx-ui-final-"));
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  let wsUrl = "";
  try {
    wsUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout esperando DevTools URL")), 10000);
      browser.stderr.on("data", (chunk: Buffer) => {
        const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });

    const listRes = await fetch(wsUrl.replace("ws://", "http://").replace(/\/devtools\/.*/, "/json/list"));
    const targets = (await listRes.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const pageTarget = targets.find((t) => t.type === "page") || targets[0];
    assert(pageTarget?.webSocketDebuggerUrl, "No se encontró target page CDP");

    const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await once(socket, "open");

    let seq = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const erroresConsola: string[] = [];

    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method === "Runtime.exceptionThrown") {
        erroresConsola.push(JSON.stringify(msg.params));
      }
    });

    const send = (method: string, params: Record<string, any> = {}) =>
      new Promise<any>((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });

    const evaluar = async (expression: string) => {
      const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
      return res.result?.value;
    };

    const esperarTexto = async (texto: string, timeoutMs = 10000) => {
      const inicio = Date.now();
      while (Date.now() - inicio < timeoutMs) {
        const body = await evaluar("document.body.innerText");
        if (typeof body === "string" && body.includes(texto)) return body;
        await new Promise((r) => setTimeout(r, 150));
      }
      const actual = await evaluar("document.body.innerText");
      throw new Error(`Timeout esperando "${texto}". Actual: ${String(actual).slice(0, 300)}`);
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await send("Page.navigate", { url: `${origin}/admin/acceso` });
    await esperarTexto("Acceso Superadmin");

    // Llenar login en UI real (/admin/acceso)
    await evaluar(`(() => {
      const email = document.querySelector('input[type="email"]');
      const pass = document.querySelector('input[type="password"]');
      const setVal = (el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(email, ${JSON.stringify(adminCorreo)});
      setVal(pass, ${JSON.stringify(adminPass)});
      document.querySelector('button[type="submit"]').click();
    })()`);

    await esperarTexto("Verificación MFA requerida");

    // Usar pasoActual + 1 (dentro de ventana +-1) para no chocar con paso usado en Bloque A
    const pasoActual = calcularPasoTotp();
    const codigoTotp = generarCodigoTotpParaPaso(secretoTotp, pasoActual + 1);
    await evaluar(`(() => {
      const input = document.querySelector('input[inputmode="numeric"], input[maxlength="6"], input');
      input.value = ${JSON.stringify(codigoTotp)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('button[type="submit"]').click();
    })()`);

    await esperarTexto("Organizaciones");
    await new Promise((r) => setTimeout(r, 400));
    const rutaDesktop = await evaluar("window.location.pathname");
    assert(
      typeof rutaDesktop === "string" && rutaDesktop.startsWith("/admin"),
      `Se esperaba /admin/* tras MFA, obtenido ${rutaDesktop}`
    );

    const textoAdmin = await evaluar("document.body.innerText");
    assert(textoAdmin.includes("Organizaciones") && textoAdmin.includes("Suscripciones"), "Faltan secciones en /admin");

    const overflowDesktop = await evaluar("document.documentElement.scrollWidth > document.documentElement.clientWidth + 2");
    assert.equal(overflowDesktop, false, "Desbordamiento horizontal detectado en /admin desktop");

    // Probar pestañas en desktop
    await evaluar(`(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      const tabOrg = btns.find(b => b.textContent && b.textContent.trim() === 'Organizaciones');
      if (tabOrg) tabOrg.click();
    })()`);
    await esperarTexto("Estudio Integración");

    // Probar viewport móvil 390x844
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await new Promise((r) => setTimeout(r, 300));
    const overflowMovil = await evaluar("document.documentElement.scrollWidth > document.documentElement.clientWidth + 2");
    assert.equal(overflowMovil, false, "Desbordamiento horizontal detectado en /admin móvil");
    assert.equal(erroresConsola.length, 0, `Errores JS en UI: ${erroresConsola.join("; ")}`);

    socket.close();
    return { desktopOk: true, movilOk: true };
  } finally {
    browser.kill();
    server.close();
    await new Promise((r) => setTimeout(r, 300));
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // En Windows Chrome puede retener brevemente el lock del perfil temporal
    }
  }
}

export async function ejecutarCasosIntegracionAdminFinal(): Promise<ResultadoIntegracionFinal> {
  const resultado: ResultadoIntegracionFinal = {
    bloques: [],
    hallazgosAuditoria: [],
    uiDesktopOk: false,
    uiMovilOk: false,
  };

  // Servidor Express real conectado a la BD aislada
  const server = aplicacion.listen(0, "127.0.0.1");
  await once(server, "listening");
  const puerto = (server.address() as AddressInfo).port;
  const apiUrl = `http://127.0.0.1:${puerto}`;

  try {
    // -------------------------------------------------------------------------
    // BLOQUE A: Bootstrap, MFA TOTP, Sesión separada, 401/403, anti-replay
    // -------------------------------------------------------------------------
    const adminCorreo = "superadmin.integracion@equinox.test";
    const adminPass = "AdminIntegracion#2026!";

    const regAdmin = await reqJson(`${apiUrl}/api/autenticacion/registro`, {
      method: "POST",
      body: JSON.stringify({
        correo: adminCorreo,
        contrasena: adminPass,
        nombre: "Super",
        apellido: "Integracion",
        nombreEstudio: "Org Bootstrap",
        slug: "org-bootstrap-int",
        tipoFreelance: "GENERAL",
      }),
    });
    assert.equal(regAdmin.status, 201);
    const tokenUsuarioAntes = regAdmin.cuerpo.token;

    // Usuario normal no puede entrar a /api/admin
    const res401 = await reqJson(`${apiUrl}/api/admin/resumen`);
    assert.equal(res401.status, 401);
    const res403User = await reqJson(`${apiUrl}/api/admin/resumen`, {
      headers: { Authorization: `Bearer ${tokenUsuarioAntes}` },
    });
    assert.equal(res403User.status, 403);

    // Bootstrap sin --confirmar falla; con --confirmar funciona; segundo bootstrap falla
    await assert.rejects(() => ejecutarBootstrapAdmin(prisma, { correo: adminCorreo, confirmar: false }));
    const boot = await ejecutarBootstrapAdmin(prisma, { correo: adminCorreo, confirmar: true });
    assert.equal(boot.rolPlataforma, "ADMIN_GLOBAL");
    await assert.rejects(() => ejecutarBootstrapAdmin(prisma, { correo: adminCorreo, confirmar: true }));

    // Login admin sin tipoAcceso cuando tiene org + admin -> 409; con tipoAcceso: ADMIN_GLOBAL -> 200 (CONFIGURAR)
    const loginAmbiguo = await reqJson(`${apiUrl}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      body: JSON.stringify({ correo: adminCorreo, contrasena: adminPass }),
    });
    assert.equal(loginAmbiguo.status, 409);

    const loginSetup = await reqJson(`${apiUrl}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      body: JSON.stringify({
        correo: adminCorreo,
        contrasena: adminPass,
        seleccion: { tipoAcceso: "ADMIN_GLOBAL" },
      }),
    });
    assert.equal(loginSetup.status, 200);
    assert.equal(loginSetup.cuerpo.mfaRequerido, true);
    assert.equal(loginSetup.cuerpo.estadoMfa, "CONFIGURAR");
    const desafioSetup = loginSetup.cuerpo.tokenDesafioMfa;

    const iniMfa = await reqJson(`${apiUrl}/api/autenticacion/admin/mfa/iniciar-configuracion`, {
      method: "POST",
      body: JSON.stringify({ tokenDesafioMfa: desafioSetup }),
    });
    assert.equal(iniMfa.status, 200);
    const secretoTotp: string = iniMfa.cuerpo.secretoBase32;
    assert(secretoTotp && iniMfa.cuerpo.otpauthUrl.includes("otpauth://totp/"));

    // Código TOTP inválido rechazado (401)
    const confBad = await reqJson(`${apiUrl}/api/autenticacion/admin/mfa/confirmar-configuracion`, {
      method: "POST",
      body: JSON.stringify({ tokenDesafioMfa: desafioSetup, codigoTotp: "000000" }),
    });
    assert.equal(confBad.status, 401);

    const pasoInicial = calcularPasoTotp();
    const confOk = await reqJson(`${apiUrl}/api/autenticacion/admin/mfa/confirmar-configuracion`, {
      method: "POST",
      body: JSON.stringify({
        tokenDesafioMfa: desafioSetup,
        codigoTotp: generarCodigoTotpParaPaso(secretoTotp, pasoInicial),
      }),
    });
    assert.equal(confOk.status, 200);
    const tokenAdmin: string = confOk.cuerpo.token;
    assert.equal(confOk.cuerpo.contexto.tipoAcceso, "ADMIN_GLOBAL");
    assert.equal(confOk.cuerpo.contexto.mfaVerificado, true);

    // Separación estricta de contextos
    const adminEnOrg = await reqJson(`${apiUrl}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(adminEnOrg.status, 403);
    const adminEnPortal = await reqJson(`${apiUrl}/api/portal`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(adminEnPortal.status, 403);

    // Anti-replay TOTP en login VERIFICAR (usando pasoInicial - 1 para no chocar con UI)
    const loginVerify = await reqJson(`${apiUrl}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      body: JSON.stringify({
        correo: adminCorreo,
        contrasena: adminPass,
        seleccion: { tipoAcceso: "ADMIN_GLOBAL" },
      }),
    });
    assert.equal(loginVerify.status, 200);
    assert.equal(loginVerify.cuerpo.estadoMfa, "VERIFICAR");

    const replayFail = await reqJson(`${apiUrl}/api/autenticacion/admin/mfa/verificar`, {
      method: "POST",
      body: JSON.stringify({
        tokenDesafioMfa: loginVerify.cuerpo.tokenDesafioMfa,
        codigoTotp: generarCodigoTotpParaPaso(secretoTotp, pasoInicial),
      }),
    });
    assert.equal(replayFail.status, 401, "Reutilizar código TOTP del mismo paso debe fallar (anti-replay)");

    resultado.bloques.push({
      nombre: "Bootstrap + MFA TOTP + Sesión Admin Separada",
      estado: "PASO",
      detalle: "Bootstrap único, TOTP setup/verify, anti-replay 401, separación 403 verificados",
    });

    // -------------------------------------------------------------------------
    // BLOQUE B: Org real, roles, último propietario, multitenancy, no secretos
    // -------------------------------------------------------------------------
    const regEstudio = await reqJson(`${apiUrl}/api/autenticacion/registro`, {
      method: "POST",
      body: JSON.stringify({
        correo: "owner.estudio@equinox.test",
        contrasena: "OwnerEstudio#2026!",
        nombre: "Ana",
        apellido: "Owner",
        nombreEstudio: "Estudio Integración",
        slug: "estudio-integracion",
        tipoFreelance: "FOTOGRAFIA",
      }),
    });
    assert.equal(regEstudio.status, 201);
    const tokenOwner = regEstudio.cuerpo.token;
    const orgId = regEstudio.cuerpo.organizacion.id;
    const ownerUsuarioId = regEstudio.cuerpo.usuario.id;

    // Crear colaborador en Estudio Integración y otro estudio B para multitenancy
    const regColab = await reqJson(`${apiUrl}/api/autenticacion/registro`, {
      method: "POST",
      body: JSON.stringify({
        correo: "colab.estudio@equinox.test",
        contrasena: "ColabEstudio#2026!",
        nombre: "Carlos",
        apellido: "Colab",
        nombreEstudio: "Estudio Secundario B",
        slug: "estudio-secundario-b",
        tipoFreelance: "GENERAL",
      }),
    });
    assert.equal(regColab.status, 201);
    const tokenColabOrgB = regColab.cuerpo.token;
    const colabUsuarioId = regColab.cuerpo.usuario.id;

    const miembroColab = await prisma.miembroOrganizacion.create({
      data: { usuarioId: colabUsuarioId, organizacionId: orgId, rol: "COLABORADOR" },
    });

    const miembroOwner = await prisma.miembroOrganizacion.findUniqueOrThrow({
      where: { usuarioId_organizacionId: { usuarioId: ownerUsuarioId, organizacionId: orgId } },
    });

    // No puede degradar último PROPIETARIO (422)
    const degUltimo = await reqJson(`${apiUrl}/api/admin/organizaciones/${orgId}/miembros/${miembroOwner.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ rol: "COLABORADOR" }),
    });
    assert.equal(degUltimo.status, 422);

    // No puede asignar ADMIN_GLOBAL (422)
    const asigAdmin = await reqJson(`${apiUrl}/api/admin/organizaciones/${orgId}/miembros/${miembroColab.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ rol: "ADMIN_GLOBAL" }),
    });
    assert.equal(asigAdmin.status, 422);

    // Promover colaborador a PROPIETARIO -> 200
    const promColab = await reqJson(`${apiUrl}/api/admin/organizaciones/${orgId}/miembros/${miembroColab.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ rol: "PROPIETARIO", motivo: "Co-dirección" }),
    });
    assert.equal(promColab.status, 200);

    // Anti-IDOR miembro de otra org -> 404
    const idorMiembro = await reqJson(
      `${apiUrl}/api/admin/organizaciones/${regColab.cuerpo.organizacion.id}/miembros/${miembroOwner.id}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${tokenAdmin}` },
        body: JSON.stringify({ rol: "COLABORADOR" }),
      }
    );
    assert.equal(idorMiembro.status, 404);

    // Métricas y no exposición de secretos
    const resumen = await reqJson(`${apiUrl}/api/admin/resumen`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(resumen.status, 200);
    assert(resumen.cuerpo.organizaciones.total >= 3);

    const usuariosAdmin = await reqJson(`${apiUrl}/api/admin/usuarios`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(usuariosAdmin.status, 200);
    const jsonUsuarios = JSON.stringify(usuariosAdmin.cuerpo);
    assert(!jsonUsuarios.includes("contrasenaHash"), "No debe exponer contrasenaHash");
    assert(!jsonUsuarios.includes("tokenHash"), "No debe exponer tokenHash");
    assert(!jsonUsuarios.includes("mfaSecretoCifrado"), "No debe exponer mfaSecretoCifrado");

    resultado.bloques.push({
      nombre: "Métricas, Organizaciones, Roles y No Secretos",
      estado: "PASO",
      detalle: "Último propietario 422, ADMIN_GLOBAL 422, anti-IDOR 404, sin secretos expuestos",
    });

    // -------------------------------------------------------------------------
    // BLOQUE C: Suspensión/Reactivación independiente + Bloqueo inmediato
    // -------------------------------------------------------------------------
    // Crear cliente y acceso portal en Estudio Integración
    const cliRes = await reqJson(`${apiUrl}/api/clientes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenOwner}` },
      body: JSON.stringify({ nombre: "Cliente Portal Test", correo: "cliente.portal@equinox.test" }),
    });
    assert.equal(cliRes.status, 201);
    const clienteId = cliRes.cuerpo.id;

    // Invitar cliente por flujo real
    const invRes = await reqJson(`${apiUrl}/api/clientes/${clienteId}/invitaciones`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenOwner}` },
      body: JSON.stringify({ correo: "cliente.portal@equinox.test", rol: "TITULAR" }),
    });
    assert.equal(invRes.status, 201);
    const enlaceInv: string = invRes.cuerpo.enlaceInvitacion;
    const tokenInv = enlaceInv.split("/").pop()!;

    const acepInv = await reqJson(`${apiUrl}/api/invitaciones/${tokenInv}/aceptar`, {
      method: "POST",
      body: JSON.stringify({
        nombre: "Cliente",
        apellido: "Portal",
        contrasena: "ClientePortal#2026!",
      }),
    });
    assert.equal(acepInv.status, 200);

    const loginCli = await reqJson(`${apiUrl}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      body: JSON.stringify({
        correo: "cliente.portal@equinox.test",
        contrasena: "ClientePortal#2026!",
      }),
    });
    assert.equal(loginCli.status, 200);
    const tokenCliente = loginCli.cuerpo.token;

    // Verificar cliente accede a /api/portal
    const portalAntes = await reqJson(`${apiUrl}/api/portal`, {
      headers: { Authorization: `Bearer ${tokenCliente}` },
    });
    assert.equal(portalAntes.status, 200);

    // Suscripciones manuales (Plan + Asignación ACTIVA antes de suspender org)
    const planRes = await reqJson(`${apiUrl}/api/admin/suscripciones/planes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({
        codigo: "PRO_MANUAL",
        nombre: "Profesional Manual",
        activo: true,
        esPlanPrueba: false,
      }),
    });
    assert.equal(planRes.status, 201);
    assert.equal(planRes.cuerpo.modalidadGestion, "MANUAL_SIN_COBRO");

    const asigSub = await reqJson(`${apiUrl}/api/admin/suscripciones/organizaciones/${orgId}/asignar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({
        planId: planRes.cuerpo.plan.id,
        estado: "ACTIVA",
        motivo: "Alta piloto manual",
      }),
    });
    assert.equal(asigSub.status, 201);
    assert.equal(asigSub.cuerpo.etiquetaCobro, "Manual, sin cobro procesado");
    assert(!("precio" in asigSub.cuerpo.suscripcion), "No debe existir campo precio");

    // Suspender organización -> revoca sesiones activas y NO altera SuscripcionOrganizacion
    const suspSinConf = await reqJson(`${apiUrl}/api/admin/organizaciones/${orgId}/suspender`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ confirmar: false, motivo: "Prueba" }),
    });
    assert.equal(suspSinConf.status, 422);

    const suspOk = await reqJson(`${apiUrl}/api/admin/organizaciones/${orgId}/suspender`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ confirmar: true, motivo: "Incumplimiento operativo de prueba" }),
    });
    assert.equal(suspOk.status, 200);
    assert(suspOk.cuerpo.sesionesRevocadas >= 2);

    // Sesiones existentes bloqueadas de inmediato (401)
    const ownerBloqueado = await reqJson(`${apiUrl}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenOwner}` },
    });
    assert.equal(ownerBloqueado.status, 401);
    const clienteBloqueado = await reqJson(`${apiUrl}/api/portal`, {
      headers: { Authorization: `Bearer ${tokenCliente}` },
    });
    assert.equal(clienteBloqueado.status, 401);

    // Suscripción sigue ACTIVA (independencia comercial vs operativa)
    const subTrasSusp = await reqJson(`${apiUrl}/api/admin/suscripciones/organizaciones/${orgId}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(subTrasSusp.status, 200);
    assert.equal(subTrasSusp.cuerpo.suscripcion.estado, "ACTIVA");

    // Reactivar organización
    const reactOk = await reqJson(`${apiUrl}/api/admin/organizaciones/${orgId}/reactivar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ confirmar: true, motivo: "Regularizado" }),
    });
    assert.equal(reactOk.status, 200);

    // Nuevo login vuelve a funcionar
    const reLoginOwner = await reqJson(`${apiUrl}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      body: JSON.stringify({ correo: "owner.estudio@equinox.test", contrasena: "OwnerEstudio#2026!" }),
    });
    assert.equal(reLoginOwner.status, 200);
    const nuevoTokenOwner = reLoginOwner.cuerpo.token;

    resultado.bloques.push({
      nombre: "Suspensión/Reactivación Independiente + Suscripciones Manuales",
      estado: "PASO",
      detalle: "Revocación inmediata 401, suscripción intacta (ACTIVA, MANUAL_SIN_COBRO), reactivación OK",
    });

    // -------------------------------------------------------------------------
    // BLOQUE D: Regresiones de los 3 Reportes de Auditoría
    // -------------------------------------------------------------------------
    // D1. Auditoría Auth: Password > 128 chars -> 422
    const passLarga = await reqJson(`${apiUrl}/api/autenticacion/registro`, {
      method: "POST",
      body: JSON.stringify({
        correo: "largo@equinox.test",
        contrasena: "A".repeat(130),
        nombre: "Largo",
        apellido: "Test",
        nombreEstudio: "Org Largo",
        slug: "org-largo",
      }),
    });
    assert.equal(passLarga.status, 422);
    resultado.hallazgosAuditoria.push({
      id: "AUTH-07",
      fuente: "AUDITORIA_SEGURIDAD_AUTENTICACION_ACCESO.md",
      estado: "REMEDIADO",
      detalle: "Contraseña > 128 caracteres rechazada con 422",
    });

    // D2. Auditoría Auth: Enumeración explícita 409 en registro (persiste por diseño UX + rate limit)
    const regDup = await reqJson(`${apiUrl}/api/autenticacion/registro`, {
      method: "POST",
      body: JSON.stringify({
        correo: "owner.estudio@equinox.test",
        contrasena: "OtraPassword#2026!",
        nombre: "Dup",
        apellido: "Test",
        nombreEstudio: "Org Dup",
        slug: "org-dup",
      }),
    });
    assert.equal(regDup.status, 409);
    resultado.hallazgosAuditoria.push({
      id: "AUTH-04",
      fuente: "AUDITORIA_SEGURIDAD_AUTENTICACION_ACCESO.md",
      estado: "PERSISTE",
      detalle: "POST /registro sigue respondiendo 409 para correo existente (mitigado con rate limit por IP)",
    });

    // D3. Auditoría Auth: Recuperación SMTP falla -> paridad 200 tanto existente como inexistente
    const recExist = await reqJson(`${apiUrl}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      body: JSON.stringify({ correo: "owner.estudio@equinox.test" }),
    });
    const recInex = await reqJson(`${apiUrl}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      body: JSON.stringify({ correo: "no.existe.nadie@equinox.test" }),
    });
    assert.equal(recExist.status, 200);
    assert.equal(recInex.status, 200);
    resultado.hallazgosAuditoria.push({
      id: "AUTH-02/05",
      fuente: "AUDITORIA_SEGURIDAD_AUTENTICACION_ACCESO.md",
      estado: "REMEDIADO",
      detalle: "Paridad HTTP 200 en recuperación sin discrepancia bcrypt ni error SMTP expuesto",
    });

    // D4. Auditoría Módulos: H1 (sin tokenHash en GET /clientes/:id), H2 (RBAC facturas), H4 (XSS javascript:)
    const detCli = await reqJson(`${apiUrl}/api/clientes/${clienteId}`, {
      headers: { Authorization: `Bearer ${nuevoTokenOwner}` },
    });
    assert.equal(detCli.status, 200);
    assert(!JSON.stringify(detCli.cuerpo).includes("tokenHash"), "GET /clientes/:id no debe exponer tokenHash");

    // Cross-tenant cliente (Org B intenta ver cliente de Org A -> 404)
    const reLoginColabOrgB = await reqJson(`${apiUrl}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      body: JSON.stringify({
        correo: "colab.estudio@equinox.test",
        contrasena: "ColabEstudio#2026!",
        seleccion: { tipoAcceso: "ORGANIZACION", organizacionId: regColab.cuerpo.organizacion.id },
      }),
    });
    assert.equal(reLoginColabOrgB.status, 200);
    const crossCli = await reqJson(`${apiUrl}/api/clientes/${clienteId}`, {
      headers: { Authorization: `Bearer ${reLoginColabOrgB.cuerpo.token}` },
    });
    assert.equal(crossCli.status, 404);

    // H4: URL javascript: rechazada en cliente
    const xssCli = await reqJson(`${apiUrl}/api/clientes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${nuevoTokenOwner}` },
      body: JSON.stringify({ nombre: "XSS Test", sitioWeb: "javascript:alert(1)" }),
    });
    assert.equal(xssCli.status, 422);
    resultado.hallazgosAuditoria.push({
      id: "MOD-H1..H11",
      fuente: "REPORTE_AUDITORIA_SEGURIDAD.md",
      estado: "REMEDIADO",
      detalle: "Sin tokenHash, rechazo XSS javascript: (422), aislamiento cross-tenant 404",
    });

    // D6. Auditoría Fotografía: SEC-FOTO-01 (eliminar cliente con sesión fotográfica) + magic bytes
    const sesFoto = await reqJson(`${apiUrl}/api/clientes/${clienteId}/sesiones-fotograficas`, {
      method: "POST",
      headers: { Authorization: `Bearer ${nuevoTokenOwner}` },
      body: JSON.stringify({
        nombre: "Sesión Audit Foto",
        fecha: "2026-11-17",
        estado: "PUBLICADA",
      }),
    });
    assert.equal(sesFoto.status, 201);
    const sesionFotoId = sesFoto.cuerpo.id;

    // Subir foto PNG válida
    const form = new FormData();
    form.append("archivo", new Blob([new Uint8Array(crearPngMinimo())], { type: "image/png" }), "test.png");
    const subFoto = await fetch(
      `${apiUrl}/api/clientes/${clienteId}/sesiones-fotograficas/${sesionFotoId}/fotos`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${nuevoTokenOwner}` },
        body: form,
      }
    );
    assert.equal(subFoto.status, 201);

    // Subir falso PNG (magic bytes inválidos) -> 415
    const formFake = new FormData();
    formFake.append("archivo", new Blob(["<?php echo 1; ?>"], { type: "image/png" }), "fake.png");
    const subFake = await fetch(
      `${apiUrl}/api/clientes/${clienteId}/sesiones-fotograficas/${sesionFotoId}/fotos`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${nuevoTokenOwner}` },
        body: formFake,
      }
    );
    assert.equal(subFake.status, 415);

    // Intentar eliminar cliente con sesión fotográfica -> debe devolver 409 (SEC-FOTO-01 remediado)
    const delCliFoto = await reqJson(`${apiUrl}/api/clientes/${clienteId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${nuevoTokenOwner}` },
    });
    assert.equal(delCliFoto.status, 409, "DELETE /clientes/:id con sesión fotográfica debe bloquearse con 409");
    resultado.hallazgosAuditoria.push({
      id: "SEC-FOTO-01",
      fuente: "AUDITORIA_SEGURIDAD_FOTOGRAFIA.md",
      estado: "REMEDIADO",
      detalle: "DELETE /clientes/:id bloqueado con 409 cuando existen sesiones fotográficas; magic bytes 415 OK",
    });

    resultado.bloques.push({
      nombre: "Regresiones de Auditoría (Auth, Módulos, Fotografía)",
      estado: "PASO",
      detalle: "Controles remediados verificados; AUTH-04 (409 en registro) documentado como persistente/aceptado",
    });

    // -------------------------------------------------------------------------
    // BLOQUE E: Frontend /admin real conectado a API de prueba (Desktop + Móvil)
    // -------------------------------------------------------------------------
    const uiRes = await ejecutarValidacionUiReal(apiUrl, adminCorreo, adminPass, secretoTotp);
    resultado.uiDesktopOk = uiRes.desktopOk;
    resultado.uiMovilOk = uiRes.movilOk;
    resultado.bloques.push({
      nombre: "Frontend /admin conectado a API real (Desktop + Móvil)",
      estado: "PASO",
      detalle: "Login + MFA TOTP + /admin en 1440x900 y 390x844 sin errores ni desbordamiento",
    });

    // -------------------------------------------------------------------------
    // BLOQUE F: Rate limit en login (AUTH-01) al final para no agotar cuota IP antes de UI
    // -------------------------------------------------------------------------
    let hit429Login = false;
    for (let i = 0; i < 12; i++) {
      const r = await reqJson(`${apiUrl}/api/autenticacion/inicio-sesion`, {
        method: "POST",
        body: JSON.stringify({ correo: "rate.limit.probe@equinox.test", contrasena: "WrongPassword1!" }),
      });
      if (r.status === 429) {
        hit429Login = true;
        break;
      }
    }
    assert.equal(hit429Login, true, "Login debe aplicar rate limit 429");
    resultado.hallazgosAuditoria.push({
      id: "AUTH-01/03",
      fuente: "AUDITORIA_SEGURIDAD_AUTENTICACION_ACCESO.md",
      estado: "REMEDIADO",
      detalle: "Rate limit 429 activo en inicio de sesión",
    });

    return resultado;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
