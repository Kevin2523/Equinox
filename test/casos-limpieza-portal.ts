import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { limpiarBasePortal, prepararBasePortal, validarBasePortal } from "./ejecutar-portal.js";

const urlOriginal = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1"].includes(urlOriginal.hostname) ||
    urlOriginal.pathname !== "/equinox_issue5_test" || process.env.NODE_ENV !== "test") {
  throw new Error("Destino de prueba no autorizado");
}
const mantenimiento = new URL(urlOriginal);
mantenimiento.pathname = "/postgres";

async function admin() {
  const cliente = new PrismaClient({ datasources: { db: { url: mantenimiento.toString() } } });
  const actual: Array<{ nombre: string }> = await cliente.$queryRaw`SELECT current_database() AS nombre`;
  assert.equal(actual[0]?.nombre, "postgres");
  return cliente;
}

async function ausente() {
  const cliente = await admin();
  try {
    const filas: Array<{ datname: string }> = await cliente.$queryRaw`
      SELECT datname FROM pg_database WHERE datname = 'equinox_issue5_test'`;
    return filas.length === 0;
  } finally { await cliente.$disconnect(); }
}

async function ejecutar() {
  let casos = 0;
  const caso = async (nombre: string, accion: () => Promise<void>) => {
    await accion();
    casos++;
    console.log(`[portal-limpieza] Caso ${casos} OK: ${nombre}`);
  };
  await caso("allowlist cerrada rechaza la base principal y otras bases", async () => {
    assert.throws(() => validarBasePortal("equinox"));
    assert.throws(() => validarBasePortal("equinox_issue4_test"));
    assert.doesNotThrow(() => validarBasePortal("equinox_issue5_test"));
  });
  await caso("fallo al terminar no omite DROP, verificación ni desconexión", async () => {
    const cliente = await admin();
    const intentos = await limpiarBasePortal(cliente, mantenimiento.toString(), { terminar: true });
    assert.deepEqual(intentos, { terminar: true, eliminar: true, verificar: true, recuperacion: false, desconectar: true });
    assert.equal(await ausente(), true);
  });
  await caso("fallo de DROP verifica presencia y recupera con base permitida", async () => {
    const cliente = await admin();
    await prepararBasePortal(cliente);
    const intentos = await limpiarBasePortal(cliente, mantenimiento.toString(), { eliminar: true });
    assert.deepEqual(intentos, { terminar: true, eliminar: true, verificar: true, recuperacion: true, desconectar: true });
    assert.equal(await ausente(), true);
  });
  await caso("fallo de consulta exige verificación independiente en recuperación", async () => {
    const cliente = await admin();
    await prepararBasePortal(cliente);
    const intentos = await limpiarBasePortal(cliente, mantenimiento.toString(), { verificar: true });
    assert.equal(intentos.recuperacion, true);
    assert.equal(intentos.desconectar, true);
    assert.equal(await ausente(), true);
  });
  await caso("si ambos DROP fallan, se señala error y se limpia después", async () => {
    const cliente = await admin();
    await prepararBasePortal(cliente);
    try {
      await assert.rejects(() => limpiarBasePortal(cliente, mantenimiento.toString(),
        { eliminar: true, recuperacionEliminar: true }), /Limpieza incompleta/);
      assert.equal(await ausente(), false);
    } finally {
      const rescate = await admin();
      await limpiarBasePortal(rescate, mantenimiento.toString());
    }
    assert.equal(await ausente(), true);
  });
  await caso("fallo de desconexión se reintenta tras confirmar ausencia", async () => {
    const cliente = await admin();
    await prepararBasePortal(cliente);
    const intentos = await limpiarBasePortal(cliente, mantenimiento.toString(), { desconectar: true });
    assert.equal(intentos.desconectar, true);
    assert.equal(await ausente(), true);
  });
  assert.equal(casos, 6);
  console.log(`[portal-limpieza] Suite completada: ${casos} casos ejecutados.`);
}

ejecutar().catch((err) => { console.error("[portal-limpieza] Prueba falló:", err.message); process.exitCode = 1; });
