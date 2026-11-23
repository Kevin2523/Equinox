import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const BASE_TEST = "equinox_remediacion_seguridad_test";
const BASE_ADMIN = "postgres";
const DIR_FOTOS_TEST = path.resolve("./almacenamiento_privado/fotos_remediacion_test");

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
  urlMantenimiento.pathname = `/${BASE_ADMIN}`;

  const urlPrueba = new URL(urlOriginal);
  urlPrueba.pathname = `/${BASE_TEST}`;

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
    WHERE datname = '${BASE_TEST}' AND pid <> pg_backend_pid();
  `);
}

async function ejecutar() {
  const { urlMantenimiento, urlPrueba, host } = obtenerConfiguracion();
  console.log(`[remediacion-seguridad] Conectando administrativamente a PostgreSQL en ${host}...`);

  const prismaAdmin = new PrismaClient({
    datasources: {
      db: {
        url: urlMantenimiento,
      },
    },
  });

  let suiteExitosa = false;

  try {
    console.log(`[remediacion-seguridad] Creando base aislada '${BASE_TEST}'...`);
    await cerrarConexionesBase(prismaAdmin);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BASE_TEST};`);
    await prismaAdmin.$executeRawUnsafe(`CREATE DATABASE ${BASE_TEST};`);

    console.log("[remediacion-seguridad] Aplicando migraciones Prisma...");
    const migrarProc = spawnSync(
      "node",
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        env: {
          ...process.env,
          DATABASE_URL: urlPrueba,
        },
        stdio: "inherit",
      }
    );

    if (migrarProc.status !== 0) {
      throw new Error(`Fallo al aplicar migraciones en base de prueba (código: ${migrarProc.status})`);
    }

    console.log("[remediacion-seguridad] Ejecutando suite de regresión de seguridad...");
    const testProc = spawnSync(
      "node",
      ["node_modules/tsx/dist/cli.mjs", "test/casos-remediacion-seguridad.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: urlPrueba,
          NODE_ENV: "test",
          ENTORNO: "pruebas",
          SECRETO_JWT: "secreto-pruebas-aislado-remediacion-no-produccion",
          VENCIMIENTO_JWT: "1h",
          ALMACENAMIENTO_FOTOS_DIR: DIR_FOTOS_TEST,
        },
        stdio: "inherit",
      }
    );

    if (testProc.status !== 0) {
      throw new Error(`La suite de regresión falló (código: ${testProc.status})`);
    }

    suiteExitosa = true;
    console.log("[remediacion-seguridad] Suite finalizada con éxito.");
  } finally {
    console.log(`[remediacion-seguridad] Limpiando base aislada '${BASE_TEST}' y archivos temporales...`);
    try {
      await cerrarConexionesBase(prismaAdmin);
      await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BASE_TEST};`);
      console.log(`[remediacion-seguridad] Base '${BASE_TEST}' eliminada.`);
    } catch (cleanupErr: unknown) {
      console.warn(`[remediacion-seguridad] Advertencia al eliminar base temporal:`, cleanupErr);
    }
    try {
      fs.rmSync(DIR_FOTOS_TEST, { recursive: true, force: true });
    } catch {
      // Ignorar si no existe
    }
    await prismaAdmin.$disconnect();
    if (!suiteExitosa) process.exitCode = 1;
  }
}

ejecutar().catch((err) => {
  console.error("[remediacion-seguridad] Error fatal:", err);
  process.exit(1);
});
