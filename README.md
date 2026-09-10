# CRM Mercado Media Luna

Aplicación web de una sola página. CRM operativo de **SCP Inmobiliaria** para el proyecto
**Mercado Media Luna (MML)**.

**Estado: 🟡 en construcción.** De las 8 pantallas del MVP-1 hay **4 escritas** — Hoy, Registro
rápido, Embudo e Inventario. Las otras cuatro (Persona, Separaciones, Cobranza, Reportes) siguen
🔴 pendientes y resuelven al marcador de posición.

> **Antes de abrir Embudo o Inventario** hay que ejecutar en Supabase, por orden,
> `../sql/07-vistas-hoy.sql` y `../sql/08-vistas-embudo-e-inventario.sql`. Sin sus vistas las dos
> pantallas no tienen de dónde leer, y lo dicen con ese mismo mensaje en lugar de salir vacías.

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
  lib/utils.ts           cn() para shadcn/ui
  auth/ContextoSesion    usuario + perfil + rol, y entrar()/salir()
  auth/RutaProtegida     envoltorio de cada ruta
  auth/secciones.ts      qué secciones ve cada rol (copiado de RLS)
  auth/tipos-sesion.ts   contrato mínimo de `perfiles` + lector en runtime
  componentes/ui/        shadcn/ui — no escribir a mano, traer con `npx shadcn add`
  componentes/layout/    cascarón, barra lateral
  paginas/entrar/        pantalla de inicio de sesión
  paginas/<pantalla>/    una carpeta por pantalla (las 8 del MVP-1; 4 escritas,
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
