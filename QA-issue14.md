# Issue #14 — verificación de calidad

## Alcance y evidencia

- Rama: `feature/issue-14-qa`, desde el merge de #13 (`40d4afcf872093384ae18783042a17ac9e9eac04`).
- API real y PostgreSQL local: `npm.cmd run prueba:qa` ejecuta `test/ejecutar-issue14.ts` y `test/casos-issue14.ts` sobre **exclusivamente** `equinox_issue14_test`, creada solo si no existe y eliminada al final. Se comprobó su ausencia. Incluye registro, cliente y proyecto, invitación por enlace, aceptación y acceso del cliente, portal, comentario recibido por propietario, tarea completada, archivo subido y descargado con comparación de bytes, y rechazos de lectura/escritura y descarga cruzadas entre dos clientes y dos organizaciones.
- Frontend: compilación Angular correcta; suite completa **127/127** en la última ejecución. `frontend/test/qa-issue14-dom.test.cjs` monta Chrome con respuestas HTTP ficticias: foco/teclado en diálogos globales y formularios de clientes/proyectos, restauración tras Escape y cierre por overlay, Enter en resultados, sitio web opcional del cliente, botones de los cuatro formularios a 390×560, seis vistas a 390/768/1280 px sin overflow horizontal ni excepciones JavaScript en ese recorrido. No sustituye una sesión autenticada conectada a la API real. La usuaria informó que sus recorridos manuales funcionan bien; no se capturó una sesión de navegador autenticada por este agente.
- Compilación TypeScript de API y pruebas, `git diff --check`: correctos. Una ejecución de revisión dio **121/123** por dos pruebas DOM intermitentes de invitaciones; la repetición focalizada dio **22/22**, se cambió la espera a un sondeo que tolera navegación sin raíz DOM y la suite completa terminó **127/127**. No se atribuye la falla inicial exclusivamente al sincronismo sin diagnóstico concluyente.

## Defectos y limitaciones pendientes

| ID | Severidad | Reproducción / evidencia | Acción pendiente |
| --- | --- | --- | --- |
| QA-01 | Baja (cobertura pendiente) | Los diálogos de clientes, proyectos, invitaciones y pago ya incorporan semántica y la directiva de foco; Chrome verifica los formularios de cliente/proyecto. No se han recorrido en DOM los detalles, invitaciones y pago con teclado. | Ampliar pruebas DOM de esos tres flujos y revisar foco en sesión real. |
| QA-02 | Media | Crear una invitación desde la API: el enlace se devuelve al propietario, pero no hay envío automático al correo del cliente (`src/utilidades/invitaciones.ts`, `src/rutas/invitaciones-clientes.ts`). La prueba lo entrega manualmente; no demuestra un canal de entrega en producción. | Definir y verificar canal real de invitaciones antes de declarar autosuficiente el onboarding. |
| QA-03 | Media | `prisma/schema.prisma` define `Proyecto.organizacionId` y `clienteId` mediante referencias independientes. La API valida la pertenencia al crear/editar, y la prueba HTTP rechaza accesos cruzados, pero la BD no impone mediante FK compuesta que el cliente pertenezca a la organización del proyecto. | Evaluar constraint compuesto o cobertura de todos los escritores y carreras; probar la invariancia con Prisma en base aislada. |
| QA-04 | Baja | La suite concurrente mostró fallos intermitentes en invitaciones, incluso después de los primeros ajustes. La última repetición completa pasó (127/127). | Vigilar nuevas ejecuciones concurrentes; si reaparece, capturar el estado sanitizado de red y DOM para aislar el origen. |
| QA-05 | Pendiente de verificación | Chrome con API ficticia verifica geometría y ausencia de excepciones en seis vistas, pero no prueba un recorrido visual humano de `/portal` con sesión CLIENTE real y datos del backend. | Sesión manual en base de prueba autorizada, revisar contenido, foco, contraste computado y responsive real; no usar la base `equinox`. |

## Cambios realizados

- Directiva `frontend/src/shared/dialog-focus.directive.ts` en los cuatro modales globales y los diálogos de clientes, proyectos, invitaciones y pago; resultados de búsqueda nativos operables con teclado.
- Ajustes de contraste de colores `--muted` y textos pequeños identificados; la prueba de contraste calcula proporción sobre blanco, no una auditoría exhaustiva de colores computados.
- Píldoras de filtros de `/proyectos` se ajustan a 390 px; el desbordamiento fue observado antes de corregirlo y el caso DOM quedó verde después.
- Formulario de clientes: el sitio web sigue siendo opcional y vacío se envía como `null`; admite dominios sin protocolo agregando `https://` antes de enviar a la API, y muestra un error específico para texto inválido sin perder el borrador. Prueba de componente falló antes del cambio y pasó después; Chrome comprobó que el campo ya no bloquea el formulario por validación nativa de `type=url`.
- La línea de tiempo muestra únicamente hitos recibidos de la API; sin hitos muestra un estado vacío y no inventa fases ni porcentaje. Se añadió rechazo visible ante errores de consulta. La selección de proyecto descarta respuestas tardías, y crear/actualizar un hito no publica su resultado bajo otro proyecto.
- El formulario de proyecto nuevo exige selección deliberada de cliente. El detalle de proyecto incluye navegación con flechas/Home/End y asociación accesible entre pestañas y paneles. El portal no muestra contadores cero mientras cargan o fallan los recursos.
- Nuevas pruebas frontend y backend, y script `prueba:qa`.

Los límites QA-01 a QA-05 no equivalen a funcionalidades completas en producción; la invitación aún exige compartir manualmente el enlace. No se tocó la base principal.
