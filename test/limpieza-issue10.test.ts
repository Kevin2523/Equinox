import assert from "node:assert/strict";
import { test } from "node:test";
import { limpiarBaseTemporal } from "./ejecutar-issue10.js";

for (const fallo of ["restaurar", "terminar", "eliminar", "verificar", "desconectar"]) {
  test(`limpieza intenta fases independientes tras fallo en ${fallo}`, async () => {
    const intentadas: string[] = [];
    let existe = true;
    let conectada = true;
    const fases = Object.fromEntries(["restaurar", "terminar", "eliminar", "verificar", "desconectar"].map((nombre) => [nombre, async () => {
      intentadas.push(nombre);
      if (nombre === fallo) throw new Error("fallo inyectado");
      if (nombre === "eliminar") existe = false;
      if (nombre === "verificar" && existe) throw new Error("base aún presente");
      if (nombre === "desconectar") conectada = false;
    }])) as Parameters<typeof limpiarBaseTemporal>[0];
    await assert.rejects(limpiarBaseTemporal(fases), /Falló la limpieza/);
    assert.deepEqual(intentadas, fallo === "restaurar" ? ["restaurar", "terminar", "verificar", "desconectar"] :
      ["restaurar", "terminar", "eliminar", "verificar", "desconectar"]);
    if (fallo !== "restaurar" && fallo !== "eliminar") assert.equal(existe, false);
    if (fallo !== "desconectar") assert.equal(conectada, false);
  });
}
