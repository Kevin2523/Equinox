import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();
const BASE = "equinox_issue12_test";

async function main() {
  const original = process.env.DATABASE_URL;
  if (!original) throw new Error("Falta conexión local de pruebas");
  const url = new URL(original);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("PostgreSQL no es local");

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const pruebaUrl = new URL(url);
  pruebaUrl.pathname = `/${BASE}`;

  if (adminUrl.pathname !== "/postgres" || pruebaUrl.pathname !== `/${BASE}`) {
    throw new Error("Destino no autorizado");
  }

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  let creada = false;
  const errores: string[] = [];

  try {
    const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
    if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres");

    // Si ya existe la base de pruebas, abortar inmediatamente sin modificarla ni borrarla
    const previa: Array<{ existe: boolean }> = await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'equinox_issue12_test') AS existe`;
    if (previa[0]?.existe) {
      throw new Error("La base desechable 'equinox_issue12_test' ya existe; ejecución abortada para no modificar datos preexistentes.");
    }

    await admin.$executeRawUnsafe('CREATE DATABASE "equinox_issue12_test"');
    creada = true;

    const prueba = new PrismaClient({ datasources: { db: { url: pruebaUrl.toString() } } });
    try {
      const destino: Array<{ nombre: string }> = await prueba.$queryRaw`SELECT current_database() AS nombre`;
      if (destino[0]?.nombre !== BASE) throw new Error("La base de pruebas no coincide");
    } finally {
      await prueba.$disconnect();
    }

    const env = {
      ...process.env,
      DATABASE_URL: pruebaUrl.toString(),
      NODE_ENV: "test",
      ENTORNO: "pruebas",
      SECRETO_JWT: "clave-ficticia-issue12-solo-pruebas",
      VENCIMIENTO_JWT: "1h",
    };

    for (const args of [
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      ["node_modules/tsx/dist/cli.mjs", "test/casos-issue12.ts"],
    ]) {
      const resultado = spawnSync("node", args, { env, encoding: "utf8", stdio: "pipe" });
      for (const linea of (resultado.stdout || "").split(/\r?\n/)) {
        if (linea.startsWith("[issue12]")) console.log(linea);
      }
      if (resultado.status !== 0) {
        console.error(resultado.stderr || resultado.stdout);
        throw new Error(`Fase de prueba falló: ${args.at(-1)}`);
      }
      console.log(`[issue12] ${args.at(-1)}: código 0`);
    }
  } finally {
    if (creada) {
      try {
        const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
        if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres");
        await admin.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'equinox_issue12_test' AND pid <> pg_backend_pid()`;
      } catch {
        errores.push("terminar conexiones");
      }
      try {
        const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
        if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres");
        await admin.$executeRawUnsafe('DROP DATABASE "equinox_issue12_test"');
      } catch {
        errores.push("eliminar base");
      }
      try {
        const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
        if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres");
        const restante: Array<{ existe: boolean }> = await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'equinox_issue12_test') AS existe`;
        if (restante[0]?.existe) errores.push("base todavía presente");
        else console.log("[issue12] Base temporal ausente");
      } catch {
        errores.push("verificar base");
      }
    }
    try {
      await admin.$disconnect();
    } catch {
      errores.push("desconectar administración");
    }

    if (errores.length) {
      throw new Error(`Limpieza incompleta: ${errores.join(", ")}`);
    }
  }
}

main().catch((err) => {
  console.error("[issue12] Prueba o limpieza falló; revisar destinos temporales antes de repetir:", err.message);
  process.exitCode = 1;
});
