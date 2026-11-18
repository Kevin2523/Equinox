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
    await new Promise<void>((resolve) =>
      servidor!.listen(0, () => {
        const direccion = servidor!.address();
        if (typeof direccion === "object" && direccion) urlApi = `http://127.0.0.1:${direccion.port}`;
        resolve();
      })
    );

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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo,
          contrasena: "Password123!",
          nombre: "Propietario",
          nombreEstudio: `Estudio ${slug}`,
          slug
        })
      });
      assert.equal(respuesta.status, 201);
      return (await respuesta.json()) as { token: string; organizacion: { id: string } };
    };

    const alfa = await registrar("finanzas.alfa@example.test", "fin-alfa");
    const beta = await registrar("finanzas.beta@example.test", "fin-beta");
    const authHeaders = (token: string) => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    });

    // 1. Crear clientes para cada organización
    const resClienteAlfa = await fetch(`${urlApi}/api/clientes`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({ nombre: "Cliente Alfa 1", empresa: "Café Unido", estado: "ACTIVO" })
    });
    assert.equal(resClienteAlfa.status, 201);
    const clienteAlfa = (await resClienteAlfa.json()) as { id: string };

    const resClienteBeta = await fetch(`${urlApi}/api/clientes`, {
      method: "POST",
      headers: authHeaders(beta.token),
      body: JSON.stringify({ nombre: "Cliente Beta 1", empresa: "Empresa Beta", estado: "ACTIVO" })
    });
    assert.equal(resClienteBeta.status, 201);
    const clienteBeta = (await resClienteBeta.json()) as { id: string };

    // 2. Crear proyecto en Alfa
    const resProyectoAlfa = await fetch(`${urlApi}/api/proyectos`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({ clienteId: clienteAlfa.id, nombre: "Branding y Web" })
    });
    assert.equal(resProyectoAlfa.status, 201);
    const proyectoAlfa = (await resProyectoAlfa.json()) as { id: string };

    // 3. Crear facturas en Organización Alfa
    // INV-2026-001 (PAGADA - Anticipo 50%)
    const resFac1 = await fetch(`${urlApi}/api/facturas`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({
        clienteId: clienteAlfa.id,
        proyectoId: proyectoAlfa.id,
        numero: "INV-2026-001",
        concepto: "Anticipo 50% · Branding y web",
        monto: 2250.0,
        moneda: "PAB",
        estado: "PAGADA",
        fechaEmision: "2026-03-15",
        fechaVencimiento: "2026-03-30"
      })
    });
    assert.equal(resFac1.status, 201);
    const fac1 = (await resFac1.json()) as { id: string; estado: string; pagadaEn: string; monto: any };
    assert.equal(fac1.estado, "PAGADA");
    assert.ok(fac1.pagadaEn, "Debe tener fecha de pago al crearse pagada");

    // INV-2026-002 (ENVIADA - Saldo final)
    const resFac2 = await fetch(`${urlApi}/api/facturas`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({
        clienteId: clienteAlfa.id,
        proyectoId: proyectoAlfa.id,
        numero: "INV-2026-002",
        concepto: "Saldo final · Entrega y producción",
        monto: 2250.0,
        moneda: "PAB",
        estado: "ENVIADA",
        fechaEmision: "2026-04-01",
        fechaVencimiento: "2026-04-18"
      })
    });
    assert.equal(resFac2.status, 201);
    const fac2 = (await resFac2.json()) as { id: string; estado: string; pagadaEn: string | null };
    assert.equal(fac2.estado, "ENVIADA");
    assert.equal(fac2.pagadaEn, null);

    // 4. Registrar pago en fac2 ("Registrar pago contable")
    const resPagoFac2 = await fetch(`${urlApi}/api/facturas/${fac2.id}`, {
      method: "PATCH",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({
        estado: "PAGADA",
        pagadaEn: "2026-04-10T14:30:00.000Z",
        notas: "[Pago contable: Ref. ACH-10293] Verificado en cuenta"
      })
    });
    assert.equal(resPagoFac2.status, 200);
    const fac2Actualizada = (await resPagoFac2.json()) as { id: string; estado: string; pagadaEn: string; notas: string };
    assert.equal(fac2Actualizada.estado, "PAGADA");
    assert.ok(fac2Actualizada.pagadaEn.includes("2026-04-10"));
    assert.ok(fac2Actualizada.notas.includes("ACH-10293"));

    // 5. Rechazo de número duplicado en la misma organización
    const resDuplicado = await fetch(`${urlApi}/api/facturas`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({
        clienteId: clienteAlfa.id,
        numero: "INV-2026-001", // Ya existe
        concepto: "Concepto duplicado",
        monto: 100.0
      })
    });
    assert.equal(resDuplicado.status, 409, "Debe rechazar número de factura duplicado");

    // 6. Pero Beta SÍ puede usar INV-2026-001 en su propia organización
    const resFacBeta = await fetch(`${urlApi}/api/facturas`, {
      method: "POST",
      headers: authHeaders(beta.token),
      body: JSON.stringify({
        clienteId: clienteBeta.id,
        numero: "INV-2026-001",
        concepto: "Factura de Beta",
        monto: 500.0,
        moneda: "USD"
      })
    });
    assert.equal(resFacBeta.status, 201);
    const facBeta = (await resFacBeta.json()) as { id: string };

    // 7. Aislamiento Multitenant estricto
    // Beta no debe ver las facturas de Alfa
    const resListarBeta = await fetch(`${urlApi}/api/facturas`, {
      headers: authHeaders(beta.token)
    });
    assert.equal(resListarBeta.status, 200);
    const facturasBeta = (await resListarBeta.json()) as Array<{ id: string }>;
    assert.equal(facturasBeta.length, 1);
    assert.equal(facturasBeta[0].id, facBeta.id);

    // Beta no puede consultar por ID la factura de Alfa
    const resVerAlfaDesdeBeta = await fetch(`${urlApi}/api/facturas/${fac1.id}`, {
      headers: authHeaders(beta.token)
    });
    assert.equal(resVerAlfaDesdeBeta.status, 404);

    // Beta no puede actualizar la factura de Alfa
    const resPatchAlfaDesdeBeta = await fetch(`${urlApi}/api/facturas/${fac1.id}`, {
      method: "PATCH",
      headers: authHeaders(beta.token),
      body: JSON.stringify({ monto: 9999 })
    });
    assert.equal(resPatchAlfaDesdeBeta.status, 404);

    // Beta no puede eliminar la factura de Alfa
    const resDeleteAlfaDesdeBeta = await fetch(`${urlApi}/api/facturas/${fac1.id}`, {
      method: "DELETE",
      headers: authHeaders(beta.token)
    });
    assert.equal(resDeleteAlfaDesdeBeta.status, 404);

    // Alfa no puede crear factura asignando el cliente de Beta
    const resClienteCruzado = await fetch(`${urlApi}/api/facturas`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({
        clienteId: clienteBeta.id, // Pertenece a Beta
        numero: "INV-2026-999",
        concepto: "Intento cruzado",
        monto: 300.0
      })
    });
    assert.equal(resClienteCruzado.status, 422, "No debe permitir asignar cliente de otra organización");

    // 8. Validación de cálculos monetarios y precisión
    // Crear facturas para verificar suma de pendientes y cobrados
    // Alfa tiene fac1 (2250 PAGADA), fac2 (2250 PAGADA) -> total cobrado = 4500.00
    // Crear factura 3 pendiente: 1400.00
    await fetch(`${urlApi}/api/facturas`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({
        clienteId: clienteAlfa.id,
        numero: "INV-2026-003",
        concepto: "Desarrollo web · Hito 1",
        monto: 1400.0,
        moneda: "PAB",
        estado: "ENVIADA",
        fechaEmision: "2026-04-05"
      })
    });
    // Crear factura 4 pendiente: 1700.00
    await fetch(`${urlApi}/api/facturas`, {
      method: "POST",
      headers: authHeaders(alfa.token),
      body: JSON.stringify({
        clienteId: clienteAlfa.id,
        numero: "INV-2026-004",
        concepto: "Fase 2 · Identidad",
        monto: 1700.0,
        moneda: "PAB",
        estado: "ENVIADA",
        fechaEmision: "2026-04-01"
      })
    });

    const resTodasAlfa = await fetch(`${urlApi}/api/facturas`, {
      headers: authHeaders(alfa.token)
    });
    const listaAlfa = (await resTodasAlfa.json()) as Array<{ monto: any; estado: string; moneda: string }>;
    assert.equal(listaAlfa.length, 4);

    let cobradoCentavos = 0;
    let pendienteCentavos = 0;
    for (const f of listaAlfa) {
      assert.equal(f.moneda, "PAB");
      const c = Math.round(Number(f.monto) * 100);
      if (f.estado === "PAGADA") cobradoCentavos += c;
      else pendienteCentavos += c;
    }

    assert.equal(cobradoCentavos, 450000, "Cobrado debe ser exactamente 4,500.00 PAB");
    assert.equal(pendienteCentavos, 310000, "Pendiente debe ser exactamente 3,100.00 PAB");

    console.log("[casos-facturas] Aislamiento multitenant, validaciones, registro de pago y cálculos monetarios verificados con éxito.");
  } finally {
    if (servidor) {
      await new Promise<void>((resolve) => servidor!.close(() => resolve()));
    }
  }
}

ejecutar().catch((error) => {
  console.error(error);
  process.exit(1);
});
