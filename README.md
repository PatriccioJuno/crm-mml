# CRM Mercado Media Luna

Aplicación web de una sola página. CRM operativo de **SCP Inmobiliaria** para el proyecto
**Mercado Media Luna (MML)**.

**Estado: 🟡 en construcción · 30/09/2026.** Las **10 secciones del menú están escritas** — Hoy,
Personas, Registro rápido, Embudo, Inventario, Separaciones, Contratos, Cobranza, Reportes y
Parámetros —, más la **ficha de persona** (`/personas/:personaId`) y el **Modo llamadas**
(`/cola`). La entrega 13 (seguimiento comercial: cartera, temperatura, fríos, visitas, documentos
y bandeja web) está escrita y pasa `tsc`, pero **no se ha probado en un navegador** y depende de
`sql/13` y `sql/14`, que siguen 🟡 por aplicar (ver *Base de datos*).

> **Antes de abrir cualquier pantalla** hay que tener aplicadas en Supabase, por orden, las
> migraciones de `sql/` (tabla de abajo). Sin sus vistas las pantallas no tienen de dónde leer, y
> lo dicen con un mensaje que nombra el archivo que falta en lugar de salir vacías.

Las reglas del proyecto están en [`../../CLAUDE.md`](../../CLAUDE.md) y mandan sobre este
archivo.

---

## Arrancar

```bash
npm install
cp .env.example .env.local   # y rellenar los dos valores
npm run dev                  # http://localhost:5173
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run build` | comprueba tipos (`tsc -b`) y compila a `dist/` |
| `npm run preview` | sirve `dist/` para revisarlo |
| `npm run tipos` | regenera `src/lib/tipos.ts` desde la base (ver abajo) |

---

## Tipos generados

```bash
npx supabase login     # una sola vez por máquina; abre el navegador
npm run tipos
```

**Dónde está el `project-id`:** en el panel de Supabase, en *Project Settings → General →
Reference ID* — es también el subdominio de la URL del proyecto
(`https://<project-id>.supabase.co`) y de la del panel
(`https://supabase.com/dashboard/project/<project-id>`).

🔴 **Todavía sin ejecutar (30/09/2026):** `npm run tipos` falla con
`LegacyPlatformAuthRequiredError` mientras no se haya hecho `supabase login`. Hasta entonces
`src/lib/tipos.ts` sigue vacío a propósito y el cliente queda sin tipar por esquema.

Mientras tanto, **toda fila que llega de la base es `unknown`** y pasa por un lector de frontera
(`src/lib/lectura.ts`: `texto`, `entero`, `booleano`, `monto`, `leerLote`) que la comprueba y la
descarta —contándola— si no cumple. Eso incluye todo lo nuevo de la entrega 13 (`v_cartera`,
`visitas`, `documentos`, `oportunidad_perfil`, `fn_bandeja`…). Cuando se generen los tipos, hay
que regenerarlos **después** de aplicar `sql/13` y `sql/14`, o saldrán sin esas tablas.

---

## Estructura

