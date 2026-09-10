# Pantalla: embudo (`/embudo`)

🟢 Escrita · 10 de septiembre de 2026

Los 10 estados del embudo en columnas, con arrastrar y soltar.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.tsx` | la pantalla: consulta, filtros, movimiento optimista y aviso de rechazo |
| `ColumnaEmbudo.tsx` | una columna = una zona donde se suelta |
| `TarjetaEmbudo.tsx` | una tarjeta: nombre · teléfono · días sin contacto · responsable |
| `FiltrosEmbudo.tsx` | los tres filtros (lanzamiento · responsable · origen) y su función de filtrado |
| `../../lib/embudo.ts` | los 10 estados, el umbral de días, la consulta y `moverOportunidad` |
| `../../../sql/08-vistas-embudo-e-inventario.sql` | la vista `v_embudo_tarjetas` — **hay que ejecutarla en Supabase** |

## Las tres cosas que no se pueden cambiar sin romper una regla

1. **El historial lo escribe la base.** Mover una tarjeta solo hace
   `update oportunidades set estado = …`. `estado_historial` lo llena el disparador
   `t_oportunidad_historial` (**R9**). Si esta pantalla insertara ahí, cada movimiento
   quedaría registrado dos veces.
2. **R5 la hace cumplir la restricción, no la tarjeta.** La tarjeta *avisa* cuando faltan las
   4 respuestas de cualificación, pero no bloquea: quien rechaza el movimiento es
   `calificado_requiere_las_4_respuestas`. Si la tarjeta bloqueara por su cuenta, el día que la
   regla cambie en la base habría dos criterios distintos.
3. **Un `update` que RLS no permite no da error**: devuelve 200 y cero filas. Por eso
   `moverOportunidad` comprueba que volvió una fila y con el estado pedido. Sin eso, la pantalla
   diría «movida» sobre una base que no cambió.

## Decisiones tomadas aquí

- **Solo oportunidades `activa`.** El tablero es la foto de lo que está en juego; ganadas,
  perdidas y pausadas se consultan en la ficha y en Reportes. La cabecera lo dice.
- **Filtrado en el navegador**, no en la consulta: así las opciones de cada filtro salen de lo
  que de verdad hay en el tablero. Si se filtrara en la base, elegir un lanzamiento vaciaría las
  opciones de los otros dos desplegables. Tope de `LIMITE_TARJETAS` filas por carga; si se
  alcanza, la pantalla lo dice en voz alta en vez de fingir que está completa.
- **Además de arrastrar, cada tarjeta tiene un desplegable** con los 10 estados. El arrastrar y
  soltar de HTML5 no existe en una pantalla táctil ni con teclado, y este CRM se usa en el móvil.
- **Movimiento optimista con vuelta atrás.** La tarjeta salta de columna en el acto; si la base
  rechaza, vuelve a su columna y el motivo se queda en pantalla hasta que se cierre a mano.

## 🔵 Sin ratificar por Dirección

- `DIAS_SIN_CONTACTO_ALERTA = 3` (`src/lib/embudo.ts`) — el umbral del rojo. Es una decisión de
  operación, no un plazo comercial, y por eso no vive en `parametros`.
- El uso del token `alerta` (rojo) para el borde de esas tarjetas. Es el segundo uso de un color
  que nació como propuesta en la pantalla Hoy. La prohibición del brief sigue en pie: nada de
  rojo/verde para el estado de pago.

## 🟡 Pendiente de decisión de Walter

`perfiles_leer_propio` sólo deja leer tu propia fila de `perfiles`. Por eso los roles
`administracion`, `contabilidad` y `lectura` ven la tarjeta pero **no el nombre** de quien la
lleva (sale «[sin acceso al nombre]»). `comercial` y `direccion` lo ven completo. Si el equipo
debe verse los nombres entre sí, se arregla con una política nueva en RLS — nunca relajando la
vista.
