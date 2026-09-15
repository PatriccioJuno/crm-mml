import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Lock, Pencil } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import {
  SEMAFOROS_PARAMETRO,
  cargarParametros,
  simboloSemaforo,
  type EstadoSemaforo,
  type Parametro,
} from '@/lib/parametros'
import { DialogoParametro } from './DialogoParametro'

/**
 * PARÁMETROS — el único sitio del sistema donde puede vivir una cifra.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTA PANTALLA EXISTE
 * ---------------------------------------------------------------------------
 * Hasta el 14/09/2026 no había ninguna, y ratificar un parámetro significaba
 * escribir un `update` a mano en el panel de Supabase. Eso ponía a Dirección a
 * depender de que alguien le escribiera SQL para tomar una decisión que es
 * suya — justo el cuello de botella que el CRM viene a quitar, pero al revés.
 *
 * La política `parametros_escribir` (02-rls.sql) ya contemplaba esto desde el
 * principio: `for all to authenticated using (es(array['direccion']))`. La base
 * llevaba meses esperando esta pantalla; lo único que faltaba era escribirla.
 *
 * ---------------------------------------------------------------------------
 * AQUÍ SE VE EL VALOR CRUDO, Y ES A PROPÓSITO
 * ---------------------------------------------------------------------------
 * El resto del CRM usa `textoDeParametro` y enseña `[PENDIENTE]` cuando el
 * semáforo no permite afirmar la cifra. Esta pantalla NO: enseña lo que hay
 * escrito en la fila, aunque esté en 🔴. Es la pantalla donde se edita el dato,
 * y esconderle a quien lo edita lo que está editando sería absurdo.
 *
 * La diferencia importa y por eso se dice en voz alta debajo de la tabla: lo
 * que se ve aquí no es lo que ven las demás pantallas.
 */

const CLAVE = ['parametros'] as const

/** El filtro arranca en «todos»: ocultar por defecto es decidir por el otro. */
type Filtro = EstadoSemaforo | 'todos'

