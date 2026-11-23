import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";

const BASE_ESPERADA = "equinox_admin_suscripciones_test";

async function verificarBaseActual() {
  const resultado: Array<{ current_database: string }> =
    await prisma.$queryRaw`SELECT current_database();`;
  assert.equal(
    resultado[0]?.current_database,
    BASE_ESPERADA,
    "Las pruebas destructivas solo pueden usar la base temporal autorizada"
  );
}

async function limpiarDatosPrueba() {
  await prisma.historialSuscripcion.deleteMany();
  await prisma.suscripcionOrganizacion.deleteMany();
  await prisma.planSuscripcion.deleteMany();
  await prisma.auditoriaAdmin.deleteMany();
  await prisma.actividad.deleteMany();
  await prisma.sesion.deleteMany();
  await prisma.miembroOrganizacion.deleteMany();
  await prisma.organizacion.deleteMany();
  await prisma.usuario.deleteMany();
}

async function crearAdminGlobalConSesion(correo: string, nombre: string) {
  const hash = await bcrypt.hash("AdminSegura123!", 10);
  const usuario = await prisma.usuario.create({
    data: {
      correo,
      contrasenaHash: hash,
      nombre,
      rolPlataforma: "ADMIN_GLOBAL",
      mfaHabilitado: true,
      mfaVerificadoEn: new Date(),
      correoVerificadoEn: new Date(),
    },
  });

  const sesionId = randomUUID();
  const { token, expiraEn } = firmarToken(
    {
      tipoAcceso: "ADMIN_GLOBAL",
      usuarioId: usuario.id,
      rolPlataforma: "ADMIN_GLOBAL",
      mfaVerificado: true,
    },
    sesionId
  );

  await prisma.sesion.create({
    data: {
      id: sesionId,
      usuarioId: usuario.id,
      tipoAcceso: "ADMIN_GLOBAL",
      mfaVerificado: true,
      mfaVerificadoEn: new Date(),
      tokenHash: hashToken(token),
      expiraEn,
    },
  });

  return { usuario, token };
}

