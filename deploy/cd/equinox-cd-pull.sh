#!/usr/bin/env bash
set -euo pipefail
umask 077

# ==============================================================================
# Equinox Pull-Based CD (GHCR + Cosign OIDC + Digest Pinning + Rollback)
# Diseñado para ejecutarse como servicio systemd oneshot sin SSH inbound.
# ==============================================================================

log() {
  printf '[%s] [%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "${ENV_NAME:-equinox-cd}" "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Falta comando requerido: $1"
}

# --- Validación de configuración ---
: "${ENV_NAME:?Definir ENV_NAME (staging|production)}"
: "${APP_DIR:?Definir APP_DIR (ruta absoluta al directorio del compose)}"
: "${COMPOSE_PROJECT_NAME:?Definir COMPOSE_PROJECT_NAME (ej. equinox-staging o equinox-prod)}"
: "${BACKEND_IMAGE:?Definir BACKEND_IMAGE (ej. ghcr.io/kevin2523/equinox-backend)}"
: "${MIGRATOR_IMAGE:?Definir MIGRATOR_IMAGE (ej. ghcr.io/kevin2523/equinox-migrator)}"
: "${FRONTEND_IMAGE:?Definir FRONTEND_IMAGE (ej. ghcr.io/kevin2523/equinox-frontend)}"
: "${IMAGE_TAG:?Definir IMAGE_TAG (ej. staging o prod)}"

BACKEND_IMAGE=$(printf '%s' "$BACKEND_IMAGE" | tr '[:upper:]' '[:lower:]')
MIGRATOR_IMAGE=$(printf '%s' "$MIGRATOR_IMAGE" | tr '[:upper:]' '[:lower:]')
FRONTEND_IMAGE=$(printf '%s' "$FRONTEND_IMAGE" | tr '[:upper:]' '[:lower:]')

VERIFY_COSIGN="${VERIFY_COSIGN:-true}"
ALLOWED_OIDC_ISSUER="${ALLOWED_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"
if [ "$VERIFY_COSIGN" = "true" ]; then
  : "${ALLOWED_WORKFLOW_REF:?Definir ALLOWED_WORKFLOW_REF cuando VERIFY_COSIGN=true}"
fi

STATE_DIR="${STATE_DIR:-/var/lib/equinox-cd}"
LOCK_DIR="${LOCK_DIR:-/run/lock}"
STATE_FILE="${STATE_DIR}/${ENV_NAME}.state"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-60}"
HEALTH_INTERVAL_SEC="${HEALTH_INTERVAL_SEC:-3}"

require_cmd curl
require_cmd docker
require_cmd python3
require_cmd flock
if [ "$VERIFY_COSIGN" = "true" ]; then
  require_cmd cosign
fi

[ -d "$APP_DIR" ] || die "No existe APP_DIR: $APP_DIR"
[ -f "${APP_DIR}/compose.yml" ] || die "Falta ${APP_DIR}/compose.yml"
[ -f "${APP_DIR}/compose.prod.yml" ] || die "Falta ${APP_DIR}/compose.prod.yml"
[ -f "${APP_DIR}/.env" ] || die "Falta ${APP_DIR}/.env"

mkdir -p "$STATE_DIR" "$LOCK_DIR"
chmod 700 "$STATE_DIR"
export DOCKER_CONFIG="${DOCKER_CONFIG:-${STATE_DIR}/.docker-${ENV_NAME}}"
mkdir -p "$DOCKER_CONFIG"
chmod 700 "$DOCKER_CONFIG"

LOCK_FILE="${LOCK_DIR}/equinox-cd-${ENV_NAME}.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Otra ejecución de CD ya está en curso para ${ENV_NAME}; saliendo."
  exit 0
fi