export function PantallaParametros() {
  const { rol } = useSesion()
  const cliente = useQueryClient()

  const consulta = useQuery({ queryKey: CLAVE, queryFn: cargarParametros })
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [editando, setEditando] = useState<Parametro | null>(null)

  // Comodidad, no seguridad: esconder el botón evita que los demás roles
  // pierdan el tiempo rellenando un formulario que la base va a rechazar.
  // Quien lo impide de verdad es `parametros_escribir`.
  const puedeEditar = rol === 'direccion'

  const filas = consulta.data?.filas ?? []
  const descartadas = consulta.data?.descartadas ?? 0
  const visibles = filtro === 'todos' ? filas : filas.filter((p) => p.estadoSemaforo === filtro)

  function contar(estado: EstadoSemaforo): number {
    return filas.filter((p) => p.estadoSemaforo === estado).length
  }

  const esperandoDecision = contar('azul') + contar('amarillo')

  return (
    <div className="space-y-6">
      <CabeceraPantalla
        titulo="Parámetros"
        descripcion={
          <span className="block max-w-3xl leading-relaxed">
            Ninguna cifra del negocio vive en el código: todas viven aquí, con su fuente y su
            semáforo. Cambiar un número en esta tabla lo cambia en todo el CRM.
          </span>
        }
      />

      {/* El filete de la izquierda es un ACENTO, no un contorno: va en azul
          pleno. El token `border` (azul al 10 %) es para contornos de tarjeta,
          y a 2 px de ancho no se veria. */}
      {!puedeEditar && (
        <p className="flex items-start gap-2 rounded-md border-l-2 border-azul bg-cal-200 px-4 py-3 text-sm leading-relaxed text-suelo-700">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          Puedes consultar los parámetros, pero solo Dirección los modifica. Es la misma regla que
          impide que un vendedor cambie un precio.
        </p>
      )}

      {/* ---- FILTROS · también son el resumen del estado del negocio ---- */}
      <div className="flex flex-wrap gap-2">
        <Chip activo={filtro === 'todos'} alPulsar={() => setFiltro('todos')}>
          Todos ({filas.length})
        </Chip>
        {SEMAFOROS_PARAMETRO.map((s) => (
          <Chip
            key={s.valor}
            activo={filtro === s.valor}
            alPulsar={() => setFiltro(s.valor)}
            deshabilitado={contar(s.valor) === 0}
          >
            {simboloSemaforo(s.valor)} {s.etiqueta} ({contar(s.valor)})
          </Chip>
        ))}
      </div>

      {esperandoDecision > 0 && filtro === 'todos' && (
        <p className="text-sm font-bold text-suelo-700">
          {esperandoDecision === 1
            ? 'Hay 1 parámetro esperando una decisión de Dirección.'
            : `Hay ${esperandoDecision} parámetros esperando una decisión de Dirección.`}
        </p>
      )}

      {consulta.error !== null && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {consulta.error.message}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-input">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10" />
              <TableHead>Parámetro</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Fuente</TableHead>
              {puedeEditar && <TableHead className="w-16 text-right">Editar</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {consulta.isPending && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={puedeEditar ? 5 : 4} className="py-10 text-center text-sm">
                  <Loader2
                    className="mx-auto h-4 w-4 animate-spin"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </TableCell>
              </TableRow>
            )}

            {!consulta.isPending && visibles.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={puedeEditar ? 5 : 4}
                  className="py-10 text-center text-sm text-suelo-500"
                >
                  Ningún parámetro en ese estado.
                </TableCell>
              </TableRow>
            )}

            {visibles.map((p) => (
              <Fila
                key={p.id}
                parametro={p}
                puedeEditar={puedeEditar}
                editar={() => setEditando(p)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* La regla de src/lib/lectura.ts: nunca se muestra un conteo que se
          calle lo que falta. */}
      {descartadas > 0 && (
        <p className="text-xs font-bold text-alerta">
          {descartadas} fila(s) llegaron de la base en un formato que este cliente no reconoce y no
          se están mostrando.
        </p>
      )}

      <p className="max-w-3xl text-xs leading-relaxed text-suelo-500">
        Esta tabla enseña el valor tal como está guardado, incluso en 🔴. Las demás pantallas no:
        allí un parámetro que no está en 🟢 se muestra como{' '}
        <code>[PENDIENTE — ver 00-fuente-de-verdad]</code>, para que nadie cotice con una cifra que
        nadie ha confirmado.
      </p>

      {editando !== null && (
        <DialogoParametro
          parametro={editando}
          cerrar={() => setEditando(null)}
          alGuardar={() => {
            setEditando(null)
            void cliente.invalidateQueries({ queryKey: CLAVE })
          }}
        />
      )}
    </div>
  )
}

function Fila({
  parametro,
  puedeEditar,
  editar,
}: {
  parametro: Parametro
  puedeEditar: boolean
  editar: () => void
}) {
  const sinValor = valorCrudo(parametro) === null

  return (
    <TableRow>
      <TableCell className="text-base leading-none">
        <span title={parametro.estadoSemaforo}>{simboloSemaforo(parametro.estadoSemaforo)}</span>
      </TableCell>

      <TableCell>
        <p className="font-mono text-xs font-bold text-foreground">{parametro.id}</p>
        <p className="mt-0.5 max-w-md text-xs leading-snug text-suelo-700">
          {parametro.descripcion}
        </p>
      </TableCell>

      <TableCell className="whitespace-nowrap">
        {sinValor ? (
          <span className="text-xs text-suelo-500">— sin cargar —</span>
        ) : (
          <span className="text-sm font-bold tabular-nums text-foreground">
            {valorCrudo(parametro)}
            {parametro.unidad !== null && (
              <span className="ml-1 text-xs font-normal text-suelo-500">{parametro.unidad}</span>
            )}
          </span>
        )}
      </TableCell>

      <TableCell>
        <p className="max-w-sm text-xs leading-snug text-suelo-700">{parametro.fuente}</p>
      </TableCell>

      {puedeEditar && (
        <TableCell className="text-right">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={editar}
            aria-label={`Editar ${parametro.id}`}
          >
            <Pencil className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}

/**
 * El valor REAL de la fila, sin pasar por el semáforo. Devuelve `null` cuando
 * las cuatro columnas están vacías — que es distinto de «no se puede usar».
 */
function valorCrudo(p: Parametro): string | null {
  if (p.valorEntero !== null) return String(p.valorEntero)
  if (p.valorNumerico !== null) {
    return p.valorMoneda === null
      ? String(p.valorNumerico)
      : `${p.valorMoneda} ${String(p.valorNumerico)}`
  }
  if (p.valorTexto !== null) return p.valorTexto
  return null
}

function Chip({
  activo,
  alPulsar,
  deshabilitado = false,
  children,
}: {
  activo: boolean
  alPulsar: () => void
  deshabilitado?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={alPulsar}
      disabled={deshabilitado}
      aria-pressed={activo}
      className={cn(
        'rounded-md border px-3 py-1.5 text-xs font-bold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-40',
        activo
          ? 'border-azul bg-azul text-cal'
          : 'border-input bg-transparent text-suelo-700 hover:bg-cal-200',
      )}
    >
      {children}
    </button>
  )
}
