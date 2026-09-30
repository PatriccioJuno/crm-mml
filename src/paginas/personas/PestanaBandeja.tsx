import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Archive, Globe, Hand, Inbox, Loader2, Repeat, UserPlus } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { cn } from '@/lib/utils'
import type { Rol } from '@/auth/tipos-sesion'
import { mensajeDeError } from '@/lib/acciones'
import { MOTIVOS_DESCARTE } from '@/lib/cartera'
import { reclamarOportunidad } from '@/lib/contacto'
import { etiquetaOrigen } from '@/lib/embudo'
import { fechaHora } from '@/lib/fechas'
import { booleano, entero, leerLote, texto, type Lote } from '@/lib/lectura'
import { ETIQUETAS_RESPUESTA_WEB, filtrarRespuestasWeb } from '@/lib/perfil'
import { supabase } from '@/lib/supabase'
import { formatearTelefono } from '@/lib/telefono'
import { DialogoAsignar } from './DialogoAsignar'
import { DialogoDescartar } from './PestanaFrios'
import {
  AvisoHecho,
  Cargando,
  ErrorAlerta,
  invalidarTrasAccion,
  puedeOperar,
  rutaFicha,
} from './FilaPersona'

/**
 * BANDEJA WEB — los leads que llegaron solos y todavía no tienen dueño.
 *
 * ===========================================================================
 * DE DÓNDE SALE
 * ===========================================================================
 * `fn_bandeja()` (13-seguimiento-comercial.sql, SPEC §4.5): oportunidades
 * activas sin responsable, con la última captación de su persona. Las
 * respuestas del chat de la web llegan YA filtradas por la base (claves
 * conocidas, valores `^[a-z_]{1,40}$`) y aquí se vuelven a filtrar con
 * `filtrarRespuestasWeb`: vienen de un formulario público y no se pinta nada
 * que no esté en la lista de ETIQUETAS_RESPUESTA_WEB.
 *
 * El lector de filas vive en este archivo y no en src/lib porque solo lo usa
 * esta pestaña y el contador de su cabecera; si otra pantalla lo necesita
 * (Hoy: «Bandeja web: N esperando»), el sitio natural es src/lib/cartera.ts.
 *
 * ===========================================================================
 * TOMAR ANTES DE ESCRIBIR
 * ===========================================================================
 * Aquí no hay botones de WhatsApp a propósito. Dos vendedores escribiendo al
 * mismo lead es la versión comercial de la doble asignación (R1). «Tomar» es
 * el candado: la base bloquea la fila y el primero se la queda; el segundo
 * recibe «Ya la tomó X» (fn_reclamar_oportunidad). Después se escribe desde la
 * ficha, que es a donde lleva «Tomar».
 */

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type Prioridad = 'alta' | 'media' | 'baja'

export type FilaBandeja = {
  oportunidadId: string
  personaId: string
  nombreCompleto: string
  telefonoE164: string | null
  origen: string | null
  fechaIngreso: string
  diasEsperando: number | null
  fuenteSistema: string | null
  recibidoEl: string | null
  respuestas: Record<string, string>
  prioridad: Prioridad | null
  utmSource: string | null
  utmCampaign: string | null
  reingresos: number
  tieneTarea: boolean
}

function esPrioridad(v: string | null): v is Prioridad {
  return v === 'alta' || v === 'media' || v === 'baja'
}

function interpretarFilaBandeja(fila: unknown): FilaBandeja | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>
  const oportunidadId = texto(f['oportunidad_id'])
  const personaId = texto(f['persona_id'])
  const nombreCompleto = texto(f['nombre_completo'])
  const fechaIngreso = texto(f['fecha_ingreso'])
  if (oportunidadId === null || personaId === null || nombreCompleto === null || fechaIngreso === null) {
    return null
  }
  const prioridad = texto(f['prioridad'])
  return {
    oportunidadId,
    personaId,
    nombreCompleto,
    telefonoE164: texto(f['telefono_e164']),
    origen: texto(f['origen']),
    fechaIngreso,
    diasEsperando: entero(f['dias_esperando']),
    fuenteSistema: texto(f['fuente_sistema']),
    recibidoEl: texto(f['recibido_el']),
    respuestas: filtrarRespuestasWeb(f['respuestas']),
    // Solo las tres que la base deja pasar; cualquier otra cosa es «sin prioridad».
    prioridad: esPrioridad(prioridad) ? prioridad : null,
    utmSource: texto(f['utm_source']),
    utmCampaign: texto(f['utm_campaign']),
    reingresos: entero(f['reingresos']) ?? 0,
    // Si no llega, se asume que NO tiene tarea: es el caso que hay que ver.
    tieneTarea: booleano(f['tiene_tarea']) === true,
  }
}

