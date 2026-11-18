# Contrato API: Panel Superadmin (`/api/admin`)

> **Propiedad del módulo:** `src/rutas/admin.ts` (exporta `rutasAdmin`, montado en `src/aplicacion.ts` bajo `/api/admin`).  
> **Suscripciones manuales:** Documentadas en [CONTRATO_ADMIN_SUSCRIPCIONES.md](./CONTRATO_ADMIN_SUSCRIPCIONES.md) bajo `/api/admin/suscripciones`.

---

## 1. Autenticación, Autorización y Seguridad

Todos los endpoints bajo `/api/admin` aplican `exigirAutenticacion` y `exigirSuperadmin`:

- **Sin token, token inválido, vencido o sesión revocada en BD:** `401 Unauthorized` (`{ "error": "..." }`).
- **Usuario autenticado sin rol global `ADMIN_GLOBAL`, con `tipoAcceso !== "ADMIN_GLOBAL"`, o sin `mfaVerificado === true`:** `403 Forbidden` (`{ "error": "..." }`).
- **IDs inválidos en parámetros de ruta:** `422 Unprocessable Entity` (`{ "error": "Datos inválidos", "detalles": [...] }`).
- **Recurso inexistente o que no pertenece al padre indicado en la ruta (anti-IDOR):** `404 Not Found`.
- **Campos sensibles nunca expuestos:** Ningún endpoint devuelve `contrasenaHash`, `tokenHash`, secretos MFA ni tokens en claro.

---

## 2. Convención de Paginación

Todos los listados paginados aceptan:
- `pagina`: entero `>= 1` (default `1`).
- `limite`: entero entre `1` y `100` (default `20`).

Y responden con:
```json
{
  "datos": [],
  "paginacion": {
    "pagina": 1,
    "limite": 20,
    "total": 0,
    "totalPaginas": 0
  }
}
```

---

## 3. Endpoints

### 3.1. Resumen / Métricas Globales

#### `GET /api/admin/resumen`
Devuelve conteos reales agregados directamente desde PostgreSQL y los últimos eventos de auditoría administrativa.

- **Respuesta `200`:**
```json
{
  "organizaciones": {
    "total": 10,
    "activas": 9,
    "suspendidas": 1,
    "porTipoFreelance": {
      "GENERAL": 6,
      "DESARROLLO_SOFTWARE": 2,
      "FOTOGRAFIA": 2,
      "DISENO_GRAFICO": 0
    },
    "porEstadoSuscripcion": {
      "SIN_SUSCRIPCION": 8,
      "PRUEBA": 1,
      "ACTIVA": 1,
      "SUSPENDIDA": 0,
      "CANCELADA": 0
    }
  },
  "usuarios": {
    "total": 25,
    "verificados": 20,
    "conAccesoOrganizacion": 12,
    "conAccesoCliente": 13,
    "adminsGlobales": 1,
    "sesionesActivas": 9
  },
  "operacion": {
    "clientes": 30,
    "proyectos": 18,
    "facturas": 12,
    "sesionesFotograficas": 4,
    "fotos": 40
  },
  "auditoria": {
    "eventosTotales": 15,
    "eventosUltimas24h": 5
  },
  "actividadReciente": [
    {
      "id": "uuid",
      "accion": "ORGANIZACION_ACTUALIZADA",
      "entidad": "Organizacion",
      "entidadId": "uuid",
      "actorUsuarioId": "uuid",
      "actorCorreo": "admin@equinox.pa",
      "creadoEn": "2026-11-17T15:00:00.000Z"
    }
  ]
}
```

---

### 3.2. Organizaciones

#### `GET /api/admin/organizaciones`
Listado paginado de organizaciones reales con sus conteos operativos, propietarios y estado de suscripción manual.

- **Query params:**
  - `pagina` (default `1`)
  - `limite` (default `20`, max `100`)
  - `busqueda` (string, busca por `nombre`, `slug`, `correoContacto`, `ruc`)
  - `tipoFreelance` (`GENERAL` | `DESARROLLO_SOFTWARE` | `FOTOGRAFIA` | `DISENO_GRAFICO`)
  - `estadoSuscripcion` (`SIN_SUSCRIPCION` | `PRUEBA` | `ACTIVA` | `SUSPENDIDA` | `CANCELADA`)
  - `suspendida` (`"true"` | `"false"`, filtra por `Organizacion.suspendidaEn`)
