import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { CabeceraPantalla } from '@/componentes/marca/CabeceraPantalla'
import { Button } from '@/componentes/ui/button'
import { cn } from '@/lib/utils'
import type { Lote } from '@/lib/lectura'
import {
  ESTADOS,
  LIMITE_TARJETAS,
  cargarTarjetas,
  etiquetaEstado,
  moverOportunidad,
  type EstadoEmbudo,
  type Tarjeta,
} from '@/lib/embudo'
import { ColumnaEmbudo } from './ColumnaEmbudo'
import { FiltrosEmbudo, aplicarFiltros, filtrosVacios, type Filtros } from './FiltrosEmbudo'
import { TarjetaEmbudo } from './TarjetaEmbudo'

/**
 * EMBUDO — los 10 estados en columnas, con arrastrar y soltar.
 *
 * ---------------------------------------------------------------------------
 * QUIEN MUEVE LA TARJETA Y QUIEN ESCRIBE LA HISTORIA
 * ---------------------------------------------------------------------------
 * La pantalla hace UNA cosa cuando se suelta una tarjeta: pedirle a la base que
 * cambie `oportunidades.estado`. Nada mas.
 *
 *  · El registro en `estado_historial` lo hace el disparador
 *    `t_oportunidad_historial` (R9). Aqui no se inserta ni una fila: si lo
 *    hicieramos, cada movimiento aparecería dos veces en la trazabilidad.
 *  · La regla R5 la hace cumplir la restriccion
 *    `calificado_requiere_las_4_respuestas`. La tarjeta AVISA antes, pero no
 *    bloquea por su cuenta: quien decide es la base, y si algun dia la regla
 *    cambia alli, esta pantalla obedece sin tocar una linea.
 *
 * ---------------------------------------------------------------------------
 * MOVIMIENTO OPTIMISTA, Y POR QUE SE PUEDE DESHACER
 * ---------------------------------------------------------------------------
 * La tarjeta salta de columna en el acto, antes de que responda la base:
 * esperar medio segundo por cada arrastre convierte el tablero en algo que no
 * apetece usar. Pero eso obliga a lo otro: si la base rechaza el movimiento, la
 * tarjeta VUELVE a su columna y se dice por que, con el texto que devolvio
 * Postgres traducido en src/lib/embudo.ts. Un tablero que se queda como si
 * hubiera guardado, sin haber guardado, es peor que uno lento.
 *
 * El caso silencioso esta cubierto tambien: con RLS, un `update` que no encaja
 * en la politica no da error, simplemente no afecta a ninguna fila. Por eso
 * `moverOportunidad` comprueba que volvio una fila y con el estado pedido.
 */

const CLAVE = ['embudo', 'tarjetas'] as const

type Movimiento = { id: string; estado: EstadoEmbudo }
type ContextoMovimiento = { previo: Lote<Tarjeta> | undefined }
type Rechazo = { nombre: string; destino: string; origen: string; motivo: string }

