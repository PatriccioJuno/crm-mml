import { useId, useRef, type KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * GRUPO DE CHIPS — elegir UNA opción (o varias) de un toque.
 *
 * ---------------------------------------------------------------------------
 * POR QUE CHIPS Y NO DESPLEGABLES
 * ---------------------------------------------------------------------------
 * El perfil del prospecto (¿qué busca?, ¿cuándo compra?, ¿contado o
 * financiado?…) se llena DURANTE la llamada, con el teléfono en una mano. Un
 * `<select>` son dos toques y un menú que tapa la pantalla; un chip es un toque
 * y deja ver todas las respuestas posibles a la vez, que además le recuerda al
 * vendedor qué preguntar. Es el patrón del proyecto de Claude Design para
 * Registro rápido (52 px de campo, meta de 30 segundos).
 *
 * ---------------------------------------------------------------------------
 * ACCESIBILIDAD
 * ---------------------------------------------------------------------------
 *  - `role="radiogroup"` + `role="radio"` con `aria-checked`: un lector de
 *    pantalla anuncia «Contado, botón de opción, 1 de 2, no marcado».
 *  - UN solo punto de tabulación por grupo (tabindex itinerante): el perfil
 *    tiene una docena de grupos y, con todos los chips tabulables, llegar al
 *    campo de nota costaría setenta pulsaciones de Tab.
 *  - Las flechas MUEVEN el foco pero NO eligen; se elige con Espacio o Enter.
 *    Es una desviación consciente del patrón de radio de WAI-ARIA (donde la
 *    flecha también marca): aquí cada elección se GUARDA al instante en la
 *    base (SeccionPerfil), y recorrer las opciones con flechas dispararía un
 *    guardado por cada pulsación.
 *  - 44 px de alto como mínimo en el móvil (`min-h-11`); en escritorio baja.
 *  - Lo elegido se distingue por relleno azul, peso Bold y un icono de check —
 *    no solo por color (brief de diseño: texto + icono + peso).
 *
 * Colores solo de marca. Elegido: azul con texto cal. Libre: blanco con borde
 * de campo y tinta suelo. Sin ámbar: estos chips viven sobre superficie clara.
 */

export type OpcionChip<T extends string> = {
  valor: T
  etiqueta: string
  /** Aclaración corta; se muestra debajo del grupo cuando la opción está elegida. */
  ayuda?: string | undefined
}

const BASE_CHIP =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-sm ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

const TAMANO_NORMAL = 'sm:min-h-10'
const TAMANO_COMPACTO = 'px-3 text-xs sm:min-h-8'

const ELEGIDO = 'border-azul bg-azul font-bold text-cal'
const LIBRE = 'border-input bg-white text-suelo hover:bg-accent'

function EtiquetaGrupo({
  id,
  texto,
  oculta,
}: {
  id: string
  texto: string
  oculta: boolean
}) {
  return (
    <p id={id} className={cn('text-sm font-bold text-suelo', oculta && 'sr-only')}>
      {texto}
    </p>
  )
}

/**
 * Una opción de varias. `permitirVacio`: tocar la elegida la desmarca (vuelve
 * a «no sé», que en el perfil NO es lo mismo que «no»). `atajos`: en
 * escritorio, cada chip muestra su número y, con el foco dentro del grupo, la
 * tecla 1–9 lo elige.
 */
export function GrupoChips<T extends string>({
  etiqueta,
  opciones,
  valor,
  alCambiar,
  permitirVacio = false,
  deshabilitado = false,
  compacto = false,
  atajos = false,
  etiquetaOculta = false,
  className,
}: {
  etiqueta: string
  opciones: readonly OpcionChip<T>[]
  valor: T | null
  alCambiar: (v: T | null) => void
  permitirVacio?: boolean | undefined
  deshabilitado?: boolean | undefined
  compacto?: boolean | undefined
  atajos?: boolean | undefined
  /** La etiqueta solo para lectores de pantalla (cuando la pregunta ya se ve al lado). */
  etiquetaOculta?: boolean | undefined
  className?: string | undefined
}) {
  const idEtiqueta = useId()
  const idAyuda = useId()
  const botones = useRef<(HTMLButtonElement | null)[]>([])

  const indiceElegido = opciones.findIndex((o) => o.valor === valor)
  // El que recibe el Tab: el elegido, o el primero si no hay ninguno.
  const indiceTabulable = indiceElegido === -1 ? 0 : indiceElegido
  const ayuda = indiceElegido === -1 ? undefined : opciones[indiceElegido]?.ayuda

  function elegir(indice: number): void {
    const opcion = opciones[indice]
    if (opcion === undefined || deshabilitado) return
    if (opcion.valor === valor) {
      if (permitirVacio) alCambiar(null)
      return
    }
    alCambiar(opcion.valor)
  }

  function alTecla(evento: KeyboardEvent<HTMLButtonElement>, indice: number): void {
    const total = opciones.length
    if (total === 0) return

    if (atajos && /^[1-9]$/.test(evento.key)) {
      const destino = Number(evento.key) - 1
      if (destino < total) {
        evento.preventDefault()
        elegir(destino)
        botones.current[destino]?.focus()
      }
      return
    }

    let destino: number | null = null
    if (evento.key === 'ArrowRight' || evento.key === 'ArrowDown') destino = (indice + 1) % total
    else if (evento.key === 'ArrowLeft' || evento.key === 'ArrowUp') destino = (indice - 1 + total) % total
    else if (evento.key === 'Home') destino = 0
    else if (evento.key === 'End') destino = total - 1

    if (destino !== null) {
      evento.preventDefault()
      botones.current[destino]?.focus()
    }
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <EtiquetaGrupo id={idEtiqueta} texto={etiqueta} oculta={etiquetaOculta} />
      <div
        role="radiogroup"
        aria-labelledby={idEtiqueta}
        aria-describedby={ayuda === undefined ? undefined : idAyuda}
        aria-disabled={deshabilitado || undefined}
        className="flex flex-wrap gap-2"
      >
        {opciones.map((opcion, indice) => {
          const elegido = indice === indiceElegido
          const atajo = atajos && indice < 9 ? String(indice + 1) : undefined
          return (
            <button
              key={opcion.valor}
              ref={(nodo) => {
                botones.current[indice] = nodo
              }}
              type="button"
              role="radio"
              aria-checked={elegido}
              aria-keyshortcuts={atajo}
              tabIndex={indice === indiceTabulable ? 0 : -1}
              title={opcion.ayuda}
              disabled={deshabilitado}
              onClick={() => elegir(indice)}
              onKeyDown={(e) => alTecla(e, indice)}
              className={cn(
                BASE_CHIP,
                compacto ? TAMANO_COMPACTO : TAMANO_NORMAL,
                elegido ? ELEGIDO : LIBRE,
              )}
            >
              {elegido && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
              <span>{opcion.etiqueta}</span>
              {atajo !== undefined && (
                <span aria-hidden="true" className="hidden text-[0.6875rem] opacity-70 sm:inline">
                  {atajo}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {ayuda !== undefined && (
        <p id={idAyuda} aria-live="polite" className="text-xs text-suelo-700">
          {ayuda}
        </p>
      )}
    </div>
  )
}

/**
 * Varias opciones a la vez (p. ej. las objeciones). Botones conmutables con
 * `aria-pressed`, dentro de un `role="group"` con nombre. Aquí todos son
 * tabulables: son interruptores independientes, no una sola respuesta.
 *
 * El orden de `valores` que se devuelve es SIEMPRE el de `opciones`, no el del
 * orden en que se tocaron: así dos personas que marcan lo mismo guardan lo
 * mismo y el registro de cambios no muestra diferencias que no existen.
 */
export function GrupoChipsMultiple<T extends string>({
  etiqueta,
  opciones,
  valores,
  alCambiar,
  deshabilitado = false,
  compacto = false,
  etiquetaOculta = false,
  className,
}: {
  etiqueta: string
  opciones: readonly OpcionChip<T>[]
  valores: readonly T[]
  alCambiar: (v: T[]) => void
  deshabilitado?: boolean | undefined
  compacto?: boolean | undefined
  etiquetaOculta?: boolean | undefined
  className?: string | undefined
}) {
  const idEtiqueta = useId()

  function conmutar(opcion: T): void {
    if (deshabilitado) return
    const marcado = valores.includes(opcion)
    alCambiar(
      opciones
        .map((o) => o.valor)
        .filter((v) => (v === opcion ? !marcado : valores.includes(v))),
    )
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <EtiquetaGrupo id={idEtiqueta} texto={etiqueta} oculta={etiquetaOculta} />
      <div role="group" aria-labelledby={idEtiqueta} className="flex flex-wrap gap-2">
        {opciones.map((opcion) => {
          const marcado = valores.includes(opcion.valor)
          return (
            <button
              key={opcion.valor}
              type="button"
              aria-pressed={marcado}
              title={opcion.ayuda}
              disabled={deshabilitado}
              onClick={() => conmutar(opcion.valor)}
              className={cn(
                BASE_CHIP,
                compacto ? TAMANO_COMPACTO : TAMANO_NORMAL,
                marcado ? ELEGIDO : LIBRE,
              )}
            >
              {marcado && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
              <span>{opcion.etiqueta}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Sí / No / (sin responder). `null` es «no se preguntó» y NO equivale a «no»:
 * es la diferencia que hace que la cualificación (R5) no mienta. Por eso, por
 * defecto, tocar la opción elegida la desmarca.
 *
 * Si no se pasa `etiqueta`, se usa «Sí / No» solo para lectores de pantalla;
 * lo correcto es pasar la pregunta («¿Decide solo?»).
 */
export function ChipsSiNo({
  etiqueta,
  valor,
  alCambiar,
  etiquetas = ['Sí', 'No'],
  permitirVacio = true,
  deshabilitado = false,
  compacto = false,
  etiquetaOculta = false,
  className,
}: {
  etiqueta?: string | undefined
  valor: boolean | null
  alCambiar: (v: boolean | null) => void
  etiquetas?: readonly [string, string] | undefined
  permitirVacio?: boolean | undefined
  deshabilitado?: boolean | undefined
  compacto?: boolean | undefined
  etiquetaOculta?: boolean | undefined
  className?: string | undefined
}) {
  const [si, no] = etiquetas
  const opciones: readonly OpcionChip<'si' | 'no'>[] = [
    { valor: 'si', etiqueta: si },
    { valor: 'no', etiqueta: no },
  ]

  return (
    <GrupoChips
      etiqueta={etiqueta ?? `${si} / ${no}`}
      etiquetaOculta={etiqueta === undefined || etiquetaOculta}
      opciones={opciones}
      valor={valor === null ? null : valor ? 'si' : 'no'}
      alCambiar={(v) => alCambiar(v === null ? null : v === 'si')}
      permitirVacio={permitirVacio}
      deshabilitado={deshabilitado}
      compacto={compacto}
      className={className}
    />
  )
}
