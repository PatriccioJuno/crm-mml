import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Loader2, Plus, ShieldCheck } from 'lucide-react'
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
import { useSesion } from '@/auth/ContextoSesion'
import { formatearMonto } from '@/lib/dinero'
import {
  cargarBandeja,
  etiquetaEstadoSeparacion,
  type SeparacionVigilada,
} from '@/lib/separaciones'
import { AvisoDosRelojes, ValorReloj } from './RelojesSeparacion'

/**
 * BANDEJA DE SEPARACIONES — qué vence antes y a quién le toca.
 *
 * ===========================================================================
 * DOS COLUMNAS, NUNCA UNA                                               (R4)
 * ===========================================================================
 * Los dos plazos salen en dos columnas con nombre propio. Es deliberado que la
 * tabla sea más ancha por eso: una sola columna «vence en N días» obligaría a
 * elegir uno de los dos relojes, y el que se quedara fuera sería invisible
 * justo el día que importara.
 *
 * El orden SÍ mira los dos a la vez —`relojMasCercano`, en
 * src/lib/separaciones.ts— porque «ordenada por el reloj que vence antes» no se
 * puede hacer de otra forma. Pero ese número no se enseña en ningún sitio: una
 * fila puede estar arriba por el reloj 1 y ser el 2 el que no corre prisa, y
 * quien mire la tabla tiene que poder verlo.
 *
 * ===========================================================================
 * LO QUE ESTA LISTA NO ES
 * ===========================================================================
 * No es «todas las separaciones». `v_separaciones_vigilancia` solo trae las
 * vivas (pendientes de verificar y verificadas): las devueltas, vencidas y
 * aplicadas a contrato quedan fuera por definición de la vista. Se dice al pie
 * para que nadie cuente filas aquí y crea que tiene un total.
 */

const CLAVE = ['separaciones', 'bandeja'] as const

/** `sep_crear` de 02-rls.sql. Copiado de allí, no decidido aquí. */
const REGISTRAN: readonly string[] = ['direccion', 'comercial', 'administracion']