- **Respuesta `200`:**
```json
{
  "datos": [
    {
      "id": "uuid",
      "nombre": "Estudio Demo",
      "slug": "estudio-demo",
      "correoContacto": "contacto@demo.pa",
      "ruc": "123456-1-123456",
      "moneda": "PAB",
      "tipoFreelance": "FOTOGRAFIA",
      "portalMostrarFinanzas": true,
      "creadoEn": "2026-10-01T12:00:00.000Z",
      "actualizadoEn": "2026-11-17T10:00:00.000Z",
      "conteos": {
        "miembros": 2,
        "clientes": 8,
        "proyectos": 5,
        "facturas": 3,
        "sesionesFotograficas": 2
      },
      "propietarios": [
        {
          "id": "uuid",
          "nombre": "Ana",
          "apellido": "Pérez",
          "correo": "ana@demo.pa"
        }
      ],
      "suscripcion": {
        "id": "uuid | null",
        "estado": "SIN_SUSCRIPCION",
        "plan": {
          "id": "uuid",
          "codigo": "BASE_MANUAL",
          "nombre": "Plan Base"
        },
        "fechaInicio": "2026-11-17T00:00:00.000Z",
        "fechaFin": null,
        "modalidadGestion": "MANUAL_SIN_COBRO"
      }
    }
  ],
  "paginacion": { "pagina": 1, "limite": 20, "total": 1, "totalPaginas": 1 }
}
```

#### `GET /api/admin/organizaciones/:organizacionId`
Detalle completo de una organización, sus miembros, resumen de clientes, suscripción actual y eventos de auditoría recientes.

- **Errores:** `422` si `organizacionId` no es UUID, `404` si no existe.
- **Respuesta `200`:**
```json
{
  "organizacion": {
    "id": "uuid",
    "nombre": "Estudio Demo",
    "slug": "estudio-demo",
    "descripcion": "Estudio creativo",
    "moneda": "PAB",
    "ruc": "123456-1-123456",
    "direccion": "Ciudad de Panamá",
    "telefono": "+507 6000-0000",
    "correoContacto": "contacto@demo.pa",
    "tipoFreelance": "FOTOGRAFIA",
    "portalMostrarFinanzas": true,
    "dominioPortal": null,
    "creadoEn": "2026-10-01T12:00:00.000Z",
    "actualizadoEn": "2026-11-17T10:00:00.000Z",
    "conteos": {
      "miembros": 2,
      "clientes": 8,
      "proyectos": 5,
      "facturas": 3,
      "sesionesFotograficas": 2
    },
    "miembros": [
      {
        "id": "uuid",
        "usuarioId": "uuid",
        "rol": "PROPIETARIO",
        "creadoEn": "2026-10-01T12:00:00.000Z",
        "usuario": {
          "id": "uuid",
          "nombre": "Ana",
          "apellido": "Pérez",
          "correo": "ana@demo.pa",
          "rolPlataforma": "USUARIO",
          "ultimoAccesoEn": "2026-11-17T09:00:00.000Z"
        }
      }
    ],
    "suscripcion": {
      "id": "uuid | null",
      "estado": "SIN_SUSCRIPCION",
      "plan": null,
      "fechaInicio": null,
      "fechaFin": null,
      "modalidadGestion": "MANUAL_SIN_COBRO",
      "etiquetaCobro": "Manual, sin cobro procesado"
    },
    "auditoriaReciente": []
  }
}
```

#### `PATCH /api/admin/organizaciones/:organizacionId`
Actualiza metadatos administrativos básicos de una organización y registra auditoría (`ORGANIZACION_ACTUALIZADA`).

- **Body:**
  - `nombre` (string, 2-120 chars, opcional)
  - `correoContacto` (email | `""` | `null`, opcional)
  - `ruc` (string <= 60 | `""` | `null`, opcional)
  - `moneda` (string 3 chars uppercase, opcional)
  - `tipoFreelance` (`GENERAL` | `DESARROLLO_SOFTWARE` | `FOTOGRAFIA` | `DISENO_GRAFICO`, opcional)
  - `portalMostrarFinanzas` (boolean, opcional)
  - `motivo` (string, max 500, opcional — se registra en auditoría)