# --- Helpers OCI / GHCR ---
resolve_ghcr_digest() {
  local full_image="$1"
  local tag="$2"
  local registry="${full_image%%/*}"
  local repo="${full_image#*/}"

  [ "$registry" = "ghcr.io" ] || die "Solo se soporta ghcr.io en resolve_ghcr_digest (recibido: $full_image)"

  local token_url="https://ghcr.io/token?service=ghcr.io&scope=repository:${repo}:pull"
  local token_json=""
  if [ -n "${GHCR_READ_TOKEN:-}" ] && [ -n "${GHCR_READ_USER:-}" ]; then
    token_json=$(printf 'user = "%s:%s"\n' "$GHCR_READ_USER" "$GHCR_READ_TOKEN" | curl -fsSL --connect-timeout 10 --max-time 30 -K - "$token_url")
  else
    token_json=$(curl -fsSL --connect-timeout 10 --max-time 30 "$token_url")
  fi

  local token
  token=$(printf '%s' "$token_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
  [ -n "$token" ] || die "No se pudo obtener token OCI de GHCR para ${repo}"

  local headers
  headers=$(curl -fsSL --connect-timeout 10 --max-time 30 -I \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json" \
    "https://ghcr.io/v2/${repo}/manifests/${tag}")

  local digest
  digest=$(printf '%s\n' "$headers" | awk 'tolower($0) ~ /^docker-content-digest:[[:space:]]*/{sub(/^[^:]*:[[:space:]]*/,""); gsub(/\r/,""); print; exit}')
  if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    die "Digest OCI inválido recibido para ${full_image}:${tag}: '${digest}'"
  fi
  printf '%s' "$digest"
}

verify_cosign_digest() {
  local image_ref="$1"
  log "Verificando firma Cosign OIDC para ${image_ref}..."
  cosign verify \
    --certificate-oidc-issuer "$ALLOWED_OIDC_ISSUER" \
    --certificate-identity "$ALLOWED_WORKFLOW_REF" \
    "$image_ref" >/dev/null
}

read_env_var() {
  local key="$1"
  local file="$2"
  local val
  val=$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' || true)
  val="${val#\"}"
  val="${val%\"}"
  val="${val#\'}"
  val="${val%\'}"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  printf '%s' "$val"
}

check_health() {
  local check_host="$1"
  local check_port="$2"
  local elapsed=0

  while [ "$elapsed" -lt "$HEALTH_TIMEOUT_SEC" ]; do
    if docker compose -f compose.yml -f compose.prod.yml exec -T backend \
      node -e "fetch('http://127.0.0.1:3000/salud/listo').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 \
      && curl -fsS --connect-timeout 3 --max-time 5 "http://${check_host}:${check_port}/nginx-salud" >/dev/null 2>&1 \
      && curl -fsS --connect-timeout 3 --max-time 5 "http://${check_host}:${check_port}/salud/listo" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL_SEC"
    elapsed=$((elapsed + HEALTH_INTERVAL_SEC))
  done
  return 1
}

write_state() {
  local backend_digest="$1"
  local migrator_digest="$2"
  local frontend_digest="$3"
  local prev_backend="$4"
  local prev_migrator="$5"
  local prev_frontend="$6"
  local failed_backend="${7:-}"
  local failed_migrator="${8:-}"
  local failed_frontend="${9:-}"
  local tmp_file
  tmp_file=$(mktemp "${STATE_DIR}/.${ENV_NAME}.state.XXXXXX")
  cat >"$tmp_file" <<EOF
CURRENT_BACKEND_DIGEST=${backend_digest}
CURRENT_MIGRATOR_DIGEST=${migrator_digest}
CURRENT_FRONTEND_DIGEST=${frontend_digest}
PREV_BACKEND_DIGEST=${prev_backend}
PREV_MIGRATOR_DIGEST=${prev_migrator}
PREV_FRONTEND_DIGEST=${prev_frontend}
FAILED_BACKEND_DIGEST=${failed_backend}
FAILED_MIGRATOR_DIGEST=${failed_migrator}
FAILED_FRONTEND_DIGEST=${failed_frontend}
UPDATED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
EOF
  chmod 600 "$tmp_file"
  mv -f "$tmp_file" "$STATE_FILE"
}

# --- Cargar estado previo ---
CURRENT_BACKEND_DIGEST=""
CURRENT_MIGRATOR_DIGEST=""
CURRENT_FRONTEND_DIGEST=""
PREV_BACKEND_DIGEST=""
PREV_MIGRATOR_DIGEST=""
PREV_FRONTEND_DIGEST=""
FAILED_BACKEND_DIGEST=""
FAILED_MIGRATOR_DIGEST=""
FAILED_FRONTEND_DIGEST=""
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi

# --- Consultar digests remotos ---
REMOTE_BACKEND_DIGEST=$(resolve_ghcr_digest "$BACKEND_IMAGE" "$IMAGE_TAG")
REMOTE_MIGRATOR_DIGEST=$(resolve_ghcr_digest "$MIGRATOR_IMAGE" "$IMAGE_TAG")
REMOTE_FRONTEND_DIGEST=$(resolve_ghcr_digest "$FRONTEND_IMAGE" "$IMAGE_TAG")

if [ "$REMOTE_BACKEND_DIGEST" = "$CURRENT_BACKEND_DIGEST" ] \
  && [ "$REMOTE_MIGRATOR_DIGEST" = "$CURRENT_MIGRATOR_DIGEST" ] \
  && [ "$REMOTE_FRONTEND_DIGEST" = "$CURRENT_FRONTEND_DIGEST" ]; then
  log "Sin cambios (${IMAGE_TAG}: backend=${REMOTE_BACKEND_DIGEST:0:19}..., migrator=${REMOTE_MIGRATOR_DIGEST:0:19}..., frontend=${REMOTE_FRONTEND_DIGEST:0:19}...)."
  exit 0
fi

if [ -n "$FAILED_BACKEND_DIGEST" ] && [ -n "$FAILED_MIGRATOR_DIGEST" ] && [ -n "$FAILED_FRONTEND_DIGEST" ] \
  && [ "$REMOTE_BACKEND_DIGEST" = "$FAILED_BACKEND_DIGEST" ] \
  && [ "$REMOTE_MIGRATOR_DIGEST" = "$FAILED_MIGRATOR_DIGEST" ] \
  && [ "$REMOTE_FRONTEND_DIGEST" = "$FAILED_FRONTEND_DIGEST" ]; then
  die "Release fallido previamente (${IMAGE_TAG}: backend=${REMOTE_BACKEND_DIGEST:0:19}..., migrator=${REMOTE_MIGRATOR_DIGEST:0:19}..., frontend=${REMOTE_FRONTEND_DIGEST:0:19}...); omitiendo reintento para evitar bucle de rollback."
fi

log "Nuevo release detectado para ${IMAGE_TAG}: backend=${REMOTE_BACKEND_DIGEST}, migrator=${REMOTE_MIGRATOR_DIGEST}, frontend=${REMOTE_FRONTEND_DIGEST}"

NEW_BACKEND_REF="${BACKEND_IMAGE}@${REMOTE_BACKEND_DIGEST}"
NEW_MIGRATOR_REF="${MIGRATOR_IMAGE}@${REMOTE_MIGRATOR_DIGEST}"
NEW_FRONTEND_REF="${FRONTEND_IMAGE}@${REMOTE_FRONTEND_DIGEST}"

if [ -n "${GHCR_READ_TOKEN:-}" ] && [ -n "${GHCR_READ_USER:-}" ]; then
  printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io -u "$GHCR_READ_USER" --password-stdin >/dev/null
fi

# --- Verificación criptográfica Cosign antes de descargar/ejecutar ---
if [ "$VERIFY_COSIGN" = "true" ]; then
  verify_cosign_digest "$NEW_BACKEND_REF"
  verify_cosign_digest "$NEW_MIGRATOR_REF"
  verify_cosign_digest "$NEW_FRONTEND_REF"
  log "Firmas Cosign verificadas correctamente."
else
  log "ADVERTENCIA: VERIFY_COSIGN=false; omitiendo verificación de firma."
fi

# --- Preparar entorno Compose ---
cd "$APP_DIR"
export COMPOSE_PROJECT_NAME
export BACKEND_IMAGE_REF="$NEW_BACKEND_REF"
export MIGRATOR_IMAGE_REF="$NEW_MIGRATOR_REF"
export FRONTEND_IMAGE_REF="$NEW_FRONTEND_REF"

ENV_BIND_IP=$(read_env_var "FRONTEND_BIND_IP" ".env")
ENV_PORT=$(read_env_var "FRONTEND_PORT" ".env")
DEFAULT_PORT="8081"
if [ "$ENV_NAME" = "production" ]; then
  DEFAULT_PORT="8082"
fi
CHECK_BIND_IP="${FRONTEND_BIND_IP:-${ENV_BIND_IP:-127.0.0.1}}"
CHECK_PORT="${FRONTEND_PORT:-${ENV_PORT:-$DEFAULT_PORT}}"
if [ "$CHECK_PORT" = "8080" ] && [ "${ALLOW_PORT_8080:-false}" != "true" ]; then
  die "Puerto 8080 reservado para mena.date; configurar FRONTEND_PORT (8081 staging, 8082 producción)."
fi
export FRONTEND_BIND_IP="$CHECK_BIND_IP"
export FRONTEND_PORT="$CHECK_PORT"

CHECK_HOST="$CHECK_BIND_IP"
if [ "$CHECK_HOST" = "0.0.0.0" ] || [ -z "$CHECK_HOST" ]; then
  CHECK_HOST="127.0.0.1"
fi

log "Descargando imágenes por digest inmutable..."
docker compose -f compose.yml -f compose.prod.yml pull

log "Ejecutando migraciones Prisma vía migrator one-shot (idempotentes)..."
DEPLOY_OK=true
if ! docker compose -f compose.yml -f compose.prod.yml run --rm migrator; then
  DEPLOY_OK=false
elif ! docker compose -f compose.yml -f compose.prod.yml up -d --remove-orphans; then
  DEPLOY_OK=false
elif ! check_health "$CHECK_HOST" "$CHECK_PORT"; then
  DEPLOY_OK=false
fi

if [ "$DEPLOY_OK" = "true" ]; then
  write_state "$REMOTE_BACKEND_DIGEST" "$REMOTE_MIGRATOR_DIGEST" "$REMOTE_FRONTEND_DIGEST" "$CURRENT_BACKEND_DIGEST" "$CURRENT_MIGRATOR_DIGEST" "$CURRENT_FRONTEND_DIGEST" "" "" ""
  cat >"${APP_DIR}/.cd-active-refs.env" <<EOF
# Generado automáticamente por equinox-cd-pull.sh
BACKEND_IMAGE_REF=${NEW_BACKEND_REF}
MIGRATOR_IMAGE_REF=${NEW_MIGRATOR_REF}
FRONTEND_IMAGE_REF=${NEW_FRONTEND_REF}
EOF
  chmod 640 "${APP_DIR}/.cd-active-refs.env"
  log "Despliegue exitoso y verificado en http://${CHECK_HOST}:${CHECK_PORT}."
  exit 0
fi

# --- Rollback automático ---
log "ERROR: Falló el despliegue, la migración o el healthcheck en ${CHECK_HOST}:${CHECK_PORT}."
write_state "$CURRENT_BACKEND_DIGEST" "$CURRENT_MIGRATOR_DIGEST" "$CURRENT_FRONTEND_DIGEST" "$PREV_BACKEND_DIGEST" "$PREV_MIGRATOR_DIGEST" "$PREV_FRONTEND_DIGEST" "$REMOTE_BACKEND_DIGEST" "$REMOTE_MIGRATOR_DIGEST" "$REMOTE_FRONTEND_DIGEST"
if [ -n "$CURRENT_BACKEND_DIGEST" ] && [ -n "$CURRENT_MIGRATOR_DIGEST" ] && [ -n "$CURRENT_FRONTEND_DIGEST" ]; then
  log "Iniciando rollback automático a digests previos..."
  export BACKEND_IMAGE_REF="${BACKEND_IMAGE}@${CURRENT_BACKEND_DIGEST}"
  export MIGRATOR_IMAGE_REF="${MIGRATOR_IMAGE}@${CURRENT_MIGRATOR_DIGEST}"
  export FRONTEND_IMAGE_REF="${FRONTEND_IMAGE}@${CURRENT_FRONTEND_DIGEST}"
  if ! docker compose -f compose.yml -f compose.prod.yml up -d --remove-orphans --pull never; then
    docker compose -f compose.yml -f compose.prod.yml up -d --remove-orphans || true
  fi
  if check_health "$CHECK_HOST" "$CHECK_PORT"; then
    log "Rollback completado; servicio previo restaurado y healthy."
  else
    log "CRÍTICO: Rollback ejecutado pero healthcheck sigue fallando. Revisar logs de contenedores."
  fi
else
  log "No hay digest previo completo registrado para rollback automático."
fi

exit 1
