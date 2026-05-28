# Diseño — Lector EPUB online (epubReader)

**Fecha:** 2026-05-27
**Autor:** José Abanto (con Claude)
**Estado:** Aprobado para implementación

## 1. Propósito

Aplicación web autohospedada para leer libros EPUB online, con login con Google y sincronización automática de la última posición leída entre dispositivos. El usuario sube sus EPUBs a su biblioteca personal, los lee en cualquier dispositivo y siempre reanuda desde donde se quedó.

## 2. Requisitos funcionales

- Login con Google (OAuth Google Identity Services).
- Pantalla inicial con:
  - Título "epubReader".
  - Buscador de libros (filtra título y autor).
  - Botón "Agregar libro" (sube un `.epub`).
  - Modo "Seleccionar" toggleable que habilita "Eliminar (n)" para borrado uno o múltiple.
  - Grid de libros con: portada, título, autor, progreso (%) y fecha de última lectura.
- Lector EPUB con paginación, navegación, persistencia de posición en cada cambio de página del usuario (no por tiempo, no en relocates internos de epub.js).
- 100% responsive (mobile-first); funciona igual en móvil y desktop.
- La posición y la biblioteca se persisten en servidor, accesibles desde cualquier dispositivo tras login.

## 3. Stack y decisiones

| Capa | Elección | Motivo |
|---|---|---|
| Backend | Node.js + Express | Estándar, sencillo, sirve API + estáticos |
| DB | SQLite (`better-sqlite3`) | Sin servicio extra; archivo único; suficiente para uso personal/familiar |
| Almacenamiento de EPUBs | Carpeta local del servidor (`data/books/<userId>/<bookId>.epub`) | Decisión explícita del usuario |
| Auth | Google Identity Services (id_token) + JWT propio HS256 | Sin sesiones del servidor; stateless |
| Frontend | React + Vite | Productivo, ecosistema maduro |
| Lector EPUB | epub.js | Estándar; soporta CFI para posición exacta |

## 4. Arquitectura general

```
epubReader/
├── server/                    # Node + Express
│   ├── src/
│   │   ├── index.js          # entry point
│   │   ├── db.js             # SQLite (better-sqlite3) + migración inicial
│   │   ├── auth.js           # verificar id_token Google + emitir/verificar JWT
│   │   ├── middleware.js     # authRequired
│   │   ├── epub.js           # parser de metadata + extracción de portada
│   │   └── routes/
│   │       ├── auth.js       # POST /api/auth/google
│   │       ├── books.js      # CRUD + upload + download + cover
│   │       └── progress.js   # GET/PUT progreso
│   ├── data/
│   │   ├── library.db
│   │   └── books/<userId>/<bookId>.epub
│   │                  └── <bookId>.jpg
│   ├── .env
│   └── package.json
│
└── client/                    # React + Vite
    ├── src/
    │   ├── main.jsx
    │   ├── App.jsx           # router + AuthContext
    │   ├── api.js            # fetch wrapper con JWT y manejo 401
    │   ├── auth/
    │   │   ├── AuthContext.jsx
    │   │   └── LoginPage.jsx
    │   ├── library/
    │   │   ├── LibraryPage.jsx
    │   │   ├── Toolbar.jsx   # buscador + agregar + seleccionar/eliminar
    │   │   ├── BookGrid.jsx
    │   │   └── BookCard.jsx
    │   └── reader/
    │       └── ReaderPage.jsx
    ├── .env
    └── package.json
```

En producción, Express sirve `client/dist/` como estático y todas las rutas API bajo `/api/*`. Un solo proceso, un solo puerto.

