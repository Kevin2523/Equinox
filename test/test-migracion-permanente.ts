import "dotenv/config";
import { execSync } from "node:child_process";
import { readFileSync, renameSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const BASE_TEST = "equinox_migration_test";
const MIGRACION_DIR = resolve("prisma/migrations/20261026134500_indice_unico_invitacion_pendiente");
const MIGRACION_BACKUP = resolve(".20261026134500_indice_unico_invitacion_pendiente_bak");
const ARCHIVO_SQL_REAL = resolve(MIGRACION_DIR, "migration.sql");

// Lista cerrada de bases de datos permitidas para pruebas de migración
export const BASES_MIGRACION_PERMITIDAS = new Set([
  "equinox_migration_test",
  "equinox_migration_fallo1_test",
  "equinox_migration_fallo2_test",
  "equinox_migration_fase_restore_test",
  "equinox_migration_fase_restore_fatal_test",
  "equinox_migration_fase_terminate_test",
  "equinox_migration_fase_drop_test",
  "equinox_migration_fase_drop_ambos_test",
  "equinox_migration_fase_pgdb_test",
  "equinox_migration_fase_disc_test",
]);

export function validarNombreBaseMigracion(nombreBase: string): void {
  if (!nombreBase || typeof nombreBase !== "string") {
    throw new Error("[SEGURIDAD MIGRACION] Nombre de base de datos no proporcionado o inválido.");
  }
  const nombreLimpio = nombreBase.trim().toLowerCase();
  if (nombreLimpio === "equinox" || nombreLimpio === "postgres") {
    throw new Error(`[SEGURIDAD MIGRACION] Acceso prohibido a la base protegida '${nombreLimpio}'.`);
  }
  if (!BASES_MIGRACION_PERMITIDAS.has(nombreBase)) {
    throw new Error(
      `[SEGURIDAD MIGRACION] La base '${nombreBase}' no pertenece a la lista cerrada de bases permitidas.`
    );
  }
}

export interface FallosInyectadosFases {
  falloRestorePrimerIntento?: boolean;
  falloRestoreSegundoIntento?: boolean;
  falloTerminate?: boolean;
  falloDropPrimerIntento?: boolean;
  falloDropSegundoIntento?: boolean;
  falloConsultaPgDb?: boolean;
  falloDisconnect?: boolean;
}

export async function limpiarEntornoMigracion(
  prismaAdmin: PrismaClient | null,
  nombreBase: string,
  backupDir: string = MIGRACION_BACKUP,
  originalDir: string = MIGRACION_DIR,
  fallosInyectados?: FallosInyectadosFases,
  urlMantenimiento?: string
): Promise<void> {
  // Validación estricta y cerrada antes de cualquier operación
  validarNombreBaseMigracion(nombreBase);

  const errores: Error[] = [];
  let restoreExitoso = false;

  // 1. Restaurar siempre el directorio real de la migración si fue renombrado
  // Intento 1
  try {
    if (fallosInyectados?.falloRestorePrimerIntento) {
      throw new Error("Fallo inyectado controlado: falloRestorePrimerIntento");
    }
    if (existsSync(backupDir)) {
      renameSync(backupDir, originalDir);
      restoreExitoso = true;
      console.log(`[prueba-migracion-limpieza] Directorio de migración restaurado correctamente en intento 1.`);
    } else {
      restoreExitoso = true;
    }
  } catch (err: any) {
    console.error(`[prueba-migracion-limpieza] Error en primer intento de restaurar directorio:`, err.message);
    errores.push(err);

    // Segundo intento controlado de restore
    try {
      if (fallosInyectados?.falloRestoreSegundoIntento) {
        throw new Error("Fallo inyectado controlado: falloRestoreSegundoIntento");
      }
      if (existsSync(backupDir)) {
        renameSync(backupDir, originalDir);
        restoreExitoso = true;
        console.log(`[prueba-migracion-limpieza] Directorio de migración restaurado correctamente en intento 2.`);
      } else {
        restoreExitoso = true;
      }
    } catch (err2: any) {
      console.error(`[prueba-migracion-limpieza] Error en segundo intento de restaurar directorio:`, err2.message);
      errores.push(err2);
    }
  }

  // 2. Intentar siempre cerrar conexiones a la base temporal
  let clienteActual = prismaAdmin;
  let terminateExitoso = false;

  try {
    if (fallosInyectados?.falloTerminate) {
      throw new Error("Fallo inyectado controlado: falloTerminate");
    }
    if (clienteActual) {
      await clienteActual.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${nombreBase}' AND pid <> pg_backend_pid();`
      );
      terminateExitoso = true;
      console.log(`[prueba-migracion-limpieza] Conexiones a '${nombreBase}' terminadas.`);
    }
  } catch (err: any) {
    console.error(`[prueba-migracion-limpieza] Error al terminar conexiones:`, err.message);
    errores.push(err);
  }

  // 3. Intentar siempre eliminar la base temporal (con 2 intentos)
  let dropExitoso = false;
  try {
    if (fallosInyectados?.falloDropPrimerIntento) {
      throw new Error("Fallo inyectado controlado: falloDropPrimerIntento");
    }
    if (clienteActual) {
      await clienteActual.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nombreBase}";`);
      dropExitoso = true;
      console.log(`[prueba-migracion-limpieza] Base '${nombreBase}' eliminada en intento 1.`);
    }
  } catch (err: any) {
    console.error(`[prueba-migracion-limpieza] Error en primer intento de DROP DATABASE:`, err.message);
    errores.push(err);

    // Segundo intento controlado de DROP DATABASE
    try {
      if (fallosInyectados?.falloDropSegundoIntento) {
        throw new Error("Fallo inyectado controlado: falloDropSegundoIntento");
      }
      if (clienteActual) {
        await clienteActual.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nombreBase}";`);
        dropExitoso = true;
        console.log(`[prueba-migracion-limpieza] Base '${nombreBase}' eliminada en intento 2.`);
      }
    } catch (err2: any) {
      console.error(`[prueba-migracion-limpieza] Error en segundo intento de DROP DATABASE:`, err2.message);
      errores.push(err2);
    }
  }

  // 4. Verificar en pg_database que fue eliminada
  let verificacionPgDbExitosa = false;
  try {
    if (fallosInyectados?.falloConsultaPgDb) {
      throw new Error("Fallo inyectado controlado: falloConsultaPgDb");
    }
    if (clienteActual) {
      const dbsRestantes: any[] = await clienteActual.$queryRawUnsafe(
        `SELECT datname FROM pg_database WHERE datname = '${nombreBase}';`
      );
      assert.equal(
        dbsRestantes.length,
        0,
        `La base ${nombreBase} debe estar completamente eliminada de pg_database`
      );
      verificacionPgDbExitosa = true;
      console.log(`[prueba-migracion-limpieza] Confirmada eliminación en pg_database.`);
    }
  } catch (err: any) {
    console.error(`[prueba-migracion-limpieza] Error al verificar eliminación:`, err.message);
    errores.push(err);
  }

  // 5. Ejecutar siempre intento de desconexión del cliente principal
  let clienteDesconectado = false;
  try {
    if (fallosInyectados?.falloDisconnect) {
      throw new Error("Fallo inyectado controlado: falloDisconnect");
    }
    if (clienteActual) {
      await clienteActual.$disconnect();
      clienteDesconectado = true;
      console.log(`[prueba-migracion-limpieza] Conexión administrativa desconectada.`);
    } else {
      clienteDesconectado = true;
    }
  } catch (err: any) {
    console.error(`[prueba-migracion-limpieza] Error al desconectar prismaAdmin:`, err.message);
    errores.push(err);
    // Intentar forzar cierre en catch
    try {
      if (clienteActual) {
        await clienteActual.$disconnect();
        clienteDesconectado = true;
        console.log(`[prueba-migracion-limpieza] Cliente desconectado en intento de recuperación.`);
      }
    } catch (errSecundario: any) {
      console.error(`[prueba-migracion-limpieza] También falló el intento de recuperación de $disconnect():`, errSecundario.message);
      errores.push(errSecundario);
    }
  }

  // 6. Si el drop o la verificación no se completaron, y hay urlMantenimiento, activar cliente de respaldo seguro
  if ((!dropExitoso || !verificacionPgDbExitosa) && urlMantenimiento) {
    console.log(`[prueba-migracion-limpieza] Activando cliente administrativo de respaldo para completar limpieza...`);
    const prismaRespaldo = new PrismaClient({
      datasources: { db: { url: urlMantenimiento } },
    });
    try {
      await prismaRespaldo.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${nombreBase}' AND pid <> pg_backend_pid();`
      );
      await prismaRespaldo.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nombreBase}";`);
      const dbsRespaldo: any[] = await prismaRespaldo.$queryRawUnsafe(
        `SELECT datname FROM pg_database WHERE datname = '${nombreBase}';`
      );
      assert.equal(dbsRespaldo.length, 0, `Base ${nombreBase} debe ser eliminada por el cliente de respaldo`);
      verificacionPgDbExitosa = true;
      dropExitoso = true;
      console.log(`[prueba-migracion-limpieza] Cliente de respaldo eliminó y verificó '${nombreBase}' exitosamente.`);
    } catch (errRespaldo: any) {
      console.error(`[prueba-migracion-limpieza] Error en cliente de respaldo:`, errRespaldo.message);
      errores.push(errRespaldo);
    } finally {
      try {
        await prismaRespaldo.$disconnect();
      } catch (errDisc: any) {
        errores.push(errDisc);
      }
    }
  }

  // 7. Verificación final de estado del entorno:
  // - el directorio original debe estar restaurado
  // - el backup no debe estar presente
  // - la base no debe existir en pg_database (verificado por verificacionPgDbExitosa)
  // - no debe haber fallos pendientes sin recuperar
  // Si alguna fase no se completó correctamente, o hubo errores acumulados no recuperados, se lanza error
  const fallosIncompletos: string[] = [];

  const dirRestauradoFinal = existsSync(originalDir);
  const backupPresenteFinal = existsSync(backupDir);

  if (!dirRestauradoFinal) {
    fallosIncompletos.push("El directorio original de la migración no fue restaurado.");
  }
  if (backupPresenteFinal) {
    fallosIncompletos.push("El directorio o archivo de backup aún sigue presente.");
  }
  if (!verificacionPgDbExitosa) {
    fallosIncompletos.push(`La base '${nombreBase}' todavía existe o no pudo confirmarse su eliminación en pg_database.`);
  }
  if (!clienteDesconectado) {
    fallosIncompletos.push("No se confirmó la desconexión del cliente administrativo.");
  }

  // Si no se pudo completar alguna fase o hay errores que no pudieron ser recuperados:
  if (fallosIncompletos.length > 0 || !dropExitoso || !restoreExitoso) {
    const msgIncompleto = `[LIMPIEZA INCOMPLETA]:\n` +
      fallosIncompletos.map((f, i) => `  - ${f}`).join("\n") +
      (errores.length > 0 ? `\nErrores acumulados:\n` + errores.map((e, idx) => `  ${idx + 1}. ${e.message}`).join("\n") : "");
    console.error(msgIncompleto);
    const errorIncompleto = new Error(msgIncompleto);
    (errorIncompleto as any).fallosIncompletos = fallosIncompletos;
    (errorIncompleto as any).erroresAcumulados = errores;
    throw errorIncompleto;
  }

  // Si todas las fases se completaron (directorio restaurado, backup eliminado, base drop y pg_database verificado y cliente desconectado)
  // pero hubo fallos intermedios recuperados (ej. en intento 1), reportar los recuperados
  if (errores.length > 0) {
    console.log(`[prueba-migracion-limpieza] Errores acumulados recuperados exitosamente en intentos posteriores: ${errores.length}`);
  }
}

