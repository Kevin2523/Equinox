# Equinox — Contexto del Producto

## Que es Equinox
Equinox es un CRM pensado para freelancers en Panama. Permite gestionar clientes, proyectos, tareas, archivos, facturacion y ofrece un portal personalizado donde los clientes del freelancer pueden ver el avance de sus proyectos, descargar entregables y enviar feedback.

## Por que existe
Los freelancers en Panama usan WhatsApp, Excel y Google Drive para todo. No tienen un lugar centralizado para gestionar su trabajo ni una forma profesional de mostrarle el avance a sus clientes. Equinox resuelve eso.

## Quien lo usa
- **Usuario principal:** El freelancer (Kevin Mena es el primero). Registra clientes, crea proyectos, sube archivos, gestiona tareas.
- **Cliente del freelancer:** Accede a un portal personalizado con la marca del freelancer. Ve sus proyectos, hitos, entregables y puede enviar mensajes.

## Que hace el sistema

### Para el freelancer:
- Registro con 3 pasos: cuenta, perfil, marca de su estudio
- Dashboard con metricas de su negocio (clientes activos, proyectos en curso, vencimientos)
- CRUD de clientes con notas internas, historial y estados
- CRUD de proyectos con hitos, tareas, archivos y comentarios
- Subida y gestion de archivos/entregables por proyecto
- Personalizacion de marca (logo, colores, tipografia) que se refleja en el portal del cliente
- Configuracion de perfil y cuenta

### Para el cliente del freelancer:
- Accede a un portal con la marca del freelancer
- Ve el avance de su proyecto (progreso, hitos, estado actual)
- Descarga entregables
- Envia feedback/mensajes al freelancer

## Pantallas que tiene que tener (12)
Mira las capturas en la carpeta `interfaces/` — cada imagen es una pantalla del sistema. Usalas como referencia de diseño, layout y funcionalidad. Los datos que muestran son ejemplos ficticios.

1. Login
2. Registro - Paso 1: Cuenta
3. Registro - Paso 2: Perfil
4. Registro - Paso 3: Marca
5. Dashboard del freelancer
6. Lista de clientes
7. Detalle de cliente
8. Lista de proyectos
9. Detalle de proyecto
10. Configuracion de perfil
11. Personalizacion de marca (con preview en tiempo real)
12. Portal del cliente

## Base de datos
Diseña el modelo de datos completo. Necesitas entidades para: usuarios, organizaciones/estudio, clientes, proyectos, tareas, hitos, archivos, comentarios, acceso al portal del cliente, y registro de actividad. Genera un diagrama E-R en markdown que sea facil de entender (con Mermaid o tablas, lo que sea mas claro).

## Stack
- Frontend: Angular
- Backend: Node.js
- Base de datos: PostgreSQL
- Todo en espanol (con tildes y enes)

## Notas
- El sistema va a vivir en esta carpeta
- Los nombres de tablas, columnas, endpoints y UI deben estar en espanol
- Sin emojis en la interfaz
- Responsive desktop
- El portal del cliente usa un token unico, no login tradicional
