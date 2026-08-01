# Descarga de libros (original y PDF) — Diseño

**Fecha:** 2026-07-20
**Objetivo:** Permitir descargar un libro propio desde la biblioteca: siempre el archivo original y, cuando el libro es EPUB, también una versión convertida a PDF.

## Alcance

- Solo **libros propios** (sección "Mis Libros"). La descarga de libros compartidos por terceros queda fuera a propósito (decisión de producto aparte).
- Dos rutas: descarga del original y descarga en PDF (que para un libro ya en PDF es el mismo archivo).
- UI en el **modo selección** de la biblioteca, habilitada con **exactamente un libro** marcado.
- Android: la descarga la entrega el WebView al gestor de descargas del sistema.

Fuera de alcance (YAGNI): descarga de varios libros a la vez, descarga de compartidos, índice navegable o marcadores dentro del PDF, soporte de EPUB de maquetación fija, cola de trabajos asíncrona con sondeo.

## Fidelidad de la conversión

El PDF conserva texto, imágenes y el CSS propio del libro (lo renderiza Chrome de verdad). Se pierden el índice navegable y la paginación original del EPUB, y los EPUB de maquetación fija (cómics) pueden salir mal. Es el techo razonable sin instalar Calibre (~500 MB y sudo).

## Servidor

### Rutas nuevas (`server/src/routes/books.js`)

- `GET /api/books/:id/download` → archivo original con `Content-Disposition: attachment`.
- `GET /api/books/:id/download.pdf` → PDF: si `format === 'pdf'` sirve el original sin convertir; si es EPUB, convierte (con caché).
- Ambas bajo el `authRequired` del router (acepta `Authorization` **o** `?_t=<token>`, necesario porque la descarga es una navegación directa) y usan el `getOwnedBook` existente: 404 si el libro no es del usuario.

### Nombre del archivo descargado

`<título> - <autor>.<ext>`; sin autor, solo el título; sin título, `libro-<id>`. Saneado: se eliminan `/ \ : * ? " < > |` y caracteres de control, se colapsan espacios y se recorta a 100 caracteres. La cabecera lleva las dos formas para que los acentos lleguen bien:
`attachment; filename="<ascii>"; filename*=UTF-8''<uri-encoded>`

### `server/src/epub/spine.js` (nuevo)

`epubToHtml(epubPath, outDir)` → extrae el EPUB en `outDir`, escribe `outDir/book.html` y devuelve su ruta.

1. Extrae el zip con `adm-zip` (ya es dependencia).
2. `META-INF/container.xml` → ruta del OPF; del OPF, el manifest (`id → href`) y el spine (`idref` en orden de lectura).
3. Por cada documento del spine: lee el archivo, toma el interior de `<body>`, resuelve los atributos `src`/`href` relativos contra el directorio del propio documento (rutas posix, normalizadas) y lo envuelve en un `<section>`.
4. Recoge los `<link rel="stylesheet">` de cada documento, resueltos igual y deduplicados, para el `<head>`.
5. Añade CSS de impresión: `@page { margin: 18mm 15mm }`, `img { max-width: 100%; height: auto }` y salto de página antes de cada `<section>` salvo la primera.

Errores: si falta `container.xml`, el OPF o el spine está vacío, lanza; la ruta responde **422 `epub_invalid`**.

### `server/src/pdf/convert.js` (nuevo)

- `htmlToPdf(htmlPath, pdfPath, { chromeBin, timeoutMs })`: `execFile` de
  `chromeBin --headless --disable-gpu --no-sandbox --no-pdf-header-footer --print-to-pdf=<pdfPath> file://<htmlPath>`,
  con `timeoutMs` por defecto 90000. Falla si el proceso sale con error o el PDF no se creó.