export async function ejecutarPruebaMigracion() {
  const urlOriginal = process.env.DATABASE_URL;
  if (!urlOriginal) throw new Error("Falta DATABASE_URL en .env");

  const parsed = new URL(urlOriginal);
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error(`Host no permitido por seguridad: ${parsed.hostname}`);
  }

  const urlMantenimiento = new URL(urlOriginal);
  urlMantenimiento.pathname = "/postgres";

  const urlPrueba = new URL(urlOriginal);
  urlPrueba.pathname = `/${BASE_TEST}`;

  // Debe existir antes de leer y manipular la migración; el test nunca omite una migración ausente.
  assert.ok(existsSync(MIGRACION_DIR), "El directorio real de migración debe existir al comenzar la prueba");
  assert.ok(!existsSync(MIGRACION_BACKUP), "No debe existir un backup previo de la migración real");
  const contenidoSqlReal = readFileSync(ARCHIVO_SQL_REAL, "utf-8");
  const coincideBegin = (contenidoSqlReal.match(/\bBEGIN\s*;/gi) || []).length;
  const coincideCommit = (contenidoSqlReal.match(/\bCOMMIT\s*;/gi) || []).length;
  assert.equal(
    coincideBegin,
    1,
    "El archivo migration.sql debe contener exactamente un BEGIN;"
  );
  assert.equal(
    coincideCommit,
    1,
    "El archivo migration.sql debe contener exactamente un COMMIT;"
  );

  const prismaAdmin = new PrismaClient({
    datasources: { db: { url: urlMantenimiento.toString() } },
  });

  try {
    console.log(`[prueba-migracion] 1. Creando base desechable '${BASE_TEST}' en postgres...`);
    validarNombreBaseMigracion(BASE_TEST);
    await prismaAdmin.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BASE_TEST}' AND pid <> pg_backend_pid();
    `);
    validarNombreBaseMigracion(BASE_TEST);
    await prismaAdmin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_TEST}";`);
    validarNombreBaseMigracion(BASE_TEST);
    await prismaAdmin.$executeRawUnsafe(`CREATE DATABASE "${BASE_TEST}";`);

    console.log(`[prueba-migracion] 2. Aplicando únicamente las migraciones anteriores...`);
    renameSync(MIGRACION_DIR, MIGRACION_BACKUP);

    try {
      execSync("node node_modules/prisma/build/index.js migrate deploy", {
        env: { ...process.env, DATABASE_URL: urlPrueba.toString() },
        stdio: "pipe",
      });
    } finally {
      if (existsSync(MIGRACION_BACKUP)) {
        renameSync(MIGRACION_BACKUP, MIGRACION_DIR);
      }
      assert.ok(existsSync(MIGRACION_DIR), "El directorio real debe restaurarse antes de continuar");
      assert.ok(!existsSync(MIGRACION_BACKUP), "El backup real debe desaparecer antes de continuar");
    }

    const prismaTest = new PrismaClient({
      datasources: { db: { url: urlPrueba.toString() } },
    });

    try {
      console.log(`[prueba-migracion] 3. Insertando datos históricos con correos sin normalizar y duplicados PENDIENTE...`);
      await prismaTest.$executeRawUnsafe(`
        INSERT INTO "organizaciones" ("id", "nombre", "slug", "creado_en", "actualizado_en")
        VALUES ('11111111-1111-1111-1111-111111111111', 'Org Migracion', 'org-migracion', NOW(), NOW());
      `);

      await prismaTest.$executeRawUnsafe(`
        INSERT INTO "clientes" ("id", "organizacion_id", "nombre", "creado_en", "actualizado_en")
        VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Cliente Migracion', NOW(), NOW());
      `);

      await prismaTest.$executeRawUnsafe(`
        INSERT INTO "usuarios" ("id", "correo", "contrasena_hash", "nombre", "creado_en", "actualizado_en")
        VALUES ('33333333-3333-3333-3333-333333333333', 'admin@migracion.test', 'hash', 'Admin', NOW(), NOW());
      `);

      // Fila 1 (antigua): "   Usuario.Duplicado@Example.Test   "
      await prismaTest.$executeRawUnsafe(`
        INSERT INTO "invitaciones_cliente" ("id", "cliente_id", "organizacion_id", "correo", "rol", "token_hash", "estado", "expira_en", "invitado_por_id", "creado_en", "actualizado_en")
        VALUES (
          'aaaaaaaa-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111',
          '   Usuario.Duplicado@Example.Test   ',
          'TITULAR',
          'hash_antiguo_1',
          'PENDIENTE',
          NOW() + interval '7 days',
          '33333333-3333-3333-3333-333333333333',
          NOW() - interval '2 days',
          NOW() - interval '2 days'
        );
      `);

      // Fila 2 (reciente): debe conservarse como PENDIENTE
      await prismaTest.$executeRawUnsafe(`
        INSERT INTO "invitaciones_cliente" ("id", "cliente_id", "organizacion_id", "correo", "rol", "token_hash", "estado", "expira_en", "invitado_por_id", "creado_en", "actualizado_en")
        VALUES (
          'bbbbbbbb-2222-2222-2222-222222222222',
          '22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111',
          'usuario.duplicado@example.test',
          'COLABORADOR',
          'hash_reciente_2',
          'PENDIENTE',
          NOW() + interval '7 days',
          '33333333-3333-3333-3333-333333333333',
          NOW(),
          NOW()
        );
      `);

      console.log(`[prueba-migracion] 4. Ejecutando copia fallida del SQL real (sustituyendo COMMIT por error + COMMIT)...`);
      const sqlFallido = contenidoSqlReal.replace(
        /\bCOMMIT\s*;/i,
        "SELECT * FROM \"tabla_inexistente_para_forzar_rollback_migracion\";\nCOMMIT;"
      );

      let falloCapturado = false;
      try {
        await prismaTest.$executeRawUnsafe(sqlFallido);
      } catch (err) {
        falloCapturado = true;
      }
      assert.ok(falloCapturado, "La copia fallida del SQL real de migración debe fallar al ejecutarse");

      console.log(`[prueba-migracion] 5. Confirmando que ninguna normalización, revocación o índice persistieron tras el rollback...`);
      const filasTrasFallo: any[] = await prismaTest.$queryRawUnsafe(`
        SELECT id, correo, estado FROM "invitaciones_cliente" ORDER BY creado_en ASC;
      `);
      assert.equal(filasTrasFallo.length, 2);
      assert.equal(
        filasTrasFallo[0].correo,
        "   Usuario.Duplicado@Example.Test   ",
        "El correo sin normalizar debe seguir intacto tras el rollback"
      );
      assert.equal(
        filasTrasFallo[0].estado,
        "PENDIENTE",
        "El estado no debe haber cambiado a REVOCADA tras el rollback"
      );

      const indiceExiste: any[] = await prismaTest.$queryRawUnsafe(`
        SELECT indexname FROM pg_indexes WHERE tablename = 'invitaciones_cliente' AND indexname = 'invitaciones_cliente_cliente_id_correo_pendiente_key';
      `);
      assert.equal(indiceExiste.length, 0, "El índice no debe existir tras el rollback");

      console.log(`[prueba-migracion] 6. Aplicando la migración real original vía migrate deploy...`);
      execSync("node node_modules/prisma/build/index.js migrate deploy", {
        env: { ...process.env, DATABASE_URL: urlPrueba.toString() },
        stdio: "pipe",
      });
      const migracionRegistrada: any[] = await prismaTest.$queryRawUnsafe(
        `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = '20261026134500_indice_unico_invitacion_pendiente' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;`
      );
      assert.equal(migracionRegistrada.length, 1, "La migración debe quedar registrada como aplicada en la base de prueba");

      console.log(`[prueba-migracion] 7. Confirmando normalización, desempate, revocación, actualizado_en e índice...`);
      const filasExito: any[] = await prismaTest.$queryRawUnsafe(`
        SELECT id, correo, estado, creado_en, actualizado_en FROM "invitaciones_cliente" ORDER BY creado_en ASC;
      `);
      assert.equal(filasExito.length, 2);

      // Fila 1 (antigua): normalizada y REVOCADA con actualizado_en actualizado
      assert.equal(filasExito[0].id, "aaaaaaaa-1111-1111-1111-111111111111");
      assert.equal(filasExito[0].correo, "usuario.duplicado@example.test");
      assert.equal(filasExito[0].estado, "REVOCADA");
      assert.ok(
        new Date(filasExito[0].actualizado_en).getTime() > new Date(filasExito[0].creado_en).getTime(),
        "actualizado_en debe haber sido actualizado en la revocada"
      );

      // Fila 2 (reciente): conservada como PENDIENTE
      assert.equal(filasExito[1].id, "bbbbbbbb-2222-2222-2222-222222222222");
      assert.equal(filasExito[1].correo, "usuario.duplicado@example.test");
      assert.equal(filasExito[1].estado, "PENDIENTE");

      const indiceCreado: any[] = await prismaTest.$queryRawUnsafe(`
        SELECT indexname FROM pg_indexes WHERE tablename = 'invitaciones_cliente' AND indexname = 'invitaciones_cliente_cliente_id_correo_pendiente_key';
      `);
      assert.equal(indiceCreado.length, 1, "El índice único parcial debe existir tras aplicar la migración");

      console.log(`[prueba-migracion] 8. Verificando que PostgreSQL rechaza inserción duplicada con error 23505...`);
      let errorRechazo: any = null;
      try {
        await prismaTest.$executeRawUnsafe(`
          INSERT INTO "invitaciones_cliente" ("id", "cliente_id", "organizacion_id", "correo", "rol", "token_hash", "estado", "expira_en", "invitado_por_id", "creado_en", "actualizado_en")
          VALUES (
            'cccccccc-3333-3333-3333-333333333333',
            '22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111',
            '   USUARIO.DUPLICADO@EXAMPLE.TEST   ',
            'TITULAR',
            'hash_rechazado_3',
            'PENDIENTE',
            NOW() + interval '7 days',
            '33333333-3333-3333-3333-333333333333',
            NOW(),
            NOW()
          );
        `);
      } catch (err) {
        errorRechazo = err;
      }
      assert.ok(errorRechazo, "PostgreSQL debe rechazar una nueva inserción duplicada en PENDIENTE");
      const strError = `${String(errorRechazo)} ${JSON.stringify(errorRechazo)}`;
      assert.ok(
        strError.includes("23505") ||
        strError.includes("llave duplicada") ||
        strError.includes("duplicate key") ||
        strError.includes("unique"),
        "El error debe corresponder al código 23505 de violación de unicidad"
      );

      console.log(`[prueba-migracion] ¡Todas las verificaciones de migración real y rollback fueron exitosas!`);
    } finally {
      await prismaTest.$disconnect();
    }
  } finally {
    console.log(`[prueba-migracion] Ejecutando limpieza garantizada con try/finally anidados...`);
    await limpiarEntornoMigracion(prismaAdmin, BASE_TEST);
  }
}

