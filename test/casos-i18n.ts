import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { aplicacion } from "../src/aplicacion.js";
import { prisma } from "../src/prisma.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";
import { CATALOGO_ES } from "../frontend/src/i18n/es.js";
import { CATALOGO_EN } from "../frontend/src/i18n/en.js";
import { CATALOGO_PT } from "../frontend/src/i18n/pt.js";
import { METADATA_IDIOMAS, normalizarIdioma } from "../frontend/src/i18n/i18n.types.js";

async function peticion(
  baseUrl: string,
  ruta: string,
  opciones: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (opciones.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opciones.token) {
    headers["Authorization"] = `Bearer ${opciones.token}`;
  }

  const res = await fetch(`${baseUrl}${ruta}`, {
    method: opciones.method || "GET",
    headers,
    body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
  });

  const texto = await res.text();
  let data: any = null;
  try {
    data = texto ? JSON.parse(texto) : null;
  } catch {
    data = texto;
  }
  return { status: res.status, data };
}

async function crearSesionParaUsuario(
  usuarioId: string,
  contexto:
    | { tipoAcceso: "ORGANIZACION"; organizacionId: string; rolOrganizacion: "PROPIETARIO" | "COLABORADOR" }
    | { tipoAcceso: "CLIENTE"; organizacionId: string; clienteId: string; rolCliente: "TITULAR" | "COLABORADOR" }
): Promise<string> {
  const sesionId = randomUUID();
  const { token, expiraEn } = firmarToken({ ...contexto, usuarioId }, sesionId);
  await prisma.sesion.create({
    data: {
      id: sesionId,
      usuarioId,
      tokenHash: hashToken(token),
      tipoAcceso: contexto.tipoAcceso,
      expiraEn,
    },
  });
  return token;
}

