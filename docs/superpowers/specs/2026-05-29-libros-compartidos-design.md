# Rediseño de la página principal: Libros Compartidos, modo invitado y puntuaciones

**Fecha:** 2026-05-29
**Estado:** Diseño aprobado

## Resumen

Rediseñar la pantalla principal en dos secciones apiladas — **Mis Libros** y
**Libros Compartidos** — con un encabezado fijo (logo + "MisLibros"). Habilitar
un **modo invitado** (entrar sin iniciar sesión) que muestra la vitrina de libros
compartidos y un botón de Google donde irían los libros del usuario. Permitir a
los usuarios **compartir** uno o varios de sus libros, volviéndolos visibles y
legibles para cualquiera (invitado o logueado), y permitir que los usuarios
registrados **puntúen** los libros compartidos con estrellas, ordenando la
vitrina por puntuación.

## Decisiones tomadas (brainstorming)

1. **Alcance de un libro compartido:** cualquiera (invitado o logueado) lo ve en
   "Libros Compartidos", puede **abrirlo y leerlo completo**, y guarda su
   **progreso solo localmente**.
2. **Acción de compartir:** desde el **modo selección** existente — botones masivos
   **Compartir** / **Dejar de compartir** junto a Eliminar. Solo el dueño.
3. **Autoría:** cada libro compartido muestra **"compartido por [nombre]"** (el
   nombre del usuario dueño).
4. **Mis libros compartidos:** aparecen **solo en "Mis Libros"** con una insignia
   🔗 "Compartido". "Libros Compartidos" muestra los de **otros** usuarios (el
   invitado los ve todos). Sin duplicados.
5. **Invitados y anotaciones:** el invitado **solo lee + progreso local**; notas y
   subrayados quedan **deshabilitados** (función de cuenta).
6. **Puntuaciones:** 1–5 estrellas, **un voto por usuario registrado**, el **dueño
   también puede votar**. Los invitados ven las estrellas pero no votan.
7. **Orden de la vitrina:** promedio de estrellas ↓ → número de votos ↓ → libros
   sin votos al final (por fecha de compartido descendente).
8. **Ruteo de entrada:** la app **siempre entra por `/login`**. Desde ahí: Google
   Sign-In, o "Entrar sin iniciar sesión" → `/` en modo invitado. Si ya existe
   una sesión válida guardada, `/login` redirige a `/`.

## Arquitectura

### Enfoque elegido: namespace público separado

Se añade una columna `shared` a `books` y un router **sin autenticación**
`/api/shared` que **solo** sirve libros con `shared = 1`. Las rutas privadas
`/api/books/*` permanecen estrictas. La separación física hace imposible filtrar
libros privados desde el namespace público.

### Backend

#### Base de datos (`server/src/db.js`)

- **Migración:** nueva columna `books.shared INTEGER NOT NULL DEFAULT 0` (patrón
  `hasColumn` existente).
- **Nueva tabla:**

  ```sql
  CREATE TABLE IF NOT EXISTS ratings (
    book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    updated_at TEXT    DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (book_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ratings_book ON ratings(book_id);
  ```

#### Middleware de auth opcional (`server/src/middleware/authOptional.js`)

Nuevo middleware: si hay token válido (header `Bearer`, `_t` en body/query) setea
`req.user`; si no hay token o es inválido, continúa con `req.user = null` (no
responde 401). Reutiliza `verifyJwt`. Necesario para que `GET /api/shared` marque
`mine`/`myStars` cuando hay sesión, sin exigirla.

#### Router público (`server/src/routes/shared.js`)

Montado en `/api/shared`. Usa `authOptional` (no `authRequired`).

- `GET /api/shared` → lista de libros con `shared = 1`. JOIN con `users` (nombre
  del dueño) y agregación de `ratings`. Devuelve por libro:
  `{ id, title, author, format, coverUrl, sharedBy, mine, avgStars, ratingCount, myStars }`
  donde:
  - `coverUrl` apunta a `/api/shared/:id/cover` (público).
  - `sharedBy` = `users.name` (o email como fallback) del dueño.
  - `mine` = `true` si `req.user` es el dueño.
  - `avgStars` = promedio (o `null` si sin votos), `ratingCount` = nº de votos.
  - `myStars` = voto del solicitante (o `null`).
  - **Orden SQL:** `ORDER BY (ratingCount = 0), avgStars DESC, ratingCount DESC,
    uploaded_at DESC` (los sin votos al final).
