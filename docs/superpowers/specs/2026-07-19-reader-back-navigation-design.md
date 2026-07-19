# Volver a la posición de lectura tras un salto — Diseño

**Fecha:** 2026-07-19
**Objetivo:** Al saltar de posición dentro de un libro (enlace interno, índice de capítulos o "Ir al pasaje" de una anotación), el lector debe poder regresar a la posición de lectura anterior mediante: el botón/gesto atrás de Android, el botón atrás del navegador, un chip flotante "Volver a la lectura" y la flecha del encabezado.

## Alcance

- Deshacer **cualquier salto de posición**: enlaces internos del texto, índice de capítulos y saltos a anotaciones.
- Saltos encadenados se deshacen **paso a paso** (pila).
- Cuatro disparadores: gesto/botón atrás de Android, atrás del navegador, chip flotante, flecha del encabezado.
- Extra de bajo costo: el botón **adelante** del navegador rehace el salto.

Fuera de alcance (YAGNI): mostrar notas al pie en un popup sin saltar, persistir la pila de saltos entre sesiones, historial visual de saltos.

## Arquitectura

**Fuente de verdad: el historial interno de foliate-js** (`view.history`), que ya existe y funciona:

- Cada `goTo` (enlace, índice, anotación) hace `pushState` y dispara el evento `index-change`.
- En cada vuelta de página, `replaceState` actualiza la entrada actual con la posición vigente, así que `back()` regresa a donde el usuario estaba leyendo, no a donde aterrizó la entrada.
- `back()`/`forward()`/`canGoBack` ya implementan la pila con deduplicación.

**Espejo en el historial del navegador** vía react-router: cada salto empuja una entrada de la misma ruta `/read/:id` con `state.jumpDepth` (contador de profundidad, empezando en 0). Los cuatro disparadores convergen en **un solo camino de código**:

```
disparador (Android / navegador / chip / flecha)
        → navigate(-1)  (o botón atrás del navegador, que es lo mismo)
        → el router retrocede a la entrada con jumpDepth anterior
        → efecto en ReaderPage detecta que la profundidad bajó
        → view.history.back()  → foliate restaura la posición
```

Si la profundidad sube (botón adelante del navegador), el mismo efecto llama `view.history.forward()`.

## Componentes

### 1. `client/src/lib/backActions.js` (nuevo, ~15 líneas)

Registro mínimo de handlers para el botón atrás nativo:

- `registerBackHandler(fn)` → añade `fn` y devuelve una función para desregistrar.
- `tryBackHandlers()` → recorre los handlers; devuelve `true` si alguno manejó el evento.

### 2. `client/src/lib/useNativeBack.js` (modificar)

Antes del comportamiento por defecto, consulta `tryBackHandlers()`. Si un handler devuelve `true`, no hace nada más. Si no: comportamiento actual (`/read/:id` → biblioteca; `/` → minimizar app).

### 3. `ReaderPage.jsx` — sincronización de historiales

- Estado `jumpDepth` (0 = sin saltos pendientes) + ref espejo para los listeners.
- **Listener `index-change`** sobre `view.history`, conectado **después** de la restauración de posición inicial (mismo patrón que `savingEnabled`) y limpiado vía el arreglo `cleanups` existente. Reglas:
  - Si `canGoBack` es falso → profundidad 0 (cubre la navegación inicial, que también hace push).
  - Si el cambio lo inició nuestro propio `back()`/`forward()` (flag en un ref) → solo sincronizar el contador, sin tocar el router.
  - En cualquier otro caso es un salto nuevo → profundidad +1 y `navigate(ruta actual, { state: { jumpDepth } })`.
- **Efecto sobre `location.state`**: compara `state.jumpDepth ?? 0` con la ref. Si bajó → `view.history.back()` (con el flag activado); si subió → `view.history.forward()`. Si es igual, no hace nada (ocurre tras nuestro propio push).
- **Handler nativo registrado** con `registerBackHandler`: si `jumpDepth > 0` → `navigate(-1)` y devuelve `true`; si no, devuelve `false`.

### 4. Chip flotante "Volver a la lectura"

- Visible mientras `jumpDepth > 0` y no haya sido descartado.
- Flotante discreto sobre el pie de página, centrado; estilo consistente con el aviso `offHint` existente.
- Tocar el chip → `navigate(-1)`. Botón X → lo descarta (el usuario decide quedarse); reaparece con un salto nuevo.
- Sin temporizadores: comportamiento predecible.

### 5. Flecha del encabezado

- Con `jumpDepth > 0` → `navigate(-1)`, aria-label "Volver a la lectura".
- Con `jumpDepth === 0` → `goBack()` actual (guarda progreso y navega a la biblioteca).

## Casos borde

- **Saltos encadenados:** se deshacen uno a uno; la pila de foliate ya lo resuelve.
- **Clic repetido en el mismo destino:** foliate deduplica el `pushState` (no dispara `index-change`), así que el router no recibe entradas duplicadas.
- **Restauración inicial / parámetro `?cfi=`:** son la primera navegación (`canGoBack` falso) → profundidad 0. Atrás desde ahí sale del libro, que es lo esperado (p. ej. regresa a la página de anotaciones).
- **Salir del libro con saltos pendientes:** quedan entradas viejas de `/read/:id` en el historial del navegador. Comportamiento normal de una SPA: atrás desde la biblioteca reabre el libro en el progreso guardado. Aceptable.
- **Fallo de `view.history.back()`:** `back()` es no-op si `canGoBack` es falso; además, en cada `index-change` se fuerza profundidad 0 cuando `canGoBack` es falso, lo que corrige la desincronización que importa (si queda o no salto pendiente).
- **Libros compartidos:** mismo comportamiento (el historial de saltos no depende de la sesión).
- **PDFs:** si no generan saltos, el chip nunca aparece y nada cambia.
- **StrictMode (montaje doble en desarrollo):** listeners dentro del efecto principal con su limpieza en `cleanups`; el handler nativo se desregistra en la limpieza de su propio efecto.

## Pruebas

El cliente no tiene infraestructura de tests unitarios; verificación manual:

**Web escritorio:**
1. Clic en enlace interno → volver con: atrás del navegador, chip, flecha. Cada uno restaura la posición previa.
2. Dos saltos encadenados → atrás dos veces deshace en orden inverso.
3. Tras volver, el botón adelante del navegador rehace el salto.
4. Salto desde el índice de capítulos y desde "Ir al pasaje" de una anotación → atrás regresa.
5. Descartar el chip con la X → desaparece; un salto nuevo lo reaparece.
6. Sin salto pendiente, la flecha sale a la biblioteca y guarda el progreso (comportamiento actual intacto).

**Android (build nativo):**
7. Gesto atrás con salto pendiente → regresa a la posición; sin salto → sale a la biblioteca.
8. Volumen/gestos de página siguen funcionando tras un salto y su regreso.

**Compartido:**
9. Libro compartido: enlace → atrás funciona igual.
