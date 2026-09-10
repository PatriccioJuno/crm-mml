# Pantalla: inventario (`/inventario`)

🟢 Escrita · 10 de septiembre de 2026

La tabla de unidades con sus dos semáforos, y la defensa visible contra la doble asignación.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.tsx` | la pantalla: aviso permanente, leyenda, tabla y selección |
| `FormularioUnidad.tsx` | alta y edición — solo se dibuja para `direccion` y `administracion` |
| `../../lib/inventario.ts` | los dos semáforos, la consulta, los motivos del bloqueo y el guardado |
| `../../../sql/08-vistas-embudo-e-inventario.sql` | la vista `v_unidades_tablero` y la restricción `verde_exige_plano` — **hay que ejecutarlas en Supabase** |

## Quién decide qué se puede ofrecer

**No esta pantalla.** Lo decide `v_unidades_ofrecibles` (`03-vistas.sql` §7), que exige las dos
condiciones del Acta 03-O02 —estado comercial `disponible` **y** dato `verde` contra plano— más
que no haya asignación activa ni separación viva. La pantalla lee esa respuesta en la columna
`ofrecible` y la obedece: fila en gris y casilla desactivada. **No hay ninguna copia de esa regla
en el código de la pantalla.**

Lo único que añade la interfaz es la **explicación** del bloqueo, que sale de las banderas de
`v_unidades_tablero` y se muestra de dos formas: visible en la fila y al pasar el cursor. Si la
explicación y la vista discreparan alguna vez, manda la vista: la fila se apaga igual y la
pantalla dice que no sabe por qué.

### Por qué `v_unidades_tablero` **no** lleva `security_invoker`

Es lo contrario de lo que se hizo con las vistas de Hoy, y es deliberado. `oport_leer` esconde a
un comercial las oportunidades de otro comercial. Si esta vista evaluara RLS con el usuario que
consulta, la asignación activa de un compañero daría *falso*, la unidad aparecería libre y la
pantalla la ofrecería: exactamente la doble asignación que **R1** existe para evitar. La vista
devuelve **booleanos** — dice «está tomada», nunca por quién.

## El precio no se escribe: se apunta

El formulario **no tiene casilla de importe**. El precio de una unidad es `precio_parametro`, un
puntero a una fila de `parametros` que cita su archivo de `00-fuente-de-verdad` y lleva semáforo.
Por eso el campo es un desplegable. Así esta pantalla no puede crear el noveno precio en
conflicto.

## La restricción nueva: `verde_exige_plano`

Declarar una unidad 🟢 «verificada contra plano» sin decir **contra qué plano** es una afirmación
que nadie puede comprobar — el hueco rellenado que produjo las 4 cifras en conflicto. Va como
restricción de base de datos (`08-…sql` §3) y no como validación de formulario, porque un
formulario se esquiva (un CSV, el panel de Supabase) y una restricción no. El formulario también
lo comprueba, pero solo para ahorrar el viaje.

🟡 **Por validar con Dirección.** Se quita en una línea si se decide otra cosa:
`alter table unidades drop constraint verde_exige_plano;`

## Los dos semáforos

| Columna | Qué es |
|---|---|
| **Estado del dato** | literal: `unidades.estado_dato` **es** el enum `semaforo`. Aquí no se interpreta nada |
| **Estado comercial** | 🔵 **propuesta**: `estado_unidad` no tiene color en la base. El símbolo responde a «¿se puede ofrecer hoy?» — 🟢 libre · 🟡 bloqueo temporal · ⚫ ya colocada · 🔴 fuera de venta — y **nunca va solo**: al lado va siempre la palabra exacta del enum |

La leyenda está impresa en la pantalla, no solo aquí.

## Lo que todavía no hace

Seleccionar una unidad ofrecible marca la selección y lo dice, pero **asignarla a una
oportunidad** se hará desde la ficha de la persona, que sigue 🔴 pendiente. No hay ningún botón
que aparente funcionar sin hacerlo.