- `GET /api/shared/:id/file` → sirve el archivo **solo si el libro existe y
  `shared = 1`**; resuelve la ruta con `bookPath(dataDir, book.user_id, id, format)`.
- `GET /api/shared/:id/cover` → sirve la portada **solo si `shared = 1`**.
- `PUT /api/shared/:id/rating` → **requiere auth** (rechaza si `req.user` es null
  con 401). Body `{ stars }`, valida entero 1–5. Verifica que el libro exista y
  `shared = 1`. Upsert en `ratings` (`INSERT ... ON CONFLICT(book_id, user_id) DO
  UPDATE`). Devuelve `{ avgStars, ratingCount, myStars }` recalculado.
- `DELETE /api/shared/:id/rating` (auth) → elimina el voto del usuario. Devuelve
  agregados recalculados. (Permite "quitar mi voto".)

#### Router privado (`server/src/routes/books.js`)

- `GET /api/books` → agregar el campo `shared` (0/1) a cada fila devuelta.
- `POST /api/books/share` → auth. Body `{ ids }`. `UPDATE books SET shared = 1
  WHERE id IN (...) AND user_id = ?`. Devuelve `{ updated }`.
- `POST /api/books/unshare` → auth. Igual con `shared = 0`. Al dejar de compartir
  **no** se borran las puntuaciones (se conservan; quedan ocultas hasta recompartir).
  *(Alternativa: borrar ratings al dejar de compartir — se decide en implementación;
  por defecto se conservan.)*

#### Montaje (`server/src/app.js`)

- Montar `createSharedRouter(db, dataDir)` en `/api/shared` **antes** o de forma
  independiente al router privado. El router público no pasa por `authRequired`.

### Frontend

#### Ruteo (`client/src/App.jsx`)

- `/login` → `LoginPage`. Si hay token válido, redirige a `/`.
- `/` → `LibraryPage` **pública** (se quita `ProtectedRoute`); maneja invitado vs
  logueado internamente.
- `/read/:bookId` → `ReaderPage` **pública** (se quita `ProtectedRoute`); usa
  `?shared=1` para decidir el modo.
- `*` → redirige a `/login`.

#### `LoginPage` (`client/src/auth/LoginPage.jsx`)

- Extraer el botón de Google Sign-In (web GSI + nativo) a un componente reutilizable
  `GoogleSignInButton` en `client/src/auth/`, usado tanto aquí como en el slot de
  invitado de `LibraryPage`.
- Añadir un enlace/botón secundario **"Entrar sin iniciar sesión"** → `navigate('/')`.
- Si al montar ya hay token válido, redirigir a `/`.

#### `LibraryPage` (`client/src/library/LibraryPage.jsx`)

Estructura:

```
<header> logo + "MisLibros"   [ajustes · avatar · Salir  — solo si logueado] </header>

<section "Mis Libros">
  Logueado → <Toolbar/> + grilla de libros propios (insignia 🔗 en compartidos)
  Invitado → tarjeta CTA: <GoogleSignInButton/> + tagline
</section>

<section "Libros Compartidos">
  grilla ordenada por puntuación; cada tarjeta:
    portada · título · autor · "compartido por [nombre]" · estrellas
    logueado → estrellas interactivas (PUT/DELETE rating)
    invitado → estrellas solo lectura
</section>
```

- Cargar libros propios con `api.listBooks()` (solo logueado) y compartidos con
  `api.listShared()` (siempre, invitado y logueado).
- En modo selección, `Toolbar` suma botones **Compartir (n)** / **Dejar de
  compartir (n)** según el estado de los seleccionados (si todos compartidos →
  mostrar "Dejar de compartir"; si hay no compartidos → "Compartir"). Llaman a
  `api.shareBooks(ids)` / `api.unshareBooks(ids)` y recargan ambas listas.
