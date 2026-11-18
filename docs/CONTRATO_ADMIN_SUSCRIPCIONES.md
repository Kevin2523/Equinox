# Contrato API: Suscripciones Manuales (Panel Superadmin)

> **Principio rector:** Todas las suscripciones son **manuales, sin cobro procesado** (`modalidadGestion: "MANUAL_SIN_COBRO"`, `etiquetaCobro: "Manual, sin cobro procesado"`). No existe pasarela de pago, no hay cobros automáticos, no se bloquean módulos operativos y no existen precios ficticios ni estado `PAGADO`.

## Autenticación y autorización

- Todos los endpoints bajo `/api/admin/suscripciones` requieren autenticación válida con rol global `ADMIN_GLOBAL`.
- Cualquier usuario sin sesión (`401`) o sin rol `ADMIN_GLOBAL` (incluidos `PROPIETARIO`, `COLABORADOR`, `CLIENTE`) recibe `403`.

## Estados explícitos (`EstadoSuscripcion`)

| Estado | Significado |
| --- | --- |
| `SIN_SUSCRIPCION` | La organización no tiene una suscripción manual asignada todavía. |
| `PRUEBA` | Período de prueba manual asignado por un `ADMIN_GLOBAL`. |
| `ACTIVA` | Suscripción manual activa. |
| `SUSPENDIDA` | Suscripción suspendida manualmente de forma temporal. |
| `CANCELADA` | Suscripción cancelada manualmente (se conserva historial completo). |

### Transiciones válidas

- Desde `SIN_SUSCRIPCION`: `PRUEBA`, `ACTIVA`
- Desde `PRUEBA`: `PRUEBA`, `ACTIVA`, `SUSPENDIDA`, `CANCELADA`
- Desde `ACTIVA`: `ACTIVA`, `PRUEBA`, `SUSPENDIDA`, `CANCELADA`
- Desde `SUSPENDIDA`: `ACTIVA`, `PRUEBA`, `CANCELADA`
- Desde `CANCELADA`: `PRUEBA`, `ACTIVA` (nueva asignación manual)

Transiciones inválidas (por ejemplo `SIN_SUSCRIPCION -> CANCELADA` o `CANCELADA -> CANCELADA`) devuelven `422`.

### Validación de fechas

- `fechaInicio`: fecha ISO-8601. Si se omite al asignar, toma la fecha/hora actual.
- `fechaFin`: fecha ISO-8601 opcional (`null` = vigencia indefinida manual). Si se proporciona, debe ser estrictamente posterior a `fechaInicio` (`fechaFin > fechaInicio`), de lo contrario `422`.
- En estado `PRUEBA`, si se omite `fechaFin` y el plan tiene `duracionSugeridaDias`, se calcula automáticamente `fechaInicio + duracionSugeridaDias`.

---

## Endpoints

### 1. Catálogo de planes (paginado)

#### `GET /api/admin/suscripciones/planes`
- Query: `pagina` (default `1`), `limite` (default `20`, max `100`), `activo` (`true` | `false`), `busqueda` (texto en `codigo`, `nombre`, `descripcion`).
- Respuesta `200`:
```json
{
  "datos": [
    {
      "id": "uuid",
      "codigo": "PRUEBA_MANUAL",
      "nombre": "Prueba Manual",
      "descripcion": "Plan de evaluación asignado manualmente",
      "activo": true,
      "esPlanPrueba": true,
      "duracionSugeridaDias": 14,
      "caracteristicas": { "nota": "Referencia operativa" },
      "orden": 1,
      "modalidadGestion": "MANUAL_SIN_COBRO",
      "etiquetaCobro": "Manual, sin cobro procesado",
      "creadoEn": "2026-11-17T10:00:00.000Z",
      "actualizadoEn": "2026-11-17T10:00:00.000Z"
    }
  ],
  "paginacion": { "pagina": 1, "limite": 20, "total": 1, "totalPaginas": 1 },
  "modalidadGestion": "MANUAL_SIN_COBRO",
  "etiquetaCobro": "Manual, sin cobro procesado"
}
```

#### `POST /api/admin/suscripciones/planes`
- Body:
  - `codigo` (string, 2-60 chars, alfanumérico/`_`/`-`, se normaliza a mayúsculas)
  - `nombre` (string, 2-120 chars)
  - `descripcion` (string?, max 500)
  - `activo` (boolean?, default `true`)
  - `esPlanPrueba` (boolean?, default `false`)
  - `duracionSugeridaDias` (int > 0?, nullable)
  - `caracteristicas` (record/json?, nullable)
  - `orden` (int >= 0?, default `0`)
- Respuesta `201`: `{ "plan": PlanDTO, "modalidadGestion": "MANUAL_SIN_COBRO", "etiquetaCobro": "Manual, sin cobro procesado" }`
- Errores: `409` si `codigo` ya existe, `422` si datos inválidos.

#### `PATCH /api/admin/suscripciones/planes/:planId`
- Body: actualización parcial de los campos anteriores.
- Respuesta `200`: `{ "plan": PlanDTO, "modalidadGestion": "MANUAL_SIN_COBRO", "etiquetaCobro": "Manual, sin cobro procesado" }`

---

### 2. Suscripciones por organización (paginado)

