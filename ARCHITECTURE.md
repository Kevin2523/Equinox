# Equinox — CRM para Freelancers en Panama

## Vision del Producto
Plataforma SaaS que permite a freelancers en Panama gestionar clientes, proyectos, tareas, facturacion y un portal personalizado para sus clientes.

## Stack Tecnico

### Frontend
- **Framework:** Angular 19 (standalone components)
- **Estilos:** Tailwind CSS 4
- **State Management:** Angular Signals + RxJS donde sea necesario
- **Routing:** Angular Router con lazy loading
- **UI Components:** Componentes propios (sin libreria externa de UI)

### Backend
- **Runtime:** Node.js 20+ con Express
- **ORM:** Prisma
- **Base de datos:** PostgreSQL 16
- **Auth:** JWT (access + refresh tokens) con bcrypt para passwords
- **Archivos:** Local storage (preparado para S3 en el futuro)
- **API:** REST con versionado (/api/v1/)

### Infraestructura
- **Monorepo:** npm workspaces
- `apps/frontend` — Angular
- `apps/backend` — Express API
- `packages/shared` — Tipos compartidos

---

## Diagrama E-R

### Entidades Principales

```
┌─────────────────────┐       ┌──────────────────────┐
│      USUARIOS       │       │    ORGANIZACIONES     │
├─────────────────────┤       ├──────────────────────┤
│ id            UUID PK│◄──┐  │ id            UUID PK │
│ correo        VARCHAR│   │  │ nombre        VARCHAR │
│ contrasena_hash      │   │  │ slug          VARCHAR │
│ nombre_completo      │   │  │ logo_url      VARCHAR │
│ titulo_profesional   │   │  │ color_primario VARCHAR│
│ telefono      VARCHAR│   │  │ color_acento  VARCHAR │
│ ubicacion     VARCHAR│   │  │ tipografia    VARCHAR │
│ zona_horaria  VARCHAR│   │  │ mensaje_bienvenida    │
│ biografia     TEXT    │   │  │ texto_footer  VARCHAR │
│ avatar_url    VARCHAR│   │  │ propietario_id UUID FK│──┘
│ sitio_web     VARCHAR│   │  │ creado_en   TIMESTAMPTZ│
│ linkedin      VARCHAR│   │  │ actualizado_en        │
│ rol           ENUM   │   │  └──────────────────────┘
│ creado_en     TIMESTAMPTZ│ │
│ actualizado_en        │   │
└─────────────────────┘       │
         │                    │
         │ 1:N                │
         ▼                    │
┌─────────────────────┐       │
│     CLIENTES        │       │
├─────────────────────┤       │
│ id            UUID PK│      │
│ usuario_id    UUID FK│      │
│ nombre        VARCHAR│      │
│ correo        VARCHAR│      │
│ telefono      VARCHAR│      │
│ empresa       VARCHAR│      │
│ ruc           VARCHAR│      │
│ industria     VARCHAR│      │
│ ubicacion     VARCHAR│      │
│ idioma        VARCHAR│      │
│ zona_horaria  VARCHAR│      │
│ notas         TEXT    │      │
│ estado        ENUM   │      │
│ color_avatar  VARCHAR│      │
│ creado_en     TIMESTAMPTZ│  │
│ actualizado_en        │      │
└─────────────────────┘       │
         │                    │
         │ 1:N                │
         ▼                    │
┌──────────────────────┐      │
│     PROYECTOS        │      │
├──────────────────────┤      │
│ id            UUID PK│      │
│ cliente_id    UUID FK│      │
│ usuario_id    UUID FK│      │
│ nombre        VARCHAR│      │
│ descripcion   TEXT    │      │
│ miniatura_url VARCHAR│      │
│ estado        ENUM   │      │
│ progreso      INT    │      │
│ fecha_inicio  DATE   │      │
│ entrega_estimada DATE │      │
│ entrega_real  DATE   │      │
│ creado_en     TIMESTAMPTZ│  │
│ actualizado_en        │      │
└──────────────────────┘      │
         │                    │
    ┌────┼────┬───────┐       │
    ▼    ▼    ▼       ▼       │
┌──────┐┌──────┐┌──────┐┌──────┐
│TAREAS││HITOS ││ARCHIV││COMEN-│
│      ││      ││  OS  ││TARIOS│
└──────┘└──────┘└──────┘└──────┘

┌──────────────────────┐  ┌──────────────────────┐
│       TAREAS         │  │        HITOS         │
├──────────────────────┤  ├──────────────────────┤
│ id            UUID PK│  │ id            UUID PK │
│ proyecto_id   UUID FK│  │ proyecto_id   UUID FK │
│ titulo        VARCHAR│  │ titulo        VARCHAR │
│ descripcion   TEXT    │  │ descripcion   TEXT    │
│ estado        ENUM   │  │ fecha_limite  DATE   │
│ prioridad     ENUM   │  │ estado        ENUM   │
│ fecha_limite  DATE   │  │ orden         INT    │
│ asignado_a    UUID FK│  │ completado_en TIMESTAMPTZ│
│ creado_en     TIMESTAMPTZ│ │ creado_en   TIMESTAMPTZ│
│ actualizado_en        │  │ actualizado_en        │
└──────────────────────┘  └──────────────────────┘

┌──────────────────────┐  ┌──────────────────────┐
│      ARCHIVOS        │  │     COMENTARIOS      │
├──────────────────────┤  ├──────────────────────┤
│ id            UUID PK│  │ id            UUID PK │
│ proyecto_id   UUID FK│  │ proyecto_id   UUID FK │
│ subido_por    UUID FK│  │ usuario_id    UUID FK │
│ nombre_archivo       │  │ contenido     TEXT    │
│ url_archivo   VARCHAR│  │ creado_en     TIMESTAMPTZ│
│ tipo_archivo  VARCHAR│  └──────────────────────┘
│ tamano_bytes  BIGINT  │
│ creado_en     TIMESTAMPTZ│
└──────────────────────┘
                         ┌──────────────────────┐
                         │  PORTAL_CLIENTES     │
                         ├──────────────────────┤
                         │ id            UUID PK │
                         │ cliente_id    UUID FK │
                         │ correo        VARCHAR │
                         │ contrasena_hash       │
                         │ nombre        VARCHAR │
                         │ ultimo_acceso TIMESTAMPTZ│
                         │ creado_en     TIMESTAMPTZ│
                         └──────────────────────┘

┌──────────────────────┐
│   REGISTRO_ACTIVIDAD │
├──────────────────────┤
│ id            UUID PK │
│ usuario_id    UUID FK │
│ tipo_entidad  VARCHAR │
│ entidad_id    UUID   │
│ accion        VARCHAR │
│ metadatos     JSONB   │
│ creado_en     TIMESTAMPTZ│
└──────────────────────┘
```

