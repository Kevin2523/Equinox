import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();
const BASE = "equinox_issue10_test";

export async function limpiarBaseTemporal(fases: {
  restaurar: () => Promise<void>; terminar: () => Promise<void>; eliminar: () => Promise<void>;
  verificar: () => Promise<void>; desconectar: () => Promise<void>;
}) {
  const errores: string[] = [];
  let destinoSeguro = false;
  for (const [nombre, ejecutar] of Object.entries(fases)) {
    try {
      if (nombre === "eliminar" && !destinoSeguro) throw new Error("Destino administrativo no confirmado");
      await ejecutar();
      if (nombre === "restaurar") destinoSeguro = true;
    } catch { errores.push(nombre); }
  }
  if (errores.length) throw new Error(`Falló la limpieza: ${errores.join(", ")}`);
}

async function main() {
  const original = process.env.DATABASE_URL;
  if (!original) throw new Error("Falta la configuración local de PostgreSQL");
  const url = new URL(original);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("PostgreSQL no es local");
  const mantenimiento = new URL(url);
  mantenimiento.pathname = "/postgres";
  const prueba = new URL(url);
  prueba.pathname = `/${BASE}`;
  if (prueba.pathname !== "/equinox_issue10_test" || mantenimiento.pathname !== "/postgres") throw new Error("Destino no autorizado");
  const admin = new PrismaClient({ datasources: { db: { url: mantenimiento.toString() } } });
  let creada = false;
  try {
    const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`;
    if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres");
    const previa: Array<{ existe: boolean }> = await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'equinox_issue10_test') AS existe`;
    if (previa[0]?.existe) throw new Error("La base temporal ya existe; no se modificó");
    await admin.$executeRawUnsafe('CREATE DATABASE "equinox_issue10_test"');
    creada = true;
    const clientePrueba = new PrismaClient({ datasources: { db: { url: prueba.toString() } } });
    try {
      const destino: Array<{ nombre: string }> = await clientePrueba.$queryRaw`SELECT current_database() AS nombre`;
      if (destino[0]?.nombre !== BASE) throw new Error("La base de pruebas no coincide con el destino autorizado");
    } finally { await clientePrueba.$disconnect(); }
    const entorno = { ...process.env, DATABASE_URL: prueba.toString(), NODE_ENV: "test", ENTORNO: "pruebas",
      SECRETO_JWT: "clave-ficticia-issue10-solo-pruebas", VENCIMIENTO_JWT: "1h" };
    for (const [comando, argumentos] of [
      ["node", ["node_modules/prisma/build/index.js", "migrate", "deploy"]],
      ["node", ["node_modules/tsx/dist/cli.mjs", "test/casos-issue10.ts"]],
    ] as const) {
      const resultado = spawnSync(comando, argumentos, { env: entorno, encoding: "utf8", stdio: "pipe" });
      if (argumentos.at(-1) === "test/casos-issue10.ts") {
        for (const linea of (resultado.stdout || "").split(/\r?\n/)) {
          if (linea.startsWith("[issue10]")) console.log(linea);
        }
      }
      if (resultado.status !== 0) throw new Error(`La fase de prueba falló con código ${resultado.status}`);
      console.log(`[issue10] ${argumentos.at(-1)}: código 0`);
    }
  } finally {
    if (creada) {
      await limpiarBaseTemporal({
        restaurar: async () => { const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`; if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres"); },
        terminar: async () => { await admin.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'equinox_issue10_test' AND pid <> pg_backend_pid()`; },
        eliminar: async () => { const actual: Array<{ nombre: string }> = await admin.$queryRaw`SELECT current_database() AS nombre`; if (actual[0]?.nombre !== "postgres") throw new Error("Administración fuera de postgres"); await admin.$executeRawUnsafe('DROP DATABASE "equinox_issue10_test"'); },
        verificar: async () => { const restantes: Array<{ existe: boolean }> = await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'equinox_issue10_test') AS existe`; if (restantes[0]?.existe) throw new Error("La base temporal sigue presente"); console.log("[issue10] Base temporal ausente tras la prueba"); },
        desconectar: async () => { await admin.$disconnect(); },
      });
    } else await admin.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/ejecutar-issue10.ts"))
  main().catch(() => { console.error("[issue10] Falló la prueba o la limpieza; consulta el estado de la base temporal antes de repetir"); process.exitCode = 1; });