#### `GET /api/admin/suscripciones`
- Query: `pagina` (default `1`), `limite` (default `20`, max `100`), `estado` (`SIN_SUSCRIPCION` | `PRUEBA` | `ACTIVA` | `SUSPENDIDA` | `CANCELADA`), `planId` (uuid), `busqueda` (nombre, slug o correoContacto de la organización).
- Respuesta `200`:
```json
{
  "datos": [
    {
      "organizacion": {
        "id": "uuid",
        "nombre": "Estudio Demo",
        "slug": "estudio-demo",
        "correoContacto": "contacto@demo.pa",
        "tipoFreelance": "GENERAL"
      },
      "suscripcion": {
        "id": "uuid | null",
        "estado": "ACTIVA",
        "plan": { "id": "uuid", "codigo": "BASE_MANUAL", "nombre": "Plan Base", "esPlanPrueba": false },
        "fechaInicio": "2026-11-17T00:00:00.000Z",
        "fechaFin": null,
        "asignadoEn": "2026-11-17T10:00:00.000Z",
        "asignadoPor": { "id": "uuid", "nombre": "Admin", "correo": "admin@equinox.pa" },
        "referenciaManual": "Acuerdo piloto #12",
        "motivo": "Alta manual inicial",
        "modalidadGestion": "MANUAL_SIN_COBRO",
        "etiquetaCobro": "Manual, sin cobro procesado"
      }
    }
  ],
  "paginacion": { "pagina": 1, "limite": 20, "total": 1, "totalPaginas": 1 },
  "resumenEstados": {
    "SIN_SUSCRIPCION": 0,
    "PRUEBA": 0,
    "ACTIVA": 1,
    "SUSPENDIDA": 0,
    "CANCELADA": 0
  },
  "modalidadGestion": "MANUAL_SIN_COBRO",
  "etiquetaCobro": "Manual, sin cobro procesado"
}
```

#### `GET /api/admin/suscripciones/organizaciones/:organizacionId`
- Respuesta `200`: detalle de la suscripción actual de la organización (si nunca tuvo registro, devuelve `id: null`, `estado: "SIN_SUSCRIPCION"`, `plan: null`, `etiquetaCobro: "Manual, sin cobro procesado"`).

---

### 3. Asignación, cambio y cancelación manual (auditados)

#### `POST /api/admin/suscripciones/organizaciones/:organizacionId/asignar`
- Body:
  - `planId` (uuid, requerido; el plan debe existir y estar `activo: true`)
  - `estado` (`"PRUEBA"` | `"ACTIVA"`, requerido)
  - `fechaInicio` (ISO date?, default ahora)
  - `fechaFin` (ISO date?, nullable)
  - `motivo` (string?, max 500)
  - `notasInternas` (string?, max 2000)
  - `referenciaManual` (string?, max 200)
- Respuesta `200` (o `201` si se crea registro inicial): `{ "suscripcion": SuscripcionDetalleDTO, "modalidadGestion": "MANUAL_SIN_COBRO", "etiquetaCobro": "Manual, sin cobro procesado" }`

#### `PATCH /api/admin/suscripciones/organizaciones/:organizacionId`
- Permite cambiar plan, transición de estado (`PRUEBA`, `ACTIVA`, `SUSPENDIDA`), fechas o notas de una suscripción existente.
- Body: `{ planId?, estado?, fechaInicio?, fechaFin?, motivo?, notasInternas?, referenciaManual? }`
- Respuesta `200`: `{ "suscripcion": SuscripcionDetalleDTO, "modalidadGestion": "MANUAL_SIN_COBRO", "etiquetaCobro": "Manual, sin cobro procesado" }`

#### `POST /api/admin/suscripciones/organizaciones/:organizacionId/cancelar`
- Body: `{ motivoCancelacion? (string, max 500), notas? (string, max 2000) }`
- Transiciona a `CANCELADA`, registra `canceladaEn`, `canceladaPorUsuarioId`, `motivoCancelacion` y guarda entrada en `HistorialSuscripcion`.
- Respuesta `200`: `{ "suscripcion": SuscripcionDetalleDTO, "modalidadGestion": "MANUAL_SIN_COBRO", "etiquetaCobro": "Manual, sin cobro procesado" }`

---

### 4. Historial de auditoría (paginado)

#### `GET /api/admin/suscripciones/organizaciones/:organizacionId/historial`
- Query: `pagina` (default `1`), `limite` (default `20`, max `100`).
- Respuesta `200`:
```json
{
  "datos": [
    {
      "id": "uuid",
      "accion": "ASIGNADA",
      "estadoAnterior": "SIN_SUSCRIPCION",
      "estadoNuevo": "ACTIVA",
      "planAnterior": null,
      "planNuevo": { "id": "uuid", "codigo": "BASE_MANUAL", "nombre": "Plan Base" },
      "fechaInicioAnterior": null,
      "fechaInicioNueva": "2026-11-17T10:00:00.000Z",
      "fechaFinAnterior": null,
      "fechaFinNueva": null,
      "motivo": "Alta manual",
      "notas": null,
      "realizadoPor": { "id": "uuid", "nombre": "Admin", "correo": "admin@equinox.pa" },
      "realizadoPorCorreo": "admin@equinox.pa",
      "modalidadGestion": "MANUAL_SIN_COBRO",
      "etiquetaCobro": "Manual, sin cobro procesado",
      "creadoEn": "2026-11-17T10:00:00.000Z"
    }
  ],
  "paginacion": { "pagina": 1, "limite": 20, "total": 1, "totalPaginas": 1 },
  "modalidadGestion": "MANUAL_SIN_COBRO",
  "etiquetaCobro": "Manual, sin cobro procesado"
}
```