## 5. Base de datos

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub    TEXT    UNIQUE NOT NULL,
  email         TEXT    NOT NULL,
  name          TEXT,
  picture_url   TEXT,
  created_at    TEXT    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE books (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  author        TEXT,
  cover_path    TEXT,
  file_path     TEXT    NOT NULL,
  file_size     INTEGER,
  uploaded_at   TEXT    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_books_user ON books(user_id);

CREATE TABLE reading_progress (
  book_id       INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  cfi           TEXT,
  percentage    REAL    DEFAULT 0,
  total_pages   INTEGER,                      -- book.locations.length() (charsPerLocation=1024)
  last_read_at  TEXT    DEFAULT CURRENT_TIMESTAMP
);
```

- `google_sub` es el `sub` del id_token de Google: identificador estable, único por cuenta.
- `cfi` (Canonical Fragment Identifier de epub.js): reproduce la posición exacta al volver.
- `reading_progress` tiene como máximo una fila por libro; se usa `INSERT OR REPLACE`.
- `PRAGMA foreign_keys = ON;` debe activarse al abrir la conexión.

## 6. API REST

Todas las rutas excepto `POST /api/auth/google` requieren `Authorization: Bearer <jwt>`.

### Auth
- `POST /api/auth/google`
  - Body: `{ credential: "<google id_token>" }`
  - Verifica con `google-auth-library` (`verifyIdToken`, `audience: GOOGLE_CLIENT_ID`).
  - Crea o recupera usuario por `google_sub`.
  - Respuesta: `{ token: "<jwt>", user: { id, email, name, picture } }`.

### Books
- `GET /api/books`
  - Lista libros del usuario con join a `reading_progress`.
  - Respuesta: `[{ id, title, author, coverUrl, percentage, lastReadAt }]`. `coverUrl` es `/api/books/:id/cover` (relativo).
- `POST /api/books` (multipart/form-data, campo `file`)
  - Multer con `diskStorage` → ubicación temporal.
  - Validación: extensión `.epub`, MIME, "magic bytes" `PK\x03\x04`, tamaño ≤ 50 MB.
  - Validación previa al `INSERT`: si los magic bytes no coinciden o el archivo no es un zip válido → se elimina y se devuelve 400.
  - Parser EPUB (después de validar zip): abre `META-INF/container.xml` → `content.opf` → `dc:title`, `dc:creator`, `<meta name="cover">` o item `properties="cover-image"` → extrae imagen a `data/books/<userId>/<bookId>.<ext>`.
  - Tras parsear (con o sin éxito), se hace `INSERT` y se mueve el archivo a `data/books/<userId>/<bookId>.epub` (renombrado con `lastInsertRowid`).
  - Si el parseo de metadatos falla pero el zip es válido, el libro queda con `title = filename`, `author = null`, `cover_path = null` (no se rechaza la subida — el usuario podrá leerlo igual).
  - Respuesta: `{ id, title, author, coverUrl, percentage: 0, lastReadAt: null }`.
- `DELETE /api/books`
  - Body: `{ ids: [number] }`.
  - Verifica que todos los `ids` pertenecen al usuario.
  - Borra filas (cascada limpia `reading_progress`) y archivos físicos (`.epub` + portada).
  - Respuesta: `{ deleted: number }`.
- `GET /api/books/:id/file`
  - Verifica propiedad. `res.sendFile` con `Content-Type: application/epub+zip`.
- `GET /api/books/:id/cover`
  - Verifica propiedad. Devuelve la portada o 404 si no hay.

### Progress
- `GET /api/books/:id/progress` → `{ cfi, percentage, lastReadAt }` o `{ cfi: null, percentage: 0, lastReadAt: null }`.
- `PUT /api/books/:id/progress`
  - Body: `{ cfi: string, percentage: number }`.
  - `INSERT OR REPLACE INTO reading_progress (...)` con `last_read_at = CURRENT_TIMESTAMP`.
  - Respuesta: `{ ok: true }`.

## 7. Frontend

### Rutas
```
/login        → LoginPage (sin auth)
/             → LibraryPage   (requiere JWT, redirige a /login si falta)
/read/:bookId → ReaderPage    (requiere JWT)
```

### AuthContext
- Estado `{ token, user }` persistido en `localStorage` (`epubreader.token`, `epubreader.user`).
- `login(credential)`, `logout()` (limpia storage + redirige).
- `api.js` adjunta `Authorization`; un `401` dispara `logout()`.

### LoginPage
- Script `https://accounts.google.com/gsi/client` cargado dinámicamente.
- Botón renderizado con `google.accounts.id.renderButton`.
- Callback recibe `credential` → `POST /api/auth/google` → guarda JWT + navega a `/`.

### LibraryPage

Layout (mobile-first):

```
┌───────────────────────────────────────────────────────────┐
│ epubReader                                  [avatar▾]     │
├───────────────────────────────────────────────────────────┤
│ [🔍 Buscar...]     [＋ Agregar]  [☑ Seleccionar]          │
├───────────────────────────────────────────────────────────┤
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐                       │
│  │ cov │  │ cov │  │ cov │  │ cov │                       │
│  └─────┘  └─────┘  └─────┘  └─────┘                       │
│  Título    Título    Título    Título                     │
│  Autor     Autor     Autor     Autor                      │
│  ▓▓▓░░ 60% ▓░░░░ 12% ░░░░░  0% ▓▓▓▓▓100%                  │
│  hace 2d   hace 1h   nunca    hace 5d                     │
└───────────────────────────────────────────────────────────┘
```

- Grid: `grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))`. 2 col en móvil estrecho, hasta 6 en desktop ancho.
- Buscador: filtra client-side por `title` y `author` (case-insensitive).
- Agregar: `<input type="file" accept=".epub">` oculto; muestra skeleton/spinner durante upload.
- **Modo Seleccionar**:
  - Toggle en toolbar. Mientras está activo:
    - Tarjetas muestran checkbox arriba-izquierda.
    - Tap = marca/desmarca (no abre el libro).
    - Toolbar reemplaza "Agregar" por "Eliminar (n)" y "Cancelar".
    - "Eliminar" pide confirmación (`confirm()` o modal) y llama `DELETE /api/books`.
- Fecha relativa: helper local (`hace 2d`, `hace 1h`, `nunca`).

### ReaderPage

- Header: flecha atrás, título, % de avance.
- Carga del EPUB con auth: como `new ePub(url)` no permite enviar headers, se hace `fetch('/api/books/:id/file', { headers: { Authorization } })` → `await res.arrayBuffer()` → `ePub(arrayBuffer)`. Se renderiza en un div fullscreen.
- Al montar: `GET /api/books/:id/progress` → si hay `cfi`, `rendition.display(cfi)`; si no, primera página.
- Persistencia: las llamadas a `rendition.next()` / `rendition.prev()` están envueltas para incrementar un contador `pendingUserNavs`. Cada evento `relocated` que llega solo guarda si hay navegaciones pendientes (y las decrementa). Esto descarta relocates internos (restauración tras `display()`, resize, recálculo de layout) que reportan el cfi del *spread-start* y no la posición precisa del usuario.
- Tras `display(savedCfi)` hay un periodo de gracia de 500 ms en el que ningún relocate se procesa, para evitar capturar eventos de layout inicial.
- Indicador de página = `round(percentage × totalPages)`. `totalPages` viene de `book.locations.length()` y se persiste en la fila de `reading_progress` (campo `total_pages`); en la siguiente sesión el indicador se muestra al instante sin esperar a regenerar locations. El cálculo de `percentage` por cfi solo se hace cuando las locations están listas; mientras tanto se conserva el valor leído de DB.
- Navegación: flechas teclado (← →), botones flotantes en bordes (visibles al hover/tap), gestos swipe en móvil (touchstart/touchend con umbral).
- Tema: respeta `prefers-color-scheme`. Toggle claro/oscuro persistido en `localStorage` (no en servidor — preferencia local).

### Responsive
- Toolbar colapsa en móvil: buscador full-width, botones en segunda fila.
- Tarjetas: portada con `aspect-ratio: 2/3`, `object-fit: cover`. Fallback si no hay portada: SVG con título/autor sobre color generado.
- Sin librerías de UI pesadas — CSS plano o CSS modules.

## 8. Seguridad

### Auth
- Verificación de id_token con `google-auth-library`, validando `aud`, `iss` y `exp`.
- JWT HS256, expiración 30 días, secreto en `JWT_SECRET` (≥ 32 bytes aleatorios).
- Middleware `authRequired` parsea header y adjunta `req.user = { id, email }`.

### Aislamiento de datos
- Todas las queries filtran por `user_id = req.user.id`.
- IDs del cliente nunca se confían: se valida propiedad antes de leer/escribir/servir archivos.
- Path de archivos siempre derivado de IDs internos (`<bookId>.epub`), nunca del nombre original → previene path traversal.

### Validación de uploads
- Tamaño máximo 50 MB.
- Extensión `.epub`, MIME `application/epub+zip` (o `application/zip`), magic bytes `PK\x03\x04`.
- Si los magic bytes no coinciden o el archivo no es un zip válido → se rechaza con 400 y se elimina el temporal.
- Si el parseo de metadatos (title/author/cover) falla pero el zip es válido, el libro queda con metadatos mínimos (no se rechaza — el usuario podrá leerlo igual).

### Endurecimiento Express
- `helmet()` con CSP que permite scripts/iframes de `https://accounts.google.com`.
- `cors` solo para el origen del frontend (en dev: `http://localhost:5173`).
- `express-rate-limit` en `/api/auth/google` (10/min/IP) y `/api/books` POST (10/hora/usuario).

## 9. Variables de entorno

`server/.env`:
```
PORT=3001
JWT_SECRET=<cadena aleatoria de ≥ 32 bytes>
GOOGLE_CLIENT_ID=<OAuth Web client ID>
DATA_DIR=./data
NODE_ENV=production
CLIENT_ORIGIN=http://localhost:5173       # solo en dev
MAX_UPLOAD_MB=50
```

`client/.env`:
```
VITE_GOOGLE_CLIENT_ID=<mismo OAuth Web client ID>
VITE_API_BASE=                            # vacío en prod (mismo origen); en dev: http://localhost:3001
```

## 10. Despliegue

- Build: `cd client && npm run build` → genera `client/dist/`.
- Producción: el servidor Express sirve `client/dist/` como estático + API bajo `/api`. Un solo puerto.
- Gestor de proceso: `pm2` o unidad `systemd`.
- Detrás de Nginx/Caddy con TLS.
- Backups: `data/library.db` + `data/books/` (es todo el estado de la app).

## 11. Logging

- `morgan('combined')` para requests HTTP.
- Errores con stack a stdout; en producción se devuelve mensaje genérico al cliente.

## 12. Fuera de alcance (YAGNI por ahora)

- Multi-usuario con roles / compartir libros.
- Marcadores, notas, resaltados.
- Búsqueda dentro del texto del libro.
- Carpetas/colecciones.
- Sincronización offline (PWA con SW).
- Importar desde URL o Calibre.
- Estadísticas de lectura.

## 13. Criterios de aceptación

- [ ] Login con Google funciona en móvil y desktop.
- [ ] Se pueden subir EPUBs y aparecen en la grid con portada, título y autor.
- [ ] La grid se ve correctamente en pantallas de 320px a 1920px.
- [ ] El buscador filtra resultados en tiempo real.
- [ ] Modo Seleccionar permite borrar uno o varios libros tras confirmación.
- [ ] Al abrir un libro y avanzar páginas, al cerrar y volver desde otro dispositivo se reanuda exactamente en la misma posición.
- [ ] El progreso (%) y la fecha de última lectura se actualizan en la tarjeta tras leer.
- [ ] Un usuario no puede ver ni borrar libros de otro usuario (incluso forzando IDs).
