import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();
const BASE_TEST = "equinox_issue5_test";
const BASES_PERMITIDAS = new Set([BASE_TEST]);

export function validarBasePortal(nombre: string): void {
  if (!BASES_PERMITIDAS.has(nombre)) throw new Error("Base de prueba no autorizada");
}

function urlMantenimientoLocal(valor: string): string {
  const url = new URL(valor);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/postgres") {
    throw new Error("Conexión administrativa no autorizada");
  }
  return url.toString();
}

async function verificarAdmin(admin: PrismaClient): Promise<void> {
  const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
  if (actual[0]?.nombre !== "postgres") throw new Error("El cliente administrativo no está conectado a postgres");
}

export async function prepararBasePortal(admin: PrismaClient): Promise<void> {
  validarBasePortal(BASE_TEST);
  await verificarAdmin(admin);
  await admin.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'equinox_issue5_test' AND pid <> pg_backend_pid()`;
  validarBasePortal(BASE_TEST);
  await verificarAdmin(admin);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_TEST}"`);
  validarBasePortal(BASE_TEST);
  await verificarAdmin(admin);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${BASE_TEST}"`);
}

export interface FallosLimpiezaPortal {
  terminar?: boolean;
  eliminar?: boolean;
  verificar?: boolean;
  recuperacionEliminar?: boolean;
  desconectar?: boolean;
}

export interface IntentosLimpiezaPortal {
  terminar: boolean;
  eliminar: boolean;
  verificar: boolean;
  recuperacion: boolean;
  desconectar: boolean;
}

export async function limpiarBasePortal(
  admin: PrismaClient,
  mantenimiento: string,
  fallos?: FallosLimpiezaPortal
): Promise<IntentosLimpiezaPortal> {
  const fallosActivos = process.env.NODE_ENV === "test" ? fallos : undefined;
  const intentos: IntentosLimpiezaPortal = {
    terminar: false, eliminar: false, verificar: false, recuperacion: false, desconectar: false,
  };
  const errores: string[] = [];
  let ausenciaConfirmada = false;
  let desconexionCorrecta = false;
  const registrarError = (fase: string) => {
    errores.push(fase);
    console.error(`[portal-limpieza] Falló ${fase}; se continúa con la fase siguiente.`);
  };

  // Cada fase es independiente. Una comprobación fallida impide solo la operación
  // destructiva de esa fase, nunca la verificación o recuperación posteriores.
  try {
    intentos.terminar = true;
    validarBasePortal(BASE_TEST);
    await verificarAdmin(admin);
    if (fallosActivos?.terminar) throw new Error("Fallo de prueba");
    await admin.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'equinox_issue5_test' AND pid <> pg_backend_pid()`;
  } catch { registrarError("terminar conexiones"); }

  try {
    intentos.eliminar = true;
    validarBasePortal(BASE_TEST);
    await verificarAdmin(admin);
    if (fallosActivos?.eliminar) throw new Error("Fallo de prueba");
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_TEST}"`);
  } catch { registrarError("eliminar la base"); }

  try {
    intentos.verificar = true;
    if (fallosActivos?.verificar) throw new Error("Fallo de prueba");
    await verificarAdmin(admin);
    const restantes: Array<{ datname: string }> = await admin.$queryRaw`
      SELECT datname FROM pg_database WHERE datname = 'equinox_issue5_test'`;
    ausenciaConfirmada = restantes.length === 0;
    if (!ausenciaConfirmada) registrarError("verificar ausencia de la base");
  } catch { registrarError("consultar pg_database"); }

  if (!ausenciaConfirmada) {
    intentos.recuperacion = true;
    let respaldo: PrismaClient | null = null;
    try {
      respaldo = new PrismaClient({ datasources: { db: { url: urlMantenimientoLocal(mantenimiento) } } });
      validarBasePortal(BASE_TEST);
      await verificarAdmin(respaldo);
      await respaldo.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'equinox_issue5_test' AND pid <> pg_backend_pid()`;
    } catch { registrarError("terminar conexiones en recuperación"); }
    try {
      if (!respaldo) throw new Error("Sin conexión de respaldo");
      validarBasePortal(BASE_TEST);
      await verificarAdmin(respaldo);
      if (fallosActivos?.recuperacionEliminar) throw new Error("Fallo de prueba");
      await respaldo.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_TEST}"`);
    } catch { registrarError("eliminar la base en recuperación"); }
    try {
      if (!respaldo) throw new Error("Sin conexión de respaldo");
      await verificarAdmin(respaldo);
      const restantes: Array<{ datname: string }> = await respaldo.$queryRaw`
        SELECT datname FROM pg_database WHERE datname = 'equinox_issue5_test'`;
      ausenciaConfirmada = restantes.length === 0;
      if (!ausenciaConfirmada) registrarError("verificar ausencia tras recuperación");
    } catch { registrarError("consultar pg_database en recuperación"); }
    if (respaldo) {
      try { await respaldo.$disconnect(); }
      catch { registrarError("desconectar respaldo"); }
    }
  }

  try {
    intentos.desconectar = true;
    if (fallosActivos?.desconectar) throw new Error("Fallo de prueba");
    await admin.$disconnect();
    desconexionCorrecta = true;
  } catch {
    registrarError("desconectar administrador");
    try { await admin.$disconnect(); desconexionCorrecta = true; }
    catch { registrarError("reintentar desconexión administrativa"); }
  }

  if (!ausenciaConfirmada || !desconexionCorrecta) {
    throw new Error(`Limpieza incompleta: ${errores.join(", ") || "ausencia no confirmada"}`);
  }
  if (errores.length) console.log(`[portal-limpieza] ${errores.length} incidencia(s) recuperada(s); base ausente confirmada.`);
  console.log("[portal] Base temporal eliminada y verificada ausente.");
  return intentos;
}

