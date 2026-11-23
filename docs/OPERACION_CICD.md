# Operación CI/CD — Equinox

Este documento describe los pipelines de GitHub Actions en `.github/workflows/`, separando lo que es **ejecutable hoy en CI** de lo que queda **parametrizado para CD** hasta contar con conectividad, secrets y aprobaciones reales.

---

## 1. Pipeline CI ejecutable hoy (`.github/workflows/ci.yml`)

Se ejecuta en `push` y `pull_request` hacia `develop` y `main`, y también puede invocarse manualmente (`workflow_dispatch`) o como gate reutilizable (`workflow_call`).

| Job | Qué valida | Runner |
|---|---|---|
| `secret-scan` | Escaneo de secretos en historial y árbol con `gitleaks` (`--redact --exit-code 1`) | `ubuntu-latest` |
| `dependency-audit` | Gate duro `npm audit --omit=dev --audit-level=critical` en backend y `frontend/`, más reporte `high/moderate` en el Job Summary | `ubuntu-latest` |
| `prisma-and-backend` | Levanta `postgres:16-alpine`, ejecuta `prisma generate`, `prisma validate`, `prisma migrate deploy`, `tsc` (`compilar` y `compilar:pruebas`) y tests unitarios aislados (`test/archivos-validacion.test.ts`, `test/limpieza-issue10.test.ts`) | `ubuntu-latest` |
| `frontend-build-and-tests` | `ng build` (`frontend/dist/equinox`) y 11 suites aisladas `node --test` en `frontend/test/*.test.cjs` | `ubuntu-latest` |
| `docker-build-verify` | Valida el build de `Dockerfile.backend` (contexto `.`) y `frontend/Dockerfile` (contexto `frontend`) sin hacer `push` | `ubuntu-latest` |

> **Política de `npm audit` (CI vs Producción):**
> - **Gate bloqueante actual:** `npm audit --omit=dev --audit-level=critical` (en raíz y `frontend/`), más reporte `high/moderate` en `$GITHUB_STEP_SUMMARY`.
> - **Hallazgos exactos auditados (2026-11-22):**
>   - **Raíz (`package-lock.json`) — 4 `high`, 0 `critical`:** `prisma` (`6.16.1`, `devDependencies`), `@prisma/config`, `deepmerge-ts` (`<8.0.0`, `GHSA-ggr8-5vv4-36mx`) y `effect` (`<=3.22.0`, `GHSA-7589-6fvf-x4pw`). Solo tienen arreglo con `npm audit fix --force` (salto breaking a `prisma@7.10.1`). Su alcance es **build/migración** (CLI `prisma`); el runtime `@prisma/client` no tiene avisos.
>   - **Frontend (`frontend/package-lock.json`) — `--omit=dev`: 1 `high`, 3 `moderate`, 0 `critical`:** `@angular/router` (`high`, `GHSA-ff3f-86qr-9cv3` y `GHSA-62vg-58rm-qff7`, DoS exclusivo de SSR; Equinox frontend es SPA estática en Nginx) y `@angular/common`/`@angular/forms`/`@angular/platform-browser` (`moderate`, `GHSA-jfgx-762w-99vr`). **Tiene fix compatible sin breaking change** (`npm audit fix` dentro de Angular `20.3.x`). En `devDependencies` de build (`@angular/build`, `@angular/cli`, `piscina`, `vite`, `zod`) hay `3 critical` y `9 high` de alcance **exclusivo de build/dev** también con `npm audit fix` disponible.
> - **Recomendación (`high` en CI vs Producción):**
>   - **Producción (`--omit=dev`):** `high` **debe bloquear** el despliegue una vez aplicado `npm audit fix` en `frontend/` (compatible) y separado/resuelto el aviso de `prisma` CLI en raíz, ya que cualquier `high` en runtime expone superficie directa en producción.
>   - **CI (`PR` / `develop`):** Mantener bloqueo estricto en `critical` sobre `--omit=dev` y escalar a `high` en `--omit=dev` en cuanto el integrador actualice `frontend/package-lock.json`; no bloquear PRs por `devDependencies` de build sin fix compatible (`prisma@7`), sino exigir reporte visible y plan de remediación.

