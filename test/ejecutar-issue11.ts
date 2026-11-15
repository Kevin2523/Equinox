import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();
const BASE = "equinox_issue11_test";

async function main() {
  const original = process.env.DATABASE_URL;
  if (!original) throw new Error("Falta conexión local de pruebas");
  const url = new URL(original);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("PostgreSQL no es local");
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const pruebaUrl = new URL(url); pruebaUrl.pathname = `/${BASE}`;
  if (adminUrl.pathname !== "/postgres" || pruebaUrl.pathname !== `/${BASE}`) throw new Error("Destino no autorizado");
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  let creada = false;
  let almacenamiento: string | null = null;
  const errores: string[] = [];
  try {
    const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
    if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres");
    const previa: Array<{ existe: boolean }> = await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'equinox_issue11_test') AS existe`;
    if (previa[0]?.existe) throw new Error("La base desechable ya existe");
    almacenamiento = await mkdtemp(path.join(os.tmpdir(), "equinox-issue11-"));
    if ((await readdir(almacenamiento)).length) throw new Error("Almacenamiento temporal no vacío");
    await admin.$executeRawUnsafe('CREATE DATABASE "equinox_issue11_test"');
    creada = true;
    const prueba = new PrismaClient({ datasources: { db: { url: pruebaUrl.toString() } } });
    try {
      const destino: Array<{ nombre: string }> = await prueba.$queryRaw`SELECT current_database() AS nombre`;
      if (destino[0]?.nombre !== BASE) throw new Error("La base de pruebas no coincide");
    } finally { await prueba.$disconnect(); }
    const env = { ...process.env, DATABASE_URL: pruebaUrl.toString(), EQUINOX_ARCHIVOS_DIR: almacenamiento,
      NODE_ENV: "test", ENTORNO: "pruebas", SECRETO_JWT: "clave-ficticia-issue11-solo-pruebas", VENCIMIENTO_JWT: "1h" };
    for (const args of [
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      ["node_modules/tsx/dist/cli.mjs", "test/casos-issue11.ts"],
    ]) {
      const resultado = spawnSync("node", args, { env, encoding: "utf8", stdio: "pipe" });
      for (const linea of (resultado.stdout || "").split(/\r?\n/)) if (linea.startsWith("[issue11]")) console.log(linea);
      if (resultado.status !== 0) throw new Error(`Fase de prueba falló: ${args.at(-1)}`);
      console.log(`[issue11] ${args.at(-1)}: código 0`);
    }
  } finally {
    if (creada) {
      try {
        const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
        if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres");
        await admin.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'equinox_issue11_test' AND pid <> pg_backend_pid()`;
      } catch { errores.push("terminar conexiones"); }
      try {
        const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
        if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres");
        await admin.$executeRawUnsafe('DROP DATABASE "equinox_issue11_test"');
      } catch { errores.push("eliminar base"); }
      try {
        const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
        if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres");
        const restante: Array<{ existe: boolean }> = await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'equinox_issue11_test') AS existe`;
        if (restante[0]?.existe) errores.push("base todavía presente");
        else console.log("[issue11] Base temporal ausente");
      } catch { errores.push("verificar base"); }
    }
    try { await admin.$disconnect(); } catch { errores.push("desconectar administración"); }
    if (almacenamiento) {
      const resuelta = path.resolve(almacenamiento);
      if (path.dirname(resuelta) === path.resolve(os.tmpdir()) && path.basename(resuelta).startsWith("equinox-issue11-")) {
        try { await rm(resuelta, { recursive: true }); console.log("[issue11] Almacenamiento temporal ausente"); }
        catch { errores.push("retirar almacenamiento temporal"); }
      } else errores.push("ruta de almacenamiento no autorizada");
    }
    if (errores.length) throw new Error(`Limpieza incompleta: ${errores.join(", ")}`);
  }
}
main().catch(() => { console.error("[issue11] Prueba o limpieza falló; revisar destinos temporales antes de repetir"); process.exitCode = 1; });