```
src/
  lib/supabase.ts        cliente único de Supabase (solo clave anon)
  lib/tipos.ts           tipos GENERADOS desde la base — vacío a propósito
  lib/fechas.ts          formateo en español, "vence en N días", datetime-local ⇄ ISO
  lib/lectura.ts         lectores de frontera: lo que llega de la base se comprueba
  lib/acciones.ts        ResultadoAccion<T> y llamarRpc: cómo vuelve cada escritura
  lib/embudo.ts          los 10 estados, el umbral de días y mover una oportunidad
  lib/cartera.ts         v_cartera: temperatura, fríos, descartes, conteos (entrega 13)
  lib/contacto.ts        registrar un contacto y la cadencia de seguimiento (entrega 13)
  lib/perfil.ts          perfil comercial del prospecto y cualificación R5 (entrega 13)
  lib/visitas.ts         agendar / confirmar / cerrar visitas y sus avisos (entrega 13)
  lib/aviso-visita.ts    el texto del aviso de visita (copiado tal cual en la Edge Function)
  lib/plantillas.ts      mensajes de WhatsApp sin promesas prohibidas (entrega 13)
  lib/whatsapp.ts        enlace whatsapp:// (sin wa.me) y copiar como respaldo
  lib/documentos.ts      checklist por estado y bucket privado `documentos` (entrega 13)
  lib/lote.ts            registrar prospectos: uno a uno, la lista del live o el mensaje de la web
  lib/hoy.ts             bloques de Hoy, topes y la llamada a «Modo llamadas»
  lib/inventario.ts      los dos semáforos, y por qué una unidad no se puede ofrecer
  lib/importar-inventario.ts  carga inicial: plano vigente + inventario gráfico (sql/14)
  lib/parametros.ts      el único sitio donde puede vivir una cifra; PENDIENTE si está en rojo
  lib/separaciones.ts    el S/500, los dos relojes como campos distintos (R4) y el voucher
  lib/utils.ts           cn() para shadcn/ui
  auth/ContextoSesion    usuario + perfil + rol, y entrar()/salir()
  auth/RutaProtegida     envoltorio de cada ruta
  auth/secciones.ts      qué secciones ve cada rol (copiado de RLS) y su orden en el menú
  auth/tipos-sesion.ts   contrato mínimo de `perfiles` + lector en runtime
  componentes/ui/        shadcn/ui — no escribir a mano, traer con `npx shadcn add`
  componentes/crm/       piezas del CRM: InsigniaTemperatura, BotonesContacto, GrupoChips…
  componentes/marca/     CabeceraPantalla y superficies azules
  componentes/layout/    cascarón, barra lateral
  paginas/entrar/        pantalla de inicio de sesión
  paginas/<pantalla>/    una carpeta por pantalla, cada una con su README
  hooks/                 hooks de datos (TanStack Query)
  rutas.tsx              mapa de rutas
supabase/functions/aviso-visita/   Edge Function del correo de visita (inerte sin secretos)
sql/                     migraciones, en orden (ver Base de datos)
pruebas/                 baterías de reglas: reglas.sql, reglas-13.sql, COMO-PROBAR.md
```

### Pantallas

Orden del menú (`src/auth/secciones.ts`): Hoy · Personas · Registro rápido · Embudo · Inventario ·
Separaciones · Contratos · Cobranza · Reportes · Parámetros.

| Ruta | Pantalla | Quién la ve |
|---|---|---|
| `/hoy` | `PantallaHoy` — urgencias, visitas de hoy y mañana, «N leads nuevos → Modo llamadas», bandeja web | los cinco roles |
| `/personas` | `PantallaPersonas` — Cartera · Fríos · Descartados · Bandeja web (`?tab=`) | los cinco roles |
| `/personas/:personaId` | `FichaPersona` — contacto, perfil, visitas, documentos, actividad (`?o=` elige la oportunidad) | filtro de `personas` |
| `/registro-rapido` | `PantallaRegistroRapido` — uno a uno · pegar lista · mensaje de la web | `direccion`, `comercial`, `administracion` |
| `/cola` | `PantallaCola` — Modo llamadas (`?vista=nuevos \| pendientes \| seleccion \| campana`) | filtro de `registro-rapido` |
| `/embudo` | `PantallaEmbudo` — los 10 estados, con temperatura y enlace a la ficha | los cinco roles |
| `/inventario` · `/separaciones` · `/contratos` · `/cobranza` · `/reportes` · `/parametros` | ver el README de cada carpeta | ver `secciones.ts` |

---

## Base de datos

Las migraciones viven en `sql/` y se ejecutan **por orden**. Cada una anota su fila en
`migraciones_aplicadas` (desde `10-migraciones.sql`).

| Archivo | Qué añade | Estado |
|---|---|---|
| `01` … `12` | esquema, RLS, vistas, parámetros, registro rápido, Hoy, embudo e inventario, storage de comprobantes, migraciones, privilegios, captación | aplicadas en el proyecto (SPEC, 29/09/2026) |
| `13-seguimiento-comercial.sql` | `v_cartera`, temperatura (`fn_temperatura`), fríos y descartes, perfil comercial, visitas y sus avisos, documentos (+ bucket privado `documentos`), bandeja web (`fn_bandeja`), umbrales 🔵 en `parametros` | 🟡 **por aplicar** — ensayado con `pruebas/reglas-13.sql` dentro de una transacción abortada |
| `14-inventario-grafico.sql` | cuatro columnas del plano interactivo en `unidades` y `v_unidades_tablero` (la carga de datos va aparte, por Ley 29733) | 🟡 **por aplicar** |

Sin `sql/13`, Personas, la ficha, el Modo llamadas, el bloque de visitas de Hoy y el Embudo (que
ahora lee `v_cartera`) fallan con un mensaje que lo dice.

Los umbrales de temperatura y fríos se siembran con valores **🔵 PROPUESTA** y
`estado_semaforo='azul'`; Walter los ratifica desde Parámetros. Ninguno es una cifra comercial.

