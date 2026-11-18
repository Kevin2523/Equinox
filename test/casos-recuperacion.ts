import assert from "node:assert/strict";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import { prisma } from "../src/prisma.js";
import { aplicacion, sanitizarUrlParaLogs } from "../src/aplicacion.js";
import {
  habilitarCapturadorPruebas,
  obtenerCorreosCapturados,
  limpiarCorreosCapturados,
} from "../src/servicios/correo.js";
import {
  hashTokenRecuperacion,
  generarTokenRecuperacion,
} from "../src/utilidades/recuperacion.js";
import {
  limitadorRecuperacionIp,
  limitadorRecuperacionCuenta,
  limitadorValidarTokenIp,
  limitadorRestablecerIp,
} from "../src/rutas/autenticacion.js";
import { hooksPruebas } from "../src/utilidades/hooks-pruebas.js";

const BASE_ESPERADA = "equinox_recuperacion_test";

async function verificarBaseActual() {
  const resultado: Array<{ current_database: string }> =
    await prisma.$queryRaw`SELECT current_database();`;

  const nombreActual = resultado[0]?.current_database;
  if (nombreActual !== BASE_ESPERADA) {
    console.error(
      `[SEGURIDAD CRÍTICA] La base actual es '${nombreActual}', pero se exige '${BASE_ESPERADA}'. Abortando inmediatamente.`
    );
    process.exit(1);
  }
}

