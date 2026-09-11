# Pantalla: separaciones

🟢 Escrita · 11 de septiembre de 2026

La pantalla que toca dinero recibido y dos plazos legales. Es la más delicada del CRM y por eso
casi nada de lo que decide se decide aquí.

## Qué hay en esta carpeta

| Archivo | Qué es |
|---|---|
| `index.tsx` | **Bandeja** — `v_separaciones_vigilancia`, ordenada por el reloj que vence antes |
| `FormularioSeparacion.tsx` | **Alta** del S/500 · `/separaciones/nueva` |
| `FichaSeparacion.tsx` | **Ficha** de una separación: verificar y emitir constancia · `/separaciones/:id` |
| `Constancia.tsx` | **Vista imprimible** en HTML · `/separaciones/:id/constancia` |
| `RelojesSeparacion.tsx` | Las piezas de los dos relojes, compartidas por las tres pantallas |

La lógica de datos vive en `src/lib/separaciones.ts` y `src/lib/parametros.ts`, no aquí.

## Las cuatro cosas que esta pantalla NO decide

1. **Cuánto es una separación.** Se propone desde `parametros('separacion_monto')`, hoy en
   🔴 rojo: se muestra `[PENDIENTE — ver 00-fuente-de-verdad]` y la casilla se queda vacía. Lo
   que se teclea es el monto **del voucher**, que es un hecho, no una condición comercial.
2. **Cuándo vence el derecho de devolución.** Lo calcula `fn_calcular_limite_devolucion` en la
   base a partir de la fecha de depósito efectivo. El formulario no manda esa fecha límite.
3. **Quién verifica.** `fn_verificacion_solo_direccion` (R2). El botón solo se le enseña a
   `direccion` por comodidad; si la base rechaza la operación, su mensaje —que cita el Acta
   03-O02— se muestra **literal**.
4. **Si se puede emitir la constancia.** `puede_emitir_constancia(id)` (R3). Se le pregunta en
   la ficha y **otra vez** en la propia constancia, porque a esa ruta se puede llegar
   escribiéndola. Sin un sí claro, no se dibuja el documento.

## Los dos relojes (R4)

Son **dos campos distintos** y nunca se calculan uno del otro:

- **Reloj 1 · Derecho de devolución** — desde la fecha de depósito efectivo. Lo escribe la base.
- **Reloj 2 · Vigencia del precio post-evento** — campo independiente, lo escribe una persona.

En pantalla salen siempre en **dos tarjetas** (formulario y ficha) o **dos columnas** (bandeja),
cada una con su número y con quién escribe su fecha, más el aviso visible *«Son dos plazos
distintos. No se calculan uno del otro.»*

La única función que mira los dos a la vez es `relojMasCercano`, y sirve **solo para ordenar la
bandeja**: su resultado no se enseña en ningún sitio.

Los días restantes los resta `v_separaciones_vigilancia` contra la fecha del servidor. No se
recalculan en el navegador, para que el número de la bandeja y el de la ficha sean el mismo.

## La constancia

Es HTML imprimible, no PDF, y a propósito: un PDF con huecos pendientes parece definitivo.

- Las condiciones son el marcador **`[PENDIENTE: cláusulas aprobadas]`**. No se redacta ninguna.
- Razón social, RUC y naturaleza jurídica del producto vienen de `parametros` y hoy los tres
  están en 🔴 rojo, así que se imprimen como pendientes.
- El texto de la naturaleza jurídica se imprime **literal**: lo que se transfiere son acciones y
  derechos sobre el inmueble matriz, no propiedad independizada, y su parámetro dice
  expresamente que no se parafrasee.
- La ruta va **fuera del cascarón**: lo que se imprime es la hoja, no el CRM.

## Antes de usarla con datos reales

Hay que tener ejecutado en Supabase `../../../sql/09-separaciones-storage.sql` (el bucket privado
`comprobantes` y sus políticas). Si falta, la subida del voucher lo dice con ese mismo mensaje.

Y la comprobación obligatoria del encargo: **entrar con un usuario de rol `comercial` y confirmar
que no puede verificar.** El botón no aparece; si además se fuerza la llamada, la base la rechaza.
