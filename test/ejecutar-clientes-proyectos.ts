import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const BASE_TEST = "equinox_issue8_test";
const BASE_ADMIN = "postgres";

function validarBaseAllowlisted() {
  if (BASE_TEST !== "equinox_issue8_test") throw new Error("La base de pruebas no coincide con la allowlist cerrada.");
}

function configuracion() {
  const original = process.env.DATABASE_URL;
  if (!original) throw new Error("DATABASE_URL no está configurada.");
  let base: URL;
  try { base = new URL(original); } catch { throw new Error("DATABASE_URL no es válida."); }
  if (!new Set(["localhost", "127.0.0.1"]).has(base.hostname.toLowerCase())) {
    throw new Error("Las pruebas destructivas solo se permiten en PostgreSQL local.");
  }
  const admin = new URL(base);
  admin.pathname = `/${BASE_ADMIN}`;
  const test = new URL(base);
  test.pathname = `/${BASE_TEST}`;
  if (admin.pathname.slice(1) !== BASE_ADMIN || test.pathname.slice(1) !== BASE_TEST) {
    throw new Error("Las bases de administración o pruebas no coinciden con la allowlist.");
  }
  return { adminUrl: admin.toString(), testUrl: test.toString() };
}

async function verificarAdmin(admin: PrismaClient) {
  const resultado = await admin.$queryRaw<Array<{ current_database: string }>>`SELECT current_database();`;
  if (resultado[0]?.current_database !== BASE_ADMIN) throw new Error("La conexión administrativa no está en la base postgres.");
}

async function terminarConexiones(admin: PrismaClient) {
  validarBaseAllowlisted();
  await verificarAdmin(admin);
  await admin.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'equinox_issue8_test' AND pid <> pg_backend_pid();`;
}

function proceso(args: string[], env: NodeJS.ProcessEnv, etapa: string) {
  const resultado = spawnSync("node", args, { env, stdio: "inherit" });
  if (resultado.error || resultado.status !== 0) throw new Error(`${etapa} falló (código ${resultado.status ?? "sin código"}).`);
}

async function ejecutar() {
  const { adminUrl, testUrl } = configuracion();
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let suiteExitosa = false;
  try {
    await verificarAdmin(admin);
    await terminarConexiones(admin);
    validarBaseAllowlisted();
    await verificarAdmin(admin);
    await admin.$executeRaw`DROP DATABASE IF EXISTS equinox_issue8_test;`;
    validarBaseAllowlisted();
    await verificarAdmin(admin);
    await admin.$executeRaw`CREATE DATABASE equinox_issue8_test;`;

    proceso(["node_modules/prisma/build/index.js", "migrate", "deploy"], { ...process.env, DATABASE_URL: testUrl }, "Migración de base temporal");
    proceso(["node_modules/tsx/dist/cli.mjs", "test/casos-clientes-proyectos.ts"], {
      ...process.env,
      DATABASE_URL: testUrl,
      ENTORNO: "pruebas",
      NODE_ENV: "test",
      SECRETO_JWT: "secreto-pruebas-aislado-issue-8-no-produccion",
      VENCIMIENTO_JWT: "1h",
    }, "Suite clientes y proyectos");
    suiteExitosa = true;
  } finally {
    let ausente = false;
    try {
      validarBaseAllowlisted();
      await verificarAdmin(admin);
      await terminarConexiones(admin);
    } catch { console.error("[issue8] No se pudieron terminar las conexiones a la base temporal."); }
    try {
      validarBaseAllowlisted();
      await verificarAdmin(admin);
      await admin.$executeRaw`DROP DATABASE IF EXISTS equinox_issue8_test;`;
    } catch { console.error("[issue8] No se pudo eliminar la base temporal."); }
    try {
      await verificarAdmin(admin);
      const filas = await admin.$queryRaw<Array<{ datname: string }>>`SELECT datname FROM pg_database WHERE datname = 'equinox_issue8_test';`;
      ausente = filas.length === 0;
      if (!ausente) console.error("[issue8] La base temporal continúa presente.");
      else console.log("[issue8] Base temporal ausente verificada.");
    } catch { console.error("[issue8] No se pudo verificar la ausencia de la base temporal."); }
    try { await admin.$disconnect(); }
    catch { console.error("[issue8] No se pudo desconectar el cliente administrativo."); }
    if (!ausente || !suiteExitosa) process.exitCode = 1;
  }
}

ejecutar().catch(() => {
  console.error("[issue8] El orquestador de integración falló.");
  process.exitCode = 1;
});
