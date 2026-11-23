# Configuración de Almacenamiento Privado de Fotos (Modalidad FOTOGRAFIA)

Este documento describe la arquitectura, configuración y consideraciones de seguridad del almacenamiento de fotos para la modalidad **FOTOGRAFIA** de Equinox.

---

## 1. Variables de Entorno

El almacenamiento privado se gestiona fuera del webroot para garantizar que ninguna imagen sea accesible públicamente sin autenticación previa.

| Variable | Descripción | Valor por Defecto |
| :--- | :--- | :--- |
| `ALMACENAMIENTO_FOTOS_DIR` | Ruta del directorio en disco para almacenar los binarios de las fotos. | `./almacenamiento_privado/fotos` |
| `ALMACENAMIENTO_MAX_BYTES` | Tamaño máximo permitido por archivo de imagen en bytes. | `52428800` (50 MB) |

Ejemplo en `.env`:
```env
ALMACENAMIENTO_FOTOS_DIR="./almacenamiento_privado/fotos"
ALMACENAMIENTO_MAX_BYTES=52428800
```

---

## 2. Arquitectura de Seguridad

1. **Ubicación fuera del webroot**:
   Los archivos se almacenan en una ruta local configurada en el servidor que no está expuesta mediante rutas estáticas de Express.

2. **Acceso Autenticado Exclusivo (Zero Public URLs)**:
   - No se generan ni retornan URLs públicas a los clientes ni en respuestas JSON.
   - Todo acceso al contenido binario se realiza a través de endpoints protegidos con token JWT (`Bearer`):
     - Freelancer: `/api/clientes/:clienteId/sesiones-fotograficas/:sesionId/fotos/:fotoId/contenido?variante=miniatura|original`
     - Portal Cliente: `/api/portal/sesiones-fotograficas/:sesionId/fotos/:fotoId/contenido?variante=miniatura|original`
   - El cliente HTTP de Angular (`HttpClient`) descarga el blob binario y crea un `ObjectURL` en memoria local para renderizar, revocándolo cuando ya no se usa.

3. **Prevención de Path Traversal**:
   - Las claves de almacenamiento (`almacenamientoKey`) se generan exclusivamente en el servidor como UUID v4.
   - Cada solicitud valida que la clave cumpla el patrón estricto UUID y que la resolución con `path.resolve` permanezca confinada dentro del directorio base configurado.

4. **Validación de Firma Mágica (MIME Real)**:
   - No se confía en la cabecera `Content-Type` enviada por el cliente ni en la extensión del archivo.
   - El servicio inspecciona los primeros bytes del archivo en el stream para verificar firmas mágicas válidas:
     - JPEG: `FF D8 FF`
     - PNG: `89 50 4E 47 0D 0A 1A 0A`
     - GIF: `47 49 46 38 37 61` / `47 49 46 38 39 61`
     - WEBP: `RIFF....WEBP`
     - TIFF: `49 49 2A 00` / `4D 4D 00 2A`
     - AVIF: `....ftypavif` / `....ftypavis`
   - Archivos que no coincidan con imágenes válidas son rechazados inmediatamente (HTTP 415).

5. **Transmisión sin Base64 y Limpieza ante Fallos**:
   - Las cargas multipart se procesan en streaming directo a disco sin serialización base64 intermedia.
   - Si ocurre un error de validación, interrupción o fallo en la transacción de base de datos, los archivos temporales se eliminan de forma atómica.
   - Al eliminar una foto o una sesión fotográfica, los binarios correspondientes en disco se eliminan automáticamente.

6. **Control de Borrado Seguro ("DELETE si es seguro")**:
   - Una sesión fotográfica en estado `PUBLICADA` no puede ser eliminada directamente (HTTP 409).
   - Debe ser despublicada (cambiada a `BORRADOR`) antes de su eliminación para prevenir borrados accidentales de galerías visibles a clientes.