### Edge Function `supabase/functions/aviso-visita`

Correo automático del aviso de visita (confirmación · recordatorio · cancelación) por Resend, con
la invitación `.ics`. **🔵 Escrita, no desplegada.** Desplegada sin los secretos
`RESEND_API_KEY` y `CORREO_REMITENTE` queda **inerte**: responde `configurado:false` y la ficha
esconde «Enviar automático». Mientras tanto funciona el camino manual (`mailto:` + `.ics`
descargable + texto de WhatsApp). Despliegue, activación y seguridad: su propio
[`README.md`](supabase/functions/aviso-visita/README.md). `aviso-visita.ts` de esa carpeta es una
copia byte a byte de `src/lib/aviso-visita.ts` y no se edita allí.

## Stack

Vite · React 18 · TypeScript estricto · Tailwind CSS 3 · React Router · TanStack Query ·
supabase-js v2 · shadcn/ui · @tremor/react · lucide-react · date-fns.

**Iconografía: solo `lucide-react`** (un único estilo de línea). No mezclar con otro set.

> **Nota sobre versiones.** Se usa Tailwind **3**, no 4, y por tanto el CLI de shadcn **2.10**
> en lugar de `shadcn@latest` (que es v4 y asume Tailwind 4). El motivo es concreto:
> `@tremor/react` 3.18 está construido contra Tailwind 3.4 y no funciona con Tailwind 4.
> Tailwind 3 es además el que permite tener los tokens de marca en `tailwind.config.js`.
> Si algún día se migra a Tailwind 4, hay que cambiar Tremor por su sucesor a la vez.

---

## Marca

Los cuatro tokens viven en `tailwind.config.js` como colores con nombre, y su traducción a
variables de shadcn/ui en `src/index.css`. **No se modifican desde el código.**

| Token | Valor | Rol |
|---|---|---|
| `azul` | `#0F2A44` | primario · 60 % |
| `cal` | `#F6F2EA` | secundario · 30 % |
| `ambar` | `#F2A93B` | acento · máx. 10 % |
| `suelo` | `#14181C` | tinta |

### 🔴 Regla dura

**El ámbar nunca sobre superficie clara.** Contraste 1.79:1 sobre cal — incumple WCAG.
Ámbar solo sobre azul. Por eso el token `accent` de shadcn/ui (que es la superficie de *hover*
sobre fondo claro) **no** es el ámbar: el ámbar tiene su propio token y se aplica a mano.
La explicación completa está comentada en `tailwind.config.js` y en `src/index.css`.

Tipografía: **Archivo**, una sola familia, pesos 900 / 700 / 400.

---

## Sesión y roles

Correo y contraseña con Supabase Auth. **No hay pantalla de registro**: las cuentas las crea
Dirección en el panel de Supabase (*Authentication → Users*), el disparador `t_nuevo_usuario`
crea el perfil con rol `lectura`, y Dirección lo eleva después. `/registro` redirige a
`/entrar`.

| Pieza | Dónde | Qué hace |
|---|---|---|
| `<ProveedorSesion>` | `src/auth/ContextoSesion.tsx` | expone `usuario`, `perfil`, `rol`, `aviso`, `entrar()`, `salir()` |
| `<RutaProtegida>` | `src/auth/RutaProtegida.tsx` | envuelve cada ruta; sin sesión → `/entrar` |
| `SECCIONES` | `src/auth/secciones.ts` | qué secciones ve cada rol, y de qué política de RLS sale cada fila |

Si el perfil tiene `activo = false`, el contexto **cierra la sesión** y `/entrar` muestra
*«Tu acceso está desactivado. Habla con Walter.»*

### 🔴 El menú no es seguridad

Ocultar un enlace no protege nada: la ruta se puede escribir a mano y `supabase-js` se puede
llamar desde la consola del navegador. **Lo único que protege los datos es RLS**
(`sql/02-rls.sql`), evaluado en el servidor con `auth.uid()`.

Por eso `src/auth/secciones.ts` no *define* permisos: los **copia** de RLS, y cada sección cita
la política de la que sale. Si RLS cambia, esto se actualiza detrás — nunca al revés. Con las
políticas actuales los cinco roles pueden **leer** casi todo, así que hoy el menú solo esconde
*Registro rápido* a `contabilidad` y `lectura` (no tienen `INSERT` en `personas`), y con él el
*Modo llamadas* (`/cola`), que cuelga del mismo filtro.

---

## Seguridad

- `.env.local` está en `.gitignore` desde antes del primer commit. Comprobado con
  `git check-ignore -v .env.local`.
