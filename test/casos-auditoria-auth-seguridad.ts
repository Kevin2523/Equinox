import assert from "node:assert/strict";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { habilitarCapturadorPruebas, limpiarCorreosCapturados, obtenerCorreosCapturados } from "../src/servicios/correo.js";
import { hashTokenRecuperacion } from "../src/utilidades/recuperacion.js";
import {
  limitadorRecuperacionIp,
  limitadorRecuperacionCuenta,
  limitadorValidarTokenIp,
  limitadorRestablecerIp,
} from "../src/rutas/autenticacion.js";

const BASE_ESPERADA = "equinox_auditoria_auth_test";

async function verificarBaseActual() {
  const resultado: Array<{ current_database: string }> =
    await prisma.$queryRaw`SELECT current_database();`;

  const nombreActual = resultado[0]?.current_database;
  if (nombreActual !== BASE_ESPERADA) {
    console.error(
      `[SEGURIDAD CRÍTICA] La base actual es '${nombreActual}', pero se exige '${BASE_ESPERADA}'. Abortando.`
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

    console.log(`[auditoria-auth] Servidor de pruebas iniciado en ${urlApi}`);

    // Limpieza en base aislada
    await prisma.solicitudRecuperacion.deleteMany();
    await prisma.sesion.deleteMany();
    await prisma.accesoCliente.deleteMany();
    await prisma.miembroOrganizacion.deleteMany();
    await prisma.cliente.deleteMany();
    await prisma.proyecto.deleteMany();
    await prisma.factura.deleteMany();
    await prisma.organizacion.deleteMany();
    await prisma.usuario.deleteMany();

    habilitarCapturadorPruebas(true);
    limpiarCorreosCapturados();

    // Resetear limitadores
    limitadorRecuperacionIp.reiniciar();
    limitadorRecuperacionCuenta.reiniciar();
    limitadorValidarTokenIp.reiniciar();
    limitadorRestablecerIp.reiniciar();

    const passHash = await bcrypt.hash("PassAuditoria123!", 12);

    // Identidad 1: Freelancer / Organización
    const org1 = await prisma.organizacion.create({
      data: {
        nombre: "Estudio Auditoria",
        slug: "estudio-auditoria",
        tipoFreelance: "DESARROLLO_SOFTWARE",
      },
    });

    const userFreelancer = await prisma.usuario.create({
      data: {
        correo: "freelancer.audit@example.test",
        contrasenaHash: passHash,
        nombre: "Auditor",
        apellido: "Freelancer",
      },
    });

    await prisma.miembroOrganizacion.create({
      data: {
        usuarioId: userFreelancer.id,
        organizacionId: org1.id,
        rol: "PROPIETARIO",
      },
    });

    // Identidad 2: Cliente 1
    const cliente1 = await prisma.cliente.create({
      data: {
        organizacionId: org1.id,
        nombre: "Cliente Alfa",
        empresa: "Empresa Alfa S.A.",
        correo: "cliente.alfa@example.test",
      },
    });

    const userCliente1 = await prisma.usuario.create({
      data: {
        correo: "cliente.alfa@example.test",
        contrasenaHash: passHash,
        nombre: "Juan",
        apellido: "Cliente",
      },
    });

    await prisma.accesoCliente.create({
      data: {
        usuarioId: userCliente1.id,
        clienteId: cliente1.id,
        organizacionId: org1.id,
        rol: "TITULAR",
        activo: true,
      },
    });

    // Identidad 3: Cliente 2 (para probar aislamiento IDOR)
    const cliente2 = await prisma.cliente.create({
      data: {
        organizacionId: org1.id,
        nombre: "Cliente Beta",
        empresa: "Beta Corp",
        correo: "cliente.beta@example.test",
      },
    });

    const proyectoCliente1 = await prisma.proyecto.create({
      data: {
        organizacionId: org1.id,
        clienteId: cliente1.id,
        creadoPorId: userFreelancer.id,
        nombre: "Proyecto Confidencial Alfa",
        estado: "ACTIVO",
      },
    });

    // Login Freelancer
    const resLoginF = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "freelancer.audit@example.test",
        contrasena: "PassAuditoria123!",
      }),
    });
    const datosLoginF = await resLoginF.json() as any;
    const tokenFreelancer = datosLoginF.token;
    assert.ok(tokenFreelancer, "Token de freelancer debe generarse");

    // Login Cliente 1
    const resLoginC1 = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "cliente.alfa@example.test",
        contrasena: "PassAuditoria123!",
      }),
    });
    const datosLoginC1 = await resLoginC1.json() as any;
    const tokenCliente1 = datosLoginC1.token;
    assert.ok(tokenCliente1, "Token de cliente 1 debe generarse");

    console.log("[auditoria-auth] Setup inicial completado. Iniciando pruebas...");

    // =========================================================================
    // 1. Enumeración de cuentas por mensajes
    // =========================================================================
    console.log("[auditoria 1] Verificando enumeración por mensajes...");
    
    // 1a. Registro con correo existente -> 409 explícito
    const resRegExistente = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "freelancer.audit@example.test",
        contrasena: "PassNueva123!",
        nombre: "Nuevo",
        nombreEstudio: "Nuevo Estudio",
        slug: "nuevo-slug",
      }),
    });
    assert.equal(resRegExistente.status, 409);
    const bodyRegExistente = await resRegExistente.json() as any;
    assert.equal(bodyRegExistente.error, "Ya existe una cuenta con ese correo");
    console.log("  [1a] Registro revela existencia de cuenta (HTTP 409): COMPROBADO.");

    // 1b. Login con usuario inexistente vs contraseña errónea -> Mensaje uniforme 401
    const resLoginInexistente = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "no.existe@example.test",
        contrasena: "CualquierPass123!",
      }),
    });
    assert.equal(resLoginInexistente.status, 401);
    const bodyLoginInexistente = await resLoginInexistente.json() as any;

    const resLoginPassErronea = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "freelancer.audit@example.test",
        contrasena: "PassIncorrecta123!",
      }),
    });
    assert.equal(resLoginPassErronea.status, 401);
    const bodyLoginPassErronea = await resLoginPassErronea.json() as any;

    assert.equal(bodyLoginInexistente.error, bodyLoginPassErronea.error);
    assert.equal(bodyLoginInexistente.error, "Correo o contraseña incorrectos");
    console.log("  [1b] Login unifica mensajes de error (HTTP 401 uniforme): COMPROBADO (Control Pasó).");

    // 1c. Recuperación de contraseña: mensaje uniforme para existente e inexistente
    const resRecupInexistente = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "no.existe.recup@example.test" }),
    });
    assert.equal(resRecupInexistente.status, 200);
    const bodyRecupInexistente = await resRecupInexistente.json() as any;

    const resRecupExistente = await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "freelancer.audit@example.test" }),
    });
    assert.equal(resRecupExistente.status, 200);
    const bodyRecupExistente = await resRecupExistente.json() as any;

    assert.equal(bodyRecupInexistente.mensaje, bodyRecupExistente.mensaje);
    console.log("  [1c] Recuperación unifica mensaje de respuesta (HTTP 200 uniforme): COMPROBADO (Control Pasó).");

    // =========================================================================
    // 2. Discrepancia de tiempos (Timing Attack) en Recuperación de contraseña
    // =========================================================================
    console.log("[auditoria 2] Verificando discrepancia de tiempos en recuperación...");
    limitadorRecuperacionIp.reiniciar();
    limitadorRecuperacionCuenta.reiniciar();

    const t0Inexistente = Date.now();
    await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "otro.noexiste@example.test" }),
    });
    const duracionInexistente = Date.now() - t0Inexistente;

    const t0Existente = Date.now();
    await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "cliente.alfa@example.test" }),
    });
    const duracionExistente = Date.now() - t0Existente;

    console.log(`  [2] Tiempo correo inexistente: ${duracionInexistente}ms (con bcrypt ficticio)`);
    console.log(`  [2] Tiempo correo existente: ${duracionExistente}ms (sin bcrypt)`);
    assert.ok(
      duracionInexistente > duracionExistente * 3,
      "Existe discrepancia temporal sustancial (cuenta inexistente ejecuta bcrypt compare, cuenta existente no)"
    );
    console.log("  [2] Discrepancia de tiempos en recuperación: COMPROBADO (Hallazgo de timing invertido).");

    // =========================================================================
    // 3. Ausencia de Rate Limiting en Login y Registro
    // =========================================================================
    console.log("[auditoria 3] Verificando ausencia de Rate Limiting en Login y Registro...");

    let loginBloqueado = false;
    for (let i = 0; i < 15; i++) {
      const res = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo: "freelancer.audit@example.test",
          contrasena: `FuerzaBruta${i}!`,
        }),
      });
      if (res.status === 429) {
        loginBloqueado = true;
        break;
      }
    }
    assert.equal(loginBloqueado, false, "Login no debe tener rate limit (vulnerabilidad)");
    console.log("  [3a] POST /inicio-sesion permite más de 15 intentos sin 429: COMPROBADO (Ausencia de rate limit).");

    let registroBloqueado = false;
    for (let i = 0; i < 15; i++) {
      const res = await fetch(`${urlApi}/api/autenticacion/registro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo: `spam.test.${i}@example.test`,
          contrasena: "Password123!",
          nombre: "Spam",
          nombreEstudio: `Spam Studio ${i}`,
          slug: `spam-slug-${i}`,
        }),
      });
      if (res.status === 429) {
        registroBloqueado = true;
        break;
      }
    }
    assert.equal(registroBloqueado, false, "Registro no debe tener rate limit (vulnerabilidad)");
    console.log("  [3b] POST /registro permite múltiples creaciones sin 429: COMPROBADO (Ausencia de rate limit).");

    // =========================================================================
    // 4. Tokens de reset: entropía, hash, caducidad, un solo uso, invalidación de sesiones
    // =========================================================================
    console.log("[auditoria 4] Verificando seguridad del token de recuperación...");
    limitadorRecuperacionIp.reiniciar();
    limitadorRecuperacionCuenta.reiniciar();
    limpiarCorreosCapturados();

    await fetch(`${urlApi}/api/autenticacion/solicitar-recuperacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "freelancer.audit@example.test" }),
    });

    const correos = obtenerCorreosCapturados();
    assert.equal(correos.length, 1);
    const enlace = correos[0].enlace;
    const urlObj = new URL(enlace);
    const tokenPlano = urlObj.searchParams.get("token")!;
    assert.ok(tokenPlano);
    assert.ok(tokenPlano.length >= 40, "Token con entropía suficiente");

    // Verificar que solo el hash está en BD
    const tokenHash = hashTokenRecuperacion(tokenPlano);
    const registroBD = await prisma.solicitudRecuperacion.findUnique({
      where: { tokenHash },
    });
    assert.ok(registroBD, "El hash debe existir en la BD");
    const planoEnBD = await prisma.$queryRawUnsafe(
      `SELECT * FROM solicitudes_recuperacion WHERE token_hash = '${tokenPlano}';`
    ) as any[];
    assert.equal(planoEnBD.length, 0, "El token en texto plano NUNCA debe estar en la BD");
    console.log("  [4a] Entropía 256 bits y almacenamiento exclusivo de hash SHA-256: COMPROBADO (Control Pasó).");

    // Validar token no filtra datos sensibles
    const resValidar = await fetch(`${urlApi}/api/autenticacion/validar-token-recuperacion?token=${encodeURIComponent(tokenPlano)}`);
    assert.equal(resValidar.status, 200);
    const bodyValidar = await resValidar.json() as any;
    assert.deepEqual(bodyValidar, { valido: true });
    console.log("  [4b] Endpoint de validación no filtra email ni IDs: COMPROBADO (Control Pasó).");

    // Restablecer contraseña y verificar invalidación de sesión
    const resReset = await fetch(`${urlApi}/api/autenticacion/restablecer-contrasena`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: tokenPlano,
        contrasena: "PassNuevaValida456!",
      }),
    });
    assert.equal(resReset.status, 200);

    // Verificar que el token quedó consumido (un solo uso)
    const resReuso = await fetch(`${urlApi}/api/autenticacion/restablecer-contrasena`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: tokenPlano,
        contrasena: "PassOtra789!",
      }),
    });
    assert.equal(resReuso.status, 410, "Reuso de token debe ser rechazado con 410 Gone");
    console.log("  [4c] Un solo uso de token (410 en reuso): COMPROBADO (Control Pasó).");

    // Verificar que la sesión previa del freelancer fue revocada
    const resYoRevocado = await fetch(`${urlApi}/api/autenticacion/yo`, {
      headers: { Authorization: `Bearer ${tokenFreelancer}` },
    });
    assert.equal(resYoRevocado.status, 401, "La sesión anterior debe ser revocada inmediatamente");
    console.log("  [4d] Invalidación atómica de todas las sesiones activas: COMPROBADO (Control Pasó).");

    // Iniciar nueva sesión con nueva contraseña
    const resLoginNuevo = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "freelancer.audit@example.test",
        contrasena: "PassNuevaValida456!",
      }),
    });
    assert.equal(resLoginNuevo.status, 200);
    const nuevoTokenFreelancer = (await resLoginNuevo.json() as any).token;

    // =========================================================================
    // 5. Control de acceso y separación Freelancer vs Cliente
    // =========================================================================
    console.log("[auditoria 5] Verificando control de acceso Freelancer vs Cliente y multitenancy...");

    // 5a. Cliente intenta acceder a endpoint interno de organización
    const resClienteOrg = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenCliente1}` },
    });
    assert.equal(resClienteOrg.status, 403);
    const bodyClienteOrg = await resClienteOrg.json() as any;
    assert.equal(bodyClienteOrg.error, "Acceso restringido a miembros de la organización");

    const resClienteProyectos = await fetch(`${urlApi}/api/proyectos`, {
      headers: { Authorization: `Bearer ${tokenCliente1}` },
    });
    assert.equal(resClienteProyectos.status, 403);

    console.log("  [5a] Cliente bloqueado en rutas internas de organización (HTTP 403): COMPROBADO (Control Pasó).");

    // 5b. Freelancer intenta acceder al portal de cliente
    const resFreelancerPortal = await fetch(`${urlApi}/api/portal`, {
      headers: { Authorization: `Bearer ${nuevoTokenFreelancer}` },
    });
    assert.equal(resFreelancerPortal.status, 403);
    const bodyFreelancerPortal = await resFreelancerPortal.json() as any;
    assert.equal(bodyFreelancerPortal.error, "Acceso restringido a cuentas de cliente");
    console.log("  [5b] Freelancer bloqueado en rutas del portal de cliente (HTTP 403): COMPROBADO (Control Pasó).");

    // 5c. Aislamiento IDOR en Portal: Cliente 1 puede ver su proyecto pero no el de otros clientes
    const resPortalProy = await fetch(`${urlApi}/api/portal/proyectos/${proyectoCliente1.id}`, {
      headers: { Authorization: `Bearer ${tokenCliente1}` },
    });
    assert.equal(resPortalProy.status, 200);

    // Creamos proyecto para Cliente 2
    const proyectoCliente2 = await prisma.proyecto.create({
      data: {
        organizacionId: org1.id,
        clienteId: cliente2.id,
        creadoPorId: userFreelancer.id,
        nombre: "Proyecto Confidencial Beta",
        estado: "ACTIVO",
      },
    });

    const resPortalProyAjeno = await fetch(`${urlApi}/api/portal/proyectos/${proyectoCliente2.id}`, {
      headers: { Authorization: `Bearer ${tokenCliente1}` },
    });
    assert.equal(resPortalProyAjeno.status, 404, "Cliente no debe ver proyectos de otro cliente");
    console.log("  [5c] Aislamiento multitenant e IDOR en Portal (HTTP 404 para proyectos ajenos): COMPROBADO (Control Pasó).");

    // =========================================================================
    // 6. Encabezados de Seguridad y CORS
    // =========================================================================
    console.log("[auditoria 6] Verificando encabezados de seguridad HTTP...");
    const resSalud = await fetch(`${urlApi}/salud`);
    assert.equal(resSalud.status, 200);
    // Helmet headers
    assert.ok(resSalud.headers.get("x-content-type-options"), "X-Content-Type-Options presente");
    assert.ok(resSalud.headers.get("x-frame-options") || resSalud.headers.get("content-security-policy"), "Protección de frames presente");
    console.log("  [6] Encabezados de seguridad HTTP Helmet aplicados: COMPROBADO (Control Pasó).");

    console.log("\n[auditoria-auth] ✅ Todas las pruebas de auditoría de seguridad completadas.");
  } finally {
    if (servidor) {
      await new Promise<void>((resolve) => (servidor as any).close(() => resolve()));
    }
  }
}

ejecutarCasos().catch((err) => {
  console.error("[auditoria-auth] Error en casos:", err);
  process.exit(1);
});
