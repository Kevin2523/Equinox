# Casos de uso y criterios de aceptación

| ID | Caso de uso | Actor | Resultado esperado |
|---|---|---|---|
| CU-01 | Registrarse, iniciar sesión, recuperar y cambiar contraseña | Freelancer | Crea y mantiene su acceso seguro a Equinox. |
| CU-02 | Editar perfil y configurar negocio | Freelancer | Actualiza datos personales y los datos visibles de su negocio. |
| CU-03 | Gestionar clientes | Freelancer | Crea manualmente, edita, busca, filtra y elimina clientes. |
| CU-04 | Invitar cliente | Freelancer | Envía por correo un enlace de registro de un solo uso. |
| CU-05 | Consultar acceso y actividad del cliente | Freelancer | Ve ingresos al portal, descargas y actividad por cliente. |
| CU-06 | Gestionar proyecto | Freelancer | Crea, edita y cambia estado del proyecto asociado a un cliente. |
| CU-07 | Gestionar archivos y comentarios | Freelancer | Sube, descarga, elimina archivos y comenta avances. |
| CU-08 | Ver dashboard y notificaciones | Freelancer | Consulta resumen operativo y actividad reciente. |
| CU-09 | Personalizar y previsualizar portal | Freelancer | Ajusta marca y valida cómo la verá el cliente. |
| CU-10 | Registrarse desde invitación e iniciar sesión | Cliente | Activa su cuenta y entra a su portal privado. |
| CU-11 | Consultar proyecto, archivos e historial | Cliente | Ve marca, progreso, avances, archivos y actividad autorizados. |
| CU-12 | Descargar y comentar entregables | Cliente | Descarga archivos y conversa con el freelancer sobre archivos o avances. |

## Criterios de aceptación esenciales

### CU-04: Gestionar proyecto

- Dado un cliente activo de la organización, cuando el freelancer registra nombre y datos válidos, entonces se crea el proyecto asociado.
- El proyecto nuevo se muestra en la lista y deja actividad de creación.
- Un usuario externo a la organización recibe acceso denegado.

### CU-04 y CU-10: Invitación y acceso de cliente

- Al invitar, el sistema genera un enlace no predecible, de un uso y con vencimiento.
- Al completar el registro, el enlace se invalida y el cliente puede iniciar sesión con correo y contraseña.
- El cliente autenticado ve solo sus proyectos permitidos y archivos con visibilidad `CLIENTE`.

### CU-12: Enviar feedback y descargar entregables

- El cliente puede enviar o responder un comentario no vacío en un proyecto o archivo autorizado.
- Cada descarga queda registrada con cliente, archivo y fecha.
- El freelancer encuentra los comentarios y descargas en la actividad del cliente y del proyecto.
