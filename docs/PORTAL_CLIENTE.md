# Portal autenticado del cliente

La ruta heredada `/api/portal/:token` se retira inmediatamente. No existe
período de compatibilidad: los tokens permanentes anteriores ya no autorizan
consultas ni comentarios. También se retira la emisión de esos tokens desde
`/api/proyectos/:id/accesos-portal`. El modelo y las filas heredadas permanecen
en PostgreSQL para evitar una migración destructiva; no participan en la API.

Todas las rutas bajo `/api/portal` requieren una sesión de cliente activa y un
`AccesoCliente` activo, revalidados en PostgreSQL por solicitud. El `clienteId`
y la organización se toman de esa sesión. La ficha y `/proyectos` muestran
únicamente datos autorizados. Cada proyecto ofrece `/hitos` visibles, `/archivos`
con visibilidad `CLIENTE` y `/comentarios` para lectura y publicación. Un ID
ajeno responde 404. Los comentarios tienen entre 1 y 2.000 caracteres tras
recortar espacios y se guardan con su autor y actividad en una transacción.

`GET /api/portal/facturas` devuelve una lista vacía mientras
`portalMostrarFinanzas` sea `false`, que es el valor inicial. Solo el propietario
puede cambiarlo con `PATCH /api/organizacion`. Al activarlo se muestran
facturas `ENVIADA`, `PAGADA` y `VENCIDA` del cliente y organización actuales,
con un conjunto limitado de campos. No se exponen borradores, canceladas,
notas ni presupuestos del proyecto.
