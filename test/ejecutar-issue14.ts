import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

dotenv.config();
const BASE = "equinox_issue14_test" as const;

async function main() {
  const original = process.env.DATABASE_URL;
  if (!original) throw new Error("Falta DATABASE_URL local");
  const url = new URL(original);
  if (!(["localhost", "127.0.0.1"].includes(url.hostname) && ["postgresql:", "postgres:"].includes(url.protocol))) {
    throw new Error("PostgreSQL debe ser local");
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const testUrl = new URL(url);
  testUrl.pathname = `/${BASE}`;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  let creada = false;
  let directorioArchivos: string | undefined;
  const fallos: string[] = [];
  async function verificarAdmin() {
    const rows: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
    if (rows[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres");
  }
  try {
    await verificarAdmin();
    const previa: Array<{ existe: boolean }> = await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'equinox_issue14_test') AS existe`;
    if (previa[0]?.existe) throw new Error("La base equinox_issue14_test preexiste; no se modifica ni elimina");
    await verificarAdmin();
    await admin.$executeRawUnsafe('CREATE DATABASE "equinox_issue14_test"');
    creada = true;
    const test = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
    try {
      const rows: Array<{ nombre: string }> = await test.$queryRaw`SELECT current_database() AS nombre`;
      if (rows[0]?.nombre !== BASE) throw new Error("Destino de pruebas incorrecto");
    } finally { await test.$disconnect(); }
    directorioArchivos = await mkdtemp(path.join(tmpdir(), "equinox-issue14-"));
    const env = { ...process.env, DATABASE_URL: testUrl.toString(), EQUINOX_ARCHIVOS_DIR: directorioArchivos, NODE_ENV: "test", ENTORNO: "pruebas", SECRETO_JWT: "issue14-clave-ficticia-solo-pruebas", VENCIMIENTO_JWT: "1h" };
    for (const args of [
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      ["node_modules/tsx/dist/cli.mjs", "test/casos-issue14.ts"],
    ]) {
      const resultado = spawnSync("node", args, { env, encoding: "utf8", stdio: "pipe" });
      for (const linea of (resultado.stdout || "").split(/\r?\n/)) if (linea.startsWith("[issue14]")) console.log(linea);
      if (resultado.status !== 0) {
        console.error((resultado.stderr || "").replaceAll(testUrl.toString(), "[DATABASE_URL REDACTADA]"));
        throw new Error(`Fase fallida: ${args.at(-1)}`);
      }
      console.log(`[issue14] ${args.at(-1)}: código 0`);
    }
  } finally {
    if (directorioArchivos) {
      try { await rm(directorioArchivos, { recursive: true, force: true }); }
      catch { fallos.push("eliminar archivos temporales"); }
    }
    if (creada) {
      try { await verificarAdmin(); await admin.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'equinox_issue14_test' AND pid <> pg_backend_pid()`; }
      catch { fallos.push("terminar conexiones"); }
      try { await verificarAdmin(); await admin.$executeRawUnsafe('DROP DATABASE "equinox_issue14_test"'); }
      catch { fallos.push("eliminar base creada"); }
      try {
        await verificarAdmin();
        const rows: Array<{ existe: boolean }> = await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'equinox_issue14_test') AS existe`;
        if (rows[0]?.existe) fallos.push("base todavía presente");
        else console.log("[issue14] Base temporal ausente");
      } catch { fallos.push("verificar ausencia"); }
    }
    try { await admin.$disconnect(); } catch { fallos.push("desconectar administración"); }
    if (fallos.length) throw new Error(`Limpieza incompleta: ${fallos.join(", ")}`);
  }
}
main().catch((error) => { console.error("[issue14] Error:", error.message); process.exitCode = 1; });
