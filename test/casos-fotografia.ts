import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";
import { randomUUID } from "node:crypto";

const BASE_ESPERADA = "equinox_fotografia_test";

async function verificarBaseActual() {
  const resultado: Array<{ current_database: string }> = await prisma.$queryRaw`SELECT current_database();`;
  assert.equal(
    resultado[0]?.current_database,
    BASE_ESPERADA,
    "Las pruebas destructivas solo pueden usar la base temporal autorizada"
  );
}

// Generador de imagen JPEG mínima válida (1x1 pixel)
function crearJpegMinimo(): Buffer {
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
    0x00, 0x7f, 0x00, 0xff, 0xd9,
  ]);
}

// Generador de imagen PNG mínima válida (1x1 pixel)
function crearPngMinimo(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00,
    0x00, 0x00, 0x04, 0x00, 0x01, 0x27, 0x34, 0x27, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

async function ejecutar() {
  await verificarBaseActual();
  let servidor: ReturnType<typeof createServer> | null = null;
  let urlApi = "";

  const dirFotosTest = path.resolve(process.cwd(), "./almacenamiento_privado/fotos_test");
  if (!fs.existsSync(dirFotosTest)) {
    fs.mkdirSync(dirFotosTest, { recursive: true });
  }

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

    // Limpieza previa
    await prisma.fotoSesion.deleteMany();
    await prisma.sesionFotografica.deleteMany();
    await prisma.actividad.deleteMany();
    await prisma.sesion.deleteMany();
    await prisma.invitacionCliente.deleteMany();
    await prisma.accesoCliente.deleteMany();
    await prisma.miembroOrganizacion.deleteMany();
    await prisma.tarea.deleteMany();
    await prisma.hito.deleteMany();
    await prisma.archivo.deleteMany();
    await prisma.comentario.deleteMany();
    await prisma.factura.deleteMany();
    await prisma.proyecto.deleteMany();
    await prisma.cliente.deleteMany();
    await prisma.organizacion.deleteMany();
    await prisma.usuario.deleteMany();

    // 1. REGISTRO DE DOS ORGANIZACIONES (Alfa = FOTOGRAFIA, Beta = GENERAL)
    const registrar = async (correo: string, slug: string) => {
      const respuesta = await fetch(`${urlApi}/api/autenticacion/registro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo,
          contrasena: "Password123!",
          nombre: "Fotógrafo Principal",
          nombreEstudio: `Estudio ${slug}`,
          slug,
        }),
      });
      assert.equal(respuesta.status, 201);
      return (await respuesta.json()) as { token: string; organizacion: { id: string } };
    };

    const alfa = await registrar("fotografo.alfa@example.test", "foto-alfa");
    const beta = await registrar("fotografo.beta@example.test", "foto-beta");

    const authHeaders = (token: string) => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });

    // 1.1 Verificar tipoFreelance default GENERAL y cambio a FOTOGRAFIA
    const orgInicialAlfa = await prisma.organizacion.findUnique({ where: { id: alfa.organizacion.id } });
    assert.equal(orgInicialAlfa?.tipoFreelance, "GENERAL", "Por defecto tipoFreelance debe ser GENERAL");

    await prisma.organizacion.update({
      where: { id: alfa.organizacion.id },
      data: { tipoFreelance: "FOTOGRAFIA" },
    });

    // 2. CREACIÓN DE CLIENTES EN CADA ORGANIZACIÓN
    const resClienteAlfa = await fetch(`${urlApi}/api/clientes`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({ nombre: "Cliente Boda Ana y Carlos", correo: "ana.carlos@example.test", estado: "ACTIVO" }),
    });
    assert.equal(resClienteAlfa.status, 201);
    const clienteAlfa = (await resClienteAlfa.json()) as { id: string };

    const resClienteBeta = await fetch(`${urlApi}/api/clientes`, {
      method: "POST",
      headers: authHeaders(beta.token),
      body: JSON.stringify({ nombre: "Cliente Retrato Beta", correo: "retrato.beta@example.test", estado: "ACTIVO" }),
    });
    assert.equal(resClienteBeta.status, 201);
    const clienteBeta = (await resClienteBeta.json()) as { id: string };

    // 3. CREAR CUENTA DE USUARIO Y SESIÓN DE PORTAL PARA CLIENTE ALFA
    const usuarioClienteAlfa = await prisma.usuario.create({
      data: {
        correo: "portal.ana.carlos@example.test",
        contrasenaHash: "hash_fixture_portal",
        nombre: "Ana",
        apellido: "Gómez",
      },
    });

    await prisma.accesoCliente.create({
      data: {
        usuarioId: usuarioClienteAlfa.id,
        clienteId: clienteAlfa.id,
        organizacionId: alfa.organizacion.id,
        rol: "TITULAR",
        activo: true,
      },
    });

    const tokenPortalAlfaId = randomUUID();
    const tokenPortalAlfaFirmado = firmarToken(
      {
        tipoAcceso: "CLIENTE",
        usuarioId: usuarioClienteAlfa.id,
        organizacionId: alfa.organizacion.id,
        clienteId: clienteAlfa.id,
        rolCliente: "TITULAR",
      },
      tokenPortalAlfaId
    );
    await prisma.sesion.create({
      data: {
        id: tokenPortalAlfaId,
        usuarioId: usuarioClienteAlfa.id,
        tipoAcceso: "CLIENTE",
        tokenHash: hashToken(tokenPortalAlfaFirmado.token),
        expiraEn: tokenPortalAlfaFirmado.expiraEn,
      },
    });
    const tokenPortalAlfa = tokenPortalAlfaFirmado.token;

    // 3.1 Portal identidad incluye tipoFreelance
    const resPortalIdentidad = await fetch(`${urlApi}/api/portal`, {
      headers: { Authorization: `Bearer ${tokenPortalAlfa}` },
    });
    assert.equal(resPortalIdentidad.status, 200);
    const datosPortalIdentidad = (await resPortalIdentidad.json()) as any;
    assert.equal(datosPortalIdentidad.estudio.tipoFreelance, "FOTOGRAFIA");
    console.log("[fotografia] Caso 1 OK: Organizacion.tipoFreelance default y portal identidad verificado.");

    // 4. API FREELANCER: CREAR SESIONES (BORRADOR Y PUBLICADA)
    // Sesión 1: BORRADOR
    const resSesion1 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({
        nombre: "Sesión Preboda Jardín Botánico",
        descripcion: "Fotos tomadas en la mañana",
        fecha: "2026-11-10",
        estado: "BORRADOR",
      }),
    });
    assert.equal(resSesion1.status, 201);
    const sesion1 = (await resSesion1.json()) as any;
    assert.equal(sesion1.nombre, "Sesión Preboda Jardín Botánico");
    assert.equal(sesion1.estado, "BORRADOR");
    assert.equal(sesion1.cantidadFotos, 0);

    // Sesión 2: PUBLICADA
    const resSesion2 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({
        nombre: "Ceremonia Civil",
        descripcion: "Galería oficial publicada",
        fecha: "2026-11-12",
        estado: "PUBLICADA",
      }),
    });
    assert.equal(resSesion2.status, 201);
    const sesion2 = (await resSesion2.json()) as any;
    assert.equal(sesion2.estado, "PUBLICADA");
    console.log("[fotografia] Caso 2 OK: Creación de sesiones fotográficas (BORRADOR y PUBLICADA) exitosa.");

    // 5. BORRADOR INVISIBLE EN EL PORTAL DE CLIENTE
    // El cliente solo debe ver la sesión PUBLICADA (sesion2), NUNCA la sesión en BORRADOR (sesion1)
    const resPortalSesiones = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, {
      headers: { Authorization: `Bearer ${tokenPortalAlfa}` },
    });
    assert.equal(resPortalSesiones.status, 200);
    const portalSesiones = (await resPortalSesiones.json()) as any[];
    assert.equal(portalSesiones.length, 1);
    assert.equal(portalSesiones[0].id, sesion2.id);
    assert.equal(portalSesiones.find((s) => s.id === sesion1.id), undefined);

    // Intento de acceso directo por ID a la sesión en BORRADOR debe retornar 404
    const resBorradorDirecto = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion1.id}`, {
      headers: { Authorization: `Bearer ${tokenPortalAlfa}` },
    });
    assert.equal(resBorradorDirecto.status, 404, "El cliente no debe poder consultar el detalle de un borrador");

    // Intento de listar fotos de la sesión en BORRADOR debe retornar 404
    const resFotosBorrador = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion1.id}/fotos`, {
      headers: { Authorization: `Bearer ${tokenPortalAlfa}` },
    });
    assert.equal(resFotosBorrador.status, 404, "El cliente no debe poder ver fotos de una sesión en borrador");

    // Publicar sesion1 vía PATCH
    const resPublicarSesion1 = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion1.id}`, {
      method: "PATCH",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({ estado: "PUBLICADA" }),
    });
    assert.equal(resPublicarSesion1.status, 200);
    assert.equal((await resPublicarSesion1.json() as any).estado, "PUBLICADA");

    // Ahora sesion1 debe ser visible en el portal
    const resPortalSesiones2 = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, {
      headers: { Authorization: `Bearer ${tokenPortalAlfa}` },
    });
    const portalSesiones2 = (await resPortalSesiones2.json()) as any[];
    assert.equal(portalSesiones2.length, 2);

    // Despublicar sesion1 nuevamente (regresar a BORRADOR)
    await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion1.id}`, {
      method: "PATCH",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({ estado: "BORRADOR" }),
    });
    // Inmediatamente invisible otra vez
    const resPortalSesiones3 = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, {
      headers: { Authorization: `Bearer ${tokenPortalAlfa}` },
    });
    assert.equal(((await resPortalSesiones3.json()) as any[]).length, 1);
    console.log("[fotografia] Caso 3 OK: Borrador invisible y ciclo de publicación/despublicación verificado.");

    // 6. ACCESO CRUZADO (MULTITENANCY)
    // Beta intenta acceder a la lista de sesiones de Cliente Alfa
    const resBetaAccesoCruzado = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas`, {
      headers: authHeaders(beta.token),
    });
    assert.equal(resBetaAccesoCruzado.status, 404, "Beta no debe ver sesiones de clientes de otra organización");

    // Beta intenta crear sesión para Cliente Alfa
    const resBetaCrear = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas`, {
      method: "POST",
      headers: authHeaders(beta.token),
      body: JSON.stringify({ nombre: "Sesión Intruso" }),
    });
    assert.equal(resBetaCrear.status, 404);

    // Beta intenta ver sesion2
    const resBetaVer = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}`, {
      headers: authHeaders(beta.token),
    });
    assert.equal(resBetaVer.status, 404);

    // Beta intenta modificar sesion2
    const resBetaMod = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}`, {
      method: "PATCH",
      headers: authHeaders(beta.token),
      body: JSON.stringify({ nombre: "Nombre hackeado" }),
    });
    assert.equal(resBetaMod.status, 404);

    // Beta intenta eliminar sesion2
    const resBetaDel = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}`, {
      method: "DELETE",
      headers: authHeaders(beta.token),
    });
    assert.equal(resBetaDel.status, 404);
    console.log("[fotografia] Caso 4 OK: Aislamiento multitenant total verificado.");

    // 7. CARGA DE FOTOS MULTIPART (SIN BASE64) Y LOTES GRANDES (UNA POR PETICIÓN)
    const jpegBuffer = crearJpegMinimo();
    const pngBuffer = crearPngMinimo();

    async function subirFoto(
      sesionId: string,
      clienteId: string,
      token: string,
      buffer: Buffer,
      nombreArchivo: string,
      tipoMime: string,
      orden?: number,
      esPortada?: boolean
    ) {
      const formData = new FormData();
      formData.append("foto", new Blob([new Uint8Array(buffer)], { type: tipoMime }), nombreArchivo);
      if (orden !== undefined) formData.append("orden", orden.toString());
      if (esPortada !== undefined) formData.append("esPortada", esPortada ? "true" : "false");

      const res = await fetch(`${urlApi}/api/clientes/${clienteId}/sesiones-fotograficas/${sesionId}/fotos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      return { status: res.status, datos: (await res.json()) as any };
    }

    // Subir 10 fotos a sesion2 simulando un lote grande
    const fotosSubidas: any[] = [];
    for (let i = 1; i <= 10; i++) {
      const buf = i % 2 === 0 ? pngBuffer : jpegBuffer;
      const mime = i % 2 === 0 ? "image/png" : "image/jpeg";
      const ext = i % 2 === 0 ? "png" : "jpg";
      const nombre = `boda_${i.toString().padStart(3, "0")}.${ext}`;
      const esPortada = i === 1; // La primera es portada

      const resUpload = await subirFoto(sesion2.id, clienteAlfa.id, alfa.token, buf, nombre, mime, i, esPortada);
      assert.equal(resUpload.status, 201);
      assert.ok(resUpload.datos.id);
      assert.equal(resUpload.datos.nombreOriginal, nombre);
      assert.equal(resUpload.datos.tipoMime, mime);
      assert.equal(resUpload.datos.tamanoBytes, buf.length);
      assert.equal(resUpload.datos.orden, i);
      assert.equal(resUpload.datos.esPortada, esPortada);
      fotosSubidas.push(resUpload.datos);
    }
    assert.equal(fotosSubidas.length, 10);
    console.log("[fotografia] Caso 5 OK: Carga de 10 fotos multipart consecutivas sin base64 completada.");

    // 8. PAGINACIÓN (API FREELANCER Y PORTAL CLIENTE)
    // Página 1: límite 4 -> debe retornar 4 items, total 10, pagina 1
    const resPaginadaP1 = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}/fotos?pagina=1&limite=4`,
      { headers: authHeaders(alfa.token) }
    );
    assert.equal(resPaginadaP1.status, 200);
    const p1 = (await resPaginadaP1.json()) as any;
    assert.equal(p1.items.length, 4);
    assert.equal(p1.total, 10);
    assert.equal(p1.pagina, 1);
    assert.equal(p1.limite, 4);
    assert.equal(p1.items[0].orden, 1);
    assert.equal(p1.items[3].orden, 4);

    // Página 2: límite 4 -> items del 5 al 8
    const resPaginadaP2 = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}/fotos?pagina=2&limite=4`,
      { headers: authHeaders(alfa.token) }
    );
    const p2 = (await resPaginadaP2.json()) as any;
    assert.equal(p2.items.length, 4);
    assert.equal(p2.items[0].orden, 5);
    assert.equal(p2.items[3].orden, 8);

    // Página 3: límite 4 -> items 9 y 10 (2 restantes)
    const resPaginadaP3 = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}/fotos?pagina=3&limite=4`,
      { headers: authHeaders(alfa.token) }
    );
    const p3 = (await resPaginadaP3.json()) as any;
    assert.equal(p3.items.length, 2);
    assert.equal(p3.items[0].orden, 9);
    assert.equal(p3.items[1].orden, 10);

    // Paginación en Portal del Cliente
    const resPortalPaginada = await fetch(
      `${urlApi}/api/portal/sesiones-fotograficas/${sesion2.id}/fotos?pagina=1&limite=5`,
      { headers: { Authorization: `Bearer ${tokenPortalAlfa}` } }
    );
    assert.equal(resPortalPaginada.status, 200);
    const portalPag = (await resPortalPaginada.json()) as any;
    assert.equal(portalPag.items.length, 5);
    assert.equal(portalPag.total, 10);
    // Verificar que en la respuesta JSON no existen URLs públicas ni rutas en disco
    const jsonStr = JSON.stringify(portalPag);
    assert.ok(!jsonStr.includes("almacenamientoKey"));
    assert.ok(!jsonStr.includes("fotos_test"));
    console.log("[fotografia] Caso 6 OK: Paginación en API freelancer y portal cliente validada.");

    // 9. OBTENER CONTENIDO BINARIO AUTENTICADO (BLOB STREAMING)
    const primeraFoto = fotosSubidas[0];
    const resBlobFreelancer = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}/fotos/${primeraFoto.id}/contenido?variante=original`,
      { headers: { Authorization: `Bearer ${alfa.token}` } }
    );
    assert.equal(resBlobFreelancer.status, 200);
    assert.equal(resBlobFreelancer.headers.get("content-type"), primeraFoto.tipoMime);
    const bufferRecibido = Buffer.from(await resBlobFreelancer.arrayBuffer());
    assert.deepEqual(bufferRecibido, jpegBuffer, "El stream binario debe coincidir byte a byte con el archivo subido");

    // Blob desde el portal de cliente
    const resBlobPortal = await fetch(
      `${urlApi}/api/portal/sesiones-fotograficas/${sesion2.id}/fotos/${primeraFoto.id}/contenido?variante=miniatura`,
      { headers: { Authorization: `Bearer ${tokenPortalAlfa}` } }
    );
    assert.equal(resBlobPortal.status, 200);
    const bufferPortal = Buffer.from(await resBlobPortal.arrayBuffer());
    assert.deepEqual(bufferPortal, jpegBuffer);

    // Blob denegado a otra organización
    const resBlobBeta = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}/fotos/${primeraFoto.id}/contenido`,
      { headers: { Authorization: `Bearer ${beta.token}` } }
    );
    assert.equal(resBlobBeta.status, 404);
    console.log("[fotografia] Caso 7 OK: Descarga binaria autenticada y autorización de blobs validada.");

    // 10. MODIFICAR FOTO (ORDEN Y PORTADA)
    const segundaFoto = fotosSubidas[1];
    const resPatchFoto = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}/fotos/${segundaFoto.id}`,
      {
        method: "PATCH",
        headers: authHeaders(alfa.token),
        body: JSON.stringify({ esPortada: true, orden: 99 }),
      }
    );
    assert.equal(resPatchFoto.status, 200);
    const fotoActualizada = (await resPatchFoto.json()) as any;
    assert.equal(fotoActualizada.esPortada, true);
    assert.equal(fotoActualizada.orden, 99);

    // Verificar en la sesión que la portada cambió a segundaFoto.id
    const resSesionPortadaCheck = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}`,
      { headers: authHeaders(alfa.token) }
    );
    assert.equal(((await resSesionPortadaCheck.json()) as any).portadaFotoId, segundaFoto.id);
    console.log("[fotografia] Caso 8 OK: Actualización de portada y orden de fotos exitosa.");

    // 11. ELIMINAR FOTO Y LIMPIEZA DE DISCO
    const fotoParaEliminar = fotosSubidas[9]; // décima foto
    const fotoDbAntes = await prisma.fotoSesion.findUnique({ where: { id: fotoParaEliminar.id } });
    assert.ok(fotoDbAntes);
    const rutaEnDisco = path.resolve(dirFotosTest, `${fotoDbAntes.almacenamientoKey}.bin`);
    assert.ok(fs.existsSync(rutaEnDisco), "El archivo binario debe existir en disco antes de borrar");

    const resDeleteFoto = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}/fotos/${fotoParaEliminar.id}`,
      {
        method: "DELETE",
        headers: authHeaders(alfa.token),
      }
    );
    assert.equal(resDeleteFoto.status, 204);

    // Confirmar que el registro ya no está en BD y el archivo se borró de disco
    const fotoDbDespues = await prisma.fotoSesion.findUnique({ where: { id: fotoParaEliminar.id } });
    assert.equal(fotoDbDespues, null);
    assert.ok(!fs.existsSync(rutaEnDisco), "El archivo binario debe ser eliminado de disco");
    console.log("[fotografia] Caso 9 OK: Eliminación individual de foto y limpieza de disco.");

    // 12. BORRADO SEGURO DE SESIÓN ("DELETE si es seguro")
    // Intentar eliminar sesion2 estando PUBLICADA debe ser rechazado (409)
    const resDeleteSesionPublicada = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}`,
      {
        method: "DELETE",
        headers: authHeaders(alfa.token),
      }
    );
    assert.equal(resDeleteSesionPublicada.status, 409, "Una sesión publicada no se puede eliminar de forma insegura");

    // Despublicar sesion2 (cambiar a BORRADOR)
    await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}`, {
      method: "PATCH",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({ estado: "BORRADOR" }),
    });

    // Ahora sí es seguro eliminar la sesión en BORRADOR
    const fotosSesion2 = await prisma.fotoSesion.findMany({ where: { sesionId: sesion2.id } });
    assert.ok(fotosSesion2.length > 0);

    const resDeleteSesionBorrador = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesion2.id}`,
      {
        method: "DELETE",
        headers: authHeaders(alfa.token),
      }
    );
    assert.equal(resDeleteSesionBorrador.status, 204);

    // Confirmar que la sesión y todas sus fotos fueron eliminadas de la BD y de disco
    const sesionEnDb = await prisma.sesionFotografica.findUnique({ where: { id: sesion2.id } });
    assert.equal(sesionEnDb, null);
    for (const f of fotosSesion2) {
      const ruta = path.resolve(dirFotosTest, `${f.almacenamientoKey}.bin`);
      assert.ok(!fs.existsSync(ruta), `El archivo ${ruta} debe haber sido eliminado del disco`);
    }
    console.log("[fotografia] Caso 10 OK: Control 'DELETE si es seguro' y limpieza integral de archivos verificada.");

    // 13. VALIDACIÓN DE MIME REAL Y LIMPIEZA ANTE FALLO
    // Crear una sesión temporal para pruebas de fallo
    const resSesionFallo = await fetch(`${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({ nombre: "Sesión Pruebas de Fallo" }),
    });
    const sesionFallo = (await resSesionFallo.json()) as any;

    const archivosEnDiscoAntes = fs.readdirSync(dirFotosTest).length;

    // Subir archivo de texto simulando ser JPEG
    const textoFalso = Buffer.from("<html><script>alert('pwn')</script></html>");
    const resFalsoMime = await subirFoto(
      sesionFallo.id,
      clienteAlfa.id,
      alfa.token,
      textoFalso,
      "exploit.jpg",
      "image/jpeg"
    );
    assert.equal(resFalsoMime.status, 415, "Debe rechazar archivos con firma mágica no reconocida como imagen");

    // Subir archivo vacío
    const archivoVacio = Buffer.alloc(0);
    const resVacio = await subirFoto(
      sesionFallo.id,
      clienteAlfa.id,
      alfa.token,
      archivoVacio,
      "vacio.png",
      "image/png"
    );
    assert.equal(resVacio.status, 400, "Debe rechazar archivos vacíos");

    // Verificar que no quedaron archivos temporales o huérfanos tras los rechazos
    const archivosEnDiscoDespues = fs.readdirSync(dirFotosTest).length;
    assert.equal(
      archivosEnDiscoDespues,
      archivosEnDiscoAntes,
      "No deben quedar archivos residuales ni temporales ante rechazo o fallo"
    );

    // 14. PREVENCIÓN DE PATH TRAVERSAL
    const resTraversal = await fetch(
      `${urlApi}/api/clientes/${clienteAlfa.id}/sesiones-fotograficas/${sesionFallo.id}/fotos/../../etc/passwd/contenido`,
      { headers: authHeaders(alfa.token) }
    );
    assert.ok(
      resTraversal.status === 400 || resTraversal.status === 404,
      "Debe prevenir path traversal o rechazar identificadores no UUID"
    );

    console.log("[fotografia] Caso 11 OK: Validación estricta de MIME real, rechazo de vacíos, limpieza ante fallo y anti-traversal.");
    console.log("[fotografia] ¡Todas las pruebas de la modalidad FOTOGRAFIA se completaron con éxito!");
  } finally {
    if (servidor) {
      await new Promise<void>((resolve) => (servidor as ReturnType<typeof createServer>).close(() => resolve()));
    }
    // Limpieza de directorio de pruebas
    try {
      if (fs.existsSync(dirFotosTest)) {
        fs.rmSync(dirFotosTest, { recursive: true, force: true });
      }
    } catch {}
  }
}

ejecutar().catch((err) => {
  console.error("[fotografia] Fallo en la suite de pruebas:", err);
  process.exit(1);
});
