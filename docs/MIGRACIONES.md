# Guía de Migraciones y Estrategia de Recuperación ante Fallos

Este documento establece el protocolo oficial para la gestión, despliegue, verificación y recuperación de migraciones de base de datos en **Equinox** utilizando Prisma ORM y PostgreSQL.

---

## 1. Migración: `20261001170821_cuentas_e_invitaciones_clientes`

Esta migración implementa la capa de datos para el acceso de clientes e invitaciones (aprobado en la Issue #1 y migrado en la Issue #2).

### Componentes incorporados:
- **Nuevos tipos enumerados:**
  - `RolCliente`: `TITULAR`, `COLABORADOR`.
  - `EstadoInvitacionCliente`: `PENDIENTE`, `ACEPTADA`, `REVOCADA`, `EXPIRADA`.
- **Nuevas tablas:**
  - `accesos_cliente`: Registro de acceso de un `Usuario` a la ficha comercial de un `Cliente` bajo una `Organizacion`.
  - `invitaciones_cliente`: Invitaciones pendientes o procesadas para nuevos accesos de clientes.
- **Aislamiento Multitenant con Claves Foráneas Compuestas:**
  - Restricción única en `clientes`: `@@unique([id, organizacion_id])`.
  - Clave foránea en `accesos_cliente(cliente_id, organizacion_id) REFERENCES clientes(id, organizacion_id) ON DELETE CASCADE`.
  - Clave foránea en `invitaciones_cliente(cliente_id, organizacion_id) REFERENCES clientes(id, organizacion_id) ON DELETE CASCADE`.
  - Esto garantiza a nivel de motor de base de datos que ningún usuario o invitación pueda asociarse a un cliente de una organización diferente.
- **Operaciones no destructivas:** La migración únicamente ejecuta `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX` y `ALTER TABLE ... ADD CONSTRAINT`. No elimina tablas, columnas ni datos preexistentes.
- **Atomicidad mediante Transacción Explícita (`BEGIN ... COMMIT`):** Prisma Migrate no envuelve automáticamente las migraciones en bloques transaccionales. Para garantizar que esta migración sea estrictamente atómica, el archivo `migration.sql` incluye explícitamente `BEGIN;` al inicio y `COMMIT;` al final. Todas las operaciones DDL incluidas (`CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`) son totalmente compatibles con transacciones en PostgreSQL.

---

## 2. Verificación Previa al Despliegue en Producción

Antes de aplicar cualquier migración en un entorno productivo o de staging:

1. **Revisión estática y validación:**
   ```bash
   npx prisma validate
   npx prisma format
   npm run compilar
   ```

2. **Comprobación del estado de migraciones en la base de datos de destino:**
   ```bash
   npx prisma migrate status
   ```
   Asegúrese de que no existan migraciones pendientes sin aplicar o migraciones fallidas (`failed migrations`).

3. **Prueba en base de datos aislada (Staging / Réplica de prueba):**
   Aplique las migraciones en una base clonada con datos representativos para verificar tiempos de ejecución y bloqueos:
   ```bash
   npx prisma migrate deploy
   ```

---

## 3. Copia de Seguridad Preventiva (Backup)

**Paso obligatorio e inexcusable antes de ejecutar `prisma migrate deploy` en producción.**

Genere un volcado completo de la base de datos en formato binario comprimido de PostgreSQL (`custom format`):

```bash
# Exportar las credenciales mediante variables de entorno del cliente de PostgreSQL
export PGHOST="tu-host-de-base-de-datos"
export PGPORT="5432"
export PGUSER="tu_usuario_postgres"
export PGDATABASE="equinox"
# export PGPASSWORD="***" (proporcionado de forma segura en terminal o archivo .pgpass con permisos 0600)

# Generar el respaldo con fecha y hora
FECHA=$(date +"%Y%m%d_%H%M%S")
pg_dump -Fc -v -f "equinox_backup_pre_migracion_${FECHA}.dump"
```

Verifique la integridad del archivo generado antes de proceder:
```bash
pg_restore -l "equinox_backup_pre_migracion_${FECHA}.dump" > /dev/null && echo "Copia de seguridad válida."
```

---

## 4. Naturaleza de las Migraciones en Prisma (Sin "Down" Migrations)

> **IMPORTANTE:** Prisma Migrate **NO** genera automáticamente migraciones reversibles ni soporta comandos del tipo `migrate down` nativamente.

- Cuando una migración se aplica (`prisma migrate deploy`), se registra en la tabla interna `_prisma_migrations` con una suma de verificación (checksum) y fecha de aplicación.
- Nunca edite el archivo SQL de una migración que ya haya sido aplicada a producción o compartida en la rama `develop`/`main`. Cualquier modificación alterará el checksum y provocará un error de detección de drift (`migration checksum mismatch`).

---

## 5. Protocolo de Actuación ante Fallo de Migración

Si `npx prisma migrate deploy` arroja un error en ejecución:

1. **Diagnóstico inmediato:**
   Ejecute:
   ```bash
   npx prisma migrate status
   ```
   Prisma identificará la migración que falló (`failed`). Mientras una migración esté en estado fallido, Prisma bloqueará futuros despliegues para evitar estados inconsistentes.

2. **Evaluación de atomicidad y estado del esquema:**
   - **Para migraciones con transacción explícita (`BEGIN ... COMMIT`) como esta:** Si una sentencia falla, PostgreSQL efectúa un rollback completo de toda la transacción DDL, asegurando que ninguna tabla, tipo o índice quede creado a medias. Sin embargo, Prisma registrará la migración como fallida en `_prisma_migrations` (`finished_at IS NULL`).
   - **Para migraciones sin transacción explícita:** Prisma Migrate aplica las sentencias una a una; si falla en un paso intermedio, los objetos creados previamente permanecen en la base de datos (estado parcialmente aplicado).

3. **Verificación de objetos y resolución con `prisma migrate resolve`:**
   Antes de marcar una migración como revertida, inspeccione la base de datos para confirmar si los objetos fueron revertidos o si persisten objetos parciales:
   ```sql
   -- Comprobar si existen tablas creadas por la migración
   SELECT table_name FROM information_schema.tables WHERE table_name IN ('accesos_cliente', 'invitaciones_cliente');
   -- Comprobar si existen tipos enum
   SELECT typname FROM pg_type WHERE typname IN ('RolCliente', 'EstadoInvitacionCliente');
   ```
   - Si la migración era atómica (con `BEGIN/COMMIT`) y se revirtió por completo en PostgreSQL:
     ```bash
     npx prisma migrate resolve --rolled-back "20261001170821_cuentas_e_invitaciones_clientes"
     ```
   - Si existieran objetos parciales residuales, elimínelos manualmente mediante DDL correctivo o restaure desde el respaldo preventivo antes de indicar `--rolled-back`.
   - Una vez resuelto el estado en `_prisma_migrations`, corrija la causa raíz y proceda mediante una **migración correctiva** (Sección 7).

---

## 6. Restauración de la Base de Datos desde una Copia

En caso de contingencia crítica donde deba restablecerse la base de datos al estado previo:

1. **Detener el tráfico de la aplicación:**
   Ponga la API en modo mantenimiento para evitar escrituras concurrentes.

2. **Cerrar conexiones activas a la base de datos:**
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = 'equinox' AND pid <> pg_backend_pid();
   ```

3. **Restaurar el volcado con `pg_restore`:**
   ```bash
   # Utilizando el archivo generado en el paso previo
   pg_restore -v --clean --if-exists --no-owner --no-privileges \
     -d "$PGDATABASE" \
     "equinox_backup_pre_migracion_${FECHA}.dump"
   ```

4. **Verificar el estado posterior a la restauración:**
   ```bash
   npx prisma migrate status
   ```
   La base volverá a reflejar exactamente el estado anterior a la migración fallida.

---

## 7. Migraciones Correctivas vs. Edición de Migraciones

| Situación | Acción Correcta | Acción Prohibida |
|---|---|---|
| **La migración falló en producción o staging.** | Crear una nueva migración correctiva hacia adelante (`roll forward`). | Modificar el archivo `migration.sql` existente. |
| **Se requiere eliminar o ajustar una tabla/columna recién creada.** | Generar una nueva migración con los cambios necesarios. | Editar la migración previa o usar `prisma db push`. |
| **La migración sólo existe localmente y nunca se ha compartido ni desplegado.** | Se puede corregir localmente reseteando la base de pruebas. | Hacerlo sobre bases compartidas o producción. |

### Regla de Oro:
**En producción siempre se avanza ("roll forward").** Toda corrección, ajuste de tipo, nuevo índice o eliminación de restricción debe plasmarse en un nuevo archivo de migración versionado en Git.
