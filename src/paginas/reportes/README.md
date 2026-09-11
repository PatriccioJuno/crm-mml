# Pantalla: reportes

🟢 Escrita.

- `index.tsx` — el orden de las cinco secciones.
- `CalidadDelDato.tsx` — arriba del todo (`v_calidad_del_dato`).
- `Embudo.tsx` — las 10 etapas y el desglose por lanzamiento.
- `Conversiones.tsx` — las seis tasas de `v_conversion`, con su fórmula en el
  tooltip, y las tres de §4 que ninguna vista calcula.
- `Campanas.tsx` — costo por lead y por contrato, un bloque por moneda.
- `InsumosSemanales.tsx` — la materia prima de las partes 1, 2 y 3 del reporte
  de 7 partes.

Lógica: `src/lib/reportes.ts`.

Regla de esta pantalla: **ni una división, ni un porcentaje, ni una media se
calculan aquí.** Todo viene de una vista de `02-codigo\sql\03-vistas.sql`. Lo
que ninguna vista calcula se enseña como hueco con su motivo.
