# Diseño — Explicar con IA + Leer en voz alta (lector)

Fecha: 2026-05-30

Dos funciones nuevas en el lector de MisLibros:

- **A. Explicar con IA** — un botón en el menú de selección que explica el pasaje
  marcado en palabras simples, vía Groq (modelo open-source).
- **B. Leer en voz alta** — un botón de altavoz en la barra superior que lee desde
  la página actual durante un tiempo dado (por defecto 15 min), avanzando la página
  en sincronía, usando la Web Speech API del navegador.

MeloTTS queda fuera de alcance (fase 2): la arquitectura de B permite cambiar la
fuente de audio más adelante sin rehacer la UX.

---

## A. Explicar con IA

### UX
- Nuevo botón **"IA"** en `SelectionMenu` (junto a "Diccionario"), sobre el texto
  seleccionado. Visible **solo si hay conexión** (`navigator.onLine`).
- Al pulsarlo se abre un **modal** (estilo `WiktionaryModal`) con un spinner mientras
  llega la respuesta, y luego la explicación. Cerrar limpia la selección.

### Cliente
- `api.explainWithAI(text)` → `POST /api/ai/explain` con `{ text }`.
- Nuevo componente `AIExplainModal` (abierto cuando hay un término/explicación en curso),
  reutilizando el patrón y estilos de `WiktionaryModal`.
- El texto se trunca a un máximo razonable antes de enviar (p. ej. 2000 caracteres)
  para acotar tokens.

### Servidor
- Nueva ruta `createAIRouter(db)` montada en `/api/ai`, con `authRequired` y un
  `rateLimit` (p. ej. 20/min por usuario).
- `POST /api/ai/explain`:
  - Valida `text` (string no vacío, recorta a 2000 chars). Si falta → 400.
  - Llama a la API de Groq (Chat Completions) con:
    - modelo: `config.groqModel` (defecto `llama-3.1-8b-instant`).
    - system: "Eres un asistente que explica pasajes de libros en español, de forma
      clara, breve y sencilla. No inventes contexto que no esté en el texto."
    - user: el pasaje.
  - Devuelve `{ explanation }`. Errores del proveedor → 502 con `{ error: 'ai_failed' }`.
- **Secreto**: `GROQ_API_KEY` en el `.env` del servidor; opcional `GROQ_MODEL`.
  Añadir a `config.js` (`groqApiKey`, `groqModel`). Si no hay key configurada, el
  endpoint responde 503 `{ error: 'ai_disabled' }` y el cliente oculta/deshabilita el botón.
- **CSP**: sin cambios. El navegador solo habla con `/api/...` (mismo origen); la
  llamada a Groq es servidor→servidor.

### Errores
- Sin conexión → el botón no se muestra.
- Fallo del proveedor / timeout → el modal muestra "No se pudo consultar la IA."

---

## B. Leer en voz alta (TTS por tiempo)

### UX
- Nuevo botón **altavoz (🔊)** en el header del lector (junto a ☰ índice y ★).
  **Siempre visible**, también offline (la Web Speech API funciona sin internet).
- Al pulsar (si no está leyendo): diálogo pequeño **"¿Cuántos minutos leer?"** con un
  número, **por defecto 15**. Al confirmar, comienza la lectura desde la **página actual**.
- Mientras lee, el botón pasa a **■ Detener**; al pulsarlo se cancela la lectura.
- La lectura también se detiene al **salir del lector** o al cumplirse el tiempo.

### Motor (solo cliente, Web Speech API)
- `window.speechSynthesis` + `SpeechSynthesisUtterance`.
- Selección de voz: la que coincida con el idioma del libro (`bookLang`); si no hay,
  la voz por defecto del sistema. (En Android usa el TTS del sistema.)
- Bucle de lectura:
  1. Extraer el texto de la **página actual** desde la vista de foliate.
  2. Hablar ese texto (una utterance); esperar su evento `end`.
  3. Si el tiempo transcurrido ≥ minutos elegidos → detener.
  4. Si no, `view.next()` para avanzar una página (la página mostrada sigue al audio)
     y repetir. Si se llega al fin del libro, detener.
- El control de tiempo se evalúa **al terminar cada página**, así que la lectura se
  corta en un límite de página cercano a los N minutos (no a mitad de oración).

### Extracción del texto de la página
- Se obtiene el texto visible de la página actual a partir del documento renderizado
  por foliate (el `doc` del evento `load`, ya disponible en `ReaderPage`).
- **Riesgo / fallback**: si aislar exactamente la "página" visible resulta poco fiable
  en algún caso, el fallback es leer el contenido de la **sección/capítulo actual** en
  fragmentos por oración y avanzar la vista periódicamente. La meta es que la página
  mostrada acompañe a la lectura; precisión perfecta página-a-página no es requisito duro.

### Estado
- En `ReaderPage`: estado `reading` (bool) y referencias al temporizador/utterance para
  poder cancelar. Limpieza en el desmontaje del componente (cancelar `speechSynthesis`).

---

## Transversal
- **Gating online**: solo el botón de **IA** depende de `navigator.onLine`. El altavoz
  es siempre visible.
- **Sin nuevas dependencias** en el cliente (Web Speech es nativa). En el servidor, la
  llamada a Groq se hace con `fetch` nativo (Node 18+); no hace falta SDK.
- **OPS.md**: documentar `GROQ_API_KEY` (y `GROQ_MODEL`) como variables del `.env` del
  servidor, y que añadir/cambiarlas exige reiniciar el backend.

## Pruebas
- Servidor: tests de `/api/ai/explain` — 400 sin texto, 503 sin key configurada,
  200 con respuesta simulada (mock del fetch a Groq), 401 sin auth.
- Cliente: verificación manual de ambos botones (selección→IA→modal; altavoz→minutos→
  lectura y avance de página; detener).

## Fuera de alcance (fase 2)
- MeloTTS (voz premium auto-hospedada o API): sustituiría la fuente de audio de B.
- Otros usos de IA (resumen, preguntas libres, traducción).
