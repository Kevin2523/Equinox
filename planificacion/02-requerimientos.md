# Requerimientos

## Requerimientos funcionales

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-01 | El sistema debe permitir registrar un estudio en los pasos Cuenta, Perfil y Marca. | Alta |
| RF-02 | Debe permitir iniciar, cerrar y recuperar sesión mediante correo y contraseña para freelancers y clientes. | Alta |
| RF-03 | El propietario debe crear, consultar, editar, archivar y eliminar clientes sin proyectos o facturas. | Alta |
| RF-04 | Debe gestionar proyectos vinculados a un cliente, con estado, fechas, presupuesto y moneda. | Alta |
| RF-05 | Debe permitir crear y completar tareas, asignarlas y relacionarlas opcionalmente con hitos. | Alta |
| RF-06 | Debe permitir crear hitos ordenados y elegir cuáles se muestran al cliente. | Alta |
| RF-07 | Debe registrar archivos y entregables, diferenciando visibilidad interna y para cliente. | Alta |
| RF-08 | Debe permitir comentarios entre el freelancer y el cliente en cada proyecto. | Alta |
| RF-09 | Debe invitar clientes por correo con un enlace único y vencimiento para completar su registro. | Alta |
| RF-10 | El portal autenticado debe mostrar la marca, progreso, hitos y entregables autorizados. | Alta |
| RF-11 | Debe registrar facturas con monto, moneda, vencimiento y estado de pago. | Media |
| RF-12 | El panel debe mostrar métricas y próximos vencimientos. | Media |
| RF-13 | Debe guardar actividad relevante: creación, edición, carga, comentario y cambio de estado. | Media |
| RF-14 | El propietario debe personalizar nombre, logotipo, colores y tipografía del portal. | Media |
| RF-15 | Debe mostrar qué clientes han accedido al portal, cuándo ingresaron y qué archivos descargaron. | Media |
| RF-16 | El cliente debe poder comentar archivos o entregables y responder al freelancer. | Alta |

## Requerimientos no funcionales

| ID | Requerimiento |
|---|---|
| RNF-01 | La interfaz debe estar en español, usar tildes y ñ, y ser usable en escritorio y tablet. |
| RNF-02 | Todas las rutas privadas, incluido el portal, deben requerir JWT válido; los enlaces de invitación deben ser únicos, de un solo uso y con vencimiento. |
| RNF-03 | Las contraseñas deben almacenarse con hash seguro, nunca en texto plano. |
| RNF-04 | Las consultas principales deben respetar el aislamiento por organización. |
| RNF-05 | La API debe validar toda entrada y devolver errores comprensibles en español. |
| RNF-06 | La base de datos debe ser PostgreSQL y mantener auditoría básica de acciones. |
| RNF-07 | Las cargas de archivos deben limitar tipo y tamaño y usar almacenamiento externo en producción. |
| RNF-08 | El portal debe cargar en menos de 3 segundos con conexiones normales de banda ancha. |

## Reglas de negocio

- RN-01: un cliente con proyectos o facturas no puede eliminarse; puede archivarse.
- RN-02: una tarea solo puede relacionarse con un hito de su propio proyecto.
- RN-03: una invitación solo puede usarse una vez y queda invalidada al completar el registro o vencerse.
- RN-04: los archivos `INTERNA` no se devuelven desde las rutas del portal autenticado.
- RN-05: al completar una tarea o hito se registra la fecha de finalización.
- RN-06: el número de factura es único dentro de un estudio.
- RN-07: solo el propietario puede cambiar los datos de marca y administrar colaboradores.
- RN-08: cada descarga de un archivo por el cliente se registra en la actividad del proyecto y del cliente.
