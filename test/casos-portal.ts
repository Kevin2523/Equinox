import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";
import type { ContextoSinSesion } from "../src/tipos.js";

async function verificarBase() {
  const actual: Array<{ nombre: string }> = await prisma.$queryRaw`SELECT current_database() AS nombre`;
  assert.equal(actual[0]?.nombre, "equinox_issue5_test");
}

async function ejecutar() {
  await verificarBase();
  const servidor = createServer(aplicacion);
  let base = "";
  await new Promise<void>(resolver => servidor.listen(0, "127.0.0.1", () => {
    const direccion = servidor.address();
    if (direccion && typeof direccion !== "string") base = `http://127.0.0.1:${direccion.port}`;
    resolver();
  }));
  let cuenta = 0;
  async function caso(nombre: string, prueba: () => Promise<void>) {
    await prueba();
    cuenta++;
    console.log(`[portal] Caso ${cuenta} OK: ${nombre}`);
  }
  async function sesion(contexto: ContextoSinSesion) {
    const id = randomUUID();
    const firmado = firmarToken(contexto, id);
    await prisma.sesion.create({ data: { id, usuarioId: contexto.usuarioId, tokenHash: hashToken(firmado.token), expiraEn: firmado.expiraEn } });
    return { token: firmado.token, id };
  }
  async function pedir(ruta: string, token?: string, metodo = "GET", cuerpo?: object) {
    const respuesta = await fetch(`${base}${ruta}`, { method: metodo,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
    return { status: respuesta.status, datos: await respuesta.json() as any };
  }
  try {
    const propietario = await prisma.usuario.create({ data: { correo: "propietario.portal@example.test", nombre: "Propietario", contrasenaHash: "solo-fixture" } });
    const colaborador = await prisma.usuario.create({ data: { correo: "colaborador.portal@example.test", nombre: "Colaborador", contrasenaHash: "solo-fixture" } });
    const usuarioA = await prisma.usuario.create({ data: { correo: "cliente.a@example.test", nombre: "Cliente A", contrasenaHash: "solo-fixture" } });
    const usuarioB = await prisma.usuario.create({ data: { correo: "cliente.b@example.test", nombre: "Cliente B", contrasenaHash: "solo-fixture" } });
    const org = await prisma.organizacion.create({ data: { nombre: "Estudio de prueba", slug: "portal-issue5", logoUrl: "https://example.test/logo.svg" } });
    const orgAjena = await prisma.organizacion.create({ data: { nombre: "Otra organización", slug: "portal-issue5-ajena" } });
    await prisma.miembroOrganizacion.createMany({ data: [
      { usuarioId: propietario.id, organizacionId: org.id, rol: "PROPIETARIO" },
      { usuarioId: colaborador.id, organizacionId: org.id, rol: "COLABORADOR" },
    ] });
    const clienteA = await prisma.cliente.create({ data: { organizacionId: org.id, nombre: "Ficha A", empresa: "Empresa A", notasInternas: "dato interno A" } });
    const clienteB = await prisma.cliente.create({ data: { organizacionId: org.id, nombre: "Ficha B", empresa: "Empresa B", notasInternas: "dato interno B" } });
    const clienteAjeno = await prisma.cliente.create({ data: { organizacionId: orgAjena.id, nombre: "Ficha ajena" } });
    const accesoA = await prisma.accesoCliente.create({ data: { usuarioId: usuarioA.id, clienteId: clienteA.id, organizacionId: org.id, activo: true } });
    await prisma.accesoCliente.create({ data: { usuarioId: usuarioB.id, clienteId: clienteB.id, organizacionId: org.id, activo: true } });
    const proyA = await prisma.proyecto.create({ data: { organizacionId: org.id, clienteId: clienteA.id, creadoPorId: propietario.id, nombre: "Proyecto A", presupuesto: 9000 } });
    const proyB = await prisma.proyecto.create({ data: { organizacionId: org.id, clienteId: clienteB.id, creadoPorId: propietario.id, nombre: "Proyecto B", presupuesto: 8000 } });
    const proyAjeno = await prisma.proyecto.create({ data: { organizacionId: orgAjena.id, clienteId: clienteAjeno.id, creadoPorId: propietario.id, nombre: "Proyecto ajeno" } });
    await prisma.hito.createMany({ data: [
      { proyectoId: proyA.id, titulo: "Visible A", visibleEnPortal: true },
      { proyectoId: proyA.id, titulo: "Oculto A", visibleEnPortal: false },
      { proyectoId: proyB.id, titulo: "Visible B", visibleEnPortal: true },
    ] });
    const archivoBase = { nombre: "Archivo", nombreOriginal: "interno.txt", tipoMime: "text/plain", tamanoBytes: 12, url: "https://example.test/archivo" };
    await prisma.archivo.createMany({ data: [
      { ...archivoBase, proyectoId: proyA.id, nombre: "Entregable A", visibilidad: "CLIENTE" },
      { ...archivoBase, proyectoId: proyA.id, nombre: "Secreto A", visibilidad: "INTERNA", url: "https://example.test/interno-a" },
      { ...archivoBase, proyectoId: proyB.id, nombre: "Entregable B", visibilidad: "CLIENTE" },
    ] });
    await prisma.comentario.createMany({ data: [
      { proyectoId: proyA.id, usuarioId: propietario.id, autor: "FREELANCER", contenido: "Comentario A" },
      { proyectoId: proyB.id, usuarioId: propietario.id, autor: "FREELANCER", contenido: "Comentario B" },
    ] });
    for (const [clienteId, estado, numero] of [
      [clienteA.id, "ENVIADA", "A-enviada"], [clienteA.id, "PAGADA", "A-pagada"],
      [clienteA.id, "VENCIDA", "A-vencida"], [clienteA.id, "BORRADOR", "A-borrador"],
      [clienteA.id, "CANCELADA", "A-cancelada"], [clienteB.id, "ENVIADA", "B-enviada"],
    ] as const) {
      await prisma.factura.create({ data: { organizacionId: org.id, clienteId, numero, concepto: "Servicio", monto: 120, estado, notas: "nota reservada" } });
    }
    const tokenA = await sesion({ tipoAcceso: "CLIENTE", usuarioId: usuarioA.id, organizacionId: org.id, clienteId: clienteA.id, rolCliente: "TITULAR" });
    const tokenB = await sesion({ tipoAcceso: "CLIENTE", usuarioId: usuarioB.id, organizacionId: org.id, clienteId: clienteB.id, rolCliente: "TITULAR" });
    const tokenProp = await sesion({ tipoAcceso: "ORGANIZACION", usuarioId: propietario.id, organizacionId: org.id, rolOrganizacion: "PROPIETARIO" });
    const tokenColab = await sesion({ tipoAcceso: "ORGANIZACION", usuarioId: colaborador.id, organizacionId: org.id, rolOrganizacion: "COLABORADOR" });
    const rutaA = `/api/portal/proyectos/${proyA.id}`;
    const rutaB = `/api/portal/proyectos/${proyB.id}`;

    await caso("autenticación obligatoria y separación de contextos", async () => {
      assert.equal((await pedir("/api/portal/proyectos")).status, 401);
      assert.equal((await pedir("/api/portal/proyectos", tokenProp.token)).status, 403);
    });
    await caso("ficha y branding sin campos internos", async () => {
      const r = await pedir("/api/portal", tokenA.token);
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.datos).sort(), ["cliente", "estudio"]);
      assert.equal(r.datos.cliente.id, clienteA.id);
      assert.equal(r.datos.estudio.nombre, org.nombre);
      assert.ok(!JSON.stringify(r.datos).includes("dato interno"));
      assert.ok(!JSON.stringify(r.datos).includes("portalMostrarFinanzas"));
    });
    await caso("proyectos propios sin aceptar clienteId de query", async () => {
      for (const ruta of ["/api/portal/proyectos", `/api/portal/proyectos?clienteId=${clienteB.id}&organizacionId=${orgAjena.id}`]) {
        const r = await pedir(ruta, tokenA.token);
        assert.equal(r.status, 200);
        assert.deepEqual(r.datos.map((p: any) => p.id), [proyA.id]);
        assert.ok(!JSON.stringify(r.datos).includes("presupuesto"));
      }
      assert.deepEqual((await pedir("/api/portal/proyectos", tokenB.token)).datos.map((p: any) => p.id), [proyB.id]);
    });
    await caso("detalle ajeno devuelve 404 sin proyecto interno", async () => {
      assert.equal((await pedir(rutaA, tokenA.token)).status, 200);
      assert.equal((await pedir(rutaB, tokenA.token)).status, 404);
      assert.equal((await pedir(`/api/portal/proyectos/${proyAjeno.id}`, tokenA.token)).status, 404);
      assert.equal((await pedir("/api/portal/proyectos/no-es-uuid", tokenA.token)).status, 422);
    });
    await caso("hitos visibles del proyecto propio", async () => {
      const r = await pedir(`${rutaA}/hitos`, tokenA.token);
      assert.equal(r.status, 200);
      assert.deepEqual(r.datos.map((h: any) => h.titulo), ["Visible A"]);
      assert.equal((await pedir(`${rutaB}/hitos`, tokenA.token)).status, 404);
    });
    await caso("archivos CLIENTE sin archivos internos", async () => {
      const r = await pedir(`${rutaA}/archivos`, tokenA.token);
      assert.equal(r.status, 200);
      assert.deepEqual(r.datos.map((a: any) => a.nombre), ["Entregable A"]);
      assert.ok(!JSON.stringify(r.datos).includes("interno-a"));
      assert.equal((await pedir(`${rutaB}/archivos`, tokenA.token)).status, 404);
    });
    await caso("comentarios propios y aislamiento de otro cliente", async () => {
      const r = await pedir(`${rutaA}/comentarios`, tokenA.token);
      assert.equal(r.status, 200);
      assert.deepEqual(r.datos.map((c: any) => c.contenido), ["Comentario A"]);
      assert.equal((await pedir(`${rutaB}/comentarios`, tokenA.token)).status, 404);
    });
    await caso("validación y comentario ajeno no escriben ni auditan", async () => {
      const comentarios = await prisma.comentario.count();
      const actividad = await prisma.actividad.count();
      assert.equal((await pedir(`${rutaA}/comentarios`, tokenA.token, "POST", { contenido: "   " })).status, 422);
      assert.equal((await pedir(`${rutaA}/comentarios`, tokenA.token, "POST", { contenido: "x".repeat(2001) })).status, 422);
      assert.equal((await pedir(`${rutaA}/comentarios`, tokenA.token, "POST", { contenido: "válido", clienteId: clienteB.id })).status, 422);
      assert.equal((await pedir(`${rutaB}/comentarios`, tokenA.token, "POST", { contenido: "No autorizado" })).status, 404);
      assert.equal(await prisma.comentario.count(), comentarios);
      assert.equal(await prisma.actividad.count(), actividad);
    });
    await caso("comentario autorizado guarda usuario y actividad atómica", async () => {
      const r = await pedir(`${rutaA}/comentarios`, tokenA.token, "POST", { contenido: "  Mensaje de A  " });
      assert.equal(r.status, 201);
      assert.equal(r.datos.contenido, "Mensaje de A");
      const guardado = await prisma.comentario.findUniqueOrThrow({ where: { id: r.datos.id } });
      assert.equal(guardado.usuarioId, usuarioA.id);
      assert.equal(guardado.proyectoId, proyA.id);
      assert.equal(guardado.autor, "CLIENTE");
      assert.equal(guardado.accesoPortalId, null);
      const eventos = await prisma.actividad.findMany({ where: { entidad: "comentario", entidadId: guardado.id } });
      assert.equal(eventos.length, 1);
      assert.equal(eventos[0].usuarioId, usuarioA.id);
      assert.equal(eventos[0].organizacionId, org.id);
      assert.equal(eventos[0].accion, "COMENTAR");
    });
    await caso("finanzas desactivadas por defecto", async () => {
      assert.equal((await prisma.organizacion.findUniqueOrThrow({ where: { id: org.id } })).portalMostrarFinanzas, false);
      const r = await pedir("/api/portal/facturas", tokenA.token);
      assert.equal(r.status, 200);
      assert.deepEqual(r.datos, []);
    });
    await caso("solo propietario cambia visibilidad financiera", async () => {
      assert.equal((await pedir("/api/organizacion", tokenColab.token, "PATCH", { portalMostrarFinanzas: true })).status, 403);
      assert.equal((await prisma.organizacion.findUniqueOrThrow({ where: { id: org.id } })).portalMostrarFinanzas, false);
      assert.equal((await pedir("/api/organizacion", tokenProp.token, "PATCH", { portalMostrarFinanzas: true, organizacionId: orgAjena.id })).status, 200);
      assert.equal((await prisma.organizacion.findUniqueOrThrow({ where: { id: org.id } })).portalMostrarFinanzas, true);
      assert.equal((await prisma.organizacion.findUniqueOrThrow({ where: { id: orgAjena.id } })).portalMostrarFinanzas, false);
    });
    await caso("facturas permitidas, cliente y organización propios, campos explícitos", async () => {
      const r = await pedir(`/api/portal/facturas?clienteId=${clienteB.id}`, tokenA.token);
      assert.equal(r.status, 200);
      assert.deepEqual(r.datos.map((f: any) => f.numero).sort(), ["A-enviada", "A-pagada", "A-vencida"]);
      for (const f of r.datos) {
        assert.deepEqual(Object.keys(f).sort(), ["concepto", "estado", "fechaEmision", "fechaVencimiento", "id", "moneda", "monto", "numero", "pagadaEn", "proyectoId"]);
        assert.ok(!JSON.stringify(f).includes("nota reservada"));
      }
      assert.deepEqual((await pedir("/api/portal/facturas", tokenB.token)).datos.map((f: any) => f.numero), ["B-enviada"]);
    });
    await caso("desactivar finanzas oculta los montos de inmediato", async () => {
      assert.equal((await pedir("/api/organizacion", tokenProp.token, "PATCH", { portalMostrarFinanzas: false })).status, 200);
      assert.deepEqual((await pedir("/api/portal/facturas", tokenA.token)).datos, []);
    });
    await caso("token heredado no abre portal ni se emite otro", async () => {
      const tokenHeredado = "centinela_portal_heredado_solo_test_123456";
      await prisma.accesoPortal.create({ data: { clienteId: clienteA.id, proyectoId: proyA.id, token: tokenHeredado } });
      const imprimir = process.stdout.write;
      const logs: string[] = [];
      try {
        process.stdout.write = ((bloque: any, ...args: any[]) => {
          logs.push(String(bloque));
          const fin = args.find(a => typeof a === "function");
          if (fin) fin();
          return true;
        }) as typeof imprimir;
        assert.equal((await pedir(`/api/portal/${tokenHeredado}`)).status, 401);
        assert.equal((await pedir(`/api/portal/${tokenHeredado}`, tokenA.token)).status, 404);
        assert.equal((await pedir(`/api/portal/${tokenHeredado}/comentarios`, tokenA.token)).status, 404);
        const antiguo = await pedir(`/api/proyectos/${proyA.id}/accesos-portal`, tokenProp.token, "POST", { nombre: "Legado" });
        assert.equal(antiguo.status, 404);
        assert.ok(!JSON.stringify(antiguo.datos).includes(tokenHeredado));
      } finally { process.stdout.write = imprimir; }
      assert.ok(logs.join("").includes("[REDACTADO]"));
      assert.ok(!logs.join("").includes(tokenHeredado));
    });
    await caso("desactivar acceso revoca lectura y escritura", async () => {
      await prisma.accesoCliente.update({ where: { id: accesoA.id }, data: { activo: false } });
      const previo = await prisma.comentario.count();
      assert.equal((await pedir("/api/portal/proyectos", tokenA.token)).status, 403);
      assert.equal((await pedir(`${rutaA}/comentarios`, tokenA.token, "POST", { contenido: "sin permiso" })).status, 403);
      assert.equal(await prisma.comentario.count(), previo);
      await prisma.accesoCliente.update({ where: { id: accesoA.id }, data: { activo: true } });
    });
    await caso("desvincular miembro invalida contexto de organización", async () => {
      await prisma.miembroOrganizacion.delete({ where: { usuarioId_organizacionId: { usuarioId: colaborador.id, organizacionId: org.id } } });
      assert.equal((await pedir("/api/organizacion", tokenColab.token)).status, 403);
    });
    await caso("revocar sesión invalida portal", async () => {
      await prisma.sesion.update({ where: { id: tokenA.id }, data: { revocadaEn: new Date() } });
      assert.equal((await pedir("/api/portal", tokenA.token)).status, 401);
      assert.equal((await pedir(`${rutaA}/comentarios`, tokenA.token, "POST", { contenido: "sin sesión" })).status, 401);
    });
    assert.equal(cuenta, 17);
    console.log(`[portal] Suite completada: ${cuenta} casos ejecutados.`);
  } finally {
    await new Promise<void>(resolver => servidor.close(() => resolver()));
    await prisma.$disconnect();
  }
}

ejecutar().catch((err) => { console.error("[portal] Suite falló:", err.message); process.exitCode = 1; });
