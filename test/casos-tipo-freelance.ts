import assert from "node:assert/strict";
import { createServer } from "node:http";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";

const BASE_ESPERADA = "equinox_issue3_test";

async function verificarBaseActual() {
  const resultado: Array<{ current_database: string }> =
    await prisma.$queryRaw`SELECT current_database();`;

  const nombreActual = resultado[0]?.current_database;
  if (nombreActual !== BASE_ESPERADA) {
    console.error(
      `[SEGURIDAD CRÍTICA] La base actual es '${nombreActual}', pero se exige '${BASE_ESPERADA}'. Abortando.`
    );
    process.exit(1);
  }
}

async function ejecutar() {
  await verificarBaseActual();

  let servidor: ReturnType<typeof createServer> | null = null;
  let urlApi = "";

  try {
    await new Promise<void>((resolve) => {
      servidor = createServer(aplicacion);
      servidor.listen(0, () => {
        const addr = servidor!.address();
        if (typeof addr === "object" && addr) {
          urlApi = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    // Limpieza inicial
    await prisma.sesion.deleteMany();
    await prisma.accesoCliente.deleteMany();
    await prisma.miembroOrganizacion.deleteMany();
    await prisma.cliente.deleteMany();
    await prisma.proyecto.deleteMany();
    await prisma.factura.deleteMany();
    await prisma.organizacion.deleteMany();
    await prisma.usuario.deleteMany();

    const authHeaders = (token: string) => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });

    console.log("-> 1. Prueba de registro con tipoFreelance explícito (FOTOGRAFIA, DESARROLLO_SOFTWARE, DISENO_GRAFICO)");
    const resFoto = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "foto@studio.test",
        contrasena: "Password123!",
        nombre: "Lente",
        apellido: "Foto",
        nombreEstudio: "Studio Fotográfico",
        slug: "studio-foto",
        tipoFreelance: "FOTOGRAFIA",
      }),
    });
    assert.equal(resFoto.status, 201, "El registro con FOTOGRAFIA debe responder 201");
    const datosFoto = (await resFoto.json()) as any;
    assert.equal(datosFoto.organizacion.tipoFreelance, "FOTOGRAFIA");
    const tokenFoto = datosFoto.token;
    const orgFotoId = datosFoto.organizacion.id;

    // Verificar en BD
    const orgFotoBd = await prisma.organizacion.findUnique({ where: { id: orgFotoId } });
    assert.equal((orgFotoBd as any)?.tipoFreelance, "FOTOGRAFIA");

    // Registro con DESARROLLO_SOFTWARE
    const resSoftware = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "dev@studio.test",
        contrasena: "Password123!",
        nombre: "Dev",
        nombreEstudio: "Studio Dev",
        slug: "studio-dev",
        tipoFreelance: "DESARROLLO_SOFTWARE",
      }),
    });
    assert.equal(resSoftware.status, 201);
    const datosSoftware = (await resSoftware.json()) as any;
    assert.equal(datosSoftware.organizacion.tipoFreelance, "DESARROLLO_SOFTWARE");

    // Registro con DISENO_GRAFICO
    const resDiseno = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "diseno@studio.test",
        contrasena: "Password123!",
        nombre: "Designer",
        nombreEstudio: "Studio Diseno",
        slug: "studio-diseno",
        tipoFreelance: "DISENO_GRAFICO",
      }),
    });
    assert.equal(resDiseno.status, 201);
    const datosDiseno = (await resDiseno.json()) as any;
    assert.equal(datosDiseno.organizacion.tipoFreelance, "DISENO_GRAFICO");

    console.log("-> 2. Prueba de registro sin especificar tipoFreelance (default GENERAL)");
    const resDefault = await fetch(`${urlApi}/api/autenticacion/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "general@studio.test",
        contrasena: "Password123!",
        nombre: "General",
        nombreEstudio: "Studio General",
        slug: "studio-general",
      }),
    });
    assert.equal(resDefault.status, 201);
    const datosDefault = (await resDefault.json()) as any;
    assert.equal(datosDefault.organizacion.tipoFreelance, "GENERAL");
    const orgDefaultBd = await prisma.organizacion.findUnique({ where: { id: datosDefault.organizacion.id } });
    assert.equal((orgDefaultBd as any)?.tipoFreelance, "GENERAL");

    console.log("-> 3. GET /api/organizacion devuelve el tipoFreelance real");
    const resGetOrg = await fetch(`${urlApi}/api/organizacion`, {
      headers: authHeaders(tokenFoto),
    });
    assert.equal(resGetOrg.status, 200);
    const datosGetOrg = (await resGetOrg.json()) as any;
    assert.equal(datosGetOrg.tipoFreelance, "FOTOGRAFIA");

    console.log("-> 4. Preservación de datos: Propietario cambia tipoFreelance sin borrar clientes ni proyectos");
    // Crear un cliente asociado a orgFoto
    const resCrearCliente = await fetch(`${urlApi}/api/clientes`, {
      method: "POST",
      headers: authHeaders(tokenFoto),
      body: JSON.stringify({
        nombre: "Cliente Sesion Boda",
        empresa: "Boda Feliz",
        estado: "ACTIVO",
      }),
    });
    assert.equal(resCrearCliente.status, 201);
    const clienteCreado = (await resCrearCliente.json()) as any;

    // Cambiar tipoFreelance a GENERAL mediante PATCH /api/organizacion
    const resPatchOrg = await fetch(`${urlApi}/api/organizacion`, {
      method: "PATCH",
      headers: authHeaders(tokenFoto),
      body: JSON.stringify({
        tipoFreelance: "GENERAL",
      }),
    });
    assert.equal(resPatchOrg.status, 200);
    const orgPatch = (await resPatchOrg.json()) as any;
    assert.equal(orgPatch.tipoFreelance, "GENERAL");

    // Verificar que el cliente sigue existiendo sin borrarse
    const clienteDespues = await prisma.cliente.findUnique({ where: { id: clienteCreado.id } });
    assert.ok(clienteDespues, "El cliente no debe haber sido borrado al cambiar modalidad");
    assert.equal(clienteDespues.nombre, "Cliente Sesion Boda");

    // Cambiar tipoFreelance a FOTOGRAFIA mediante PATCH /api/organizacion/tipo-freelance
    const resPatchTipo = await fetch(`${urlApi}/api/organizacion/tipo-freelance`, {
      method: "PATCH",
      headers: authHeaders(tokenFoto),
      body: JSON.stringify({
        tipoFreelance: "FOTOGRAFIA",
      }),
    });
    assert.equal(resPatchTipo.status, 200);
    const orgPatchTipo = (await resPatchTipo.json()) as any;
    assert.equal(orgPatchTipo.tipoFreelance, "FOTOGRAFIA");

    console.log("-> 5. Aislamiento y permisos: COLABORADOR puede leer pero NO modificar tipoFreelance");
    // Crear colaborador en la org de foto
    const hashColab = await (await import("bcryptjs")).default.hash("Password123!", 10);
    const usuarioColab = await prisma.usuario.create({
      data: {
        correo: "colab@studio.test",
        contrasenaHash: hashColab,
        nombre: "Colaborador",
      },
    });
    await prisma.miembroOrganizacion.create({
      data: {
        usuarioId: usuarioColab.id,
        organizacionId: orgFotoId,
        rol: "COLABORADOR",
      },
    });

    // Iniciar sesión como colaborador
    const resLoginColab = await fetch(`${urlApi}/api/autenticacion/inicio-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo: "colab@studio.test",
        contrasena: "Password123!",
      }),
    });
    assert.equal(resLoginColab.status, 200);
    const datosLoginColab = (await resLoginColab.json()) as any;
    const tokenColab = datosLoginColab.token;

    // Colaborador lee GET /api/organizacion
    const resColabGet = await fetch(`${urlApi}/api/organizacion`, {
      headers: authHeaders(tokenColab),
    });
    assert.equal(resColabGet.status, 200);
    const orgColabVista = (await resColabGet.json()) as any;
    assert.equal(orgColabVista.tipoFreelance, "FOTOGRAFIA");

    // Colaborador intenta PATCH /api/organizacion -> 403 Forbidden
    const resColabPatch = await fetch(`${urlApi}/api/organizacion`, {
      method: "PATCH",
      headers: authHeaders(tokenColab),
      body: JSON.stringify({
        tipoFreelance: "GENERAL",
      }),
    });
    assert.equal(resColabPatch.status, 403, "Colaborador debe recibir 403 al intentar PATCH");

    // Colaborador intenta PATCH /api/organizacion/tipo-freelance -> 403 Forbidden
    const resColabPatchTipo = await fetch(`${urlApi}/api/organizacion/tipo-freelance`, {
      method: "PATCH",
      headers: authHeaders(tokenColab),
      body: JSON.stringify({
        tipoFreelance: "GENERAL",
      }),
    });
    assert.equal(resColabPatchTipo.status, 403, "Colaborador debe recibir 403 al intentar PATCH tipo-freelance");

    console.log("-> 6. Validación de enum en PATCH (rechazar valores inválidos)");
    const resInvalido = await fetch(`${urlApi}/api/organizacion`, {
      method: "PATCH",
      headers: authHeaders(tokenFoto),
      body: JSON.stringify({
        tipoFreelance: "TIPO_INVENTADO",
      }),
    });
    assert.ok(resInvalido.status >= 400 && resInvalido.status < 500, "Debe rechazar tipoFreelance inválido");

    console.log("¡Todas las pruebas de casos-tipo-freelance pasaron exitosamente!");
  } finally {
    if (servidor) {
      (servidor as any).close();
    }
    await prisma.$disconnect();
  }
}

ejecutar().catch((err) => {
  console.error("Error en pruebas casos-tipo-freelance:", err);
  process.exit(1);
});
