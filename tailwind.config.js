import defaultTheme from 'tailwindcss/defaultTheme'
import animate from 'tailwindcss-animate'
import headlessui from '@headlessui/tailwindcss'

// ---------------------------------------------------------------------------
// TOKENS DE MARCA — MERCADO MEDIA LUNA
//
// Fuente: D:\SCPCMO\02-marketing\marca\MANUAL-DE-MARCA-MML.md
//         (resumido en D:\SCPCMO\07-crm\03-diseno\BRIEF-CLAUDE-DESIGN.md §2)
// Estado: VIGENTE. Estos cuatro valores NO se modifican desde el codigo.
//
//   azul   #0F2A44   Azul Noche    primario · 60 % de la superficie
//   cal    #F6F2EA   Blanco Cal    secundario · 30 %
//   ambar  #F2A93B   Ambar Luna    acento · MAXIMO 10 %
//   suelo  #14181C   Negro Suelo   tinta
//
// ###########################################################################
// #  REGLA DURA DE ACCESIBILIDAD — NO NEGOCIABLE                            #
// #                                                                         #
// #  El ambar #F2A93B NUNCA se usa como color de texto ni como color de     #
// #  fondo sobre superficies claras (cal #F6F2EA o blanco).                 #
// #  Contraste ambar sobre cal = 1.79:1 — incumple WCAG (minimo 4.5:1).     #
// #                                                                         #
// #  El ambar SOLO se usa sobre azul #0F2A44:                               #
// #    bg-azul text-ambar ................................ PERMITIDO       #
// #    bg-ambar text-suelo, dentro de un bloque azul ..... PERMITIDO       #
// #    text-ambar sobre lienzo cal o blanco .............. PROHIBIDO       #
// #    bg-ambar sobre lienzo cal o blanco ................ PROHIBIDO       #
// #                                                                         #
// #  Por eso el token `accent` de shadcn/ui NO es el ambar: shadcn usa      #
// #  `accent` para los estados hover sobre superficies claras (elementos    #
// #  de menu, botones fantasma), que es exactamente el caso prohibido.      #
// #  El ambar vive en su propio token `ambar` y se aplica a mano, solo en   #
// #  contexto azul. Ver el bloque equivalente en src/index.css.             #
// ###########################################################################

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // Tremor necesita que Tailwind vea sus propias clases para generarlas.
    './node_modules/@tremor/**/*.{js,ts,jsx,tsx,mjs}',
  ],
  theme: {
    extend: {
      colors: {
        // ---------------------------------------------------------------
        // Tokens de marca, como colores con nombre.
        // ---------------------------------------------------------------
        azul: {
          DEFAULT: '#0F2A44',
          // Escalas derivadas del azul: solo para dar profundidad DENTRO de
          // superficies que ya son azules (barra lateral, cabeceras). No son
          // colores nuevos de marca, son el mismo azul mas claro o mas oscuro.
          900: '#081726',
          800: '#0B2036',
          700: '#0F2A44', // === azul DEFAULT
          600: '#1B3E5F',
          500: '#2A547B',
          400: '#4C7099',
          300: '#7C9AB8',
        },
        cal: {
          DEFAULT: '#F6F2EA',
          200: '#EDE7DA', // separador suave sobre cal
          300: '#DED5C3', // borde marcado sobre cal
        },
        ambar: {
          DEFAULT: '#F2A93B',
          // Sin escalas a proposito: el ambar tiene un unico uso legitimo
          // (acento sobre azul). Anadir tonos claros invitaria a romper la
          // regla dura de arriba.
        },
        suelo: {
          DEFAULT: '#14181C',
          700: '#3A424A', // texto secundario sobre cal
          500: '#5F6A75', // texto terciario / deshabilitado sobre cal
        },

        // 🔵 PROPUESTA, no ratificada. Ver el bloque largo de src/index.css.
        // Un solo uso legitimo: el bloque de separaciones que vencen en 3 dias
        // o menos, en la pantalla Hoy. NUNCA para el estado de pago (el brief
        // de diseno lo prohibe expresamente y esa regla no cambia).
        alerta: {
          DEFAULT: 'hsl(var(--alerta))',
          foreground: 'hsl(var(--alerta-foreground))',
          suave: 'hsl(var(--alerta-suave))',
        },

        // ---------------------------------------------------------------
        // Tokens semanticos de shadcn/ui.
        // Apuntan a las variables CSS de src/index.css, que a su vez estan
        // definidas con los cuatro colores de marca de arriba.
        // ---------------------------------------------------------------
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          // OJO: `accent` de shadcn = superficie de hover sobre fondo claro.
          // NO es el ambar de marca. Ver la regla dura de arriba.
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ---------------------------------------------------------------
        // Tokens de Tremor (KPI, barras de progreso, graficos), enlazados a
        // la marca para que no aparezca la paleta azul/gris por defecto.
        // ---------------------------------------------------------------
        tremor: {
          brand: {
            faint: '#F6F2EA',
            muted: '#7C9AB8',
            subtle: '#4C7099',
            DEFAULT: '#0F2A44',
            emphasis: '#0B2036',
            inverted: '#FFFFFF',
          },
          background: {
            muted: '#F6F2EA',
            subtle: '#EDE7DA',
            DEFAULT: '#FFFFFF',
            emphasis: '#3A424A',
          },
          border: { DEFAULT: '#EDE7DA' },
          ring: { DEFAULT: '#DED5C3' },
          content: {
            subtle: '#5F6A75',
            DEFAULT: '#3A424A',
            emphasis: '#14181C',
            strong: '#0F2A44',
            inverted: '#FFFFFF',
          },
        },
        'dark-tremor': {
          brand: {
            faint: '#081726',
            muted: '#1B3E5F',
            subtle: '#2A547B',
            DEFAULT: '#4C7099',
            emphasis: '#7C9AB8',
            inverted: '#0F2A44',
          },
          background: {
            muted: '#081726',
            subtle: '#0B2036',
            DEFAULT: '#0F2A44',
            emphasis: '#F6F2EA',
          },
          border: { DEFAULT: '#1B3E5F' },
          ring: { DEFAULT: '#1B3E5F' },
          content: {
            subtle: '#4C7099',
            DEFAULT: '#7C9AB8',
            emphasis: '#F6F2EA',
            strong: '#FFFFFF',
            inverted: '#0F2A44',
          },
        },
      },

      fontFamily: {
        // Una sola familia en toda la interfaz. Sin excepciones.
        sans: ['Archivo', ...defaultTheme.fontFamily.sans],
      },

      fontWeight: {
        // Solo los tres pesos del manual de marca. No usar 500 ni 600.
        normal: '400',
        bold: '700',
        black: '900',
      },

      borderRadius: {
        // Un solo radio base para toda la interfaz (--radius en index.css).
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        'tremor-small': 'calc(var(--radius) - 4px)',
        'tremor-default': 'var(--radius)',
        'tremor-full': '9999px',
      },

      boxShadow: {
        // Un solo nivel de elevacion en toda la interfaz. No apilar sombras.
        tarjeta: '0 1px 2px 0 rgb(20 24 28 / 0.04), 0 1px 3px 0 rgb(20 24 28 / 0.06)',
        // Nombres que Tremor espera encontrar.
        'tremor-input': '0 1px 2px 0 rgb(20 24 28 / 0.05)',
        'tremor-card': '0 1px 2px 0 rgb(20 24 28 / 0.04), 0 1px 3px 0 rgb(20 24 28 / 0.06)',
        'tremor-dropdown':
          '0 4px 6px -1px rgb(20 24 28 / 0.08), 0 2px 4px -2px rgb(20 24 28 / 0.08)',
        'dark-tremor-input': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'dark-tremor-card': '0 1px 3px 0 rgb(0 0 0 / 0.2)',
        'dark-tremor-dropdown': '0 4px 6px -1px rgb(0 0 0 / 0.3)',
      },

      fontSize: {
        // Jerarquia tipografica de Tremor, alineada a la de la interfaz.
        'tremor-label': ['0.75rem', { lineHeight: '1rem' }],
        'tremor-default': ['0.875rem', { lineHeight: '1.25rem' }],
        'tremor-title': ['1.125rem', { lineHeight: '1.75rem' }],
        'tremor-metric': ['1.875rem', { lineHeight: '2.25rem' }],
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },

  // Tremor compone algunos nombres de clase en tiempo de ejecucion; sin
  // safelist, Tailwind los purga y los graficos salen sin color.
  //
  // La lista oficial de Tremor incluye las 22 familias de color de Tailwind y
  // produce ~456 kB de CSS. Aqui esta recortada a proposito a las familias que
  // la marca admite:
  //   slate / gray / stone -> neutros de tabla y de eje
  //   blue                 -> equivalente de Azul Noche en los graficos
  //   amber                -> equivalente de Ambar Luna (solo sobre azul)
  //
  // Esto NO es una optimizacion suelta: el brief de diseno prohibe introducir
  // colores nuevos (nada de rojo/verde de semaforo para el estado de pago).
  // Si un <BarChart colors={['emerald']} /> sale sin color, ese fallo es la
  // senal correcta. Si Walter aprueba un color semantico para mora, se agrega
  // primero al manual de marca y despues aqui.
  safelist: [
    {
      pattern: /^(bg-(?:slate|gray|stone|blue|amber)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ['hover', 'ui-selected'],
    },
    {
      pattern: /^(text-(?:slate|gray|stone|blue|amber)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ['hover', 'ui-selected'],
    },
    {
      pattern: /^(border-(?:slate|gray|stone|blue|amber)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ['hover', 'ui-selected'],
    },
    {
      pattern: /^(ring-(?:slate|gray|stone|blue|amber)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern: /^(stroke-(?:slate|gray|stone|blue|amber)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern: /^(fill-(?:slate|gray|stone|blue|amber)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
  ],

  plugins: [animate, headlessui],
}