export async function cargarBandeja(): Promise<Lote<FilaBandeja>> {
  const { data, error } = await supabase.rpc('fn_bandeja')
  if (error !== null) {
    if (error.message.includes('fn_bandeja')) {
      throw new Error('Falta ejecutar sql/13-seguimiento-comercial.sql en Supabase: sin fn_bandeja no hay bandeja web.')
    }
    throw new Error(mensajeDeError(error.message))
  }
  return leerLote(data, interpretarFilaBandeja)
}

/**
 * La bandeja, compartida por la pestaña y el contador de la cabecera (misma
 * clave ['bandeja'], una sola consulta). `fn_bandeja` exige uno de los tres
 * roles que operan; a los demás ni se les pregunta.
 */
export function useBandeja(rol: Rol | null) {
  return useQuery({ queryKey: ['bandeja'], queryFn: cargarBandeja, enabled: puedeOperar(rol) })
}

// ---------------------------------------------------------------------------
// La pestaña
// ---------------------------------------------------------------------------

/** Los tres motivos que tienen sentido para un lead que llegó solo (SPEC §7 S1). */
const MOTIVOS_BANDEJA = MOTIVOS_DESCARTE.filter(
  (m) => m.valor === 'spam' || m.valor === 'duplicado' || m.valor === 'no_reconoce',
)

/** Quién puede repartir la bandeja a otro (SPEC §7 S1). Un comercial la toma para sí. */
const REPARTEN: readonly Rol[] = ['direccion', 'administracion']

function textoEspera(dias: number | null): string {
  if (dias === null) return 'sin fecha de llegada'
  if (dias <= 0) return 'llegó hoy'
  if (dias === 1) return 'llegó ayer'
  return `llegó hace ${dias} días`
}

