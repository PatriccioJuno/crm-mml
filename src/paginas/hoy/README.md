# Pantalla: hoy (`/hoy`)

🟢 Escrita · 10 de septiembre de 2026 · ampliada en la entrega 13 (30 de septiembre de 2026)

La pantalla de inicio: lo más urgente arriba, cada fila con sus acciones al lado.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.tsx` | la pantalla: llamadas a la acción de la franja azul y los bloques en orden de urgencia |
| `BloqueHoy.tsx` | el contenedor común de cada bloque (título, conteo, carga, error, vacío, tope) y `FilaHoy` |
| `AccionesFila.tsx` | interacción · tarea · ficha de cada fila (nada a más de dos clics) |
| `../../lib/hoy.ts` | las consultas, `LIMITE_HOY`, `ventanaVisitasHoy`, `contarLeadsNuevos` |

## El orden de los bloques

0. *(solo Dirección)* separaciones esperando verificación — R2/R3.
1. separaciones que vencen en `DIAS_VIGILANCIA_SEPARACION` días o menos — los dos relojes por
   separado (R4).
2. tus tareas vencidas.
3. oportunidades sin siguiente paso — incumplimientos vivos de R6.
4. **visitas de hoy y mañana** (entrega 13) — `cargarVisitasProximas` desde hace 2 horas hasta el
   final de mañana; fila = hora · nombre · tipo · estado, con contacto y ficha. Confirmar, avisar
   y cerrar la visita se hace en la ficha (`SeccionVisitas`), no aquí.
5. tus tareas de hoy.

## Entrega 13 (30/09/2026)

- **Franja azul, dos llamadas a la acción** (solo `direccion`, `comercial`, `administracion`):
  «N leads nuevos sin contactar → Modo llamadas» (`contarCartera` con `soloNuevos`; el comercial
  cuenta los suyos, el resto todos) → `/cola?vista=nuevos`, y «Bandeja web: N esperando»
  (`fn_bandeja`, misma consulta `['bandeja']` que Personas) → `/personas?tab=bandeja`. Mientras
  cargan o si fallan, el botón no muestra número: un cero falso es peor que ninguno.
- **Filas de tareas: primero el nombre** de la persona; el título y el vencimiento van debajo.
- **Tope a la vista.** Cada bloque recibe `limite`; si la consulta devuelve justo ese número, el
  conteo pasa a «50+» y el bloque avisa de que puede haber más.
- La ficha se abre con `?o=` para caer en la oportunidad de la fila.
- `AccionesFila` usa `aEntradaLocal` (`src/lib/fechas.ts`) en vez de su conversión en línea.

## 🟡 Por validar

- `LIMITE_VISITAS_PROXIMAS` (`src/lib/hoy.ts`) es una copia de `LIMITE_PROXIMAS` de
  `src/lib/visitas.ts`, que no se exporta. Si cambia allí, el aviso de tope deja de saltar a
  tiempo. Lo correcto es exportarlo desde `visitas.ts` y borrar la copia.

## 🔵 Sin ratificar por Dirección

- `DIAS_VIGILANCIA_SEPARACION = 3` — ventana de vigilancia, decisión de operación (no vive en
  `parametros` porque no es un plazo comercial).
