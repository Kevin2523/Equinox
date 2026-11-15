import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

// 1. Cargar .env únicamente para obtener la conexión administrativa local
dotenv.config();

const BASE_TEST = "equinox_issue3_test";

function obtenerConfiguracion() {
  const urlOriginal = process.env.DATABASE_URL;
  if (!urlOriginal) {
    throw new Error("DATABASE_URL no está configurada en .env ni en el entorno");
  }

  const parsedUrl = new URL(urlOriginal);
  const hostname = parsedUrl.hostname.toLowerCase();

  // Validar que PostgreSQL esté en localhost o 127.0.0.1
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `Por seguridad, las pruebas solo pueden ejecutarse contra localhost o 127.0.0.1. Host detectado: '${hostname}'`
    );
  }

  // La base original en .env se usa únicamente como fuente de credenciales administrativas.
  // Construir las URLs explícitas preservando usuario, contraseña, puerto y parámetros
  const urlMantenimiento = new URL(urlOriginal);
  urlMantenimiento.pathname = "/postgres";

  const urlPrueba = new URL(urlOriginal);
  urlPrueba.pathname = `/${BASE_TEST}`;

  // Validar explícitamente que urlPrueba apunte exactamente a equinox_issue3_test
  const baseDestinoPrueba = urlPrueba.pathname.replace(/^\//, "");
  if (baseDestinoPrueba !== BASE_TEST) {
    throw new Error(
      `[SEGURIDAD] La base de prueba debe ser exactamente '${BASE_TEST}'. Detectada: '${baseDestinoPrueba}'`
    );
  }

  // Validar explícitamente que urlMantenimiento apunte exactamente a postgres
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
  // Terminar conexiones activas contra equinox_issue3_test exclusivamente usando la constante interna
  await prismaAdmin.$executeRawUnsafe(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = 'equinox_issue3_test' AND pid <> pg_backend_pid();
  `);
}

async function ejecutar() {
  const { urlMantenimiento, urlPrueba, host } = obtenerConfiguracion();

  // No imprimir contraseña, URL completa ni secretos
  console.log(`[orquestador] Conectando administrativamente a PostgreSQL en ${host}...`);

  // Crear PrismaClient administrativo apuntando a la base de mantenimiento 'postgres'
  const prismaAdmin = new PrismaClient({
    datasources: {
      db: {
        url: urlMantenimiento,
      },
    },
  });

  try {
    // Cerrar conexiones activas y recrear la base de datos temporal usando únicamente la constante interna fija
    console.log(`[orquestador] Preparando base aislada '${BASE_TEST}'...`);
    await cerrarConexionesBase(prismaAdmin);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS equinox_issue3_test;`);
    await prismaAdmin.$executeRawUnsafe(`CREATE DATABASE equinox_issue3_test;`);
    console.log(`[orquestador] Base '${BASE_TEST}' creada con éxito.`);

    // Ejecutar las migraciones con un proceso hijo apuntando a equinox_issue3_test
    console.log("[orquestador] Aplicando migraciones versionadas...");
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

    // Iniciar test/casos-autenticacion.ts como subproceso aislado
    console.log("[orquestador] Ejecutando suite de casos de autenticación...");
    const secretoJwtPruebas = "secreto-de-prueba-aislado-fijo-para-issue-3-test-suite";
    const testProc = spawnSync(
      "node",
      ["node_modules/tsx/dist/cli.mjs", "test/casos-autenticacion.ts"],
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
      throw new Error(`Fallo en los casos de prueba de autenticación (código: ${testProc.status})`);
    }

    console.log("[orquestador] Casos de prueba completados exitosamente.");
  } finally {
    // Limpieza garantizada en bloque finally: solo sobre la constante fija 'equinox_issue3_test'
    console.log(`[orquestador] Limpiando y eliminando base aislada '${BASE_TEST}'...`);
    try {
      await cerrarConexionesBase(prismaAdmin);
      await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS equinox_issue3_test;`);

      // Verificación de orquestador: consultar pg_database y confirmar que equinox_issue3_test ya no existe
      const existe: Array<{ datname: string }> = await prismaAdmin.$queryRaw`
        SELECT datname FROM pg_database WHERE datname = 'equinox_issue3_test';
      `;
      if (existe.length > 0) {
        console.error(`[ERROR] La base '${BASE_TEST}' aún existe en pg_database.`);
        process.exitCode = 1;
      } else {
        console.log(`[orquestador] Confirmado: base '${BASE_TEST}' eliminada correctamente de pg_database.`);
      }
    } catch (limpiezaErr) {
      console.error("[orquestador] Error durante la eliminación de la base temporal:", limpiezaErr);
      process.exitCode = 1;
    } finally {
      await prismaAdmin.$disconnect();
    }
  }
}

ejecutar().catch((err) => {
  console.error("[orquestador] Error fatal:", err.message);
  process.exit(1);
});
