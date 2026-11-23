#!/bin/sh
set -eu

if [ -n "${EQUINOX_ARCHIVOS_DIR:-}" ]; then
  mkdir -p "$EQUINOX_ARCHIVOS_DIR"
fi

if [ -n "${ALMACENAMIENTO_FOTOS_DIR:-}" ]; then
  mkdir -p "$ALMACENAMIENTO_FOTOS_DIR"
fi

if [ "${MIGRAR_AL_INICIAR:-true}" = "true" ]; then
  echo "[equinox] Aplicando migraciones de Prisma..."
  node node_modules/prisma/build/index.js migrate deploy
fi

exec "$@"
