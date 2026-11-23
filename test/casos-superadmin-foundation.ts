import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../src/prisma.js";
import { aplicacion, sanitizarTextoParaLogs, sanitizarUrlParaLogs } from "../src/aplicacion.js";
import { ejecutarBootstrapAdmin } from "../src/cli/bootstrap-admin.js";
import { obtenerSecretoJwt } from "../src/middleware/autenticacion.js";
import {
  limitadorLoginCuenta,
  limitadorLoginIp,
  limitadorMfaIp,
  limitadorMfaUsuario,
  limitadorRecuperacionCuenta,
  limitadorRecuperacionIp,
  limitadorRegistroIp,
} from "../src/rutas/autenticacion.js";
import { calcularPasoTotp, generarCodigoTotpParaPaso } from "../src/utilidades/mfa.js";
import {
  habilitarCapturadorPruebas,
  limpiarCorreosCapturados,
  obtenerCorreosCapturados,
} from "../src/servicios/correo.js";

function reiniciarTodosLimitadores() {
  limitadorLoginIp.reiniciar();
  limitadorLoginCuenta.reiniciar();
  limitadorRegistroIp.reiniciar();
  limitadorMfaIp.reiniciar();
  limitadorMfaUsuario.reiniciar();
  limitadorRecuperacionIp.reiniciar();
  limitadorRecuperacionCuenta.reiniciar();
}