---

## 2. Pipelines CD parametrizados (`cd-staging.yml` y `cd-production.yml`)

- **`develop` → Staging (`.github/workflows/cd-staging.yml`)**: corre el gate `ci.yml`, publica imágenes en GHCR (`ghcr.io/<owner>/equinox-backend` y `equinox-frontend` con tags `staging` y `sha-<commit>`) cuando `vars.CD_IMAGES_ENABLED == 'true'` (o `workflow_dispatch`), y despliega por SSH solo cuando `vars.STAGING_DEPLOY_ENABLED == 'true'`.
- **`main` → Producción (`.github/workflows/cd-production.yml`)**: **bloqueado estrictamente a `refs/heads/main`**. Nunca hace auto-deploy desde `develop`. Requiere `environment: production` (se recomienda activar *Required reviewers* en GitHub) y `vars.PROD_DEPLOY_ENABLED == 'true'`.

### Contrato con Docker / Compose

Los workflows de CD asumen el contrato acordado con Docker:
- `Dockerfile.backend` (contexto `.`) y `frontend/Dockerfile` (contexto `frontend`).
- `compose.yml` + `compose.prod.yml` consumiendo `BACKEND_IMAGE`, `FRONTEND_IMAGE` e `IMAGE_TAG`.
- Migraciones idempotentes mediante `docker compose -f compose.yml -f compose.prod.yml run --rm backend npm run prisma:desplegar`.
- Verificación de salud interna (`http://127.0.0.1:3000/salud/listo` en `backend` y `http://127.0.0.1/nginx-salud` en `frontend`).

---

## 3. Datos y requisitos faltantes para activar CD real

El servidor Ubuntu destino conocido actualmente responde en una IP privada LAN (`192.168.50.142`) y existe el dominio público `mena.date`. **Un runner hospedado en GitHub (`ubuntu-latest`) no puede alcanzar una IP privada LAN.** Por seguridad, no se ha fijado ninguna IP privada ni credencial en los workflows.

Para habilitar CD real se requiere definir y configurar:

1. **Conectividad del runner hacia el servidor**:
   - **Opción A (recomendada si el servidor sigue tras NAT/LAN):** Instalar un **GitHub Actions self-hosted runner** en el servidor Ubuntu (o en la misma LAN) y configurar la variable `STAGING_RUNNER` / `PROD_RUNNER` con `self-hosted` (o la etiqueta correspondiente), además de `STAGING_SSH_HOST=127.0.0.1` o la IP LAN como *Secret*.
   - **Opción B (si se expone SSH público o túnel VPN/WireGuard/Cloudflare Tunnel):** Confirmar el subdominio DNS bajo `mena.date` (ej. `staging.mena.date` / `app.mena.date`), puerto SSH, reglas de firewall/NAT y certificados TLS (reverse proxy / Certbot / Cloudflare).
2. **Variables de repositorio o entorno en GitHub (`Settings → Secrets and variables → Actions`)**:
   - `CD_IMAGES_ENABLED`: `'true'` para habilitar push automático de imágenes a GHCR en `develop`/`main`.
   - `STAGING_DEPLOY_ENABLED` / `PROD_DEPLOY_ENABLED`: `'true'` únicamente cuando el destino y los secrets estén listos.
   - `STAGING_RUNNER` / `PROD_RUNNER` (opcional, por defecto `ubuntu-latest`).
3. **Secrets por Environment (`staging` y `production`)**:
   - `STAGING_SSH_HOST` / `PROD_SSH_HOST`
   - `STAGING_SSH_USER` / `PROD_SSH_USER`
   - `STAGING_SSH_PORT` / `PROD_SSH_PORT` (opcional, por defecto `22`)
   - `STAGING_SSH_KEY` / `PROD_SSH_KEY` (clave privada dedicada de despliegue, nunca compartida en el repo)
   - `STAGING_SSH_KNOWN_HOSTS` / `PROD_SSH_KNOWN_HOSTS` (recomendado; salida de `ssh-keyscan`)
   - `STAGING_APP_DIR` / `PROD_APP_DIR` (ruta absoluta en el servidor donde residen `compose.yml`, `compose.prod.yml` y `.env`)
   - `GHCR_READ_USER` y `GHCR_READ_TOKEN` (PAT con `read:packages` si el paquete GHCR es privado y el token de workflow no basta en el host remoto).
