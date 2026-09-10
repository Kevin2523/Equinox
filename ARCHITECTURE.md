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
│       USERS         │       │     ORGANIZATIONS     │
├─────────────────────┤       ├──────────────────────┤
│ id            UUID PK│◄──┐  │ id            UUID PK │
│ email         VARCHAR│   │  │ name          VARCHAR │
│ password_hash VARCHAR│   │  │ slug          VARCHAR │
│ full_name     VARCHAR│   │  │ logo_url      VARCHAR │
│ professional_title   │   │  │ primary_color VARCHAR │
│ phone         VARCHAR│   │  │ accent_color  VARCHAR │
│ location      VARCHAR│   │  │ typography    VARCHAR │
│ timezone      VARCHAR│   │  │ welcome_message TEXT  │
│ bio           TEXT    │   │  │ footer_text   VARCHAR │
│ avatar_url    VARCHAR│   │  │ owner_id      UUID FK│──┘
│ website       VARCHAR│   │  │ created_at    TIMESTAMPTZ│
│ linkedin      VARCHAR│   │  │ updated_at    TIMESTAMPTZ│
│ role          ENUM   │   │  └──────────────────────┘
│ created_at    TIMESTAMPTZ│  │
│ updated_at    TIMESTAMPTZ│  │
└─────────────────────┘       │
         │                    │
         │ 1:N                │ N:1
         ▼                    ▼
┌─────────────────────┐  ┌──────────────────────┐
│      CLIENTS        │  │      PROJECTS        │
├─────────────────────┤  ├──────────────────────┤
│ id            UUID PK│◄─┤ id            UUID PK │
│ user_id       UUID FK│  │ client_id     UUID FK │
│ name          VARCHAR│  │ user_id       UUID FK │
│ email         VARCHAR│  │ name          VARCHAR │
│ phone         VARCHAR│  │ description   TEXT    │
│ company       VARCHAR│  │ thumbnail_url VARCHAR │
│ ruc           VARCHAR│  │ status        ENUM   │
│ industry      VARCHAR│  │ progress      INT    │
│ website       VARCHAR│  │ start_date    DATE   │
│ location      VARCHAR│  │ estimated_delivery   │
│ language      VARCHAR│  │ actual_delivery DATE │
│ timezone      VARCHAR│  │ created_at    TIMESTAMPTZ│
│ notes         TEXT    │  │ updated_at    TIMESTAMPTZ│
│ status        ENUM   │  └──────────────────────┘
│ avatar_color  VARCHAR│           │
│ created_at    TIMESTAMPTZ│        │ 1:N
│ updated_at    TIMESTAMPTZ│        ▼
└─────────────────────┘  ┌──────────────────────┐
                         │      TASKS           │
                         ├──────────────────────┤
                         │ id            UUID PK │
                         │ project_id    UUID FK │
                         │ title         VARCHAR │
                         │ description   TEXT    │
                         │ status        ENUM   │
                         │ priority      ENUM   │
                         │ due_date      DATE   │
                         │ assigned_to   UUID FK │
                         │ created_at    TIMESTAMPTZ│
                         │ updated_at    TIMESTAMPTZ│
                         └──────────────────────┘

┌──────────────────────┐  ┌──────────────────────┐
│     MILESTONES       │  │       FILES          │
├──────────────────────┤  ├──────────────────────┤
│ id            UUID PK│  │ id            UUID PK │
│ project_id    UUID FK│  │ project_id    UUID FK │
│ title         VARCHAR│  │ uploaded_by   UUID FK │
│ description   TEXT    │  │ file_name     VARCHAR │
│ due_date      DATE   │  │ file_url      VARCHAR │
│ status        ENUM   │  │ file_type     VARCHAR │
│ sort_order    INT    │  │ file_size     BIGINT  │
│ completed_at  TIMESTAMPTZ│ │ created_at  TIMESTAMPTZ│
│ created_at    TIMESTAMPTZ│ └──────────────────────┘
└──────────────────────┘
                         ┌──────────────────────┐
                         │     COMMENTS         │
                         ├──────────────────────┤
                         │ id            UUID PK │
                         │ project_id    UUID FK │
                         │ user_id       UUID FK │
                         │ content       TEXT    │
                         │ created_at    TIMESTAMPTZ│
                         └──────────────────────┘

┌──────────────────────┐  ┌──────────────────────┐
│  CLIENT_PORTAL_USERS │  │   ACTIVITY_LOG       │
├──────────────────────┤  ├──────────────────────┤
│ id            UUID PK│  │ id            UUID PK │
│ client_id     UUID FK│  │ user_id       UUID FK │
│ email         VARCHAR│  │ entity_type   VARCHAR │
│ password_hash VARCHAR│  │ entity_id     UUID   │
│ name          VARCHAR│  │ action        VARCHAR │
│ last_login    TIMESTAMPTZ│ │ metadata   JSONB   │
│ created_at    TIMESTAMPTZ│ │ created_at TIMESTAMPTZ│
└──────────────────────┘  └──────────────────────┘
```

### Enums

```sql
-- Rol de usuario
CREATE TYPE user_role AS ENUM ('freelancer', 'admin');

-- Estado de cliente
CREATE TYPE client_status AS ENUM ('active', 'pending', 'archived');

-- Estado de proyecto
CREATE TYPE project_status AS ENUM ('planning', 'in_progress', 'in_review', 'on_hold', 'completed', 'cancelled');

-- Estado de tarea
CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'in_review', 'done');

