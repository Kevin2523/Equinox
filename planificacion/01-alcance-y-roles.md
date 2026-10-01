# Alcance, actores y roles

## Objetivo

Dar a los freelancers panameños un espacio único y profesional para administrar su operación y mantener a cada cliente informado sin depender de WhatsApp, Excel y Drive como sistemas aislados.

## Alcance de la primera versión

- Registro guiado del freelancer: cuenta, perfil y marca del estudio.
- Gestión de clientes, proyectos, tareas, hitos, archivos, comentarios y facturas.
- Panel con indicadores de clientes, proyectos, tareas próximas y actividad.
- Portal de cliente con cuenta propia, creada desde una invitación enviada por el freelancer.
- Personalización visual básica del portal: nombre, logotipo, colores y tipografía.
- Historial de actividad por organización.

## Fuera de alcance inicial

- Cobro con tarjeta, ACH o Yappy dentro de Equinox.
- Aplicación móvil nativa.
- Colaboración entre múltiples organizaciones para un mismo usuario.
- Automatizaciones complejas, campañas de correo y contabilidad fiscal completa.

## Roles

| Rol | Descripción | Permisos principales |
|---|---|---|
| Propietario del estudio | Freelancer que crea la organización. | Administración total, marca, miembros, clientes, proyectos, facturas y enlaces. |
| Colaborador | Integrante invitado por el propietario. | Acceso a clientes y proyectos asignados; no cambia la marca ni la facturación por defecto. |
| Cliente del portal | Persona invitada por el freelancer y registrada con correo y contraseña. | Ve exclusivamente sus proyectos autorizados, entregables visibles, actividad y comentarios. |
| Sistema | Procesos automáticos de Equinox. | Valida tokens, actualiza fechas, registra actividad y calcula indicadores. |

## Principios de autorización

- Todo recurso interno pertenece a una organización.
- Un usuario autenticado solo puede consultar o modificar datos de las organizaciones a las que pertenece.
- El cliente requiere una cuenta creada mediante enlace de invitación y solo puede ver los proyectos que le autorizó su freelancer.
- Los archivos internos jamás se muestran en el portal aunque el cliente tenga acceso al proyecto.