4. **Preparación del servidor destino**:
   - Docker Engine y `docker compose` v2 instalados, usuario de despliegue en el grupo `docker`.
   - Archivo `.env` de producción creado manualmente en `$APP_DIR` a partir de `.env.production.example` (con `DATABASE_URL`, `SECRETO_JWT`, `URL_BASE`, `ORIGENES_PERMITIDOS`, `CONFIAR_PROXY`, etc.).
   - Regla de protección en GitHub para `main` y *Required reviewers* en el environment `production`.

---

## 4. Protecciones y Environments configurados en GitHub (`2026-11-22`)

Estado verificado vía GitHub REST API sobre `Kevin2523/Equinox` (repositorio público, sin activar flags CD ni fusionar PR #32):

### Cambios aplicados

1. **Ruleset de rama `main` (`id: 27871691`, nombre: `Proteccion de main (Equinox)`)**
   - **Scope:** únicamente `refs/heads/main` (`develop` permanece sin restricciones de PR/ruleset).
   - **Enforcement:** `active`, `bypass_actors: []` (`current_user_can_bypass: never`).
   - **Reglas activas:**
     - `deletion` y `non_fast_forward` (prohíbe borrar `main` o hacer force-push).
     - `pull_request` (`required_approving_review_count: 0`, bloquea `push` directo a `main` exigiendo PR, compatible con repositorio de un solo mantenedor).
     - `required_status_checks` (`strict_required_status_checks_policy: true`) exigiendo los 6 jobs de `.github/workflows/ci.yml`:
       - `Validación YAML, Workflows y Compose`
       - `Escaneo de secretos (Gitleaks)`
       - `Auditoría de dependencias (Backend y Frontend)`
       - `Prisma, Build y Tests Aislados Backend`
       - `Build y Tests Aislados Frontend`
       - `Validación Build Imágenes Docker`
2. **Environment `production` (`id: 28204883891`)**
   - **Aprobación manual:** `required_reviewers` con usuario `Kevin2523` (`id: 149086063`, `prevent_self_review: false`).
   - **Política de ramas:** `custom_branch_policies: true`, restringido exclusivamente a la rama `main` (`policy id: 67844770`).
3. **Environment `staging` (`id: 28204894728`)**
   - **Aprobación manual:** ninguna (despliegue automático cuando se habilite).
   - **Política de ramas:** `custom_branch_policies: true`, restringido exclusivamente a la rama `develop` (`policy id: 67844724`).
4. **Flags y secrets CD:** `actions/variables` (`total_count: 0`) y `actions/secrets` siguen vacíos (`CD_IMAGES_ENABLED`, `STAGING_DEPLOY_ENABLED`, `PROD_DEPLOY_ENABLED` desactivados).

### Rollback exacto

Si se necesita revertir estas protecciones en GitHub:

```bash
# 1. Eliminar ruleset de main
gh api --method DELETE /repos/Kevin2523/Equinox/rulesets/27871691

# 2. Eliminar environment production
gh api --method DELETE /repos/Kevin2523/Equinox/environments/production

# 3. Eliminar environment staging
gh api --method DELETE /repos/Kevin2523/Equinox/environments/staging
```

---

## 5. Arquitectura CD elegida: Pull-Based desde GHCR (sin SSH inbound)

Dado que el servidor Ubuntu casero opera tras NAT con **Cloudflare Tunnel** (sin SSH inbound abierto), `kevin` no pertenece al grupo `docker` (`sudo` interactivo), la llave SSH en Windows tiene passphrase con `ssh-agent` deshabilitado y se descarta un self-hosted runner privilegiado en el host de producción, se evaluaron las siguientes alternativas:

| Opción | Superficie inbound | Secretos de servidor en GitHub | Riesgo si comprometen CI/Secrets | Tolerancia a desconexión del host | Decisión |
|---|---|---|---|---|---|
| **Pull-based GHCR + Cosign OIDC + `systemd` timer** | **Ninguna** (solo tráfico saliente HTTPS a `ghcr.io` y Rekor/Sigstore) | **Ninguno** (0 SSH keys, 0 tokens CF) | No da shell ni acceso al host; Cosign valida workflow + rama exacta | **Alta** (converge en el siguiente tick del timer) | **Elegida (menor riesgo)** |
| Push SSH vía `cloudflared access ssh` | Expone endpoint SSH en Cloudflare Tunnel | `SSH_KEY`, `CF_ACCESS_CLIENT_ID/SECRET`, host, usuario | Acceso SSH + Docker (equivalente a root) | Media (falla si el host reinicia) | Descartada |
| Webhook HTTP local vía Cloudflare Tunnel | Expone endpoint HTTP en Cloudflare Tunnel | URL webhook + secreto HMAC | Superficie HTTP permanente + riesgo SSRF/replay | Baja (pierde eventos si host está caído) | Descartada |
| Self-hosted GitHub Runner en host prod | Ninguna | Runner token en host | **Crítico**: ejecución directa de jobs sobre host/socket Docker | Alta | **Descartada** |

### Cómo funciona el flujo Pull-Based implementado

1. **Staging (`develop` → `localhost:8081`)**:
   - `.github/workflows/cd-staging.yml` ejecuta `ci.yml`, construye y publica `ghcr.io/kevin2523/equinox-backend:staging` y `equinox-frontend:staging` (cuando `vars.CD_IMAGES_ENABLED == 'true'` o `workflow_dispatch`), y **firma ambos digests `@sha256:...` con Cosign keyless OIDC**.
2. **Producción (`main` → `localhost:8082`)**:
   - `.github/workflows/cd-production.yml` ejecuta `ci.yml` y **se detiene en `publish-images` esperando aprobación manual en `environment: production`** (`Kevin2523`).
   - Solo tras la aprobación publica `:prod`/`:latest`/`sha-...` y los firma con Cosign OIDC ligado a `refs/heads/main`.
3. **Agente Pull en Ubuntu (`deploy/cd/equinox-cd-pull.sh` + `systemd`)**:
   - Ejecutado por `equinox-cd@staging.timer` y `equinox-cd@production.timer` cada ~2 minutos como servicio `oneshot` aislado por `flock` y `COMPOSE_PROJECT_NAME` (`equinox-staging` vs `equinox-prod`).
   - Consulta el digest remoto vía API OCI v2 de `ghcr.io` sin descargar capas si no hay cambios.
   - Si el digest cambió, **verifica la firma Cosign OIDC** (`--certificate-oidc-issuer https://token.actions.githubusercontent.com` y `--certificate-identity` exacta del workflow y rama).
   - Descarga por digest inmutable (`BACKEND_IMAGE_REF` / `FRONTEND_IMAGE_REF` en `compose.prod.yml`), ejecuta `prisma migrate deploy` idempotente, levanta con `up -d --remove-orphans` y valida `/salud/listo` + `/nginx-salud`.
   - **Rollback automático**: si `up -d` o el healthcheck fallan, restaura los digests previos registrados en `/var/lib/equinox-cd/<env>.state`.
   - *Nota:* Los jobs SSH (`deploy-staging` / `deploy-production`) permanecen deshabilitados por defecto (`STAGING_DEPLOY_ENABLED` / `PROD_DEPLOY_ENABLED` sin definir).

### Pasos remotos exactos (pendientes de ejecutar en servidor Ubuntu y GitHub)

1. **En GitHub (`Settings → Secrets and variables → Actions → Variables`)**:
   - Crear únicamente la variable de repositorio `CD_IMAGES_ENABLED = true` cuando se desee activar la publicación de imágenes en GHCR.
   - **No** se requieren `STAGING_SSH_*`, `PROD_SSH_*`, `STAGING_DEPLOY_ENABLED`, `PROD_DEPLOY_ENABLED` ni tokens de Cloudflare.
2. **En el servidor Ubuntu (vía sesión interactiva con `sudo`, sin añadir `kevin` al grupo `docker`)**:
   - Instalar `cosign` (binario oficial verificado en `/usr/local/bin/cosign`).
   - Copiar `deploy/cd/equinox-cd-pull.sh` a `/usr/local/sbin/equinox-cd-pull.sh` (`chmod 0750`, `chown root:root`).
   - Copiar `deploy/cd/systemd/equinox-cd@.service` y `equinox-cd@.timer` a `/etc/systemd/system/`.
   - Preparar directorios independientes:
     - Staging (ya activo en `localhost:8081`): asegurar `COMPOSE_PROJECT_NAME=equinox-staging`, `compose.yml`, `compose.prod.yml` y `.env` (`FRONTEND_PORT=8081`).
     - Producción (`/opt/equinox-prod`): copiar `compose.yml`, `compose.prod.yml` y crear `.env` desde `.env.production.example` con credenciales nuevas (`POSTGRES_PASSWORD`, `SECRETO_JWT`, `URL_BASE`, `ORIGENES_PERMITIDOS`, `FRONTEND_BIND_IP=127.0.0.1`, `FRONTEND_PORT=8082`).
   - Crear `/etc/equinox-cd/staging.env` y `/etc/equinox-cd/production.env` (`chmod 0600`, `chown root:root`) tomando `deploy/cd/equinox-cd.env.example` como base.
   - Habilitar timers: `sudo systemctl daemon-reload && sudo systemctl enable --now equinox-cd@staging.timer equinox-cd@production.timer`.
   - En `cloudflared` (`/etc/cloudflared/config.yml`), enrutar el dominio de staging a `http://127.0.0.1:8081` y el de producción a `http://127.0.0.1:8082` (manteniendo `CONFIAR_PROXY=2` si Nginx + Cloudflare están delante).

### Credenciales necesarias

- **GitHub**: ninguna credencial nueva para pull-based en repo público (`GITHUB_TOKEN` + OIDC nativo firman y publican en GHCR). Solo si algún día el repo/paquete GHCR se vuelve privado se necesitaría un PAT `read:packages` en `/etc/equinox-cd/<env>.env` (`GHCR_READ_USER` / `GHCR_READ_TOKEN`).
- **Servidor Ubuntu**:
  - `.env` de producción (`/opt/equinox-prod/.env`, `0600`): `POSTGRES_PASSWORD` y `SECRETO_JWT` (`openssl rand -hex 32`) distintos a los de staging, más `URL_BASE` / `ORIGENES_PERMITIDOS` reales y `SMTP_*` si aplica.

### Riesgos residuales

1. **Migraciones de base de datos forward-only**: El rollback automático restaura los contenedores anteriores, pero `prisma migrate deploy` no revierte cambios destructivos de esquema en PostgreSQL. Mitigación: mantener migraciones aditivas/retrocompatibles y respaldo `pg_dump` previo a releases mayores.
2. **Disponibilidad de GHCR y Sigstore (Rekor/Fulcio)**: Si `ghcr.io` o Sigstore están degradados, el timer abortará sin afectar los contenedores en ejecución (`fail-closed`).
3. **Privilegios de `systemd` + `docker.sock`**: El servicio `equinox-cd@.service` corre como `root` para operar Docker sin meter a `kevin` en el grupo `docker`. Mitigación: script y `.env` propiedad de `root:root` (`0750`/`0600`) y verificación estricta de firma Cosign antes de hacer `pull`/`up`.
4. **Operación manual con `sudo` interactivo**: Para inspección manual de logs (`journalctl -u equinox-cd@production`) o backups, `kevin` seguirá usando `sudo` interactivo; no se debilita la seguridad de SSH ni del agente en Windows.
