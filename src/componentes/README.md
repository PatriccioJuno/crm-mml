# Componentes reutilizables

- `ui/` — componentes de shadcn/ui. **No se escriben a mano**: se traen con
  `npx shadcn add <componente>` y luego se ajustan si hace falta.
  Botones, tarjetas, tablas, pestañas, badges, diálogos y barra de progreso
  salen de aquí, no de CSS propio.
- `layout/` — cascarón, barra lateral y cabeceras.

Los indicadores (KPI), barras de progreso de datos y gráficos de **Reportes** y
**Cobranza** usan `@tremor/react`, ya tematizado en `tailwind.config.js`.

Iconografía: **solo `lucide-react`** (estilo línea). No mezclar con otro set.
