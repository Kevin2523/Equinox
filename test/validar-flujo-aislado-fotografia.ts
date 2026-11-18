import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "../src/prisma.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";

const urlApi = process.env.URL_API || "http://localhost:3000";

function crearJpegValido(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x80, 0xff, 0xd9,
  ]);
}

async function main() {
  console.log("=== PRUEBA DE FLUJO REAL AISLADO: MODALIDAD FOTOGRAFÍA ===");
  const idUnico = Date.now().toString(36);
  const dirFotos = path.resolve(process.cwd(), process.env.ALMACENAMIENTO_FOTOS_DIR || "./almacenamiento_privado/fotos");
  const clavesArchivosCreados: string[] = [];

  let orgFotoId = "";
  let usuarioFotoId = "";
  let clienteId = "";
  let sesionId = "";
  let fotoId = "";
  let usuarioClienteId = "";
  let orgGeneralId = "";
  let usuarioGeneralId = "";

  try {
    // -------------------------------------------------------------------------
    // 1. REGISTRO ORGANIZACIÓN MODALIDAD FOTOGRAFÍA
    // -------------------------------------------------------------------------
    console.log("1. Registrar organización FOTOGRAFIA...");
    const correoFoto = `foto.${idUnico}@prueba.test`;
    const resRegFoto = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: correoFoto,
        contrasena: "PasswordSeguro123!",
        nombre: "Fotografo",
        apellido: "Prueba",
        nombreEstudio: `Estudio Aislado ${idUnico}`,
        slug: `estudio-aislado-${idUnico}`,
        tipoFreelance: "FOTOGRAFIA",
      }),
    });
    assert.equal(resRegFoto.status, 201, "Registro organización FOTOGRAFIA debe responder 201");
    const jsonRegFoto = (await resRegFoto.json()) as any;
    const tokenFoto = jsonRegFoto.token;
    orgFotoId = jsonRegFoto.organizacion.id;
    usuarioFotoId = jsonRegFoto.usuario.id;
    assert.equal(jsonRegFoto.organizacion.tipoFreelance, "FOTOGRAFIA");
    console.log("   [OK] Organización FOTOGRAFIA creada exitosamente");

    // -------------------------------------------------------------------------
    // 2. CREAR CLIENTE SOLO CON NOMBRE (SIN EMAIL, SIN EMPRESA, ETC.)
    // -------------------------------------------------------------------------
    console.log("2. Crear cliente solo con nombre...");
    const resCrearCliente = await fetch(`${urlApi}/api/clientes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFoto}`,
      },
      body: JSON.stringify({
        nombre: "Mariana Solo Nombre",
      }),
    });
    assert.equal(resCrearCliente.status, 201, "Crear cliente solo con nombre debe responder 201");
    const clienteCreado = (await resCrearCliente.json()) as any;
    clienteId = clienteCreado.id;
    assert.equal(clienteCreado.nombre, "Mariana Solo Nombre");
    assert.equal(clienteCreado.estado, "ACTIVO", "El estado inicial debe ser ACTIVO automáticamente");
    assert.equal(clienteCreado.correo, null, "Correo debe ser null");
    assert.equal(clienteCreado.empresa, null, "Empresa debe ser null");
    assert.equal(clienteCreado.telefono, null, "Teléfono debe ser null");
    assert.equal(clienteCreado.direccion, null, "Dirección debe ser null");
    assert.equal(clienteCreado.sitioWeb, null, "Sitio web debe ser null");
    assert.equal(clienteCreado.notasInternas, null, "Notas internas debe ser null");
    console.log(`   [OK] Cliente creado solo con nombre: id=${clienteId}, estado=${clienteCreado.estado}`);

    // -------------------------------------------------------------------------
    // 3. CREAR SESIÓN FOTOGRÁFICA Y SUBIR FOTO DE PRUEBA TEMPORAL (SIN CORREO)
    // -------------------------------------------------------------------------
    console.log("3. Crear sesión fotográfica y subir foto de prueba...");
    const resCrearSesion = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFoto}`,
      },
      body: JSON.stringify({
        nombre: "Sesión Retrato Individual",
        descripcion: "Sesión de prueba rápida",
        fecha: "2026-11-16",
      }),
    });
    assert.equal(resCrearSesion.status, 201, "Crear sesión debe responder 201");
    const sesionCreada = (await resCrearSesion.json()) as any;
    sesionId = sesionCreada.id;
    assert.equal(sesionCreada.nombre, "Sesión Retrato Individual");
    assert.equal(sesionCreada.estado, "BORRADOR");
    console.log(`   [OK] Sesión fotográfica creada: id=${sesionId}`);

    // Subir foto JPEG de prueba
    const jpeg = crearJpegValido();
    const formData = new FormData();
    formData.append("foto", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "retrato_prueba.jpg");
    formData.append("orden", "1");
    formData.append("esPortada", "true");

    const resSubirFoto = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas/${sesionId}/fotos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenFoto}` },
      body: formData,
    });
    assert.equal(resSubirFoto.status, 201, "Subida de foto debe responder 201");
    const fotoCreada = (await resSubirFoto.json()) as any;
    fotoId = fotoCreada.id;
    clavesArchivosCreados.push(fotoId);
    assert.equal(fotoCreada.esPortada, true);
    console.log(`   [OK] Foto de prueba subida exitosamente: id=${fotoId}`);

    // Publicar sesión para el portal
    const resPublicar = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas/${sesionId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFoto}`,
      },
      body: JSON.stringify({ estado: "PUBLICADA" }),
    });
    assert.equal(resPublicar.status, 200);
    console.log("   [OK] Sesión publicada exitosamente");

    // -------------------------------------------------------------------------
    // 4. EDITAR DETALLES DEL CLIENTE (EMPRESA, DIRECCIÓN, ETC.)
    // -------------------------------------------------------------------------
    console.log("4. Editar detalles del cliente (conservados en ficha/detalle)...");
    const resEditarCliente = await fetch(`${urlApi}/api/clientes/${clienteId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFoto}`,
      },
      body: JSON.stringify({
        empresa: "Mariana Studio Boutique",
        telefono: "+507 6222-3333",
        direccion: "Costa del Este, Torre Financial Park",
        notasInternas: "Cliente referido por recomendación",
      }),
    });
    assert.equal(resEditarCliente.status, 200, "Editar detalles debe responder 200");
    const clienteEditado = (await resEditarCliente.json()) as any;
    assert.equal(clienteEditado.empresa, "Mariana Studio Boutique");
    assert.equal(clienteEditado.telefono, "+507 6222-3333");
    assert.equal(clienteEditado.direccion, "Costa del Este, Torre Financial Park");
    assert.equal(clienteEditado.notasInternas, "Cliente referido por recomendación");
    assert.equal(clienteEditado.correo, null, "Correo todavía no está definido");
    console.log("   [OK] Detalles editados y guardados correctamente en la ficha");

    // -------------------------------------------------------------------------
    // 5. AGREGAR CORREO AL INVITAR AL PORTAL Y VALIDAR PERSISTENCIA
    // -------------------------------------------------------------------------
    console.log("5. Invitar al portal agregando correo en ese momento...");
    const correoClienteNuevo = `mariana.portal.${idUnico}@prueba.test`;

    // Paso A: Se persiste el correo en el cliente antes de emitir la invitación
    const resPersistirCorreo = await fetch(`${urlApi}/api/clientes/${clienteId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFoto}`,
      },
      body: JSON.stringify({
        correo: correoClienteNuevo,
      }),
    });
    assert.equal(resPersistirCorreo.status, 200);
    const clienteConCorreo = (await resPersistirCorreo.json()) as any;
    assert.equal(clienteConCorreo.correo, correoClienteNuevo, "El cliente debe tener su correo persistido en DB");

    // Paso B: Crear invitación al portal con ese correo
    const resInvitacion = await fetch(`${urlApi}/api/clientes/${clienteId}/invitaciones`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFoto}`,
      },
      body: JSON.stringify({
        correo: correoClienteNuevo,
        rol: "TITULAR",
      }),
    });
    assert.equal(resInvitacion.status, 201, "Crear invitación debe responder 201");
    const invitacionJson = (await resInvitacion.json()) as any;
    assert.equal(invitacionJson.invitacion.correo, correoClienteNuevo);
    assert.equal(invitacionJson.invitacion.estado, "PENDIENTE");
    assert.ok(invitacionJson.enlaceInvitacion, "Debe retornar enlace de invitación");
    console.log(`   [OK] Correo persistido en cliente (${correoClienteNuevo}) e invitación creada exitosamente`);

    // Paso C: Acceso al portal por el cliente
    console.log("5.1 Simular acceso del cliente al portal...");
    const usuarioCliente = await prisma.usuario.create({
      data: {
        correo: correoClienteNuevo,
        contrasenaHash: "hash_prueba_123",
        nombre: "Mariana",
        apellido: "Torres",
      },
    });
    usuarioClienteId = usuarioCliente.id;

    await prisma.accesoCliente.create({
      data: {
        usuarioId: usuarioCliente.id,
        clienteId: clienteId,
        organizacionId: orgFotoId,
        rol: "TITULAR",
        activo: true,
      },
    });

    const tokenPortalId = randomUUID();
    const tokenPortalFirmado = firmarToken(
      {
        tipoAcceso: "CLIENTE",
        usuarioId: usuarioCliente.id,
        organizacionId: orgFotoId,
        clienteId: clienteId,
        rolCliente: "TITULAR",
      },
      tokenPortalId
    );

    await prisma.sesion.create({
      data: {
        id: tokenPortalId,
        usuarioId: usuarioCliente.id,
        tokenHash: hashToken(tokenPortalFirmado.token),
        expiraEn: tokenPortalFirmado.expiraEn,
      },
    });
    const tokenPortalCliente = tokenPortalFirmado.token;

    // Verificar en GET /api/portal
    const resPortal = await fetch(`${urlApi}/api/portal`, {
      headers: { Authorization: `Bearer ${tokenPortalCliente}` },
    });
    assert.equal(resPortal.status, 200);
    const portalData = (await resPortal.json()) as any;
    assert.equal(portalData.estudio.tipoFreelance, "FOTOGRAFIA");

    // Verificar sesiones en el portal
    const resPortalSesiones = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, {
      headers: { Authorization: `Bearer ${tokenPortalCliente}` },
    });
    assert.equal(resPortalSesiones.status, 200);
    const sesionesPortal = (await resPortalSesiones.json()) as any[];
    assert.equal(sesionesPortal.length, 1);
    assert.equal(sesionesPortal[0].id, sesionId);

    // Verificar fotos en el portal
    const resPortalFotos = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesionId}/fotos`, {
      headers: { Authorization: `Bearer ${tokenPortalCliente}` },
    });
    assert.equal(resPortalFotos.status, 200);
    const fotosPortal = (await resPortalFotos.json()) as any;
    assert.equal(fotosPortal.total, 1);
    assert.equal(fotosPortal.items[0].id, fotoId);
    console.log("   [OK] Portal de cliente muestra sesión y fotos con acceso verificado");

    // -------------------------------------------------------------------------
    // 6. VERIFICAR QUE OTRAS MODALIDADES SIGUEN INTACTAS
    // -------------------------------------------------------------------------
    console.log("6. Verificar que la modalidad GENERAL sigue intacta...");
    const correoGeneral = `general.${idUnico}@prueba.test`;
    const resRegGeneral = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: correoGeneral,
        contrasena: "PasswordSeguro123!",
        nombre: "Consultor",
        apellido: "General",
        nombreEstudio: `Consultora ${idUnico}`,
        slug: `consultora-${idUnico}`,
        tipoFreelance: "GENERAL",
      }),
    });
    assert.equal(resRegGeneral.status, 201);
    const jsonRegGeneral = (await resRegGeneral.json()) as any;
    const tokenGeneral = jsonRegGeneral.token;
    orgGeneralId = jsonRegGeneral.organizacion.id;
    usuarioGeneralId = jsonRegGeneral.usuario.id;
    assert.equal(jsonRegGeneral.organizacion.tipoFreelance, "GENERAL");

    // Crear cliente completo en modalidad general
    const resClienteGeneral = await fetch(`${urlApi}/api/clientes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenGeneral}`,
      },
      body: JSON.stringify({
        nombre: "Corporación Banistmo",
        empresa: "Banistmo S.A.",
        correo: `contacto.${idUnico}@banistmo.test`,
        telefono: "+507 300-0000",
        direccion: "Calle 50, Plaza Banistmo",
        sitioWeb: "https://banistmo.com",
        notasInternas: "Cuenta corporativa activa",
        estado: "ACTIVO",
      }),
    });
    assert.equal(resClienteGeneral.status, 201);
    const clienteGen = (await resClienteGeneral.json()) as any;
    assert.equal(clienteGen.nombre, "Corporación Banistmo");
    assert.equal(clienteGen.empresa, "Banistmo S.A.");
    assert.equal(clienteGen.correo, `contacto.${idUnico}@banistmo.test`);
    assert.equal(clienteGen.estado, "ACTIVO");

    // Crear proyecto para el cliente en modalidad general
    const resProyectoGeneral = await fetch(`${urlApi}/api/proyectos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenGeneral}`,
      },
      body: JSON.stringify({
        clienteId: clienteGen.id,
        nombre: "Rediseño Portal Corporativo",
        moneda: "USD",
        presupuesto: 5000,
        estado: "ACTIVO",
      }),
    });
    assert.equal(resProyectoGeneral.status, 201);
    const proyectoGen = (await resProyectoGeneral.json()) as any;
    assert.equal(proyectoGen.nombre, "Rediseño Portal Corporativo");
    assert.equal(proyectoGen.clienteId, clienteGen.id);
    console.log("   [OK] Modalidad GENERAL intacta: cliente y proyectos creados exitosamente");

    console.log("=== TODAS LAS VALIDACIONES DE FLUJO REAL COMPLETADAS CON ÉXITO ===");
  } finally {
    // Limpieza de datos creados en el test para no ensuciar
    console.log("-> Limpiando datos de prueba...");
    try {
      if (orgFotoId) {
        await prisma.fotoSesion.deleteMany({ where: { sesion: { organizacionId: orgFotoId } } });
        await prisma.sesionFotografica.deleteMany({ where: { organizacionId: orgFotoId } });
        await prisma.invitacionCliente.deleteMany({ where: { organizacionId: orgFotoId } });
        await prisma.accesoCliente.deleteMany({ where: { organizacionId: orgFotoId } });
        await prisma.actividad.deleteMany({ where: { organizacionId: orgFotoId } });
        await prisma.cliente.deleteMany({ where: { organizacionId: orgFotoId } });
        if (usuarioClienteId) {
          await prisma.sesion.deleteMany({ where: { usuarioId: usuarioClienteId } });
          await prisma.usuario.deleteMany({ where: { id: usuarioClienteId } });
        }
        await prisma.miembroOrganizacion.deleteMany({ where: { organizacionId: orgFotoId } });
        await prisma.sesion.deleteMany({ where: { usuarioId: usuarioFotoId } });
        await prisma.usuario.deleteMany({ where: { id: usuarioFotoId } });
        await prisma.organizacion.deleteMany({ where: { id: orgFotoId } });
      }
      if (orgGeneralId) {
        await prisma.proyecto.deleteMany({ where: { organizacionId: orgGeneralId } });
        await prisma.cliente.deleteMany({ where: { organizacionId: orgGeneralId } });
        await prisma.actividad.deleteMany({ where: { organizacionId: orgGeneralId } });
        await prisma.miembroOrganizacion.deleteMany({ where: { organizacionId: orgGeneralId } });
        await prisma.sesion.deleteMany({ where: { usuarioId: usuarioGeneralId } });
        await prisma.usuario.deleteMany({ where: { id: usuarioGeneralId } });
        await prisma.organizacion.deleteMany({ where: { id: orgGeneralId } });
      }
      // Limpiar archivos de fotos creados en disco
      for (const fId of clavesArchivosCreados) {
        try {
          const ruta = path.join(dirFotos, `${fId}.jpg`);
          if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
        } catch {}
      }
      console.log("   [OK] Limpieza de entorno completada");
    } catch (e: any) {
      console.error("   [WARN] Error durante limpieza:", e.message);
    }
  }
}

main().catch((err) => {
  console.error("ERROR FATAL EN PRUEBA:", err);
  process.exit(1);
});
