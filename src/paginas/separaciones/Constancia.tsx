import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Loader2, Printer } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { formatearMonto } from '@/lib/dinero'
import { fechaHora, fechaLarga } from '@/lib/fechas'
import {
  PARAMETRO,
  PARAMETROS_DE_LA_CONSTANCIA,
  cargarSeparacion,
  puedeEmitirConstancia,
  type SeparacionCompleta,
} from '@/lib/separaciones'
import {
  PENDIENTE,
  cargarParametrosPorId,
  sePuedeProponer,
  simboloSemaforo,
  textoDeParametro,
  type Parametro,
} from '@/lib/parametros'

/**
 * CONSTANCIA DE SEPARACIÓN — vista imprimible, en HTML.
 *
 * ===========================================================================
 * AQUÍ NO SE ESCRIBE NI UNA CLÁUSULA
 * ===========================================================================
 * El texto legal de la constancia NO existe todavía. Lo que se imprime en su
 * lugar es el marcador «[PENDIENTE: cláusulas aprobadas]», bien visible, y no
 * un párrafo verosímil redactado por un programa. Un documento que se le
 * entrega a alguien que acaba de pagar no puede llevar texto inventado: sería
 * el mismo error que produjo las 4 políticas de financiamiento en conflicto
 * que documenta 00-fuente-de-verdad, pero con una firma debajo.
 *
 * Lo mismo con la razón social, el RUC y la naturaleza jurídica del producto:
 * se traen de `parametros`, y hoy los tres están en 🔴 rojo
 * (04-seed-parametros.sql). Mientras sigan así, en su hueco va el marcador de
 * pendiente. La naturaleza jurídica es además el riesgo más alto del pitch —
 * lo que se transfiere son acciones y derechos sobre el inmueble matriz, no
 * propiedad independizada— y su parámetro dice literalmente que ese texto debe
 * salir LITERAL y no parafraseado. Por eso se imprime tal cual llega, sin
 * retoques.
 *
 * ===========================================================================
 * SE VUELVE A PREGUNTAR SI SE PUEDE EMITIR                              (R3)
 * ===========================================================================
 * La ficha ya deshabilita el botón, pero a esta ruta se puede llegar
 * escribiéndola. Así que aquí se le pregunta otra vez a
 * `puede_emitir_constancia(id)`, y mientras la respuesta no sea un sí claro no
 * se dibuja el documento. La duda, en un recibo, se resuelve no imprimiendo.
 *
 * Es HTML y no PDF a propósito: un PDF con huecos pendientes parece definitivo.
 * Esto se imprime desde el navegador, y se ve lo que falta.
 */

export function Constancia() {
  const { separacionId } = useParams<{ separacionId: string }>()
  const id = separacionId ?? ''

  const separacion = useQuery({
    queryKey: ['separaciones', 'ficha', id],
    queryFn: () => cargarSeparacion(id),
    enabled: id !== '',
  })

  const permiso = useQuery({
    queryKey: ['separaciones', 'puede-constancia', id],
    queryFn: () => puedeEmitirConstancia(id),
    enabled: id !== '',
  })

  const parametros = useQuery({
    queryKey: ['parametros', PARAMETROS_DE_LA_CONSTANCIA],
    queryFn: () => cargarParametrosPorId(PARAMETROS_DE_LA_CONSTANCIA),
  })

  const cargando = separacion.isPending || permiso.isPending || parametros.isPending

  if (cargando) {
    return (
      <Marco>
        <p className="flex items-center gap-2 py-10 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Comprobando con la base si esta constancia se puede emitir…
        </p>
      </Marco>
    )
  }

  const error = separacion.error ?? parametros.error
  if (error !== null) {
    return (
      <Marco>
        <Bloqueo titulo="No se pudo preparar la constancia" detalle={error.message} />
      </Marco>
    )
  }

  const s = separacion.data ?? null
  if (s === null) {
    return (
      <Marco>
        <Bloqueo
          titulo="Esa separación no existe, o tu rol no puede leerla"
          detalle="Política sep_leer de 02-rls.sql."
        />
      </Marco>
    )
  }

  // R3, otra vez y en serio: sin el sí de la función, no hay documento.
  if (permiso.data !== true) {
    return (
      <Marco>
        <Bloqueo
          titulo="Esta constancia todavía no se puede emitir"
          detalle={
            'Pendiente de verificación de Walter (Acta 03-O02). La función ' +
            'puede_emitir_constancia() de la base dice que no, y esta pantalla no la discute.'
          }
        />
        <Button variant="secondary" asChild className="mt-4">
          <Link to={`/separaciones/${id}`}>
            <ArrowLeft strokeWidth={1.75} aria-hidden="true" />
            Volver a la ficha
          </Link>
        </Button>
      </Marco>
    )
  }

  const razonSocial = parametros.data?.[PARAMETRO.razonSocial] ?? null
  const ruc = parametros.data?.[PARAMETRO.ruc] ?? null
  const naturaleza = parametros.data?.[PARAMETRO.naturalezaJuridica] ?? null

  return (
    <Marco>
      <BarraDeAcciones separacionId={s.id} />
      <Documento
        separacion={s}
        razonSocial={razonSocial}
        ruc={ruc}
        naturaleza={naturaleza}
      />
    </Marco>
  )
}

