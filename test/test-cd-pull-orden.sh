#!/usr/bin/env bash
set -euo pipefail

# Prueba de protección contra despliegues fuera de orden en deploy/cd/equinox-cd-pull.sh
# Simula el incidente real: :prod sobrescrito por commit antiguo 6caf3a9 tras fb6d1c2.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin" "$WORK/app" "$WORK/state" "$WORK/lock"
cp "$ROOT_DIR/compose.yml" "$ROOT_DIR/compose.prod.yml" "$WORK/app/"
touch "$WORK/app/.env"

LOG="$WORK/calls.log"
: > "$LOG"

SHA_OLD="6caf3a9000000000000000000000000000000000"
SHA_NEW="fb6d1c2000000000000000000000000000000000"
SHA_NEXT="aaaa111100000000000000000000000000000000"

echo "$SHA_NEW" > "$WORK/github_head"

cat >"$WORK/bin/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"$WORK/bin/python3" <<'EOF'
#!/usr/bin/env bash
printf 'tok_mock'
EOF

cat >"$WORK/bin/cosign" <<EOF
#!/usr/bin/env bash
echo "cosign \$*" >> "$LOG"
exit 0
EOF

cat >"$WORK/bin/curl" <<EOF
#!/usr/bin/env bash
url="\${@: -1}"
if [[ "\$url" == *"api.github.com/repos/"*"/commits/"* ]]; then
  cat "$WORK/github_head"
  exit 0
fi
if [[ "\$url" == *"ghcr.io/token"* ]]; then
  printf '{"token":"tok_mock"}'
  exit 0
fi
if [[ "\$url" == *"/manifests/"* ]]; then
  tag="\${url##*/manifests/}"
  if [[ "\$tag" == "prod" || "\$tag" == "sha-${SHA_OLD}" ]]; then
    # Etiqueta mutable :prod envenenada por run tardío antiguo 6caf3a9
    if [[ "\$url" == *"equinox-backend"* ]]; then
      printf 'HTTP/2 200\r\ndocker-content-digest: sha256:%064d\r\n\r\n__HTTP_CODE__:200\n' 91
    elif [[ "\$url" == *"equinox-migrator"* ]]; then
      printf 'HTTP/2 200\r\ndocker-content-digest: sha256:%064d\r\n\r\n__HTTP_CODE__:200\n' 92
    else
      printf 'HTTP/2 200\r\ndocker-content-digest: sha256:%064d\r\n\r\n__HTTP_CODE__:200\n' 93
    fi
    exit 0
  fi
  if [[ "\$tag" == "sha-${SHA_NEW}" ]]; then
    if [[ "\$url" == *"equinox-backend"* ]]; then
      printf 'HTTP/2 200\r\ndocker-content-digest: sha256:%064d\r\n\r\n__HTTP_CODE__:200\n' 11
    elif [[ "\$url" == *"equinox-migrator"* ]]; then
      printf 'HTTP/2 200\r\ndocker-content-digest: sha256:%064d\r\n\r\n__HTTP_CODE__:200\n' 12
    else
      printf 'HTTP/2 200\r\ndocker-content-digest: sha256:%064d\r\n\r\n__HTTP_CODE__:200\n' 13
    fi
    exit 0
  fi
  if [[ "\$tag" == "sha-${SHA_NEXT}" ]] && [ -f "$WORK/publish_next" ]; then
    if [[ "\$url" == *"equinox-backend"* ]]; then
      printf 'HTTP/2 200\r\ndocker-content-digest: sha256:%064d\r\n\r\n__HTTP_CODE__:200\n' 21
    elif [[ "\$url" == *"equinox-migrator"* ]]; then
      printf 'HTTP/2 200\r\ndocker-content-digest: sha256:%064d\r\n\r\n__HTTP_CODE__:200\n' 22
    else
      printf 'HTTP/2 200\r\ndocker-content-digest: sha256:%064d\r\n\r\n__HTTP_CODE__:200\n' 23
    fi
    exit 0
  fi
  printf 'HTTP/2 404\r\n\r\n__HTTP_CODE__:404\n'
  exit 0
fi
if [[ "\$url" == *"/nginx-salud"* || "\$url" == *"/salud/listo"* ]]; then
  if [ -f "$WORK/fail_health" ]; then
    exit 1
  fi
  exit 0
