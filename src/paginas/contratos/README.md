# Pantalla: contratos

🟢 Escrita.

- `index.tsx` — la lista (`PantallaContratos`), con la columna «Cuotas» que
  delata el contrato al que se le olvidó el calendario, y el diálogo para
  generarlo más tarde.
- `FormularioContrato.tsx` — el alta desde una oportunidad en `05_separacion` o
  posterior. Es el único sitio del CRM donde alguien teclea un precio, y por eso
  exige la constancia de `constanciaDePrecioManual` cuando el precio no viene de
  un parámetro confirmado.
- `CalendarioCuotas.tsx` — el generador de cuotas, compartido por los dos.

Lógica: `src/lib/contratos.ts`. Ni un precio literal en ninguno de los tres.

🟡 `contratos` es la novena sección del menú y `01-documentacion\02-ESPECIFICACION-TECNICA.md`
§4 todavía enumera ocho. Falta actualizar ese documento.
