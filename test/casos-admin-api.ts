import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";

const BASE_ESPERADA = "equinox_admin_api_test";

async function verificarBaseActual() {
  const resultado = await prisma.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database();
  `;
  const nombreActual = resultado[0]?.current_database;
  if (nombreActual !== BASE_ESPERADA) {
    console.error(
      `[SEGURIDAD CRÍTICA] La base actual es '${nombreActual}', pero se exige '${BASE_ESPERADA}'. Abortando.`
    );
    process.exit(1);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function firmarJwt(payload: Record<string, unknown>, expiresIn = "1h"): string {
  const secreto = process.env.SECRETO_JWT || "secreto-pruebas-aislado-admin-api-no-produccion";
  return jwt.sign(payload, secreto, { expiresIn: expiresIn as jwt.SignOptions["expiresIn"] });
}

async function api(
  baseUrl: string,
  ruta: string,
  opciones: { method?: string; token?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (opciones.token) {
    headers["Authorization"] = `Bearer ${opciones.token}`;
  }
  if (opciones.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const respuesta = await fetch(`${baseUrl}${ruta}`, {
    method: opciones.method ?? "GET",
    headers,
    body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
  });

  const texto = await respuesta.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }

  return { status: respuesta.status, json, texto };
}

async function limpiarFixtures() {
  await prisma.auditoriaAdmin.deleteMany();
  await prisma.historialSuscripcion.deleteMany();
  await prisma.suscripcionOrganizacion.deleteMany();
  await prisma.planSuscripcion.deleteMany();
  await prisma.fotoSesion.deleteMany();
  await prisma.sesionFotografica.deleteMany();
  await prisma.factura.deleteMany();
  await prisma.proyecto.deleteMany();
  await prisma.accesoCliente.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.miembroOrganizacion.deleteMany();
  await prisma.sesion.deleteMany();
  await prisma.organizacion.deleteMany();
  await prisma.usuario.deleteMany();
}

async function ejecutarCasos() {
  await verificarBaseActual();
  await limpiarFixtures();

  let servidor: ReturnType<typeof createServer> | null = null;
  let urlApi = "";

  try {
    await new Promise<void>((resolve) => {
      servidor = createServer(aplicacion);
      servidor.listen(0, () => {
        const addr = servidor!.address();
        if (typeof addr === "object" && addr) {
          urlApi = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    const passHash = await bcrypt.hash("AdminTest123!", 10);

    // 1. Usuarios reales en BD aislada
    const adminUser = await prisma.usuario.create({
      data: {
        correo: "superadmin@equinox.test",
        contrasenaHash: passHash,
        nombre: "Super",
        apellido: "Admin",
        rolPlataforma: "ADMIN_GLOBAL",
        mfaHabilitado: true,
        correoVerificadoEn: new Date(),
      },
    });

    const ownerUser = await prisma.usuario.create({
      data: {
        correo: "owner@estudio-alfa.test",
        contrasenaHash: passHash,
        nombre: "Ana",
        apellido: "Alfa",
        rolPlataforma: "USUARIO",
        correoVerificadoEn: new Date(),
      },
    });

    const collabUser = await prisma.usuario.create({
      data: {
        correo: "colab@estudio-beta.test",
        contrasenaHash: passHash,
        nombre: "Beto",
        apellido: "Beta",
        rolPlataforma: "USUARIO",
      },
    });

    const clientUser = await prisma.usuario.create({
      data: {
        correo: "cliente@portal.test",
        contrasenaHash: passHash,
        nombre: "Carlos",
        apellido: "Cliente",
        rolPlataforma: "USUARIO",
        correoVerificadoEn: new Date(),
      },
    });

    // 2. Organizaciones y datos operativos reales
    const org1 = await prisma.organizacion.create({
      data: {
        nombre: "Estudio Alfa",
        slug: "estudio-alfa",
        correoContacto: "hola@alfa.test",
        ruc: "RUC-ALFA-01",
        tipoFreelance: "FOTOGRAFIA",
      },
    });

    const org2 = await prisma.organizacion.create({
      data: {
        nombre: "Dev Beta",
        slug: "dev-beta",
        correoContacto: "hola@beta.test",
        tipoFreelance: "DESARROLLO_SOFTWARE",
      },
    });

    const org3 = await prisma.organizacion.create({
      data: {
        nombre: "Diseño Gamma",
        slug: "diseno-gamma",
        correoContacto: "hola@gamma.test",
        tipoFreelance: "DISENO_GRAFICO",
      },
    });

    const miembroOwnerOrg1 = await prisma.miembroOrganizacion.create({
      data: { usuarioId: ownerUser.id, organizacionId: org1.id, rol: "PROPIETARIO" },
    });
    const miembroCollabOrg2 = await prisma.miembroOrganizacion.create({
      data: { usuarioId: collabUser.id, organizacionId: org2.id, rol: "COLABORADOR" },
    });
    await prisma.miembroOrganizacion.create({
      data: { usuarioId: ownerUser.id, organizacionId: org3.id, rol: "PROPIETARIO" },
    });

    const cliente1 = await prisma.cliente.create({
      data: { organizacionId: org1.id, nombre: "Cliente Alfa 1", correo: "c1@alfa.test" },
    });
    const cliente2 = await prisma.cliente.create({
      data: { organizacionId: org2.id, nombre: "Cliente Beta 1", correo: "c1@beta.test" },
    });

    const accesoCliente1 = await prisma.accesoCliente.create({
      data: {
        usuarioId: clientUser.id,
        organizacionId: org1.id,
        clienteId: cliente1.id,
        rol: "TITULAR",
        activo: true,
      },
    });
    const accesoCliente2 = await prisma.accesoCliente.create({
      data: {
        usuarioId: collabUser.id,
        organizacionId: org2.id,
        clienteId: cliente2.id,
        rol: "COLABORADOR",
        activo: true,
      },
    });

    const proyecto1 = await prisma.proyecto.create({
      data: {
        organizacionId: org1.id,
        clienteId: cliente1.id,
        creadoPorId: ownerUser.id,
        nombre: "Proyecto Alfa",
        estado: "ACTIVO",
      },
    });

    await prisma.factura.create({
      data: {
        organizacionId: org1.id,
        clienteId: cliente1.id,
        proyectoId: proyecto1.id,
        numero: "INV-TEST-001",
        concepto: "Sesión fotográfica",
        monto: 250,
        estado: "ENVIADA",
      },
    });

    const sesionFoto = await prisma.sesionFotografica.create({
      data: {
        organizacionId: org1.id,
        clienteId: cliente1.id,
        nombre: "Sesión Prueba",
      },
    });

    await prisma.fotoSesion.create({
      data: {
        sesionId: sesionFoto.id,
        almacenamientoKey: `test/${randomUUID()}.jpg`,
        nombreOriginal: "foto.jpg",
        tipoMime: "image/jpeg",
        tamanoBytes: 1024,
      },
    });

    const planBase = await prisma.planSuscripcion.create({
      data: {
        codigo: "PLAN_TEST",
        nombre: "Plan Manual Test",
        activo: true,
      },
    });

    await prisma.suscripcionOrganizacion.create({
      data: {
        organizacionId: org1.id,
        planId: planBase.id,
        estado: "ACTIVA",
        fechaInicio: new Date(),
        asignadoPorUsuarioId: adminUser.id,
        asignadoEn: new Date(),
      },
    });

    // 3. Sesiones para probar 401, 403, MFA, revocación e IDOR
    const expiraEn = new Date(Date.now() + 3600_000);

    const sesionAdminOkId = randomUUID();
    const tokenAdminOk = firmarJwt({
      tipoAcceso: "ADMIN_GLOBAL",
      sesionId: sesionAdminOkId,
      usuarioId: adminUser.id,
      rolPlataforma: "ADMIN_GLOBAL",
      mfaVerificado: true,
    });
    await prisma.sesion.create({
      data: {
        id: sesionAdminOkId,
        usuarioId: adminUser.id,
        tokenHash: hashToken(tokenAdminOk),
        tipoAcceso: "ADMIN_GLOBAL",
        mfaVerificado: true,
        mfaVerificadoEn: new Date(),
        expiraEn,
      },
    });

    const sesionAdminSinMfaId = randomUUID();
    const tokenAdminJwtSinMfa = firmarJwt({
      tipoAcceso: "ADMIN_GLOBAL",
      sesionId: sesionAdminSinMfaId,
      usuarioId: adminUser.id,
      rolPlataforma: "ADMIN_GLOBAL",
      mfaVerificado: false,
    });
    const tokenAdminSinMfa = firmarJwt({
      tipoAcceso: "ADMIN_GLOBAL",
      sesionId: sesionAdminSinMfaId,
      usuarioId: adminUser.id,
      rolPlataforma: "ADMIN_GLOBAL",
      mfaVerificado: true,
    });
    await prisma.sesion.create({
      data: {
        id: sesionAdminSinMfaId,
        usuarioId: adminUser.id,
        tokenHash: hashToken(tokenAdminSinMfa),
        tipoAcceso: "ADMIN_GLOBAL",
        mfaVerificado: false,
        expiraEn,
      },
    });

    const sesionAdminRevocadaId = randomUUID();
    const tokenAdminRevocada = firmarJwt({
      tipoAcceso: "ADMIN_GLOBAL",
      sesionId: sesionAdminRevocadaId,
      usuarioId: adminUser.id,
      rolPlataforma: "ADMIN_GLOBAL",
      mfaVerificado: true,
    });
    await prisma.sesion.create({
      data: {
        id: sesionAdminRevocadaId,
        usuarioId: adminUser.id,
        tokenHash: hashToken(tokenAdminRevocada),
        tipoAcceso: "ADMIN_GLOBAL",
        mfaVerificado: true,
        revocadaEn: new Date(),
        expiraEn,
      },
    });

    const sesionOwnerId = randomUUID();
    const tokenOwner = firmarJwt({
      tipoAcceso: "ORGANIZACION",
      sesionId: sesionOwnerId,
      usuarioId: ownerUser.id,
      organizacionId: org1.id,
      rolOrganizacion: "PROPIETARIO",
    });
    await prisma.sesion.create({
      data: {
        id: sesionOwnerId,
        usuarioId: ownerUser.id,
        tokenHash: hashToken(tokenOwner),
        tipoAcceso: "ORGANIZACION",
        expiraEn,
      },
    });

    const sesionClienteId = randomUUID();
    const tokenCliente = firmarJwt({
      tipoAcceso: "CLIENTE",
      sesionId: sesionClienteId,
      usuarioId: clientUser.id,
      organizacionId: org1.id,
      clienteId: cliente1.id,
      rolCliente: "TITULAR",
    });
    await prisma.sesion.create({
      data: {
        id: sesionClienteId,
        usuarioId: clientUser.id,
        tokenHash: hashToken(tokenCliente),
        tipoAcceso: "CLIENTE",
        expiraEn,
      },
    });

    // --- TEST 1: 401 Unauthorized ---
    const rutasProtegidas: Array<{ method: string; path: string; body?: unknown }> = [
      { method: "GET", path: "/api/admin/resumen" },
      { method: "GET", path: "/api/admin/organizaciones" },
      { method: "GET", path: `/api/admin/organizaciones/${org1.id}` },
      { method: "PATCH", path: `/api/admin/organizaciones/${org1.id}`, body: { nombre: "Hack" } },
      { method: "GET", path: "/api/admin/usuarios" },
      { method: "GET", path: `/api/admin/usuarios/${ownerUser.id}` },
      { method: "POST", path: `/api/admin/usuarios/${ownerUser.id}/revocar-sesiones`, body: {} },
      {
        method: "PATCH",
        path: `/api/admin/usuarios/${clientUser.id}/accesos-cliente/${accesoCliente1.id}`,
        body: { activo: false },
      },
      {
        method: "POST",
        path: `/api/admin/organizaciones/${org1.id}/suspender`,
        body: { confirmar: true, motivo: "Test" },
      },
      {
        method: "POST",
        path: `/api/admin/organizaciones/${org1.id}/reactivar`,
        body: { confirmar: true },
      },
      { method: "GET", path: "/api/admin/auditoria" },
    ];

    for (const r of rutasProtegidas) {
      const sinToken = await api(urlApi, r.path, { method: r.method, body: r.body });
      assert.equal(sinToken.status, 401, `Esperado 401 sin token en ${r.method} ${r.path}`);

      const tokenInvalido = await api(urlApi, r.path, {
        method: r.method,
        token: "token.invalido.123",
        body: r.body,
      });
      assert.equal(tokenInvalido.status, 401, `Esperado 401 con token inválido en ${r.method} ${r.path}`);

      const tokenRevocado = await api(urlApi, r.path, {
        method: r.method,
        token: tokenAdminRevocada,
        body: r.body,
      });
      assert.equal(tokenRevocado.status, 401, `Esperado 401 con sesión revocada en ${r.method} ${r.path}`);

      const tokenJwtSinMfa = await api(urlApi, r.path, {
        method: r.method,
        token: tokenAdminJwtSinMfa,
        body: r.body,
      });
      assert.equal(tokenJwtSinMfa.status, 401, `Esperado 401 con JWT sin mfaVerificado:true en ${r.method} ${r.path}`);
    }
    console.log("✔ 401 Unauthorized verificado en todas las rutas admin");

    // --- TEST 2: 403 Forbidden (roles no superadmin y ADMIN_GLOBAL sin MFA) ---
    for (const r of rutasProtegidas) {
      const resOwner = await api(urlApi, r.path, {
        method: r.method,
        token: tokenOwner,
        body: r.body,
      });
      assert.equal(resOwner.status, 403, `Esperado 403 para PROPIETARIO en ${r.method} ${r.path}`);

      const resCliente = await api(urlApi, r.path, {
        method: r.method,
        token: tokenCliente,
        body: r.body,
      });
      assert.equal(resCliente.status, 403, `Esperado 403 para CLIENTE en ${r.method} ${r.path}`);

      const resSinMfa = await api(urlApi, r.path, {
        method: r.method,
        token: tokenAdminSinMfa,
        body: r.body,
      });
      assert.equal(resSinMfa.status, 403, `Esperado 403 para ADMIN_GLOBAL sin MFA en ${r.method} ${r.path}`);
    }
    console.log("✔ 403 Forbidden verificado para PROPIETARIO, CLIENTE y ADMIN_GLOBAL sin MFA");

    // --- TEST 3: Resumen con datos reales ---
    const resumenRes = await api(urlApi, "/api/admin/resumen", { token: tokenAdminOk });
    assert.equal(resumenRes.status, 200);
    assert.equal(resumenRes.json.organizaciones.total, 3);
    assert.equal(resumenRes.json.organizaciones.porTipoFreelance.FOTOGRAFIA, 1);
    assert.equal(resumenRes.json.organizaciones.porTipoFreelance.DESARROLLO_SOFTWARE, 1);
    assert.equal(resumenRes.json.organizaciones.porTipoFreelance.DISENO_GRAFICO, 1);
    assert.equal(resumenRes.json.organizaciones.porEstadoSuscripcion.ACTIVA, 1);
    assert.equal(resumenRes.json.organizaciones.porEstadoSuscripcion.SIN_SUSCRIPCION, 2);
    assert.equal(resumenRes.json.usuarios.total, 4);
    assert.equal(resumenRes.json.usuarios.adminsGlobales, 1);
    assert.equal(resumenRes.json.operacion.clientes, 2);
    assert.equal(resumenRes.json.operacion.proyectos, 1);
    assert.equal(resumenRes.json.operacion.facturas, 1);
    assert.equal(resumenRes.json.operacion.sesionesFotograficas, 1);
    assert.equal(resumenRes.json.operacion.fotos, 1);
    console.log("✔ Resumen /api/admin/resumen coincide exactamente con BD real");

    // --- TEST 4: Paginación y filtros de organizaciones ---
    const orgPag1 = await api(urlApi, "/api/admin/organizaciones?pagina=1&limite=2", {
      token: tokenAdminOk,
    });
    assert.equal(orgPag1.status, 200);
    assert.equal(orgPag1.json.datos.length, 2);
    assert.deepEqual(orgPag1.json.paginacion, {
      pagina: 1,
      limite: 2,
      total: 3,
      totalPaginas: 2,
    });

    const orgPag2 = await api(urlApi, "/api/admin/organizaciones?pagina=2&limite=2", {
      token: tokenAdminOk,
    });
    assert.equal(orgPag2.status, 200);
    assert.equal(orgPag2.json.datos.length, 1);
    const idsPag1 = new Set(orgPag1.json.datos.map((o: any) => o.id));
    assert.equal(idsPag1.has(orgPag2.json.datos[0].id), false, "Las páginas no deben solaparse");

    const orgFiltrada = await api(
      urlApi,
      "/api/admin/organizaciones?estadoSuscripcion=ACTIVA&tipoFreelance=FOTOGRAFIA",
      { token: tokenAdminOk }
    );
    assert.equal(orgFiltrada.status, 200);
    assert.equal(orgFiltrada.json.datos.length, 1);
    assert.equal(orgFiltrada.json.datos[0].id, org1.id);
    assert.equal(orgFiltrada.json.datos[0].conteos.sesionesFotograficas, 1);
    assert.equal(orgFiltrada.json.datos[0].conteos.fotos, 1);
    assert.deepEqual(orgFiltrada.json.resumen, {
      total: 3,
      activas: 3,
      suspendidas: 0,
    });

    const correoPropietario = orgFiltrada.json.datos[0].propietarios[0]?.correo;
    assert.ok(correoPropietario, "La organización debe tener propietario");
    const orgPorCorreoOwner = await api(
      urlApi,
      `/api/admin/organizaciones?busqueda=${encodeURIComponent(correoPropietario)}`,
      { token: tokenAdminOk }
    );
    assert.equal(orgPorCorreoOwner.status, 200);
    assert.ok(orgPorCorreoOwner.json.datos.length >= 1);
    assert.ok(orgPorCorreoOwner.json.datos.some((o: any) => o.id === org1.id));
    console.log("✔ Paginación, búsqueda y filtros de organizaciones verificados");

    // --- TEST 5: Usuarios paginación y cero fuga de secretos ---
    const usersPag1 = await api(urlApi, "/api/admin/usuarios?pagina=1&limite=2", {
      token: tokenAdminOk,
    });
    assert.equal(usersPag1.status, 200);
    assert.equal(usersPag1.json.datos.length, 2);
    assert.equal(usersPag1.json.paginacion.total, 4);
    assert.equal(usersPag1.json.paginacion.totalPaginas, 2);
    assert.equal(usersPag1.texto.includes("contrasenaHash"), false);
    assert.equal(usersPag1.texto.includes("mfaSecretoCifrado"), false);
    assert.equal(usersPag1.texto.includes("tokenHash"), false);

    const userDetalle = await api(urlApi, `/api/admin/usuarios/${adminUser.id}`, {
      token: tokenAdminOk,
    });
    assert.equal(userDetalle.status, 200);
    assert.equal(userDetalle.texto.includes("tokenHash"), false);
    assert.equal(userDetalle.texto.includes("contrasenaHash"), false);
    console.log("✔ Usuarios paginados y sin exposición de secretos verificados");

    // --- TEST 6: IDOR y validación 422/404 ---
    const uuidInvalido = await api(urlApi, "/api/admin/organizaciones/no-es-uuid", {
      token: tokenAdminOk,
    });
    assert.equal(uuidInvalido.status, 422);

    const idorAcceso = await api(
      urlApi,
      `/api/admin/usuarios/${clientUser.id}/accesos-cliente/${accesoCliente2.id}`,
      {
        method: "PATCH",
        token: tokenAdminOk,
        body: { activo: false, motivo: "Intento IDOR" },
      }
    );
    assert.equal(idorAcceso.status, 404, "IDOR en accesoCliente debe responder 404");
    const acceso2Intacto = await prisma.accesoCliente.findUnique({ where: { id: accesoCliente2.id } });
    assert.equal(acceso2Intacto?.activo, true);

    const idorSesion = await api(
      urlApi,
      `/api/admin/usuarios/${clientUser.id}/revocar-sesiones`,
      {
        method: "POST",
        token: tokenAdminOk,
        body: { sesionId: sesionOwnerId, motivo: "Intento IDOR" },
      }
    );
    assert.equal(idorSesion.status, 404, "IDOR en revocar-sesiones debe responder 404");
    const sesionOwnerIntacta = await prisma.sesion.findUnique({ where: { id: sesionOwnerId } });
    assert.equal(sesionOwnerIntacta?.revocadaEn, null);

    const autoRevocar = await api(
      urlApi,
      `/api/admin/usuarios/${adminUser.id}/revocar-sesiones`,
      {
        method: "POST",
        token: tokenAdminOk,
        body: { sesionId: sesionAdminOkId },
      }
    );
    assert.equal(autoRevocar.status, 422);

    const idorMiembro = await api(
      urlApi,
      `/api/admin/organizaciones/${org1.id}/miembros/${miembroCollabOrg2.id}`,
      {
        method: "PATCH",
        token: tokenAdminOk,
        body: { rol: "PROPIETARIO" },
      }
    );
    assert.equal(idorMiembro.status, 404, "IDOR en miembroOrganizacion debe responder 404");

    const ultimoPropietario = await api(
      urlApi,
      `/api/admin/organizaciones/${org1.id}/miembros/${miembroOwnerOrg1.id}`,
      {
        method: "PATCH",
        token: tokenAdminOk,
        body: { rol: "COLABORADOR" },
      }
    );
    assert.equal(ultimoPropietario.status, 422, "No se debe degradar al último propietario");

    const elevarAdminGlobal = await api(
      urlApi,
      `/api/admin/organizaciones/${org2.id}/miembros/${miembroCollabOrg2.id}`,
      {
        method: "PATCH",
        token: tokenAdminOk,
        body: { rol: "ADMIN_GLOBAL" },
      }
    );
    assert.equal(elevarAdminGlobal.status, 422, "Nunca permitir elevar a ADMIN_GLOBAL");
    console.log("✔ Protección IDOR, último propietario, no-ADMIN_GLOBAL y validaciones 422/404 verificadas");

    // --- TEST 7: Mutaciones reales y rastro de AuditoriaAdmin ---
    const patchOrg = await api(urlApi, `/api/admin/organizaciones/${org2.id}`, {
      method: "PATCH",
      token: tokenAdminOk,
      body: {
        nombre: "Dev Beta Editado",
        portalMostrarFinanzas: true,
        motivo: "Prueba auditoría admin",
      },
    });
    assert.equal(patchOrg.status, 200);
    assert.equal(patchOrg.json.organizacion.nombre, "Dev Beta Editado");
    assert.equal(patchOrg.json.organizacion.portalMostrarFinanzas, true);

    const patchMiembro = await api(
      urlApi,
      `/api/admin/organizaciones/${org2.id}/miembros/${miembroCollabOrg2.id}`,
      {
        method: "PATCH",
        token: tokenAdminOk,
        body: { rol: "PROPIETARIO", motivo: "Promoción controlada de prueba" },
      }
    );
    assert.equal(patchMiembro.status, 200);
    assert.equal(patchMiembro.json.miembro.rol, "PROPIETARIO");

    const patchAcceso = await api(
      urlApi,
      `/api/admin/usuarios/${clientUser.id}/accesos-cliente/${accesoCliente1.id}`,
      {
        method: "PATCH",
        token: tokenAdminOk,
        body: { activo: false, motivo: "Suspensión temporal de prueba" },
      }
    );
    assert.equal(patchAcceso.status, 200);
    assert.equal(patchAcceso.json.acceso.activo, false);

    const revocarCliente = await api(
      urlApi,
      `/api/admin/usuarios/${clientUser.id}/revocar-sesiones`,
      {
        method: "POST",
        token: tokenAdminOk,
        body: { motivo: "Cierre forzado de prueba" },
      }
    );
    assert.equal(revocarCliente.status, 200);
    assert.equal(revocarCliente.json.sesionesRevocadas, 1);

    const audRes = await api(urlApi, "/api/admin/auditoria?pagina=1&limite=2", {
      token: tokenAdminOk,
    });
    assert.equal(audRes.status, 200);
    assert.equal(audRes.json.datos.length, 2);
    assert.equal(audRes.json.paginacion.total >= 3, true);

    const audFiltrada = await api(
      urlApi,
      `/api/admin/auditoria?organizacionId=${org2.id}&accion=ORGANIZACION_ACTUALIZADA`,
      { token: tokenAdminOk }
    );
    assert.equal(audFiltrada.status, 200);
    assert.equal(audFiltrada.json.datos.length, 1);
    assert.equal(audFiltrada.json.datos[0].actorUsuarioId, adminUser.id);
    assert.equal(audFiltrada.json.datos[0].metadatos.motivo, "Prueba auditoría admin");
    console.log("✔ Mutaciones y auditoría persistida verificadas");

    // --- TEST 8: Suspensión y reactivación independiente (Organizacion.suspendidaEn) ---
    const sinConfirmar = await api(
      urlApi,
      `/api/admin/organizaciones/${org1.id}/suspender`,
      {
        method: "POST",
        token: tokenAdminOk,
        body: { confirmar: false, motivo: "Falta confirmación" },
      }
    );
    assert.equal(sinConfirmar.status, 422);

    const suspenderRes = await api(
      urlApi,
      `/api/admin/organizaciones/${org1.id}/suspender`,
      {
        method: "POST",
        token: tokenAdminOk,
        body: { confirmar: true, motivo: "Incumplimiento de términos" },
      }
    );
    assert.equal(suspenderRes.status, 200);
    assert.equal(suspenderRes.json.organizacion.suspendida, true);
    assert.ok(suspenderRes.json.organizacion.suspendidaEn);
    assert.equal(suspenderRes.json.organizacion.motivoSuspension, "Incumplimiento de términos");
    assert.equal(suspenderRes.json.organizacion.suspendidaPorUsuarioId, adminUser.id);
    assert.equal(suspenderRes.json.organizacion.suscripcion.estado, "ACTIVA", "La suscripción comercial no debe alterarse");
    assert.equal(suspenderRes.json.sesionesRevocadas >= 1, true);

    // Sesión del propietario de org1 queda invalidada inmediatamente
    const accesoOwnerPostSusp = await api(urlApi, "/api/organizacion", { token: tokenOwner });
    assert.equal(accesoOwnerPostSusp.status, 401);

    // Doble suspensión -> 409
    const suspenderDeNuevo = await api(
      urlApi,
      `/api/admin/organizaciones/${org1.id}/suspender`,
      {
        method: "POST",
        token: tokenAdminOk,
        body: { confirmar: true, motivo: "Duplicado" },
      }
    );
    assert.equal(suspenderDeNuevo.status, 409);

    // Filtro ?suspendida=true y resumen
    const filtroSuspendidas = await api(urlApi, "/api/admin/organizaciones?suspendida=true", {
      token: tokenAdminOk,
    });
    assert.equal(filtroSuspendidas.status, 200);
    assert.equal(filtroSuspendidas.json.datos.length, 1);
    assert.equal(filtroSuspendidas.json.datos[0].id, org1.id);

    const resumenPostSusp = await api(urlApi, "/api/admin/resumen", { token: tokenAdminOk });
    assert.equal(resumenPostSusp.status, 200);
    assert.equal(resumenPostSusp.json.organizaciones.suspendidas, 1);
    assert.equal(resumenPostSusp.json.organizaciones.activas, 2);

    // Reactivar
    const reactivarRes = await api(
      urlApi,
      `/api/admin/organizaciones/${org1.id}/reactivar`,
      {
        method: "POST",
        token: tokenAdminOk,
        body: { confirmar: true, motivo: "Regularización completada" },
      }
    );
    assert.equal(reactivarRes.status, 200);
    assert.equal(reactivarRes.json.organizacion.suspendida, false);
    assert.equal(reactivarRes.json.organizacion.suspendidaEn, null);
    assert.equal(reactivarRes.json.organizacion.motivoSuspension, null);

    // Doble reactivación -> 409
    const reactivarDeNuevo = await api(
      urlApi,
      `/api/admin/organizaciones/${org1.id}/reactivar`,
      {
        method: "POST",
        token: tokenAdminOk,
        body: { confirmar: true },
      }
    );
    assert.equal(reactivarDeNuevo.status, 409);

    // Verificar auditoría de suspensión y reactivación
    const audSusp = await api(
      urlApi,
      `/api/admin/auditoria?organizacionId=${org1.id}&accion=ORGANIZACION_SUSPENDIDA`,
      { token: tokenAdminOk }
    );
    assert.equal(audSusp.status, 200);
    assert.equal(audSusp.json.datos.length, 1);

    const audReact = await api(
      urlApi,
      `/api/admin/auditoria?organizacionId=${org1.id}&accion=ORGANIZACION_REACTIVADA`,
      { token: tokenAdminOk }
    );
    assert.equal(audReact.status, 200);
    assert.equal(audReact.json.datos.length, 1);
    console.log("✔ Suspensión y reactivación independiente (Organizacion.suspendidaEn) verificadas");

    console.log("\n[admin-api] TODAS LAS PRUEBAS PASARON EN BASE AISLADA.");
  } finally {
    await limpiarFixtures().catch(() => {});
    if (servidor) {
      await new Promise<void>((resolve) => servidor!.close(() => resolve()));
    }
    await prisma.$disconnect();
  }
}

ejecutarCasos().catch((err) => {
  console.error("[admin-api] FALLO EN PRUEBAS:", err);
  process.exit(1);
});
