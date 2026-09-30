# Componentes del seguimiento comercial (`src/componentes/crm/`)

**Estado:** 🔵 PROPUESTA · 29/09/2026 · nacen con `sql/13-seguimiento-comercial.sql` (SPEC §6.B)

Piezas que comparten varias pantallas del seguimiento (Personas, Ficha, Modo
llamadas, Registro rápido, Hoy). Viven aquí para que la misma cosa se vea y se
comporte igual en todas: un chip, una temperatura o un botón de WhatsApp no se
redibujan en cada pantalla.

Ninguno contiene una cifra del negocio ni lógica de negocio: la temperatura la
calcula la base (`fn_temperatura`), el equipo lo da `fn_equipo`, los enlaces los
arma `src/lib/whatsapp.ts`.

| Componente | Para qué | Notas |
|---|---|---|
| `GrupoChips` | Elegir UNA opción de un toque (perfil, resultado, próximo paso) | `role="radiogroup"`; `permitirVacio` desmarca al tocar la elegida; `atajos` muestra 1–9 en escritorio |
| `GrupoChipsMultiple` | Varias a la vez (objeciones) | botones con `aria-pressed`; devuelve los valores en el orden de `opciones` |
| `ChipsSiNo` | Sí / No / sin responder | `null` ≠ «no» (R5 depende de eso); pasa siempre `etiqueta` con la pregunta |
| `InsigniaTemperatura` | Caliente · tibio · frío · nuevo · … | icono + peso + texto, sin colores de semáforo; `motivo` va en `title` y para lector de pantalla |
| `BotonesContacto` | WhatsApp · Llamar · Copiar · Perfil | `whatsapp://` (no `wa.me`); «Copiar» siempre como salida; no registra nada por sí solo |
| `SelectorResponsable` | Quién lleva una oportunidad | `useQuery(['equipo'], cargarEquipo)`; `compacto` para filtros |
| `AvisoPendiente` | «Esto depende de un parámetro 🔴/🔵» | escribe qué falta y dónde se carga |

## Reglas que estos componentes ya cumplen (y que no hay que romper al usarlos)

- **Ámbar solo sobre azul.** `InsigniaTemperatura sobreAzul` es el único que lo
  usa (el «Caliente» en la cabecera de la ficha). Sobre claro, nunca.
- **44 px de toque en el móvil.** Chips `min-h-11`; botones de contacto
  `h-11 min-w-11`. En escritorio (`sm:`) bajan.
- **Foco visible.** Anillo azul (`ring-ring`) en todo lo que se pulsa; en los
  botones sobre azul, anillo cal.
- **Estado = texto + icono de línea + peso.** Lo elegido lleva relleno azul,
  Bold y un check; nunca solo un color.
- **Un grupo de chips = un punto de Tab.** Las flechas mueven el foco sin
  elegir (se elige con Espacio/Enter), porque el perfil guarda en cada elección.

## Uso rápido

```tsx
<GrupoChips
  etiqueta="¿Contado o financiado?"
  opciones={FORMAS_PAGO}
  valor={perfil.formaPago as FormaPago | null}
  alCambiar={(v) => guardar({ forma_pago: v })}
  permitirVacio
/>

<ChipsSiNo etiqueta="¿Decide solo?" valor={perfil.decideSolo} alCambiar={(v) => guardar({ decide_solo: v })} />

<InsigniaTemperatura temperatura={fila.temperatura} motivo={fila.temperaturaMotivo} compacta />

<BotonesContacto telefonoE164={fila.telefonoE164} usuarioRed={fila.usuarioRed} redSocial={fila.redSocial} tamano="sm" />

<SelectorResponsable valor={responsable} alCambiar={setResponsable} permitirVacio textoVacio="Sin dueño" />

<AvisoPendiente>Falta cargar en Parámetros: ubicación de la obra (visita_mapa_url).</AvisoPendiente>
```

`BotonesContacto` detiene la propagación del clic: se puede poner dentro de una
fila que entera enlaza a la ficha sin que «Llamar» abra además la ficha. Aun así,
no lo metas DENTRO de un `<a>` (enlaces anidados son HTML inválido): pon el
enlace de la fila y los botones como hermanos.
