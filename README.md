# CRM Mercado Media Luna

Aplicación web de una sola página. CRM operativo de **SCP Inmobiliaria** para el proyecto
**Mercado Media Luna (MML)**.

**Estado: 🔵 andamiaje.** No hay ninguna pantalla escrita todavía. Lo que existe es el
esqueleto: dependencias, tema de marca, rutas, cliente de Supabase y estructura de carpetas.

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

---

## Estructura

```
src/
  lib/supabase.ts     cliente único de Supabase (solo clave anon)
  lib/tipos.ts        tipos GENERADOS desde la base — vacío a propósito
  lib/fechas.ts       formateo en español y "vence en N días" (date-fns)
  lib/utils.ts        cn() para shadcn/ui
  componentes/ui/     shadcn/ui — no escribir a mano, traer con `npx shadcn add`
  componentes/layout/ cascarón, barra lateral
  paginas/<pantalla>/ una carpeta por pantalla (las 8 del MVP-1, todas vacías)
  hooks/              hooks de datos (TanStack Query)
  rutas.tsx           mapa de rutas
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

## Seguridad

- `.env.local` está en `.gitignore` desde antes del primer commit. Comprobado con
  `git check-ignore -v .env.local`.
- Solo la clave `anon` llega al navegador. La `service_role` jamás — ni en el repositorio, ni
  en un `.env`, ni en un prompt.
- La clave `anon` **solo es segura con RLS activado en todas las tablas.** Antes de cargar un
  dato real hay que pasar la batería de pruebas de
  `../../01-documentacion/05-SEGURIDAD-BACKUPS-Y-LEY-29733.md`.