- Solo la clave `anon` llega al navegador. La `service_role` jamás — ni en el repositorio, ni
  en un `.env`, ni en un prompt.
- La clave `anon` **solo es segura con RLS activado en todas las tablas.** Antes de cargar un
  dato real hay que pasar la batería de pruebas de
  `../../01-documentacion/05-SEGURIDAD-BACKUPS-Y-LEY-29733.md`.

---

## Instalar el CRM en el teléfono (PWA)

El CRM se instala en Android y en iPhone/iPad desde el propio navegador: queda con su icono en
la pantalla de inicio y se abre a pantalla completa, sin barra de direcciones.

### Cómo se instala

| | |
|---|---|
| **Android** (Chrome, Edge, Samsung Internet) | Aparece un botón **«Instalar la app»** al pie del menú lateral. También sale solo el aviso del navegador. |
| **iPhone / iPad** | **Tiene que ser Safari.** Compartir → «Añadir a pantalla de inicio». El menú lateral trae el botón «Cómo instalarlo» con los pasos, porque Safari no permite que una web abra ese menú por su cuenta. |
| **Windows y macOS** (Chrome, Edge) | El mismo botón **«Instalar la app»** del menú lateral, o el icono de instalar (⊕) que sale a la derecha de la barra de direcciones. Queda en el menú Inicio / Launchpad y se abre en su propia ventana, sin barra de direcciones. |
| **macOS con Safari** | Safari 17 o superior: Archivo → «Añadir al Dock». |

Desde Chrome de iPhone **no se puede**: esa opción no existe en iOS fuera de Safari.

Dos campos del manifiesto son para el escritorio: `display_override` (si el navegador no
entiende `standalone`, cae a `minimal-ui` en vez de abrirse como pestaña) y `launch_handler`
con `navigate-existing` (pulsar el icono con el CRM ya abierto reutiliza esa ventana y la lleva
a la sección pedida, en vez de abrir una segunda ventana con otra sesión).

### 🔴 Regla dura: el service worker no guarda datos

`public/sw.js` guarda **solo el cascarón** — HTML, JS, CSS e iconos. Nunca una respuesta de la
base. Por dos motivos, los dos innegociables:

1. **Una cifra cacheada es una cifra que miente.** Este CRM enseña precios, saldos y plazos
   legales. Servir la respuesta de ayer con cara de estar al día es exactamente el fallo que
   documenta `00-fuente-de-verdad` y que este repositorio existe para evitar.
2. **Ley 29733.** Las respuestas traen DNI, teléfonos y correos de terceros. Guardarlas en
   Cache Storage las deja escritas en el disco del teléfono, fuera de la sesión y sobreviviendo
   al cierre de sesión. Ver `../../01-documentacion/05-SEGURIDAD-BACKUPS-Y-LEY-29733.md`.

La regla se hace cumplir con una **lista de permitidos**, no de prohibidos: el service worker
solo toca peticiones `GET` del **mismo origen**. Supabase vive en otro origen, así que queda
fuera por construcción — no hay ninguna lista de exclusiones de la que alguien pueda olvidarse.

**Consecuencia buscada:** sin conexión el CRM arranca, no puede consultar nada, y lo dice con
un aviso al pie. No hay «modo sin conexión» y no debe haberlo.

### Actualizaciones

La navegación es **red primero**: con conexión siempre se sirve el CRM de hoy. Nadie se queda
atrapado en la versión de hace tres meses. Cuando hay una versión nueva esperando, sale un
aviso con un botón *Actualizar* — no se recarga sola, porque alguien puede estar a medio
rellenar una separación.

### Qué hace falta para que funcione

| Pieza | Dónde |
|---|---|
| Manifiesto | `public/manifest.webmanifest` |
| Iconos (192, 512, maskable, apple-touch) | `public/`, generados desde `04-media/marca/logo/` |
| Metaetiquetas de iOS y áreas seguras | `index.html` + `src/componentes/layout/Cascaron.tsx` |
| Service worker | `public/sw.js` |
| Registro e instalación | `src/lib/pwa.ts` |
| Reescritura SPA y cabeceras de caché | `vercel.json` |

**🔴 HTTPS es obligatorio.** Sin certificado no hay instalación ni service worker; es requisito
del navegador, no una opción. Vercel lo da hecho. `localhost` es la única excepción, para poder
probarlo en desarrollo — y ojo, el service worker **solo se registra en producción**
(`npm run build && npm run preview`), nunca en `npm run dev`.
