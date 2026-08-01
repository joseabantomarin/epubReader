# Descarga de libros (original + PDF) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Descargar un libro propio desde la biblioteca en su formato original y, si es EPUB, convertido a PDF con Chrome headless.

**Architecture:** Dos rutas nuevas en `books.js` apoyadas en dos módulos con una responsabilidad cada uno: `epub/spine.js` (EPUB → un solo HTML) y `pdf/convert.js` (HTML → PDF con Chrome, caché en disco y guardián de concurrencia). En el cliente, botón en el modo selección + diálogo de formato; en Android, un `DownloadListener` en `MainActivity`. Spec: `docs/superpowers/specs/2026-07-20-book-download-design.md`.

**Tech Stack:** Express + vitest/supertest (server), React 18 + vitest/@testing-library (client), Java (MainActivity de Capacitor), `google-chrome` ya instalado en el servidor.

## Global Constraints

- Solo libros propios; `getOwnedBook` da 404 con libro ajeno.
- Caché del PDF: `<dataDir>/books/<userId>/<bookId>.conv.pdf`.
- Chrome: `CHROME_BIN` del entorno o `/usr/bin/google-chrome`; flags `--headless --disable-gpu --no-sandbox --no-pdf-header-footer --print-to-pdf=<out>`; timeout 90000 ms.
- Códigos de error: 422 `epub_invalid`, 500 `pdf_failed`.
- Textos UI en español: botón «Descargar», opciones «EPUB (original)» / «PDF (convertido)», aviso «La conversión puede tardar unos segundos».
- Tests: `cd server && npm test`, `cd client && npm test` (verificar exit code real, no enmascarar con grep).
- Commits convencionales con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- APK público SIEMPRE del release del CI (OPS.md), nunca del build local.

---

### Task 1: `epub/spine.js` — EPUB a un solo HTML (TDD)

**Files:**
- Create: `server/src/epub/spine.js`
- Test: `server/tests/epub.spine.test.js`

**Interfaces:**
- Produces: `epubToHtml(epubPath: string, outDir: string): string` (ruta del `book.html` escrito). Lo consume la Task 3.

- [ ] **Step 1: Test que falla** — `server/tests/epub.spine.test.js`: construye un EPUB mínimo con adm-zip (container.xml, OPF con manifest+spine de dos capítulos en orden inverso al alfabético, un capítulo con `<img src="../img/a.png">`), llama `epubToHtml` y comprueba que el HTML tiene los capítulos en orden de spine y la ruta de la imagen reescrita a `OEBPS/img/a.png`.

- [ ] **Step 2: Verificar fallo** — `cd server && npx vitest run tests/epub.spine.test.js` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar** `epubToHtml`: extraer zip, leer container.xml → OPF, parsear manifest (`id`→`href`) y spine (`idref` en orden), por cada documento extraer el interior de `<body>`, reescribir `src`/`href` relativos contra el directorio del documento, recolectar hojas de estilo, y escribir `book.html` con el CSS de impresión.

- [ ] **Step 4: Verificar** — mismo comando → PASS.

- [ ] **Step 5: Commit** — `feat(epub): assemble a single printable HTML from the spine`.

---

### Task 2: `pdf/convert.js` — HTML a PDF con caché (TDD)

**Files:**
- Create: `server/src/pdf/convert.js`
- Test: `server/tests/pdf.convert.test.js`

**Interfaces:**
- Produces: `htmlToPdf(htmlPath, pdfPath, opts?)` y `getBookPdf({ epubPath, pdfPath, convert })` → `Promise<string>`; `convert(epubPath, pdfPath)` inyectable. Lo consume la Task 3.

- [ ] **Step 1: Test que falla** — con un `convert` falso que escribe un PDF simulado: (a) si el PDF no existe, convierte una vez; (b) si el PDF existe y es más nuevo que el EPUB, no convierte; (c) dos llamadas concurrentes producen **una** conversión.

- [ ] **Step 2: Verificar fallo** — `cd server && npx vitest run tests/pdf.convert.test.js` → FAIL.

- [ ] **Step 3: Implementar** con el `Map` de conversiones en curso y la comparación de `mtime`.

- [ ] **Step 4: Verificar** → PASS.