export function PantallaSeparaciones() {
  const { rol } = useSesion()
  const consulta = useQuery({ queryKey: CLAVE, queryFn: cargarBandeja })

  const filas = consulta.data?.filas ?? []
  const pendientes = filas.filter((s) => s.esperaVerificacion).length

  return (
    <div className="w-full">
      <CabeceraPantalla
        titulo="Separaciones"
        descripcion="Ordenadas por el plazo que vence antes. Los dos relojes van por separado."
        acciones={
          rol !== null && REGISTRAN.includes(rol) ? (
            <Button asChild variant="ambar">
              <Link to="/separaciones/nueva">
                <Plus strokeWidth={2} aria-hidden="true" />
                Nueva separación
              </Link>
            </Button>
          ) : undefined
        }
      />

      <AvisoDosRelojes className="mb-4" />

      {pendientes > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-border bg-card p-3 text-sm">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-suelo-700"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="leading-snug">
            <span className="font-bold text-foreground">
              {pendientes === 1
                ? '1 separación espera la verificación de Dirección.'
                : `${pendientes} separaciones esperan la verificación de Dirección.`}
            </span>{' '}
            <span className="text-suelo-700">
              Hasta que Walter verifique no se emite constancia ni recibo (Acta 03-O02, reglas R2
              y R3).
            </span>
          </span>
        </p>
      )}

      {consulta.isPending && (
        <p className="flex items-center gap-2 py-10 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Cargando la bandeja…
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
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Persona</TableHead>
                <TableHead>Unidad</TableHead>
                <TableHead>Monto</TableHead>
                <TableHead>Estado</TableHead>
                {/* Los dos encabezados dicen su número y de dónde sale su
                    fecha. Sin eso, dos columnas de fechas se leen como el
                    «desde» y el «hasta» de un mismo plazo, que es justo el
                    error que R4 existe para impedir. */}
                <TableHead className="min-w-44">
                  Reloj 1 · Derecho de devolución
                  <span className="block text-xs font-normal text-suelo-500">
                    desde el depósito efectivo · lo calcula la base
                  </span>
                </TableHead>
                <TableHead className="min-w-44">
                  Reloj 2 · Vigencia del precio
                  <span className="block text-xs font-normal text-suelo-500">
                    campo independiente · lo escribe una persona
                  </span>
                </TableHead>
                <TableHead>Falta por verificar</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">Abrir la ficha</span>
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filas.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="py-10 text-center text-sm">
                    <p className="font-bold text-foreground">No hay ninguna separación viva.</p>
                    <p className="mt-1 text-suelo-500">
                      Esta bandeja solo vigila las pendientes de verificar y las verificadas.
                    </p>
                  </TableCell>
                </TableRow>
              )}

              {filas.map((s) => (
                <FilaSeparacion key={s.id} separacion={s} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Pie descartadas={consulta.data?.descartadas ?? 0} />
    </div>
  )
}

function FilaSeparacion({ separacion }: { separacion: SeparacionVigilada }) {
  const s = separacion

  return (
    <TableRow>
      <TableCell className="font-bold text-foreground">{s.nombreCompleto}</TableCell>

      <TableCell className="text-sm">
        {s.codigoUnidad ?? (
          // Una separación sin unidad no bloquea nada en el inventario: se
          // avisa aquí, que es donde se ve la lista entera y se nota el hueco.
          <span className="text-xs font-bold text-suelo-700">🟡 sin unidad</span>
        )}
      </TableCell>

      {/* R7: el monto nunca sale sin su moneda. `formatearMonto` marca el hueco
          cuando la moneda falta, en vez de suponer soles. */}
      <TableCell className="whitespace-nowrap tabular-nums">
        {formatearMonto(s.monto, s.montoMoneda)}
      </TableCell>

      <TableCell className="text-sm">{etiquetaEstadoSeparacion(s.estado)}</TableCell>

      <TableCell>
        <ValorReloj
          fechaLimite={s.fechaLimiteDevolucion}
          dias={s.diasParaFinDevolucion}
          textoSinFecha="Sin depósito efectivo: no ha empezado a correr."
        />
      </TableCell>

      <TableCell>
        <ValorReloj
          fechaLimite={s.fechaLimitePrecio}
          dias={s.diasParaFinPrecio}
          textoSinFecha="Sin fecha escrita todavía."
        />
      </TableCell>

      <TableCell className="max-w-56 text-xs leading-snug">
        {s.esperaVerificacion ? (
          <span className="font-bold text-foreground">
            Dirección (Walter).
            <span className="mt-0.5 block font-normal text-suelo-700">
              Acta 03-O02: es el único verificador del depósito.
            </span>
          </span>
        ) : (
          <span className="text-suelo-700">
            Nadie: ya está verificada.
            <span className="mt-0.5 block">
              {s.puedeEmitirConstancia === true
                ? 'Se puede emitir la constancia.'
                : 'Aun así, la constancia sigue bloqueada — mira la ficha.'}
            </span>
          </span>
        )}
      </TableCell>

      <TableCell>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/separaciones/${s.id}`}>
            Abrir
            <ArrowRight strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

function Pie({ descartadas }: { descartadas: number }) {
  return (
    <div className="mt-3 space-y-2">
      {descartadas > 0 && (
        <p className="text-xs font-bold text-alerta">
          🔴 {descartadas}{' '}
          {descartadas === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer'} y no están en
          la tabla. En una bandeja que vigila plazos legales, una fila que falta es un plazo que
          nadie está mirando: revisa el esquema antes de fiarte de esta lista.
        </p>
      )}

      <p className="text-xs leading-relaxed text-suelo-500">
        Las filas salen de <code>v_separaciones_vigilancia</code>, que solo trae las separaciones
        en <span className="font-bold">pendiente de verificación</span> y{' '}
        <span className="font-bold">verificada</span>. Las devueltas, vencidas y aplicadas a
        contrato no están aquí: esto no es un total de separaciones. Los días de cada reloj los
        resta la vista contra la fecha del servidor, no contra el reloj de este equipo.
      </p>
    </div>
  )
}
