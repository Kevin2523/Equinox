# Equinox API

Backend en Express, TypeScript, Prisma y PostgreSQL para el CRM Equinox.

## Inicio rápido

1. Copia `.env.ejemplo` como `.env` y completa `DATABASE_URL` y `SECRETO_JWT`.
2. Ejecuta `npm.cmd install`.
3. Ejecuta `npm.cmd run prisma:migrar -- --name inicial`.
4. Inicia el servidor con `npm.cmd run desarrollo`.

La API queda en `http://localhost:3000` y su comprobación de salud en `GET /salud`.

## Rutas principales

| Grupo | Ruta base | Uso |
|---|---|---|
| Autenticación | `/api/autenticacion` | Registro, inicio de sesión y perfil. |
| Organización | `/api/organizacion` | Marca, configuración y panel. |
| Clientes | `/api/clientes` | CRUD e historial de clientes. |
| Proyectos | `/api/proyectos` | CRUD, tareas, hitos, archivos, comentarios y enlaces de portal. |
| Facturas | `/api/facturas` | CRUD de facturación. |
| Portal | `/api/portal/:token` | Vista pública y feedback del cliente. |

Las rutas internas requieren `Authorization: Bearer <token>`. Consulta el modelo visual de datos en [docs/DIAGRAMA_ER.md](docs/DIAGRAMA_ER.md).