// -----------------------------------------------------------------
// Pruebas de fallos inyectados para garantizar la limpieza total
// -----------------------------------------------------------------
export async function probarFallosInyectadosLimpieza() {
  const urlOriginal = process.env.DATABASE_URL;
  if (!urlOriginal) throw new Error("Falta DATABASE_URL en .env");

  const urlMantenimiento = new URL(urlOriginal);
  urlMantenimiento.pathname = "/postgres";
  const strUrlMantenimiento = urlMantenimiento.toString();

  // Helper de verificación independiente: asegura que la base no existe en pg_database y prismaVerif se desconecta
  async function verificarBaseNoExiste(nombreBase: string) {
    validarNombreBaseMigracion(nombreBase);
    const prismaVerif = new PrismaClient({
      datasources: { db: { url: strUrlMantenimiento } },
    });
    try {
      const dbs = (await prismaVerif.$queryRawUnsafe(
        `SELECT datname FROM pg_database WHERE datname = '${nombreBase}'`
      )) as any[];
      assert.equal(dbs.length, 0, `La base ${nombreBase} debe estar completamente eliminada de pg_database`);
    } finally {
      await prismaVerif.$disconnect();
    }
  }

  // 0. Validación de rechazo de bases protegidas o no permitidas
  assert.throws(
    () => validarNombreBaseMigracion("equinox"),
    /Acceso prohibido/,
    "Debe rechazar estrictamente la base principal 'equinox'"
  );
  assert.throws(
    () => validarNombreBaseMigracion("postgres"),
    /Acceso prohibido/,
    "Debe rechazar estrictamente 'postgres'"
  );
  assert.throws(
    () => validarNombreBaseMigracion("otra_base_arbitraria"),
    /no pertenece a la lista cerrada/,
    "Debe rechazar nombres arbitrarios fuera de la lista cerrada"
  );

  console.log(`[prueba-migracion-fallos] A. Probando recuperación tras fallo después de renombrar migración...`);
  const BASE_FALLO_1 = "equinox_migration_fallo1_test";
  const prismaAdminFallo1 = new PrismaClient({
    datasources: { db: { url: strUrlMantenimiento } },
  });

  try {
    renameSync(MIGRACION_DIR, MIGRACION_BACKUP);
    assert.ok(existsSync(MIGRACION_BACKUP));
    assert.ok(!existsSync(MIGRACION_DIR));
    throw new Error("Fallo inyectado controlado inmediatamente tras renombrar");
  } catch (errForzado: any) {
    console.log(`[prueba-migracion-fallos] Capturado fallo forzado: ${errForzado.message}`);
  } finally {
    await limpiarEntornoMigracion(prismaAdminFallo1, BASE_FALLO_1, MIGRACION_BACKUP, MIGRACION_DIR, undefined, strUrlMantenimiento);
    assert.ok(existsSync(MIGRACION_DIR), "El directorio de migración debe estar restaurado");
    assert.ok(!existsSync(MIGRACION_BACKUP), "El directorio de backup no debe existir");
    await verificarBaseNoExiste(BASE_FALLO_1);
  }

  console.log(`[prueba-migracion-fallos] B. Probando recuperación tras fallo después de crear la base temporal...`);
  const BASE_FALLO_2 = "equinox_migration_fallo2_test";
  const prismaAdminFallo2 = new PrismaClient({
    datasources: { db: { url: strUrlMantenimiento } },
  });

  try {
    validarNombreBaseMigracion(BASE_FALLO_2);
    await prismaAdminFallo2.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_FALLO_2}";`);
    validarNombreBaseMigracion(BASE_FALLO_2);
    await prismaAdminFallo2.$executeRawUnsafe(`CREATE DATABASE "${BASE_FALLO_2}";`);
    renameSync(MIGRACION_DIR, MIGRACION_BACKUP);
    throw new Error("Fallo inyectado controlado después de crear base");
  } catch (errForzado: any) {
    console.log(`[prueba-migracion-fallos] Capturado fallo forzado: ${errForzado.message}`);
  } finally {
    await limpiarEntornoMigracion(prismaAdminFallo2, BASE_FALLO_2, MIGRACION_BACKUP, MIGRACION_DIR, undefined, strUrlMantenimiento);
    assert.ok(existsSync(MIGRACION_DIR), "El directorio de migración debe estar restaurado");
    assert.ok(!existsSync(MIGRACION_BACKUP), "El backup no debe existir");
    await verificarBaseNoExiste(BASE_FALLO_2);
  }

  console.log(`[prueba-migracion-fallos] C. Fallo en fase 1: primer intento de restaurar directorio...`);
  const BASE_FASE_RESTORE = "equinox_migration_fase_restore_test";
  const prismaAdminRestore = new PrismaClient({
    datasources: { db: { url: strUrlMantenimiento } },
  });
  try {
    validarNombreBaseMigracion(BASE_FASE_RESTORE);
    await prismaAdminRestore.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_FASE_RESTORE}";`);
    validarNombreBaseMigracion(BASE_FASE_RESTORE);
    await prismaAdminRestore.$executeRawUnsafe(`CREATE DATABASE "${BASE_FASE_RESTORE}";`);
    renameSync(MIGRACION_DIR, MIGRACION_BACKUP);
  } finally {
    // Inyectar fallo en primer intento de restore; debe recuperarse en el segundo intento y limpiar la base
    await limpiarEntornoMigracion(
      prismaAdminRestore,
      BASE_FASE_RESTORE,
      MIGRACION_BACKUP,
      MIGRACION_DIR,
      { falloRestorePrimerIntento: true },
      strUrlMantenimiento
    );
    assert.ok(existsSync(MIGRACION_DIR), "Directorio de migración debe estar restaurado tras segundo intento");
    assert.ok(!existsSync(MIGRACION_BACKUP), "Backup no debe existir");
    await verificarBaseNoExiste(BASE_FASE_RESTORE);
  }

  console.log(`[prueba-migracion-fallos] C.2 Fallo fatal en fase 1: ambos intentos de restaurar directorio fallan...`);
  const BASE_FASE_RESTORE_FATAL = "equinox_migration_fase_restore_fatal_test";
  const prismaAdminRestoreFatal = new PrismaClient({
    datasources: { db: { url: strUrlMantenimiento } },
  });
  const directorioTemporalFatal = resolve(tmpdir(), `equinox-migration-restore-fatal-${process.pid}`);
  const originalTemporalFatal = join(directorioTemporalFatal, "migration-original");
  const backupTemporalFatal = join(directorioTemporalFatal, "migration-backup");
  try {
    mkdirSync(directorioTemporalFatal, { recursive: true });
    mkdirSync(backupTemporalFatal, { recursive: true });
    writeFileSync(join(backupTemporalFatal, "migration.sql"), "-- fixture temporal aislado\n");
    validarNombreBaseMigracion(BASE_FASE_RESTORE_FATAL);
    await prismaAdminRestoreFatal.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_FASE_RESTORE_FATAL}";`);
    validarNombreBaseMigracion(BASE_FASE_RESTORE_FATAL);
    await prismaAdminRestoreFatal.$executeRawUnsafe(`CREATE DATABASE "${BASE_FASE_RESTORE_FATAL}";`);

    let errorCapturadoFatalRestore: any = null;
    try {
      await limpiarEntornoMigracion(
        prismaAdminRestoreFatal,
        BASE_FASE_RESTORE_FATAL,
        backupTemporalFatal,
        originalTemporalFatal,
        { falloRestorePrimerIntento: true, falloRestoreSegundoIntento: true },
        strUrlMantenimiento
      );
    } catch (err: any) {
      errorCapturadoFatalRestore = err;
    }

    assert.ok(
      errorCapturadoFatalRestore,
      "limpiarEntornoMigracion DEBE lanzar error si fallan ambos intentos de restaurar el directorio"
    );
    assert.ok(
      String(errorCapturadoFatalRestore.message).includes("LIMPIEZA INCOMPLETA"),
      "El error debe identificar LIMPIEZA INCOMPLETA"
    );
    assert.ok(!existsSync(originalTemporalFatal), "El fixture aislado debe permanecer sin restaurar cuando ambos fallos se inyectan");
    assert.ok(existsSync(backupTemporalFatal), "El backup fixture aislado debe permanecer para demostrar el fallo esperado");
    assert.ok(existsSync(MIGRACION_DIR), "El directorio real de migraciones no debe tocarse durante el fallo aislado");
    assert.ok(!existsSync(MIGRACION_BACKUP), "No debe existir backup de la migración real");
    // Verificar que aunque falló el restore, intentó las fases posteriores (base eliminada de pg_database)
    await verificarBaseNoExiste(BASE_FASE_RESTORE_FATAL);
  } finally {
    rmSync(directorioTemporalFatal, { recursive: true, force: true });
    await prismaAdminRestoreFatal.$disconnect();
    assert.ok(existsSync(MIGRACION_DIR), "La migración real debe seguir presente tras el fallo aislado");
    assert.ok(!existsSync(MIGRACION_BACKUP), "La migración real no debe dejar backup");
  }

  console.log(`[prueba-migracion-fallos] D. Fallo en fase 2: terminación de conexiones...`);
  const BASE_FASE_TERMINATE = "equinox_migration_fase_terminate_test";
  const prismaAdminTerminate = new PrismaClient({
    datasources: { db: { url: strUrlMantenimiento } },
  });
  try {
    validarNombreBaseMigracion(BASE_FASE_TERMINATE);
    await prismaAdminTerminate.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_FASE_TERMINATE}";`);
    validarNombreBaseMigracion(BASE_FASE_TERMINATE);
    await prismaAdminTerminate.$executeRawUnsafe(`CREATE DATABASE "${BASE_FASE_TERMINATE}";`);
  } finally {
    // Inyectar fallo en terminate; debe continuar a DROP DATABASE y verificación
    await limpiarEntornoMigracion(
      prismaAdminTerminate,
      BASE_FASE_TERMINATE,
      MIGRACION_BACKUP,
      MIGRACION_DIR,
      { falloTerminate: true },
      strUrlMantenimiento
    );
    assert.ok(existsSync(MIGRACION_DIR));
    assert.ok(!existsSync(MIGRACION_BACKUP));
    await verificarBaseNoExiste(BASE_FASE_TERMINATE);
  }

  console.log(`[prueba-migracion-fallos] E. Fallo en fase 3: primer intento de DROP DATABASE...`);
  const BASE_FASE_DROP = "equinox_migration_fase_drop_test";
  const prismaAdminDrop = new PrismaClient({
    datasources: { db: { url: strUrlMantenimiento } },
  });
  try {
    validarNombreBaseMigracion(BASE_FASE_DROP);
    await prismaAdminDrop.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_FASE_DROP}";`);
    validarNombreBaseMigracion(BASE_FASE_DROP);
    await prismaAdminDrop.$executeRawUnsafe(`CREATE DATABASE "${BASE_FASE_DROP}";`);
  } finally {
    // Inyectar fallo en primer intento de drop; debe reintentar en el segundo y completar exitosamente
    await limpiarEntornoMigracion(
      prismaAdminDrop,
      BASE_FASE_DROP,
      MIGRACION_BACKUP,
      MIGRACION_DIR,
      { falloDropPrimerIntento: true },
      strUrlMantenimiento
    );
    assert.ok(existsSync(MIGRACION_DIR));
    assert.ok(!existsSync(MIGRACION_BACKUP));
    await verificarBaseNoExiste(BASE_FASE_DROP);
  }

  console.log(`[prueba-migracion-fallos] E.2 Fallo en fase 3: ambos intentos de DROP DATABASE fallan (rescate por cliente de respaldo)...`);
  const BASE_FASE_DROP_AMBOS = "equinox_migration_fase_drop_ambos_test";
  const prismaAdminDropAmbos = new PrismaClient({
    datasources: { db: { url: strUrlMantenimiento } },
  });
  try {
    validarNombreBaseMigracion(BASE_FASE_DROP_AMBOS);
    await prismaAdminDropAmbos.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_FASE_DROP_AMBOS}";`);
    validarNombreBaseMigracion(BASE_FASE_DROP_AMBOS);
    await prismaAdminDropAmbos.$executeRawUnsafe(`CREATE DATABASE "${BASE_FASE_DROP_AMBOS}";`);
  } finally {
    // Si ambos intentos fallan en el cliente principal, el cliente de respaldo se activa y elimina la base
    await limpiarEntornoMigracion(
      prismaAdminDropAmbos,
      BASE_FASE_DROP_AMBOS,
      MIGRACION_BACKUP,
      MIGRACION_DIR,
      { falloDropPrimerIntento: true, falloDropSegundoIntento: true },
      strUrlMantenimiento
    );
    assert.ok(existsSync(MIGRACION_DIR));
    assert.ok(!existsSync(MIGRACION_BACKUP));
    await verificarBaseNoExiste(BASE_FASE_DROP_AMBOS);
  }

  console.log(`[prueba-migracion-fallos] F. Fallo en fase 4: consulta a pg_database (activación de cliente de respaldo)...`);
  const BASE_FASE_PGDB = "equinox_migration_fase_pgdb_test";
  const prismaAdminPgDb = new PrismaClient({
    datasources: { db: { url: strUrlMantenimiento } },
  });
  try {
    validarNombreBaseMigracion(BASE_FASE_PGDB);
    await prismaAdminPgDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_FASE_PGDB}";`);
    validarNombreBaseMigracion(BASE_FASE_PGDB);
    await prismaAdminPgDb.$executeRawUnsafe(`CREATE DATABASE "${BASE_FASE_PGDB}";`);
  } finally {
    // Inyectar fallo en consulta pg_database; activa el cliente de respaldo y completa la verificación
    await limpiarEntornoMigracion(
      prismaAdminPgDb,
      BASE_FASE_PGDB,
      MIGRACION_BACKUP,
      MIGRACION_DIR,
      { falloConsultaPgDb: true },
      strUrlMantenimiento
    );
    assert.ok(existsSync(MIGRACION_DIR));
    assert.ok(!existsSync(MIGRACION_BACKUP));
    await verificarBaseNoExiste(BASE_FASE_PGDB);
  }

  console.log(`[prueba-migracion-fallos] G. Fallo en fase 5: desconexión de prismaAdmin...`);
  const BASE_FASE_DISC = "equinox_migration_fase_disc_test";
  const prismaAdminDiscBase = new PrismaClient({
    datasources: { db: { url: strUrlMantenimiento } },
  });
  let intentosDisconnect = 0;
  const prismaAdminDisc = new Proxy(prismaAdminDiscBase, {
    get(target, propiedad, receiver) {
      if (propiedad === "$disconnect") {
        return async () => {
          intentosDisconnect++;
          if (intentosDisconnect === 1) {
            throw new Error("Fallo real simulado en primera llamada a $disconnect");
          }
          return target.$disconnect();
        };
      }
      const valor = Reflect.get(target, propiedad, receiver);
      return typeof valor === "function" ? valor.bind(target) : valor;
    },
  }) as PrismaClient;
  try {
    validarNombreBaseMigracion(BASE_FASE_DISC);
    await prismaAdminDisc.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BASE_FASE_DISC}";`);
    validarNombreBaseMigracion(BASE_FASE_DISC);
    await prismaAdminDisc.$executeRawUnsafe(`CREATE DATABASE "${BASE_FASE_DISC}";`);
  } finally {
    // La primera llamada a $disconnect falla realmente; la recuperación vuelve a invocarla y tiene éxito.
    await limpiarEntornoMigracion(
      prismaAdminDisc,
      BASE_FASE_DISC,
      MIGRACION_BACKUP,
      MIGRACION_DIR,
      undefined,
      strUrlMantenimiento
    );
    assert.equal(intentosDisconnect, 2, "Debe intentarse una segunda desconexión después del fallo inicial");
    assert.ok(existsSync(MIGRACION_DIR));
    assert.ok(!existsSync(MIGRACION_BACKUP));
    await verificarBaseNoExiste(BASE_FASE_DISC);
    assert.ok(existsSync(MIGRACION_DIR));
    assert.ok(!existsSync(MIGRACION_BACKUP));
  }

  console.log(`[prueba-migracion-fallos] H. Demostrar que tras recuperarse de fallos, una ejecución normal inicia y concluye exitosamente...`);
  assert.ok(existsSync(MIGRACION_DIR), "El directorio de migración debe estar presente y limpio");
  assert.ok(!existsSync(MIGRACION_BACKUP), "No debe haber ningún archivo ni carpeta de backup");
  await verificarBaseNoExiste(BASE_TEST);

  // Ejecución normal completa para confirmar estado operativo perfecto
  await ejecutarPruebaMigracion();
  console.log(`[prueba-migracion-fallos] ¡Ejecución normal posterior a las pruebas de fallos completada exitosamente!`);
}

async function principal() {
  await ejecutarPruebaMigracion();
  await probarFallosInyectadosLimpieza();
}

if (process.argv[1]?.endsWith("test-migracion-permanente.ts") || process.argv[1]?.endsWith("test-migracion-permanente.js")) {
  principal().catch((err) => {
    console.error("[prueba-migracion] ERROR:", err);
    process.exit(1);
  });
}
