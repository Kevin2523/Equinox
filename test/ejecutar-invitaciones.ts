import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const BASE_TEST = "equinox_issue4_test";

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
    WHERE datname = 'equinox_issue4_test' AND pid <> pg_backend_pid();
  `);
}

async function ejecutar() {
  const { urlMantenimiento, urlPrueba, host } = obtenerConfiguracion();

  console.log(`[orquestador-issue4] Conectando administrativamente a PostgreSQL en ${host}...`);

  const prismaAdmin = new PrismaClient({
    datasources: {
      db: {
        url: urlMantenimiento,
      },
    },
  });

  try {
    console.log(`[orquestador-issue4] Preparando base aislada '${BASE_TEST}'...`);
    await cerrarConexionesBase(prismaAdmin);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS equinox_issue4_test;`);
    await prismaAdmin.$executeRawUnsafe(`CREATE DATABASE equinox_issue4_test;`);
    console.log(`[orquestador-issue4] Base '${BASE_TEST}' creada con éxito.`);

    console.log("[orquestador-issue4] Aplicando migraciones versionadas...");
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
      throw new Error(`Fallo al aplicar migraciones (código: ${migrarProc.status})`);
    }

    console.log("[orquestador-issue4] Ejecutando suite de casos de invitaciones...");
    const secretoJwtPruebas = "secreto-de-prueba-aislado-fijo-para-issue-4-test-suite";
    const testProc = spawnSync(
      "node",
      ["node_modules/tsx/dist/cli.mjs", "test/casos-invitaciones.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: urlPrueba,
          ENTORNO: "pruebas",
          NODE_ENV: "test",
          SECRETO_JWT: secretoJwtPruebas,
          VENCIMIENTO_JWT: "1h",
        },
        stdio: "inherit",
      }
    );

    if (testProc.status !== 0) {
      throw new Error(`Fallo en los casos de prueba de invitaciones (código: ${testProc.status})`);
    }

    console.log("[orquestador-issue4] Casos de prueba completados exitosamente.");
  } finally {
    console.log(`[orquestador-issue4] Limpiando y eliminando base aislada '${BASE_TEST}'...`);
    try {
      await cerrarConexionesBase(prismaAdmin);
      await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS equinox_issue4_test;`);

      const existe: Array<{ datname: string }> = await prismaAdmin.$queryRaw`
        SELECT datname FROM pg_database WHERE datname = 'equinox_issue4_test';
      `;
      if (existe.length > 0) {
        console.error(`[ERROR] La base '${BASE_TEST}' aún existe en pg_database.`);
        process.exitCode = 1;
      } else {
        console.log(`[orquestador-issue4] Confirmado: base '${BASE_TEST}' eliminada correctamente de pg_database.`);
      }
    } catch (limpiezaErr) {
      console.error("[orquestador-issue4] Error durante la eliminación de la base temporal:", limpiezaErr);
      process.exitCode = 1;
    } finally {
      await prismaAdmin.$disconnect();
    }
  }
}

ejecutar().catch((err) => {
  console.error("[orquestador-issue4] Error fatal:", err.message);
  process.exit(1);
});
