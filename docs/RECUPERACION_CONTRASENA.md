# Recuperación de Contraseña y Configuración de Correo en Equinox

Este documento describe la arquitectura, consideraciones de seguridad, variables de configuración y puesta en marcha del flujo de recuperación de contraseña de **Equinox**.

---

## 1. Arquitectura y Seguridad

El sistema de autenticación de Equinox unifica a los propietarios de estudios, colaboradores y clientes del portal bajo la entidad `Usuario`, diferenciando accesos mediante membresías de organización (`MiembroOrganizacion`) y accesos a portales (`AccesoCliente`). El flujo de recuperación de contraseña opera de forma homogénea y segura sobre todas las identidades que poseen credenciales en la plataforma.

### Principios de Seguridad Implementados:

1. **Tokens Criptográficamente Seguros:**
   - Generados mediante `crypto.randomBytes(32)` codificados en base64 URL-safe (256 bits de entropía).
   - Vida útil estricta de **30 minutos**.
   - **Solo el hash SHA-256 es persistido** en la base de datos (`solicitudes_recuperacion.token_hash`). El token en texto plano nunca se guarda en base de datos.
   - De **un solo uso**: al consumirse para cambiar la contraseña, se marca con `usado_en`. Si un token ya usado o expirado es presentado, se rechaza con código `410 Gone`.

2. **Respuesta Uniforme y Mitigación de Enumeración de Cuentas:**
   - Tanto si el correo existe como si no existe en la base de datos, el endpoint responde con HTTP 200 y el mismo mensaje:
     `"Si el correo está registrado en Equinox, recibirás las instrucciones para restablecer tu contraseña en los próximos minutos."`
   - Si la cuenta no existe, se ejecuta una operación `bcrypt.compare` contra un hash de referencia para equiparar la latencia de respuesta y neutralizar ataques de timing.

3. **Rate Limiting Multinivel:**
   - **Por dirección IP:** Máximo 10 solicitudes cada 15 minutos en solicitud, y 5 intentos en restablecimiento.
   - **Por cuenta / correo:** Máximo 3 solicitudes cada 15 minutos. Para evitar almacenar correos planos en memoria, la clave del limitador utiliza un hash SHA-256 del correo normalizado. Si se supera el límite, se responde HTTP 429 sin indicar si la cuenta existe o no.

4. **Invalidación Total de Sesiones e Identidad:**
   - Al restablecer la contraseña exitosamente, se invalidan en la misma transacción:
     1. El token de recuperación actual y cualquier otro token pendiente del usuario.
     2. Todas las sesiones activas (`sesiones`) asociadas a ese `usuarioId` (`revocadaEn = ahora`).
   - El usuario es redirigido al inicio de sesión; no se inicia sesión automáticamente.

5. **Protección Contra Fugas de Tokens:**
   - El middleware de logging (Morgan) redacta automáticamente parámetros de consulta `?token=...`, rutas de recuperación y encabezados `Referer` mediante `sanitizarUrlParaLogs`.
   - La pantalla de restablecimiento no carga recursos de terceros ni filtra correos o identidades en respuestas de validación.

---

## 2. Configuración de Variables de Entorno (SMTP)

Para habilitar el envío real de correos de recuperación, defina las siguientes variables en `.env`:

| Variable | Tipo | Valor Predeterminado | Descripción |
| :--- | :--- | :--- | :--- |
| `SMTP_HOST` | Cadena | *(Vacío)* | Servidor SMTP saliente (ej. `smtp.sendgrid.net`, `smtp.mailgun.org`, `localhost`). **Requerido para activar el canal**. |
| `SMTP_PORT` | Entero | `587` | Puerto del servidor SMTP (comúnmente 587 para STARTTLS o 465 para SSL/TLS). |
| `SMTP_SECURE` | Booleano | `false` | Establecer en `true` para conexiones TLS directas (puerto 465). |
| `SMTP_USER` | Cadena | *(Vacío)* | Nombre de usuario o clave API de autenticación SMTP. |
| `SMTP_PASS` | Cadena | *(Vacío)* | Contraseña o token de autenticación SMTP. |
| `SMTP_FROM` | Cadena | `Equinox <no-reply@equinox.app>` | Dirección de correo del remitente que verán los usuarios. |
| `URL_BASE` | Cadena | `http://localhost:4200` | URL base pública de la aplicación frontend para generar los enlaces en el correo. |

> **Comportamiento sin transporte configurado:**
> Si `SMTP_HOST` no está configurado, la API responderá de inmediato con HTTP 503 (`"El servicio de recuperación por correo no está configurado o no se encuentra disponible"`), y la interfaz de usuario informará con total honestidad operativa que el canal de correo no está disponible, evitando dar falsas expectativas de envío.

---

## 3. Pruebas Automatizadas y Arnés de Captura Local

Para pruebas unitarias, de integración y E2E, no se requieren credenciales SMTP externas:
- El módulo `src/servicios/correo.ts` provee `habilitarCapturadorPruebas(true)` y `obtenerCorreosCapturados()`.
- Esto almacena los correos generados (asunto, cuerpo HTML, texto plano, enlace con token) en memoria aislada durante la ejecución de los casos de prueba sin emitir tráfico de red.
