import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const BASE_TEST = "equinox_superadmin_foundation_test";

function obtenerConfiguracion() {
  const urlOriginal = process.env.DATABASE_URL;
  if (!urlOriginal) {
    throw new Error("DATABASE_URL no está configurada");
  }

  const parsedUrl = new URL(urlOriginal);
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Por seguridad, solo localhost/127.0.0.1 permitido. Detectado: ${hostname}`);
  }

  const urlMantenimiento = new URL(urlOriginal);
  urlMantenimiento.pathname = "/postgres";

  const urlPrueba = new URL(urlOriginal);
  urlPrueba.pathname = `/${BASE_TEST}`;

  return {
    urlMantenimiento: urlMantenimiento.toString(),
    urlPrueba: urlPrueba.toString(),
  };
}

async function cerrarConexiones(prismaAdmin: PrismaClient) {
  await prismaAdmin.$executeRawUnsafe(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '${BASE_TEST}' AND pid <> pg_backend_pid();
  `);
}

async function ejecutar() {
  const { urlMantenimiento, urlPrueba } = obtenerConfiguracion();
  const prismaAdmin = new PrismaClient({ datasources: { db: { url: urlMantenimiento } } });

  try {
    console.log(`[superadmin-foundation] Creando base aislada '${BASE_TEST}'...`);
    await cerrarConexiones(prismaAdmin);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BASE_TEST};`);
    await prismaAdmin.$executeRawUnsafe(`CREATE DATABASE ${BASE_TEST};`);

    console.log("[superadmin-foundation] Aplicando migraciones Prisma...");
    const migrar = spawnSync("node", ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: urlPrueba },
      stdio: "inherit",
    });
    if (migrar.status !== 0) {
      throw new Error(`Fallo migrate deploy (código ${migrar.status})`);
    }

    process.env.DATABASE_URL = urlPrueba;
    process.env.NODE_ENV = "test";
    process.env.SECRETO_JWT = "secreto-pruebas-superadmin-aislado-32chars";
    process.env.SECRETO_MFA = "secreto-mfa-pruebas-aislado-32chars";

    const { prisma } = await import("../src/prisma.js");
    const { ejecutarCasosSuperadminFoundation } = await import("./casos-superadmin-foundation.js");

    try {
      await ejecutarCasosSuperadminFoundation();
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    console.log(`[superadmin-foundation] Limpiando base aislada '${BASE_TEST}'...`);
    await cerrarConexiones(prismaAdmin);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BASE_TEST};`);
    await prismaAdmin.$disconnect();
  }
}

ejecutar().catch((err) => {
  console.error("[superadmin-foundation] Error:", err);
  process.exit(1);
});