- El buscador filtra ambas secciones por título/autor.
- "Libros Compartidos" oculta los libros con `mine = true` (ya están en Mis Libros).

#### Tarjeta de libro / estrellas

- Reutilizar/extender `BookCard` para soportar variante "compartido" con:
  insignia de autoría y control de estrellas.
- Nuevo componente `StarRating` (`client/src/library/`): muestra promedio +
  conteo; en modo interactivo permite fijar/cambiar/quitar el voto. Invitado =
  solo lectura (tooltip "Inicia sesión para puntuar").

#### `ReaderPage` (`client/src/reader/ReaderPage.jsx`)

- Detectar modo compartido vía `useSearchParams()` (`shared=1`) o ausencia de token.
- **Modo compartido / invitado:**
  - Archivo: `bookFileUrl` → `/api/shared/:id/file`; portada análoga.
  - Progreso: **solo local** (`offlineProgress.js`); **no** llamar a
    `api.putProgress*` (la tabla `reading_progress` es global por libro y un
    no-dueño pisaría el progreso del dueño).
  - Anotaciones: **deshabilitadas** (ocultar `SelectionMenu`/notas, no cargar
    `listAnnotations`).
- **Modo propio (logueado, dueño):** comportamiento actual sin cambios.

#### API client (`client/src/lib/api.js`)

- `listShared()` → `GET /api/shared`.
- `shareBooks(ids)` / `unshareBooks(ids)` → `POST /api/books/share|unshare`.
- `rateShared(bookId, stars)` → `PUT /api/shared/:id/rating`.
- `unrateShared(bookId)` → `DELETE /api/shared/:id/rating`.
- `sharedFileUrl(bookId)` / `sharedCoverUrl(bookId)` → URLs públicas (la portada
  no necesita token).

## Flujo de datos

1. **Compartir:** usuario logueado → modo selección → "Compartir (n)" →
   `POST /api/books/share` → recarga `Mis Libros` (insignia) y `Libros Compartidos`.
2. **Ver vitrina (invitado):** `/login` → "Entrar sin iniciar sesión" → `/` →
   `GET /api/shared` (sin token) → grilla ordenada por puntuación, estrellas solo
   lectura.
3. **Leer compartido:** click en tarjeta compartida → `/read/:id?shared=1` →
   archivo desde `/api/shared/:id/file`, progreso local, sin anotaciones.
4. **Puntuar:** usuario logueado → click en estrella de una tarjeta compartida →
   `PUT /api/shared/:id/rating` → actualiza promedio/conteo y reordena.

## Manejo de errores

- Rutas públicas: 404 si el libro no existe o `shared = 0` (no se distingue para
  no filtrar existencia de libros privados).
- `PUT/DELETE rating` sin sesión → 401 (el cliente muestra "Inicia sesión para
  puntuar").
- `stars` fuera de 1–5 o no entero → 400.
- `share`/`unshare` solo afectan libros del propio `user_id`; ids ajenos se ignoran.
- Invitado offline → la vitrina compartida requiere red (sin caché offline para
  compartidos en esta iteración).

## Pruebas

- **Backend (vitest):**
  - `share`/`unshare` solo afectan libros propios; ids ajenos no cambian.
  - `GET /api/shared` lista solo `shared = 1`, con `sharedBy`, agregados y orden
    correcto (promedio ↓, votos ↓, sin-votos al final).
  - `mine`/`myStars` correctos con y sin token (authOptional).
  - `file`/`cover` públicos: 200 si compartido, 404 si privado.
  - `PUT rating`: upsert, validación 1–5, 401 sin token, recálculo de agregados;
    `DELETE rating` quita el voto.
- **Frontend:** verificación manual del flujo invitado, compartir desde selección,
  insignias, estrellas interactivas vs solo lectura, lectura compartida con
  progreso local y sin anotaciones.

## Fuera de alcance (YAGNI)

- Caché/lectura offline de libros compartidos.
- Anotaciones de invitados (locales o no).
- Comentarios/reseñas de texto (solo estrellas).
- Enlaces privados por token (la vitrina es pública para todos).
- Moderación/reportes de libros compartidos.
