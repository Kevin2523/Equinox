import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const BASE_TEST = "equinox_recuperacion_test";

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

  const baseDestinoPrueba = urlPrueba.pathname.replace(/^\//, "");
  if (baseDestinoPrueba !== BASE_TEST) {
    throw new Error(
      `[SEGURIDAD] La base de prueba debe ser exactamente '${BASE_TEST}'. Detectada: '${baseDestinoPrueba}'`
    );
  }

  const baseDestinoMantenimiento = urlMantenimiento.pathname.replace(/^\//, "");
  if (baseDestinoMantenimiento !== "postgres") {
    throw new Error(
      `[SEGURIDAD] La base de mantenimiento debe ser exactamente 'postgres'. Detectada: '${baseDestinoMantenimiento}'`
    );
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
    WHERE datname = 'equinox_recuperacion_test' AND pid <> pg_backend_pid();
  `);
}

async function ejecutar() {
  const { urlMantenimiento, urlPrueba, host } = obtenerConfiguracion();

  console.log(`[orquestador-recuperacion] Conectando administrativamente a PostgreSQL en ${host}...`);

  const prismaAdmin = new PrismaClient({
    datasources: {
      db: {
        url: urlMantenimiento,
      },
    },
  });

  try {
    console.log(`[orquestador-recuperacion] Preparando base aislada '${BASE_TEST}'...`);
    await cerrarConexionesBase(prismaAdmin);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS equinox_recuperacion_test;`);
    await prismaAdmin.$executeRawUnsafe(`CREATE DATABASE equinox_recuperacion_test;`);
    console.log(`[orquestador-recuperacion] Base '${BASE_TEST}' creada con éxito.`);

    console.log("[orquestador-recuperacion] Aplicando migraciones versionadas con Prisma...");
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

    console.log("[orquestador-recuperacion] Ejecutando suite completa de recuperación de contraseña...");
    const testProc = spawnSync(
      "node",
      ["node_modules/tsx/dist/cli.mjs", "test/casos-recuperacion.ts"],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL: urlPrueba,
          URL_BASE: "http://localhost:4200",
          SECRETO_JWT: "secreto-aislado-fijo-recuperacion-suite-test",
        },
        stdio: "inherit",
      }
    );

    if (testProc.status !== 0) {
      throw new Error(`La suite de pruebas de recuperación falló con código ${testProc.status}`);
    }

    console.log("[orquestador-recuperacion] ¡Todas las pruebas finalizaron con éxito!");
  } finally {
    try {
      console.log(`[orquestador-recuperacion] Limpiando base aislada '${BASE_TEST}'...`);
      await cerrarConexionesBase(prismaAdmin);
      await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS equinox_recuperacion_test;`);
      console.log(`[orquestador-recuperacion] Base '${BASE_TEST}' eliminada correctamente.`);
    } catch (limpiezaErr: any) {
      console.warn(`[orquestador-recuperacion] Advertencia en limpieza final: ${limpiezaErr.message}`);
    } finally {
      await prismaAdmin.$disconnect();
    }
  }
}

ejecutar().catch((err) => {
  console.error("[orquestador-recuperacion] Error fatal:", err.message);
  process.exit(1);
});
