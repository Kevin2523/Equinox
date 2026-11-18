import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "../src/prisma.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";

const urlApi = process.env.URL_API || "http://localhost:3000";

// Generador de imagen JPEG mínima válida
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

// Generador de imagen PNG mínima válida
function crearPngValido(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00,
    0x00, 0x00, 0x04, 0x00, 0x01, 0x27, 0x34, 0x27, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

async function ejecutarValidacionE2E() {
  console.log("=== INICIANDO VALIDACIÓN INTEGRAL E2E MODALIDAD FOTOGRAFÍA ===");
  const idUnico = Date.now().toString(36);
  const correoFreelancer = `foto.e2e.${idUnico}@prueba.test`;
  const slugOrg = `estudio-foto-${idUnico}`;
  const dirFotos = path.resolve(process.cwd(), process.env.ALMACENAMIENTO_FOTOS_DIR || "./almacenamiento_privado/fotos");

  let orgId = "";
  let usuarioId = "";
  let clienteId = "";
  let usuarioClienteId = "";
  const clavesArchivosCreados: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // 1. REGISTRAR ORGANIZACIÓN FOTOGRAFÍA
    // -------------------------------------------------------------------------
    console.log("-> 1. Registrar organización con tipoFreelance FOTOGRAFIA...");
    const resReg = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: correoFreelancer,
        contrasena: "PasswordSeguro123!",
        nombre: "Valeria",
        apellido: "Ríos",
        nombreEstudio: `Valeria Ríos Studio ${idUnico}`,
        slug: slugOrg,
        tipoFreelance: "FOTOGRAFIA",
      }),
    });
    assert.equal(resReg.status, 201, "Registro de organización FOTOGRAFIA debe responder 201");
    const regJson = (await resReg.json()) as any;
    assert.equal(regJson.organizacion.tipoFreelance, "FOTOGRAFIA", "Organización debe retornar tipoFreelance FOTOGRAFIA");
    const tokenFreelancer = regJson.token;
    orgId = regJson.organizacion.id;
    usuarioId = regJson.usuario.id;

    // Verificar en GET /api/organizacion
    const resOrg = await fetch(`${urlApi}/api/organizacion`, {
      headers: { Authorization: `Bearer ${tokenFreelancer}` },
    });
    assert.equal(resOrg.status, 200);
    const orgData = (await resOrg.json()) as any;
    assert.equal(orgData.tipoFreelance, "FOTOGRAFIA", "GET /api/organizacion debe retornar FOTOGRAFIA");
    console.log("   [OK] Organización registrada y verificada con tipoFreelance = FOTOGRAFIA");

    // -------------------------------------------------------------------------
    // 2. VERIFICAR ENTRADA EN CLIENTES Y ESTADO VACÍO
    // -------------------------------------------------------------------------
    console.log("-> 2. Verificar lista de clientes vacía...");
    const resClientesVacio = await fetch(`${urlApi}/api/clientes`, {
      headers: { Authorization: `Bearer ${tokenFreelancer}` },
    });
    assert.equal(resClientesVacio.status, 200);
    const listaClientesVacia = (await resClientesVacio.json()) as any[];
    assert.equal(listaClientesVacia.length, 0, "No debe haber clientes al iniciar");
    console.log("   [OK] Lista de clientes inicial vacía confirmada");

    // -------------------------------------------------------------------------
    // 3. CREAR CLIENTE AISLADO
    // -------------------------------------------------------------------------
    console.log("-> 3. Crear cliente de prueba...");
    const resCrearCliente = await fetch(`${urlApi}/api/clientes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFreelancer}`,
      },
      body: JSON.stringify({
        nombre: "Novios Carlos & Laura",
        empresa: "Boda 2026",
        correo: `novios.${idUnico}@boda.test`,
        telefono: "+507 6555-1234",
        notas: "Paquete Boda Premium",
      }),
    });
    assert.equal(resCrearCliente.status, 201);
    const clienteData = (await resCrearCliente.json()) as any;
    clienteId = clienteData.id;
    assert.ok(clienteId, "Cliente debe tener ID asignado");
    console.log(`   [OK] Cliente creado: ${clienteData.nombre} (${clienteId})`);

    // -------------------------------------------------------------------------
    // 4. CREAR DOS SESIONES: UNA BORRADOR Y UNA PUBLICADA
    // -------------------------------------------------------------------------
    console.log("-> 4. Crear dos sesiones fotográficas (Borrador y Publicada)...");
    // Sesión 1: Boda Iglesia y Recepción (Publicada)
    const resSesion1 = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFreelancer}`,
      },
      body: JSON.stringify({
        nombre: "Boda Iglesia y Recepción",
        descripcion: "Cobertura completa ceremonia religiosa y fiesta",
        fecha: "2026-11-15",
        estado: "BORRADOR", // Se crea en borrador y se publicará tras subir fotos
      }),
    });
    assert.equal(resSesion1.status, 201);
    const sesion1 = (await resSesion1.json()) as any;

    // Sesión 2: Fotos Privadas Previas (Se quedará en BORRADOR)
    const resSesion2 = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFreelancer}`,
      },
      body: JSON.stringify({
        nombre: "Descarte y Fotos Privadas",
        descripcion: "Fotos de prueba internas que el cliente no debe ver",
        fecha: "2026-11-14",
        estado: "BORRADOR",
      }),
    });
    assert.equal(resSesion2.status, 201);
    const sesion2 = (await resSesion2.json()) as any;

    console.log(`   [OK] Sesión 1 creada: ${sesion1.nombre} (${sesion1.id})`);
    console.log(`   [OK] Sesión 2 creada: ${sesion2.nombre} (${sesion2.id})`);

    // -------------------------------------------------------------------------
    // 5. SUBIR VARIAS FOTOS REALES DE FIXTURE POR MULTIPART Y ASIGNAR PORTADA
    // -------------------------------------------------------------------------
    console.log("-> 5. Subir varias fotos reales multipart (JPEG y PNG)...");
    const jpeg = crearJpegValido();
    const png = crearPngValido();

    async function subirFotoMultipart(sId: string, buffer: Buffer, nombreArchivo: string, mime: string, orden: number, esPortada = false) {
      const formData = new FormData();
      formData.append("foto", new Blob([new Uint8Array(buffer)], { type: mime }), nombreArchivo);
      formData.append("orden", orden.toString());
      if (esPortada) formData.append("esPortada", "true");

      const res = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas/${sId}/fotos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenFreelancer}` },
        body: formData,
      });
      assert.equal(res.status, 201, `Subida de foto ${nombreArchivo} debe retornar 201`);
      const fotoCreada = (await res.json()) as any;
      clavesArchivosCreados.push(fotoCreada.id);
      return fotoCreada;
    }

    const foto1 = await subirFotoMultipart(sesion1.id, jpeg, "ceremonia_01.jpg", "image/jpeg", 1, true);
    const foto2 = await subirFotoMultipart(sesion1.id, png, "recepcion_02.png", "image/png", 2, false);
    const foto3 = await subirFotoMultipart(sesion1.id, jpeg, "brindis_03.jpg", "image/jpeg", 3, false);

    assert.equal(foto1.esPortada, true, "Foto 1 debe ser marcada como portada");
    assert.equal(foto2.esPortada, false);
    assert.equal(foto3.esPortada, false);

    // Subir 1 foto a sesión 2 (borrador)
    const fotoBorrador = await subirFotoMultipart(sesion2.id, jpeg, "borrador_01.jpg", "image/jpeg", 1, false);

    // Publicar Sesión 1
    const resPublicar = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas/${sesion1.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFreelancer}`,
      },
      body: JSON.stringify({ estado: "PUBLICADA", portadaFotoId: foto1.id }),
    });
    assert.equal(resPublicar.status, 200);
    const sesion1Actualizada = (await resPublicar.json()) as any;
    assert.equal(sesion1Actualizada.estado, "PUBLICADA");
    assert.equal(sesion1Actualizada.portadaFotoId, foto1.id);
    console.log("   [OK] 3 fotos subidas a Sesión 1; portada asignada; Sesión 1 PUBLICADA; Sesión 2 conservada en BORRADOR");

    // -------------------------------------------------------------------------
    // 6. PORTAL AUTENTICADO DEL CLIENTE
    // -------------------------------------------------------------------------
    console.log("-> 6. Crear credenciales de portal y validar acceso del cliente...");
    const usuarioCliente = await prisma.usuario.create({
      data: {
        correo: `portal.cliente.${idUnico}@boda.test`,
        contrasenaHash: "hash_portal_test",
        nombre: "Carlos & Laura",
      },
    });
    usuarioClienteId = usuarioCliente.id;

    await prisma.accesoCliente.create({
      data: {
        usuarioId: usuarioCliente.id,
        clienteId: clienteId,
        organizacionId: orgId,
        rol: "TITULAR",
        activo: true,
      },
    });

    const tokenPortalId = randomUUID();
    const tokenFirmado = firmarToken(
      {
        tipoAcceso: "CLIENTE",
        usuarioId: usuarioCliente.id,
        organizacionId: orgId,
        clienteId: clienteId,
        rolCliente: "TITULAR",
      },
      tokenPortalId
    );

    await prisma.sesion.create({
      data: {
        id: tokenPortalId,
        usuarioId: usuarioCliente.id,
        tokenHash: hashToken(tokenFirmado.token),
        expiraEn: tokenFirmado.expiraEn,
      },
    });
    const tokenPortalCliente = tokenFirmado.token;

    // 6.1 Identidad del portal
    const resPortalIdentidad = await fetch(`${urlApi}/api/portal`, {
      headers: { Authorization: `Bearer ${tokenPortalCliente}` },
    });
    assert.equal(resPortalIdentidad.status, 200);
    const portalIdentidad = (await resPortalIdentidad.json()) as any;
    assert.equal(portalIdentidad.estudio.tipoFreelance, "FOTOGRAFIA", "Portal debe reflejar tipoFreelance FOTOGRAFIA");

    // 6.2 Lista de sesiones en el portal: ve ÚNICAMENTE la publicada
    const resPortalSesiones = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, {
      headers: { Authorization: `Bearer ${tokenPortalCliente}` },
    });
    assert.equal(resPortalSesiones.status, 200);
    const portalSesiones = (await resPortalSesiones.json()) as any[];
    assert.equal(portalSesiones.length, 1, "El cliente debe ver exactamente 1 sesión publicada");
    assert.equal(portalSesiones[0].id, sesion1.id);
    assert.equal(portalSesiones[0].nombre, "Boda Iglesia y Recepción");
    assert.equal(portalSesiones[0].estado, "PUBLICADA");
    assert.equal(portalSesiones[0].portadaFotoId, foto1.id);
    console.log("   [OK] El portal muestra únicamente la sesión publicada; la sesión borrador está excluida");

    // 6.3 Sesión borrador completamente inaccesible por ID (404)
    const resSesionBorrador = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion2.id}`, {
      headers: { Authorization: `Bearer ${tokenPortalCliente}` },
    });
    assert.equal(resSesionBorrador.status, 404, "Sesión en borrador debe devolver 404 al portal del cliente");

    const resFotosBorrador = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion2.id}/fotos`, {
      headers: { Authorization: `Bearer ${tokenPortalCliente}` },
    });
    assert.equal(resFotosBorrador.status, 404, "Fotos de sesión en borrador deben devolver 404");
    console.log("   [OK] Intento de acceso a sesión borrador retorna 404 estricto");

    // 6.4 Fotos de la sesión publicada
    const resPortalFotos = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion1.id}/fotos?pagina=1&limite=10`, {
      headers: { Authorization: `Bearer ${tokenPortalCliente}` },
    });
    assert.equal(resPortalFotos.status, 200);
    const portalFotos = (await resPortalFotos.json()) as any;
    assert.equal(portalFotos.total, 3);
    assert.equal(portalFotos.items.length, 3);
    assert.equal(portalFotos.items[0].id, foto1.id);
    assert.equal(portalFotos.items[0].esPortada, true);

    // 6.5 Descarga binaria autenticada desde el portal (Blob streaming)
    const resBlob = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion1.id}/fotos/${foto1.id}/contenido?variante=original`, {
      headers: { Authorization: `Bearer ${tokenPortalCliente}` },
    });
    assert.equal(resBlob.status, 200);
    assert.equal(resBlob.headers.get("content-type"), "image/jpeg");
    assert.ok(resBlob.headers.get("cache-control")?.includes("private"));
    const bytesRecibidos = Buffer.from(await resBlob.arrayBuffer());
    assert.deepEqual(bytesRecibidos, jpeg, "El contenido del blob debe ser idéntico al fixture subido");
    console.log("   [OK] Descarga de blob autenticada con headers de seguridad y bytes exactos");

    // -------------------------------------------------------------------------
    // 7. SEGURIDAD Y AISLAMIENTO MULTITENANT
    // -------------------------------------------------------------------------
    console.log("-> 7. Verificar aislamiento multitenant y denegación a terceros...");
    // 7.1 Registrar otra organización ajena
    const resRegAjeno = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: `ajeno.${idUnico}@otro.test`,
        contrasena: "PasswordSeguro123!",
        nombre: "Estudio Ajeno",
        nombreEstudio: `Ajeno Studio ${idUnico}`,
        slug: `ajeno-${idUnico}`,
        tipoFreelance: "FOTOGRAFIA",
      }),
    });
    const ajenoJson = (await resRegAjeno.json()) as any;
    const tokenAjeno = ajenoJson.token;

    // Intento de la organización ajena de consultar sesiones del cliente de Valeria
    const resAjenoSesiones = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas`, {
      headers: { Authorization: `Bearer ${tokenAjeno}` },
    });
    assert.equal(resAjenoSesiones.status, 404, "Organización ajena no debe poder ver sesiones de otro cliente");

    // Intento de la organización ajena de acceder a fotos de la sesión
    const resAjenoFotos = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas/${sesion1.id}/fotos`, {
      headers: { Authorization: `Bearer ${tokenAjeno}` },
    });
    assert.equal(resAjenoFotos.status, 404, "Organización ajena no debe poder ver fotos de sesión ajena");

    // Intento de acceso sin token
    const resSinToken = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, {
      headers: {},
    });
    assert.equal(resSinToken.status, 401, "Solicitud sin token debe devolver 401");

    // Intento de path traversal en la descarga binaria
    const resTraversal = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas/../../etc/passwd/contenido`, {
      headers: { Authorization: `Bearer ${tokenFreelancer}` },
    });
    assert.equal(resTraversal.status, 404);
    console.log("   [OK] Aislamiento multitenant, 401 sin auth y protección anti-traversal comprobados");

    // -------------------------------------------------------------------------
    // 8. CAMBIO DE TIPO SIN PÉRDIDA Y FLUJO GENERAL INTACTO
    // -------------------------------------------------------------------------
    console.log("-> 8. Cambiar tipoFreelance a GENERAL y confirmar preservación total de datos...");
    const resCambioGeneral = await fetch(`${urlApi}/api/organizacion/tipo-freelance`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFreelancer}`,
      },
      body: JSON.stringify({ tipoFreelance: "GENERAL" }),
    });
    assert.equal(resCambioGeneral.status, 200);
    const orgGeneral = (await resCambioGeneral.json()) as any;
    assert.equal(orgGeneral.tipoFreelance, "GENERAL");

    // Verificar que en GENERAL, el cliente sigue intacto
    const resClientesGeneral = await fetch(`${urlApi}/api/clientes`, {
      headers: { Authorization: `Bearer ${tokenFreelancer}` },
    });
    const listaGeneral = (await resClientesGeneral.json()) as any[];
    assert.equal(listaGeneral.length, 1);
    assert.equal(listaGeneral[0].id, clienteId);

    // Verificar que las sesiones fotográficas siguen existiendo
    const resSesionesEnGeneral = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas`, {
      headers: { Authorization: `Bearer ${tokenFreelancer}` },
    });
    assert.equal(resSesionesEnGeneral.status, 200);
    const sesionesEnGeneral = (await resSesionesEnGeneral.json()) as any[];
    assert.equal(sesionesEnGeneral.length, 2, "Las 2 sesiones deben seguir existiendo intactas");

    // Cambiar de regreso a FOTOGRAFIA
    const resRegresoFoto = await fetch(`${urlApi}/api/organizacion/tipo-freelance`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFreelancer}`,
      },
      body: JSON.stringify({ tipoFreelance: "FOTOGRAFIA" }),
    });
    assert.equal(resRegresoFoto.status, 200);
    console.log("   [OK] Cambio de tipoFreelance bidireccional preserva clientes, sesiones y fotos sin pérdida");

    // -------------------------------------------------------------------------
    // 9. LIMPIEZA TOTAL DE DATOS DE PRUEBA CREADOS
    // -------------------------------------------------------------------------
    console.log("-> 9. Limpieza de datos de prueba aislados...");
    // Eliminar fotos en disco
    const fotosBD = await prisma.fotoSesion.findMany({
      where: { sesion: { organizacionId: orgId } },
    });
    for (const f of fotosBD) {
      const ruta = path.join(dirFotos, `${f.almacenamientoKey}.bin`);
      if (fs.existsSync(ruta)) {
        fs.unlinkSync(ruta);
      }
    }

    // Eliminar registros de la base de datos de esta prueba
    await prisma.sesion.deleteMany({ where: { usuarioId: { in: [usuarioId, usuarioClienteId, ajenoJson.usuario.id] } } });
    await prisma.actividad.deleteMany({ where: { organizacionId: { in: [orgId, ajenoJson.organizacion.id] } } });
    await prisma.fotoSesion.deleteMany({ where: { sesion: { organizacionId: orgId } } });
    await prisma.sesionFotografica.deleteMany({ where: { organizacionId: orgId } });
    await prisma.accesoCliente.deleteMany({ where: { clienteId } });
    await prisma.cliente.deleteMany({ where: { id: clienteId } });
    await prisma.miembroOrganizacion.deleteMany({ where: { organizacionId: { in: [orgId, ajenoJson.organizacion.id] } } });
    await prisma.organizacion.deleteMany({ where: { id: { in: [orgId, ajenoJson.organizacion.id] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [usuarioId, usuarioClienteId, ajenoJson.usuario.id] } } });

    console.log("   [OK] Limpieza aislada completada sin tocar ningún registro previo");
    console.log("=== TODAS LAS VERIFICACIONES E2E DE FOTOGRAFÍA PASARON CON ÉXITO ===");
  } catch (error) {
    console.error("ERROR EN VALIDACIÓN E2E:", error);
    throw error;
  }
}

ejecutarValidacionE2E().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
