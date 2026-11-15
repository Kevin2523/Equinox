import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";
import type { ContextoSinSesion } from "../src/tipos.js";

let fase = "preparación";
async function main() {
  const db: Array<{ nombre: string }> = await prisma.$queryRaw`SELECT current_database() AS nombre`;
  assert.equal(db[0]?.nombre, "equinox_issue10_test");
  const servidor = createServer(aplicacion);
  let origen = "";
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", () => {
    const direccion = servidor.address();
    if (direccion && typeof direccion !== "string") origen = `http://127.0.0.1:${direccion.port}`;
    resolver();
  }));
  async function sesion(contexto: ContextoSinSesion) {
    const id = randomUUID();
    const firmado = firmarToken(contexto, id);
    await prisma.sesion.create({ data: { id, usuarioId: contexto.usuarioId, tokenHash: hashToken(firmado.token), expiraEn: firmado.expiraEn } });
    return firmado.token;
  }
  async function pedir(ruta: string, token: string, metodo = "GET", cuerpo?: object) {
    const respuesta = await fetch(`${origen}${ruta}`, { method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
    return { status: respuesta.status, datos: respuesta.status === 204 ? null : await respuesta.json() as any };
  }
  try {
    const [dueno, colaborador, clienteUsuario] = await Promise.all([
      prisma.usuario.create({ data: { correo: "dueno10@example.test", nombre: "Dueño", contrasenaHash: "fixture" } }),
      prisma.usuario.create({ data: { correo: "colab10@example.test", nombre: "Colaborador", contrasenaHash: "fixture" } }),
      prisma.usuario.create({ data: { correo: "cliente10@example.test", nombre: "Cliente", contrasenaHash: "fixture" } }),
    ]);
    const orgA = await prisma.organizacion.create({ data: { nombre: "A", slug: "issue10-a" } });
    const orgB = await prisma.organizacion.create({ data: { nombre: "B", slug: "issue10-b" } });
    await prisma.miembroOrganizacion.createMany({ data: [
      { usuarioId: dueno.id, organizacionId: orgA.id, rol: "PROPIETARIO" },
      { usuarioId: colaborador.id, organizacionId: orgA.id, rol: "COLABORADOR" },
      { usuarioId: dueno.id, organizacionId: orgB.id, rol: "PROPIETARIO" },
    ] });
    const clienteA = await prisma.cliente.create({ data: { organizacionId: orgA.id, nombre: "Cliente A" } });
    const clienteB = await prisma.cliente.create({ data: { organizacionId: orgB.id, nombre: "Cliente B" } });
    await prisma.accesoCliente.create({ data: { organizacionId: orgA.id, clienteId: clienteA.id, usuarioId: clienteUsuario.id } });
    const proyectoA = await prisma.proyecto.create({ data: { organizacionId: orgA.id, clienteId: clienteA.id, creadoPorId: dueno.id, nombre: "Proyecto A" } });
    const proyectoB = await prisma.proyecto.create({ data: { organizacionId: orgB.id, clienteId: clienteB.id, creadoPorId: dueno.id, nombre: "Proyecto B" } });
    const propietario = await sesion({ tipoAcceso: "ORGANIZACION", usuarioId: dueno.id, organizacionId: orgA.id, rolOrganizacion: "PROPIETARIO" });
    const miembro = await sesion({ tipoAcceso: "ORGANIZACION", usuarioId: colaborador.id, organizacionId: orgA.id, rolOrganizacion: "COLABORADOR" });
    const ajeno = await sesion({ tipoAcceso: "ORGANIZACION", usuarioId: dueno.id, organizacionId: orgB.id, rolOrganizacion: "PROPIETARIO" });
    const cliente = await sesion({ tipoAcceso: "CLIENTE", usuarioId: clienteUsuario.id, organizacionId: orgA.id, clienteId: clienteA.id, rolCliente: "TITULAR" });
    const ruta = `/api/proyectos/${proyectoA.id}`;
    const tareaCreada = await pedir(`${ruta}/tareas`, propietario, "POST", { titulo: "Tarea persistida" });
    assert.equal(tareaCreada.status, 201);
    fase = "GET de tareas del CRM";
    assert.equal((await pedir(`${ruta}/tareas`, miembro)).status, 200);
    assert.equal((await pedir(`${ruta}/tareas`, ajeno)).status, 404);
    assert.equal((await pedir(`${ruta}/tareas`, cliente)).status, 403);
    assert.equal((await pedir(`/api/proyectos/${proyectoB.id}/tareas`, propietario)).status, 404);
    assert.equal((await pedir(`${ruta}/tareas`, propietario, "POST", { titulo: "Asignación ajena", asignadoAId: clienteUsuario.id })).status, 422);
    assert.equal((await pedir(`${ruta}/tareas/${tareaCreada.datos.id}`, ajeno, "PATCH", { estado: "COMPLETADA" })).status, 404);
    fase = "finalización concurrente de tarea";
    const tareaConcurrente = await pedir(`${ruta}/tareas`, propietario, "POST", { titulo: "Competencia" });
    assert.equal(tareaConcurrente.status, 201);
    const originalFind = prisma.tarea.findFirst.bind(prisma.tarea);
    let lecturas = 0;
    let liberar!: () => void;
    const barrera = new Promise<void>((resolve) => { liberar = resolve; });
    (prisma.tarea as any).findFirst = async (...args: Parameters<typeof originalFind>) => {
      const resultado = await originalFind(...args);
      if (args[0]?.where?.id === tareaConcurrente.datos.id && ++lecturas <= 2) {
        if (lecturas === 2) liberar();
        await barrera;
      }
      return resultado;
    };
    try {
      const respuestas = await Promise.all([
        pedir(`${ruta}/tareas/${tareaConcurrente.datos.id}`, miembro, "PATCH", { estado: "COMPLETADA" }),
        pedir(`${ruta}/tareas/${tareaConcurrente.datos.id}`, propietario, "PATCH", { estado: "COMPLETADA" }),
      ]);
      assert.deepEqual(respuestas.map((r) => r.status), [200, 200]);
      assert.equal(respuestas[0].datos.completadaEn, respuestas[1].datos.completadaEn);
      assert.equal(await prisma.actividad.count({ where: { entidad: "tarea", entidadId: tareaConcurrente.datos.id, accion: "COMPLETAR" } }), 1);
    } finally { (prisma.tarea as any).findFirst = originalFind; }
    await prisma.tarea.delete({ where: { id: tareaConcurrente.datos.id } });
    const completa = await pedir(`${ruta}/tareas/${tareaCreada.datos.id}`, miembro, "PATCH", { estado: "COMPLETADA" });
    assert.equal(completa.status, 200);
    assert.ok(completa.datos.completadaEn);
    assert.equal((await prisma.actividad.count({ where: { organizacionId: orgA.id, entidad: "tarea", entidadId: tareaCreada.datos.id, accion: "COMPLETAR" } })), 1);
    const repetida = await pedir(`${ruta}/tareas/${tareaCreada.datos.id}`, miembro, "PATCH", { estado: "COMPLETADA" });
    assert.equal(repetida.status, 200);
    assert.equal(repetida.datos.completadaEn, completa.datos.completadaEn);
    assert.equal((await prisma.actividad.count({ where: { organizacionId: orgA.id, entidad: "tarea", entidadId: tareaCreada.datos.id, accion: "COMPLETAR" } })), 1);
    const tareas = await pedir(`${ruta}/tareas`, propietario);
    assert.equal(tareas.datos.length, 1);
    assert.equal(tareas.datos[0].estado, "COMPLETADA");
    const hito = await pedir(`${ruta}/hitos`, propietario, "POST", { titulo: "Hito privado" });
    assert.equal(hito.status, 201);
    assert.equal(hito.datos.visibleEnPortal, false);
    assert.deepEqual((await pedir(`/api/portal/proyectos/${proyectoA.id}/hitos`, cliente)).datos, []);
    assert.equal((await pedir(`${ruta}/hitos`, miembro)).status, 200);
    assert.equal((await pedir(`${ruta}/hitos`, ajeno)).status, 404);
    assert.equal((await pedir(`${ruta}/hitos/${hito.datos.id}`, cliente, "PATCH", { visibleEnPortal: true })).status, 403);
    assert.equal((await pedir(`${ruta}/hitos/${hito.datos.id}`, ajeno, "PATCH", { visibleEnPortal: true })).status, 404);
    assert.equal((await pedir(`${ruta}/hitos/${hito.datos.id}`, miembro, "PATCH", { visibleEnPortal: true })).status, 200);
    assert.equal((await pedir(`/api/portal/proyectos/${proyectoA.id}/hitos`, cliente)).datos.length, 1);
    const comentario = await pedir(`${ruta}/comentarios`, miembro, "POST", { contenido: "Respuesta real" });
    assert.equal(comentario.status, 201);
    assert.equal(comentario.datos.usuario.nombre, "Colaborador");
    assert.ok(comentario.datos.creadoEn);
    const comentarios = await pedir(`${ruta}/comentarios`, propietario);
    assert.equal(comentarios.status, 200);
    assert.equal(comentarios.datos[0].usuario.nombre, "Colaborador");
    const delCliente = await pedir(`/api/portal/proyectos/${proyectoA.id}/comentarios`, cliente, "POST", { contenido: "Mensaje del cliente" });
    assert.equal(delCliente.status, 201);
    assert.equal(delCliente.datos.autor, "CLIENTE");
    assert.equal(delCliente.datos.usuario.nombre, "Cliente");
    assert.ok(delCliente.datos.creadoEn);
    const conversacion = await pedir(`${ruta}/comentarios`, propietario);
    assert.equal(conversacion.datos.length, 2);
    assert.equal(conversacion.datos[1].autor, "CLIENTE");
    assert.equal(conversacion.datos[1].usuario.nombre, "Cliente");
    assert.equal((await pedir(`${ruta}/comentarios`, ajeno)).status, 404);
    assert.equal((await pedir(`${ruta}/comentarios`, ajeno, "POST", { contenido: "Acceso cruzado" })).status, 404);
    assert.equal((await pedir(`${ruta}/comentarios`, propietario, "POST", { contenido: "  " })).status, 422);
    assert.equal((await pedir(`${ruta}/comentarios`, cliente, "POST", { contenido: "Sin permiso" })).status, 403);
    assert.equal((await pedir(`/api/portal/proyectos/${proyectoA.id}/comentarios/${comentario.datos.id}`, cliente, "PATCH", { contenido: "Alterar" })).status, 404);
    assert.equal((await pedir(`${ruta}/tareas/${tareaCreada.datos.id}`, cliente, "PATCH", { estado: "PENDIENTE" })).status, 403);
    assert.equal((await pedir(`${ruta}/hitos/${hito.datos.id}`, propietario, "DELETE")).status, 204);
    assert.deepEqual((await pedir(`${ruta}/hitos`, propietario)).datos, []);
    const hitoDirecto = await prisma.hito.create({ data: { proyectoId: proyectoA.id, titulo: "Privado por defecto" } });
    assert.equal(hitoDirecto.visibleEnPortal, false);
    assert.deepEqual((await pedir(`/api/portal/proyectos/${proyectoA.id}/hitos`, cliente)).datos, []);
    await prisma.hito.delete({ where: { id: hitoDirecto.id } });
    assert.equal((await pedir(`${ruta}/tareas/${tareaCreada.datos.id}`, propietario, "DELETE")).status, 204);
    assert.deepEqual((await pedir(`${ruta}/tareas`, propietario)).datos, []);
    assert.equal((await prisma.proyecto.count({ where: { id: proyectoA.id, organizacionId: orgA.id } })), 1);
    console.log("[issue10] Persistencia, actividad, autor, visibilidad y aislamiento: OK");
  } finally {
    await new Promise<void>((resolver) => servidor.close(() => resolver()));
    await prisma.$disconnect();
  }
}

main().catch(() => { console.log(`[issue10] Falló la regresión: ${fase}`); process.exitCode = 1; });