fi
exit 0
EOF

cat >"$WORK/bin/docker" <<EOF
#!/usr/bin/env bash
echo "docker \$* [refs:\${BACKEND_IMAGE_REF:-}|\${MIGRATOR_IMAGE_REF:-}|\${FRONTEND_IMAGE_REF:-}]" >> "$LOG"
if [[ "\$*" == *"--pull never"* ]]; then
  rm -f "$WORK/fail_health"
fi
if [[ "\$*" == *"exec -T backend"* ]] && [ -f "$WORK/fail_health" ]; then
  exit 1
fi
exit 0
EOF

chmod +x "$WORK/bin/"*
export PATH="$WORK/bin:$PATH"
export ENV_NAME=production
export APP_DIR="$WORK/app"
export COMPOSE_PROJECT_NAME=equinox-prod
export BACKEND_IMAGE=ghcr.io/kevin2523/equinox-backend
export MIGRATOR_IMAGE=ghcr.io/kevin2523/equinox-migrator
export FRONTEND_IMAGE=ghcr.io/kevin2523/equinox-frontend
export ALLOWED_WORKFLOW_REF="https://github.com/Kevin2523/Equinox/.github/workflows/cd-production.yml@refs/heads/main"
export VERIFY_COSIGN=true
export STATE_DIR="$WORK/state"
export LOCK_DIR="$WORK/lock"
export HEALTH_TIMEOUT_SEC=4
export HEALTH_INTERVAL_SEC=1

# 1. Aun con :prod envenenado a 6caf3a9, debe resolver HEAD fb6d1c2 por tag inmutable sha-fb6d1c2
bash "$ROOT_DIR/deploy/cd/equinox-cd-pull.sh"
grep -q "COMMIT_SHA=${SHA_NEW}" "$WORK/app/.cd-active-refs.env"
grep -q "CURRENT_COMMIT_SHA=${SHA_NEW}" "$WORK/state/production.state"
grep -q "0000000000000000000000000000000000000000000000000000000000000011" "$WORK/app/.cd-active-refs.env"
if grep -q "0000000000000000000000000000000000000000000000000000000000000091" "$LOG"; then
  echo "ERROR: uso etiqueta mutable :prod envenenada con 6caf3a9"
  exit 1
fi
echo "TEST_1_IMMUTABLE_HEAD_IGNORES_POISONED_PROD_OK"

# 2. Intento explícito fuera de orden con sha-6caf3a9 debe bloquearse
OUT2=$(IMAGE_TAG="sha-${SHA_OLD}" bash "$ROOT_DIR/deploy/cd/equinox-cd-pull.sh" 2>&1 || true)
echo "$OUT2" | grep -q "intento de despliegue fuera de orden"
grep -q "CURRENT_COMMIT_SHA=${SHA_NEW}" "$WORK/state/production.state"
echo "TEST_2_OUT_OF_ORDER_BLOCKED_OK"

# 3. Nuevo HEAD aún sin publicar en GHCR (404) debe mantener fb6d1c2 sin hacer downgrade a :prod
echo "$SHA_NEXT" > "$WORK/github_head"
OUT3=$(bash "$ROOT_DIR/deploy/cd/equinox-cd-pull.sh")
echo "$OUT3" | grep -q "aún no publicado en GHCR"
grep -q "CURRENT_COMMIT_SHA=${SHA_NEW}" "$WORK/state/production.state"
echo "TEST_3_PENDING_HEAD_NO_DOWNGRADE_OK"

# 4. Publicado sha-aaaa1111 con fallo de salud -> rollback automático a fb6d1c2 + bloqueo de reintento
touch "$WORK/publish_next" "$WORK/fail_health"
: > "$LOG"
if bash "$ROOT_DIR/deploy/cd/equinox-cd-pull.sh"; then
  echo "ERROR: debio fallar por healthcheck"
  exit 1
fi
grep -q "CURRENT_COMMIT_SHA=${SHA_NEW}" "$WORK/state/production.state"
grep -q "FAILED_COMMIT_SHA=${SHA_NEXT}" "$WORK/state/production.state"
grep -q "up -d --remove-orphans --pull never" "$LOG"
echo "TEST_4_ROLLBACK_TO_FB6D1C2_OK"
