# Pantalla: cobranza

🟢 Escrita.

- `index.tsx` — los dos KPI (por moneda, nunca sumados), el buscador y la tabla
  agrupada por tramo de `v_cobranza`.
- `DialogoPago.tsx` — registrar un pago, parcial o total, con comprobante.
- `DialogoGestion.tsx` — copiar el mensaje de cobranza y registrar la gestión
  como interacción de canal `llamada` o `whatsapp`.

Lógica: `src/lib/cobranza.ts`.

Pendientes anotados, no disimulados:

- 🔴 Falta la referencia visual `03-diseno\04-cobranza.png`: nunca se exportó.
  Lo seguido es el §3, pantalla 4, del `BRIEF-CLAUDE-DESIGN.md`.
- 🟡 La vista da cuatro tramos y el brief pide seis. No se parten aquí.
- 🟡 `v_cobranza` calcula `pagado` sin mirar la moneda del pago. Se evita por el
  único lado que controla el cliente —rechazar un pago en otra moneda—;
  arreglarlo de verdad es una migración.
- 🟡 El estado de la cuota lo actualiza el cliente tras registrar el pago, no un
  disparador. Ver el comentario de `registrarPago`.
