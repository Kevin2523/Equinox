import assert from "node:assert/strict";
import { createServer } from "node:http";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";

const BASE_ESPERADA = "equinox_issue8_test";

async function verificarBaseActual() {
  const resultado: Array<{ current_database: string }> = await prisma.$queryRaw`SELECT current_database();`;
  assert.equal(resultado[0]?.current_database, BASE_ESPERADA, "Las pruebas destructivas solo pueden usar la base temporal autorizada");
}

async function ejecutar() {
  await verificarBaseActual();
  let servidor: ReturnType<typeof createServer> | null = null;
  let urlApi = "";
  try {
    servidor = createServer(aplicacion);
    await new Promise<void>((resolve) => servidor!.listen(0, () => {
      const direccion = servidor!.address();
      if (typeof direccion === "object" && direccion) urlApi = `http://127.0.0.1:${direccion.port}`;
      resolve();
    }));

    // Aislamiento redundante dentro de la base temporal, luego de comprobar current_database().
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

    const registrar = async (correo: string, slug: string) => {
      const respuesta = await fetch(`${urlApi}/api/autenticacion/registro`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo, contrasena: "Password123!", nombre: "Propietario", nombreEstudio: `Estudio ${slug}`, slug }),
      });
      assert.equal(respuesta.status, 201);
      return await respuesta.json() as { token: string; organizacion: { id: string } };
    };
    const alfa = await registrar("issue8.alfa@example.test", "issue8-alfa");
    const beta = await registrar("issue8.beta@example.test", "issue8-beta");
    const autorizacion = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

    const respuestaCliente = await fetch(`${urlApi}/api/clientes`, {
      method: "POST", headers: autorizacion(alfa.token),
      body: JSON.stringify({ nombre: "Cliente Alfa", empresa: "Alfa S.A.", notasInternas: "Nota inicial visible", organizacionId: beta.organizacion.id }),
    });
    assert.equal(respuestaCliente.status, 201);
    const cliente = await respuestaCliente.json() as { id: string; notasInternas: string };
    assert.equal(cliente.notasInternas, "Nota inicial visible");

    const recargaClientes = await fetch(`${urlApi}/api/clientes`, { headers: autorizacion(alfa.token) });
    assert.equal(recargaClientes.status, 200);
    const clientes = await recargaClientes.json() as Array<{ id: string; notasInternas: string }>;
    assert.ok(clientes.some((elemento) => elemento.id === cliente.id && elemento.notasInternas === "Nota inicial visible"));
    const editarCliente = await fetch(`${urlApi}/api/clientes/${cliente.id}`, {
      method: "PATCH", headers: autorizacion(alfa.token), body: JSON.stringify({ notasInternas: "Nota actualizada" }),
    });
    assert.equal(editarCliente.status, 200);
    assert.equal((await editarCliente.json() as { notasInternas: string }).notasInternas, "Nota actualizada");
    assert.equal((await fetch(`${urlApi}/api/clientes/${cliente.id}`, { headers: autorizacion(alfa.token) })).status, 200);

    const respuestaProyecto = await fetch(`${urlApi}/api/proyectos`, {
      method: "POST", headers: autorizacion(alfa.token),
      body: JSON.stringify({ nombre: "Proyecto Alfa", clienteId: cliente.id, descripcion: "Proyecto integrado", estado: "ACTIVO", presupuesto: 1800, moneda: "PAB" }),
    });
    assert.equal(respuestaProyecto.status, 201);
    const proyecto = await respuestaProyecto.json() as { id: string; nombre: string };
    const recargaProyectos = await fetch(`${urlApi}/api/proyectos?estado=ACTIVO`, { headers: autorizacion(alfa.token) });
    assert.equal(recargaProyectos.status, 200);
    const proyectos = await recargaProyectos.json() as Array<{ id: string; nombre: string; estado: string }>;
    assert.equal(proyectos.filter((elemento) => elemento.estado === "ACTIVO").length, 1);
    assert.ok(proyectos.some((elemento) => elemento.id === proyecto.id));

    const consultaProyecto = await fetch(`${urlApi}/api/proyectos/${proyecto.id}`, { headers: autorizacion(alfa.token) });
    assert.equal(consultaProyecto.status, 200);
    const edicionProyecto = await fetch(`${urlApi}/api/proyectos/${proyecto.id}`, {
      method: "PATCH", headers: autorizacion(alfa.token), body: JSON.stringify({ nombre: "Proyecto Alfa editado" }),
    });
    assert.equal(edicionProyecto.status, 200);
    assert.equal((await edicionProyecto.json() as { nombre: string }).nombre, "Proyecto Alfa editado");
    const despuesEditar = await (await fetch(`${urlApi}/api/proyectos`, { headers: autorizacion(alfa.token) })).json() as Array<{ id: string; nombre: string }>;
    assert.equal(despuesEditar.length, 1, "Editar debe actualizar el registro existente, sin duplicarlo");
    assert.equal(despuesEditar[0].id, proyecto.id);
    assert.equal(despuesEditar[0].nombre, "Proyecto Alfa editado");

    const clientesBeta = await (await fetch(`${urlApi}/api/clientes`, { headers: autorizacion(beta.token) })).json() as Array<{ id: string }>;
    const proyectosBeta = await (await fetch(`${urlApi}/api/proyectos`, { headers: autorizacion(beta.token) })).json() as Array<{ id: string }>;
    assert.ok(!clientesBeta.some((elemento) => elemento.id === cliente.id));
    assert.ok(!proyectosBeta.some((elemento) => elemento.id === proyecto.id));
    for (const ruta of [`/api/clientes/${cliente.id}`, `/api/proyectos/${proyecto.id}`]) {
      assert.equal((await fetch(`${urlApi}${ruta}`, { headers: autorizacion(beta.token) })).status, 404);
      assert.equal((await fetch(`${urlApi}${ruta}`, { method: "PATCH", headers: autorizacion(beta.token), body: JSON.stringify({ nombre: "Intrusión" }) })).status, 404);
    }
    const proyectoAjeno = await fetch(`${urlApi}/api/proyectos`, {
      method: "POST", headers: autorizacion(beta.token), body: JSON.stringify({ nombre: "Proyecto cruzado", clienteId: cliente.id, estado: "BORRADOR", moneda: "PAB" }),
    });
    assert.equal(proyectoAjeno.status, 422);

    console.log("[casos-clientes-proyectos] Persistencia, notas, actualización, filtro ACTIVO y aislamiento entre organizaciones verificados.");
  } finally {
    if (servidor) await new Promise<void>((resolve) => servidor!.close(() => resolve()));
    await prisma.$disconnect();
  }
}

ejecutar().catch(() => {
  console.error("[casos-clientes-proyectos] Falló la suite de integración.");
  process.exit(1);
});
