import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";
import type { ContextoSinSesion } from "../src/tipos.js";
import { almacenArchivos } from "../src/almacenamiento/archivos.js";

async function main() {
  const db: Array<{ nombre: string }> = await prisma.$queryRaw`SELECT current_database() AS nombre`;
  assert.equal(db[0]?.nombre, "equinox_issue11_test");
  assert.ok(process.env.EQUINOX_ARCHIVOS_DIR?.includes("equinox-issue11-"));
  const server = createServer(aplicacion);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  async function token(contexto: ContextoSinSesion) {
    const id = randomUUID(); const firmado = firmarToken(contexto, id);
    await prisma.sesion.create({ data: { id, usuarioId: contexto.usuarioId, tokenHash: hashToken(firmado.token), expiraEn: firmado.expiraEn } });
    return firmado.token;
  }
  async function pedir(ruta: string, credencial: string, metodo = "GET", body?: BodyInit) {
    return fetch(origin + ruta, { method: metodo, headers: { Authorization: `Bearer ${credencial}` }, body });
  }
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF", "utf8");
  const formulario = (visibilidad: string, contenido: Buffer = pdf, nombre = "entregable.pdf", mime = "application/pdf") => {
    const datos = new FormData(); datos.set("archivo", new File([Uint8Array.from(contenido).buffer], nombre, { type: mime })); datos.set("visibilidad", visibilidad); return datos;
  };
  try {
    const [dueno, externo, usuarioCliente] = await Promise.all([
      prisma.usuario.create({ data: { correo: "dueno11@example.test", nombre: "Dueño", contrasenaHash: "fixture" } }),
      prisma.usuario.create({ data: { correo: "externo11@example.test", nombre: "Externo", contrasenaHash: "fixture" } }),
      prisma.usuario.create({ data: { correo: "cliente11@example.test", nombre: "Cliente", contrasenaHash: "fixture" } }),
    ]);
    const [orgA, orgB] = await Promise.all([
      prisma.organizacion.create({ data: { nombre: "A", slug: "issue11-a" } }),
      prisma.organizacion.create({ data: { nombre: "B", slug: "issue11-b" } }),
    ]);
    await prisma.miembroOrganizacion.createMany({ data: [
      { usuarioId: dueno.id, organizacionId: orgA.id, rol: "PROPIETARIO" },
      { usuarioId: externo.id, organizacionId: orgB.id, rol: "PROPIETARIO" },
    ] });
    const [clienteA, clienteB, otroClienteA] = await Promise.all([
      prisma.cliente.create({ data: { organizacionId: orgA.id, nombre: "Cliente A" } }),
      prisma.cliente.create({ data: { organizacionId: orgB.id, nombre: "Cliente B" } }),
      prisma.cliente.create({ data: { organizacionId: orgA.id, nombre: "Otro cliente A" } }),
    ]);
    await prisma.accesoCliente.createMany({ data: [
      { organizacionId: orgA.id, clienteId: clienteA.id, usuarioId: usuarioCliente.id },
      { organizacionId: orgA.id, clienteId: otroClienteA.id, usuarioId: usuarioCliente.id },
    ] });
    const [proyectoA, proyectoB] = await Promise.all([
      prisma.proyecto.create({ data: { organizacionId: orgA.id, clienteId: clienteA.id, creadoPorId: dueno.id, nombre: "Proyecto A" } }),
      prisma.proyecto.create({ data: { organizacionId: orgB.id, clienteId: clienteB.id, creadoPorId: externo.id, nombre: "Proyecto B" } }),
    ]);
    const propio = await token({ tipoAcceso: "ORGANIZACION", usuarioId: dueno.id, organizacionId: orgA.id, rolOrganizacion: "PROPIETARIO" });
    const ajeno = await token({ tipoAcceso: "ORGANIZACION", usuarioId: externo.id, organizacionId: orgB.id, rolOrganizacion: "PROPIETARIO" });
    const cliente = await token({ tipoAcceso: "CLIENTE", usuarioId: usuarioCliente.id, organizacionId: orgA.id, clienteId: clienteA.id, rolCliente: "TITULAR" });
    const otroContexto = await token({ tipoAcceso: "CLIENTE", usuarioId: usuarioCliente.id, organizacionId: orgA.id, clienteId: otroClienteA.id, rolCliente: "TITULAR" });
    const ruta = `/api/proyectos/${proyectoA.id}/archivos`;
    assert.equal((await pedir(ruta, propio, "POST", JSON.stringify({ url: "https://example.test/externo" }))).status, 415);
    assert.equal((await pedir(ruta, cliente, "POST", formulario("CLIENTE"))).status, 403);
    assert.equal((await pedir(`/api/proyectos/${proyectoB.id}/archivos`, propio, "POST", formulario("CLIENTE"))).status, 404);
    assert.equal((await pedir(ruta, propio, "POST", formulario("CLIENTE", Buffer.from("<svg>"), "imagen.png", "image/png"))).status, 422);
    assert.equal((await pedir(ruta, propio, "POST", formulario("CLIENTE", Buffer.from("script"), "archivo.js", "text/javascript"))).status, 422);
    assert.equal((await readdir(process.env.EQUINOX_ARCHIVOS_DIR!)).length, 0);
    const transaccionOriginal = prisma.$transaction.bind(prisma);
    (prisma as any).$transaction = async () => { throw new Error("Fallo ficticio de metadata"); };
    try { assert.equal((await pedir(ruta, propio, "POST", formulario("CLIENTE"))).status, 500); }
    finally { (prisma as any).$transaction = transaccionOriginal; }
    assert.equal((await readdir(process.env.EQUINOX_ARCHIVOS_DIR!)).length, 0);
    assert.equal(await prisma.archivo.count(), 0);
    const compartidoRespuesta = await pedir(ruta, propio, "POST", formulario("CLIENTE"));
    assert.equal(compartidoRespuesta.status, 201);
    const compartido = await compartidoRespuesta.json() as { id: string; url?: string; nombreOriginal: string };
    assert.equal(compartido.url, undefined);
    const internoRespuesta = await pedir(ruta, propio, "POST", formulario("INTERNA"));
    assert.equal(internoRespuesta.status, 201);
    const interno = await internoRespuesta.json() as { id: string };
    assert.equal(await prisma.archivo.count({ where: { proyectoId: proyectoA.id } }), 2);
    assert.equal((await readdir(process.env.EQUINOX_ARCHIVOS_DIR!)).length, 2);
    assert.equal((await pedir(`/api/proyectos/${proyectoA.id}`, propio, "DELETE")).status, 409);
    const portal = `/api/portal/proyectos/${proyectoA.id}/archivos`;
    const lista = await (await pedir(portal, cliente)).json() as Array<{ id: string; url?: string }>;
    assert.deepEqual(lista.map((archivo) => archivo.id), [compartido.id]);
    assert.equal(lista[0].url, undefined);
    const descarga = await pedir(`${portal}/${compartido.id}/descargar`, cliente);
    assert.equal(descarga.status, 200);
    assert.equal(descarga.headers.get("content-disposition")?.startsWith("attachment;"), true);
    assert.deepEqual(Buffer.from(await descarga.arrayBuffer()), pdf);
    assert.equal((await fetch(`${origin}${portal}/${compartido.id}/descargar`)).status, 401);
    assert.equal((await pedir(`${portal}/${interno.id}/descargar`, cliente)).status, 404);
    assert.equal((await pedir(`${portal}/${compartido.id}/descargar`, otroContexto)).status, 404);
    assert.equal((await pedir(`/api/portal/proyectos/${proyectoB.id}/archivos/${compartido.id}/descargar`, cliente)).status, 404);
    assert.equal((await pedir(`${ruta}/${compartido.id}/descargar`, ajeno)).status, 404);
    assert.equal((await pedir(`${ruta}/${compartido.id}`, ajeno, "DELETE")).status, 404);
    const eliminarOriginal = prisma.archivo.delete.bind(prisma.archivo);
    (prisma.archivo as any).delete = async () => { throw new Error("Fallo ficticio al eliminar metadata"); };
    try { assert.equal((await pedir(`${ruta}/${compartido.id}`, propio, "DELETE")).status, 500); }
    finally { (prisma.archivo as any).delete = eliminarOriginal; }
    assert.equal(await prisma.archivo.count({ where: { proyectoId: proyectoA.id } }), 2);
    assert.equal((await readdir(process.env.EQUINOX_ARCHIVOS_DIR!)).length, 2);
    assert.equal((await pedir(`${portal}/${compartido.id}/descargar`, cliente)).status, 200);
    const apartarOriginal = almacenArchivos.apartar.bind(almacenArchivos);
    (almacenArchivos as any).apartar = async (clave: string) => {
      const etapa = await apartarOriginal(clave);
      return { restaurar: etapa.restaurar, confirmar: async () => { throw new Error("Fallo ficticio al limpiar almacenamiento"); } };
    };
    try { assert.equal((await pedir(`${ruta}/${compartido.id}`, propio, "DELETE")).status, 500); }
    finally { (almacenArchivos as any).apartar = apartarOriginal; }
    assert.equal(await prisma.archivo.count({ where: { proyectoId: proyectoA.id } }), 2);
    assert.equal((await readdir(process.env.EQUINOX_ARCHIVOS_DIR!)).length, 2);
    assert.equal((await pedir(`${portal}/${compartido.id}/descargar`, cliente)).status, 200);
    assert.equal((await pedir(`${ruta}/${compartido.id}`, propio, "DELETE")).status, 204);
    assert.equal((await pedir(`${ruta}/${interno.id}`, propio, "DELETE")).status, 204);
    assert.equal(await prisma.archivo.count({ where: { proyectoId: proyectoA.id } }), 0);
    assert.equal((await readdir(process.env.EQUINOX_ARCHIVOS_DIR!)).length, 0);
    console.log("[issue11] Carga, persistencia, descarga, permisos y eliminación: OK");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}
main().catch(() => { console.error("[issue11] Falló la integración aislada"); process.exitCode = 1; });