async function ejecutarCasos() {
  await verificarBaseActual();

  let servidor: ReturnType<typeof createServer> | null = null;
  let urlApi = "";

  try {
    await new Promise<void>((resolve) => {
      servidor = createServer(aplicacion);
      servidor.listen(0, () => {
        const addr = servidor!.address();
        if (typeof addr === "object" && addr) {
          urlApi = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    console.log(`[casos-recuperacion] Servidor temporal iniciado en ${urlApi}`);

    // Limpieza inicial controlada en la base aislada
    await prisma.solicitudRecuperacion.deleteMany();
    await prisma.sesion.deleteMany();
    await prisma.accesoCliente.deleteMany();
    await prisma.miembroOrganizacion.deleteMany();
    await prisma.cliente.deleteMany();
    await prisma.proyecto.deleteMany();
    await prisma.factura.deleteMany();
    await prisma.organizacion.deleteMany();
    await prisma.usuario.deleteMany();

    // -----------------------------------------------------------------
    // Preparación de identidades reales en la BD de prueba
    // -----------------------------------------------------------------
    const passInicialHash = await bcrypt.hash("PasswordOriginal123!", 12);

    // 1. Propietario / Freelancer
    const orgFreelancer = await prisma.organizacion.create({
      data: {
        nombre: "Estudio Alfa",
        slug: "estudio-alfa",
        tipoFreelance: "GENERAL",
      },
    });

    const usuarioFreelancer = await prisma.usuario.create({
      data: {
        correo: "freelancer@example.test",
        contrasenaHash: passInicialHash,
        nombre: "Carlos",
        apellido: "Diseñador",
      },
    });

    await prisma.miembroOrganizacion.create({
      data: {
        usuarioId: usuarioFreelancer.id,
        organizacionId: orgFreelancer.id,
        rol: "PROPIETARIO",
      },
    });

    // 2. Cliente del Portal
    const clienteEntidad = await prisma.cliente.create({
      data: {
        nombre: "Empresa Cliente S.A.",
        organizacionId: orgFreelancer.id,
        estado: "ACTIVO",
      },
    });

    const usuarioCliente = await prisma.usuario.create({
      data: {
        correo: "cliente@example.test",
        contrasenaHash: passInicialHash,
        nombre: "Ana",
        apellido: "Gerente",
      },
    });

    await prisma.accesoCliente.create({
      data: {
        usuarioId: usuarioCliente.id,
        clienteId: clienteEntidad.id,
        organizacionId: orgFreelancer.id,
        rol: "TITULAR",
        activo: true,
      },
    });

    // Sesión activa inicial para el freelancer
    const resLoginFreelancer = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "freelancer@example.test",
        contrasena: "PasswordOriginal123!",
      }),
    });
    assert.equal(resLoginFreelancer.status, 200, "Login de freelancer debe ser 200");
    const datosLoginFreelancer = (await resLoginFreelancer.json()) as any;
    const tokenSesionFreelancer = datosLoginFreelancer.token;
    assert.ok(tokenSesionFreelancer);

    // Verificar que la sesión activa funciona
    const resYoFreelancer = await fetch(`${urlApi}/api/autenticacion/yo`, {
      headers: { Authorization: `Bearer ${tokenSesionFreelancer}` },
    });
    assert.equal(resYoFreelancer.status, 200, "La sesión del freelancer debe estar activa");

    // Sesión activa inicial para el cliente
    const resLoginCliente = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "cliente@example.test",
        contrasena: "PasswordOriginal123!",
      }),
    });
    assert.equal(resLoginCliente.status, 200, "Login de cliente debe ser 200");
    const datosLoginCliente = (await resLoginCliente.json()) as any;
    const tokenSesionCliente = datosLoginCliente.token;
    assert.ok(tokenSesionCliente);

    console.log("[casos-recuperacion] Identidades y sesiones preparadas.");

    // -----------------------------------------------------------------
    // Caso 1: Sin transporte configurado devuelve 503 con diagnóstico claro
    // -----------------------------------------------------------------
    console.log("[caso 1] Verificando rechazo 503 cuando el transporte de correo no está disponible...");
    habilitarCapturadorPruebas(false);
    const hostPrevio = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;

    const resSinTransporte = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "freelancer@example.test" }),
    });
    assert.equal(resSinTransporte.status, 503, "Debe responder 503 si el transporte no está configurado");
    const datosSinTransporte = (await resSinTransporte.json()) as any;
    assert.ok(datosSinTransporte.error.includes("correo"));

    // Restaurar capturador de prueba para el resto de la suite
    habilitarCapturadorPruebas(true);
    limpiarCorreosCapturados();
    if (hostPrevio) process.env.SMTP_HOST = hostPrevio;

    // -----------------------------------------------------------------
    // Caso 2: Respuesta uniforme para cuentas existentes e inexistentes
    // -----------------------------------------------------------------
    console.log("[caso 2] Verificando respuesta uniforme y mitigación de enumeración de cuentas...");

    // 2a: Cuenta inexistente
    const resInexistente = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "no-existe@example.test" }),
    });
    assert.equal(resInexistente.status, 200, "Debe responder 200 para cuenta inexistente");
    const datosInexistente = (await resInexistente.json()) as any;
    assert.ok(datosInexistente.mensaje.includes("Si el correo está registrado"));
    assert.equal(obtenerCorreosCapturados().length, 0, "No debe enviarse correo si la cuenta no existe");

    // 2b: Cuenta existente (Freelancer)
    const resExistente = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "freelancer@example.test" }),
    });
    assert.equal(resExistente.status, 200, "Debe responder 200 para cuenta existente");
    const datosExistente = (await resExistente.json()) as any;
    assert.equal(
      datosExistente.mensaje,
      datosInexistente.mensaje,
      "La respuesta debe ser exactamente idéntica para cuentas existentes e inexistentes"
    );

    const correosFreelancer = obtenerCorreosCapturados();
    assert.equal(correosFreelancer.length, 1, "Debe haberse capturado 1 correo");
    const correoF = correosFreelancer[0];
    assert.equal(correoF.destinatario, "freelancer@example.test");
    assert.ok(correoF.asunto.includes("Equinox"));
    assert.ok(correoF.html.includes("equinox"));
    assert.ok(correoF.html.includes("30 minutos"));
    assert.ok(correoF.enlace.includes("/recuperar-contrasena?token="));

    // Extraer token del enlace
    const urlEnlace = new URL(correoF.enlace);
    const tokenFreelancer = urlEnlace.searchParams.get("token")!;
    assert.ok(tokenFreelancer, "Debe existir un token en el enlace");
    assert.ok(tokenFreelancer.length >= 32, "El token debe tener suficiente longitud");

    // -----------------------------------------------------------------
    // Caso 3: Persistencia en base de datos: solo hash, 30 min expiración
    // -----------------------------------------------------------------
    console.log("[caso 3] Verificando persistencia exclusiva de hash SHA-256 y expiración a 30 min...");
    const tokenHashEsperado = hashTokenRecuperacion(tokenFreelancer);
    const registroDb = await prisma.solicitudRecuperacion.findUnique({
      where: { tokenHash: tokenHashEsperado },
    });
    assert.ok(registroDb, "Debe existir el registro con el hash calculado");
    assert.equal(registroDb.usuarioId, usuarioFreelancer.id);
    assert.equal(registroDb.usadoEn, null, "El token no debe estar usado aún");

    // Verificar que el token plano NO esté en ninguna columna de la tabla
    const busquedaPlano = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM solicitudes_recuperacion WHERE token_hash = $1;`,
      tokenFreelancer
    );
    assert.equal(busquedaPlano.length, 0, "El token plano nunca debe estar en la base de datos");

    // Comprobar expiración a ~30 minutos
    const diffMs = registroDb.expiraEn.getTime() - registroDb.creadoEn.getTime();
    const minutos = Math.round(diffMs / 60000);
    assert.equal(minutos, 30, "La expiración debe ser de exactamente 30 minutos");

    // -----------------------------------------------------------------
    // Caso 4: Endpoint de validación de token
    // -----------------------------------------------------------------
    console.log("[caso 4] Verificando endpoint de validación de token...");
    // 4a: Token válido
    const resValido = await fetch(
      `${urlApi}/api/autenticacion/validar-token-recuperacion?token=${encodeURIComponent(tokenFreelancer)}`
    );
    assert.equal(resValido.status, 200);
    const datosValido = (await resValido.json()) as any;
    assert.equal(datosValido.valido, true);
    assert.equal(datosValido.correo, undefined, "No debe exponer el correo");
    assert.equal(datosValido.usuarioId, undefined, "No debe exponer el usuarioId");

    // 4b: Token no encontrado
    const resInexistenteToken = await fetch(
      `${urlApi}/api/autenticacion/validar-token-recuperacion?token=token-inventado-que-no-existe-12345`
    );
    assert.equal(resInexistenteToken.status, 404);

    // -----------------------------------------------------------------
    // Caso 5: Restablecimiento de contraseña para Freelancer
    // -----------------------------------------------------------------
    console.log("[caso 5] Ejecutando restablecimiento exitoso de contraseña para freelancer...");
    const resRestablecerF = await fetch(`${urlApi}/api/autenticacion/restablecer-contrasena`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: tokenFreelancer,
        contrasena: "NuevaPasswordFreelancer2026!",
      }),
    });
    assert.equal(resRestablecerF.status, 200, "Debe responder 200 tras restablecer");
    const datosRestablecerF = (await resRestablecerF.json()) as any;
    assert.ok(datosRestablecerF.mensaje.includes("exitosamente"));
    assert.equal(datosRestablecerF.token, undefined, "NO debe iniciar sesión automáticamente");

    // Verificar en BD que el token quedó marcado como usado
    const registroUsado = await prisma.solicitudRecuperacion.findUnique({
      where: { tokenHash: tokenHashEsperado },
    });
    assert.ok(registroUsado?.usadoEn !== null, "El token debe estar marcado como usado");

    // Verificar que las sesiones previas del freelancer quedaron invalidadas
    const sesionPreviaF = await prisma.sesion.findFirst({
      where: { usuarioId: usuarioFreelancer.id, revocadaEn: null },
    });
    assert.equal(sesionPreviaF, null, "No debe haber sesiones previas activas");

    // Verificar que el token JWT previo es rechazado (401)
    const resYoRevocado = await fetch(`${urlApi}/api/autenticacion/yo`, {
      headers: { Authorization: `Bearer ${tokenSesionFreelancer}` },
    });
    assert.equal(resYoRevocado.status, 401, "La sesión previa debe ser rechazada");

    // Verificar que la contraseña anterior ya no funciona
    const resLoginViejo = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "freelancer@example.test",
        contrasena: "PasswordOriginal123!",
      }),
    });
    assert.equal(resLoginViejo.status, 401, "La contraseña vieja debe fallar");

    // Verificar que la nueva contraseña permite iniciar sesión
    const resLoginNuevo = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "freelancer@example.test",
        contrasena: "NuevaPasswordFreelancer2026!",
      }),
    });
    assert.equal(resLoginNuevo.status, 200, "La nueva contraseña debe funcionar");
    const datosLoginNuevo = (await resLoginNuevo.json()) as any;
    assert.equal(datosLoginNuevo.contexto.tipoAcceso, "ORGANIZACION");

    // -----------------------------------------------------------------
    // Caso 6: Token reutilizado debe ser rechazado con 410 Gone
    // -----------------------------------------------------------------
    console.log("[caso 6] Verificando rechazo 410 ante token ya consumido (un solo uso)...");
    const resReusoValidar = await fetch(
      `${urlApi}/api/autenticacion/validar-token-recuperacion?token=${encodeURIComponent(tokenFreelancer)}`
    );
    assert.equal(resReusoValidar.status, 410, "Validar token usado debe retornar 410");

    const resReusoRestablecer = await fetch(`${urlApi}/api/autenticacion/restablecer-contrasena`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: tokenFreelancer,
        contrasena: "OtraContrasena123!",
      }),
    });
    assert.equal(resReusoRestablecer.status, 410, "Restablecer con token usado debe retornar 410");

    // -----------------------------------------------------------------
    // Caso 7: Token expirado (> 30 min) debe ser rechazado con 410 Gone
    // -----------------------------------------------------------------
    console.log("[caso 7] Verificando rechazo 410 ante token expirado (> 30 minutos)...");
    limpiarCorreosCapturados();

    // Solicitar nuevo token
    await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "freelancer@example.test" }),
    });

    const correosExp = obtenerCorreosCapturados();
    const tokenParaExpirar = new URL(correosExp[0].enlace).searchParams.get("token")!;

    // Avanzar tiempo 31 minutos
    hooksPruebas.fijarReloj(new Date(Date.now() + 31 * 60 * 1000));

    const resTokenExpirado = await fetch(
      `${urlApi}/api/autenticacion/validar-token-recuperacion?token=${encodeURIComponent(tokenParaExpirar)}`
    );
    assert.equal(resTokenExpirado.status, 410, "Token expirado debe retornar 410 en validación");

    const resRestablecerExp = await fetch(`${urlApi}/api/autenticacion/restablecer-contrasena`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: tokenParaExpirar,
        contrasena: "ContrasenaExpirada123!",
      }),
    });
    assert.equal(resRestablecerExp.status, 410, "Token expirado debe retornar 410 al restablecer");

    // Restaurar reloj
    hooksPruebas.fijarReloj(null);

    // -----------------------------------------------------------------
    // Caso 8: Múltiples solicitudes invalidan tokens anteriores
    // -----------------------------------------------------------------
    console.log("[caso 8] Verificando que una nueva solicitud invalida tokens previos sin consumir...");
    limitadorRecuperacionCuenta.reiniciar();
    limitadorRecuperacionIp.reiniciar();
    limpiarCorreosCapturados();

    // Solicitud 1
    await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "freelancer@example.test" }),
    });
    const token1 = new URL(obtenerCorreosCapturados()[0].enlace).searchParams.get("token")!;

    // Solicitud 2
    await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "freelancer@example.test" }),
    });
    const token2 = new URL(obtenerCorreosCapturados()[1].enlace).searchParams.get("token")!;

    assert.notEqual(token1, token2, "Los tokens deben ser distintos y aleatorios");

    // Token 1 debe estar invalidado
    const resToken1 = await fetch(
      `${urlApi}/api/autenticacion/validar-token-recuperacion?token=${encodeURIComponent(token1)}`
    );
    assert.equal(resToken1.status, 410, "El token anterior debe considerarse invalidado/usado");

    // Token 2 debe ser válido
    const resToken2 = await fetch(
      `${urlApi}/api/autenticacion/validar-token-recuperacion?token=${encodeURIComponent(token2)}`
    );
    assert.equal(resToken2.status, 200, "El token más reciente debe ser válido");

    // -----------------------------------------------------------------
    // Caso 9: Flujo completo para cuenta de Cliente del Portal
    // -----------------------------------------------------------------
    console.log("[caso 9] Verificando flujo completo para cuenta de cliente del portal...");
    limitadorRecuperacionCuenta.reiniciar();
    limitadorRecuperacionIp.reiniciar();
    limpiarCorreosCapturados();

    const resSolCliente = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "cliente@example.test" }),
    });
    assert.equal(resSolCliente.status, 200);

    const tokenCliente = new URL(obtenerCorreosCapturados()[0].enlace).searchParams.get("token")!;
    assert.ok(tokenCliente);

    const resRestablecerCliente = await fetch(`${urlApi}/api/autenticacion/restablecer-contrasena`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: tokenCliente,
        contrasena: "NuevaPasswordCliente2026!",
      }),
    });
    assert.equal(resRestablecerCliente.status, 200);

    // Verificar que la sesión previa del cliente quedó revocada
    const resYoClienteRevocado = await fetch(`${urlApi}/api/autenticacion/yo`, {
      headers: { Authorization: `Bearer ${tokenSesionCliente}` },
    });
    assert.equal(resYoClienteRevocado.status, 401, "La sesión previa del cliente debe ser rechazada");

    // Verificar inicio de sesión del cliente con su nueva contraseña en el portal
    const resLoginClienteNuevo = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "cliente@example.test",
        contrasena: "NuevaPasswordCliente2026!",
      }),
    });
    assert.equal(resLoginClienteNuevo.status, 200);
    const datosLoginClienteNuevo = (await resLoginClienteNuevo.json()) as any;
    assert.equal(datosLoginClienteNuevo.contexto.tipoAcceso, "CLIENTE");

    // -----------------------------------------------------------------
    // Caso 10: Rate limiting por IP y por cuenta
    // -----------------------------------------------------------------
    console.log("[caso 10] Verificando rate limiting (429) por cuenta e IP...");
    // Reiniciar limitadores para aislar el caso
    limitadorRecuperacionCuenta.reiniciar();
    limitadorRecuperacionIp.reiniciar();

    const correoPruebaRL = "ratelimit@example.test";
    // El límite por cuenta es 3 en 15 minutos
    const r1 = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoPruebaRL }),
    });
    assert.equal(r1.status, 200);

    const r2 = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoPruebaRL }),
    });
    assert.equal(r2.status, 200);

    const r3 = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoPruebaRL }),
    });
    assert.equal(r3.status, 200);

    // 4to intento debe responder 429
    const r4 = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoPruebaRL }),
    });
    assert.equal(r4.status, 429, "Debe responder 429 al superar el límite de solicitudes");

    // -----------------------------------------------------------------
    // Caso 11: Sanitización segura de logs y Referer
    // -----------------------------------------------------------------
    console.log("[caso 11] Verificando sanitización de URLs y parámetros en logs...");
    const urlConToken = "/recuperar-contrasena?token=secreto1234567890abcdef";
    const sanitizada1 = sanitizarUrlParaLogs(urlConToken);
    assert.equal(sanitizada1, "/recuperar-contrasena?token=[REDACTADO]");

    const urlRutaToken = "/recuperar-contrasena/secreto1234567890abcdef";
    const sanitizada2 = sanitizarUrlParaLogs(urlRutaToken);
    assert.equal(sanitizada2, "/recuperar-contrasena/[REDACTADO]");

    const urlApiToken = "/api/autenticacion/validar-token-recuperacion?token=secreto1234567890abcdef";
    const sanitizada3 = sanitizarUrlParaLogs(urlApiToken);
    assert.equal(sanitizada3, "/api/autenticacion/validar-token-recuperacion?token=[REDACTADO]");

    // -----------------------------------------------------------------
    // Caso 12: Política de contraseñas (mínimo 8 caracteres)
    // -----------------------------------------------------------------
    console.log("[caso 12] Verificando validación de longitud mínima de contraseña (8 caracteres)...");
    const resPassCorta = await fetch(`${urlApi}/api/autenticacion/restablecer-contrasena`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: token2,
        contrasena: "12345", // Menor a 8 caracteres
      }),
    });
    assert.equal(resPassCorta.status, 422, "Debe responder 422 por validación de esquema con contraseña menor a 8 caracteres");

    console.log("\n[casos-recuperacion] ✅ Todos los 12 casos de prueba pasaron exitosamente.");
  } finally {
    if (servidor) {
      await new Promise<void>((resolve) => (servidor as any).close(() => resolve()));
    }
    await prisma.$disconnect();
  }
}

ejecutarCasos().catch((err) => {
  console.error("[casos-recuperacion] ❌ Error en ejecución:", err);
  process.exit(1);
});
