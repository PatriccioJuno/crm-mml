# CRM Mercado Media Luna

Aplicación web de una sola página. CRM operativo de **SCP Inmobiliaria** para el proyecto
**Mercado Media Luna (MML)**.

**Estado: 🟡 en construcción.** De las 8 pantallas del MVP-1 hay **5 escritas** — Hoy, Registro
rápido, Embudo, Inventario y Separaciones. Las otras tres (Persona, Cobranza, Reportes) siguen
🔴 pendientes y resuelven al marcador de posición.

> **Antes de abrir Embudo o Inventario** hay que ejecutar en Supabase, por orden,
> `../sql/07-vistas-hoy.sql` y `../sql/08-vistas-embudo-e-inventario.sql`. Sin sus vistas las dos
> pantallas no tienen de dónde leer, y lo dicen con ese mismo mensaje en lugar de salir vacías.
>
> **Antes de abrir Separaciones**, además, `../sql/09-separaciones-storage.sql`: crea el bucket
> privado `comprobantes` donde se sube el voucher del depósito.

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

🔴 **Todavía sin ejecutar:** `npm run tipos` falla con
`LegacyPlatformAuthRequiredError` mientras no se haya hecho `supabase login`. Hasta entonces
`src/lib/tipos.ts` sigue vacío a propósito y el cliente queda sin tipar por esquema.

---

## Estructura

```
src/
  lib/supabase.ts        cliente único de Supabase (solo clave anon)
  lib/tipos.ts           tipos GENERADOS desde la base — vacío a propósito
  lib/fechas.ts          formateo en español y "vence en N días" (date-fns)
  lib/lectura.ts         lectores de frontera: lo que llega de la base se comprueba
  lib/embudo.ts          los 10 estados, el umbral de días y mover una oportunidad
  lib/inventario.ts      los dos semáforos, y por qué una unidad no se puede ofrecer
  lib/parametros.ts      el único sitio donde puede vivir una cifra; PENDIENTE si está en rojo
  lib/separaciones.ts    el S/500, los dos relojes como campos distintos (R4) y el voucher
  lib/utils.ts           cn() para shadcn/ui
  auth/ContextoSesion    usuario + perfil + rol, y entrar()/salir()
  auth/RutaProtegida     envoltorio de cada ruta
  auth/secciones.ts      qué secciones ve cada rol (copiado de RLS)
  auth/tipos-sesion.ts   contrato mínimo de `perfiles` + lector en runtime
  componentes/ui/        shadcn/ui — no escribir a mano, traer con `npx shadcn add`
  componentes/layout/    cascarón, barra lateral
  paginas/entrar/        pantalla de inicio de sesión
  paginas/<pantalla>/    una carpeta por pantalla (las 8 del MVP-1; 5 escritas,
                         cada una con su README explicando lo que decide)
  hooks/                 hooks de datos (TanStack Query)
  rutas.tsx              mapa de rutas
```

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
(`../sql/02-rls.sql`), evaluado en el servidor con `auth.uid()`.

Por eso `src/auth/secciones.ts` no *define* permisos: los **copia** de RLS, y cada sección cita
la política de la que sale. Si RLS cambia, esto se actualiza detrás — nunca al revés. Con las
políticas actuales los cinco roles pueden **leer** casi todo, así que hoy el menú solo esconde
*Registro rápido* a `contabilidad` y `lectura` (no tienen `INSERT` en `personas`).

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