- **Errores:** `422` si datos inválidos o sin campos a actualizar, `404` si no existe.
- **Respuesta `200`:** `{ "organizacion": OrganizacionAdminDetalleDTO }`

#### `PATCH /api/admin/organizaciones/:organizacionId/miembros/:miembroId`
Cambia el rol de estudio (`PROPIETARIO` | `COLABORADOR`) de un miembro existente dentro de la organización y registra auditoría (`MIEMBRO_ROL_ACTUALIZADO`).

- **Body:** `{ "rol": "PROPIETARIO" | "COLABORADOR", "motivo"?: "string (max 500)" }`
- **Reglas de seguridad:**
  - Nunca permite asignar `ADMIN_GLOBAL` (`422`).
  - No permite degradar al último `PROPIETARIO` de la organización (`422`).
  - Protección IDOR: `miembroId` debe pertenecer exactamente a `:organizacionId` (`404` en caso contrario).
- **Respuesta `200`:** `{ "miembro": { "id", "usuarioId", "organizacionId", "rol", "creadoEn", "usuario": { "id", "nombre", "apellido", "correo" } } }`

#### `POST /api/admin/organizaciones/:organizacionId/suspender`
Suspende el acceso operativo de una organización usando el campo independiente `Organizacion.suspendidaEn` (no modifica `SuscripcionOrganizacion.estado`, que es únicamente comercial), revoca de inmediato las sesiones activas (`ORGANIZACION` y `CLIENTE`) de sus usuarios vinculados y registra auditoría (`ORGANIZACION_SUSPENDIDA`).

- **Body:** `{ "confirmar": true, "motivo": "string (3-500 chars)" }`
- **Errores:** `422` si falta `confirmar: true` o `motivo` inválido; `404` si no existe; `409` si ya estaba suspendida.
- **Respuesta `200`:** `{ "organizacion": OrganizacionAdminDetalleDTO, "sesionesRevocadas": number }`

#### `POST /api/admin/organizaciones/:organizacionId/reactivar`
Reactiva una organización previamente suspendida limpiando `Organizacion.suspendidaEn`, `motivoSuspension` y `suspendidaPorUsuarioId`, y registra auditoría (`ORGANIZACION_REACTIVADA`).

- **Body:** `{ "confirmar": true, "motivo"?: "string (max 500)" }`
- **Errores:** `422` si falta `confirmar: true`; `404` si no existe; `409` si no estaba suspendida.
- **Respuesta `200`:** `{ "organizacion": OrganizacionAdminDetalleDTO }`

---

### 3.3. Usuarios y Accesos

#### `GET /api/admin/usuarios`
Listado paginado de usuarios de la plataforma con sus membresías de organización, accesos de cliente y conteo de sesiones activas.

- **Query params:**
  - `pagina` (default `1`)
  - `limite` (default `20`, max `100`)
  - `busqueda` (string, busca por `nombre`, `apellido`, `correo`)
  - `rolPlataforma` (`USUARIO` | `ADMIN_GLOBAL`)
  - `tipoAcceso` (`ORGANIZACION` | `CLIENTE` | `ADMIN_GLOBAL`)
  - `organizacionId` (uuid — filtra usuarios vinculados a esa org como miembro o acceso cliente)
- **Respuesta `200`:**
```json
{
  "datos": [
    {
      "id": "uuid",
      "correo": "ana@demo.pa",
      "nombre": "Ana",
      "apellido": "Pérez",
      "telefono": "+507 6000-0000",
      "rolPlataforma": "USUARIO",
      "correoVerificadoEn": "2026-10-01T12:00:00.000Z",
      "ultimoAccesoEn": "2026-11-17T09:00:00.000Z",
      "creadoEn": "2026-10-01T12:00:00.000Z",
      "sesionesActivasCount": 1,
      "membresias": [
        {
          "id": "uuid",
          "organizacionId": "uuid",
          "organizacionNombre": "Estudio Demo",
          "organizacionSlug": "estudio-demo",
          "tipoFreelance": "FOTOGRAFIA",
          "rol": "PROPIETARIO"
        }
      ],
      "accesosCliente": [
        {
          "id": "uuid",
          "organizacionId": "uuid",
          "organizacionNombre": "Otro Estudio",
          "tipoFreelance": "GENERAL",
          "clienteId": "uuid",
          "clienteNombre": "Cliente S.A.",
          "rol": "TITULAR",
          "activo": true
        }
      ]
    }
  ],
  "paginacion": { "pagina": 1, "limite": 20, "total": 1, "totalPaginas": 1 }
}
```

