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

(Express sirve `client/dist` directo, no hace falta reiniciar nada.)

## Build + publicar APK

Java 21 es obligatorio (Capacitor 8). Java 25 del sistema NO sirve.

```bash
cd /Users/joseabanto/Applications/epubReader/client
npm run build
npx cap sync android                    # copia dist/ al APK
cd android
JAVA_HOME=/Users/joseabanto/jdks/jdk-21.0.11+10/Contents/Home ./gradlew assembleRelease
scp app/build/outputs/apk/release/app-release.apk \
    administrator@147.93.176.249:/home/administrator/epubReader/server/data/downloads/mislibros.apk
```

## JDKs instalados localmente

- `~/jdks/jdk-21.0.11+10/Contents/Home` ← usar este
- `~/jdks/jdk-17.0.19+10/Contents/Home` (no usar, Cap 8 quiere 21)
- `/Library/Java/JavaVirtualMachines/temurin-25.jdk/Contents/Home` (no usar, demasiado nuevo para Gradle)

## Firma de release (no tocar)

- Keystore: `/Users/joseabanto/keystores/mislibros-release.jks`
- Properties: `client/android/keystore.properties` (gitignored)
- Alias: `mislibros`

## Sudo en el server

Por ahora hay `NOPASSWD` temporal en `/etc/sudoers.d/90-administrator-nopasswd`. Mantener hasta que el usuario diga lo contrario; entonces:
```bash
ssh administrator@147.93.176.249 'sudo rm /etc/sudoers.d/90-administrator-nopasswd'
```

## Google Sign-In

- OAuth client (Web + Android comparten): `823603281404-rgg8sb970f86cmqo91vgi6ibh0ph8ban.apps.googleusercontent.com`
- En `capacitor.config.json` están `clientId`, `androidClientId` y `serverClientId` con ese mismo ID.
- El plugin `@codetrix-studio/capacitor-google-auth` se instala con `--legacy-peer-deps` (está hecho para Cap 6).