### Enums

```sql
-- Rol de usuario
CREATE TYPE rol_usuario AS ENUM ('freelancer', 'admin');

-- Estado de cliente
CREATE TYPE estado_cliente AS ENUM ('activo', 'pendiente', 'archivado');

-- Estado de proyecto
CREATE TYPE estado_proyecto AS ENUM ('planificacion', 'en_progreso', 'en_revision', 'en_pausa', 'completado', 'cancelado');

-- Estado de tarea
CREATE TYPE estado_tarea AS ENUM ('por_hacer', 'en_progreso', 'en_revision', 'hecha');

-- Prioridad de tarea
CREATE TYPE prioridad_tarea AS ENUM ('baja', 'media', 'alta', 'urgente');

-- Estado de hito
CREATE TYPE estado_hito AS ENUM ('pendiente', 'en_progreso', 'completado');
```

---

## Pantallas del MVP (12 total)

### 1. Login (`/login`)
- Split-screen: branding (izq) + formulario (der)
- Correo + contrasena
- "Continuar con Google" (preparado, no implementado en MVP)
- Link a registro
- Link a "olvide mi contrasena" (preparado)

### 2. Registro - Step 1: Cuenta (`/registro`)
- Split-screen: propuesta de valor (izq) + formulario (der)
- Nombre completo, correo, contrasena, confirmar contrasena
- Checkbox terminos y condiciones
- Stepper: 01 Cuenta > 02 Perfil > 03 Marca

### 3. Registro - Step 2: Perfil (`/registro/perfil`)
- Titulo profesional, telefono, ubicacion, zona horaria
- Sobre mi (textarea)
- Sitio web, LinkedIn (opcionales)

### 4. Registro - Step 3: Marca (`/registro/marca`)
- Nombre del estudio/empresa
- Logo upload
- Color primario (picker)
- Color de acento (picker)
- Mensaje de bienvenida

### 5. Dashboard (`/dashboard`)
- Saludo personalizado ("Buenos dias, Kevin")
- 4 KPIs: clientes activos, proyectos en curso, archivos compartidos, por revisar
- Grafico de actividad semanal (bar chart)
- Clientes recientes (lista)
- Proyectos en curso con barra de progreso
- Proximos vencimientos

### 6. Lista de Clientes (`/clientes`)
- Busqueda por nombre, empresa, contacto
- Filtros: Todos, Activos, Pendientes, Archivados
- Tabla con: avatar, nombre, empresa, contacto, proyectos, ultima actividad, estado
- Boton "+ Agregar cliente"
- Paginacion

### 7. Detalle de Cliente (`/clientes/:id`)
- Header: avatar, nombre, empresa, contacto, estado
- Tabs: Informacion, Proyectos, Archivos, Comentarios
- Informacion: contacto, empresa, notas internas
- Proyecto actual con barra de progreso
- Timeline de actividad reciente

### 8. Lista de Proyectos (`/proyectos`)
- Grid de cards con: miniatura, nombre, cliente, estado, barra de progreso, archivos
- Filtros por estado
- Busqueda
- Boton "+ Nuevo proyecto"

### 9. Detalle de Proyecto (`/proyectos/:id`)
- Header: nombre, cliente, estado, fecha entrega, barra de progreso
- Tabs: Resumen, Archivos, Comentarios, Actividad
- Resumen: hitos del proyecto (timeline horizontal)
- Archivos: lista con nombre, tipo, tamano, fecha, boton descargar
- Comentarios: hilo de mensajes
- Boton "Subir avance"

