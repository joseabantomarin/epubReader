# Efecto de transición al pasar página

**Fecha:** 2026-05-31
**Estado:** Aprobado — pendiente de implementación

## Objetivo

Añadir una animación al avanzar/retroceder de página en el lector, configurable
desde Ajustes y persistida en `localStorage`. Dos modos:

- **Deslizar con sombra** (`slide`) — por defecto.
- **Desvanecido** (`fade`).

Hoy el cambio de página es instantáneo (foliate-js nunca recibe el atributo
`animated`).

## Contexto técnico

- El lector usa **foliate-js** (copia vendida en `client/public/foliate-js/`),
  que renderiza el capítulo en un único iframe con columnas CSS. "Pasar página"
  es un *scroll* horizontal entre columnas.
- Toda la navegación (botones laterales, teclado, botones de volumen en Android,
  swipe y snap táctil) converge en el evento `relocate` y, dentro de foliate, en
  el método `#scrollTo` del paginador. foliate solo anima el scroll cuando el
  renderer tiene el atributo `animated` (~300ms, `easeOutQuad`).
- Decisión: implementar **sin modificar foliate-js**, para no tener que
  sincronizar las tres copias (`public/` → `dist/` por `vite build`, y la copia
  de Android). Se usa el atributo `animated` (para slide) y el evento `relocate`
  (para fade), ambos ya expuestos.

## Diseño

### 1. Ajuste nuevo — `client/src/lib/readerSettings.js`

Añadir a `DEFAULTS`:

```js
pageTransition: 'slide',   // 'slide' (deslizar con sombra) | 'fade' (desvanecido)
```

La persistencia ya está cubierta por `loadSettings`/`saveSettings` (localStorage,
clave `epubreader.readerSettings`).

### 2. UI de Ajustes — `client/src/library/SettingsModal.jsx`

Nueva sección **"Animación al pasar página"** con dos chips, replicando el patrón
existente de "Mano dominante":

- **Deslizar** → `pageTransition: 'slide'`
- **Desvanecido** → `pageTransition: 'fade'`

Usa `update({ pageTransition: ... })`, que guarda al instante. El `reset` ya
restaura desde `DEFAULTS`, así que vuelve a `slide` automáticamente.

### 3. Aplicación en el lector — `client/src/reader/ReaderPage.jsx`

Leer `pageTransition` desde `loadSettings()` en la inicialización (junto al resto
de ajustes del lector, ya se llama a `loadSettings()` en `start()`).

- **`slide`**: tras `view.open(file)`, activar
  `view.renderer?.setAttribute('animated', '')`. foliate anima entonces el scroll
  de columnas en todas las vías de navegación. Marcar el viewport con
  `data-transition="slide"` para la sombra de borde (CSS).
- **`fade`**: no activar `animated` (cambio instantáneo). Marcar el viewport con
  `data-transition="fade"`. En el handler de `relocate`, ejecutar un fade-in de
  opacidad sobre el elemento `foliate-view`: poner `opacity = 0` y, en el
  siguiente `requestAnimationFrame`, transicionar a `opacity = 1` (~180ms).
  - Activar el fade **solo después de la carga inicial**, reutilizando un flag de
    gracia equivalente al `savingEnabled` ya presente, para no provocar un
    parpadeo al abrir el libro / restaurar posición.
  - `relocate` se dispara de forma síncrona tras el cambio de scroll (antes del
    siguiente paint), por lo que fijar `opacity = 0` ahí oculta el contenido nuevo
    antes de mostrarlo. Si en pruebas se observara un parpadeo de un frame, se
    refinará (p. ej. doble `requestAnimationFrame`).

### 4. CSS — `client/src/reader/reader.module.css`

- `.viewport[data-transition="slide"]`: sombra sutil en los bordes internos /
  gutter del viewport, para que el contenido al deslizarse parezca pasar bajo el
  borde del libro (la "sombra").
- Modo fade: clase/atributo en el `foliate-view` con `transition: opacity 180ms ease`
  para que el fade-in del paso 3 sea suave.

## Comportamiento y límites

- El modo seleccionado se aplica **al abrir el libro**, igual que fuente, tema y
  mano dominante hoy (se leen una vez en la init del lector). No cambia en caliente
  mientras se lee. Aceptado por el usuario.
- **PDFs**: usan el renderer fixed-layout, no el paginador. El **desvanecido**
  funciona igual (vía `relocate`); el **deslizar** animado puede no aplicar y
  quedaría instantáneo. Caso menor aceptado.

## Fuera de alcance (YAGNI)

- Curl de esquina 3D y peel difuminado (descartados por coste sobre el modelo de
  iframe de foliate).
- Aplicar el cambio de transición en caliente sin reabrir el libro.
- Animación de slide para PDFs.

## Criterios de aceptación

1. En Ajustes aparece "Animación al pasar página" con dos opciones; **Deslizar**
   es la activa por defecto.
2. La elección se guarda en localStorage y persiste entre sesiones.
3. Con **Deslizar**, avanzar/retroceder (botón, teclado, volumen, swipe) muestra
   un deslizamiento animado con sombra de borde.
4. Con **Desvanecido**, el cambio de página hace un fade suave, sin parpadeo al
   abrir el libro.
5. No se modifica ningún archivo de `client/public/foliate-js/`.
