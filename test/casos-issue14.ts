import assert from "node:assert/strict";
import { createServer } from "node:http";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";

async function main() {
  const rows: Array<{ nombre: string }> = await prisma.$queryRaw`SELECT current_database() AS nombre`;
  assert.equal(rows[0]?.nombre, "equinox_issue14_test");
  const server = createServer(aplicacion);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const origin = `http://127.0.0.1:${addr.port}`;
  async function pedir(path: string, method = "GET", body?: unknown, token?: string) {
    const response = await fetch(origin + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    return { status: response.status, data };
  }
  function estado(actual: { status: number; data: any }, expected: number) {
    assert.equal(actual.status, expected, `HTTP inesperado: ${actual.status} (esperado ${expected})`);
    return actual.data;
  }
  async function descargar(path: string, token: string, expected: number) {
    const response = await fetch(origin + path, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, expected, `Descarga HTTP ${response.status} (esperado ${expected})`);
    return Buffer.from(await response.arrayBuffer());
  }
  const password = "ClaveFicticia14!";
  async function registro(suffix: string) {
    return estado(await pedir("/api/autenticacion/registro", "POST", {
      correo: `propietario-${suffix}@example.test`, contrasena: password, nombre: "Propietario", nombreEstudio: `Estudio ${suffix}`, slug: `estudio-${suffix}`,
    }), 201);
  }
  async function cliente(owner: string, suffix: string) {
    return estado(await pedir("/api/clientes", "POST", { nombre: `Cliente ${suffix}`, correo: `contacto-${suffix}@example.test` }, owner), 201);
  }
  async function proyecto(owner: string, clienteId: string, suffix: string) {
    return estado(await pedir("/api/proyectos", "POST", { clienteId, nombre: `Proyecto ${suffix}`, estado: "ACTIVO" }, owner), 201);
  }
  async function invitar(owner: string, clienteId: string, suffix: string) {
    const result = estado(await pedir(`/api/clientes/${clienteId}/invitaciones`, "POST", { correo: `acceso-${suffix}@example.test`, rol: "TITULAR" }, owner), 201);
    assert.ok(result.enlaceInvitacion, "Entrega local de enlace faltante");
    const token = new URL(result.enlaceInvitacion).pathname.split("/").at(-1)!;
    assert.ok(token.length >= 10);
    return token;
  }
  async function aceptar(token: string, suffix: string, orgId: string, clienteId: string) {
    const route = `/api/invitaciones/${encodeURIComponent(token)}`;
    const invitation = estado(await pedir(route), 200);
    assert.equal(invitation.esUsuarioExistente, false);
    assert.equal(invitation.cliente.nombre, `Cliente ${suffix}`);
    estado(await pedir(`${route}/aceptar`, "POST", { nombre: `Invitado ${suffix}`, contrasena: password }), 200);
    const login = estado(await pedir("/api/autenticacion/inicio-sesion", "POST", { correo: `acceso-${suffix}@example.test`, contrasena: password,
      seleccion: { tipoAcceso: "CLIENTE", organizacionId: orgId, clienteId } }), 200);
    assert.ok(login.token);
    return login.token as string;
  }
  try {
    const a = await registro("a14");
    const ownerA = a.token as string;
    const first = await cliente(ownerA, "a14");
    const projectA = await proyecto(ownerA, first.id, "a14");
    console.log("[issue14] Registro, cliente y proyecto A: OK");
    const tokenA = await invitar(ownerA, first.id, "a14");
    const clientA = await aceptar(tokenA, "a14", a.organizacion.id, first.id);
    const portal = estado(await pedir("/api/portal", "GET", undefined, clientA), 200);
    assert.equal(portal.cliente.id, first.id);
    assert.equal(portal.estudio.nombre, "Estudio a14");
    const projectsA = estado(await pedir("/api/portal/proyectos", "GET", undefined, clientA), 200);
    assert.deepEqual(projectsA.map((p: { id: string }) => p.id), [projectA.id]);
    assert.equal(estado(await pedir(`/api/portal/proyectos/${projectA.id}`, "GET", undefined, clientA), 200).id, projectA.id);
    const comment = estado(await pedir(`/api/portal/proyectos/${projectA.id}/comentarios`, "POST", { contenido: "Comentario de cliente A" }, clientA), 201);
    assert.equal(comment.autor, "CLIENTE");
    assert.ok(estado(await pedir(`/api/portal/proyectos/${projectA.id}/comentarios`, "GET", undefined, clientA), 200).some((c: { id: string }) => c.id === comment.id));
    const ownerComments = estado(await pedir(`/api/proyectos/${projectA.id}/comentarios`, "GET", undefined, ownerA), 200);
    assert.ok(ownerComments.some((c: { id: string; autor: string; contenido: string }) => c.id === comment.id && c.autor === "CLIENTE" && c.contenido === "Comentario de cliente A"));
    const task = estado(await pedir(`/api/proyectos/${projectA.id}/tareas`, "POST", { titulo: "Revisar entrega", estado: "PENDIENTE" }, ownerA), 201);
    const updated = estado(await pedir(`/api/proyectos/${projectA.id}/tareas/${task.id}`, "PATCH", { estado: "COMPLETADA" }, ownerA), 200);
    assert.equal(updated.estado, "COMPLETADA");
    assert.ok(updated.completadaEn);
    assert.equal(estado(await pedir(`/api/proyectos/${projectA.id}/tareas`, "GET", undefined, ownerA), 200).find((t: { id: string }) => t.id === task.id)?.estado, "COMPLETADA");
    console.log("[issue14] Invitación, aceptación, login y portal/comentario: OK");

    const second = await cliente(ownerA, "b14");
    const projectB = await proyecto(ownerA, second.id, "b14");
    const clientB = await aceptar(await invitar(ownerA, second.id, "b14"), "b14", a.organizacion.id, second.id);
    const b = await registro("otra14");
    const foreign = await cliente(b.token, "otra14");
    const projectForeign = await proyecto(b.token, foreign.id, "otra14");
    const foreignClient = await aceptar(await invitar(b.token, foreign.id, "otra14"), "otra14", b.organizacion.id, foreign.id);
    const bytes = Buffer.from("Entrega ficticia issue14\nContenido verificable: áéíóú\n", "utf8");
    const form = new FormData();
    form.set("archivo", new Blob([bytes], { type: "text/plain" }), "entrega-14.txt");
    form.set("visibilidad", "CLIENTE");
    const uploadResponse = await fetch(`${origin}/api/proyectos/${projectA.id}/archivos`, {
      method: "POST", headers: { Authorization: `Bearer ${ownerA}` }, body: form,
    });
    assert.equal(uploadResponse.status, 201, `Carga HTTP ${uploadResponse.status}`);
    const upload = await uploadResponse.json();
    assert.equal(upload.visibilidad, "CLIENTE");
    assert.equal(upload.tamanoBytes, bytes.length);
    const fileList = estado(await pedir(`/api/portal/proyectos/${projectA.id}/archivos`, "GET", undefined, clientA), 200);
    assert.ok(fileList.some((f: { id: string }) => f.id === upload.id));
    const downloadPath = `/api/portal/proyectos/${projectA.id}/archivos/${upload.id}/descargar`;
    assert.deepEqual(await descargar(downloadPath, clientA, 200), bytes);
    assert.equal((await descargar(downloadPath, clientB, 404)).length > 0, true);
    await descargar(downloadPath, foreignClient, 404);
    assert.deepEqual(estado(await pedir(`/api/portal/proyectos/${projectB.id}/archivos`, "GET", undefined, clientB), 200), []);
    assert.deepEqual(estado(await pedir(`/api/portal/proyectos/${projectForeign.id}/archivos`, "GET", undefined, foreignClient), 200), []);
    assert.equal(estado(await pedir(`/api/proyectos/${projectB.id}/tareas`, "GET", undefined, ownerA), 200).length, 0);
    assert.equal(estado(await pedir(`/api/proyectos/${projectForeign.id}/tareas`, "GET", undefined, b.token), 200).length, 0);
    assert.equal(estado(await pedir(`/api/proyectos/${projectB.id}/comentarios`, "GET", undefined, ownerA), 200).length, 0);
    assert.equal(estado(await pedir(`/api/proyectos/${projectForeign.id}/comentarios`, "GET", undefined, b.token), 200).length, 0);
    console.log("[issue14] Tarea del propietario y archivo real (bytes, acceso y aislamiento): OK");
    for (const [credential, forbidden] of [[clientA, projectB.id], [clientB, projectA.id], [clientA, projectForeign.id], [foreignClient, projectA.id]]) {
      const path = `/api/portal/proyectos/${forbidden}`;
      estado(await pedir(path, "GET", undefined, credential), 404);
      estado(await pedir(`${path}/comentarios`, "POST", { contenido: "No debe persistir" }, credential), 404);
    }
    estado(await pedir(`/api/clientes/${foreign.id}`, "GET", undefined, ownerA), 404);
    estado(await pedir(`/api/clientes/${foreign.id}/invitaciones`, "POST", { correo: "intruso@example.test" }, ownerA), 404);
    estado(await pedir("/api/autenticacion/inicio-sesion", "POST", { correo: "acceso-a14@example.test", contrasena: password,
      seleccion: { tipoAcceso: "CLIENTE", organizacionId: b.organizacion.id, clienteId: foreign.id } }), 403);
    assert.deepEqual(estado(await pedir("/api/portal/proyectos", "GET", undefined, clientA), 200).map((p: { id: string }) => p.id), [projectA.id]);
    assert.deepEqual(estado(await pedir("/api/portal/proyectos", "GET", undefined, foreignClient), 200).map((p: { id: string }) => p.id), [projectForeign.id]);
    assert.equal(await prisma.comentario.count({ where: { contenido: "No debe persistir" } }), 0);
    console.log("[issue14] Aislamiento entre clientes y organizaciones (lectura/escritura): OK");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error("[issue14] Casos fallidos:", error); process.exitCode = 1; });
