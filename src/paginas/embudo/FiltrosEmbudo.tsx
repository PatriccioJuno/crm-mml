import { FilterX } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { cn } from '@/lib/utils'
import { etiquetaOrigen, type Tarjeta } from '@/lib/embudo'

/**
 * Los tres filtros del tablero: lanzamiento, responsable y origen.
 *
 * ---------------------------------------------------------------------------
 * LAS OPCIONES SALEN DE LAS TARJETAS, NO DE UNA LISTA ESCRITA
 * ---------------------------------------------------------------------------
 * `lanzamiento` es texto libre en `oportunidades` y `origen` lo es en
 * `personas`: no hay enum que consultar, asi que cualquier lista fija que
 * escribieramos aqui empezaria a mentir el dia que alguien teclee «L4». Por eso
 * las opciones se construyen con lo que de verdad hay en el tablero.
 *
 * Consecuencia buscada: si un filtro no aparece, es que no existe ninguna
 * oportunidad con ese valor. La lista de opciones es, ademas, un pequeño
 * informe de calidad del dato — ahi se ve «(sin lanzamiento)» con su conteo.
 *
 * Y por eso el filtrado ocurre en el navegador y no en la consulta: si se
 * filtrara en la base, elegir un lanzamiento vaciaria las opciones de los otros
 * dos desplegables.
 */

export type Filtros = {
  lanzamiento: string
  responsable: string
  origen: string
}

/** Valor de «no filtrar». */
export const TODOS = '__todos__'

/** Valor de «las que no tienen ese dato». No es lo mismo que no filtrar. */
const SIN_DATO = '__sin_dato__'

export function filtrosVacios(): Filtros {
  return { lanzamiento: TODOS, responsable: TODOS, origen: TODOS }
}

export function hayFiltros(f: Filtros): boolean {
  return f.lanzamiento !== TODOS || f.responsable !== TODOS || f.origen !== TODOS
}

function coincide(valor: string | null, filtro: string): boolean {
  if (filtro === TODOS) return true
  if (filtro === SIN_DATO) return valor === null
  return valor === filtro
}

export function aplicarFiltros(filas: readonly Tarjeta[], f: Filtros): Tarjeta[] {
  return filas.filter(
    (t) =>
      coincide(t.lanzamiento, f.lanzamiento) &&
      coincide(t.responsableId, f.responsable) &&
      coincide(t.origen, f.origen),
  )
}

type Opcion = { valor: string; etiqueta: string; conteo: number }

/**
 * Opciones de un filtro, ordenadas alfabeticamente, con «(sin …)» al final.
 * `etiquetar` traduce el valor crudo de la base a lo que se lee en pantalla.
 */
function opcionesDe(
  filas: readonly Tarjeta[],
  leer: (t: Tarjeta) => string | null,
  etiquetar: (t: Tarjeta, valor: string) => string,
  etiquetaNula: string,
): Opcion[] {
  const conteos = new Map<string, { etiqueta: string; conteo: number }>()

  for (const t of filas) {
    const crudo = leer(t)
    const clave = crudo ?? SIN_DATO
    const etiqueta = crudo === null ? etiquetaNula : etiquetar(t, crudo)
    const previo = conteos.get(clave)
    conteos.set(clave, { etiqueta, conteo: (previo?.conteo ?? 0) + 1 })
  }

  const opciones = [...conteos.entries()].map(([valor, v]) => ({
    valor,
    etiqueta: v.etiqueta,
    conteo: v.conteo,
  }))

  return opciones.sort((a, b) => {
    if (a.valor === SIN_DATO) return 1
    if (b.valor === SIN_DATO) return -1
    return a.etiqueta.localeCompare(b.etiqueta, 'es')
  })
}

export function FiltrosEmbudo({
  filas,
  filtros,
  alCambiar,
  total,
  visibles,
}: {
  /** TODAS las tarjetas cargadas, sin filtrar: de aqui salen las opciones. */
  filas: readonly Tarjeta[]
  filtros: Filtros
  alCambiar: (filtros: Filtros) => void
  total: number
  visibles: number
}) {
  const lanzamientos = opcionesDe(
    filas,
    (t) => t.lanzamiento,
    (_t, valor) => valor,
    '(sin lanzamiento)',
  )
  const responsables = opcionesDe(
    filas,
    (t) => t.responsableId,
    (t, _valor) => t.responsableNombre ?? '[sin acceso al nombre]',
    '(sin responsable)',
  )
  const origenes = opcionesDe(
    filas,
    (t) => t.origen,
    (_t, valor) => etiquetaOrigen(valor),
    '(sin origen)',
  )

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Desplegable
        id="filtro-lanzamiento"
        etiqueta="Lanzamiento"
        valor={filtros.lanzamiento}
        opciones={lanzamientos}
        alCambiar={(valor) => alCambiar({ ...filtros, lanzamiento: valor })}
      />
      <Desplegable
        id="filtro-responsable"
        etiqueta="Responsable"
        valor={filtros.responsable}
        opciones={responsables}
        alCambiar={(valor) => alCambiar({ ...filtros, responsable: valor })}
      />
      <Desplegable
        id="filtro-origen"
        etiqueta="Origen"
        valor={filtros.origen}
        opciones={origenes}
        alCambiar={(valor) => alCambiar({ ...filtros, origen: valor })}
      />

      {hayFiltros(filtros) && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => alCambiar(filtrosVacios())}
            className="h-9"
          >
            <FilterX strokeWidth={1.75} aria-hidden="true" />
            Quitar filtros
          </Button>
          {/* Que el tablero esta filtrado tiene que verse SIEMPRE: un conteo
              por columna que en realidad es un subconjunto, sin decirlo, es
              exactamente como un embudo empieza a mentir. */}
          <p className="pb-2 text-xs font-bold text-suelo-700" aria-live="polite">
            Mostrando {visibles} de {total}
          </p>
        </>
      )}
    </div>
  )
}

function Desplegable({
  id,
  etiqueta,
  valor,
  opciones,
  alCambiar,
}: {
  id: string
  etiqueta: string
  valor: string
  opciones: readonly Opcion[]
  alCambiar: (valor: string) => void
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-bold text-suelo-700">
        {etiqueta}
      </label>
      <select
        id={id}
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
        className={cn(
          'h-9 min-w-44 rounded-md border border-input bg-card px-3',
          'text-sm shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        <option value={TODOS}>Todos</option>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta} ({o.conteo})
          </option>
        ))}
      </select>
    </div>
  )
}
