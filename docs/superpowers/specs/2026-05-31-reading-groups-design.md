# Grupos de lectura + visibilidad de 3 niveles — Diseño

**Fecha:** 2026-05-31
**Estado:** aprobado (pendiente de plan de implementación)

## Objetivo

Permitir que un usuario registrado cree uno o más **grupos de lectura**, agregue a
otros usuarios por email, y al compartir un libro elija entre **tres niveles de
visibilidad exclusivos**: público, grupo o individual.

## Decisiones clave (acordadas)

1. **Agregar miembros por email.** Si el email ya tiene cuenta, el miembro queda
   activo; si no, queda **pendiente** y se activa solo cuando esa persona inicia
   sesión por primera vez con ese correo.
2. **Visibilidad exclusiva.** Cada libro tiene un único estado:
   `private` | `public` | `group` | `user`. Cambiar a otro reemplaza el anterior.
3. **Dónde ven los destinatarios los libros:**
   - `Compartidos` = solo libros públicos (igual que hoy).
   - `Mis grupos` = lista de grupos; al entrar a uno se ven sus libros.
   - `Compartido conmigo` = libros compartidos individualmente conmigo.
4. **Administración del grupo: solo el creador (dueño).** Agrega/quita miembros,
   renombra y borra el grupo. Los miembros solo ven y pueden **salirse**.
5. **Individual solo a emails ya registrados** (apunta a un usuario real). Si el
   correo no tiene cuenta → error claro. (Los grupos sí permiten pendientes.)
6. **Sin notificaciones ni flujo de aceptación**: agregar es directo.

## Modelo de datos

Migraciones idempotentes en `server/src/db.js` (patrón `hasColumn` + `CREATE TABLE
IF NOT EXISTS`, como las existentes).

### Tablas nuevas

```sql
CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id);

CREATE TABLE IF NOT EXISTS group_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL = pendiente
  email       TEXT    NOT NULL,                                -- minúsculas
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, email)
);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_email ON group_members(email);
```

- **Miembro activo:** `user_id` poblado. **Pendiente:** `user_id` NULL (se conoce el
  email pero aún no hay cuenta).
- El **dueño** es miembro implícito vía `groups.owner_id` (no se duplica en
  `group_members`).

### Cambios en `books`

```sql
ALTER TABLE books ADD COLUMN visibility      TEXT NOT NULL DEFAULT 'private';
ALTER TABLE books ADD COLUMN share_group_id  INTEGER;  -- usado si visibility='group'
ALTER TABLE books ADD COLUMN share_user_id   INTEGER;  -- usado si visibility='user'
```

- `visibility` ∈ `private` | `public` | `group` | `user`.
- **Backfill:** `UPDATE books SET visibility='public' WHERE shared = 1`.
- **Compatibilidad:** `visibility` es la fuente de verdad; el flag `shared` se
  mantiene en sincronía (`shared = (visibility='public') ? 1 : 0`) para no romper
  consultas existentes del estante público.
- No hay FK estricta a `groups`/`users` en estas columnas (SQLite + migración
  simple); la integridad se cuida en código: al **borrar un grupo** se ejecuta
  `UPDATE books SET visibility='private', share_group_id=NULL WHERE share_group_id=:id`.

## Vinculación de miembros pendientes

En el login de Google (`server/src/routes/auth.js`), tras crear/actualizar el
usuario:

```sql
UPDATE group_members SET user_id = :uid
 WHERE email = :email AND user_id IS NULL;
```

Así, agregar por email a alguien sin cuenta funciona automáticamente cuando se
registra.

## Reglas de acceso (visibilidad)

| visibility | Quién puede ver/abrir el libro |
|------------|--------------------------------|
| private    | Solo el dueño |
| public     | Todos (sujeto a censura admin y bloqueo de duplicados, como hoy) |
| group      | Dueño + miembros **activos** del `share_group_id` |
| user       | Dueño + el usuario `share_user_id` |

- **Censura admin** y **bloqueo de duplicados** aplican **solo a `public`**. Los
  libros de grupo/individual son privados (sin moderación ni chequeo de duplicados).
- La descarga del archivo (`/api/books/:id/file`, `/cover`) debe respetar estas
  reglas: hoy el archivo se sirve al dueño y los públicos vía `/api/shared/:id/file`.
  Se añade una verificación de acceso compartida para grupo/individual.

## Endpoints (Express)

### Grupos — `server/src/routes/groups.js` (nuevo, `authRequired`)

- `GET /api/groups` → grupos donde soy dueño o miembro activo. Cada uno:
  `{ id, name, role: 'owner'|'member', memberCount, createdAt }`.