async function ejecutar() {
  await verificarBaseActual();
  let servidor: ReturnType<typeof createServer> | null = null;
  let urlApi = "";

  try {
    servidor = createServer(aplicacion);
    await new Promise<void>((resolve) =>
      servidor!.listen(0, () => {
        const direccion = servidor!.address();
        if (typeof direccion === "object" && direccion) {
          urlApi = `http://127.0.0.1:${direccion.port}`;
        }
        resolve();
      })
    );

    await limpiarDatosPrueba();

    // 1. Crear usuario normal con organización + 2da organización + ADMIN_GLOBAL
    const regResp = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "owner.suscripcion@example.test",
        contrasena: "Password123!",
        nombre: "Propietario Normal",
        nombreEstudio: "Estudio Alfa",
        slug: "estudio-alfa-susc",
      }),
    });
    assert.equal(regResp.status, 201);
    const regData = (await regResp.json()) as {
      token: string;
      organizacion: { id: string };
    };

    const orgBeta = await prisma.organizacion.create({
      data: {
        nombre: "Estudio Beta",
        slug: "estudio-beta-susc",
        correoContacto: "beta@example.test",
      },
    });

    const admin = await crearAdminGlobalConSesion(
      "superadmin.susc@equinox.test",
      "Super Admin"
    );

    const headersAdmin = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${admin.token}`,
    };
    const headersOwner = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${regData.token}`,
    };

    // 2. Control de acceso: sin token (401) y usuario normal (403)
    const sinToken = await fetch(`${urlApi}/api/admin/suscripciones`);
    assert.equal(sinToken.status, 401);

    const conOwner = await fetch(`${urlApi}/api/admin/suscripciones`, {
      headers: headersOwner,
    });
    assert.equal(conOwner.status, 403);

    // 3. Catálogo de planes configurable y paginado
    const crearPlanPrueba = await fetch(`${urlApi}/api/admin/suscripciones/planes`, {
      method: "POST",
      headers: headersAdmin,
      body: JSON.stringify({
        codigo: "prueba_manual",
        nombre: "Prueba Manual 14 días",
        descripcion: "Evaluación asistida sin cobro",
        esPlanPrueba: true,
        duracionSugeridaDias: 14,
        caracteristicas: { acompanamiento: "Manual" },
        orden: 1,
      }),
    });
    assert.equal(crearPlanPrueba.status, 201);
    const planPruebaJson = (await crearPlanPrueba.json()) as {
      plan: { id: string; codigo: string; esPlanPrueba: boolean };
      modalidadGestion: string;
      etiquetaCobro: string;
    };
    assert.equal(planPruebaJson.plan.codigo, "PRUEBA_MANUAL");
    assert.equal(planPruebaJson.modalidadGestion, "MANUAL_SIN_COBRO");
    assert.equal(planPruebaJson.etiquetaCobro, "Manual, sin cobro procesado");

    const crearPlanDuplicado = await fetch(`${urlApi}/api/admin/suscripciones/planes`, {
      method: "POST",
      headers: headersAdmin,
      body: JSON.stringify({
        codigo: "PRUEBA_MANUAL",
        nombre: "Duplicado",
      }),
    });
    assert.equal(crearPlanDuplicado.status, 409);

    const crearPlanBase = await fetch(`${urlApi}/api/admin/suscripciones/planes`, {
      method: "POST",
      headers: headersAdmin,
      body: JSON.stringify({
        codigo: "BASE_MANUAL",
        nombre: "Plan Base Manual",
        orden: 2,
      }),
    });
    assert.equal(crearPlanBase.status, 201);
    const planBaseJson = (await crearPlanBase.json()) as { plan: { id: string } };

    const crearPlanInactivo = await fetch(`${urlApi}/api/admin/suscripciones/planes`, {
      method: "POST",
      headers: headersAdmin,
      body: JSON.stringify({
        codigo: "LEGADO_INACTIVO",
        nombre: "Plan Inactivo",
        activo: false,
        orden: 3,
      }),
    });
    assert.equal(crearPlanInactivo.status, 201);
    const planInactivoJson = (await crearPlanInactivo.json()) as { plan: { id: string } };

    const listarPlanesPag1 = await fetch(
      `${urlApi}/api/admin/suscripciones/planes?pagina=1&limite=2`,
      { headers: headersAdmin }
    );
    assert.equal(listarPlanesPag1.status, 200);
    const planesPag1 = (await listarPlanesPag1.json()) as {
      datos: Array<{ codigo: string }>;
      paginacion: { total: number; totalPaginas: number };
    };
    assert.equal(planesPag1.datos.length, 2);
    assert.equal(planesPag1.paginacion.total, 3);
    assert.equal(planesPag1.paginacion.totalPaginas, 2);

    const editarPlan = await fetch(
      `${urlApi}/api/admin/suscripciones/planes/${planBaseJson.plan.id}`,
      {
        method: "PATCH",
        headers: headersAdmin,
        body: JSON.stringify({ descripcion: "Gestión manual sin pasarela" }),
      }
    );
    assert.equal(editarPlan.status, 200);

    // 4. Listado paginado de organizaciones en SIN_SUSCRIPCION
    const listarOrgs = await fetch(
      `${urlApi}/api/admin/suscripciones?pagina=1&limite=1`,
      { headers: headersAdmin }
    );
    assert.equal(listarOrgs.status, 200);
    const orgsJson = (await listarOrgs.json()) as {
      datos: Array<{ suscripcion: { estado: string; etiquetaCobro: string } }>;
      paginacion: { total: number; totalPaginas: number };
      resumenEstados: Record<string, number>;
      etiquetaCobro: string;
    };
    assert.equal(orgsJson.datos.length, 1);
    assert.equal(orgsJson.paginacion.total, 2);
    assert.equal(orgsJson.paginacion.totalPaginas, 2);
    assert.equal(orgsJson.resumenEstados.SIN_SUSCRIPCION, 2);
    assert.equal(orgsJson.datos[0].suscripcion.estado, "SIN_SUSCRIPCION");
    assert.equal(orgsJson.etiquetaCobro, "Manual, sin cobro procesado");

    // 5. Validaciones de negocio: plan inactivo, fechas inválidas, cancelar sin suscripción
    const asignarInactivo = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}/asignar`,
      {
        method: "POST",
        headers: headersAdmin,
        body: JSON.stringify({
          planId: planInactivoJson.plan.id,
          estado: "ACTIVA",
        }),
      }
    );
    assert.equal(asignarInactivo.status, 422);

    const asignarFechasMal = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}/asignar`,
      {
        method: "POST",
        headers: headersAdmin,
        body: JSON.stringify({
          planId: planBaseJson.plan.id,
          estado: "ACTIVA",
          fechaInicio: "2026-12-10T00:00:00.000Z",
          fechaFin: "2026-12-01T00:00:00.000Z",
        }),
      }
    );
    assert.equal(asignarFechasMal.status, 422);

    const cancelarSinSusc = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}/cancelar`,
      {
        method: "POST",
        headers: headersAdmin,
        body: JSON.stringify({ motivoCancelacion: "Intento inválido" }),
      }
    );
    assert.equal(cancelarSinSusc.status, 422);

    // 6. Ciclo completo: asignar PRUEBA -> promover a ACTIVA -> SUSPENDIDA -> REACTIVADA -> CANCELADA -> REASIGNADA
    const asignarPrueba = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}/asignar`,
      {
        method: "POST",
        headers: headersAdmin,
        body: JSON.stringify({
          planId: planPruebaJson.plan.id,
          estado: "PRUEBA",
          motivo: "Prueba inicial acordada",
          referenciaManual: "PILOTO-01",
        }),
      }
    );
    assert.equal(asignarPrueba.status, 201);
    const pruebaJson = (await asignarPrueba.json()) as {
      suscripcion: {
        estado: string;
        fechaInicio: string;
        fechaFin: string | null;
        asignadoPor: { id: string; correo: string } | null;
      };
    };
    assert.equal(pruebaJson.suscripcion.estado, "PRUEBA");
    assert.ok(pruebaJson.suscripcion.fechaFin, "Debe calcular fechaFin sugerida de prueba");
    assert.equal(pruebaJson.suscripcion.asignadoPor?.correo, "superadmin.susc@equinox.test");

    const promoverActiva = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}`,
      {
        method: "PATCH",
        headers: headersAdmin,
        body: JSON.stringify({
          planId: planBaseJson.plan.id,
          estado: "ACTIVA",
          fechaFin: null,
          motivo: "Paso a suscripción manual indefinida",
        }),
      }
    );
    assert.equal(promoverActiva.status, 200);
    const activaJson = (await promoverActiva.json()) as {
      suscripcion: { estado: string; fechaFin: string | null };
    };
    assert.equal(activaJson.suscripcion.estado, "ACTIVA");
    assert.equal(activaJson.suscripcion.fechaFin, null);

    const suspender = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}`,
      {
        method: "PATCH",
        headers: headersAdmin,
        body: JSON.stringify({
          estado: "SUSPENDIDA",
          motivo: "Pausa administrativa",
        }),
      }
    );
    assert.equal(suspender.status, 200);

    const reactivar = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}`,
      {
        method: "PATCH",
        headers: headersAdmin,
        body: JSON.stringify({
          estado: "ACTIVA",
          motivo: "Reactivación manual",
        }),
      }
    );
    assert.equal(reactivar.status, 200);

    const cancelar = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}/cancelar`,
      {
        method: "POST",
        headers: headersAdmin,
        body: JSON.stringify({
          motivoCancelacion: "Cierre de piloto",
          notas: "Sin cobros pendientes",
        }),
      }
    );
    assert.equal(cancelar.status, 200);
    const canceladaJson = (await cancelar.json()) as {
      suscripcion: {
        estado: string;
        canceladaPor: { correo: string } | null;
        motivoCancelacion: string | null;
      };
    };
    assert.equal(canceladaJson.suscripcion.estado, "CANCELADA");
    assert.equal(canceladaJson.suscripcion.canceladaPor?.correo, "superadmin.susc@equinox.test");
    assert.equal(canceladaJson.suscripcion.motivoCancelacion, "Cierre de piloto");

    const cancelarDeNuevo = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}/cancelar`,
      {
        method: "POST",
        headers: headersAdmin,
        body: JSON.stringify({ motivoCancelacion: "Doble cancelación" }),
      }
    );
    assert.equal(cancelarDeNuevo.status, 422);

    const reasignar = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}/asignar`,
      {
        method: "POST",
        headers: headersAdmin,
        body: JSON.stringify({
          planId: planBaseJson.plan.id,
          estado: "ACTIVA",
          motivo: "Nueva alta manual",
        }),
      }
    );
    assert.equal(reasignar.status, 200);

    // 7. Historial paginado y auditoría completa
    const historialResp = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${regData.organizacion.id}/historial?pagina=1&limite=3`,
      { headers: headersAdmin }
    );
    assert.equal(historialResp.status, 200);
    const historialJson = (await historialResp.json()) as {
      datos: Array<{ accion: string; realizadoPorCorreo: string | null }>;
      paginacion: { total: number; totalPaginas: number };
      etiquetaCobro: string;
    };
    assert.equal(historialJson.datos.length, 3);
    assert.equal(historialJson.paginacion.total, 6);
    assert.equal(historialJson.paginacion.totalPaginas, 2);
    assert.equal(historialJson.etiquetaCobro, "Manual, sin cobro procesado");
    assert.equal(historialJson.datos[0].realizadoPorCorreo, "superadmin.susc@equinox.test");

    const auditorias = await prisma.auditoriaAdmin.count({
      where: {
        actorUsuarioId: admin.usuario.id,
        accion: {
          in: [
            "PLAN_SUSCRIPCION_CREADO",
            "PLAN_SUSCRIPCION_ACTUALIZADO",
            "SUSCRIPCION_MANUAL_ASIGNADA",
            "SUSCRIPCION_MANUAL_ACTUALIZADA",
            "SUSCRIPCION_MANUAL_CANCELADA",
          ],
        },
      },
    });
    assert.equal(auditorias, 10);

    // Verificar que orgBeta sigue en SIN_SUSCRIPCION
    const orgBetaResp = await fetch(
      `${urlApi}/api/admin/suscripciones/organizaciones/${orgBeta.id}`,
      { headers: headersAdmin }
    );
    assert.equal(orgBetaResp.status, 200);
    const orgBetaJson = (await orgBetaResp.json()) as {
      suscripcion: { estado: string };
    };
    assert.equal(orgBetaJson.suscripcion.estado, "SIN_SUSCRIPCION");

    await limpiarDatosPrueba();
    console.log("Suite de suscripciones manuales admin completada con éxito.");
  } finally {
    if (servidor) {
      await new Promise<void>((resolve) => servidor!.close(() => resolve()));
    }
    await prisma.$disconnect();
  }
}

ejecutar().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
