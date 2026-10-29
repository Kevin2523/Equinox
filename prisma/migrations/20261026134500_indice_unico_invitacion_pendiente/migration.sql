BEGIN;

-- Normalizar correos existentes antes de aplicar restricciones de unicidad
UPDATE "invitaciones_cliente"
SET "correo" = lower(trim("correo"))
WHERE "correo" != lower(trim("correo"));

-- Detectar y revocar duplicados PENDIENTE existentes por cliente y correo normalizado,
-- conservando determinísticamente la invitación más reciente (creado_en DESC, id DESC)
WITH filas_numeradas AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY cliente_id, lower(trim(correo))
      ORDER BY creado_en DESC, id DESC
    ) AS fila_num
  FROM "invitaciones_cliente"
  WHERE estado = 'PENDIENTE'
)
UPDATE "invitaciones_cliente"
SET
  estado = 'REVOCADA',
  actualizado_en = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT id FROM filas_numeradas WHERE fila_num > 1
);

-- Crear el índice único parcial determinista sobre cliente_id y correo normalizado cuando estado = 'PENDIENTE'
CREATE UNIQUE INDEX "invitaciones_cliente_cliente_id_correo_pendiente_key"
ON "invitaciones_cliente"("cliente_id", lower(trim("correo")))
WHERE "estado" = 'PENDIENTE';

COMMIT;
