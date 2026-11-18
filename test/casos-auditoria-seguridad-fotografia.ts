import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";
import { resolverRutaSegura, validarClaveAlmacenamiento } from "../src/servicios/almacenamiento-fotos.js";
import type { ContextoSinSesion } from "../src/tipos.js";

const BASE_ESPERADA = "equinox_fotografia_test";

async function verificarBaseActual() {
  const resultado: Array<{ current_database: string }> = await prisma.$queryRaw`SELECT current_database();`;
  assert.equal(
    resultado[0]?.current_database,
    BASE_ESPERADA,
    "Las pruebas de auditoría solo pueden ejecutarse en la base de pruebas autorizada"
  );
}

// Helpers para imágenes mínimas válidas
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

function crearPngMinimo(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00,
    0x00, 0x00, 0x04, 0x00, 0x01, 0x27, 0x34, 0x27, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

function crearGifMinimo(): Buffer {
  return Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x01, 0x44, 0x00, 0x3b,
  ]);
}

function crearWebpMinimo(): Buffer {
  // RIFF .... WEBP VP8 ...
  const buf = Buffer.alloc(20);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(12, 4);
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8 ", 12, "ascii");
  buf.writeUInt32LE(0, 16);
  return buf;
}

export async function ejecutarAuditoria() {
  await verificarBaseActual();

  const dirFotosTest = path.resolve(process.cwd(), "./almacenamiento_privado/fotos_test");
  if (!fs.existsSync(dirFotosTest)) {
    fs.mkdirSync(dirFotosTest, { recursive: true });
  }

  const servidor = createServer(aplicacion);
  let urlApi = "";
  await new Promise<void>((resolve) =>
    servidor.listen(0, "127.0.0.1", () => {
      const dir = servidor.address();
      if (typeof dir === "object" && dir) {
        urlApi = `http://127.0.0.1:${dir.port}`;
      }
      resolve();
    })
  );

  console.log(`[auditoria] Servidor de pruebas iniciado en ${urlApi}`);

  try {
    // 0. Limpieza integral de base de datos
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

    // Helper para crear sesiones y tokens
    async function crearSesionUsuario(contexto: ContextoSinSesion) {
      const sId = randomUUID();
      const firmado = firmarToken(contexto, sId);
      await prisma.sesion.create({
        data: {
          id: sId,
          usuarioId: contexto.usuarioId,
          tipoAcceso: contexto.tipoAcceso,
          tokenHash: hashToken(firmado.token),
          expiraEn: firmado.expiraEn,
        },
      });
      return { token: firmado.token, sesionId: sId };
    }

    // 1. Fixtures de Organizaciones y Usuarios
    // Org 1: Estudio Alfa (Fotografía)
    const org1 = await prisma.organizacion.create({
      data: {
        nombre: "Estudio Alfa",
        slug: "estudio-alfa",
        tipoFreelance: "FOTOGRAFIA",
      },
    });
    const userOrg1 = await prisma.usuario.create({
      data: {
        correo: "freelancer1@alfa.test",
        nombre: "Fotógrafo Alfa",
        contrasenaHash: "hash_test_1",
      },
    });
    await prisma.miembroOrganizacion.create({
      data: {
        organizacionId: org1.id,
        usuarioId: userOrg1.id,
        rol: "PROPIETARIO",
      },
    });
    const tokenOrg1 = await crearSesionUsuario({
      tipoAcceso: "ORGANIZACION",
      usuarioId: userOrg1.id,
      organizacionId: org1.id,
      rolOrganizacion: "PROPIETARIO",
    });

    // Org 2: Estudio Beta (General)
    const org2 = await prisma.organizacion.create({
      data: {
        nombre: "Estudio Beta",
        slug: "estudio-beta",
        tipoFreelance: "GENERAL",
      },
    });
    const userOrg2 = await prisma.usuario.create({
      data: {
        correo: "freelancer2@beta.test",
        nombre: "Freelancer Beta",
        contrasenaHash: "hash_test_2",
      },
    });
    await prisma.miembroOrganizacion.create({
      data: {
        organizacionId: org2.id,
        usuarioId: userOrg2.id,
        rol: "PROPIETARIO",
      },
    });
    const tokenOrg2 = await crearSesionUsuario({
      tipoAcceso: "ORGANIZACION",
      usuarioId: userOrg2.id,
      organizacionId: org2.id,
      rolOrganizacion: "PROPIETARIO",
    });

    // Clientes de Org 1
    const cliente1A = await prisma.cliente.create({
      data: {
        organizacionId: org1.id,
        nombre: "Cliente Alfa 1",
        empresa: "Boda Juan y Maria",
      },
    });
    const userClient1A = await prisma.usuario.create({
      data: {
        correo: "cliente1a@alfa.test",
        nombre: "Juan Novio",
        contrasenaHash: "hash_test_c1a",
      },
    });
    await prisma.accesoCliente.create({
      data: {
        usuarioId: userClient1A.id,
        clienteId: cliente1A.id,
        organizacionId: org1.id,
        rol: "TITULAR",
        activo: true,
      },
    });
    const tokenClient1A = await crearSesionUsuario({
      tipoAcceso: "CLIENTE",
      usuarioId: userClient1A.id,
      organizacionId: org1.id,
      clienteId: cliente1A.id,
      rolCliente: "TITULAR",
    });

    const cliente1B = await prisma.cliente.create({
      data: {
        organizacionId: org1.id,
        nombre: "Cliente Alfa 2",
        empresa: "Quinceaños Laura",
      },
    });
    const userClient1B = await prisma.usuario.create({
      data: {
        correo: "cliente1b@alfa.test",
        nombre: "Laura Quinceañera",
        contrasenaHash: "hash_test_c1b",
      },
    });
    await prisma.accesoCliente.create({
      data: {
        usuarioId: userClient1B.id,
        clienteId: cliente1B.id,
        organizacionId: org1.id,
        rol: "TITULAR",
        activo: true,
      },
    });
    const tokenClient1B = await crearSesionUsuario({
      tipoAcceso: "CLIENTE",
      usuarioId: userClient1B.id,
      organizacionId: org1.id,
      clienteId: cliente1B.id,
      rolCliente: "TITULAR",
    });

    // Cliente de Org 2
    const cliente2A = await prisma.cliente.create({
      data: {
        organizacionId: org2.id,
        nombre: "Cliente Beta 1",
        empresa: "Beta Corp",
      },
    });
    const userClient2A = await prisma.usuario.create({
      data: {
        correo: "cliente2a@beta.test",
        nombre: "Carlos Beta",
        contrasenaHash: "hash_test_c2a",
      },
    });
    await prisma.accesoCliente.create({
      data: {
        usuarioId: userClient2A.id,
        clienteId: cliente2A.id,
        organizacionId: org2.id,
        rol: "TITULAR",
        activo: true,
      },
    });
    const tokenClient2A = await crearSesionUsuario({
      tipoAcceso: "CLIENTE",
      usuarioId: userClient2A.id,
      organizacionId: org2.id,
      clienteId: cliente2A.id,
      rolCliente: "TITULAR",
    });

    // Helper multipart upload
    async function subirFoto(
      token: string,
      clienteId: string,
      sesionId: string,
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
      return { status: res.status, data: res.status === 201 ? ((await res.json()) as any) : null };
    }

    // Crear Sesiones Base:
    // Sesion 1A_Pub: Org 1, Cliente 1A, PUBLICADA
    const sesion1A_Pub = await prisma.sesionFotografica.create({
      data: {
        organizacionId: org1.id,
        clienteId: cliente1A.id,
        nombre: "Boda Civil - Sesion Publicada",
        estado: "PUBLICADA",
      },
    });
    const up1A_Pub = await subirFoto(
      tokenOrg1.token,
      cliente1A.id,
      sesion1A_Pub.id,
      crearJpegMinimo(),
      "foto_1a_pub.jpg",
      "image/jpeg",
      0,
      true
    );
    assert.equal(up1A_Pub.status, 201);
    const foto1A_Pub = up1A_Pub.data;

    // Sesion 1A_Borrador: Org 1, Cliente 1A, BORRADOR
    const sesion1A_Borrador = await prisma.sesionFotografica.create({
      data: {
        organizacionId: org1.id,
        clienteId: cliente1A.id,
        nombre: "Boda Fiesta - Sesion Borrador",
        estado: "BORRADOR",
      },
    });
    const up1A_Borrador = await subirFoto(
      tokenOrg1.token,
      cliente1A.id,
      sesion1A_Borrador.id,
      crearPngMinimo(),
      "foto_1a_borrador.png",
      "image/png",
      0,
      true
    );
    assert.equal(up1A_Borrador.status, 201);
    const foto1A_Borrador = up1A_Borrador.data;

    // Sesion 1B_Pub: Org 1, Cliente 1B, PUBLICADA
    const sesion1B_Pub = await prisma.sesionFotografica.create({
      data: {
        organizacionId: org1.id,
        clienteId: cliente1B.id,
        nombre: "Quinceaños Laura - Publicada",
        estado: "PUBLICADA",
      },
    });
    const up1B_Pub = await subirFoto(
      tokenOrg1.token,
      cliente1B.id,
      sesion1B_Pub.id,
      crearGifMinimo(),
      "foto_1b_pub.gif",
      "image/gif",
      0,
      true
    );
    assert.equal(up1B_Pub.status, 201);
    const foto1B_Pub = up1B_Pub.data;

    // Sesion 2A_Pub: Org 2, Cliente 2A, PUBLICADA
    const sesion2A_Pub = await prisma.sesionFotografica.create({
      data: {
        organizacionId: org2.id,
        clienteId: cliente2A.id,
        nombre: "Beta Corp Evento - Publicada",
        estado: "PUBLICADA",
      },
    });
    const up2A_Pub = await subirFoto(
      tokenOrg2.token,
      cliente2A.id,
      sesion2A_Pub.id,
      crearWebpMinimo(),
      "foto_2a_pub.webp",
      "image/webp",
      0,
      true
    );
    assert.equal(up2A_Pub.status, 201);
    const foto2A_Pub = up2A_Pub.data;

    let totalPruebas = 0;
    function registrarPaso(categoria: string, descripcion: string) {
      totalPruebas++;
      console.log(`[PASS ${totalPruebas}] [${categoria}] ${descripcion}`);
    }

    // =========================================================================
    // GRUPO 1: Aislamiento Multitenant entre Organizaciones (Org 1 vs Org 2)
    // =========================================================================
    {
      const authBeta = { Authorization: `Bearer ${tokenOrg2.token}` };

      // 1.1 GET sesiones de cliente ajeno
      const r1 = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas`, { headers: authBeta });
      assert.equal(r1.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 recibe 404 al listar sesiones de Cliente de Org 1");

      // 1.2 POST sesión en cliente ajeno
      const r2 = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas`, {
        method: "POST",
        headers: { ...authBeta, "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "Sesión Intruso Org 2" }),
      });
      assert.equal(r2.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 recibe 404 al intentar crear sesión para Cliente de Org 1");

      // 1.3 GET detalle de sesión ajena
      const r3 = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}`, { headers: authBeta });
      assert.equal(r3.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 recibe 404 al consultar sesión de Org 1");

      // 1.4 PATCH sesión ajena
      const r4 = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}`, {
        method: "PATCH",
        headers: { ...authBeta, "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "Nombre hackeado por Org 2" }),
      });
      assert.equal(r4.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 recibe 404 al modificar sesión de Org 1");

      // 1.5 DELETE sesión ajena (incluso borrador)
      const r5 = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Borrador.id}`, {
        method: "DELETE",
        headers: authBeta,
      });
      assert.equal(r5.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 recibe 404 al eliminar sesión de Org 1");

      // 1.6 GET fotos de sesión ajena
      const r6 = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos`, { headers: authBeta });
      assert.equal(r6.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 recibe 404 al listar fotos de sesión de Org 1");

      // 1.7 POST foto en sesión ajena
      const r7 = await subirFoto(tokenOrg2.token, cliente1A.id, sesion1A_Pub.id, crearJpegMinimo(), "intruso.jpg", "image/jpeg");
      assert.equal(r7.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 recibe 404 al subir foto a sesión de Org 1");

      // 1.8 GET contenido binario de foto ajena
      const r8 = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1A_Pub.id}/contenido`,
        { headers: authBeta }
      );
      assert.equal(r8.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 recibe 404 al descargar contenido binario de Org 1");

      // 1.9 PATCH foto ajena
      const r9 = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1A_Pub.id}`,
        {
          method: "PATCH",
          headers: { ...authBeta, "Content-Type": "application/json" },
          body: JSON.stringify({ orden: 99 }),
        }
      );
      assert.equal(r9.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 recibe 404 al editar foto de Org 1");

      // 1.10 DELETE foto ajena
      const r10 = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1A_Pub.id}`,
        {
          method: "DELETE",
          headers: authBeta,
        }
      );
      assert.equal(r10.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 recibe 404 al eliminar foto de Org 1");

      // 1.11 Rutas directas de fotos sin sesionId
      const r11a = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/fotos/${foto1A_Pub.id}/contenido`, {
        headers: authBeta,
      });
      assert.equal(r11a.status, 404);
      const r11b = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/fotos/${foto1A_Pub.id}`, {
        method: "PATCH",
        headers: { ...authBeta, "Content-Type": "application/json" },
        body: JSON.stringify({ orden: 5 }),
      });
      assert.equal(r11b.status, 404);
      const r11c = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/fotos/${foto1A_Pub.id}`, {
        method: "DELETE",
        headers: authBeta,
      });
      assert.equal(r11c.status, 404);
      registrarPaso("Cross-Tenant Org", "Rutas directas sin sesionId también retornan 404 contra Org 2");

      // 1.12 Intento de invitar a cliente ajeno
      const r12 = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/invitaciones`, {
        method: "POST",
        headers: { ...authBeta, "Content-Type": "application/json" },
        body: JSON.stringify({ correo: "intruso@beta.test" }),
      });
      assert.equal(r12.status, 404);
      registrarPaso("Cross-Tenant Org", "Org 2 no puede invitar clientes a la organización ajena Org 1 (404)");
    }

    // =========================================================================
    // GRUPO 2: Aislamiento Multitenant entre Clientes en Portal (Cliente 1A vs 1B vs 2A)
    // =========================================================================
    {
      const authC1A = { Authorization: `Bearer ${tokenClient1A.token}` };

      // 2.1 Listado de sesiones en portal para Cliente 1A
      const rList = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, { headers: authC1A });
      assert.equal(rList.status, 200);
      const sesionesPortal = (await rList.json()) as any[];
      assert.equal(sesionesPortal.length, 1);
      assert.equal(sesionesPortal[0].id, sesion1A_Pub.id, "Cliente 1A solo ve su propia sesión publicada");
      assert.ok(!sesionesPortal.some((s) => s.id === sesion1B_Pub.id), "No debe contener sesión de Cliente 1B");
      assert.ok(!sesionesPortal.some((s) => s.id === sesion2A_Pub.id), "No debe contener sesión de Cliente 2A");
      registrarPaso("Cross-Client Portal", "Portal solo expone sesiones publicadas del cliente autenticado");

      // 2.2 Consulta de sesión de otro cliente de la misma organización (Cliente 1B)
      const rDetalle1B = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion1B_Pub.id}`, { headers: authC1A });
      assert.equal(rDetalle1B.status, 404);
      registrarPaso("Cross-Client Portal", "Cliente 1A recibe 404 al consultar sesión de Cliente 1B (misma Org)");

      // 2.3 Fotos de sesión de Cliente 1B
      const rFotos1B = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion1B_Pub.id}/fotos`, { headers: authC1A });
      assert.equal(rFotos1B.status, 404);
      registrarPaso("Cross-Client Portal", "Cliente 1A recibe 404 al listar fotos de Cliente 1B");

      // 2.4 Contenido binario de sesión de Cliente 1B
      const rDown1B = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion1B_Pub.id}/fotos/${foto1B_Pub.id}/contenido`,
        { headers: authC1A }
      );
      assert.equal(rDown1B.status, 404);
      registrarPaso("Cross-Client Portal", "Cliente 1A recibe 404 al descargar foto de Cliente 1B");

      // 2.5 Sesión y foto de cliente de otra organización (Cliente 2A)
      const rDetalle2A = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion2A_Pub.id}`, { headers: authC1A });
      assert.equal(rDetalle2A.status, 404);
      const rDown2A = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion2A_Pub.id}/fotos/${foto2A_Pub.id}/contenido`,
        { headers: authC1A }
      );
      assert.equal(rDown2A.status, 404);
      registrarPaso("Cross-Client Portal", "Cliente 1A recibe 404 al acceder a sesión/foto de Cliente 2A (otra Org)");

      // 2.6 IDOR interno en portal: sesión propia (1A_Pub) pero fotoId ajena (1B_Pub)
      const rFotoInfiltrada = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1B_Pub.id}/contenido`,
        { headers: authC1A }
      );
      assert.equal(rFotoInfiltrada.status, 404);
      registrarPaso("Cross-Client Portal", "Solicitar sesión propia con fotoId de otro cliente retorna 404");
    }

    // =========================================================================
    // GRUPO 3: IDOR en Métodos GET/POST/PATCH/DELETE (API Freelancer)
    // =========================================================================
    {
      const authOrg1 = { Authorization: `Bearer ${tokenOrg1.token}` };

      // 3.1 Mezclar cliente1A en ruta pero sesion1B en URL
      const rIdorGetSes = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1B_Pub.id}`, {
        headers: authOrg1,
      });
      assert.equal(rIdorGetSes.status, 404);

      const rIdorPatchSes = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1B_Pub.id}`, {
        method: "PATCH",
        headers: { ...authOrg1, "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: "Nuevo nombre cruzado" }),
      });
      assert.equal(rIdorPatchSes.status, 404);

      const rIdorDelSes = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1B_Pub.id}`, {
        method: "DELETE",
        headers: authOrg1,
      });
      assert.equal(rIdorDelSes.status, 404);

      const rIdorGetFotos = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1B_Pub.id}/fotos`, {
        headers: authOrg1,
      });
      assert.equal(rIdorGetFotos.status, 404);

      const rIdorPostFoto = await subirFoto(
        tokenOrg1.token,
        cliente1A.id,
        sesion1B_Pub.id,
        crearJpegMinimo(),
        "cross.jpg",
        "image/jpeg"
      );
      assert.equal(rIdorPostFoto.status, 404);
      registrarPaso("IDOR", "Mezcla de clienteId y sesionId no perteneciente retorna 404 en GET/POST/PATCH/DELETE");

      // 3.2 Mezclar cliente1A + sesion1A pero foto1B
      const rIdorGetContenido = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1B_Pub.id}/contenido`,
        { headers: authOrg1 }
      );
      assert.equal(rIdorGetContenido.status, 404);

      const rIdorPatchFoto = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1B_Pub.id}`,
        {
          method: "PATCH",
          headers: { ...authOrg1, "Content-Type": "application/json" },
          body: JSON.stringify({ orden: 10 }),
        }
      );
      assert.equal(rIdorPatchFoto.status, 404);

      const rIdorDelFoto = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1B_Pub.id}`,
        {
          method: "DELETE",
          headers: authOrg1,
        }
      );
      assert.equal(rIdorDelFoto.status, 404);
      registrarPaso("IDOR", "Mezcla de sesionId y fotoId no perteneciente retorna 404 en GET/PATCH/DELETE");

      // 3.3 Asignar foto de otra sesión como portada (Tampering de portadaFotoId)
      const rPortadaCruzada = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}`, {
        method: "PATCH",
        headers: { ...authOrg1, "Content-Type": "application/json" },
        body: JSON.stringify({ portadaFotoId: foto1B_Pub.id }),
      });
      assert.equal(rPortadaCruzada.status, 400);
      const errPortada = await rPortadaCruzada.json();
      assert.match(errPortada.error, /no pertenece a esta sesión/i);
      registrarPaso("IDOR", "Rechazo 400 estricto al intentar asignar portada con foto de otra sesión");
    }

    // =========================================================================
    // GRUPO 4: Visibilidad y Ciclo de Vida de Borradores (BORRADOR vs PUBLICADA)
    // =========================================================================
    {
      const authC1A = { Authorization: `Bearer ${tokenClient1A.token}` };
      const authOrg1 = { Authorization: `Bearer ${tokenOrg1.token}` };

      // 4.1 Sesión 1A_Borrador oculta en listado
      const rPortalList = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, { headers: authC1A });
      const lista = (await rPortalList.json()) as any[];
      assert.ok(!lista.some((s) => s.id === sesion1A_Borrador.id));
      registrarPaso("Drafts", "Sesión en BORRADOR omitida del listado del portal");

      // 4.2 Acceso directo bloqueado
      const rDirBorr = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Borrador.id}`, { headers: authC1A });
      assert.equal(rDirBorr.status, 404);

      const rFotosBorr = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Borrador.id}/fotos`, { headers: authC1A });
      assert.equal(rFotosBorr.status, 404);

      const rStreamBorr = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Borrador.id}/fotos/${foto1A_Borrador.id}/contenido`,
        { headers: authC1A }
      );
      assert.equal(rStreamBorr.status, 404);
      registrarPaso("Drafts", "Detalle, fotos y streaming binario de borrador retornan 404 en portal");

      // 4.3 Publicación dinámica
      const rPublicar = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Borrador.id}`, {
        method: "PATCH",
        headers: { ...authOrg1, "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "PUBLICADA" }),
      });
      assert.equal(rPublicar.status, 200);

      const rVerPub = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Borrador.id}`, { headers: authC1A });
      assert.equal(rVerPub.status, 200);
      registrarPaso("Drafts", "Publicación inmediata visible en portal tras PATCH estado PUBLICADA");

      // 4.4 Despublicación dinámica a borrador
      const rDespublicar = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Borrador.id}`, {
        method: "PATCH",
        headers: { ...authOrg1, "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "BORRADOR" }),
      });
      assert.equal(rDespublicar.status, 200);

      const rVerBorradorNuevo = await fetch(`${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Borrador.id}`, { headers: authC1A });
      assert.equal(rVerBorradorNuevo.status, 404);
      registrarPaso("Drafts", "Despublicación inmediata revoca acceso en portal");

      // 4.5 Bloqueo de eliminación para sesiones publicadas (409)
      const rDelPub = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}`, {
        method: "DELETE",
        headers: authOrg1,
      });
      assert.equal(rDelPub.status, 409);
      const errDelPub = await rDelPub.json();
      assert.match(errDelPub.error, /No se puede eliminar una sesión fotográfica publicada/i);
      registrarPaso("Drafts", "Control seguro: DELETE de sesión publicada retorna 409 Conflict");
    }

    // =========================================================================
    // GRUPO 5: Acceso a Fotos Privadas por URL, Tokens y Privilegios
    // =========================================================================
    {
      // 5.1 Sin cabecera Authorization (401)
      const rNoAuthCli = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1A_Pub.id}/contenido`
      );
      assert.equal(rNoAuthCli.status, 401);

      const rNoAuthPort = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1A_Pub.id}/contenido`
      );
      assert.equal(rNoAuthPort.status, 401);
      registrarPaso("Auth & URL", "Peticiones anónimas a contenido binario retornan 401 Unauthorized");

      // 5.2 Token JWT alterado / firma no válida
      const rTokenAlterado = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1A_Pub.id}/contenido`,
        { headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.tampered_signature" } }
      );
      assert.equal(rTokenAlterado.status, 401);
      registrarPaso("Auth & URL", "Token JWT con firma alterada retorna 401");

      // 5.3 Sesión revocada en base de datos
      const sesionRevocable = await crearSesionUsuario({
        tipoAcceso: "CLIENTE",
        usuarioId: userClient1A.id,
        organizacionId: org1.id,
        clienteId: cliente1A.id,
        rolCliente: "TITULAR",
      });
      await prisma.sesion.update({
        where: { id: sesionRevocable.sesionId },
        data: { revocadaEn: new Date() },
      });
      const rRevocada = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, {
        headers: { Authorization: `Bearer ${sesionRevocable.token}` },
      });
      assert.equal(rRevocada.status, 401);
      registrarPaso("Auth & URL", "Sesión revocada en base de datos es rechazada con 401");

      // 5.4 Token de cliente intentando endpoints de organización (403)
      const rClientEscalation = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas`, {
        headers: { Authorization: `Bearer ${tokenClient1A.token}` },
      });
      assert.equal(rClientEscalation.status, 403);
      registrarPaso("Auth & URL", "Token de CLIENTE intentando /api/clientes retorna 403 Acceso restringido");

      // 5.5 Token de organización intentando endpoints de portal (403)
      const rOrgInPortal = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, {
        headers: { Authorization: `Bearer ${tokenOrg1.token}` },
      });
      assert.equal(rOrgInPortal.status, 403);
      registrarPaso("Auth & URL", "Token de ORGANIZACION intentando /api/portal retorna 403 Acceso restringido");

      // 5.6 Desactivación de Acceso de Cliente (accesoCliente.activo = false)
      await prisma.accesoCliente.updateMany({
        where: { usuarioId: userClient1A.id, clienteId: cliente1A.id },
        data: { activo: false },
      });
      const rAccesoInactivo = await fetch(`${urlApi}/api/portal/sesiones-fotograficas`, {
        headers: { Authorization: `Bearer ${tokenClient1A.token}` },
      });
      assert.equal(rAccesoInactivo.status, 403);
      // Restaurar acceso activo
      await prisma.accesoCliente.updateMany({
        where: { usuarioId: userClient1A.id, clienteId: cliente1A.id },
        data: { activo: true },
      });
      registrarPaso("Auth & URL", "AccesoCliente desactivado revoca token de portal inmediatamente (403)");

      // 5.7 Verificación de no exposición estática de archivos
      const foto1A_Db = await prisma.fotoSesion.findUnique({ where: { id: foto1A_Pub.id } });
      assert.ok(foto1A_Db);
      const rEstatico1 = await fetch(`${urlApi}/almacenamiento_privado/fotos/${foto1A_Db.almacenamientoKey}.bin`);
      assert.equal(rEstatico1.status, 404);
      const rEstatico2 = await fetch(`${urlApi}/fotos/${foto1A_Db.almacenamientoKey}.bin`);
      assert.equal(rEstatico2.status, 404);
      registrarPaso("Auth & URL", "No existe servicio estático directo hacia el directorio de almacenamiento privado (404)");
    }

    // =========================================================================
    // GRUPO 6: Path Traversal y Manipulación de Parámetros
    // =========================================================================
    {
      const authOrg1 = { Authorization: `Bearer ${tokenOrg1.token}` };
      const authC1A = { Authorization: `Bearer ${tokenClient1A.token}` };

      // 6.1 Path traversal en parámetros de ruta
      const rTrav1 = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/..%2F..%2Fetc%2Fpasswd/contenido`, {
        headers: authOrg1,
      });
      assert.ok([400, 404, 422].includes(rTrav1.status));

      const rTrav2 = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/..%2F..%2Fpackage.json/contenido`,
        { headers: authOrg1 }
      );
      assert.ok([400, 404, 422].includes(rTrav2.status));
      registrarPaso("Path Traversal", "Intento de path traversal en parámetros de ruta bloqueado (400/404/422)");

      // 6.2 Traversal en parámetro query 'variante'
      const rTravQueryOrg = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1A_Pub.id}/contenido?variante=..%2F..%2Fpackage.json`,
        { headers: authOrg1 }
      );
      assert.equal(rTravQueryOrg.status, 200); // Sirve la foto original de forma segura, no navega al archivo del sistema
      const rTravQueryPort = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${foto1A_Pub.id}/contenido?variante=..%2F..%2Fetc%2Fpasswd`,
        { headers: authC1A }
      );
      assert.equal(rTravQueryPort.status, 200); // Sirve la foto original de forma segura
      registrarPaso("Path Traversal", "Parámetro query 'variante' normalizado de forma segura sin path traversal");

      // 6.3 Traversal en nombre de archivo subido
      const upTravName = await subirFoto(
        tokenOrg1.token,
        cliente1A.id,
        sesion1A_Pub.id,
        crearJpegMinimo(),
        "../../../../etc/passwd.jpg",
        "image/jpeg"
      );
      assert.equal(upTravName.status, 201);
      const fotoTrav = upTravName.data;
      // Verificar que el archivo en disco no usó el nombre del cliente sino un UUID puro
      const rutaReal = resolverRutaSegura(fotoTrav.id ? (await prisma.fotoSesion.findUnique({ where: { id: fotoTrav.id } }))!.almacenamientoKey : "");
      assert.ok(fs.existsSync(rutaReal));
      assert.ok(path.dirname(rutaReal) === path.resolve(process.cwd(), "./almacenamiento_privado/fotos_test"));
      registrarPaso("Path Traversal", "Nombres de archivo con traversal guardados exclusivamente como {UUID}.bin");

      // 6.4 Prueba unitaria de resolverRutaSegura y validarClaveAlmacenamiento
      assert.throws(() => validarClaveAlmacenamiento("../../malicioso"), /Identificador de almacenamiento inválido/);
      assert.throws(() => resolverRutaSegura("no-es-uuid"), /Identificador de almacenamiento inválido/);
      assert.throws(() => resolverRutaSegura("550e8400-e29b-41d4-a716-446655440000/../../etc"), /Identificador de almacenamiento inválido/);
      registrarPaso("Path Traversal", "validarClaveAlmacenamiento y resolverRutaSegura aíslan contra cualquier clave no-UUID");
    }

    // =========================================================================
    // GRUPO 7: Validación de MIME Real, Magic Bytes y Tipos Permitidos
    // =========================================================================
    {
      // 7.1 Archivo de texto/PHP con extensión .jpg
      const fakeJpeg = Buffer.from("<?php system($_GET['cmd']); ?>");
      const upFakeJpeg = await subirFoto(tokenOrg1.token, cliente1A.id, sesion1A_Pub.id, fakeJpeg, "script.jpg", "image/jpeg");
      assert.equal(upFakeJpeg.status, 415);
      registrarPaso("MIME Validation", "Rechazo 415 al subir script PHP disfrazado con cabecera image/jpeg");

      // 7.2 Ejecutable PE Windows con extensión .png
      const fakeExe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const upFakeExe = await subirFoto(tokenOrg1.token, cliente1A.id, sesion1A_Pub.id, fakeExe, "malware.png", "image/png");
      assert.equal(upFakeExe.status, 415);
      registrarPaso("MIME Validation", "Rechazo 415 al subir binario ejecutable PE con cabecera image/png");

      // 7.3 Archivo SVG (no permitido para evitar XSS persistente)
      const fakeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const upSvg = await subirFoto(tokenOrg1.token, cliente1A.id, sesion1A_Pub.id, fakeSvg, "xss.svg", "image/svg+xml");
      assert.equal(upSvg.status, 415);
      registrarPaso("MIME Validation", "Rechazo 415 al subir SVG con scripts (formato SVG no admitido en allowlist)");

      // 7.4 Archivo vacío (0 bytes)
      const upVacio = await subirFoto(tokenOrg1.token, cliente1A.id, sesion1A_Pub.id, Buffer.alloc(0), "vacio.jpg", "image/jpeg");
      assert.equal(upVacio.status, 400);
      registrarPaso("MIME Validation", "Rechazo 400 al subir archivo vacío");

      // 7.5 Archivo corrupto o bytes aleatorios
      const upRandom = await subirFoto(tokenOrg1.token, cliente1A.id, sesion1A_Pub.id, Buffer.from("0123456789abcdef"), "corrupt.jpg", "image/jpeg");
      assert.equal(upRandom.status, 415);
      registrarPaso("MIME Validation", "Rechazo 415 al subir bytes aleatorios o cabecera no reconocida");
    }

    // =========================================================================
    // GRUPO 8: Límite de Tamaño (Max Bytes) y Limpieza de Basura Temporal
    // =========================================================================
    {
      const maxBytesOrig = process.env.ALMACENAMIENTO_MAX_BYTES;
      try {
        // Configuramos límite pequeño para prueba: 1000 bytes
        process.env.ALMACENAMIENTO_MAX_BYTES = "1000";

        // Buffer que supera el límite (ej. 2000 bytes) con cabecera JPEG válida
        const bigJpeg = Buffer.concat([crearJpegMinimo(), Buffer.alloc(2000)]);
        const upExceso = await subirFoto(tokenOrg1.token, cliente1A.id, sesion1A_Pub.id, bigJpeg, "pesado.jpg", "image/jpeg");
        assert.equal(upExceso.status, 413);

        // Verificar que ningún archivo temporal `temp_*.tmp` quede huérfano en el directorio
        const archivosEnDir = fs.readdirSync(dirFotosTest);
        const temporalesHuerfanos = archivosEnDir.filter((f) => f.startsWith("temp_") && f.endsWith(".tmp"));
        assert.equal(temporalesHuerfanos.length, 0, "No deben quedar temporales huérfanos tras un error 413");
        registrarPaso("Size Limit", "Rechazo 413 por exceder tamaño máximo y limpieza transaccional de temporales en disco");
      } finally {
        if (maxBytesOrig !== undefined) process.env.ALMACENAMIENTO_MAX_BYTES = maxBytesOrig;
        else delete process.env.ALMACENAMIENTO_MAX_BYTES;
      }
    }

    // =========================================================================
    // GRUPO 9: Archivos Maliciosos Inertes, Polyglots y Cabeceras de Seguridad
    // =========================================================================
    {
      // Polyglot GIF inerte: inicia con GIF89a válido y contiene payload HTML/JS benigno
      const polyglotGif = Buffer.concat([
        crearGifMinimo(),
        Buffer.from("/* <script>console.log('inert_xss_test');</script> */"),
      ]);

      const upPolyglot = await subirFoto(
        tokenOrg1.token,
        cliente1A.id,
        sesion1A_Pub.id,
        polyglotGif,
        "polyglot_inert.gif",
        "image/gif"
      );
      assert.equal(upPolyglot.status, 201);
      const fotoPoly = upPolyglot.data;

      // Descargar via portal y verificar cabeceras protectoras
      const resStream = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Pub.id}/fotos/${fotoPoly.id}/contenido`,
        { headers: { Authorization: `Bearer ${tokenClient1A.token}` } }
      );
      assert.equal(resStream.status, 200);
      assert.equal(resStream.headers.get("content-type"), "image/gif");
      // Cabecera nosniff de Helmet
      assert.equal(resStream.headers.get("x-content-type-options"), "nosniff");
      // Cache-control privado
      assert.match(resStream.headers.get("cache-control") || "", /private/);
      // Content-Disposition con encodeURIComponent
      assert.match(resStream.headers.get("content-disposition") || "", /inline; filename=/);
      registrarPaso("Security Headers", "Streaming de imagen aplica X-Content-Type-Options: nosniff y Cache-Control seguro");
    }

    // =========================================================================
    // GRUPO 10: Paginación y Robustez ante Parámetros Anómalos
    // =========================================================================
    {
      const authOrg1 = { Authorization: `Bearer ${tokenOrg1.token}` };
      const authC1A = { Authorization: `Bearer ${tokenClient1A.token}` };

      // 10.1 Paginación estándar
      const rP1 = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos?pagina=1&limite=2`,
        { headers: authOrg1 }
      );
      assert.equal(rP1.status, 200);
      const dP1 = await rP1.json();
      assert.equal(dP1.pagina, 1);
      assert.equal(dP1.limite, 2);
      assert.ok(dP1.items.length <= 2);

      // 10.2 Parámetros cero y negativos
      const rPZero = await fetch(
        `${urlApi}/api/clientes/${cliente1A.id}/sesiones-fotograficas/${sesion1A_Pub.id}/fotos?pagina=0&limite=0`,
        { headers: authOrg1 }
      );
      assert.equal(rPZero.status, 200);
      const dPZero = await rPZero.json();
      assert.equal(dPZero.pagina, 1, "Página 0 coerced a 1");
      assert.equal(dPZero.limite, 20, "Límite 0 cae al valor por defecto 20 debido a evaluación falsy");

      const rPNeg = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Pub.id}/fotos?pagina=-5&limite=-10`,
        { headers: authC1A }
      );
      assert.equal(rPNeg.status, 200);
      const dPNeg = await rPNeg.json();
      assert.equal(dPNeg.pagina, 1);
      assert.equal(dPNeg.limite, 1, "Límite negativo -10 acotado por Math.max a 1");

      // 10.3 Límite excesivo (acotamiento a 100)
      const rPMax = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Pub.id}/fotos?pagina=1&limite=5000`,
        { headers: authC1A }
      );
      assert.equal(rPMax.status, 200);
      const dPMax = await rPMax.json();
      assert.equal(dPMax.limite, 100, "Límite mayor a 100 coerced a 100");

      // 10.4 Parámetros no numéricos
      const rPNaN = await fetch(
        `${urlApi}/api/portal/sesiones-fotograficas/${sesion1A_Pub.id}/fotos?pagina=inyeccion&limite=xyz`,
        { headers: authC1A }
      );
      assert.equal(rPNaN.status, 200);
      const dPNaN = await rPNaN.json();
      assert.equal(dPNaN.pagina, 1);
      assert.equal(dPNaN.limite, 20);
      registrarPaso("Pagination", "Paginación maneja con seguridad y acota valores negativos, cero, excesivos y no numéricos");
    }

    // =========================================================================
    // GRUPO 11: Permisos de Invitaciones
    // =========================================================================
    {
      // 11.1 Cliente intentando invitar a otro usuario
      const rCliInvita = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/invitaciones`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenClient1A.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ correo: "otro@amigo.test" }),
      });
      assert.equal(rCliInvita.status, 403);
      registrarPaso("Invitations", "Cliente no puede emitir invitaciones (403 Acceso restringido a miembros de organización)");

      // 11.2 Crear invitación legítima desde Org 1 y probar aceptar con expiración
      const rInvLegitima = await fetch(`${urlApi}/api/clientes/${cliente1A.id}/invitaciones`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenOrg1.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ correo: "invitado@expirado.test" }),
      });
      assert.equal(rInvLegitima.status, 201);
      const invCreada = await rInvLegitima.json();
      const idInvitacion = invCreada.invitacion?.id || invCreada.id;

      // Forzar expiración en base de datos
      await prisma.invitacionCliente.update({
        where: { id: idInvitacion },
        data: { expiraEn: new Date(Date.now() - 3600000) },
      });

      // El token plano está en invCreada.enlaceInvitacion
      // Buscamos el tokenHash en DB
      const invDb = await prisma.invitacionCliente.findUnique({ where: { id: idInvitacion } });
      assert.ok(invDb);

      // Intentar consultar invitación expirada
      // Nota: la ruta es GET /api/invitaciones/:token, pero no tenemos el token plano a menos que lo extraigamos del enlace
      if (invCreada.enlaceInvitacion) {
        const tokenMatch = invCreada.enlaceInvitacion.match(/([a-f0-9]{32,})/i);
        if (tokenMatch) {
          const tokenPlano = tokenMatch[1];
          const rConsultaExp = await fetch(`${urlApi}/api/invitaciones/${tokenPlano}`);
          assert.equal(rConsultaExp.status, 410);

          const rAceptarExp = await fetch(`${urlApi}/api/invitaciones/${tokenPlano}/aceptar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre: "Test", contrasena: "Password123!" }),
          });
          assert.equal(rAceptarExp.status, 410);
          registrarPaso("Invitations", "Invitación expirada retorna 410 en consulta y aceptación");
        }
      }
    }

    // =========================================================================
    // GRUPO 12: Hallazgo de Auditoría: Eliminación en Cascada de Cliente vs Archivos en Disco
    // =========================================================================
    {
      const authOrg1 = { Authorization: `Bearer ${tokenOrg1.token}` };

      // Creamos un cliente auxiliar con una sesión y una foto en disco
      const clienteVictima = await prisma.cliente.create({
        data: {
          organizacionId: org1.id,
          nombre: "Cliente Para Prueba Cascada",
        },
      });

      const sesionVictima = await prisma.sesionFotografica.create({
        data: {
          organizacionId: org1.id,
          clienteId: clienteVictima.id,
          nombre: "Sesión Victima Cascada",
          estado: "PUBLICADA",
        },
      });

      const upVictima = await subirFoto(
        tokenOrg1.token,
        clienteVictima.id,
        sesionVictima.id,
        crearJpegMinimo(),
        "foto_victima.jpg",
        "image/jpeg",
        0,
        true
      );
      assert.equal(upVictima.status, 201);
      const fotoVictimaDb = await prisma.fotoSesion.findUnique({ where: { id: upVictima.data.id } });
      assert.ok(fotoVictimaDb);
      const rutaArchivoVictima = resolverRutaSegura(fotoVictimaDb.almacenamientoKey);
      assert.ok(fs.existsSync(rutaArchivoVictima), "El archivo binario existe en disco antes de borrar cliente");

      // Ahora intentamos eliminar el cliente: DELETE /api/clientes/:clienteVictima.id
      // SEC-FOTO-01 remediado: debe bloquearse con 409 cuando hay sesiones fotográficas asociadas.
      const rDelCli = await fetch(`${urlApi}/api/clientes/${clienteVictima.id}`, {
        method: "DELETE",
        headers: authOrg1,
      });
      assert.equal(rDelCli.status, 409);

      // Verificamos el estado en Base de Datos y Disco: nada fue borrado ni quedó huérfano
      const sesionEnDb = await prisma.sesionFotografica.findUnique({ where: { id: sesionVictima.id } });
      assert.ok(sesionEnDb, "La sesión no debe borrarse cuando el cliente tiene sesiones fotográficas");
      const fotoEnDb = await prisma.fotoSesion.findUnique({ where: { id: fotoVictimaDb.id } });
      assert.ok(fotoEnDb, "El registro de foto debe permanecer intacto");
      assert.equal(fs.existsSync(rutaArchivoVictima), true, "El archivo binario debe permanecer intacto en disco");

      // Limpieza manual del archivo de prueba para no dejar residuos en disco
      if (fs.existsSync(rutaArchivoVictima)) {
        await fs.promises.unlink(rutaArchivoVictima);
      }

      registrarPaso("Audit Finding Remediado", "Confirmado bloqueo 409 al borrar Cliente con sesiones fotográficas (SEC-FOTO-01)");
    }

    console.log(`\n============================================================`);
    console.log(` AUDITORÍA DE SEGURIDAD FINALIZADA CON ÉXITO: ${totalPruebas} PRUEBAS PASADAS`);
    console.log(`============================================================\n`);
  } finally {
    if (servidor) {
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
    }
  }
}

if (process.argv[1]?.includes("casos-auditoria-seguridad-fotografia")) {
  ejecutarAuditoria().catch((err) => {
    console.error("[auditoria] ERROR EN LA EJECUCIÓN:", err);
    process.exit(1);
  });
}
