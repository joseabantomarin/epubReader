# Menú de selección para visitantes e IA con cupo anónimo — Diseño

**Fecha:** 2026-07-19
**Objetivo:** Mostrar el menú contextual de selección también sin sesión iniciada y en libros compartidos (hoy está oculto por completo con `{!isShared && …}`), y permitir la IA a visitantes anónimos con un cupo diario por IP que empuje a autenticarse.

## Alcance

- Menú contextual visible para todo el mundo. Acciones por contexto:
  - **Diccionario, Copiar, Compartir:** siempre (no tocan el servidor propio).
  - **IA:** todos, incluidos anónimos; con sesión sin límite, anónimos con cupo.
  - **Subrayar, Nota, Eliminar:** solo libro propio con sesión (comportamiento actual, controlado por la prop nueva `canAnnotate`).
- Cupo anónimo de IA: **10 consultas por día por IP**; cada turno del chat (pregunta inicial o repregunta) cuenta como una consulta. El cupo se consume al recibir la petición (una llamada fallida a Groq también consume).
- Mensaje de empuje, texto exacto: **«Autentícate con Google para seguir usando la IA»**.

Fuera de alcance (YAGNI): persistir el cupo en DB (el contador vive en memoria y se reinicia con el servicio — es un empujón, no facturación), límites para usuarios autenticados, botón de login dentro del modal, rate-limit global del API.

## Componentes

### 1. `server/src/aiQuota.js` (nuevo)

Módulo puro con el contador en memoria:

- `ANON_AI_LIMIT = 10` (exportado).
- `consumeAnonQuota(ip, now = new Date())` → `boolean`. Internamente guarda el día actual (`YYYY-MM-DD` de `now`) y un `Map` ip→conteo; al cambiar el día se limpia el Map completo (no crece sin límite). Devuelve `false` si la IP ya agotó el cupo del día; si no, incrementa y devuelve `true`.

### 2. `server/src/routes/ai.js` (modificar)

- `authRequired` → `authOptional` (ya existe).
- Tras validar el cuerpo: si `!req.user` y `!consumeAnonQuota(req.ip)` → `429 { error: 'ai_quota' }`. (`req.ip` es la IP real: `trust proxy` ya está configurado.)
- Nada más cambia (mismo system prompt, mismos recortes).

### 3. `client/src/reader/SelectionMenu.jsx` (modificar)

- Prop nueva `canAnnotate` (default `true`); en `false` oculta Subrayar, Nota y Eliminar.

### 4. `client/src/reader/ReaderPage.jsx` (modificar)

- `SelectionMenu` se renderiza siempre (se quita el gate `!isShared`), con `canAnnotate={!isShared}` y `showAI={online}`.

### 5. `client/src/reader/AIExplainModal.jsx` (modificar)

- Estado nuevo `blocked`. En el catch de `runTurn`: si `e.message === 'ai_quota'`, o `e.message === 'unauthorized'` sin sesión (`!getToken()`), → `setError('Autentícate con Google para seguir usando la IA')` y `setBlocked(true)`; el textarea y el botón Enviar quedan deshabilitados. Otros errores conservan el mensaje genérico actual.
- Aviso permanente: si no hay sesión y existe al menos una respuesta del asistente, una línea discreta al final del cuerpo del chat con el mismo texto (estilo `dictEmpty` existente).
- `blocked` se resetea al abrir el modal con un texto nuevo (mismo efecto que ya limpia mensajes/errores).

## Casos borde

- **Ventana entre deploy del frontend y restart del backend:** el endpoint sigue exigiendo auth y responde 401; el modal anónimo lo trata igual que el cupo agotado (mensaje de autenticación), así que no hay estado roto.
- **401 anónimo:** `call()` hace `clearAuth()` en 401 — sin token es inofensivo — y lanza `unauthorized`, que el modal convierte en el mensaje de autenticación solo cuando no hay sesión; con sesión (token expirado) mantiene el error genérico.
- **Usuario con sesión leyendo un libro compartido:** ve Dicc/IA/Copiar/Compartir (hoy no veía menú); sigue sin poder subrayar (`canAnnotate=false`).
- **Subrayados existentes en modo visitante:** inalcanzables — las anotaciones no se cargan en compartidos, así que la rama `existingId` no ocurre.
- **Cambio de día con el server corriendo:** el Map se limpia en la primera consulta del día nuevo.

## Operación

Cambio de backend: tras `git pull` + build en el server, **Jose debe ejecutar `sudo systemctl restart epubreader`** para activar el endpoint anónimo. El frontend puede desplegarse antes sin ventana rota (ver casos borde).

## Pruebas

- **Unit servidor** (`server/tests/ai_quota.test.js`, vitest): permite 10 consultas de la misma IP, rechaza la 11.ª, otra IP tiene cupo propio, y al cambiar `now` de día el cupo se renueva.
- **Unit cliente** (`client/src/reader/SelectionMenu.test.jsx`, vitest + testing-library): con `canAnnotate=false` no aparecen Subrayar/Nota/Eliminar y sí Dicc/Copiar/Compartir; con `canAnnotate=true` y sin `existingId` aparece Subrayar; `showAI` controla el botón IA.
- **Manual:** móvil sin sesión → menú reducido con IA y aviso bajo el chat; con sesión → menú completo sin aviso; agotar cupo (o probar antes del restart) → mensaje y envío bloqueado.