export function PantallaEmbudo() {
  const cliente = useQueryClient()

  const consulta = useQuery({ queryKey: CLAVE, queryFn: cargarTarjetas })

  const [filtros, setFiltros] = useState<Filtros>(filtrosVacios)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [columnaSobre, setColumnaSobre] = useState<string | null>(null)
  const [enVuelo, setEnVuelo] = useState<ReadonlySet<string>>(new Set())
  const [rechazo, setRechazo] = useState<Rechazo | null>(null)

  const mover = useMutation<void, Error, Movimiento, ContextoMovimiento>({
    mutationFn: async ({ id, estado }) => {
      const resultado = await moverOportunidad(id, estado)
      if (!resultado.ok) throw new Error(resultado.motivo)
    },

    onMutate: async ({ id, estado }) => {
      setRechazo(null)
      setEnVuelo((previo) => new Set(previo).add(id))

      // Sin esto, una recarga en curso podria pisar el movimiento optimista.
      await cliente.cancelQueries({ queryKey: CLAVE })

      const previo = cliente.getQueryData<Lote<Tarjeta>>(CLAVE)

      cliente.setQueryData<Lote<Tarjeta>>(CLAVE, (viejo) =>
        viejo === undefined
          ? viejo
          : {
              ...viejo,
              filas: viejo.filas.map((t) => (t.id === id ? { ...t, estado } : t)),
            },
      )

      return { previo }
    },

    onError: (error, variables, contexto) => {
      // 1 · La tarjeta vuelve a donde estaba.
      if (contexto?.previo !== undefined) {
        cliente.setQueryData<Lote<Tarjeta>>(CLAVE, contexto.previo)
      }

      // 2 · Y se dice por que, con nombre y apellidos del movimiento.
      const anterior = contexto?.previo?.filas.find((t) => t.id === variables.id)
      setRechazo({
        nombre: anterior?.nombreCompleto ?? 'La oportunidad',
        origen: etiquetaEstado(anterior?.estado ?? ''),
        destino: etiquetaEstado(variables.estado),
        motivo: error.message,
      })
    },

    onSettled: (_datos, _error, variables) => {
      setEnVuelo((previo) => {
        const siguiente = new Set(previo)
        siguiente.delete(variables.id)
        return siguiente
      })
      // Se vuelve a preguntar a la base en los dos casos. Tras un exito, para
      // traer lo que hayan cambiado los disparadores; tras un fallo, para no
      // quedarse con una foto reconstruida a mano.
      void cliente.invalidateQueries({ queryKey: CLAVE })
    },
  })

  const todas = consulta.data?.filas ?? []
  const visibles = aplicarFiltros(todas, filtros)

  function soltarEn(estado: EstadoEmbudo, id: string) {
    const tarjeta = todas.find((t) => t.id === id)
    if (tarjeta === undefined) return
    if (tarjeta.estado === estado) return
    mover.mutate({ id, estado })
  }

  return (
    <div className="w-full">
      <CabeceraPantalla
        titulo="Embudo"
        descripcion={
          <>
            Solo oportunidades <span className="font-bold text-cal">activas</span>. Arrastra una
            tarjeta a otra columna, o cambia su estado desde el desplegable de la propia tarjeta.
          </>
        }
      />

      <div className="mb-4">
        <FiltrosEmbudo
          filas={todas}
          filtros={filtros}
          alCambiar={setFiltros}
          total={todas.length}
          visibles={visibles.length}
        />
      </div>

      {rechazo !== null && <AvisoRechazo rechazo={rechazo} cerrar={() => setRechazo(null)} />}

      {consulta.isPending && (
        <p className="flex items-center gap-2 py-10 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Cargando el tablero…
        </p>
      )}

      {consulta.error !== null && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-4 text-sm font-bold text-alerta"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {consulta.error.message}
        </p>
      )}

      {consulta.error === null && !consulta.isPending && (
        <>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {ESTADOS.map((estado) => {
              const deLaColumna = visibles.filter((t) => t.estado === estado.valor)
              return (
                <ColumnaEmbudo
                  key={estado.valor}
                  estado={estado.valor}
                  etiqueta={estado.etiqueta}
                  corta={estado.corta}
                  conteo={deLaColumna.length}
                  sobre={columnaSobre === estado.valor}
                  alEntrar={() => setColumnaSobre(estado.valor)}
                  alSalir={() =>
                    setColumnaSobre((previo) => (previo === estado.valor ? null : previo))
                  }
                  alSoltar={(id) => soltarEn(estado.valor, id)}
                >
                  {deLaColumna.map((t) => (
                    <TarjetaEmbudo
                      key={t.id}
                      tarjeta={t}
                      arrastrando={arrastrando === t.id}
                      alEmpezarArrastre={() => setArrastrando(t.id)}
                      alTerminarArrastre={() => {
                        setArrastrando(null)
                        setColumnaSobre(null)
                      }}
                      alMover={(destino) => soltarEn(destino, t.id)}
                      ocupada={enVuelo.has(t.id)}
                    />
                  ))}

                  {deLaColumna.length === 0 && (
                    <li className="px-1 py-2 text-xs text-suelo-500">Sin oportunidades aquí.</li>
                  )}
                </ColumnaEmbudo>
              )
            })}
          </div>

          <Advertencias
            descartadas={consulta.data?.descartadas ?? 0}
            filas={todas.length}
            recargando={consulta.isFetching}
          />
        </>
      )}
    </div>
  )
}

/**
 * El motivo del rechazo. Se queda hasta que se cierra a mano: si desapareciera
 * solo, el arrastre volveria a fallar y nadie sabria por que.
 */
function AvisoRechazo({ rechazo, cerrar }: { rechazo: Rechazo; cerrar: () => void }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-md border border-alerta bg-alerta-suave p-4"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-alerta"
        strokeWidth={2}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-black text-alerta">
          La base rechazó el movimiento. {rechazo.nombre} sigue en «{rechazo.origen}».
        </p>
        <p className="mt-1 leading-snug text-suelo-700">
          Intento: {rechazo.origen} → {rechazo.destino}
        </p>
        <p className="mt-1 leading-snug text-foreground">{rechazo.motivo}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={cerrar} className="shrink-0">
        <X strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">Cerrar el aviso</span>
      </Button>
    </div>
  )
}

/** Lo que el tablero no puede callarse sobre sus propios datos. */
function Advertencias({
  descartadas,
  filas,
  recargando,
}: {
  descartadas: number
  filas: number
  recargando: boolean
}) {
  const enElTope = filas >= LIMITE_TARJETAS

  return (
    <div className="mt-2 space-y-2">
      {descartadas > 0 && (
        <p className="text-xs font-bold text-alerta">
          🔴 {descartadas}{' '}
          {descartadas === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer'} y no están en
          el tablero. Revisa el esquema antes de fiarte de estos conteos.
        </p>
      )}

      {enElTope && (
        <p className="text-xs font-bold text-suelo-700">
          🟡 Se alcanzó el tope de {LIMITE_TARJETAS} tarjetas por carga: el tablero puede estar
          incompleto y los conteos por columna también. Hay que paginar la consulta antes de
          seguir usándolo con este volumen.
        </p>
      )}

      <p className={cn('text-xs text-suelo-500', recargando && 'animate-pulse')}>
        Las tarjetas salen de <code>v_embudo_tarjetas</code>. Mover una tarjeta solo cambia{' '}
        <code>oportunidades.estado</code>: el historial lo escribe el disparador{' '}
        <code>t_oportunidad_historial</code> (R9).
        {recargando && ' · actualizando…'}
      </p>
    </div>
  )
}