- `POST /api/groups { name }` → crea grupo (dueño = yo). 400 si nombre vacío.
- `PATCH /api/groups/:id { name }` → renombrar (solo dueño; 403 si no).
- `DELETE /api/groups/:id` → borrar (solo dueño). Sus libros vuelven a `private`.
- `GET /api/groups/:id` → detalle: `{ id, name, role, members: [{id,email,name,status}],
  books: [...] }`. Miembros visibles para dueño y miembros; la lista de libros son
  los `visibility='group' AND share_group_id=:id` (con misma forma que `/api/shared`).
- `POST /api/groups/:id/members { email }` → agregar (solo dueño). Normaliza email a
  minúsculas. Si está registrado → activo; si no → pendiente. 409 si ya está.
- `DELETE /api/groups/:id/members/:memberId` → quitar (solo dueño).
- `POST /api/groups/:id/leave` → un miembro se sale (no el dueño; el dueño usa DELETE).

### Compartir — `server/src/routes/books.js` (modificar)

- `POST /api/books/share { ids, visibility, targetId? }`:
  - `visibility='public'` → marca público (mantiene bloqueo de duplicados actual).
  - `visibility='group'` → `targetId` = id de grupo del que soy dueño (403 si no).
  - `visibility='user'` → `targetId` o `email`: resolver a un `user_id` registrado;
    si el email no tiene cuenta → 404 `user_not_found`.
  - Setea `visibility`, `share_group_id`/`share_user_id` y sincroniza `shared`.
- `POST /api/books/unshare { ids }` → `visibility='private'`, limpia targets, `shared=0`.
- Listados del dueño (`GET /api/books`) devuelven `visibility` y el target para
  pintar el estado en la UI.

### Estantes

- `GET /api/shared` → **sin cambios** (público).
- Libros de grupo → dentro de `GET /api/groups/:id`.
- `GET /api/shared-with-me` (`authRequired`) → libros `visibility='user' AND
  share_user_id = me`, con `{ ..., ownerName }`.

## UI (cliente React)

- **Inicio (`LibraryPage`):** nueva entrada **"Mis grupos"** y sección/acceso
  **"Compartido conmigo"**.
- **Pantalla "Mis grupos":**
  - Lista de grupos (propios + donde soy miembro), con contador de miembros.
  - Crear grupo (nombre).
  - Abrir grupo → vista de detalle:
    - **Dueño:** gestionar miembros (agregar por email, quitar; ver pendientes),
      renombrar, borrar grupo, y ver libros del grupo.
    - **Miembro:** ver miembros y libros del grupo; botón "Salir del grupo".
- **Diálogo de compartir** (al compartir libro(s) desde la biblioteca): elegir
  **Público / Grupo (seleccionar cuál) / Individual (escribir email)**. Mostrar el
  estado actual de visibilidad del libro.
- **"Compartido conmigo":** estante de libros compartidos individualmente conmigo
  (con etiqueta "de \<dueño\>").
- `client/src/lib/api.js`: métodos nuevos (`listGroups`, `createGroup`, `renameGroup`,
  `deleteGroup`, `getGroup`, `addGroupMember`, `removeGroupMember`, `leaveGroup`,
  `listSharedWithMe`) y `shareBooks` extendido con `{ visibility, targetId }`.

## Pruebas (vitest, servidor)

- Grupos: crear, renombrar/borrar solo dueño (403 a otros), listar (dueño + miembro).
- Miembros: agregar registrado (activo) y no registrado (pendiente); 409 duplicado;
  quitar; salir; **pendiente → activo** al iniciar sesión con ese email.
- Visibilidad/acceso: miembro del grupo ve el libro; no-miembro recibe 404; individual
  visible solo para destinatario y dueño; público igual que hoy.
- Compartir: cambiar entre niveles es exclusivo (reemplaza); `unshare` → privado;
  individual a email no registrado → 404.
- Borrar grupo → sus libros vuelven a `private`.
- Censura/duplicados siguen aplicando solo a público.

## Orden de construcción sugerido

1. Migraciones de DB (tablas + columnas + backfill).
2. Backend grupos (CRUD + miembros + pendientes + vinculación en login).
3. Backend visibilidad de libros (share/unshare extendido + acceso a archivo/cover +
   `/api/shared-with-me`).
4. Cliente: API + pantalla "Mis grupos" + diálogo de compartir + "Compartido conmigo".

## Notas de despliegue

- Es **cambio de backend** (migración de DB al arrancar + rutas nuevas): tras el
  deploy hay que **reiniciar `epubreader.service`** (lo hace Jose). La migración corre
  sola al arrancar; respaldar `library.db` antes por precaución.
- El cliente se construye y empaqueta como siempre (web + APK).

## Fuera de alcance (YAGNI por ahora)

- Notificaciones / invitaciones con aceptación.
- Roles de administrador dentro del grupo.
- Compartir a múltiples destinos simultáneos.
- Calificaciones/comentarios en libros de grupo o individuales (las calificaciones
  siguen ligadas a libros públicos).
