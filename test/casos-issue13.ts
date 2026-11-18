import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";
import type { ContextoSinSesion } from "../src/tipos.js";

async function main() {
  const db: Array<{ nombre: string }> = await prisma.$queryRaw`SELECT current_database() AS nombre`;
  assert.equal(db[0]?.nombre, "equinox_issue13_test", "Debe ejecutarse estrictamente en equinox_issue13_test");

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

  async function subirArchivoMultipart(
    ruta: string,
    credencial: string,
    nombreArchivo: string,
    contenido: string,
    visibilidad: "INTERNA" | "CLIENTE"
  ) {
    const boundary = "----WebKitFormBoundary" + randomUUID().replace(/-/g, "");
    const chunks: Buffer[] = [];
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="${nombreArchivo}"\r\nContent-Type: text/plain\r\n\r\n${contenido}\r\n`
      )
    );
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="visibilidad"\r\n\r\n${visibilidad}\r\n`
      )
    );
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const cuerpo = Buffer.concat(chunks);

    return fetch(origin + ruta, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credencial}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: cuerpo,
    });
  }

  try {
    // 1. Usuarios de prueba
    const [duenoA, colabA, clienteUsuario] = await Promise.all([
      prisma.usuario.create({
        data: {
          correo: "dueno13@example.test",
          nombre: "Dueño",
          apellido: "Pruebas",
          contrasenaHash: "hash-fixture",
        },
      }),
      prisma.usuario.create({
        data: {
          correo: "colab13@example.test",
          nombre: "Colaborador",
          apellido: "Pruebas",
          contrasenaHash: "hash-fixture",
        },
      }),
      prisma.usuario.create({
        data: {
          correo: "cliente13@example.test",
          nombre: "Roberto",
          apellido: "Pérez",
          contrasenaHash: "hash-fixture",
        },
      }),
    ]);

    // 2. Organización nueva y membresías
    const org = await prisma.organizacion.create({
      data: {
        nombre: "Estudio Creativo Pacífico",
        slug: "estudio-creativo-pacifico",
        moneda: "PAB",
        colorPrimario: "#2563EB",
        colorSecundario: "#0F172A",
        tipografia: "Inter",
        portalMostrarFinanzas: true,
      },
    });

    await Promise.all([
      prisma.miembroOrganizacion.create({
        data: {
          organizacionId: org.id,
          usuarioId: duenoA.id,
          rol: "PROPIETARIO",
        },
      }),
      prisma.miembroOrganizacion.create({
        data: {
          organizacionId: org.id,
          usuarioId: colabA.id,
          rol: "COLABORADOR",
        },
      }),
    ]);

    const tokenDueno = await token({
      usuarioId: duenoA.id,
      tipoAcceso: "ORGANIZACION",
      organizacionId: org.id,
      rolOrganizacion: "PROPIETARIO",
    });

    const tokenColab = await token({
      usuarioId: colabA.id,
      tipoAcceso: "ORGANIZACION",
      organizacionId: org.id,
      rolOrganizacion: "COLABORADOR",
    });

    // Caso 1: Una cuenta nueva no contiene datos de demostración
    console.log("[issue13] Caso 1: Verificar que una cuenta nueva no contiene datos demo...");
    const [resClientes, resProyectos, resFacturas, resPanel] = await Promise.all([
      pedir("/api/clientes", tokenDueno),
      pedir("/api/proyectos", tokenDueno),
      pedir("/api/facturas", tokenDueno),
      pedir("/api/organizacion/panel", tokenDueno),
    ]);

    assert.equal(resClientes.status, 200);
    assert.deepEqual(await resClientes.json(), []);

    assert.equal(resProyectos.status, 200);
    assert.deepEqual(await resProyectos.json(), []);

    assert.equal(resFacturas.status, 200);
    assert.deepEqual(await resFacturas.json(), []);

    assert.equal(resPanel.status, 200);
    const datosPanel = await resPanel.json();
    assert.deepEqual(datosPanel.metricas, {
      clientesActivos: 0,
      proyectosEnCurso: 0,
      tareasVencidas: 0,
    });
    assert.deepEqual(datosPanel.proximasTareas, []);

    // Caso 2: Modificación de organización por PROPIETARIO vs COLABORADOR
    console.log("[issue13] Caso 2: Permisos de configuración de organización (PROPIETARIO vs COLABORADOR)...");
    const resColabPatch = await pedir("/api/organizacion", tokenColab, "PATCH", {
      nombre: "Nombre No Autorizado",
    });
    assert.equal(resColabPatch.status, 403, "Colaborador debe recibir 403 al intentar modificar organización");

    const resDuenoPatch = await pedir("/api/organizacion", tokenDueno, "PATCH", {
      nombre: "Mena Studios",
      descripcion: "Bienvenido al portal de seguimiento de Mena Studios.",
      moneda: "USD",
      colorPrimario: "#3568F6",
      colorSecundario: "#1E293B",
      tipografia: "DM Sans",
    });
    assert.equal(resDuenoPatch.status, 200, "Propietario debe poder actualizar organización");
    const orgActualizada = await resDuenoPatch.json();
    assert.equal(orgActualizada.nombre, "Mena Studios");
    assert.equal(orgActualizada.moneda, "USD");
    assert.equal(orgActualizada.colorPrimario, "#3568F6");

    // Caso 3: Operaciones reales de cliente, proyecto, archivo y descarga
    console.log("[issue13] Caso 3: Carga y descarga real de archivos sin simulaciones...");
    const resCrearCliente = await pedir("/api/clientes", tokenDueno, "POST", {
      nombre: "José Fotógrafo",
      empresa: "José Fotografía",
      correo: "jose@fotografia.test",
    });
    assert.equal(resCrearCliente.status, 201);
    const cliente = await resCrearCliente.json();

    const resCrearProyecto = await pedir("/api/proyectos", tokenDueno, "POST", {
      clienteId: cliente.id,
      nombre: "Sitio Web José Hidalgo",
      descripcion: "Desarrollo de portafolio web para fotografía profesional",
      estado: "ACTIVO",
      presupuesto: 750,
      moneda: "USD",
    });
    assert.equal(resCrearProyecto.status, 201);
    const proyecto = await resCrearProyecto.json();

    const contenidoArchivo = "CONTRATO Y ALCANCE PROFESIONAL V1.0";
    const resSubir = await subirArchivoMultipart(
      `/api/proyectos/${proyecto.id}/archivos`,
      tokenDueno,
      "contrato-alcance.txt",
      contenidoArchivo,
      "CLIENTE"
    );
    assert.equal(resSubir.status, 201);
    const archivoCreado = await resSubir.json();
    assert.equal(archivoCreado.nombreOriginal, "contrato-alcance.txt");
    assert.equal(archivoCreado.visibilidad, "CLIENTE");

    // Descarga desde el backend
    const resDescarga = await pedir(
      `/api/proyectos/${proyecto.id}/archivos/${archivoCreado.id}/descargar`,
      tokenDueno
    );
    assert.equal(resDescarga.status, 200);
    const textoDescargado = await resDescarga.text();
    assert.equal(textoDescargado, contenidoArchivo);

    // Caso 4: Portal del cliente con identidades dinámicas (sin Ana Rodríguez / Café Unido)
    console.log("[issue13] Caso 4: Identidades dinámicas en portal del cliente...");
    const accesoCliente = await prisma.accesoCliente.create({
      data: {
        usuarioId: clienteUsuario.id,
        clienteId: cliente.id,
        organizacionId: org.id,
        rol: "TITULAR",
      },
    });

    const tokenCliente = await token({
      usuarioId: clienteUsuario.id,
      tipoAcceso: "CLIENTE",
      clienteId: cliente.id,
      organizacionId: org.id,
      rolCliente: "TITULAR",
    });

    const resPortalIdentidad = await pedir("/api/portal", tokenCliente);
    assert.equal(resPortalIdentidad.status, 200);
    const identidad = await resPortalIdentidad.json();
    assert.equal(identidad.estudio.nombre, "Mena Studios");
    assert.equal(identidad.cliente.nombre, "José Fotógrafo");
    assert.notEqual(identidad.cliente.nombre, "Ana Rodríguez");
    assert.notEqual(identidad.estudio.nombre, "Café Unido");

    // El cliente puede descargar el archivo compartido
    const resPortalDescarga = await pedir(
      `/api/portal/proyectos/${proyecto.id}/archivos/${archivoCreado.id}/descargar`,
      tokenCliente
    );
    assert.equal(resPortalDescarga.status, 200);
    assert.equal(await resPortalDescarga.text(), contenidoArchivo);

    // Caso 5: Crear factura, autorizar en portal y registrar pago parcial real
    console.log("[issue13] Caso 5: Ciclo real de factura, autorización en portal y pago parcial...");
    const resFactura = await pedir("/api/facturas", tokenDueno, "POST", {
      clienteId: cliente.id,
      proyectoId: proyecto.id,
      concepto: "Anticipo 50% Sitio Web",
      monto: 375,
      moneda: "USD",
      visibleEnPortal: true,
      estado: "ENVIADA",
    });
    assert.equal(resFactura.status, 201);
    const factura = await resFactura.json();
    assert.equal(factura.numero, "INV-0001");
    assert.equal(factura.monto, "375");
    assert.equal(factura.visibleEnPortal, true);

    // Registrar pago parcial de $175
    const resPago = await pedir(`/api/facturas/${factura.id}/pagos`, tokenDueno, "POST", {
      monto: 175,
      moneda: "USD",
      metodo: "TRANSFERENCIA",
      referencia: "ACH-13-TEST",
      notas: "Pago parcial verificado",
    });
    assert.equal(resPago.status, 201);

    // Consultar factura actualizada
    const resFacturaActualizada = await pedir(`/api/facturas/${factura.id}`, tokenDueno);
    assert.equal(resFacturaActualizada.status, 200);
    const facturaActualizada = await resFacturaActualizada.json();
    assert.equal(facturaActualizada.montoPendiente, 200);
    assert.equal(facturaActualizada.estado, "ENVIADA");

    // Factura visible en portal de cliente
    const resPortalFacturas = await pedir("/api/portal/facturas", tokenCliente);
    assert.equal(resPortalFacturas.status, 200);
    const facturasPortal = await resPortalFacturas.json();
    assert.equal(facturasPortal.length, 1);
    assert.equal(facturasPortal[0].numero, "INV-0001");
    assert.equal(Number(facturasPortal[0].monto), 375);

    console.log("[issue13] Todos los casos de integración pasaron exitosamente.");
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[issue13] Error en casos:", error);
  process.exit(1);
});