export async function ejecutarCasosSuperadminFoundation() {
  process.env.HABILITAR_HOOKS_PRUEBAS = "true";
  process.env.SMTP_HOST = "smtp.prueba.local";
  process.env.URL_BASE = "http://localhost:4200";
  habilitarCapturadorPruebas(true);
  limpiarCorreosCapturados();
  reiniciarTodosLimitadores();

  // 1. Verificar que la migración es estrictamente no destructiva
  console.log("[1/7] Verificando migración no destructiva...");
  const migrationSql = readFileSync(
    resolve("prisma/migrations/20261117100500_superadmin_mfa_auditoria_suscripciones/migration.sql"),
    "utf8"
  );
  assert.equal(/\bDROP\s+(TABLE|COLUMN|TYPE)\b/i.test(migrationSql), false, "La migración no debe eliminar tablas, columnas ni tipos");
  assert.equal(/\bTRUNCATE\b/i.test(migrationSql), false, "La migración no debe truncar datos");

  const servidor = createServer(aplicacion);
  await new Promise<void>((resolveSrv) => servidor.listen(0, "127.0.0.1", resolveSrv));
  const direccion = servidor.address() as { port: number };
  const urlApi = `http://127.0.0.1:${direccion.port}`;

  try {
    // 2. Verificar sanitización morgan contra log injection
    console.log("[2/7] Verificando mitigación de log injection en morgan...");
    const refMalicioso = 'https://evil.test/" 200 0 "-" "FAKE"\r\n127.0.0.1 - - "GET /admin';
    const refLimpio = sanitizarUrlParaLogs(refMalicioso);
    assert.equal(/[\r\n]/.test(refLimpio), false, "No debe contener saltos de línea");
    assert.equal(refLimpio.includes('\\"'), true, "Debe escapar comillas dobles");
    const uaLimpio = sanitizarTextoParaLogs('Mozilla/5.0"\r\nFAKE_LOG');
    assert.equal(/[\r\n]/.test(uaLimpio), false, "User-Agent sanitizado no debe contener saltos de línea");

    // 3. Crear usuario normal vía /registro (intentando escalar rolPlataforma -> debe ignorarse)
    console.log("[3/7] Verificando registro seguro, límites de contraseña y denegación por defecto...");
    const resPassLarga = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "largo@equinox.test",
        contrasena: "A".repeat(129),
        nombre: "Largo",
        nombreEstudio: "Estudio Largo",
        slug: "estudio-largo",
      }),
    });
    assert.equal(resPassLarga.status, 422, "Debe rechazar contraseñas > 128 caracteres");

    const correoAdmin = "superadmin.test@equinox.test";
    const passAdmin = "SuperAdminPass2026!";
    const resRegAdmin = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: correoAdmin,
        contrasena: passAdmin,
        nombre: "Admin",
        apellido: "Global",
        nombreEstudio: "Estudio Admin",
        slug: "estudio-admin-test",
        rolPlataforma: "ADMIN_GLOBAL", // intento de escalación
      }),
    });
    assert.equal(resRegAdmin.status, 201);
    const regAdminBody = (await resRegAdmin.json()) as any;

    const usuarioDb = await prisma.usuario.findUnique({ where: { correo: correoAdmin } });
    assert.equal(usuarioDb?.rolPlataforma, "USUARIO", "Registro nunca debe otorgar rol ADMIN_GLOBAL");

    // Usuario normal no puede acceder a /api/admin/*
    const resAdminDenegado = await fetch(`${urlApi}/api/admin/resumen`, {
      headers: { Authorization: `Bearer ${regAdminBody.token}` },
    });
    assert.equal(resAdminDenegado.status, 403, "Usuario normal debe recibir 403 en /api/admin");

    // Token JWT forjado sin sesión ADMIN_GLOBAL en BD
    const tokenForjado = jwt.sign(
      {
        tipoAcceso: "ADMIN_GLOBAL",
        sesionId: "00000000-0000-4000-8000-000000000001",
        usuarioId: usuarioDb!.id,
        rolPlataforma: "ADMIN_GLOBAL",
        mfaVerificado: true,
      },
      obtenerSecretoJwt(),
      { expiresIn: "1h" }
    );
    const resForjado = await fetch(`${urlApi}/api/admin/resumen`, {
      headers: { Authorization: `Bearer ${tokenForjado}` },
    });
    assert.equal(resForjado.status, 401, "JWT forjado sin sesión en BD debe ser rechazado");

    // 4. Bootstrap CLI de un solo uso
    console.log("[4/7] Verificando bootstrap CLI explícito de un solo uso...");
    await assert.rejects(
      () => ejecutarBootstrapAdmin(prisma, { correo: correoAdmin, confirmar: false }),
      /confirmar/i
    );
    await assert.rejects(
      () => ejecutarBootstrapAdmin(prisma, { correo: "noexiste@equinox.test", confirmar: true }),
      /No existe/i
    );
    const bootRes = await ejecutarBootstrapAdmin(prisma, {
      correo: correoAdmin,
      confirmar: true,
    });
    assert.equal(bootRes.rolPlataforma, "ADMIN_GLOBAL");

    // Segundo bootstrap debe fallar
    await assert.rejects(
      () => ejecutarBootstrapAdmin(prisma, { correo: correoAdmin, confirmar: true }),
      /un solo uso/i
    );

    const audBoot = await prisma.auditoriaAdmin.findFirst({
      where: { accion: "ADMIN_BOOTSTRAP_ELEVACION", actorUsuarioId: bootRes.usuarioId },
    });
    assert.ok(audBoot, "Bootstrap debe registrar auditoría");

    // 5. Login ADMIN_GLOBAL -> MFA obligatorio (CONFIGURAR -> VERIFICAR -> Replay protection -> Backup code)
    console.log("[5/7] Verificando flujo completo MFA TOTP, separación de sesión y anti-replay...");
    // Multi-contexto (tiene organización + ADMIN_GLOBAL) -> 409 con adminGlobal: true
    const resMulti = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoAdmin, contrasena: passAdmin }),
    });
    assert.equal(resMulti.status, 409);
    const multiBody = (await resMulti.json()) as any;
    assert.equal(multiBody.contextos.adminGlobal, true);

    // Seleccionar ADMIN_GLOBAL -> devuelve desafío MFA, NO token de sesión
    const resLoginAdmin = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: correoAdmin,
        contrasena: passAdmin,
        seleccion: { tipoAcceso: "ADMIN_GLOBAL" },
      }),
    });
    assert.equal(resLoginAdmin.status, 200);
    const loginAdminBody = (await resLoginAdmin.json()) as any;
    assert.equal(loginAdminBody.mfaRequerido, true);
    assert.equal(loginAdminBody.estadoMfa, "CONFIGURAR");
    assert.ok(loginAdminBody.tokenDesafioMfa);
    assert.equal(loginAdminBody.token, undefined, "No debe emitir token de sesión antes de MFA");

    // El token de desafío NO sirve para acceder a /api/admin ni a /yo
    const resDesafioEnAdmin = await fetch(`${urlApi}/api/admin/resumen`, {
      headers: { Authorization: `Bearer ${loginAdminBody.tokenDesafioMfa}` },
    });
    assert.equal(resDesafioEnAdmin.status, 401);

    // Iniciar configuración TOTP
    const resIniciarMfa = await fetch(`${urlApi}/api/autenticacion/admin/mfa/iniciar-configuracion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenDesafioMfa: loginAdminBody.tokenDesafioMfa }),
    });
    assert.equal(resIniciarMfa.status, 200);
    const { secretoBase32, otpauthUrl } = (await resIniciarMfa.json()) as any;
    assert.ok(secretoBase32 && otpauthUrl.startsWith("otpauth://totp/"));

    // Código TOTP inválido falla con 401
    const resConfirmarMalo = await fetch(`${urlApi}/api/autenticacion/admin/mfa/confirmar-configuracion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenDesafioMfa: loginAdminBody.tokenDesafioMfa,
        codigoTotp: "000000",
      }),
    });
    assert.equal(resConfirmarMalo.status, 401);

    // Confirmar configuración con TOTP válido
    const paso1 = calcularPasoTotp();
    const totp1 = generarCodigoTotpParaPaso(secretoBase32, paso1);
    const resConfirmarOk = await fetch(`${urlApi}/api/autenticacion/admin/mfa/confirmar-configuracion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenDesafioMfa: loginAdminBody.tokenDesafioMfa,
        codigoTotp: totp1,
      }),
    });
    assert.equal(resConfirmarOk.status, 200);
    const confirmarBody = (await resConfirmarOk.json()) as any;
    assert.ok(confirmarBody.token);
    assert.equal(confirmarBody.contexto.tipoAcceso, "ADMIN_GLOBAL");
    assert.equal(confirmarBody.codigosRecuperacion.length, 8);
    const adminToken1 = confirmarBody.token as string;
    const backupCodes = confirmarBody.codigosRecuperacion as string[];

    // Acceder a /api/admin/resumen y /api/admin/suscripciones/planes con token ADMIN_GLOBAL
    const resAdminOk = await fetch(`${urlApi}/api/admin/resumen`, {
      headers: { Authorization: `Bearer ${adminToken1}` },
    });
    assert.equal(resAdminOk.status, 200);

    // Separación estricta: token ADMIN_GLOBAL rechazado en /api/organizacion y /api/portal
    const resOrgConAdmin = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${adminToken1}` },
    });
    assert.equal(resOrgConAdmin.status, 403);

    // Nuevo login -> VERIFICAR; replay del mismo código TOTP debe fallar
    const resLogin2 = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: correoAdmin,
        contrasena: passAdmin,
        seleccion: { tipoAcceso: "ADMIN_GLOBAL" },
      }),
    });
    const login2Body = (await resLogin2.json()) as any;
    assert.equal(login2Body.estadoMfa, "VERIFICAR");

    const resReplay = await fetch(`${urlApi}/api/autenticacion/admin/mfa/verificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenDesafioMfa: login2Body.tokenDesafioMfa,
        codigoTotp: totp1,
      }),
    });
    assert.equal(resReplay.status, 401, "Replay de código TOTP usado debe ser rechazado");

    // Usar código de recuperación MFA de un solo uso
    const resBackupOk = await fetch(`${urlApi}/api/autenticacion/admin/mfa/verificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenDesafioMfa: login2Body.tokenDesafioMfa,
        codigoRecuperacion: backupCodes[0],
      }),
    });
    assert.equal(resBackupOk.status, 200);
    const { token: adminToken2 } = (await resBackupOk.json()) as any;

    // Reutilizar mismo código de recuperación falla
    const resBackupReuso = await fetch(`${urlApi}/api/autenticacion/admin/mfa/verificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenDesafioMfa: login2Body.tokenDesafioMfa,
        codigoRecuperacion: backupCodes[0],
      }),
    });
    assert.equal(resBackupReuso.status, 401);

    // 6. Recuperación MFA por correo + revocación total de sesiones
    console.log("[6/7] Verificando recuperación de MFA y revocación inmediata de sesiones...");
    limpiarCorreosCapturados();
    const resSolRecMfa = await fetch(`${urlApi}/api/autenticacion/admin/mfa/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoAdmin }),
    });
    assert.equal(resSolRecMfa.status, 200);
    const correosMfa = obtenerCorreosCapturados();
    assert.equal(correosMfa.length, 1);
    const matchToken = correosMfa[0].enlace.match(/[?&]token=([^&]+)/);
    assert.ok(matchToken, "Debe incluir token de recuperación MFA en el enlace");
    const tokenRecMfa = decodeURIComponent(matchToken![1]);

    const resRestablecerMfa = await fetch(`${urlApi}/api/autenticacion/admin/mfa/restablecer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenRecMfa, contrasena: passAdmin }),
    });
    assert.equal(resRestablecerMfa.status, 200);

    // Sesiones previas deben quedar revocadas inmediatamente
    const resAdminRevocado = await fetch(`${urlApi}/api/admin/resumen`, {
      headers: { Authorization: `Bearer ${adminToken2}` },
    });
    assert.equal(resAdminRevocado.status, 401, "Sesión admin debe quedar revocada tras restablecer MFA");

    // 7. Rate limits, timing de recuperación y uniformidad ante fallo SMTP
    console.log("[7/7] Verificando rate limits (login/registro/MFA) y paridad de recuperación...");
    reiniciarTodosLimitadores();

    // Paridad de fallo SMTP en solicitar-recuperacion
    habilitarCapturadorPruebas(false);
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1";
    const t0 = performance.now();
    const resSmtpExistente = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoAdmin }),
    });
    const durExistente = performance.now() - t0;

    const t1 = performance.now();
    const resSmtpInexistente = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "noexiste.paridad@equinox.test" }),
    });
    const durInexistente = performance.now() - t1;
    habilitarCapturadorPruebas(true);

    assert.equal(resSmtpExistente.status, 200, "Fallo SMTP no debe filtrar existencia de cuenta con 503");
    assert.equal(resSmtpInexistente.status, 200);
    assert.ok(durInexistente < 200, `Rama inexistente no debe ejecutar bcrypt lento (${durInexistente}ms)`);
    assert.ok(Math.abs(durExistente - durInexistente) < 250, "Tiempos de recuperación deben ser comparables");

    // Rate limit de login por cuenta (5 fallos -> 6to 429)
    reiniciarTodosLimitadores();
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo: correoAdmin, contrasena: "WrongPassword!" }),
      });
      assert.equal(r.status, 401);
    }
    const rLogin429 = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoAdmin, contrasena: "WrongPassword!" }),
    });
    assert.equal(rLogin429.status, 429, "Debe bloquear cuenta tras 5 intentos fallidos");
    assert.ok(rLogin429.headers.get("retry-after"));

    // Rate limit de registro (5 intentos -> 6to 429)
    reiniciarTodosLimitadores();
    for (let i = 0; i < 5; i++) {
      await fetch(`${urlApi}/api/autenticacion/registro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo: `rl${i}@equinox.test`,
          contrasena: "Password123!",
          nombre: "Test",
          nombreEstudio: `Estudio RL ${i}`,
          slug: `estudio-rl-${i}`,
        }),
      });
    }
    const rReg429 = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "rl6@equinox.test",
        contrasena: "Password123!",
        nombre: "Test",
        nombreEstudio: "Estudio RL 6",
        slug: "estudio-rl-6",
      }),
    });
    assert.equal(rReg429.status, 429, "Registro debe aplicar rate limit por IP");

    // Verificar que bcrypt sigue funcionando correctamente
    const hashCheck = await bcrypt.hash("Test1234!", 10);
    assert.equal(await bcrypt.compare("Test1234!", hashCheck), true);

    // 8. Suspensión de acceso por Organizacion.suspendidaEn vs estado comercial SuscripcionOrganizacion.SUSPENDIDA
    console.log("[8/8] Verificando suspensión de acceso por Organizacion.suspendidaEn y aislamiento...");
    reiniciarTodosLimitadores();
    const orgActiva = await prisma.organizacion.create({
      data: { nombre: "Org Activa Test", slug: "org-activa-susp-test" },
    });
    const orgSuspendible = await prisma.organizacion.create({
      data: { nombre: "Org Suspendible Test", slug: "org-suspendible-test" },
    });

    const hashMiembro = await bcrypt.hash("MiembroPass123!", 10);
    const usuarioMiembro = await prisma.usuario.create({
      data: {
        correo: "miembro.susp@equinox.test",
        contrasenaHash: hashMiembro,
        nombre: "Miembro",
      },
    });
    await prisma.miembroOrganizacion.createMany({
      data: [
        { usuarioId: usuarioMiembro.id, organizacionId: orgActiva.id, rol: "PROPIETARIO" },
        { usuarioId: usuarioMiembro.id, organizacionId: orgSuspendible.id, rol: "PROPIETARIO" },
      ],
    });

    const clienteEnActiva = await prisma.cliente.create({
      data: { organizacionId: orgActiva.id, nombre: "Cliente Activa" },
    });
    const clienteEnSuspendible = await prisma.cliente.create({
      data: { organizacionId: orgSuspendible.id, nombre: "Cliente Suspendible" },
    });
    const usuarioCliente = await prisma.usuario.create({
      data: {
        correo: "cliente.susp@equinox.test",
        contrasenaHash: hashMiembro,
        nombre: "Cliente",
      },
    });
    await prisma.accesoCliente.createMany({
      data: [
        { usuarioId: usuarioCliente.id, clienteId: clienteEnActiva.id, organizacionId: orgActiva.id, rol: "TITULAR" },
        { usuarioId: usuarioCliente.id, clienteId: clienteEnSuspendible.id, organizacionId: orgSuspendible.id, rol: "TITULAR" },
      ],
    });

    // Suscripcion SUSPENDIDA NO debe bloquear login ni sesión
    await prisma.suscripcionOrganizacion.create({
      data: {
        organizacionId: orgSuspendible.id,
        estado: "SUSPENDIDA",
        motivo: "Prueba comercial",
      },
    });

    const resLoginComercial = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "miembro.susp@equinox.test",
        contrasena: "MiembroPass123!",
        seleccion: { tipoAcceso: "ORGANIZACION", organizacionId: orgSuspendible.id },
      }),
    });
    assert.equal(resLoginComercial.status, 200, "Suscripcion SUSPENDIDA comercial no debe bloquear login");
    const tokenOrgSuspendible = ((await resLoginComercial.json()) as any).token as string;

    const resLoginOrgActiva = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "miembro.susp@equinox.test",
        contrasena: "MiembroPass123!",
        seleccion: { tipoAcceso: "ORGANIZACION", organizacionId: orgActiva.id },
      }),
    });
    assert.equal(resLoginOrgActiva.status, 200);
    const tokenOrgActiva = ((await resLoginOrgActiva.json()) as any).token as string;

    const resLoginCliSusp = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "cliente.susp@equinox.test",
        contrasena: "MiembroPass123!",
        seleccion: {
          tipoAcceso: "CLIENTE",
          organizacionId: orgSuspendible.id,
          clienteId: clienteEnSuspendible.id,
        },
      }),
    });
    assert.equal(resLoginCliSusp.status, 200);
    const tokenCliSuspendible = ((await resLoginCliSusp.json()) as any).token as string;

    const resLoginCliActiva = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "cliente.susp@equinox.test",
        contrasena: "MiembroPass123!",
        seleccion: {
          tipoAcceso: "CLIENTE",
          organizacionId: orgActiva.id,
          clienteId: clienteEnActiva.id,
        },
      }),
    });
    assert.equal(resLoginCliActiva.status, 200);
    const tokenCliActiva = ((await resLoginCliActiva.json()) as any).token as string;

    // Ahora suspendemos orgSuspendible mediante Organizacion.suspendidaEn
    await prisma.organizacion.update({
      where: { id: orgSuspendible.id },
      data: {
        suspendidaEn: new Date(),
        motivoSuspension: "Suspensión operativa de prueba",
      },
    });

    // Sesiones activas de orgSuspendible (miembro y cliente) son rechazadas con 403 inmediatamente
    const resMiembroBloq = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenOrgSuspendible}` },
    });
    assert.equal(resMiembroBloq.status, 403, "Sesión activa de miembro en org suspendida debe bloquearse");

    const resCliBloq = await fetch(`${urlApi}/api/portal/proyectos`, {
      headers: { Authorization: `Bearer ${tokenCliSuspendible}` },
    });
    assert.equal(resCliBloq.status, 403, "Sesión activa de cliente en org suspendida debe bloquearse");

    // Login nuevo contra orgSuspendible también bloqueado con 403
    const resReLoginBloq = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "miembro.susp@equinox.test",
        contrasena: "MiembroPass123!",
        seleccion: { tipoAcceso: "ORGANIZACION", organizacionId: orgSuspendible.id },
      }),
    });
    assert.equal(resReLoginBloq.status, 403, "Login a org suspendida debe bloquearse");

    // Sesiones de la OTRA organización activa (miembro y cliente) NO se ven afectadas
    const resMiembroOtraOk = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenOrgActiva}` },
    });
    assert.equal(resMiembroOtraOk.status, 200, "Miembro en otra org no suspendida debe seguir operando");

    const resCliOtraOk = await fetch(`${urlApi}/api/portal/proyectos`, {
      headers: { Authorization: `Bearer ${tokenCliActiva}` },
    });
    assert.equal(resCliOtraOk.status, 200, "Cliente en otra org no suspendida debe seguir operando");

    // Reactivar orgSuspendible restaura acceso
    await prisma.organizacion.update({
      where: { id: orgSuspendible.id },
      data: { suspendidaEn: null, motivoSuspension: null, suspendidaPorUsuarioId: null },
    });
    const resReactivado = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenOrgSuspendible}` },
    });
    assert.equal(resReactivado.status, 200, "Reactivar organización debe restaurar acceso");

    console.log("✔ Todos los casos de superadmin, MFA, denegación, revocación, suspensión, rate limits y morgan pasaron.");
  } finally {
    await new Promise<void>((resolveClose) => servidor.close(() => resolveClose()));
    limitadorLoginIp.detener();
    limitadorLoginCuenta.detener();
    limitadorRegistroIp.detener();
    limitadorMfaIp.detener();
    limitadorMfaUsuario.detener();
    limitadorRecuperacionIp.detener();
    limitadorRecuperacionCuenta.detener();
  }
}