#### `GET /api/admin/usuarios/:usuarioId`
Detalle de un usuario, sus membresías, accesos de cliente, sesiones activas (sin `tokenHash`) y auditoría reciente.

- **Errores:** `422` si `usuarioId` no es UUID, `404` si no existe.
- **Respuesta `200`:** `{ "usuario": UsuarioAdminDetalleDTO }` (incluye `sesionesActivas: Array<{ id, tipoAcceso, mfaVerificado, creadoEn, expiraEn }>` y `auditoriaReciente`).

#### `POST /api/admin/usuarios/:usuarioId/revocar-sesiones`
Revoca sesiones activas del usuario (todas excepto la sesión actual del admin invocante, o una sesión específica vía `sesionId`) y registra auditoría (`SESIONES_REVOCADAS` / `SESION_REVOCADA`).

- **Body:** `{ "sesionId"?: "uuid", "motivo"?: "string (max 500)" }`
- **Protección IDOR:** Si se envía `sesionId`, se exige que esa sesión pertenezca exactamente a `:usuarioId` (de lo contrario `404`). Si `:usuarioId` es el propio admin y `sesionId` coincide con la sesión actual en uso, devuelve `422`.
- **Respuesta `200`:** `{ "usuarioId": "uuid", "sesionesRevocadas": 2 }`

#### `PATCH /api/admin/usuarios/:usuarioId/accesos-cliente/:accesoId`
Habilita o deshabilita un `AccesoCliente` específico del usuario y registra auditoría (`ACCESO_CLIENTE_ACTUALIZADO`).

- **Body:** `{ "activo": boolean, "motivo"?: "string (max 500)" }`
- **Protección IDOR:** Verifica que `accesoId` pertenezca exactamente a `:usuarioId`; si pertenece a otro usuario o no existe, responde `404`.
- **Respuesta `200`:**
```json
{
  "acceso": {
    "id": "uuid",
    "usuarioId": "uuid",
    "organizacionId": "uuid",
    "clienteId": "uuid",
    "rol": "TITULAR",
    "activo": false,
    "actualizadoEn": "2026-11-17T15:05:00.000Z"
  }
}
```

---

### 3.4. Auditoría Administrativa

#### `GET /api/admin/auditoria`
Listado paginado de eventos registrados en `AuditoriaAdmin`.

- **Query params:**
  - `pagina` (default `1`)
  - `limite` (default `20`, max `100`)
  - `accion` (string)
  - `entidad` (string)
  - `entidadId` (string)
  - `actorUsuarioId` (uuid)
  - `organizacionId` (uuid — filtra donde `entidadId === organizacionId` o `metadatos.organizacionId === organizacionId`)
  - `desde` (fecha ISO-8601)
  - `hasta` (fecha ISO-8601)
  - `busqueda` (string en `accion`, `entidad`, `entidadId`, `actorCorreo`)
- **Respuesta `200`:**
```json
{
  "datos": [
    {
      "id": "uuid",
      "actorUsuarioId": "uuid",
      "actorCorreo": "admin@equinox.pa",
      "accion": "ACCESO_CLIENTE_ACTUALIZADO",
      "entidad": "AccesoCliente",
      "entidadId": "uuid",
      "ip": "127.0.0.1",
      "userAgent": "Mozilla/5.0...",
      "metadatos": {
        "antes": { "activo": true },
        "despues": { "activo": false },
        "motivo": "Solicitud de soporte"
      },
      "creadoEn": "2026-11-17T15:05:00.000Z"
    }
  ],
  "paginacion": { "pagina": 1, "limite": 20, "total": 1, "totalPaginas": 1 }
}
```
