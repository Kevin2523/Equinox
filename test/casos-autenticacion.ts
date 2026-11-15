import assert from "node:assert/strict";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { hashToken, obtenerSecretoJwt } from "../src/middleware/autenticacion.js";

const BASE_ESPERADA = "equinox_issue3_test";

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
    // Iniciar servidor HTTP temporal sobre puerto dinámico
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

    // Limpieza inicial controlada en la base aislada
    await prisma.sesion.deleteMany();
    await prisma.accesoCliente.deleteMany();
    await prisma.miembroOrganizacion.deleteMany();
    await prisma.cliente.deleteMany();
    await prisma.proyecto.deleteMany();
    await prisma.factura.deleteMany();
    await prisma.organizacion.deleteMany();
    await prisma.usuario.deleteMany();

    // -----------------------------------------------------------------
    // Caso 1: Registro correcto de propietario
    // -----------------------------------------------------------------
    const resReg = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "propietario@example.test",
        contrasena: "Password123!",
        nombre: "Propietario",
        apellido: "Alfa",
        nombreEstudio: "Estudio Alfa",
        slug: "estudio-alfa",
      }),
    });
    assert.equal(resReg.status, 201, "El registro debe responder 201");
    const datosReg = (await resReg.json()) as any;
    assert.ok(datosReg.token);
    assert.equal(datosReg.usuario.correo, "propietario@example.test");
    assert.equal(datosReg.organizacion.slug, "estudio-alfa");
    const tokenProp = datosReg.token;
    const orgAlfaId = datosReg.organizacion.id;
    const usuarioPropId = datosReg.usuario.id;

    const sesionReg = await prisma.sesion.findFirst({
      where: { usuarioId: usuarioPropId },
    });
    assert.ok(sesionReg, "Debe existir registro en sesiones");
    assert.equal(sesionReg.tokenHash, hashToken(tokenProp));

    // -----------------------------------------------------------------
    // Caso 2: Inicio de sesión de propietario
    // -----------------------------------------------------------------
    const resLoginProp = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "propietario@example.test",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resLoginProp.status, 200);
    const datosLoginProp = (await resLoginProp.json()) as any;
    assert.ok(datosLoginProp.token);
    assert.equal(datosLoginProp.contexto.tipoAcceso, "ORGANIZACION");
    assert.equal(datosLoginProp.contexto.rolOrganizacion, "PROPIETARIO");
    const tokenPropActivo = datosLoginProp.token;

    // Crear Colaborador y Cliente para pruebas
    const contrasenaHash = await bcrypt.hash("Password123!", 12);
    const usuarioColab = await prisma.usuario.create({
      data: {
        correo: "colaborador@example.test",
        contrasenaHash,
        nombre: "Colaborador",
      },
    });
    await prisma.miembroOrganizacion.create({
      data: {
        usuarioId: usuarioColab.id,
        organizacionId: orgAlfaId,
        rol: "COLABORADOR",
      },
    });

    const clienteAlfa = await prisma.cliente.create({
      data: {
        nombre: "Cliente VIP Alfa",
        organizacionId: orgAlfaId,
        estado: "ACTIVO",
      },
    });

    const usuarioCliente = await prisma.usuario.create({
      data: {
        correo: "cliente@example.test",
        contrasenaHash,
        nombre: "Usuario Cliente",
      },
    });
    await prisma.accesoCliente.create({
      data: {
        usuarioId: usuarioCliente.id,
        clienteId: clienteAlfa.id,
        organizacionId: orgAlfaId,
        rol: "TITULAR",
        activo: true,
      },
    });

    // -----------------------------------------------------------------
    // Caso 3: Inicio de sesión de colaborador
    // -----------------------------------------------------------------
    const resLoginColab = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "colaborador@example.test",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resLoginColab.status, 200);
    const datosLoginColab = (await resLoginColab.json()) as any;
    assert.equal(datosLoginColab.contexto.tipoAcceso, "ORGANIZACION");
    assert.equal(datosLoginColab.contexto.rolOrganizacion, "COLABORADOR");
    const tokenColab = datosLoginColab.token;

    // -----------------------------------------------------------------
    // Caso 4: Inicio de sesión de cliente activo
    // -----------------------------------------------------------------
    const resLoginCliente = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "cliente@example.test",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resLoginCliente.status, 200);
    const datosLoginCliente = (await resLoginCliente.json()) as any;
    assert.equal(datosLoginCliente.contexto.tipoAcceso, "CLIENTE");
    assert.equal(datosLoginCliente.contexto.rolCliente, "TITULAR");
    const tokenCliente = datosLoginCliente.token;

    // -----------------------------------------------------------------
    // Caso 5: Contraseña inválida devuelve 401
    // -----------------------------------------------------------------
    const resPassInvalido = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "propietario@example.test",
        contrasena: "ContrasenaEquivocada!",
      }),
    });
    assert.equal(resPassInvalido.status, 401);

    // -----------------------------------------------------------------
    // Caso 6: Correo inexistente y contraseña incorrecta producen respuestas equivalentes
    // -----------------------------------------------------------------
    const resUsuarioDesconocido = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "inexistente@example.test",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resUsuarioDesconocido.status, 401);
    const cuerpo1 = await resPassInvalido.json();
    const cuerpo2 = await resUsuarioDesconocido.json();
    assert.deepEqual(cuerpo1, cuerpo2, "Los cuerpos de error 401 deben ser equivalentes");

    // -----------------------------------------------------------------
    // Caso 7: Cliente intentando acceder a rutas internas recibe 403
    // -----------------------------------------------------------------
    const resClienteClientes = await fetch(`${urlApi}/api/clientes`, {
      headers: { Authorization: `Bearer ${tokenCliente}` },
    });
    assert.equal(resClienteClientes.status, 403);
    const resClienteOrg = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenCliente}` },
    });
    assert.equal(resClienteOrg.status, 403);

    // -----------------------------------------------------------------
    // Caso 8: Colaborador intentando modificar la organización recibe 403
    // -----------------------------------------------------------------
    const resColabPatchOrg = await fetch(`${urlApi}/api/organizacion`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenColab}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nombre: "Cambio no autorizado" }),
    });
    assert.equal(resColabPatchOrg.status, 403);

    // -----------------------------------------------------------------
    // Caso 9: Propietario puede modificar su organización
    // -----------------------------------------------------------------
    const resPropPatchOrg = await fetch(`${urlApi}/api/organizacion`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenPropActivo}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nombre: "Estudio Alfa Actualizado" }),
    });
    assert.equal(resPropPatchOrg.status, 200);

    // -----------------------------------------------------------------
    // Caso 10: Selección de organización ajena es rechazada (403)
    // -----------------------------------------------------------------
    const orgBeta = await prisma.organizacion.create({
      data: { nombre: "Estudio Beta", slug: "estudio-beta" },
    });
    const resOrgAjena = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "propietario@example.test",
        contrasena: "Password123!",
        seleccion: {
          tipoAcceso: "ORGANIZACION",
          organizacionId: orgBeta.id,
        },
      }),
    });
    assert.equal(resOrgAjena.status, 403);

    // -----------------------------------------------------------------
    // Caso 11: Selección de cliente ajeno es rechazada (403)
    // -----------------------------------------------------------------
    const clienteBeta = await prisma.cliente.create({
      data: { nombre: "Cliente Beta", organizacionId: orgBeta.id },
    });
    const resClienteAjeno = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "cliente@example.test",
        contrasena: "Password123!",
        seleccion: {
          tipoAcceso: "CLIENTE",
          organizacionId: orgBeta.id,
          clienteId: clienteBeta.id,
        },
      }),
    });
    assert.equal(resClienteAjeno.status, 403);

    // -----------------------------------------------------------------
    // Caso 12: Acceso de cliente inactivo es rechazado (403)
    // -----------------------------------------------------------------
    const usuarioClienteInactivo = await prisma.usuario.create({
      data: {
        correo: "inactivo@example.test",
        contrasenaHash,
        nombre: "Cliente Inactivo",
      },
    });
    await prisma.accesoCliente.create({
      data: {
        usuarioId: usuarioClienteInactivo.id,
        clienteId: clienteAlfa.id,
        organizacionId: orgAlfaId,
        rol: "COLABORADOR",
        activo: false,
      },
    });
    const resLoginInactivo = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "inactivo@example.test",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resLoginInactivo.status, 403);

    // -----------------------------------------------------------------
    // Caso 13: Token manipulado devuelve 401
    // -----------------------------------------------------------------
    const tokenManipulado = tokenPropActivo.slice(0, -6) + "abcdef";
    const resManipulado = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenManipulado}` },
    });
    assert.equal(resManipulado.status, 401);

    // -----------------------------------------------------------------
    // Caso 14: Token vencido devuelve 401
    // -----------------------------------------------------------------
    const sesionVencida = await prisma.sesion.create({
      data: {
        usuarioId: usuarioPropId,
        tokenHash: "hash-vencido",
        expiraEn: new Date(Date.now() - 3600000),
      },
    });
    const tokenVencido = jwt.sign(
      {
        tipoAcceso: "ORGANIZACION",
        sesionId: sesionVencida.id,
        usuarioId: usuarioPropId,
        organizacionId: orgAlfaId,
        rolOrganizacion: "PROPIETARIO",
      },
      obtenerSecretoJwt(),
      { expiresIn: "-10s" }
    );
    const resVencido = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenVencido}` },
    });
    assert.equal(resVencido.status, 401);

    // -----------------------------------------------------------------
    // Caso 15: Token revocado deja de funcionar
    // -----------------------------------------------------------------
    const resCerrar = await fetch(`${urlApi}/api/autenticacion/cerrar-sesion`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenPropActivo}` },
    });
    assert.equal(resCerrar.status, 200);

    const resDespuesDeCerrar = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenPropActivo}` },
    });
    assert.equal(resDespuesDeCerrar.status, 401);

    // -----------------------------------------------------------------
    // Caso 16: Las respuestas no exponen hashes ni secretos
    // -----------------------------------------------------------------
    const respuestas = [datosReg, datosLoginProp, datosLoginColab, datosLoginCliente];
    for (const r of respuestas) {
      const texto = JSON.stringify(r);
      assert.ok(!texto.includes("contrasenaHash"), "No debe exponer contrasenaHash");
      assert.ok(!texto.includes("tokenHash"), "No debe exponer tokenHash");
      assert.ok(!texto.includes(obtenerSecretoJwt()), "No debe exponer SECRETO_JWT");
    }

    // -----------------------------------------------------------------
    // Caso 17: Se conserva el aislamiento entre organizaciones
    // -----------------------------------------------------------------
    const usuarioBeta = await prisma.usuario.create({
      data: { correo: "prop.beta@example.test", contrasenaHash, nombre: "Beta Prop" },
    });
    await prisma.miembroOrganizacion.create({
      data: {
        usuarioId: usuarioBeta.id,
        organizacionId: orgBeta.id,
        rol: "PROPIETARIO",
      },
    });
    const resLoginBeta = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: "prop.beta@example.test", contrasena: "Password123!" }),
    });
    const tokenBeta = ((await resLoginBeta.json()) as any).token;

    const resClientesBeta = await fetch(`${urlApi}/api/clientes`, {
      headers: { Authorization: `Bearer ${tokenBeta}` },
    });
    assert.equal(resClientesBeta.status, 200);
    const listaClientesBeta = (await resClientesBeta.json()) as any[];
    assert.ok(
      !listaClientesBeta.some((c) => c.id === clienteAlfa.id),
      "Beta no debe ver clientes de Alfa"
    );

    // -----------------------------------------------------------------
    // Caso 18: Múltiples contextos sin selección devuelven 409 y no crean una sesión
    // -----------------------------------------------------------------
    await prisma.miembroOrganizacion.create({
      data: {
        usuarioId: usuarioPropId,
        organizacionId: orgBeta.id,
        rol: "COLABORADOR",
      },
    });

    const totalSesionesAntes = await prisma.sesion.count();

    const resMultipleSinSeleccion = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "propietario@example.test",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resMultipleSinSeleccion.status, 409, "Múltiples contextos deben devolver 409");
    const cuerpoMultiple = (await resMultipleSinSeleccion.json()) as any;
    assert.ok(cuerpoMultiple.contextos.organizaciones.length >= 2);

    const totalSesionesDespues = await prisma.sesion.count();
    assert.equal(
      totalSesionesDespues,
      totalSesionesAntes,
      "No debe haberse creado ninguna sesión en BD con respuesta 409"
    );

    // -----------------------------------------------------------------
    // Caso 19: Selección válida entre múltiples contextos
    // -----------------------------------------------------------------
    const resMultipleConSeleccion = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "propietario@example.test",
        contrasena: "Password123!",
        seleccion: {
          tipoAcceso: "ORGANIZACION",
          organizacionId: orgBeta.id,
        },
      }),
    });
    assert.equal(resMultipleConSeleccion.status, 200);
    const datosMultipleConSeleccion = (await resMultipleConSeleccion.json()) as any;
    assert.equal(datosMultipleConSeleccion.contexto.organizacionId, orgBeta.id);
    assert.equal(datosMultipleConSeleccion.contexto.rolOrganizacion, "COLABORADOR");

    // -----------------------------------------------------------------
    // Caso 20: JWT firmado pero con payload mal formado devuelve 401
    // -----------------------------------------------------------------
    const tokenMalFormado = jwt.sign(
      {
        tipoAcceso: "ORGANIZACION",
        invalido: true,
      },
      obtenerSecretoJwt()
    );
    const resMalFormado = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenMalFormado}` },
    });
    assert.equal(resMalFormado.status, 401, "Token firmado con estructura errónea debe responder 401");

    // -----------------------------------------------------------------
    // Caso 21: Registro duplicado por correo devuelve 409
    // -----------------------------------------------------------------
    const resRegDuplicadoCorreo = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "propietario@example.test",
        contrasena: "Password123!",
        nombre: "Otro",
        nombreEstudio: "Otro Estudio",
        slug: "otro-estudio-slug",
      }),
    });
    assert.equal(resRegDuplicadoCorreo.status, 409);

    // -----------------------------------------------------------------
    // Caso 22: Registro duplicado por slug devuelve 409
    // -----------------------------------------------------------------
    const resRegDuplicadoSlug = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "nuevo.usuario@example.test",
        contrasena: "Password123!",
        nombre: "Nuevo",
        nombreEstudio: "Estudio Alfa",
        slug: "estudio-alfa",
      }),
    });
    assert.equal(resRegDuplicadoSlug.status, 409);

    // -----------------------------------------------------------------
    // Caso 23: Desvinculación de miembro invalida sesiones activas en PostgreSQL
    // -----------------------------------------------------------------
    // Iniciar sesión con el colaborador en Estudio Alfa
    const resLoginColabCaso23 = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "colaborador@example.test",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resLoginColabCaso23.status, 200, "Colaborador debe iniciar sesión exitosamente");
    const datosLoginColabCaso23 = (await resLoginColabCaso23.json()) as any;
    const tokenColabCaso23 = datosLoginColabCaso23.token;
    assert.ok(tokenColabCaso23);

    // Comprobar acceso autorizado inicial a recursos de la organización
    const resAccesoInicialColab = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenColabCaso23}` },
    });
    assert.equal(resAccesoInicialColab.status, 200, "Debe tener acceso antes de ser desvinculado");

    // Eliminar la membresía del colaborador directamente en PostgreSQL y restaurarla siempre en finally.
    let miembroEliminadoCaso23 = false;
    try {
      await prisma.miembroOrganizacion.delete({
        where: {
          usuarioId_organizacionId: {
            usuarioId: usuarioColab.id,
            organizacionId: orgAlfaId,
          },
        },
      });
      miembroEliminadoCaso23 = true;

      // Intentar acceder nuevamente con el token previo (JWT criptográficamente válido pero membresía revocada en BD)
      const resAccesoPostDesvinculacion = await fetch(`${urlApi}/api/organizacion`, {
        headers: { Authorization: `Bearer ${tokenColabCaso23}` },
      });
      assert.equal(
        resAccesoPostDesvinculacion.status,
        403,
        "El middleware debe revalidar contra la BD y rechazar con 403 al miembro desvinculado"
      );
      const cuerpoErrorDesvinculado = (await resAccesoPostDesvinculacion.json()) as any;
      assert.equal(cuerpoErrorDesvinculado.error, "No perteneces a esta organización");
    } finally {
      if (miembroEliminadoCaso23) {
        await prisma.miembroOrganizacion.create({
          data: {
            usuarioId: usuarioColab.id,
            organizacionId: orgAlfaId,
            rol: "COLABORADOR",
          },
        });
      }
    }

    console.log("[casos-autenticacion] Suite completada con éxito: 23 casos de integración verificados.");
  } finally {
    if (servidor) {
      await new Promise<void>((resolve) => {
        (servidor as ReturnType<typeof createServer>).close(() => resolve());
      });
    }
    await prisma.$disconnect();
  }
}

ejecutarCasos().catch((err) => {
  console.error("Error en casos de integración:", err);
  process.exit(1);
});