- `getBookPdf({ epubPath, pdfPath, convert })` → devuelve `pdfPath`. Si el PDF existe y su `mtime >= mtime` del EPUB, lo devuelve tal cual (caché). Si no, genera en un directorio temporal (`fs.mkdtemp`), mueve el resultado a `pdfPath` y borra el temporal pase lo que pase. `convert` es inyectable para poder probar sin Chrome.
- **Guardián de concurrencia:** `Map<pdfPath, Promise>` con las conversiones en curso; una segunda petición del mismo libro espera a la primera en vez de lanzar otro Chrome. La entrada se borra al terminar (con éxito o con error).

Config: `CHROME_BIN` opcional en `server/.env`; por defecto `/usr/bin/google-chrome` (verificado presente en el servidor).

### Caché en disco

`<dataDir>/books/<userId>/<bookId>.conv.pdf`. El sufijo `.conv` evita cualquier confusión con el archivo de un libro cuyo formato ya es PDF. `removeBookFiles` ya borra todo lo que empieza por `<bookId>.`, así que la caché se limpia sola al eliminar el libro.

## Cliente

- `client/src/lib/api.js`: `bookDownloadUrl(bookId, { pdf = false })` → URL absoluta con `?_t=<token>` (mismo patrón que `bookCoverUrl`).
- `client/src/library/Toolbar.jsx`: botón **"Descargar"** en la barra del modo selección, junto a Eliminar/Compartir, deshabilitado salvo con `selectedCount === 1`.
- `client/src/library/DownloadDialog.jsx` (nuevo): para un EPUB ofrece «EPUB (original)» y «PDF (convertido)», con el aviso «La conversión puede tardar unos segundos». Para un libro ya en PDF no se abre: la descarga es directa.
- Disparo de la descarga: crear un `<a href=… download>` temporal, hacer click y quitarlo. Un solo camino de código para web y Android.

## Android

`MainActivity`: `getBridge().getWebView().setDownloadListener(...)` → arma un `DownloadManager.Request` con el `User-Agent` de la petición, nombre deducido con `URLUtil.guessFileName(url, contentDisposition, mimeType)`, destino público `DIRECTORY_DOWNLOADS` y notificación visible. Sin dependencias nuevas.

`AndroidManifest.xml`: `<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />`. Desde API 29 no hace falta permiso; en Android 7–9 (API 24–28, minSdk del proyecto) el sistema puede pedirlo — caso raro que se documenta y no se maneja con petición en tiempo de ejecución.

## Casos borde

- **Libro ya en PDF:** `download.pdf` sirve el original, sin invocar Chrome.
- **EPUB inválido o sin spine:** 422 `epub_invalid`; el cliente muestra el error.
- **Chrome ausente o conversión fallida/timeout:** 500 `pdf_failed`.
- **Doble clic:** el guardián de concurrencia asegura una sola conversión.
- **Libro ajeno:** 404 (por `getOwnedBook`). **Sin sesión:** 401.
- **Título con tildes** («Oráculo…»): nombre correcto gracias a `filename*=UTF-8''`.
- **Segunda descarga del mismo libro:** sale de la caché, sin conversión.

## Operación

Cambio de backend: tras el deploy hace falta que Jose ejecute `sudo systemctl restart epubreader`. El cambio en `MainActivity` obliga a un APK nuevo, que sale del release del CI (nunca del build local; ver OPS.md).

## Pruebas

**Servidor** (vitest + supertest):
- `download`: cabeceras `Content-Disposition` y nombre saneado; 404 con libro ajeno.
- `download.pdf` con `format='pdf'`: sirve el original y **no** llama al conversor (spy).
- `spine.js`: con un EPUB mínimo construido en el propio test (adm-zip), el HTML resultante trae los capítulos en orden del spine y la ruta de una imagen reescrita correctamente.
- `convert.js`: `getBookPdf` no reconvierte si el PDF está al día; convierte si falta; dos llamadas concurrentes producen una sola conversión.

**Cliente** (vitest + testing-library):
- `DownloadDialog`: muestra las dos opciones para EPUB.
- `Toolbar`: "Descargar" deshabilitado con 0 o 2 seleccionados, habilitado con 1.

**Manual:** conversión real en el servidor con un EPUB grande (medir tiempo); descarga en web y en la app Android.