- [ ] **Step 5: Commit** — `feat(pdf): convert HTML to PDF via headless Chrome with disk cache`.

---

### Task 3: Rutas de descarga (TDD)

**Files:**
- Modify: `server/src/routes/books.js`
- Create: `server/src/downloadName.js`
- Test: `server/tests/routes.download.test.js`

**Interfaces:**
- Consumes: `epubToHtml` (Task 1), `getBookPdf`/`htmlToPdf` (Task 2), `bookPath` y `getOwnedBook` existentes.
- Produces: `attachmentName(book): string` y las rutas `GET /:id/download` y `GET /:id/download.pdf`.

- [ ] **Step 1: Test que falla** — `attachmentName` sanea y compone «Título - Autor.epub»; `GET /:id/download` responde 200 con `Content-Disposition: attachment` y el nombre correcto; libro ajeno → 404; `GET /:id/download.pdf` con `format='pdf'` sirve el original.

- [ ] **Step 2: Verificar fallo** → FAIL.

- [ ] **Step 3: Implementar** `downloadName.js` y las dos rutas (la de PDF: original si `format==='pdf'`; si no, `getBookPdf` con un `convert` que hace `mkdtemp` → `epubToHtml` → `htmlToPdf` → limpieza; 422/500 según el fallo).

- [ ] **Step 4: Verificar** — `cd server && npm test` → toda la suite PASS.

- [ ] **Step 5: Commit** — `feat(books): add original and PDF download endpoints`.

---

### Task 4: UI del cliente (TDD)

**Files:**
- Modify: `client/src/lib/api.js`, `client/src/library/Toolbar.jsx`, `client/src/library/LibraryPage.jsx`, `client/src/library/library.module.css`
- Create: `client/src/library/DownloadDialog.jsx`
- Test: `client/src/library/DownloadDialog.test.jsx`

**Interfaces:**
- Produces: `bookDownloadUrl(bookId, { pdf })` en api.js; prop `onDownloadSelected` en Toolbar; `DownloadDialog({ open, book, onClose })`.

- [ ] **Step 1: Test que falla** — `DownloadDialog` con un libro EPUB muestra «EPUB (original)» y «PDF (convertido)»; cerrado no renderiza nada.

- [ ] **Step 2: Verificar fallo** → FAIL.

- [ ] **Step 3: Implementar** el diálogo, `bookDownloadUrl`, el botón «Descargar» (deshabilitado salvo `selectedCount === 1`) y el cableado en `LibraryPage` (si el libro es PDF, descarga directa sin diálogo).

- [ ] **Step 4: Verificar** — `cd client && npm test && npm run build` → PASS + build OK.

- [ ] **Step 5: Commit** — `feat(library): add download button and format dialog`.

---

### Task 5: Descarga nativa en Android

**Files:**
- Modify: `client/android/app/src/main/java/.../MainActivity.java`, `client/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1:** `setDownloadListener` en el WebView → `DownloadManager.Request` (User-Agent, `URLUtil.guessFileName`, `DIRECTORY_DOWNLOADS`, notificación visible).
- [ ] **Step 2:** Permiso `WRITE_EXTERNAL_STORAGE` con `android:maxSdkVersion="28"` en el manifest.
- [ ] **Step 3:** Compilar en local solo para verificar que Gradle no falla (`assembleRelease`); el APK que se publica sale del CI.
- [ ] **Step 4: Commit** — `feat(android): hand WebView downloads to the system download manager`.

---

### Task 6: Deploy web y restart

- [ ] **Step 1:** `git push`; en el servidor `git pull && cd client && npm run build`.
- [ ] **Step 2:** Avisar a Jose para `sudo systemctl restart epubreader` (cambio de backend).
- [ ] **Step 3:** Tras el restart, verificar: `/api/health` 200, `/api/shared` devuelve JSON, y una descarga real (original y PDF) midiendo el tiempo de conversión.

### Task 7: APK público

- [ ] **Step 1:** Esperar el release nuevo del CI (`gh release list`).
- [ ] **Step 2:** `gh release download <tag> --pattern '*.apk'`, verificar la firma SHA-1 `d2:18:65:9a:…` y subirlo como `mislibros.apk`.
- [ ] **Step 3:** Comprobar hash local = hash del servidor y que la URL pública responde 200.
