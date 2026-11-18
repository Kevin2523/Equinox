import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const BASE_TEST = "equinox_integracion_admin_final_test";
const BASE_ADMIN = "postgres";
const DIR_FOTOS_TEST = path.resolve("./almacenamiento_privado/fotos_integracion_final_test");

function obtenerConfiguracion() {
  const urlOriginal = process.env.DATABASE_URL;
  if (!urlOriginal) {
    throw new Error("DATABASE_URL no está configurada.");
  }

  const parsedUrl = new URL(urlOriginal);
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Por seguridad, solo localhost/127.0.0.1 permitido. Detectado: ${hostname}`);
  }

  const urlMantenimiento = new URL(urlOriginal);
  urlMantenimiento.pathname = `/${BASE_ADMIN}`;

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
    console.log(`[integracion-admin-final] Creando base aislada '${BASE_TEST}'...`);
    await cerrarConexiones(prismaAdmin);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BASE_TEST};`);
    await prismaAdmin.$executeRawUnsafe(`CREATE DATABASE ${BASE_TEST};`);

    console.log("[integracion-admin-final] Aplicando migraciones Prisma desde cero...");
    const migrar = spawnSync("node", ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: urlPrueba },
      stdio: "inherit",
    });
    if (migrar.status !== 0) {
      throw new Error(`Fallo migrate deploy (código ${migrar.status})`);
    }

    fs.mkdirSync(DIR_FOTOS_TEST, { recursive: true });
    process.env.DATABASE_URL = urlPrueba;
    process.env.NODE_ENV = "test";
    process.env.SECRETO_JWT = "secreto-pruebas-integracion-admin-final-32chars";
    process.env.SECRETO_MFA = "secreto-mfa-integracion-admin-final-32chars";
    process.env.ALMACENAMIENTO_FOTOS_DIR = DIR_FOTOS_TEST;
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1";

    const { prisma } = await import("../src/prisma.js");
    const { ejecutarCasosIntegracionAdminFinal } = await import("./casos-integracion-admin-final.js");

    try {
      const res = await ejecutarCasosIntegracionAdminFinal();
      console.log("\n=== RESUMEN INTEGRACIÓN Y SEGURIDAD FINAL ===");
      for (const b of res.bloques) {
        console.log(`[${b.estado}] ${b.nombre}: ${b.detalle}`);
      }
      console.log("--- Regresiones Auditoría ---");
      for (const h of res.hallazgosAuditoria) {
        console.log(`[${h.estado}] (${h.id} / ${h.fuente}): ${h.detalle}`);
      }
      console.log(`UI Desktop: ${res.uiDesktopOk ? "OK" : "FALLO"} | UI Móvil: ${res.uiMovilOk ? "OK" : "FALLO"}`);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    console.log(`[integracion-admin-final] Limpiando base aislada '${BASE_TEST}' y temporales...`);
    await cerrarConexiones(prismaAdmin);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BASE_TEST};`);
    await prismaAdmin.$disconnect();
    fs.rmSync(DIR_FOTOS_TEST, { recursive: true, force: true });
  }
}

ejecutar().catch((err) => {
  console.error("[integracion-admin-final] Error:", err);
  process.exit(1);
});