// ---------------------------------------------------------------------------
// El documento
// ---------------------------------------------------------------------------

function Documento({
  separacion,
  razonSocial,
  ruc,
  naturaleza,
}: {
  separacion: SeparacionCompleta
  razonSocial: Parametro | null
  ruc: Parametro | null
  naturaleza: Parametro | null
}) {
  const s = separacion
  const huecos = [razonSocial, ruc, naturaleza].filter((p) => !sePuedeProponer(p)).length

  return (
    <article className="mx-auto max-w-[21cm] bg-white p-10 text-suelo shadow-sm print:max-w-none print:p-0 print:shadow-none">
      {/* ---- EMISOR ---- */}
      <header className="border-b border-cal-300 pb-4">
        <h1 className="text-xl font-black tracking-tight">Constancia de separación</h1>
        <p className="mt-2 text-sm">
          <span className="font-bold">Emite: </span>
          <ValorParametro parametro={razonSocial} />
        </p>
        <p className="text-sm">
          <span className="font-bold">RUC: </span>
          <ValorParametro parametro={ruc} />
        </p>
        <p className="mt-2 text-xs text-suelo-700">
          Proyecto Mercado Media Luna · Constancia n.º <span className="tabular-nums">{s.id}</span>
        </p>
      </header>

      {/* ---- QUIÉN SEPARA ---- */}
      <section className="mt-6">
        <h2 className="text-sm font-black uppercase tracking-wide">Quien separa</h2>
        <dl className="mt-2 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Linea etiqueta="Nombre">{s.nombreCompleto ?? '[PENDIENTE]'}</Linea>
          <Linea etiqueta="Documento">
            {s.docTipo === null || s.docNumero === null
              ? '[PENDIENTE]'
              : `${s.docTipo.toUpperCase()} ${s.docNumero}`}
          </Linea>
          <Linea etiqueta="Unidad separada">
            {s.codigoUnidad ?? 'Sin unidad asignada en el momento de emitir'}
          </Linea>
        </dl>
      </section>

      {/* ---- EL DEPÓSITO ---- */}
      <section className="mt-6">
        <h2 className="text-sm font-black uppercase tracking-wide">El depósito recibido</h2>
        <dl className="mt-2 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {/* R7: el monto nunca va sin su moneda, tampoco impreso. */}
          <Linea etiqueta="Monto">
            <span className="font-black tabular-nums">
              {formatearMonto(s.monto, s.montoMoneda)}
            </span>
          </Linea>
          <Linea etiqueta="Banco">{s.banco ?? '[PENDIENTE]'}</Linea>
          <Linea etiqueta="Número de operación">
            <span className="tabular-nums">{s.nroOperacion ?? '[PENDIENTE]'}</span>
          </Linea>
          <Linea etiqueta="Fecha de depósito efectivo">
            {s.fechaDepositoEfectivo === null
              ? '[PENDIENTE]'
              : fechaLarga(s.fechaDepositoEfectivo)}
          </Linea>
          <Linea etiqueta="Verificado por Dirección el">{fechaHora(s.verificadaEl)}</Linea>
        </dl>
      </section>

      {/* ---- LOS DOS PLAZOS, SEPARADOS TAMBIÉN EN PAPEL ---- */}
      <section className="mt-6">
        <h2 className="text-sm font-black uppercase tracking-wide">Los dos plazos</h2>
        <p className="mt-1 text-xs font-bold">
          Son dos plazos distintos. No se calculan uno del otro.
        </p>

        {/* Dos bloques con borde propio: en papel, dos fechas seguidas en un
            párrafo se leen como el «desde» y el «hasta» de un mismo plazo. */}
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="border border-cal-300 p-3">
            <p className="text-xs font-black uppercase tracking-wide text-suelo-700">
              Plazo 1 · Derecho de devolución
            </p>
            <p className="mt-1 text-sm">
              Se cuenta desde la fecha de depósito efectivo. Vence el{' '}
              <span className="font-black">
                {s.fechaLimiteDevolucion === null
                  ? '[PENDIENTE]'
                  : fechaLarga(s.fechaLimiteDevolucion)}
              </span>
              .
            </p>
          </div>

          <div className="border border-cal-300 p-3">
            <p className="text-xs font-black uppercase tracking-wide text-suelo-700">
              Plazo 2 · Vigencia del precio post-evento
            </p>
            <p className="mt-1 text-sm">
              Plazo independiente del anterior. Vence el{' '}
              <span className="font-black">
                {s.fechaLimitePrecio === null ? '[PENDIENTE]' : fechaLarga(s.fechaLimitePrecio)}
              </span>
              .
            </p>
          </div>
        </div>
      </section>

      {/* ---- QUÉ SE TRANSFIERE ---- */}
      <section className="mt-6">
        <h2 className="text-sm font-black uppercase tracking-wide">
          Naturaleza jurídica de lo que se adquiere
        </h2>
        {/* LITERAL. El parámetro dice expresamente que este texto no se
            parafrasea: es el riesgo más alto del pitch. */}
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
          <ValorParametro parametro={naturaleza} />
        </p>
      </section>

      {/* ---- CLÁUSULAS ---- */}
      <section className="mt-6">
        <h2 className="text-sm font-black uppercase tracking-wide">Condiciones</h2>
        <p className="mt-2 border border-suelo p-3 text-sm font-black">
          [PENDIENTE: cláusulas aprobadas]
        </p>
        <p className="mt-1 text-xs text-suelo-700">
          Este documento no lleva texto de condiciones porque todavía no hay uno aprobado. No se
          redacta aquí: se pega cuando exista, y mientras tanto el hueco se ve.
        </p>
      </section>

      {/* ---- FIRMAS ---- */}
      <section className="mt-10 grid gap-10 text-xs sm:grid-cols-2">
        <div className="border-t border-suelo pt-2">
          Por {textoCorto(razonSocial)} — Dirección
        </div>
        <div className="border-t border-suelo pt-2">
          {s.nombreCompleto ?? 'El adquirente'}
        </div>
      </section>

      {huecos > 0 && (
        <p className="mt-6 border border-suelo p-3 text-xs font-black leading-snug">
          🔴 Este documento sale con {huecos}{' '}
          {huecos === 1 ? 'dato pendiente' : 'datos pendientes'} de la ficha del proyecto, más las
          cláusulas. No está listo para entregarse a un cliente: se imprime así para poder
          revisarlo, no para firmarlo. Lo que falta se carga en <code>parametros</code> desde
          00-fuente-de-verdad.
        </p>
      )}
    </article>
  )
}