async function ejecutar() {
  const servidor = http.createServer(aplicacion);
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", () => resolve()));
  const { port } = servidor.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    console.log("[i18n-test] 1. Verificando catálogos base es/en/pt y paridad de claves...");
    const clavesEs = Object.keys(CATALOGO_ES);
    assert.ok(clavesEs.length > 15, "El catálogo base 'es' debe contener claves");
    for (const clave of clavesEs) {
      assert.ok(CATALOGO_EN[clave]?.trim(), `Falta traducción 'en' para clave '${clave}'`);
      assert.ok(CATALOGO_PT[clave]?.trim(), `Falta traducción 'pt' para clave '${clave}'`);
    }
    assert.equal(normalizarIdioma("pt-BR"), "pt");
    assert.equal(normalizarIdioma("en-US"), "en");
    assert.equal(normalizarIdioma("fr-FR", "es"), "es");

    console.log("[i18n-test] 2. Verificando formatos Intl (fecha, número, moneda)...");
    const fechaMuestra = new Date("2026-11-23T15:30:00Z");
    const fmtEs = new Intl.DateTimeFormat(METADATA_IDIOMAS.es.bcp47, { dateStyle: "medium" }).format(fechaMuestra);
    const fmtEn = new Intl.DateTimeFormat(METADATA_IDIOMAS.en.bcp47, { dateStyle: "medium" }).format(fechaMuestra);
    const fmtPt = new Intl.DateTimeFormat(METADATA_IDIOMAS.pt.bcp47, { dateStyle: "medium" }).format(fechaMuestra);
    assert.ok(fmtEs && fmtEn && fmtPt);
    const numPt = new Intl.NumberFormat(METADATA_IDIOMAS.pt.bcp47).format(1234.56);
    const numEn = new Intl.NumberFormat(METADATA_IDIOMAS.en.bcp47).format(1234.56);
    assert.notEqual(numPt, numEn, "Formato numérico pt-BR y en-US deben diferir");
    const monEn = new Intl.NumberFormat(METADATA_IDIOMAS.en.bcp47, {
      style: "currency",
      currency: "USD",
    }).format(1500.5);
    assert.ok(monEn.includes("1,500.50"));

    console.log("[i18n-test] 3. Creando usuarios y organizaciones de prueba en DB temporal...");
    const hash = await bcrypt.hash("ClaveSegura123!", 4);
    const orgA = await prisma.organizacion.create({
      data: { nombre: "Estudio A", slug: `estudio-a-${Date.now()}` },
    });
    const orgB = await prisma.organizacion.create({
      data: { nombre: "Estudio B", slug: `estudio-b-${Date.now()}` },
    });

    const userAProp = await prisma.usuario.create({
      data: { correo: "prop-a@equinox.test", contrasenaHash: hash, nombre: "Ana" },
    });
    const userBColab = await prisma.usuario.create({
      data: { correo: "colab-b@equinox.test", contrasenaHash: hash, nombre: "Bruno" },
    });
    const userCCliente = await prisma.usuario.create({
      data: { correo: "cliente-c@equinox.test", contrasenaHash: hash, nombre: "Carla" },
    });
    const userDTenant2 = await prisma.usuario.create({
      data: { correo: "prop-d@equinox.test", contrasenaHash: hash, nombre: "Diego" },
    });

    // Verificar valor por defecto 'es' en migración
    assert.equal(userAProp.idioma, "es");
    assert.equal(userBColab.idioma, "es");

    await prisma.miembroOrganizacion.createMany({
      data: [
        { usuarioId: userAProp.id, organizacionId: orgA.id, rol: "PROPIETARIO" },
        { usuarioId: userBColab.id, organizacionId: orgA.id, rol: "COLABORADOR" },
        { usuarioId: userDTenant2.id, organizacionId: orgB.id, rol: "PROPIETARIO" },
      ],
    });

    const clienteOrgA = await prisma.cliente.create({
      data: { organizacionId: orgA.id, nombre: "Cliente Portal", correo: "cliente-c@equinox.test" },
    });
    await prisma.accesoCliente.create({
      data: {
        usuarioId: userCCliente.id,
        organizacionId: orgA.id,
        clienteId: clienteOrgA.id,
        rol: "TITULAR",
      },
    });

    const tokenA = await crearSesionParaUsuario(userAProp.id, {
      tipoAcceso: "ORGANIZACION",
      organizacionId: orgA.id,
      rolOrganizacion: "PROPIETARIO",
    });
    const tokenB = await crearSesionParaUsuario(userBColab.id, {
      tipoAcceso: "ORGANIZACION",
      organizacionId: orgA.id,
      rolOrganizacion: "COLABORADOR",
    });
    const tokenC = await crearSesionParaUsuario(userCCliente.id, {
      tipoAcceso: "CLIENTE",
      organizacionId: orgA.id,
      clienteId: clienteOrgA.id,
      rolCliente: "TITULAR",
    });
    const tokenD = await crearSesionParaUsuario(userDTenant2.id, {
      tipoAcceso: "ORGANIZACION",
      organizacionId: orgB.id,
      rolOrganizacion: "PROPIETARIO",
    });

    console.log("[i18n-test] 4. Probando autorización y validación de endpoints /api/perfil...");
    const sinAuthGet = await peticion(baseUrl, "/api/perfil/preferencias");
    assert.equal(sinAuthGet.status, 401);
    const sinAuthPut = await peticion(baseUrl, "/api/perfil/idioma", {
      method: "PUT",
      body: { idioma: "en" },
    });
    assert.equal(sinAuthPut.status, 401);

    const invalido = await peticion(baseUrl, "/api/perfil/idioma", {
      method: "PUT",
      token: tokenB,
      body: { idioma: "fr" },
    });
    assert.equal(invalido.status, 422);

    console.log("[i18n-test] 5. Probando cambio de idioma individual (A/B/C/D) e idempotencia...");
    // User A (PROPIETARIO) -> 'en' (idempotente dos veces)
    const putA1 = await peticion(baseUrl, "/api/perfil/idioma", {
      method: "PUT",
      token: tokenA,
      body: { idioma: "en" },
    });
    assert.equal(putA1.status, 200);
    assert.equal(putA1.data.idioma, "en");

    const putA2 = await peticion(baseUrl, "/api/perfil/idioma", {
      method: "PUT",
      token: tokenA,
      body: { idioma: "en" },
    });
    assert.equal(putA2.status, 200);
    assert.equal(putA2.data.idioma, "en");

    // User B (COLABORADOR sin privilegio de propietario) -> 'pt'
    const patchB = await peticion(baseUrl, "/api/perfil/idioma", {
      method: "PATCH",
      token: tokenB,
      body: { idioma: "pt" },
    });
    assert.equal(patchB.status, 200);
    assert.equal(patchB.data.idioma, "pt");

    // User C (CLIENTE en portal) -> 'en'
    const patchC = await peticion(baseUrl, "/api/perfil/preferencias", {
      method: "PATCH",
      token: tokenC,
      body: { idioma: "en" },
    });
    assert.equal(patchC.status, 200);
    assert.equal(patchC.data.idioma, "en");

    // Verificar aislamiento en /api/autenticacion/yo para A, B, C y D
    const yoA = await peticion(baseUrl, "/api/autenticacion/yo", { token: tokenA });
    const yoB = await peticion(baseUrl, "/api/autenticacion/yo", { token: tokenB });
    const yoC = await peticion(baseUrl, "/api/autenticacion/yo", { token: tokenC });
    const yoD = await peticion(baseUrl, "/api/autenticacion/yo", { token: tokenD });

    assert.equal(yoA.status, 200);
    assert.equal(yoA.data.usuario.idioma, "en");
    assert.equal(yoB.data.usuario.idioma, "pt");
    assert.equal(yoC.data.usuario.idioma, "en");
    assert.equal(yoD.data.usuario.idioma, "es", "Tenant 2 no debe verse afectado por cambios en Tenant 1");

    console.log("[i18n-test] Todos los casos i18n pasaron correctamente.");
  } finally {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
    await prisma.$disconnect();
  }
}

ejecutar().catch((err) => {
  console.error("[i18n-test] Fallo:", err);
  process.exit(1);
});
