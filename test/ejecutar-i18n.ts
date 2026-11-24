import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const BASE_TEST = "equinox_i18n_test";

function obtenerConfiguracion() {
  const urlOriginal = process.env.DATABASE_URL;
  if (!urlOriginal) {
    throw new Error("DATABASE_URL no está configurada en .env ni en el entorno");
  }

  const parsedUrl = new URL(urlOriginal);
  const hostname = parsedUrl.hostname.toLowerCase();

  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `Por seguridad, las pruebas solo pueden ejecutarse contra localhost o 127.0.0.1. Host detectado: '${hostname}'`
    );
  }

  const urlMantenimiento = new URL(urlOriginal);
  urlMantenimiento.pathname = "/postgres";

  const urlPrueba = new URL(urlOriginal);
  urlPrueba.pathname = `/${BASE_TEST}`;

  if (urlPrueba.pathname.replace(/^\//, "") !== BASE_TEST) {
    throw new Error(`[SEGURIDAD] Base de prueba inválida: ${urlPrueba.pathname}`);
  }

  return {
    urlMantenimiento: urlMantenimiento.toString(),
    urlPrueba: urlPrueba.toString(),
    host: parsedUrl.host,
  };
}

async function cerrarConexionesBase(prismaAdmin: PrismaClient) {
  await prismaAdmin.$executeRawUnsafe(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = 'equinox_i18n_test' AND pid <> pg_backend_pid();
  `);
}

async function ejecutar() {
  const { urlMantenimiento, urlPrueba, host } = obtenerConfiguracion();
  console.log(`[orquestador-i18n] Conectando administrativamente a PostgreSQL en ${host}...`);

  const prismaAdmin = new PrismaClient({
    datasources: { db: { url: urlMantenimiento } },
  });

  try {
    console.log(`[orquestador-i18n] Preparando base aislada '${BASE_TEST}'...`);
    await cerrarConexionesBase(prismaAdmin);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS equinox_i18n_test;`);
    await prismaAdmin.$executeRawUnsafe(`CREATE DATABASE equinox_i18n_test;`);

    console.log("[orquestador-i18n] Aplicando migraciones versionadas...");
    const migrarProc = spawnSync(
      "node",
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        env: { ...process.env, DATABASE_URL: urlPrueba },
        stdio: "inherit",
      }
    );

    if (migrarProc.status !== 0) {
      throw new Error(`Fallo al aplicar migraciones (código: ${migrarProc.status})`);
    }

    console.log("[orquestador-i18n] Ejecutando casos de prueba i18n...");
    const testProc = spawnSync(
      "node",
      ["node_modules/tsx/dist/cli.mjs", "test/casos-i18n.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: urlPrueba,
          ENTORNO: "pruebas",
          NODE_ENV: "test",
          SECRETO_JWT: "secreto-de-prueba-aislado-fijo-para-i18n-test-suite",
          VENCIMIENTO_JWT: "1h",
        },
        stdio: "inherit",
      }
    );

    if (testProc.status !== 0) {
      throw new Error(`Fallo en los casos de prueba i18n (código: ${testProc.status})`);
    }

    console.log("[orquestador-i18n] Suite i18n completada exitosamente.");
  } finally {
    console.log(`[orquestador-i18n] Eliminando base temporal '${BASE_TEST}'...`);
    try {
      await cerrarConexionesBase(prismaAdmin);
      await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS equinox_i18n_test;`);
    } catch (err) {
      console.error("[orquestador-i18n] Error limpiando base temporal:", err);
      process.exitCode = 1;
    } finally {
      await prismaAdmin.$disconnect();
    }
  }
}

ejecutar().catch((err) => {
  console.error("[orquestador-i18n] Error fatal:", err.message);
  process.exit(1);
});
