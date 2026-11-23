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