async function ejecutar() {
  const original = process.env.DATABASE_URL;
  if (!original) throw new Error("Falta configuración de PostgreSQL local");
  const url = new URL(original);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Solo PostgreSQL local está autorizado");
  const mantenimiento = new URL(url);
  mantenimiento.pathname = "/postgres";
  const prueba = new URL(url);
  prueba.pathname = `/${BASE_TEST}`;
  const urlSegura = urlMantenimientoLocal(mantenimiento.toString());
  validarBasePortal(prueba.pathname.slice(1));

  const admin = new PrismaClient({ datasources: { db: { url: urlSegura } } });
  try {
    await prepararBasePortal(admin);
    const baseEntorno = { ...process.env, DATABASE_URL: prueba.toString(), NODE_ENV: "test", ENTORNO: "pruebas",
      SECRETO_JWT: "secreto-ficticio-local-exclusivo-de-suite-portal-issue-5", VENCIMIENTO_JWT: "1h" };
    const migracion = spawnSync("node", ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: baseEntorno, stdio: "inherit" });
    if (migracion.status !== 0) throw new Error(`Migración temporal falló: ${migracion.status}`);
    const casos = spawnSync("node", ["node_modules/tsx/dist/cli.mjs", "test/casos-portal.ts"],
      { env: baseEntorno, stdio: "inherit" });
    if (casos.status !== 0) throw new Error(`Casos del portal fallaron: ${casos.status}`);
    const limpieza = spawnSync("node", ["node_modules/tsx/dist/cli.mjs", "test/casos-limpieza-portal.ts"],
      { env: baseEntorno, stdio: "inherit" });
    if (limpieza.status !== 0) throw new Error(`Casos de limpieza fallaron: ${limpieza.status}`);
  } finally {
    await limpiarBasePortal(admin, urlSegura);
  }
}

if (process.argv[1]?.endsWith("ejecutar-portal.ts")) {
  ejecutar().catch(() => { console.error("[portal] Falló el orquestador de pruebas."); process.exitCode = 1; });
}
