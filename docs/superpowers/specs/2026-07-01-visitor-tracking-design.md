# Seguimiento de visitantes — Diseño

**Fecha:** 2026-07-01
**Objetivo:** Registrar cada carga de la página web en una tabla `visits`, guardando fecha/hora, IP, localización (país/región/ciudad) y sistema operativo, para poder hacer seguimiento de los visitantes.

## Alcance

- Captura vía **middleware en el servidor** (Express), no ping del cliente.
- Localización por **librería offline `geoip-lite`** (sin llamadas externas ni límites de cuota).
- **Una fila por cada carga/recarga** del documento HTML.
- **Solo la tabla** por ahora: sin UI de administración; los datos se consultan por SQL.
- **Cero cambios en el cliente.**

Fuera de alcance (YAGNI): dashboard/UI de visitantes, gráficos, exportación, deduplicación de visitantes únicos, tracking de navegación interna del SPA.

## Qué cuenta como "visita"

El middleware registra únicamente las **cargas del documento HTML** (la página que ve el navegador):

- Cuenta: `GET /`, rutas del SPA (`/grupos`, `/read/123`, etc.) y páginas `.html` (`/privacy.html`).
- No cuenta: assets (`.js`, `.css`, imágenes, `favicon.ico`, `/foliate-js/*`), ni `/api/*`, `/downloads/*`, `/kobo/*`.

**Regla de detección (`isPageLoad(req)`):**

- `req.method === 'GET'`.
- La ruta no empieza por `/api`, `/downloads` ni `/kobo`.
- El último segmento de la ruta no tiene extensión de archivo, **o** termina en `.html`.

Ejemplos: `/` ✅, `/grupos` ✅, `/read/123` ✅, `/privacy.html` ✅, `/assets/index-x.js` ❌, `/favicon.ico` ❌, `/api/books` ❌.

### Matices conocidos

- La app es un **SPA**: la navegación interna (cambiar de sección sin recargar) **no** genera filas; solo las cargas/recargas reales del documento y los enlaces directos. Esto es coherente con "una fila por cada carga/recarga".
- Solo aplica en **producción**, donde Express sirve el cliente (`app.get('*', …)` en [app.js](../../../server/src/app.js)). En desarrollo el SPA lo sirve Vite (puerto 5173) y no pasa por este middleware.

## Esquema de la tabla

En [db.js](../../../server/src/db.js), dentro del string `SCHEMA`, con el mismo patrón `CREATE TABLE IF NOT EXISTS` que el resto de tablas:

```sql
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),  -- UTC
  ip TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  os TEXT,
  path TEXT,
  user_agent TEXT
);
```

- `created_at`: fecha y hora en **UTC** (`datetime('now')`). Perú es UTC-5; se convierte al leer.
- `ip`: `req.ip` (real gracias a `app.set('trust proxy', 1)` detrás de nginx).
- `country`, `region`, `city`: resueltos por `geoip-lite`. Pueden ser `NULL` para IPs privadas/desconocidas (p. ej. localhost).
- `os`: nombre del sistema operativo (Windows, macOS, Android, iOS, Linux, Chrome OS, u `Other`).
- `path`: la ruta cargada (extra útil y barato).
- `user_agent`: UA cruda (extra: permite reparsear más datos en el futuro).

## Componentes

### `server/src/geo.js` (nuevo)

Responsabilidad única: derivar localización y SO de una petición. Sin estado, testeable de forma aislada.

- `lookupLocation(ip) → { country, region, city }` — envuelve `geoip-lite.lookup(ip)`; devuelve `{ country: null, region: null, city: null }` si no hay resultado.
- `parseOS(userAgent) → string` — regex ligera (sin dependencia extra) que reconoce Windows, macOS/Mac OS X, Android, iOS (iPhone/iPad), Chrome OS y Linux; devuelve `'Other'` si no coincide. Orden de comprobación: Android e iOS antes que Linux/macOS (sus UAs contienen subcadenas solapadas).
- `isBot(userAgent) → boolean` — `true` si el UA coincide con `/bot|crawl|spider|slurp/i`.

### `server/src/middleware/visitTracker.js` (nuevo)

- `createVisitTracker(db) → (req, res, next)`.
- Exporta también `isPageLoad(req) → boolean` para poder testearlo directamente.
- Lógica: si `isPageLoad(req)` y no es bot, resuelve `ip`/geo/os e inserta una fila en `visits`, luego `next()`. Si no aplica, solo `next()`.
- **Robustez:** todo el cuerpo va envuelto en `try/catch`; ante cualquier error se llama a `next()` sin propagar. El seguimiento nunca debe romper el servido de la página.
- La inserción es síncrona (better-sqlite3, WAL): microsegundos por carga.

### `server/src/app.js` (modificar)

- Registrar `app.use(createVisitTracker(db))` una sola vez, antes de los routers y del servido de estáticos, para que vea las peticiones de documento.

### Dependencia nueva

- `geoip-lite`: base de datos GeoIP local (~30-40 MB en `node_modules`). Sin llamadas externas ni límites. Requiere `npm install` en el servidor al desplegar.

### Filtro de bots

Incluido por defecto (`isBot`): se saltan UAs obvios de crawler para no inflar la tabla con Googlebot y similares.

## Flujo de datos

```
petición → visitTracker
              ├─ ¿isPageLoad(req) && !isBot(ua)?  no → next()
              └─ sí → ip = req.ip
                       { country, region, city } = lookupLocation(ip)
                       os = parseOS(ua)
                       INSERT INTO visits (...)   → next()
           → estáticos / app.get('*') sirve index.html
```

## Manejo de errores

- `try/catch` global en el middleware: cualquier fallo (geoip, DB) se traga y se continúa con `next()`.
- `geoip-lite` devuelve `null` para IPs privadas/desconocidas → columnas de localización en `NULL`.

## Cómo se consultan los datos

Sin UI. Ejemplos de SQL:

```sql
-- Visitas por día
SELECT date(created_at) AS dia, COUNT(*) AS visitas
FROM visits GROUP BY dia ORDER BY dia DESC;

-- Por sistema operativo
SELECT os, COUNT(*) FROM visits GROUP BY os ORDER BY 2 DESC;

-- Por país
SELECT country, COUNT(*) FROM visits GROUP BY country ORDER BY 2 DESC;
```

## Testing

Tests unitarios con vitest, siguiendo el patrón existente (`server/tests/helpers.js`, `makeDb`):

- `isPageLoad`: cuenta `/` y rutas SPA; ignora `/assets/x.js`, `/favicon.ico`, `/api/books`, `/downloads/x.apk`.
- `parseOS`: UAs representativos de Windows, macOS, Android, iOS, Linux → nombre correcto; UA raro → `'Other'`.
- `isBot`: UA de Googlebot → `true`; UA de Chrome → `false`.
- `createVisitTracker`: inserta una fila en una carga de página; no inserta en un asset ni en `/api`; no lanza si la inserción falla.

## Consideraciones

1. **Privacidad:** IP + localización son datos personales. Conviene mencionar en la privacy policy publicada que se registran datos de acceso/analítica. No bloquea la implementación.
2. **Despliegue:** es código de **backend**. Tras `git pull` + `npm install` en el servidor, hay que **reiniciar el servicio** (`sudo systemctl restart epubreader.service`) para que tome efecto. Solo lo puede hacer el dueño del servidor.