### 10. Configuracion - Perfil (`/configuracion`)
- Tabs laterales: Perfil, Cuenta, Notificaciones, Seguridad
- Formulario de perfil: nombre, titulo, correo, telefono, ubicacion, zona horaria, bio, sitio web, linkedin
- Widget lateral: info del plan y uso
- Widget: seguridad de la cuenta

### 11. Personalizacion de Marca (`/configuracion/marca`)
- Editor izquierdo: nombre estudio, logo, colores, tipografia, radio de borde, mensaje bienvenida, footer
- Preview en tiempo real (derecho): simula como el cliente ve el portal
- Boton "Guardar cambios"

### 12. Portal del Cliente (`/portal/:token`)
- Acceso con token unico
- Header con branding del freelancer
- Saludo personalizado
- Proyecto: nombre, descripcion, estado, progreso circular
- Hitos del proyecto (timeline)
- Entregables recientes con boton descargar
- Seccion de feedback/mensajes

---

## API Endpoints

### Autenticacion
- `POST /api/v1/auth/registro` — Registro completo (3 steps)
- `POST /api/v1/auth/login` — Login
- `POST /api/v1/auth/renovar` — Renovar token
- `GET /api/v1/auth/yo` — Usuario actual

### Usuarios
- `GET /api/v1/usuarios/perfil` — Perfil del usuario
- `PATCH /api/v1/usuarios/perfil` — Actualizar perfil

### Clientes
- `GET /api/v1/clientes` — Listar (con filtros y busqueda)
- `POST /api/v1/clientes` — Crear
- `GET /api/v1/clientes/:id` — Detalle
- `PATCH /api/v1/clientes/:id` — Actualizar
- `DELETE /api/v1/clientes/:id` — Archivar

### Proyectos
- `GET /api/v1/proyectos` — Listar (con filtros)
- `POST /api/v1/proyectos` — Crear
- `GET /api/v1/proyectos/:id` — Detalle
- `PATCH /api/v1/proyectos/:id` — Actualizar
- `DELETE /api/v1/proyectos/:id` — Archivar

### Tareas
- `GET /api/v1/proyectos/:proyectoId/tareas` — Tareas de un proyecto
- `POST /api/v1/proyectos/:proyectoId/tareas` — Crear tarea
- `PATCH /api/v1/tareas/:id` — Actualizar tarea
- `DELETE /api/v1/tareas/:id` — Eliminar tarea

### Hitos
- `GET /api/v1/proyectos/:proyectoId/hitos` — Hitos de un proyecto
- `POST /api/v1/proyectos/:proyectoId/hitos` — Crear hito
- `PATCH /api/v1/hitos/:id` — Actualizar hito

### Archivos
- `GET /api/v1/proyectos/:proyectoId/archivos` — Archivos de un proyecto
- `POST /api/v1/proyectos/:proyectoId/archivos` — Subir archivo
- `DELETE /api/v1/archivos/:id` — Eliminar archivo

### Comentarios
- `GET /api/v1/proyectos/:proyectoId/comentarios` — Comentarios
- `POST /api/v1/proyectos/:proyectoId/comentarios` — Agregar comentario

### Organizacion / Marca
- `GET /api/v1/organizacion` — Configuracion de marca
- `PATCH /api/v1/organizacion` — Actualizar marca

### Portal del Cliente
- `GET /api/v1/portal/:token` — Datos del portal para el cliente
- `GET /api/v1/portal/:token/proyecto` — Proyecto activo
- `GET /api/v1/portal/:token/entregables` — Entregables
- `POST /api/v1/portal/:token/feedback` — Enviar feedback

### Dashboard
- `GET /api/v1/dashboard/kpis` — Metricas
- `GET /api/v1/dashboard/actividad` — Actividad reciente
- `GET /api/v1/dashboard/vencimientos` — Proximos vencimientos

---

## Flujos de Datos Importantes

### Registro
1. Usuario llena Step 1 (credenciales) → se crea usuario + organizacion
2. Step 2 (perfil) → se actualiza usuario
3. Step 3 (marca) → se actualiza organizacion
4. Redirect a dashboard

### Portal del Cliente
1. Freelancer crea cliente → se genera token unico para el portal
2. Freelancer comparte link: equinox.app/portal/:token
3. Cliente accede → ve proyectos asociados, entregables, hitos
4. Cliente envia feedback → se guarda como comentario en el proyecto

---

## Notas de Implementacion

- Todos los IDs son UUID v4 generado por Prisma
- Timestamps en UTC con timezone
- Soft delete para clientes y proyectos (estado = 'archivado')
- Archivos se guardan en `uploads/` con nombre unico
- El portal del cliente usa un token unico por cliente, no JWT
- Responsive: todas las pantallas deben funcionar en desktop (1280px+)
- Dark mode NO en MVP
- Internacionalizacion NO en MVP (todo en espanol)
- SIEMPRE usar tildes y enes en la interfaz
