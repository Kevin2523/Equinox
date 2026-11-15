# Invitaciones de clientes

No hay proveedor de correo configurado en esta issue. Crear y reenviar entregan
`enlaceInvitacion` una sola vez, en la respuesta al miembro autenticado autorizado
de la organización, también en producción. La respuesta se envía después del
commit y lleva `Cache-Control: no-store`. El miembro debe compartir ese enlace
por su canal de comunicación; no existe envío automático de correo.

Se utiliza `URL_BASE` para construir el enlace. PostgreSQL guarda únicamente el
hash SHA-256 del token. Las consultas internas y públicas no recuperan enlaces;
auditorías, errores y logs de invitaciones no deben incluir tokens ni hashes.
Morgan redacta el token tanto en URL como en Referer y omite la IP en rutas
públicas de invitación.

El rate limiting usa cuatro almacenes en memoria **por proceso**, con hasta
5.000 claves cada uno. No coordina contadores entre instancias y no es distribuido.
Conserva los límites globales por IP (60 consultas o 15 aceptaciones por minuto)
y los específicos por IP + hash del token (30 consultas o 5 aceptaciones).
Al alcanzar capacidad solo elimina entradas expiradas. Si sigue lleno, responde
429 a las claves nuevas, sin borrar contadores vigentes ni dejar pasar solicitudes
sin contarlas. `Retry-After` indica los segundos hasta la primera expiración.

El reenvío trata `PENDIENTE` con `expiraEn <= ahora` como expirada. Dentro de la
transacción aplica la misma comprobación de otra pendiente que para `EXPIRADA`,
y compara id, organización, cliente, estado exacto, hash y fecha anterior antes
de renovar. Una nueva validez comienza en el instante transaccional; el token
anterior deja de ser válido. El índice parcial resuelve inserciones concurrentes.
Un conflicto o rollback no entrega enlace ni registra `REENVIAR`; las operaciones
concurrentes que ganaron conservan su resultado.

Los relojes, tokens centinela, fallos y ajustes de capacidad de las pruebas solo
funcionan con `NODE_ENV === "test"`. La suite también inicia un proceso nuevo con
`NODE_ENV=production`, sin hooks, contra la base temporal autorizada por el
orquestador. No requiere servicios ni dependencias adicionales.
