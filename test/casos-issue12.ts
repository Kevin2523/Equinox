import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";
import type { ContextoSinSesion } from "../src/tipos.js";

async function main() {
  const db: Array<{ nombre: string }> = await prisma.$queryRaw`SELECT current_database() AS nombre`;
  assert.equal(db[0]?.nombre, "equinox_issue12_test", "Debe ejecutarse estrictamente en equinox_issue12_test");

  const server = createServer(aplicacion);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  async function token(contexto: ContextoSinSesion) {
    const id = randomUUID();
    const firmado = firmarToken(contexto, id);
    await prisma.sesion.create({
      data: {
        id,
        usuarioId: contexto.usuarioId,
        tokenHash: hashToken(firmado.token),
        expiraEn: firmado.expiraEn,
      },
    });
    return firmado.token;
  }

  async function pedir(
    ruta: string,
    credencial: string,
    metodo = "GET",
    body?: any,
    contentType = "application/json"
  ) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credencial}`,
    };
    if (body && contentType) {
      headers["Content-Type"] = contentType;
    }
    return fetch(origin + ruta, {
      method: metodo,
      headers,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
  }

  try {
    // 1. Crear usuarios y organizaciones
    const [duenoA, colabA, duenoB, usuarioClienteA] = await Promise.all([
      prisma.usuario.create({ data: { correo: "duenoA12@example.test", nombre: "Dueño A", contrasenaHash: "fixture" } }),
      prisma.usuario.create({ data: { correo: "colabA12@example.test", nombre: "Colab A", contrasenaHash: "fixture" } }),
      prisma.usuario.create({ data: { correo: "duenoB12@example.test", nombre: "Dueño B", contrasenaHash: "fixture" } }),
      prisma.usuario.create({ data: { correo: "clienteA12@example.test", nombre: "Cliente A", contrasenaHash: "fixture" } }),
    ]);

    const [orgA, orgB] = await Promise.all([
      prisma.organizacion.create({ data: { nombre: "Organización A", slug: "issue12-org-a", portalMostrarFinanzas: true } }),
      prisma.organizacion.create({ data: { nombre: "Organización B", slug: "issue12-org-b", portalMostrarFinanzas: true } }),
    ]);

    await prisma.miembroOrganizacion.createMany({
      data: [
        { usuarioId: duenoA.id, organizacionId: orgA.id, rol: "PROPIETARIO" },
        { usuarioId: colabA.id, organizacionId: orgA.id, rol: "COLABORADOR" },
        { usuarioId: duenoB.id, organizacionId: orgB.id, rol: "PROPIETARIO" },
      ],
    });

    const [clienteA1, clienteA2, clienteB] = await Promise.all([
      prisma.cliente.create({ data: { organizacionId: orgA.id, nombre: "Cliente A-1", correo: "contacto1@example.test" } }),
      prisma.cliente.create({ data: { organizacionId: orgA.id, nombre: "Cliente A-2", correo: "contacto2@example.test" } }),
      prisma.cliente.create({ data: { organizacionId: orgB.id, nombre: "Cliente B-1", correo: "contactoB@example.test" } }),
    ]);

    await prisma.accesoCliente.createMany({
      data: [
        { organizacionId: orgA.id, clienteId: clienteA1.id, usuarioId: usuarioClienteA.id, rol: "TITULAR", activo: true },
        { organizacionId: orgA.id, clienteId: clienteA2.id, usuarioId: usuarioClienteA.id, rol: "TITULAR", activo: true },
      ],
    });

    const [proyectoA1, proyectoB1] = await Promise.all([
      prisma.proyecto.create({
        data: { organizacionId: orgA.id, clienteId: clienteA1.id, creadoPorId: duenoA.id, nombre: "Proyecto A1" },
      }),
      prisma.proyecto.create({
        data: { organizacionId: orgB.id, clienteId: clienteB.id, creadoPorId: duenoB.id, nombre: "Proyecto B1" },
      }),
    ]);

    const tokenDuenoA = await token({ tipoAcceso: "ORGANIZACION", usuarioId: duenoA.id, organizacionId: orgA.id, rolOrganizacion: "PROPIETARIO" });
    const tokenColabA = await token({ tipoAcceso: "ORGANIZACION", usuarioId: colabA.id, organizacionId: orgA.id, rolOrganizacion: "COLABORADOR" });
    const tokenDuenoB = await token({ tipoAcceso: "ORGANIZACION", usuarioId: duenoB.id, organizacionId: orgB.id, rolOrganizacion: "PROPIETARIO" });
    const tokenClienteA1 = await token({ tipoAcceso: "CLIENTE", usuarioId: usuarioClienteA.id, organizacionId: orgA.id, clienteId: clienteA1.id, rolCliente: "TITULAR" });

    // Regresiones: el importe debe ser decimal exacto y PAGADA exige pagos reales.
    for (const monto of ["12abc", "1.234", "Infinity", 1e309]) {
      const respuesta = await pedir("/api/facturas", tokenDuenoA, "POST", {
        clienteId: clienteA1.id, concepto: "Monto inválido", monto,
      });
      assert.equal(respuesta.status, 422, `Debe rechazar el monto ${String(monto)}`);
    }
    const pagadaSinPago = await pedir("/api/facturas", tokenDuenoA, "POST", {
      clienteId: clienteA1.id, concepto: "Sin pago", monto: 100, estado: "PAGADA",
    });
    assert.equal(pagadaSinPago.status, 422);
    const facturaSinPagos = await pedir("/api/facturas", tokenDuenoA, "POST", {
      clienteId: clienteA1.id, concepto: "Estado sin abonos", monto: 100, numero: "TEST-ESTADO-SIN-PAGOS",
    });
    assert.equal(facturaSinPagos.status, 201);
    const sinPagos = await facturaSinPagos.json() as { id: string };
    assert.equal((await pedir(`/api/facturas/${sinPagos.id}`, tokenDuenoA, "PATCH", { estado: "PAGADA" })).status, 422);
    assert.equal((await pedir(`/api/facturas/${sinPagos.id}`, tokenDuenoA, "PATCH", { monto: "12abc" })).status, 422);
    assert.equal((await pedir(`/api/facturas/${sinPagos.id}`, tokenDuenoA, "DELETE")).status, 204);

    // -------------------------------------------------------------
    // PRUEBA 1: Concurrencia y numeración correlativa por organización
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de concurrencia de numeración correlativa...");
    const peticionesConcurrencia = Array.from({ length: 10 }, (_, i) =>
      pedir(
        "/api/facturas",
        tokenDuenoA,
        "POST",
        {
          clienteId: clienteA1.id,
          proyectoId: proyectoA1.id,
          concepto: `Factura concurrente ${i + 1}`,
          monto: 100 + i,
          moneda: "PAB",
          estado: "ENVIADA",
        }
      )
    );

    const respuestasConcurrencia = await Promise.all(peticionesConcurrencia);
    for (const res of respuestasConcurrencia) {
      assert.equal(res.status, 201, "Todas las facturas concurrentes deben crearse con código 201");
    }

    const cuerpos = await Promise.all(respuestasConcurrencia.map((r) => r.json() as Promise<{ id: string; numero: string }>));
    const numerosGenerados = cuerpos.map((c) => c.numero).sort();
    const esperados = Array.from({ length: 10 }, (_, i) => `INV-${String(i + 1).padStart(4, "0")}`);
    assert.deepEqual(numerosGenerados, esperados, "Los números deben ser únicos y correlativos INV-0001 a INV-0010");

    // Verificar que Org B comienza su propia numeración en INV-0001
    const resOrgB = await pedir(
      "/api/facturas",
      tokenDuenoB,
      "POST",
      {
        clienteId: clienteB.id,
        proyectoId: proyectoB1.id,
        concepto: "Factura Org B",
        monto: 500,
        moneda: "USD",
      }
    );
    assert.equal(resOrgB.status, 201);
    const cuerpoOrgB = await resOrgB.json() as { numero: string };
    assert.equal(cuerpoOrgB.numero, "INV-0001", "La numeración de Org B debe ser independiente e iniciar en INV-0001");
    console.log("[issue12] Prueba de concurrencia y numeración correlativa: PASÓ");

    // -------------------------------------------------------------
    // PRUEBA 1.2: Inicialización con huecos y números heredados (MAX correlativo)
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de números heredados con huecos...");
    const duenoC = await prisma.usuario.create({ data: { correo: "duenoC12@example.test", nombre: "Dueño C", contrasenaHash: "fixture" } });
    const orgC = await prisma.organizacion.create({ data: { nombre: "Organización C", slug: "issue12-org-c" } });
    await prisma.miembroOrganizacion.create({ data: { usuarioId: duenoC.id, organizacionId: orgC.id, rol: "PROPIETARIO" } });
    const clienteC = await prisma.cliente.create({ data: { organizacionId: orgC.id, nombre: "Cliente C" } });
    const tokenDuenoC = await token({ tipoAcceso: "ORGANIZACION", usuarioId: duenoC.id, organizacionId: orgC.id, rolOrganizacion: "PROPIETARIO" });

    // Insertar manualmente facturas con huecos: INV-0003 e INV-0007 (sin fila en secuencias_facturas)
    await prisma.factura.createMany({
      data: [
        { organizacionId: orgC.id, clienteId: clienteC.id, numero: "INV-0003", concepto: "Factura heredada 3", monto: 100, moneda: "PAB" },
        { organizacionId: orgC.id, clienteId: clienteC.id, numero: "INV-0007", concepto: "Factura heredada 7", monto: 200, moneda: "PAB" },
      ],
    });

    // La creación automática sin número debe inicializar a partir del MAX (7) y generar INV-0008, NO INV-0001 ni INV-0003 ni INV-0004
    const resOrgC = await pedir("/api/facturas", tokenDuenoC, "POST", {
      clienteId: clienteC.id,
      concepto: "Factura tras huecos",
      monto: 350,
      moneda: "PAB",
    });
    assert.equal(resOrgC.status, 201);
    const cuerpoOrgC = await resOrgC.json() as { numero: string };
    assert.equal(cuerpoOrgC.numero, "INV-0008", "Debe inicializar la secuencia a partir del mayor correlativo existente (INV-0007 -> INV-0008)");
    console.log("[issue12] Prueba de números heredados con huecos: PASÓ");

    // -------------------------------------------------------------
    // PRUEBA 2: Control de acceso y roles (PROPIETARIO vs COLABORADOR)
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de permisos por rol...");
    const facturaEjemploId = cuerpos[0].id;

    // COLABORADOR no puede crear facturas
    const colabCrea = await pedir(
      "/api/facturas",
      tokenColabA,
      "POST",
      { clienteId: clienteA1.id, concepto: "Intento Colab", monto: 50 }
    );
    assert.equal(colabCrea.status, 403, "Colaborador no debe poder crear facturas (403)");

    // COLABORADOR no puede editar facturas
    const colabEdita = await pedir(
      `/api/facturas/${facturaEjemploId}`,
      tokenColabA,
      "PATCH",
      { concepto: "Concepto editado" }
    );
    assert.equal(colabEdita.status, 403, "Colaborador no debe poder editar facturas (403)");

    // COLABORADOR no puede registrar pagos
    const colabPaga = await pedir(
      `/api/facturas/${facturaEjemploId}/pagos`,
      tokenColabA,
      "POST",
      { monto: 10 }
    );
    assert.equal(colabPaga.status, 403, "Colaborador no debe poder registrar pagos (403)");

    // COLABORADOR no puede eliminar facturas
    const colabElimina = await pedir(
      `/api/facturas/${facturaEjemploId}`,
      tokenColabA,
      "DELETE"
    );
    assert.equal(colabElimina.status, 403, "Colaborador no debe poder eliminar facturas (403)");

    // COLABORADOR SÍ puede listar facturas (lectura CRM)
    const colabLista = await pedir("/api/facturas", tokenColabA, "GET");
    assert.equal(colabLista.status, 200, "Colaborador puede listar facturas");

    // CLIENTE no puede acceder a las rutas del CRM
    const clienteCrm = await pedir("/api/facturas", tokenClienteA1, "GET");
    assert.equal(clienteCrm.status, 403, "Cliente no puede acceder a /api/facturas del CRM");
    console.log("[issue12] Prueba de permisos por rol: PASÓ");

    // -------------------------------------------------------------
    // PRUEBA 2.2: Validación de coherencia cliente-proyecto
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de coherencia cliente-proyecto...");
    // Intentar crear factura con clienteA1 pero proyectoB1 (de otra organización) -> 422
    const resMalaCreacion = await pedir("/api/facturas", tokenDuenoA, "POST", {
      clienteId: clienteA1.id,
      proyectoId: proyectoB1.id,
      concepto: "Proyecto ajeno",
      monto: 100,
    });
    assert.equal(resMalaCreacion.status, 422, "No puede crearse factura con proyecto ajeno a la organización o cliente (422)");

    // Crear proyecto para cliente A2
    const proyectoA2 = await prisma.proyecto.create({
      data: { organizacionId: orgA.id, clienteId: clienteA2.id, creadoPorId: duenoA.id, nombre: "Proyecto A2" },
    });

    // Intentar asociar proyectoA2 (de clienteA2) a factura de clienteA1 en creación -> 422
    const resClienteMism = await pedir("/api/facturas", tokenDuenoA, "POST", {
      clienteId: clienteA1.id,
      proyectoId: proyectoA2.id,
      concepto: "Proyecto de otro cliente de la misma org",
      monto: 150,
    });
    assert.equal(resClienteMism.status, 422, "No puede crearse factura con proyecto de otro cliente (422)");

    // Intentar editar factura existente de clienteA1 para asignarle proyectoA2 -> 422
    const resEditMism = await pedir(`/api/facturas/${facturaEjemploId}`, tokenDuenoA, "PATCH", {
      proyectoId: proyectoA2.id,
    });
    assert.equal(resEditMism.status, 422, "No puede editarse factura para vincularla a proyecto de cliente distinto (422)");
    console.log("[issue12] Prueba de coherencia cliente-proyecto: PASÓ");

    // -------------------------------------------------------------
    // PRUEBA 3: Aislamiento entre organizaciones (Cross-Org)
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de aislamiento entre organizaciones...");
    // Org B intentando ver o manipular factura de Org A
    assert.equal((await pedir(`/api/facturas/${facturaEjemploId}`, tokenDuenoB, "GET")).status, 404);
    assert.equal((await pedir(`/api/facturas/${facturaEjemploId}`, tokenDuenoB, "PATCH", { concepto: "Hack" })).status, 404);
    assert.equal((await pedir(`/api/facturas/${facturaEjemploId}/pagos`, tokenDuenoB, "POST", { monto: 10 })).status, 404);
    assert.equal((await pedir(`/api/facturas/${facturaEjemploId}`, tokenDuenoB, "DELETE")).status, 404);
    console.log("[issue12] Prueba de aislamiento entre organizaciones: PASÓ");

    // -------------------------------------------------------------
    // PRUEBA 4: Cálculo de totales por moneda con Decimal
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de cálculo de totales en /totales...");
    // Crear una factura en USD en Org A para verificar separación estricta de divisas
    const resFacturaUsd = await pedir("/api/facturas", tokenDuenoA, "POST", {
      clienteId: clienteA1.id,
      concepto: "Servicio internacional USD",
      monto: 500,
      moneda: "USD",
      estado: "ENVIADA",
    });
    assert.equal(resFacturaUsd.status, 201);

    const resTotales = await pedir("/api/facturas/totales", tokenDuenoA, "GET");
    assert.equal(resTotales.status, 200);
    const totales = await resTotales.json() as {
      totalesPorMoneda: Array<{
        moneda: string;
        totalPorCobrar: number;
        totalCobrado: number;
        facturasEmitidas: number;
        facturasPendientes: number;
        facturasPagadas: number;
      }>;
    };
    assert.ok(Array.isArray(totales.totalesPorMoneda), "El contrato debe incluir totalesPorMoneda como array");
    assert.deepEqual(Object.keys(totales), ["totalesPorMoneda"], "No debe publicar un importe global de la primera moneda");
    const totalPab = totales.totalesPorMoneda.find((t) => t.moneda === "PAB");
    const totalUsd = totales.totalesPorMoneda.find((t) => t.moneda === "USD");
    assert.ok(totalPab, "Debe existir registro de totales para PAB");
    assert.ok(totalUsd, "Debe existir registro de totales para USD");

    assert.equal(totalPab.facturasEmitidas, 10);
    assert.equal(totalPab.facturasPendientes, 10);
    assert.equal(totalPab.facturasPagadas, 0);
    assert.equal(totalPab.totalPorCobrar, 1045);
    assert.equal(totalPab.totalCobrado, 0);

    assert.equal(totalUsd.facturasEmitidas, 1);
    assert.equal(totalUsd.facturasPendientes, 1);
    assert.equal(totalUsd.facturasPagadas, 0);
    assert.equal(totalUsd.totalPorCobrar, 500);
    assert.equal(totalUsd.totalCobrado, 0);
    console.log("[issue12] Prueba de cálculo de totales por moneda: PASÓ");

    // -------------------------------------------------------------
    // PRUEBA 5: Registro de pagos, saldo pendiente y transición automática
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de pagos y transición automática a PAGADA...");
    // Crear factura de 1000 PAB
    const resNuevaFactura = await pedir(
      "/api/facturas",
      tokenDuenoA,
      "POST",
      {
        clienteId: clienteA1.id,
        concepto: "Servicio de desarrollo",
        monto: 1000,
        moneda: "PAB",
        estado: "ENVIADA",
        visibleEnPortal: true,
      }
    );
    assert.equal(resNuevaFactura.status, 201);
    const facturaPago = await resNuevaFactura.json() as { id: string; numero: string };

    // 5.1 Rechazo por moneda no coincidente
    const pagoMonedaInvalida = await pedir(
      `/api/facturas/${facturaPago.id}/pagos`,
      tokenDuenoA,
      "POST",
      { monto: 100, moneda: "EUR" }
    );
    assert.equal(pagoMonedaInvalida.status, 422, "Moneda no coincidente debe retornar 422");

    // 5.2 Pago parcial de 400 PAB
    const resPago1 = await pedir(
      `/api/facturas/${facturaPago.id}/pagos`,
      tokenDuenoA,
      "POST",
      { monto: 400, moneda: "PAB", metodo: "TRANSFERENCIA", notas: "Primer anticipo" }
    );
    assert.equal(resPago1.status, 201);
    const cuerpoPago1 = await resPago1.json() as { saldoRestante: number; factura: { estado: string; pagadaEn: string | null } };
    assert.equal(cuerpoPago1.saldoRestante, 600);
    assert.equal(cuerpoPago1.factura.estado, "ENVIADA", "Estado debe seguir ENVIADA tras pago parcial");
    assert.equal(cuerpoPago1.factura.pagadaEn, null);
    assert.equal((await pedir(`/api/facturas/${facturaPago.id}/pagos`, tokenDuenoA, "POST", { monto: "1.234" })).status, 422);

    for (const cambios of [
      { estado: "PAGADA" }, { monto: 1200 }, { moneda: "USD" }, { estado: "CANCELADA" },
    ]) {
      const respuesta = await pedir(`/api/facturas/${facturaPago.id}`, tokenDuenoA, "PATCH", cambios);
      assert.equal(respuesta.status, 422, "No debe alterar una factura con pago parcial incompatible");
    }

    // 5.3 Rechazo por sobrepago (intento de pagar 650 cuando quedan 600)
    const pagoExceso = await pedir(
      `/api/facturas/${facturaPago.id}/pagos`,
      tokenDuenoA,
      "POST",
      { monto: 650, moneda: "PAB" }
    );
    assert.equal(pagoExceso.status, 422, "Pago superior al saldo debe retornar 422");

    // 5.4 Pago restante de 600 PAB -> debe liquidar y pasar a PAGADA
    const resPago2 = await pedir(
      `/api/facturas/${facturaPago.id}/pagos`,
      tokenDuenoA,
      "POST",
      { monto: 600, moneda: "PAB", metodo: "ACH", referencia: "ACH-98765" }
    );
    assert.equal(resPago2.status, 201);
    const cuerpoPago2 = await resPago2.json() as { saldoRestante: number; factura: { estado: string; pagadaEn: string | null } };
    assert.equal(cuerpoPago2.saldoRestante, 0);
    assert.equal(cuerpoPago2.factura.estado, "PAGADA", "Debe pasar automáticamente a PAGADA");
    assert.ok(cuerpoPago2.factura.pagadaEn, "pagadaEn debe contener timestamp");
    const deshacerPagada = await pedir(`/api/facturas/${facturaPago.id}`, tokenDuenoA, "PATCH", { estado: "ENVIADA" });
    assert.equal(deshacerPagada.status, 422, "Una factura saldada no puede volver a pendiente con sus pagos intactos");

    // 5.5 Intentar pagar factura ya liquidada da 422
    const pagoSobrante = await pedir(
      `/api/facturas/${facturaPago.id}/pagos`,
      tokenDuenoA,
      "POST",
      { monto: 10 }
    );
    assert.equal(pagoSobrante.status, 422, "Pagar factura ya liquidada debe retornar 422");

    // 5.6 Verificar que no se puede eliminar una factura con pagos
    const intentoEliminar = await pedir(`/api/facturas/${facturaPago.id}`, tokenDuenoA, "DELETE");
    assert.equal(intentoEliminar.status, 409, "Factura con pagos registrados no debe poder ser eliminada (409)");
    console.log("[issue12] Prueba de pagos y saldo pendiente: PASÓ");

    // -------------------------------------------------------------
    // PRUEBA 5.B: Pagos concurrentes no pueden superar el saldo pendiente
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de pagos concurrentes sobre saldo...");
    const resFacturaConcurrente = await pedir("/api/facturas", tokenDuenoA, "POST", {
      clienteId: clienteA1.id,
      concepto: "Factura para prueba de concurrencia de pagos",
      monto: 1000,
      moneda: "PAB",
      estado: "ENVIADA",
    });
    assert.equal(resFacturaConcurrente.status, 201);
    const facturaConc = await resFacturaConcurrente.json() as { id: string };

    // Disparar dos pagos simultáneos de 600 PAB cada uno (600 + 600 = 1200 > 1000)
    const [pagoConc1, pagoConc2] = await Promise.all([
      pedir(`/api/facturas/${facturaConc.id}/pagos`, tokenDuenoA, "POST", { monto: 600, moneda: "PAB" }),
      pedir(`/api/facturas/${facturaConc.id}/pagos`, tokenDuenoA, "POST", { monto: 600, moneda: "PAB" }),
    ]);

    const codigos = [pagoConc1.status, pagoConc2.status].sort();
    assert.deepEqual(codigos, [201, 422], "Exactamente uno de los pagos concurrentes debe tener éxito (201) y el otro debe fallar por saldo insuficiente (422)");

    const pagosGuardados = await prisma.pago.findMany({ where: { facturaId: facturaConc.id } });
    const totalAbonado = pagosGuardados.reduce((acc, p) => acc + Number(p.monto), 0);
    assert.equal(totalAbonado, 600, "El total abonado no debe exceder 600 PAB");
    console.log("[issue12] Prueba de pagos concurrentes sobre saldo: PASÓ");

    // -------------------------------------------------------------
    // PRUEBA 6: Historial de transiciones de estado (HistorialFactura)
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de registro en HistorialFactura...");
    const historial = await prisma.historialFactura.findMany({
      where: { facturaId: facturaPago.id },
      orderBy: { creadoEn: "asc" },
    });
    assert.ok(historial.length >= 3, "Debe registrarse el historial completo de cambios");
    assert.equal(historial[0].estadoAnterior, null);
    assert.equal(historial[0].estadoNuevo, "ENVIADA");
    assert.equal(historial[0].usuarioId, duenoA.id);

    const ultimoCambio = historial[historial.length - 1];
    assert.equal(ultimoCambio.estadoAnterior, "ENVIADA");
    assert.equal(ultimoCambio.estadoNuevo, "PAGADA");
    assert.match(ultimoCambio.motivo || "", /Pago total/);
    console.log("[issue12] Prueba de HistorialFactura: PASÓ");

    // -------------------------------------------------------------
    // PRUEBA 7: Visibilidad y autorización en el Portal del Cliente
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de visibilidad en el portal del cliente...");
    const resOculta = await pedir("/api/facturas", tokenDuenoA, "POST", {
      clienteId: clienteA1.id, concepto: "Factura Oculta", monto: 200, visibleEnPortal: false, estado: "ENVIADA"
    });
    const fOculta = await resOculta.json() as { id: string };

    const resBorrador = await pedir("/api/facturas", tokenDuenoA, "POST", {
      clienteId: clienteA1.id, concepto: "Factura Borrador", monto: 300, visibleEnPortal: true, estado: "BORRADOR"
    });
    const fBorrador = await resBorrador.json() as { id: string };

    const resOtro = await pedir("/api/facturas", tokenDuenoA, "POST", {
      clienteId: clienteA2.id, concepto: "Factura Otro Cliente", monto: 400, visibleEnPortal: true, estado: "ENVIADA"
    });
    const fOtro = await resOtro.json() as { id: string };

    const resVisible = await pedir("/api/facturas", tokenDuenoA, "POST", {
      clienteId: clienteA1.id, concepto: "Factura Visible Autorizada", monto: 500, visibleEnPortal: true, estado: "ENVIADA"
    });
    const fVisible = await resVisible.json() as { id: string };

    const resPortal = await pedir("/api/portal/facturas", tokenClienteA1, "GET");
    assert.equal(resPortal.status, 200);
    const facturasPortal = await resPortal.json() as Array<{ id: string; concepto: string }>;
    const idsPortal = facturasPortal.map((f) => f.id);

    assert.ok(idsPortal.includes(fVisible.id), "Debe incluir factura visible autorizada");
    assert.ok(idsPortal.includes(facturaPago.id), "Debe incluir factura pagada autorizada");
    assert.ok(!idsPortal.includes(fOculta.id), "No debe incluir factura con visibleEnPortal: false");
    assert.ok(!idsPortal.includes(fBorrador.id), "No debe incluir factura en estado BORRADOR");
    assert.ok(!idsPortal.includes(fOtro.id), "No debe incluir facturas de otro cliente");

    assert.equal((await pedir("/api/organizacion", tokenDuenoA, "PATCH", { portalMostrarFinanzas: false })).status, 200);
    assert.deepEqual(await (await pedir("/api/portal/facturas", tokenClienteA1)).json(), [], "La organización desactivada no publica facturas");
    assert.equal((await pedir("/api/organizacion", tokenColabA, "PATCH", { portalMostrarFinanzas: true })).status, 403);
    assert.equal((await pedir("/api/organizacion", tokenDuenoA, "PATCH", { portalMostrarFinanzas: true })).status, 200);
    assert.equal((await pedir(`/api/facturas/${facturaPago.id}`, tokenDuenoA, "PATCH", { visibleEnPortal: false })).status, 200);
    const sinCompartir = await (await pedir("/api/portal/facturas", tokenClienteA1)).json() as Array<{ id: string }>;
    assert.ok(!sinCompartir.some((f) => f.id === facturaPago.id));
    assert.equal((await pedir(`/api/facturas/${facturaPago.id}`, tokenDuenoA, "PATCH", { visibleEnPortal: true })).status, 200);
    const compartidas = await (await pedir("/api/portal/facturas", tokenClienteA1)).json() as Array<{ id: string }>;
    assert.ok(compartidas.some((f) => f.id === facturaPago.id));
    assert.equal((await pedir(`/api/facturas/${fBorrador.id}`, tokenDuenoA, "PATCH", { estado: "ENVIADA", visibleEnPortal: true })).status, 200);
    const emitidas = await (await pedir("/api/portal/facturas", tokenClienteA1)).json() as Array<{ id: string }>;
    assert.ok(emitidas.some((f) => f.id === fBorrador.id), "El borrador emitido y compartido ya puede verse");

    console.log("[issue12] Prueba de visibilidad en el portal del cliente: PASÓ");

    // -------------------------------------------------------------
    // PRUEBA 8: Eliminación permitida solo sin pagos
    // -------------------------------------------------------------
    console.log("[issue12] Iniciando prueba de eliminación de facturas sin pagos...");
    const resEliminar = await pedir(`/api/facturas/${fOculta.id}`, tokenDuenoA, "DELETE");
    assert.equal(resEliminar.status, 204, "Factura sin pagos debe eliminarse correctamente");
    const buscaEliminada = await pedir(`/api/facturas/${fOculta.id}`, tokenDuenoA, "GET");
    assert.equal(buscaEliminada.status, 404, "Factura eliminada ya no debe existir");
    console.log("[issue12] Prueba de eliminación sin pagos: PASÓ");

    console.log("[issue12] TODAS LAS PRUEBAS DE INTEGRACIÓN PASARON EXITOSAMENTE.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[issue12] Error durante las pruebas:", error);
  process.exitCode = 1;
});
