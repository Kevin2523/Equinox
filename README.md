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
| Proyectos | `/api/proyectos` | CRUD, tareas, hitos, archivos y comentarios para miembros de la organización. |
| Facturas | `/api/facturas` | CRUD de facturación. |
| Portal | `/api/portal` | API autenticada para clientes: ficha, proyectos propios, hitos visibles, archivos autorizados, comentarios y facturas habilitadas. |

Las rutas internas requieren `Authorization: Bearer <token>`. Consulta el modelo visual de datos en [docs/DIAGRAMA_ER.md](docs/DIAGRAMA_ER.md).

El portal requiere una sesión de cliente y un acceso activo. El acceso heredado por
`/api/portal/:token` y la emisión de enlaces desde
`/api/proyectos/:id/accesos-portal` fueron retirados. Los datos heredados se
conservan en PostgreSQL sin habilitar esas rutas.

## Archivos en desarrollo

`POST /api/proyectos/:id/archivos` recibe un formulario multipart con `archivo` y
`visibilidad` (`INTERNA` o `CLIENTE`). Admite PDF, PNG, JPG, WebP, GIF y TXT de hasta
8 MB. PostgreSQL guarda metadatos y una clave opaca; el contenido se guarda de forma
privada en `.archivos-desarrollo/` o en el directorio indicado por
`EQUINOX_ARCHIVOS_DIR`. La descarga usa las rutas autenticadas
`GET /api/proyectos/:id/archivos/:archivoId/descargar` y
`GET /api/portal/proyectos/:proyectoId/archivos/:archivoId/descargar`.
El portal solo permite archivos con visibilidad `CLIENTE` del cliente y organización
de la sesión. La eliminación aparta el archivo, elimina los metadatos y retira el
contenido; si falla la base, devuelve el archivo a su ubicación privada.

Este almacén local es **solo para desarrollo** y se deshabilita en producción.
Antes de desplegar archivos hay que implementar un proveedor privado de producción,
su política de limpieza de objetos pendientes y copias de seguridad. Los registros
heredados que contienen URL externas no se descargan por las rutas nuevas.
