import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Lock, Pencil, Plus } from 'lucide-react'
import { CabeceraPantalla } from '@/componentes/marca/CabeceraPantalla'
import { Button } from '@/componentes/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/componentes/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/componentes/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import {
  AVISO_INVENTARIO_BLOQUEADO,
  FUENTE_INVENTARIO,
  LIMITE_UNIDADES,
  SEMAFORO_DATO,
  cargarUnidades,
  esSeleccionable,
  esSemaforo,
  leerEstadoComercial,
  motivosNoOfrecible,
  puedeMantenerInventario,
  type Unidad,
} from '@/lib/inventario'
import { FormularioUnidad } from './FormularioUnidad'

/**
 * INVENTARIO — la defensa visible contra la doble asignación.
 *
 * ---------------------------------------------------------------------------
 * LA PANTALLA NO DECIDE NADA
 * ---------------------------------------------------------------------------
 * Que una unidad se pueda ofrecer lo decide `v_unidades_ofrecibles`
 * (03-vistas.sql §7), que exige LAS DOS cosas del Acta 03-O02: estado comercial
 * disponible Y dato verde contra plano, y ademas que no haya ni asignacion
 * activa ni separacion viva. Esta pantalla lee esa respuesta en la columna
 * `ofrecible` de `v_unidades_tablero` y la obedece: la fila que no es ofrecible
 * sale en gris y su casilla esta desactivada. No hay ninguna copia de esa
 * regla en este archivo, ni un `if` que la reconstruya.
 *
 * Lo unico que anade la pantalla es la EXPLICACION. Una fila apagada sin
 * motivo se lee como un fallo del sistema y acaba en «preguntale a Walter»,
 * que es el cuello de botella que el CRM viene a quitar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EL AVISO DE ARRIBA NO SE PUEDE CERRAR
 * ---------------------------------------------------------------------------
 * Porque el bloqueo del inventario maestro no es un incidente pasajero: es el
 * estado actual del proyecto, con cuatro cifras en conflicto y sin plano
 * vigente. Un aviso que se cierra se cierra el primer dia y no se vuelve a
 * leer. Se ira cuando se vaya el problema, y el problema se documenta en
 * 00-fuente-de-verdad\inventario-maestro.md, no aqui.
 */

const CLAVE = ['inventario', 'unidades'] as const

