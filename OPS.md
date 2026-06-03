# Ops runbook — MisLibros

Datos fijos que necesito para deploy / build sin tener que buscar.

## Servidor

- **Host:** `administrator@147.93.176.249`
- **Repo en el server:** `/home/administrator/epubReader`
- **APK público:** `/home/administrator/epubReader/server/data/downloads/mislibros.apk`
- **URLs públicas:**
  - App: `https://mislibros.openlinks.app`
  - APK: `https://mislibros.openlinks.app/downloads/mislibros.apk`

## Deploy web

```bash
git push                                # desde local
ssh administrator@147.93.176.249 'cd ~/epubReader && git pull && cd client && npm run build'
```

(Express sirve `client/dist` directo — para cambios **solo de frontend** no hace falta reiniciar nada.)

### Cambios de backend → reiniciar el servicio (lo hace Jose)

El server corre como el servicio systemd **`epubreader.service`** (`User=administrator`,
`WorkingDirectory=.../server`, `ExecStart=/usr/bin/node src/index.js`, `Restart=on-failure`,
puerto `3100`, nginx hace proxy a `127.0.0.1:3100`). El `.env` del server vive en
`server/.env`.

Cualquier cambio de **backend** (rutas nuevas, middleware, migración de DB en `db.js`)
necesita reiniciar el proceso. **Solo Jose puede hacerlo** — requiere su contraseña:

```bash
sudo systemctl restart epubreader
```

Notas para quien automatice (Claude/CI):
- **No tienes permiso para reiniciar.** `sudo systemctl restart` y `systemctl restart`
  fallan con *"Interactive authentication required"* (ver sección "Sudo" abajo: el
  `NOPASSWD` que decía esta nota NO está activo). Hay que pedirle a Jose que ejecute el
  comando de arriba.
- **NUNCA reinicies matando el PID.** El unit es `Restart=on-failure`: un `kill`/SIGTERM
  es apagado limpio → systemd NO lo relevanta → 502 Bad Gateway. (Ya pasó una vez.)
- Sin reiniciar, el proceso viejo sigue vivo y las rutas nuevas caen al catch-all
  `app.get('*')` devolviendo el `index.html` del SPA (**HTTP 200 con HTML**, no 404) —
  fácil de confundir con "funciona".
- Las migraciones de DB corren solas al arrancar (`openDb()`, patrón `hasColumn` +
  `ALTER TABLE`, idempotentes). Antes de una migración:
  `cp server/data/library.db server/data/library.db.bak-<motivo>`.
- Verificar tras el restart: `curl https://mislibros.openlinks.app/api/shared` debe
  devolver **JSON** (`[]` o lista), NO HTML; y `/api/health` → 200.

**Restauración de emergencia sin sudo** (si el servicio quedó caído y Jose no está):
arrancar a mano replicando el unit — restaura el servicio pero **fuera de systemd**
(no sobrevive reboot ni se auto-reinicia); Jose debe luego hacer `sudo systemctl restart
epubreader` para devolverlo a systemd (mata antes el proceso manual o chocará el puerto 3100):
```bash
ssh administrator@147.93.176.249
cd /home/administrator/epubReader/server
set -a; . ./.env; [ -f ./.env.production ] && . ./.env.production; set +a
export NODE_ENV=production PORT=3100
nohup /usr/bin/node src/index.js > /tmp/epub-manual.log 2>&1 &
```

## Admin / censura de libros

Los administradores (pueden censurar libros compartidos) se definen por correo en
el `.env` del servidor:

```
ADMIN_EMAILS=joseabantomarin@gmail.com
```

Coma-separado para varios. El check es por el email del JWT (Google). Tras cambiarlo
hay que **reiniciar el backend** (`sudo systemctl restart epubreader.service`) y el
admin debe **volver a iniciar sesión** para que su `user.isAdmin` se actualice.
Censurar oculta el libro de la vitrina y bloquea su apertura por terceros; el dueño
conserva acceso y lo ve marcado con la razón.

## IA (Explicar con IA)

La función "Explicar con IA" usa Groq. Requiere en el `.env` del servidor:

```
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.1-8b-instant   # opcional
```

Sin `GROQ_API_KEY`, el endpoint `/api/ai/explain` responde 503 y el botón "IA" no
aparece en el menú de selección. Tras añadir/cambiar la clave hay que reiniciar el
backend (`sudo systemctl restart epubreader.service`).

## Build + publicar APK

**CRÍTICO**: el build nativo necesita `VITE_API_BASE=https://mislibros.openlinks.app` (URL absoluta). Si queda vacío (como en el build web, pensado para rutas relativas del mismo origen), todas las llamadas a `/api/...` se quedan en el `localhost` del webview de Capacitor y NADA funciona (ni login ni nada).

Esto ya **no** se parchea a mano. La URL vive en `client/.env.android` (commiteado) y la carga el modo de Vite `--mode android`:

- `npm run build:android` → build nativo contra **producción** (`.env.android`).
- `npm run build:android:local` → build nativo contra un **backend local** (`.env.androidlocal`, gitignored; copiar de `.env.androidlocal.example` y poner la IP de tu LAN).
- `npm run build` → build **web** (sin `VITE_API_BASE`, rutas relativas). No tocar para el APK.

Java 21 es obligatorio (Capacitor 8). Java 25 del sistema NO sirve.

```bash
cd <repo>/client
# 1) build nativo (producción) + sync + APK   (sin tocar ningún .env a mano)
npm run build:android
npx cap sync android
cd android
JAVA_HOME=<ruta-jdk-21> ./gradlew assembleRelease   # o bundleRelease para el .aab del Play Store
# 2) verificar que la URL absoluta esté en el bundle
grep -oE '"https://mislibros\.openlinks\.app"' ../dist/assets/index-*.js
# 3) subir el APK público
scp app/build/outputs/apk/release/app-release.apk \
    administrator@147.93.176.249:/home/administrator/epubReader/server/data/downloads/mislibros.apk
```

Firma: lee `client/android/keystore.properties` (gitignored) o las env vars `MISLIBROS_KEYSTORE_*`. Ver "Firma de release" abajo.

## JDKs instalados localmente

- `~/jdks/jdk-21.0.11+10/Contents/Home` ← usar este
- `~/jdks/jdk-17.0.19+10/Contents/Home` (no usar, Cap 8 quiere 21)
- `/Library/Java/JavaVirtualMachines/temurin-25.jdk/Contents/Home` (no usar, demasiado nuevo para Gradle)

## Firma de release (no tocar)

- Keystore: `/Users/joseabanto/keystores/mislibros-release.jks`
- Properties: `client/android/keystore.properties` (gitignored)
- Alias: `mislibros`

## Sudo en el server

`administrator` **requiere contraseña para sudo** (verificado 2026-05-30: `sudo -n true`
→ *"a password is required"*; `systemctl restart` → *"Interactive authentication
required"*). No hay regla `NOPASSWD` ni polkit activa. Consecuencia: cualquier acción que
necesite sudo (reiniciar el servicio, editar el unit, etc.) **la ejecuta Jose a mano** —
los procesos automatizados no pueden. Ver "Cambios de backend" arriba.

## Google Sign-In

- OAuth client (Web + Android comparten): `823603281404-rgg8sb970f86cmqo91vgi6ibh0ph8ban.apps.googleusercontent.com`
- En `capacitor.config.json` están `clientId`, `androidClientId` y `serverClientId` con ese mismo ID.
- El plugin `@codetrix-studio/capacitor-google-auth` se instala con `--legacy-peer-deps` (está hecho para Cap 6).