/**
 * Un valor de `parametros`, o el marcador de pendiente.
 *
 * Cuando el parámetro no está en 🟢 verde pero sí se puede proponer, el símbolo
 * del semáforo se imprime junto al valor: en un papel que va a leer un
 * cliente, «no confirmado» tiene que verse, no quedarse en la pantalla de
 * quien lo emitió.
 */
function ValorParametro({ parametro }: { parametro: Parametro | null }) {
  if (!sePuedeProponer(parametro)) {
    return <span className="font-black">{PENDIENTE}</span>
  }

  const valor = textoDeParametro(parametro)
  const confirmado = parametro?.estadoSemaforo === 'verde'

  return (
    <span>
      {valor}
      {!confirmado && (
        <span className="ml-1 text-xs font-bold">
          {simboloSemaforo(parametro?.estadoSemaforo ?? '')} sin confirmar
        </span>
      )}
    </span>
  )
}

/** Para la línea de firma, donde no cabe el marcador entero. */
function textoCorto(parametro: Parametro | null): string {
  return sePuedeProponer(parametro) ? textoDeParametro(parametro) : '[PENDIENTE]'
}

function Linea({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-suelo-700">{etiqueta}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Alrededor del documento
// ---------------------------------------------------------------------------

/** Lienzo. Fuera del cascarón: lo que se imprime es la hoja, no el CRM. */
function Marco({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background px-4 py-6 sm:px-6 sm:py-8 print:bg-white print:p-0">{children}</div>
}

/**
 * `print:hidden`: los botones no salen en el papel. Imprimir es del navegador
 * —`window.print()`—, no un PDF generado: así lo que se ve en pantalla y lo que
 * sale por la impresora son el mismo documento, con los mismos huecos.
 */
function BarraDeAcciones({ separacionId }: { separacionId: string }) {
  return (
    <div className="mx-auto mb-4 flex max-w-[21cm] flex-wrap items-center justify-between gap-3 print:hidden">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to={`/separaciones/${separacionId}`}>
          <ArrowLeft strokeWidth={1.75} aria-hidden="true" />
          Volver a la ficha
        </Link>
      </Button>

      <Button onClick={() => window.print()}>
        <Printer strokeWidth={1.75} aria-hidden="true" />
        Imprimir
      </Button>
    </div>
  )
}

function Bloqueo({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-[21cm] items-start gap-3 rounded-md border border-alerta bg-alerta-suave p-4"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-alerta"
        strokeWidth={2}
        aria-hidden="true"
      />
      <div className="text-sm">
        <p className="font-bold text-alerta">{titulo}</p>
        <p className="mt-1 leading-snug text-suelo-700">{detalle}</p>
      </div>
    </div>
  )
}
