import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const BASE_TEST = "equinox_auditoria_auth_test";

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

  console.log(`[auditoria-auth] Conectando administrativamente a PostgreSQL en ${host}...`);

  const prismaAdmin = new PrismaClient({
    datasources: {
      db: {
        url: urlMantenimiento,
      },
    },
  });

  try {
    console.log(`[auditoria-auth] Creando base aislada '${BASE_TEST}'...`);
    await cerrarConexionesBase(prismaAdmin);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BASE_TEST};`);
    await prismaAdmin.$executeRawUnsafe(`CREATE DATABASE ${BASE_TEST};`);
    console.log(`[auditoria-auth] Base '${BASE_TEST}' creada.`);

    console.log("[auditoria-auth] Aplicando migraciones Prisma...");
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

    console.log("[auditoria-auth] Ejecutando pruebas de seguridad de autenticación...");
    const testProc = spawnSync(
      "node",
      ["node_modules/tsx/dist/cli.mjs", "test/casos-auditoria-auth-seguridad.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: urlPrueba,
          NODE_ENV: "test",
          ENTORNO: "desarrollo",
        },
        stdio: "inherit",
      }
    );

    if (testProc.status !== 0) {
      throw new Error(`Las pruebas de auditoría fallaron (código: ${testProc.status})`);
    }

    console.log("[auditoria-auth] Pruebas finalizadas con éxito.");
  } finally {
    console.log(`[auditoria-auth] Limpiando base aislada '${BASE_TEST}'...`);
    try {
      await cerrarConexionesBase(prismaAdmin);
      await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BASE_TEST};`);
      console.log(`[auditoria-auth] Base '${BASE_TEST}' eliminada.`);
    } catch (cleanupErr: any) {
      console.warn(`[auditoria-auth] Advertencia al eliminar base temporal: ${cleanupErr.message}`);
    }
    await prismaAdmin.$disconnect();
  }
}

ejecutar().catch((err) => {
  console.error("[auditoria-auth] Error fatal:", err);
  process.exit(1);
});
