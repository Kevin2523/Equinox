import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AlmacenLocal } from "../src/almacenamiento/archivos.js";
import { obtenerOrigenesPermitidos } from "../src/aplicacion.js";

async function probarAlmacenProduccion() {
  const envOriginal = { ...process.env };
  const dirTemp = await mkdtemp(path.join(os.tmpdir(), "equinox-prod-almacen-"));
  try {
    process.env.NODE_ENV = "production";
    process.env.ENTORNO = "produccion";
    delete process.env.EQUINOX_ARCHIVOS_DIR;

    const almacen = new AlmacenLocal();
    await assert.rejects(
      () => almacen.guardar(Buffer.from("hola mundo"), ".txt"),
      (err: any) => err?.estado === 503
    );

    process.env.EQUINOX_ARCHIVOS_DIR = dirTemp;
    const clave = await almacen.guardar(Buffer.from("contenido-produccion"), ".txt");
    assert.ok(clave.endsWith(".txt"));

    const leido = await almacen.leer(clave);
    assert.equal(leido.toString("utf8"), "contenido-produccion");

    const apartado = await almacen.apartar(clave);
    await apartado.restaurar();
    const leidoTrasRestaurar = await almacen.leer(clave);
    assert.equal(leidoTrasRestaurar.toString("utf8"), "contenido-produccion");

    await almacen.eliminar(clave);
    console.log("[prod-test] AlmacenLocal en producción con EQUINOX_ARCHIVOS_DIR: OK");
  } finally {
    process.env = envOriginal;
    await rm(dirTemp, { recursive: true, force: true });
  }
}

function probarCorsExplicito() {
  const envOriginal = { ...process.env };
  try {
    process.env.NODE_ENV = "development";
    process.env.ENTORNO = "desarrollo";
    delete process.env.ORIGENES_PERMITIDOS;
    assert.deepEqual(obtenerOrigenesPermitidos(), ["http://localhost:4200"]);

    process.env.NODE_ENV = "production";
    process.env.ENTORNO = "produccion";
    assert.deepEqual(obtenerOrigenesPermitidos(), []);

    process.env.ORIGENES_PERMITIDOS = "https://equinox.casa.local, http://192.168.1.50:8080/";
    assert.deepEqual(obtenerOrigenesPermitidos(), [
      "https://equinox.casa.local",
      "http://192.168.1.50:8080",
    ]);

    process.env.ORIGENES_PERMITIDOS = "*";
    assert.throws(() => obtenerOrigenesPermitidos(), /ORIGENES_PERMITIDOS/);

    console.log("[prod-test] CORS explícito (obtenerOrigenesPermitidos): OK");
  } finally {
    process.env = envOriginal;
  }
}

async function main() {
  await probarAlmacenProduccion();
  probarCorsExplicito();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