-- Prioridad de tarea
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- Estado de hito
CREATE TYPE milestone_status AS ENUM ('pending', 'in_progress', 'completed');
```

---

## Pantallas del MVP (12 total)

### 1. Login (`/login`)
- Split-screen: branding (izq) + formulario (der)
- Email + password
- "Continuar con Google" (preparado, no implementado en MVP)
- Link a registro
- Link a "olvide mi contrasena" (preparado)

### 2. Registro - Step 1: Cuenta (`/register`)
- Split-screen: propuesta de valor (izq) + formulario (der)
- Nombre completo, email, contrasena, confirmar contrasena
- Checkbox terminos y condiciones
- Stepper: 01 Cuenta > 02 Perfil > 03 Marca

### 3. Registro - Step 2: Perfil (`/register/profile`)
- Titulo profesional, telefono, ubicacion, zona horaria
- Sobre mi (textarea)
- Website, LinkedIn (opcionales)

### 4. Registro - Step 3: Marca (`/register/brand`)
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
- Proyectos en curso con progress bar
- Proximos vencimientos

### 6. Lista de Clientes (`/clients`)
- Busqueda por nombre, empresa, contacto
- Filtros: Todos, Activos, Pendientes, Archivados
- Tabla con: avatar, nombre, empresa, contacto, proyectos, ultima actividad, estado
- Boton "+ Agregar cliente"
- Paginacion

### 7. Detalle de Cliente (`/clients/:id`)
- Header: avatar, nombre, empresa, contacto, estado
- Tabs: Informacion, Proyectos, Archivos, Comentarios
- Informacion: contacto, empresa, notas internas
- Proyecto actual con progress bar
- Timeline de actividad reciente

### 8. Lista de Proyectos (`/projects`)
- Grid de cards con: thumbnail, nombre, cliente, estado, progress bar, archivos
- Filtros por estado
- Busqueda
- Boton "+ Nuevo proyecto"

### 9. Detalle de Proyecto (`/projects/:id`)
- Header: nombre, cliente, estado, deadline, progress bar
- Tabs: Resumen, Archivos, Comentarios, Actividad
- Resumen: hitos del proyecto (timeline horizontal)
- Archivos: lista con nombre, tipo, tamano, fecha, boton descargar
- Comentarios: hilo de mensajes
- Boton "Subir avance"

### 10. Configuracion - Perfil (`/settings`)
- Tabs laterales: Perfil, Cuenta, Notificaciones, Seguridad
- Formulario de perfil: nombre, titulo, email, telefono, ubicacion, timezone, bio, website, linkedin
- Widget lateral: info del plan y uso
- Widget: seguridad de la cuenta

### 11. Personalizacion de Marca (`/settings/brand`)
- Editor izquierdo: nombre estudio, logo, colores, tipografia, radio de borde, mensaje bienvenida, footer
- Preview en tiempo real (derecho): simula como el cliente ve el portal
- Boton "Guardar cambios"

### 12. Portal del Cliente (`/portal/:token`)
- Acceso con token unico (no requiere login tradicional en MVP, o login simplificado)
- Header con branding del freelancer
- Saludo personalizado
- Proyecto: nombre, descripcion, estado, progress circular
- Hitos del proyecto (timeline)
- Entregables recientes con boton descargar
- Seccion de feedback/mensajes

---

## API Endpoints

### Auth
- `POST /api/v1/auth/register` — Registro completo (3 steps)
- `POST /api/v1/auth/login` — Login
- `POST /api/v1/auth/refresh` — Renovar token
- `GET /api/v1/auth/me` — Usuario actual

### Users
- `GET /api/v1/users/profile` — Perfil del usuario
- `PATCH /api/v1/users/profile` — Actualizar perfil

### Clients
- `GET /api/v1/clientes` — Listar (con filtros y busqueda)
- `POST /api/v1/clientes` — Crear
- `GET /api/v1/clientes/:id` — Detalle
- `PATCH /api/v1/clientes/:id` — Actualizar
- `DELETE /api/v1/clientes/:id` — Archivar

### Projects
- `GET /api/v1/proyectos` — Listar (con filtros)
- `POST /api/v1/proyectos` — Crear
- `GET /api/v1/proyectos/:id` — Detalle
- `PATCH /api/v1/proyectos/:id` — Actualizar
- `DELETE /api/v1/proyectos/:id` — Archivar

### Tasks
- `GET /api/v1/proyectos/:projectId/tareas` — Tareas de un proyecto
- `POST /api/v1/proyectos/:projectId/tareas` — Crear tarea
- `PATCH /api/v1/tareas/:id` — Actualizar tarea
- `DELETE /api/v1/tareas/:id` — Eliminar tarea

### Milestones
- `GET /api/v1/proyectos/:projectId/hitos` — Hitos de un proyecto
- `POST /api/v1/proyectos/:projectId/hitos` — Crear hito
- `PATCH /api/v1/hitos/:id` — Actualizar hito

### Files
- `GET /api/v1/proyectos/:projectId/archivos` — Archivos de un proyecto
- `POST /api/v1/proyectos/:projectId/archivos` — Subir archivo
- `DELETE /api/v1/archivos/:id` — Eliminar archivo

### Comments
- `GET /api/v1/proyectos/:projectId/comentarios` — Comentarios
- `POST /api/v1/proyectos/:projectId/comentarios` — Agregar comentario

### Organization / Branding
- `GET /api/v1/organizacion` — Configuracion de marca
- `PATCH /api/v1/organizacion` — Actualizar marca

### Client Portal
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
1. Usuario llena Step 1 (credenciales) → se crea user + organization
2. Step 2 (perfil) → se actualiza user
3. Step 3 (marca) → se actualiza organization
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
- Soft delete para clientes y proyectos (status = 'archived')
- Archivos se guardan en `uploads/` con nombre unico
- El portal del cliente usa un token unico por cliente, no JWT
- Responsive: todas las pantallas deben funcionar en desktop (1280px+)
- Dark mode NO en MVP
- Internacionalizacion NO en MVP (todo en espanol)