export function PestanaBandeja({ rol }: { rol: Rol | null }) {
  const navigate = useNavigate()
  const cliente = useQueryClient()
  const consulta = useBandeja(rol)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [asignando, setAsignando] = useState<FilaBandeja | null>(null)
  const [descartando, setDescartando] = useState<FilaBandeja | null>(null)

  const opera = puedeOperar(rol)
  const reparte = rol !== null && REPARTEN.includes(rol)
  const filas = consulta.data?.filas ?? []

  async function tomar(f: FilaBandeja): Promise<void> {
    if (ocupado !== null) return
    setOcupado(f.oportunidadId)
    setError(null)
    setHecho(null)
    const r = await reclamarOportunidad(f.oportunidadId)
    setOcupado(null)
    if (!r.ok) {
      // «Ya la tomó X»: se refresca para que desaparezca de la bandeja.
      setError(`${f.nombreCompleto}: ${r.motivo}`)
      invalidarTrasAccion(cliente, f.personaId)
      return
    }
    invalidarTrasAccion(cliente, f.personaId)
    navigate(rutaFicha({ personaId: f.personaId, id: f.oportunidadId }))
  }

  if (!opera) {
    return (
      <p className="rounded-md border border-border bg-card p-4 text-sm text-suelo-700">
        La bandeja web la trabajan Dirección, Comercial y Administración. Tu rol puede ver las
        personas en «Cartera».
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-suelo-700">
        Leads que entraron solos desde la web y todavía no tienen responsable, del que más espera al
        más nuevo. Quien lo toma primero se lo queda.
      </p>

      {error !== null && <ErrorAlerta mensaje={error} />}
      {hecho !== null && <AvisoHecho>{hecho}</AvisoHecho>}

      {consulta.isPending && <Cargando texto="Cargando la bandeja web…" />}
      {consulta.error !== null && <ErrorAlerta mensaje={consulta.error.message} />}

      {consulta.isSuccess && filas.length === 0 && <BandejaVacia />}

      {filas.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-border bg-card">
          {filas.map((f) => (
            <li
              key={f.oportunidadId}
              className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-tinta-fila px-3 py-3 last:border-b-0 sm:px-4"
            >
              <div className="min-w-0 flex-1 basis-64 space-y-1.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-bold text-foreground">{f.nombreCompleto}</span>
                  {f.prioridad !== null && (
                    <span
                      className={cn(
                        'text-xs text-foreground',
                        f.prioridad === 'alta' ? 'font-black' : 'font-bold',
                      )}
                    >
                      · Prioridad {f.prioridad}
                    </span>
                  )}
                </p>

                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-suelo-700">
                  <span className="tabular-nums">{formatearTelefono(f.telefonoE164)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Globe className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                    {f.fuenteSistema ?? (f.origen !== null ? etiquetaOrigen(f.origen) : 'Web')}
                  </span>
                  <span
                    className={cn((f.diasEsperando ?? 0) >= 1 && 'font-bold text-foreground')}
                    title={f.recibidoEl !== null ? `Recibido el ${fechaHora(f.recibidoEl)}` : undefined}
                  >
                    {textoEspera(f.diasEsperando)}
                  </span>
                  {f.reingresos > 1 && (
                    <span className="inline-flex items-center gap-1 font-bold text-foreground">
                      <Repeat className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      Escribió {f.reingresos} veces
                    </span>
                  )}
                  {!f.tieneTarea && <span className="font-bold text-foreground">· Sin tarea</span>}
                  {(f.utmSource !== null || f.utmCampaign !== null) && (
                    <span>
                      · {[f.utmSource, f.utmCampaign].filter((x): x is string => x !== null).join(' / ')}
                    </span>
                  )}
                </p>

                <RespuestasWeb respuestas={f.respuestas} />
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-11 sm:h-9"
                  disabled={ocupado !== null}
                  onClick={() => void tomar(f)}
                >
                  {ocupado === f.oportunidadId ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Hand strokeWidth={1.75} aria-hidden="true" />
                  )}
                  Tomar
                </Button>
                {reparte && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-9"
                    disabled={ocupado !== null}
                    onClick={() => setAsignando(f)}
                  >
                    <UserPlus strokeWidth={1.75} aria-hidden="true" />
                    Asignar a…
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 sm:h-9"
                  disabled={ocupado !== null}
                  onClick={() => setDescartando(f)}
                >
                  <Archive strokeWidth={1.75} aria-hidden="true" />
                  Descartar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {consulta.data !== undefined && consulta.data.descartadas > 0 && (
        <p className="text-xs font-bold text-alerta">
          🔴 {consulta.data.descartadas}{' '}
          {consulta.data.descartadas === 1 ? 'lead no se pudo leer' : 'leads no se pudieron leer'} y
          no están en la bandeja. Un lead que no se ve es un lead que nadie atiende: revisa
          fn_bandeja.
        </p>
      )}

      {asignando !== null && (
        <DialogoAsignar
          ids={[asignando.oportunidadId]}
          nombres={{ [asignando.oportunidadId]: asignando.nombreCompleto }}
          alCerrar={() => setAsignando(null)}
          alAsignar={(a) => {
            if (a.asignadas > 0) setHecho(`${asignando.nombreCompleto}: asignado.`)
          }}
        />
      )}

      {descartando !== null && (
        <DialogoDescartar
          fila={{
            id: descartando.oportunidadId,
            personaId: descartando.personaId,
            nombreCompleto: descartando.nombreCompleto,
          }}
          motivos={MOTIVOS_BANDEJA}
          alCerrar={() => setDescartando(null)}
          alDescartar={() => setHecho(`${descartando.nombreCompleto}: descartado.`)}
        />
      )}
    </div>
  )
}

/** Las respuestas del chat, con la pregunta y el texto EXACTO que vio la persona. */
function RespuestasWeb({ respuestas }: { respuestas: Record<string, string> }) {
  const claves = Object.keys(respuestas)
  if (claves.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Lo que respondió en la web">
      {claves.map((clave) => {
        const valor = respuestas[clave]
        const def = ETIQUETAS_RESPUESTA_WEB[clave]
        if (valor === undefined || def === undefined) return null
        return (
          <li
            key={clave}
            className="rounded-full border border-input bg-white px-2.5 py-0.5 text-xs text-suelo"
          >
            <span className="text-suelo-700">{def.pregunta}:</span>{' '}
            <span className="font-bold">{def.opciones[valor] ?? valor}</span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Bandeja vacía NO quiere decir «la web no trae a nadie». Hoy la web sigue
 * mandando el formulario por WhatsApp (08-web config.js
 * `destinoFormulario: 'whatsapp'`) hasta que Dirección ratifique
 * `aviso_privacidad_version`; esos mensajes llegan al teléfono, no aquí. Se
 * dice qué hacer con ellos mientras tanto.
 */
function BandejaVacia() {
  return (
    <div className="rounded-lg border border-border bg-card p-5 text-sm">
      <p className="flex items-center gap-2 font-bold text-foreground">
        <Inbox className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        No hay leads web esperando.
      </p>
      <p className="mt-2 leading-relaxed text-suelo-700">
        Mientras Dirección no ratifique la versión del aviso de privacidad
        (<code>aviso_privacidad_version</code>), la web sigue enviando el formulario por WhatsApp
        (<code>destinoFormulario: &apos;whatsapp&apos;</code>) y esos leads no llegan a esta bandeja.
        Mientras tanto, pega cada mensaje en{' '}
        <Link to="/registro-rapido" className="font-bold text-primary underline-offset-4 hover:underline">
          Registro rápido → «Mensaje de la web»
        </Link>
        : el CRM lee las respuestas y las deja como sugerencias en el perfil.
      </p>
    </div>
  )
}
