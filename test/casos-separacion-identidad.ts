import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { firmarToken } from "../src/middleware/autenticacion.js";
import {
  calcularPasoTotp,
  cifrarSecretoMfa,
  generarCodigoTotpParaPaso,
  generarSecretoBase32,
} from "../src/utilidades/mfa.js";
import { ejecutarSeparacionIdentidad } from "../src/cli/separar-identidad.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function esperarRechazo(promesa: Promise<unknown>, mensajeEsperado: RegExp) {
  let fallo = false;
  try {
    await promesa;
  } catch (err: any) {
    fallo = true;
    assert.match(String(err?.message || err), mensajeEsperado);
  }
  assert.equal(fallo, true, `Se esperaba error con patrón ${mensajeEsperado}`);
}

export async function ejecutarCasosSeparacionIdentidad() {
  console.log("[separacion-identidad] Preparando escenario aislado...");

  const passAdmin = "AdminFuerte!2026#";
  const passEstudio = "EstudioPropio!2026#";
  const passAdminHash = await bcrypt.hash(passAdmin, 10);
  const secretoMfaBase32 = generarSecretoBase32();
  const secretoMfaCifrado = cifrarSecretoMfa(secretoMfaBase32);

  const correoAdmin = "admin.separacion@equinox.test";
  const correoEstudio = "estudio.separacion@equinox.test";

  // 1. Crear usuario ADMIN_GLOBAL con MFA que además es único PROPIETARIO de Mena Studios
  const admin = await prisma.usuario.create({
    data: {
      correo: correoAdmin,
      contrasenaHash: passAdminHash,
      nombre: "Admin",
      apellido: "Global",
      rolPlataforma: "ADMIN_GLOBAL",
      mfaHabilitado: true,
      mfaSecretoCifrado: secretoMfaCifrado,
      mfaVerificadoEn: new Date(),
    },
  });

  const org = await prisma.organizacion.create({
    data: {
      nombre: "Mena Studios",
      slug: "mena-studios-test",
    },
  });

  await prisma.miembroOrganizacion.create({
    data: {
      usuarioId: admin.id,
      organizacionId: org.id,
      rol: "PROPIETARIO",
    },
  });

  // 2. Crear datos históricos atribuidos al admin original
  const cliente = await prisma.cliente.create({
    data: {
      organizacionId: org.id,
      nombre: "Cliente Histórico",
      correo: "cliente.historico@equinox.test",
    },
  });

  const proyecto = await prisma.proyecto.create({
    data: {
      organizacionId: org.id,
      clienteId: cliente.id,
      creadoPorId: admin.id,
      nombre: "Proyecto Histórico",
      estado: "ACTIVO",
    },
  });

  const factura = await prisma.factura.create({
    data: {
      organizacionId: org.id,
      clienteId: cliente.id,
      proyectoId: proyecto.id,
      numero: "FAC-0001",
      concepto: "Sesión fotográfica",
      monto: 250.0,
      estado: "ENVIADA",
    },
  });

  const historialFactura = await prisma.historialFactura.create({
    data: {
      facturaId: factura.id,
      estadoAnterior: "BORRADOR",
      estadoNuevo: "ENVIADA",
      usuarioId: admin.id,
      motivo: "Emisión inicial",
    },
  });

  const actividad = await prisma.actividad.create({
    data: {
      organizacionId: org.id,
      usuarioId: admin.id,
      entidad: "Proyecto",
      entidadId: proyecto.id,
      accion: "CREAR",
      descripcion: "Proyecto creado",
    },
  });

  const invitacion = await prisma.invitacionCliente.create({
    data: {
      organizacionId: org.id,
      clienteId: cliente.id,
      correo: "invitado@equinox.test",
      tokenHash: hashToken("token-inv-historico"),
      expiraEn: new Date(Date.now() + 86400_000),
      invitadoPorId: admin.id,
    },
  });

  // 3. Crear sesiones activas previas (ORGANIZACION y ADMIN_GLOBAL)
  const sesionOrgId = randomUUID();
  const tokenOrgPrevio = firmarToken(
    {
      tipoAcceso: "ORGANIZACION",
      usuarioId: admin.id,
      organizacionId: org.id,
      rolOrganizacion: "PROPIETARIO",
    },
    sesionOrgId
  );
  await prisma.sesion.create({
    data: {
      id: sesionOrgId,
      usuarioId: admin.id,
      tokenHash: hashToken(tokenOrgPrevio.token),
      tipoAcceso: "ORGANIZACION",
      mfaVerificado: false,
      expiraEn: tokenOrgPrevio.expiraEn,
    },
  });

  const sesionAdminId = randomUUID();
  const tokenAdminPrevio = firmarToken(
    {
      tipoAcceso: "ADMIN_GLOBAL",
      usuarioId: admin.id,
      rolPlataforma: "ADMIN_GLOBAL",
      mfaVerificado: true,
    },
    sesionAdminId
  );
  await prisma.sesion.create({
    data: {
      id: sesionAdminId,
      usuarioId: admin.id,
      tokenHash: hashToken(tokenAdminPrevio.token),
      tipoAcceso: "ADMIN_GLOBAL",
      mfaVerificado: true,
      mfaVerificadoEn: new Date(),
      expiraEn: tokenAdminPrevio.expiraEn,
    },
  });

  // 4. Validaciones negativas antes de mutar
  console.log("[separacion-identidad] Verificando guardas de seguridad...");
  await esperarRechazo(
    ejecutarSeparacionIdentidad(prisma, {
      organizacionId: org.id,
      correoOrigen: correoAdmin,
      correoDestino: correoEstudio,
      crearDestinoSiFalta: true,
      contrasenaDestino: passEstudio,
      confirmar: false,
    }),
    /--confirmar/i
  );

  await esperarRechazo(
    ejecutarSeparacionIdentidad(prisma, {
      organizacionId: org.id,
      correoOrigen: correoAdmin,
      correoDestino: correoAdmin,
      crearDestinoSiFalta: true,
      contrasenaDestino: passEstudio,
      confirmar: true,
    }),
    /distintos/i
  );

  await esperarRechazo(
    ejecutarSeparacionIdentidad(prisma, {
      organizacionId: org.id,
      correoOrigen: correoAdmin,
      correoDestino: correoEstudio,
      crearDestinoSiFalta: false,
      confirmar: true,
    }),
    /no existe/i
  );

  await esperarRechazo(
    ejecutarSeparacionIdentidad(prisma, {
      organizacionId: org.id,
      correoOrigen: correoAdmin,
      correoDestino: correoEstudio,
      crearDestinoSiFalta: true,
      contrasenaDestino: "corta",
      confirmar: true,
    }),
    /entre 8 y 128/i
  );

  // Crear otro ADMIN_GLOBAL temporal para comprobar que no se permite transferir a otro ADMIN_GLOBAL
  const otroAdmin = await prisma.usuario.create({
    data: {
      correo: "otro.admin@equinox.test",
      contrasenaHash: passAdminHash,
      nombre: "Otro Admin",
      rolPlataforma: "ADMIN_GLOBAL",
    },
  });

  await esperarRechazo(
    ejecutarSeparacionIdentidad(prisma, {
      organizacionId: org.id,
      correoOrigen: correoAdmin,
      correoDestino: otroAdmin.correo,
      confirmar: true,
    }),
    /evitar acceso cruzado/i
  );

  // Rechazar reutilización de la misma contraseña del ADMIN_GLOBAL y verificar ausencia de mutación
  await esperarRechazo(
    ejecutarSeparacionIdentidad(prisma, {
      organizacionId: org.id,
      correoOrigen: correoAdmin,
      correoDestino: correoEstudio,
      crearDestinoSiFalta: true,
      contrasenaDestino: passAdmin,
      confirmar: true,
    }),
    /distinta a la de la cuenta administrativa origen/i
  );

  const destinoTrasRechazo = await prisma.usuario.findUnique({ where: { correo: correoEstudio } });
  assert.equal(destinoTrasRechazo, null, "No debe crearse la cuenta destino tras rechazo");
  const membresiaAdminTrasRechazo = await prisma.miembroOrganizacion.findUnique({
    where: { usuarioId_organizacionId: { usuarioId: admin.id, organizacionId: org.id } },
  });
  assert.equal(membresiaAdminTrasRechazo?.rol, "PROPIETARIO");
  const sesionesActivasTrasRechazo = await prisma.sesion.count({
    where: { usuarioId: admin.id, revocadaEn: null },
  });
  assert.equal(sesionesActivasTrasRechazo, 2, "No deben revocarse sesiones si la operación fue rechazada");

  // 5. Ejecutar separación atómica creando cuenta del estudio con contraseña elegida
  console.log("[separacion-identidad] Ejecutando separación atómica...");
  const resultado = await ejecutarSeparacionIdentidad(prisma, {
    organizacionId: org.id,
    correoOrigen: correoAdmin,
    correoDestino: correoEstudio,
    nombreDestino: "Mena Studios",
    crearDestinoSiFalta: true,
    contrasenaDestino: passEstudio,
    confirmar: true,
  });

  assert.equal(resultado.destinoCreado, true);
  assert.equal(resultado.sesionesOrigenRevocadas, 2);
  assert.equal(resultado.sesionesDestinoRevocadas, 0);

  // 6. Verificar estado en BD
  const adminDespues = await prisma.usuario.findUniqueOrThrow({
    where: { id: admin.id },
    include: { membresias: true, sesiones: true },
  });
  assert.equal(adminDespues.rolPlataforma, "ADMIN_GLOBAL");
  assert.equal(adminDespues.mfaHabilitado, true);
  assert.equal(adminDespues.mfaSecretoCifrado, secretoMfaCifrado);
  assert.equal(adminDespues.membresias.length, 0);
  assert.equal(adminDespues.sesiones.every((s) => s.revocadaEn !== null), true);

  const estudioDespues = await prisma.usuario.findUniqueOrThrow({
    where: { correo: correoEstudio },
    include: { membresias: true },
  });
  assert.equal(estudioDespues.rolPlataforma, "USUARIO");
  assert.equal(estudioDespues.mfaHabilitado, false);
  assert.notEqual(estudioDespues.contrasenaHash, adminDespues.contrasenaHash);
  assert.equal(estudioDespues.membresias.length, 1);
  assert.equal(estudioDespues.membresias[0].organizacionId, org.id);
  assert.equal(estudioDespues.membresias[0].rol, "PROPIETARIO");

  // Atribuciones históricas intactas
  const proyectoDespues = await prisma.proyecto.findUniqueOrThrow({ where: { id: proyecto.id } });
  const historialDespues = await prisma.historialFactura.findUniqueOrThrow({
    where: { id: historialFactura.id },
  });
  const actividadDespues = await prisma.actividad.findUniqueOrThrow({ where: { id: actividad.id } });
  const invitacionDespues = await prisma.invitacionCliente.findUniqueOrThrow({
    where: { id: invitacion.id },
  });
  assert.equal(proyectoDespues.creadoPorId, admin.id);
  assert.equal(historialDespues.usuarioId, admin.id);
  assert.equal(actividadDespues.usuarioId, admin.id);
  assert.equal(invitacionDespues.invitadoPorId, admin.id);

  // Auditoría registrada
  const auditoria = await prisma.auditoriaAdmin.findFirst({
    where: {
      accion: "ADMIN_SEPARACION_IDENTIDAD_ORGANIZACION",
      organizacionId: org.id,
    },
  });
  assert.ok(auditoria, "Debe registrarse evento en auditoria_admin");

  // 7. Pruebas HTTP de autenticación, revocación y no-acceso cruzado
  console.log("[separacion-identidad] Verificando aislamiento HTTP y sesiones...");
  const servidor = aplicacion.listen(0);
  const puerto = (servidor.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${puerto}`;

  try {
    // Tokens previos deben ser rechazados (401)
    const resOrgPrevio = await fetch(`${baseUrl}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenOrgPrevio.token}` },
    });
    assert.equal(resOrgPrevio.status, 401);

    const resAdminPrevio = await fetch(`${baseUrl}/api/admin/resumen`, {
      headers: { Authorization: `Bearer ${tokenAdminPrevio.token}` },
    });
    assert.equal(resAdminPrevio.status, 401);

    // Admin no puede iniciar sesión en ORGANIZACION
    const resLoginAdminOrg = await fetch(`${baseUrl}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: correoAdmin,
        contrasena: passAdmin,
        seleccion: { tipoAcceso: "ORGANIZACION", organizacionId: org.id },
      }),
    });
    assert.equal(resLoginAdminOrg.status, 403);

    // Admin inicia sesión -> solo ADMIN_GLOBAL con desafío MFA
    const resLoginAdmin = await fetch(`${baseUrl}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoAdmin, contrasena: passAdmin }),
    });
    assert.equal(resLoginAdmin.status, 200);
    const bodyLoginAdmin = (await resLoginAdmin.json()) as any;
    assert.equal(bodyLoginAdmin.mfaRequerido, true);

    const codigoTotp = generarCodigoTotpParaPaso(secretoMfaBase32, calcularPasoTotp());
    const resMfa = await fetch(`${baseUrl}/api/autenticacion/admin/mfa/verificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenDesafioMfa: bodyLoginAdmin.tokenDesafioMfa,
        codigoTotp,
      }),
    });
    assert.equal(resMfa.status, 200);
    const bodyMfa = (await resMfa.json()) as any;
    const tokenAdminNuevo = bodyMfa.token as string;
    assert.ok(tokenAdminNuevo);

    // Admin accede a /api/admin/resumen pero NO a /api/organizacion
    const resAdminResumen = await fetch(`${baseUrl}/api/admin/resumen`, {
      headers: { Authorization: `Bearer ${tokenAdminNuevo}` },
    });
    assert.equal(resAdminResumen.status, 200);

    const resAdminAOrg = await fetch(`${baseUrl}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenAdminNuevo}` },
    });
    assert.equal(resAdminAOrg.status, 403);

    // Estudio NO puede entrar con la contraseña del admin
    const resEstudioPassAdmin = await fetch(`${baseUrl}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoEstudio, contrasena: passAdmin }),
    });
    assert.equal(resEstudioPassAdmin.status, 401);

    // Estudio inicia sesión con su propia contraseña -> ORGANIZACION PROPIETARIO
    const resLoginEstudio = await fetch(`${baseUrl}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo: correoEstudio, contrasena: passEstudio }),
    });
    assert.equal(resLoginEstudio.status, 200);
    const bodyEstudio = (await resLoginEstudio.json()) as any;
    assert.equal(bodyEstudio.contexto.tipoAcceso, "ORGANIZACION");
    assert.equal(bodyEstudio.contexto.organizacionId, org.id);
    assert.equal(bodyEstudio.contexto.rolOrganizacion, "PROPIETARIO");

    const tokenEstudio = bodyEstudio.token as string;

    // Estudio accede a datos preservados de Mena Studios y NO a /api/admin/resumen
    const resEstudioOrg = await fetch(`${baseUrl}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenEstudio}` },
    });
    assert.equal(resEstudioOrg.status, 200);

    const resEstudioClientes = await fetch(`${baseUrl}/api/clientes`, {
      headers: { Authorization: `Bearer ${tokenEstudio}` },
    });
    assert.equal(resEstudioClientes.status, 200);
    const clientesBody = (await resEstudioClientes.json()) as any[];
    assert.equal(clientesBody.length, 1);

    const resEstudioProyectos = await fetch(`${baseUrl}/api/proyectos`, {
      headers: { Authorization: `Bearer ${tokenEstudio}` },
    });
    assert.equal(resEstudioProyectos.status, 200);
    const proyectosBody = (await resEstudioProyectos.json()) as any[];
    assert.equal(proyectosBody.length, 1);

    const resEstudioFacturas = await fetch(`${baseUrl}/api/facturas`, {
      headers: { Authorization: `Bearer ${tokenEstudio}` },
    });
    assert.equal(resEstudioFacturas.status, 200);
    const facturasBody = (await resEstudioFacturas.json()) as any[];
    assert.equal(facturasBody.length, 1);

    const resEstudioAdmin = await fetch(`${baseUrl}/api/admin/resumen`, {
      headers: { Authorization: `Bearer ${tokenEstudio}` },
    });
    assert.equal(resEstudioAdmin.status, 403);
  } finally {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }

  console.log("[separacion-identidad] Todos los casos pasaron exitosamente.");
}