export function PantallaInventario() {
  const { rol } = useSesion()
  const cliente = useQueryClient()

  const consulta = useQuery({ queryKey: CLAVE, queryFn: cargarUnidades })

  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  /** `undefined` = cerrado · `null` = alta · `Unidad` = edicion. */
  const [editando, setEditando] = useState<Unidad | null | undefined>(undefined)

  const mantiene = puedeMantenerInventario(rol)
  const unidades = consulta.data?.filas ?? []
  const elegida = unidades.find((u) => u.id === seleccionada) ?? null

  return (
    <div className="w-full">
      <CabeceraPantalla
        titulo="Inventario"
        descripcion="Dos semáforos por fila: el estado comercial y el estado del dato."
        acciones={
          /* Alta: solo dirección y administración, copiado de `unidades_escribir`.
             Esconderlo no protege nada — lo protege RLS. Evita ofrecer un
             formulario que iba a fallar al guardar. */
          mantiene ? (
            <Button variant="ambar" onClick={() => setEditando(null)}>
              <Plus strokeWidth={2} aria-hidden="true" />
              Nueva unidad
            </Button>
          ) : undefined
        }
      />

      <AvisoBloqueo />

      <Leyenda />

      {consulta.isPending && (
        <p className="flex items-center gap-2 py-10 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Cargando el inventario…
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
        <TooltipProvider delayDuration={150}>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12">
                    <span className="sr-only">Seleccionar para asignar</span>
                  </TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Área m²</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Estado comercial</TableHead>
                  <TableHead>Estado del dato</TableHead>
                  <TableHead>¿Se puede ofrecer?</TableHead>
                  {mantiene && (
                    <TableHead className="w-16">
                      <span className="sr-only">Editar</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>

              <TableBody>
                {unidades.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={mantiene ? 9 : 8} className="py-10 text-center text-sm">
                      <p className="font-bold text-foreground">No hay ninguna unidad cargada.</p>
                      <p className="mt-1 text-suelo-500">
                        La tabla <code>unidades</code> nace vacía a propósito: hay 4 cifras en
                        conflicto y no se va a crear la quinta. Se cargan una por una, cada una
                        con su plano.
                      </p>
                    </TableCell>
                  </TableRow>
                )}

                {unidades.map((u) => (
                  <FilaUnidad
                    key={u.id}
                    unidad={u}
                    seleccionada={seleccionada === u.id}
                    alSeleccionar={() => setSeleccionada(u.id)}
                    mantiene={mantiene}
                    alEditar={() => setEditando(u)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>
      )}

      <BarraSeleccion unidad={elegida} alQuitar={() => setSeleccionada(null)} />

      <Advertencias
        descartadas={consulta.data?.descartadas ?? 0}
        filas={unidades.length}
      />

      {editando !== undefined && (
        <FormularioUnidad
          unidad={editando}
          cerrar={() => setEditando(undefined)}
          alGuardar={() => {
            setEditando(undefined)
            void cliente.invalidateQueries({ queryKey: CLAVE })
          }}
        />
      )}
    </div>
  )
}

/**
 * El aviso permanente. Texto y fuente vienen de src/lib/inventario.ts: es una
 * afirmacion sobre el negocio y tiene que poder rastrearse hasta su archivo.
 */
function AvisoBloqueo() {
  return (
    <div
      role="note"
      className="mb-4 flex items-start gap-3 rounded-md border border-alerta bg-alerta-suave p-4"
    >
      <span className="mt-0.5 text-base leading-none" aria-hidden="true">
        🔴
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-bold leading-snug text-alerta">{AVISO_INVENTARIO_BLOQUEADO}</p>
        <p className="mt-1 text-xs text-suelo-700">
          Fuente: <code>{FUENTE_INVENTARIO}</code>
        </p>
      </div>
    </div>
  )
}

/** Qué significa cada símbolo. Sin esto, el semáforo comercial es adivinanza. */
function Leyenda() {
  return (
    <p className="mb-3 text-xs leading-relaxed text-suelo-500">
      <span className="font-bold text-suelo-700">Estado comercial</span> — ¿se puede ofrecer hoy?:
      🟢 libre · 🟡 bloqueo temporal · ⚫ ya colocada · 🔴 fuera de venta.{' '}
      <span className="font-bold text-suelo-700">Estado del dato</span> — 🟢 verificada contra
      plano · 🟡 por validar · 🔴 sin verificar · 🔵 propuesta · ⚫ histórico.
    </p>
  )
}

function FilaUnidad({
  unidad,
  seleccionada,
  alSeleccionar,
  mantiene,
  alEditar,
}: {
  unidad: Unidad
  seleccionada: boolean
  alSeleccionar: () => void
  mantiene: boolean
  alEditar: () => void
}) {
  const u = unidad
  const ofrecible = esSeleccionable(u)
  const motivos = motivosNoOfrecible(u)
  const comercial = leerEstadoComercial(u.estadoComercial)
  const dato = esSemaforo(u.estadoDato)
    ? SEMAFORO_DATO[u.estadoDato]
    : { simbolo: '❔', etiqueta: u.estadoDato }

  return (
    <TableRow
      // Gris, no invisible: la unidad existe y hay que poder verla. Lo que no
      // se puede es elegirla.
      className={cn(!ofrecible && 'bg-cal-200/50 text-suelo-500')}
      data-ofrecible={ofrecible}
    >
      <TableCell>
        {ofrecible ? (
          <label className="flex cursor-pointer items-center justify-center">
            <span className="sr-only">Seleccionar la unidad {u.codigoUnidad}</span>
            <input
              type="radio"
              name="unidad-seleccionada"
              checked={seleccionada}
              onChange={alSeleccionar}
              className="h-4 w-4 accent-azul"
            />
          </label>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="flex cursor-not-allowed items-center justify-center"
                tabIndex={0}
                aria-label={`${u.codigoUnidad} no se puede asignar: ${motivos.join('; ')}`}
              >
                <Lock className="h-4 w-4 text-suelo-500" strokeWidth={1.75} aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              <p className="font-bold">No se puede asignar</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {motivos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
      </TableCell>

      <TableCell className="font-bold text-foreground">
        <span className={cn(!ofrecible && 'text-suelo-500')}>{u.codigoUnidad}</span>
      </TableCell>

      <TableCell>{u.tipo ?? '—'}</TableCell>

      <TableCell className="text-right tabular-nums">{u.areaM2 ?? '—'}</TableCell>

      <TableCell className="text-xs">{textoUbicacion(u)}</TableCell>

      <TableCell>
        <span className="whitespace-nowrap">
          <span aria-hidden="true">{comercial.simbolo}</span>{' '}
          <span className="text-xs">{comercial.etiqueta}</span>
        </span>
      </TableCell>

      <TableCell>
        <span className="whitespace-nowrap">
          <span aria-hidden="true">{dato.simbolo}</span>{' '}
          <span className="text-xs">{dato.etiqueta}</span>
        </span>
      </TableCell>

      <TableCell className="max-w-64">
        {ofrecible ? (
          <span className="text-xs font-bold text-foreground">Sí</span>
        ) : (
          <>
            <span className="text-xs font-bold">No</span>
            {/* Tambien visible, no solo al pasar el cursor: en una tableta no
                hay cursor que pasar. */}
            <span className="block text-xs leading-snug">{motivos.join(' · ')}</span>
          </>
        )}
      </TableCell>

      {mantiene && (
        <TableCell>
          <Button variant="ghost" size="sm" onClick={alEditar}>
            <Pencil strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">Editar la unidad {u.codigoUnidad}</span>
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}

function textoUbicacion(u: Unidad): string {
  const partes = [u.etapa, u.bloque, u.ubicacion].filter((p): p is string => p !== null)
  return partes.length === 0 ? '—' : partes.join(' · ')
}

/**
 * Que pasa con la unidad elegida.
 *
 * Se dice exactamente lo que hay: la seleccion esta hecha, y la asignacion a
 * una oportunidad se hace desde la ficha de la persona, que todavia no esta
 * escrita. Un boton que pareciera funcionar y no hiciera nada seria peor que
 * este parrafo.
 */
function BarraSeleccion({ unidad, alQuitar }: { unidad: Unidad | null; alQuitar: () => void }) {
  if (unidad === null) return null

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-azul px-4 py-3">
      <p className="text-sm text-cal">
        Unidad seleccionada: <span className="font-black">{unidad.codigoUnidad}</span>
        <span className="mt-0.5 block text-xs text-azul-300">
          🔴 Asignarla a una oportunidad se hace desde la ficha de la persona, que todavía no está
          escrita. La comprobación que la habilita ya está: sale de{' '}
          <code>v_unidades_ofrecibles</code>.
        </span>
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={alQuitar}
        className="text-cal hover:bg-azul-600 hover:text-cal"
      >
        Quitar la selección
      </Button>
    </div>
  )
}

function Advertencias({ descartadas, filas }: { descartadas: number; filas: number }) {
  return (
    <div className="mt-3 space-y-2">
      {descartadas > 0 && (
        <p className="text-xs font-bold text-alerta">
          🔴 {descartadas}{' '}
          {descartadas === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer'} y no están en
          la tabla. Revisa el esquema antes de fiarte de este inventario.
        </p>
      )}

      {filas >= LIMITE_UNIDADES && (
        <p className="text-xs font-bold text-suelo-700">
          🟡 Se alcanzó el tope de {LIMITE_UNIDADES} unidades por carga: la tabla puede estar
          incompleta. Hay que paginar la consulta antes de seguir usándola con este volumen.
        </p>
      )}

      <p className="text-xs text-suelo-500">
        Las filas salen de <code>v_unidades_tablero</code> y la columna «¿Se puede ofrecer?» la
        decide <code>v_unidades_ofrecibles</code>. Ningún precio se muestra aquí: el de cada
        unidad es un puntero a <code>parametros</code>.
      </p>
    </div>
  )
}
