import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/prisma.js";
import { aplicacion } from "../src/aplicacion.js";
import { firmarToken, hashToken } from "../src/middleware/autenticacion.js";
import type { ContextoSinSesion } from "../src/tipos.js";

const BASE_ESPERADA = "equinox_remediacion_seguridad_test";

async function verificarBaseActual() {
  const resultado: Array<{ current_database: string }> =
    await prisma.$queryRaw`SELECT current_database();`;
  const nombreActual = resultado[0]?.current_database;
  assert.equal(
    nombreActual,
    BASE_ESPERADA,
    `[SEGURIDAD CRÍTICA] Base actual '${nombreActual}' distinta de '${BASE_ESPERADA}'`
  );
}

async function ejecutar() {
  await verificarBaseActual();

  const servidor = createServer(aplicacion);
  let urlApi = "";
  await new Promise<void>((resolve) =>
    servidor.listen(0, "127.0.0.1", () => {
      const addr = servidor.address();
      if (addr && typeof addr !== "string") {
        urlApi = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    })
  );

  let casos = 0;
  async function caso(nombre: string, fn: () => Promise<void>) {
    await fn();
    casos++;
    console.log(`[remediacion] Caso ${casos} OK: ${nombre}`);
  }

  async function crearSesion(contexto: ContextoSinSesion) {
    const id = randomUUID();
    const firmado = firmarToken(contexto, id);
    await prisma.sesion.create({
      data: {
        id,
        usuarioId: contexto.usuarioId,
        tipoAcceso: contexto.tipoAcceso,
        tokenHash: hashToken(firmado.token),
        expiraEn: firmado.expiraEn,
      },
    });
    return firmado.token;
  }

  async function pedir(ruta: string, token?: string, metodo = "GET", cuerpo?: unknown) {
    const res = await fetch(`${urlApi}${ruta}`, {
      method: metodo,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    });
    const texto = await res.text();
    let datos: any = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = texto;
    }
    return { status: res.status, datos };
  }

  try {
    // Fixtures base
    const propietario = await prisma.usuario.create({
      data: { correo: "prop.remed@example.test", nombre: "Propietario", contrasenaHash: "fixture" },
    });
    const colaboradorOrg = await prisma.usuario.create({
      data: { correo: "colab.remed@example.test", nombre: "Colaborador Org", contrasenaHash: "fixture" },
    });
    const usuarioTitular = await prisma.usuario.create({
      data: { correo: "titular.remed@example.test", nombre: "Cliente Titular", contrasenaHash: "fixture" },
    });
    const usuarioColabCliente = await prisma.usuario.create({
      data: { correo: "colabcli.remed@example.test", nombre: "Cliente Colab", contrasenaHash: "fixture" },
    });

    const org = await prisma.organizacion.create({
      data: {
        nombre: "Estudio Remediación",
        slug: "estudio-remediacion",
        portalMostrarFinanzas: true,
        moneda: "PAB",
      },
    });

    await prisma.miembroOrganizacion.createMany({
      data: [
        { usuarioId: propietario.id, organizacionId: org.id, rol: "PROPIETARIO" },
        { usuarioId: colaboradorOrg.id, organizacionId: org.id, rol: "COLABORADOR" },
      ],
    });

    const clienteA = await prisma.cliente.create({
      data: { organizacionId: org.id, nombre: "Cliente A", correo: "clientea@example.test" },
    });
    const clienteB = await prisma.cliente.create({
      data: { organizacionId: org.id, nombre: "Cliente B", correo: "clienteb@example.test" },
    });

    await prisma.accesoCliente.createMany({
      data: [
        { usuarioId: usuarioTitular.id, clienteId: clienteA.id, organizacionId: org.id, rol: "TITULAR", activo: true },
        { usuarioId: usuarioColabCliente.id, clienteId: clienteA.id, organizacionId: org.id, rol: "COLABORADOR", activo: true },
      ],
    });

    const proyectoA = await prisma.proyecto.create({
      data: { organizacionId: org.id, clienteId: clienteA.id, creadoPorId: propietario.id, nombre: "Proyecto A" },
    });

    const tokenProp = await crearSesion({
      tipoAcceso: "ORGANIZACION",
      usuarioId: propietario.id,
      organizacionId: org.id,
      rolOrganizacion: "PROPIETARIO",
    });
    const tokenColabOrg = await crearSesion({
      tipoAcceso: "ORGANIZACION",
      usuarioId: colaboradorOrg.id,
      organizacionId: org.id,
      rolOrganizacion: "COLABORADOR",
    });
    const tokenTitular = await crearSesion({
      tipoAcceso: "CLIENTE",
      usuarioId: usuarioTitular.id,
      organizacionId: org.id,
      clienteId: clienteA.id,
      rolCliente: "TITULAR",
    });
    const tokenColabCliente = await crearSesion({
      tipoAcceso: "CLIENTE",
      usuarioId: usuarioColabCliente.id,
      organizacionId: org.id,
      clienteId: clienteA.id,
      rolCliente: "COLABORADOR",
    });

    // 1. Hallazgo 1: Excluir tokenHash y tokens legados de respuestas
    await caso("H1: GET /clientes/:id y GET /proyectos/:id excluyen tokenHash y accesosPortal", async () => {
      await prisma.invitacionCliente.create({
        data: {
          organizacionId: org.id,
          clienteId: clienteA.id,
          correo: "inv@example.test",
          tokenHash: "secreto-hash-no-exponer",
          rol: "TITULAR",
          expiraEn: new Date(Date.now() + 86_400_000),
          invitadoPorId: propietario.id,
        },
      });
      await prisma.accesoPortal.create({
        data: {
          clienteId: clienteA.id,
          proyectoId: proyectoA.id,
          token: "token-legado-texto-plano",
        },
      });

      const resCli = await pedir(`/api/clientes/${clienteA.id}`, tokenProp);
      assert.equal(resCli.status, 200);
      assert.equal(resCli.datos.accesosPortal, undefined);
      assert.equal(resCli.datos.invitacionesCliente.length, 1);
      assert.equal(resCli.datos.invitacionesCliente[0].tokenHash, undefined);
      assert.equal(resCli.datos.invitacionesCliente[0].correo, "inv@example.test");

      const resProy = await pedir(`/api/proyectos/${proyectoA.id}`, tokenProp);
      assert.equal(resProy.status, 200);
      assert.equal(resProy.datos.accesosPortal, undefined);
    });

    // 2. Hallazgo 2: RBAC en facturas (COLABORADOR solo lectura, PROPIETARIO CRUD)
    await caso("H2: RBAC facturas - COLABORADOR recibe 403 en POST/PATCH/DELETE y 200 en GET", async () => {
      const resCrearColab = await pedir("/api/facturas", tokenColabOrg, "POST", {
        clienteId: clienteA.id,
        numero: "FAC-RBAC-01",
        concepto: "Servicio",
        monto: 100,
      });
      assert.equal(resCrearColab.status, 403);

      const resCrearProp = await pedir("/api/facturas", tokenProp, "POST", {
        clienteId: clienteA.id,
        proyectoId: proyectoA.id,
        numero: "FAC-RBAC-01",
        concepto: "Servicio",
        monto: 100,
      });
      assert.equal(resCrearProp.status, 201);
      const facId = resCrearProp.datos.id;

      assert.equal((await pedir("/api/facturas", tokenColabOrg)).status, 200);
      assert.equal((await pedir(`/api/facturas/${facId}`, tokenColabOrg)).status, 200);
      assert.equal(
        (await pedir(`/api/facturas/${facId}`, tokenColabOrg, "PATCH", { monto: 200 })).status,
        403
      );
      assert.equal((await pedir(`/api/facturas/${facId}`, tokenColabOrg, "DELETE")).status, 403);
      assert.equal((await pedir(`/api/facturas/${facId}`, tokenProp, "DELETE")).status, 204);
    });

    // 3. Hallazgo 3: Propiedad proyecto-cliente al asociar/reasignar factura
    await caso("H3: PATCH /facturas/:id impide reasignar clienteId conservando proyectoId de otro cliente", async () => {
      const resFac = await pedir("/api/facturas", tokenProp, "POST", {
        clienteId: clienteA.id,
        proyectoId: proyectoA.id,
        numero: "FAC-PROP-01",
        concepto: "Servicio",
        monto: 500,
      });
      assert.equal(resFac.status, 201);
      const facId = resFac.datos.id;

      // Reasignar clienteId a clienteB sin limpiar proyectoId -> 422
      const resCruce = await pedir(`/api/facturas/${facId}`, tokenProp, "PATCH", {
        clienteId: clienteB.id,
      });
      assert.equal(resCruce.status, 422);

      // Reasignar clienteId a clienteB limpiando proyectoId: null -> 200
      const resLimpio = await pedir(`/api/facturas/${facId}`, tokenProp, "PATCH", {
        clienteId: clienteB.id,
        proyectoId: null,
      });
      assert.equal(resLimpio.status, 200);
      assert.equal(resLimpio.datos.clienteId, clienteB.id);
      assert.equal(resLimpio.datos.proyectoId, null);
    });

    // 4. Hallazgo 4: Rechazo de esquemas URL peligrosos en sitioWeb y rechazo JSON en archivos multipart
    await caso("H4: Rechazo de URLs javascript:, data:, file: en sitioWeb y JSON en archivos", async () => {
      for (const urlMala of [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
      ]) {
        const resArch = await pedir(`/api/proyectos/${proyectoA.id}/archivos`, tokenProp, "POST", {
          nombre: "Doc",
          nombreOriginal: "doc.html",
          url: urlMala,
          tipoMime: "text/html",
          tamanoBytes: 100,
          visibilidad: "CLIENTE",
        });
        assert.equal(resArch.status, 415, `Debe rechazar envío JSON con URL en archivo multipart: ${urlMala}`);

        const resCli = await pedir("/api/clientes", tokenProp, "POST", {
          nombre: "Cliente URL Mala",
          sitioWeb: urlMala,
        });
        assert.equal(resCli.status, 422, `Debe rechazar URL peligrosa en sitioWeb: ${urlMala}`);
      }
    });

    // 5. Hallazgo 5: Límites numéricos en monto, presupuesto y tamanoBytes
    await caso("H5: Límites numéricos previenen desbordamiento 500 en PostgreSQL", async () => {
      assert.equal(
        (await pedir("/api/facturas", tokenProp, "POST", {
          clienteId: clienteA.id,
          numero: "FAC-OVERFLOW-1",
          concepto: "Overflow",
          monto: 1e15,
        })).status,
        422
      );
      assert.equal(
        (await pedir("/api/facturas", tokenProp, "POST", {
          clienteId: clienteA.id,
          numero: "FAC-OVERFLOW-2",
          concepto: "Overflow decimal",
          monto: 9999999999.999,
        })).status,
        422
      );
      assert.equal(
        (await pedir("/api/proyectos", tokenProp, "POST", {
          clienteId: clienteA.id,
          nombre: "Proyecto Overflow",
          presupuesto: 1e15,
        })).status,
        422
      );
      assert.equal(
        (await pedir(`/api/proyectos/${proyectoA.id}/archivos`, tokenProp, "POST", {
          nombre: "Gigante",
          nombreOriginal: "big.bin",
          url: "https://cdn.example.test/big.bin",
          tipoMime: "application/octet-stream",
          tamanoBytes: 3_000_000_000,
        })).status,
        415
      );
    });

    // 6. Hallazgo 6: Validación de códigos de moneda ISO 4217
    await caso("H6: Validación de códigos de moneda ISO 4217 válidos", async () => {
      for (const bad of ["123", "   ", "XYZ", "AB"]) {
        assert.equal(
          (await pedir("/api/facturas", tokenProp, "POST", {
            clienteId: clienteA.id,
            numero: `FAC-MON-${bad.trim() || "blank"}`,
            concepto: "Test",
            monto: 50,
            moneda: bad,
          })).status,
          422
        );
        assert.equal(
          (await pedir("/api/proyectos", tokenProp, "POST", {
            clienteId: clienteA.id,
            nombre: "Proyecto Moneda",
            moneda: bad,
          })).status,
          422
        );
      }

      const resEur = await pedir("/api/facturas", tokenProp, "POST", {
        clienteId: clienteA.id,
        numero: "FAC-EUR-01",
        concepto: "Servicio EUR",
        monto: 100,
        moneda: "eur",
      });
      assert.equal(resEur.status, 201);
      assert.equal(resEur.datos.moneda, "EUR");
    });

    // 7. Hallazgo 7: Coherencia estado / pagadaEn en facturas
    await caso("H7: Coherencia estado/pagadaEn en PATCH /facturas/:id", async () => {
      const resFac = await pedir("/api/facturas", tokenProp, "POST", {
        clienteId: clienteA.id,
        numero: "FAC-EST-01",
        concepto: "Estado",
        monto: 300,
        estado: "CANCELADA",
      });
      assert.equal(resFac.status, 201);
      assert.equal(resFac.datos.pagadaEn, null);
      const facId = resFac.datos.id;

      // Enviar pagadaEn sin estado PAGADA -> 422
      const resIncoh = await pedir(`/api/facturas/${facId}`, tokenProp, "PATCH", {
        pagadaEn: "2026-11-16T10:00:00.000Z",
      });
      assert.equal(resIncoh.status, 422);

      // Marcar PAGADA directamente sin pagos -> 422 (regla issue-12)
      const resPagDirecta = await pedir(`/api/facturas/${facId}`, tokenProp, "PATCH", {
        estado: "PAGADA",
        pagadaEn: "2026-11-16T10:00:00.000Z",
      });
      assert.equal(resPagDirecta.status, 422);

      // Pasar a ENVIADA -> limpia pagadaEn a null
      const resEnv = await pedir(`/api/facturas/${facId}`, tokenProp, "PATCH", {
        estado: "ENVIADA",
      });
      assert.equal(resEnv.status, 200);
      assert.equal(resEnv.datos.pagadaEn, null);

      // Pagar mediante /pagos -> pasa a PAGADA y asigna pagadaEn
      const resPago = await pedir(`/api/facturas/${facId}/pagos`, tokenProp, "POST", {
        monto: 300,
        metodo: "ACH",
      });
      assert.equal(resPago.status, 201);
      const resVer = await pedir(`/api/facturas/${facId}`, tokenProp);
      assert.equal(resVer.status, 200);
      assert.equal(resVer.datos.estado, "PAGADA");
      assert.ok(resVer.datos.pagadaEn);
    });

    // 8. Hallazgo 8: Restricciones TITULAR / COLABORADOR en Portal
    await caso("H8: Portal facturas restringido a TITULAR (403 para COLABORADOR)", async () => {
      assert.equal((await pedir("/api/portal/facturas", tokenTitular)).status, 200);
      assert.equal((await pedir("/api/portal/facturas", tokenColabCliente)).status, 403);
      assert.equal((await pedir("/api/portal/proyectos", tokenColabCliente)).status, 200);
    });

    // 9. Hallazgo 9: Query params tipados
    await caso("H9: Query params inválidos devuelven 422 en lugar de 500", async () => {
      assert.equal((await pedir("/api/proyectos?clienteId=no-es-uuid", tokenProp)).status, 422);
      assert.equal((await pedir("/api/proyectos?estado=ESTADO_FALSO", tokenProp)).status, 422);
      assert.equal((await pedir("/api/clientes?estado=ESTADO_FALSO", tokenProp)).status, 422);
      assert.equal((await pedir("/api/proyectos?estado=&clienteId=", tokenProp)).status, 200);
      assert.equal((await pedir("/api/clientes?estado=&buscar=", tokenProp)).status, 200);
    });

    // 10. Hallazgo 10 / SEC-FOTO-01: Impedir borrado de cliente con sesiones fotográficas
    await caso("H10 / SEC-FOTO-01: DELETE /clientes/:id bloqueado (409) si tiene sesiones fotográficas", async () => {
      const clienteFoto = await prisma.cliente.create({
        data: { organizacionId: org.id, nombre: "Cliente Fotografía" },
      });
      const dirFotos = process.env.ALMACENAMIENTO_FOTOS_DIR!;
      fs.mkdirSync(dirFotos, { recursive: true });
      const keyArchivo = `${randomUUID()}.bin`;
      const rutaArchivo = path.join(dirFotos, keyArchivo);
      fs.writeFileSync(rutaArchivo, Buffer.from("foto-simulada"));

      const sesionFoto = await prisma.sesionFotografica.create({
        data: {
          organizacionId: org.id,
          clienteId: clienteFoto.id,
          nombre: "Sesión Boda",
          estado: "PUBLICADA",
          fotos: {
            create: {
              almacenamientoKey: keyArchivo,
              nombreOriginal: "boda.jpg",
              tipoMime: "image/jpeg",
              tamanoBytes: 13,
            },
          },
        },
      });

      const resDelBloq = await pedir(`/api/clientes/${clienteFoto.id}`, tokenProp, "DELETE");
      assert.equal(resDelBloq.status, 409);
      assert.ok(await prisma.sesionFotografica.findUnique({ where: { id: sesionFoto.id } }));
      assert.ok(fs.existsSync(rutaArchivo));

      // Cliente limpio sin proyectos, facturas ni sesiones sí se puede eliminar
      const clienteLimpio = await prisma.cliente.create({
        data: { organizacionId: org.id, nombre: "Cliente Sin Dependencias" },
      });
      const resDelOk = await pedir(`/api/clientes/${clienteLimpio.id}`, tokenProp, "DELETE");
      assert.equal(resDelOk.status, 204);
    });

    // 11. Hallazgo 11: Longitudes máximas (.max())
    await caso("H11: Longitudes máximas rechazadas con 422", async () => {
      assert.equal(
        (await pedir("/api/clientes", tokenProp, "POST", {
          nombre: "A".repeat(201),
        })).status,
        422
      );
      assert.equal(
        (await pedir("/api/clientes", tokenProp, "POST", {
          nombre: "Cliente Largo",
          notasInternas: "N".repeat(2001),
        })).status,
        422
      );
      assert.equal(
        (await pedir("/api/proyectos", tokenProp, "POST", {
          clienteId: clienteA.id,
          nombre: "P".repeat(201),
        })).status,
        422
      );
      assert.equal(
        (await pedir("/api/facturas", tokenProp, "POST", {
          clienteId: clienteA.id,
          numero: "X".repeat(101),
          concepto: "Normal",
          monto: 100,
        })).status,
        422
      );
    });

    console.log(`[remediacion] ✅ Todos los ${casos} casos de regresión pasaron.`);
  } finally {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
    await prisma.$disconnect();
  }
}

ejecutar().catch((err) => {
  console.error("[remediacion] Error en casos de prueba:", err);
  process.exit(1);
});
