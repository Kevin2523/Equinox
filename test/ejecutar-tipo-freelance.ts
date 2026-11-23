import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const BASE_TEST = "equinox_issue3_test";
const BASE_ADMIN = "postgres";

function validarBaseAllowlisted() {
  if (BASE_TEST !== "equinox_issue3_test") {
    throw new Error("La base de pruebas no coincide con la allowlist cerrada.");
  }
}

function configuracion() {
  const original = process.env.DATABASE_URL;
  if (!original) throw new Error("DATABASE_URL no está configurada.");
  let base: URL;
  try {
    base = new URL(original);
  } catch {
    throw new Error("DATABASE_URL no es válida.");
  }
  if (!new Set(["localhost", "127.0.0.1"]).has(base.hostname.toLowerCase())) {
    throw new Error("Las pruebas destructivas solo se permiten en PostgreSQL local.");
  }
  const admin = new URL(base);
  admin.pathname = `/${BASE_ADMIN}`;
  const test = new URL(base);
  test.pathname = `/${BASE_TEST}`;
  return { adminUrl: admin.toString(), testUrl: test.toString(), host: base.host };
}

async function verificarAdmin(admin: PrismaClient) {
  const resultado = await admin.$queryRaw<Array<{ current_database: string }>>`SELECT current_database();`;
  if (resultado[0]?.current_database !== BASE_ADMIN) {
    throw new Error("La conexión administrativa no está en la base postgres.");
  }
}

async function terminarConexiones(admin: PrismaClient) {
  validarBaseAllowlisted();
  await verificarAdmin(admin);
  await admin.$executeRawUnsafe(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = 'equinox_issue3_test' AND pid <> pg_backend_pid();
  `);
}

function proceso(cmd: string, args: string[], env: NodeJS.ProcessEnv, etapa: string) {
  const resultado = spawnSync(cmd, args, { env, stdio: "inherit" });
  if (resultado.error || resultado.status !== 0) {
    throw new Error(`${etapa} falló (código ${resultado.status ?? "sin código"}).`);
  }
}

async function ejecutar() {
  const { adminUrl, testUrl, host } = configuracion();
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let suiteExitosa = false;

  try {
    console.log(`[orquestador-tipo-freelance] Conectando a ${host}...`);
    await verificarAdmin(admin);
    await terminarConexiones(admin);
    validarBaseAllowlisted();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS equinox_issue3_test;`);
    validarBaseAllowlisted();
    await admin.$executeRawUnsafe(`CREATE DATABASE equinox_issue3_test;`);
    console.log(`[orquestador-tipo-freelance] Base '${BASE_TEST}' creada.`);

    console.log("[orquestador-tipo-freelance] Desplegando migraciones Prisma...");
    proceso(
      "node",
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { ...process.env, DATABASE_URL: testUrl },
      "Despliegue de migraciones"
    );

    console.log("[orquestador-tipo-freelance] Ejecutando suite de pruebas...");
    proceso(
      "node",
      ["node_modules/tsx/dist/cli.mjs", "test/casos-tipo-freelance.ts"],
      {
        ...process.env,
        DATABASE_URL: testUrl,
        ENTORNO: "pruebas",
        NODE_ENV: "test",
        SECRETO_JWT: "secreto-de-prueba-aislado-fijo-para-issue-3-test-suite",
        VENCIMIENTO_JWT: "1h",
      },
      "Ejecución de casos-tipo-freelance"
    );

    suiteExitosa = true;
    console.log("[orquestador-tipo-freelance] ¡Suite completada con éxito!");
  } finally {
    try {
      await terminarConexiones(admin);
      validarBaseAllowlisted();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS equinox_issue3_test;`);
    } catch (e) {
      console.warn("Advertencia al limpiar base de prueba:", e);
    }
    await admin.$disconnect();
    if (!suiteExitosa) {
      process.exit(1);
    }
  }
}

ejecutar().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
