import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { AlertTriangle, CalendarPlus, Check, Loader2, MessageSquareText, X } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { claseCampo } from '@/componentes/ui/input'
import { TarjetaConPie } from '@/componentes/marca/Superficies'
import { GrupoChips } from '@/componentes/crm/GrupoChips'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import type { Rol } from '@/auth/tipos-sesion'
import { etiquetaSituacion, type FilaCartera } from '@/lib/cartera'
import {
  CANALES_CONTACTO,
  RESULTADOS_CONTACTO,
  etiquetaResultado,
  registrarContacto,
  type CanalContacto,
  type GrupoResultado,
  type RespuestaContacto,
  type ResultadoContacto,
} from '@/lib/contacto'
import {
  cargarParametrosPorId,
  enteroDeParametro,
  estaConfirmado,
  simboloSemaforo,
  type Parametro,
} from '@/lib/parametros'
import { armarMensaje, datosDesdeCartera, plantillaSugerida, PLANTILLAS } from '@/lib/plantillas'
import { enlaceLlamada, enlaceWhatsApp } from '@/lib/whatsapp'
import { deEntradaLocal, diaYHora, sumarDias } from '@/lib/fechas'
import { etiquetaEstado } from '@/lib/embudo'
import { DialogoMensaje } from './DialogoMensaje'

/**
 * PANEL DE CONTACTO — registrar cada intento en uno o dos toques.
 *
 * ===========================================================================
 * POR QUE EXISTE
 * ===========================================================================
 * El 28/09 llegaron 50 leads de un TikTok Live y nadie pudo trabajarlos rápido
 * (SPEC §0). Lo que faltaba no era un campo más: era poder decir «no contestó»
 * en un toque y que el CRM hiciera el resto —contar el intento, programar el
 * siguiente, pasarlo a fríos cuando toca— sin que el vendedor tenga que
 * acordarse de la cadencia (Walter: «hay semanas, incluso meses, en los que no
 * hacemos seguimiento», 07-crm/CLAUDE.md R6).
 *
 * ===========================================================================
 * QUIEN DECIDE QUE
 * ===========================================================================
 * Todo lo que pasa después del toque lo hace `fn_registrar_contacto` en UNA
 * transacción (SPEC §4.5): la interacción, el paso 01 → 02 si respondió, cerrar
 * la tarea cumplida, abrir la siguiente (R6) o enfriar al llegar al umbral de
 * `frio_intentos_sin_respuesta`. Aquí no se calcula ninguna de esas cosas; lo
 * único que se calcula en el cliente es la fecha del «próximo paso» cuando el
 * vendedor la ELIGE (Mañana / En 3 días / En una semana), igual que el «mañana»
 * de cualquier agenda. Si no la elige, la pone la base con la cadencia.
 *
 * ===========================================================================
 * DOS TOQUES, NO UNO
 * ===========================================================================
 * Primero se elige qué pasó y después se registra. Un intento mal registrado no
 * se borra (R8) y cuenta para el umbral de fríos: un toque de más es más barato
 * que un lead enfriado por error. Con teclado (`atajos`, modo cola), el dígito
 * elige y lleva el foco al botón de registrar: Intro lo confirma.
 *
 * Se exporta para la pantalla de cola (SPEC §7 S7), por eso recibe la fila de
 * `v_cartera` entera y no depende de la ficha.
 */

// ===========================================================================
// Utilidades compartidas por la ficha (y por la cola)
// ===========================================================================
// Viven aquí porque PanelContacto es la pieza que usan las dos pantallas; las
// demás secciones de la ficha las importan de este archivo.

/**
 * ¿Puede este usuario operar esta oportunidad? Es la MISMA condición que
 * `puede_operar_oportunidad` (SPEC §4.5): dirección y administración siempre;
 * comercial si es suya o no tiene dueño. Aquí solo sirve para no ofrecer
 * botones que la base iba a rechazar — quien lo impide es la función.
 */
export function puedeOperarOportunidad(
  f: Pick<FilaCartera, 'responsableId' | 'sinDueno'>,
  rol: Rol | null,
  yo: string | null,
): boolean {
  if (rol === 'direccion' || rol === 'administracion') return true
  if (rol === 'comercial') return f.sinDueno || (yo !== null && f.responsableId === yo)
  return false
}

/**
 * Tras cualquier acción: las claves de la entidad tocada y, siempre, las
 * listas que dependen de ella (SPEC §8). `['ficha']` entero y no solo el de
 * esta persona: las secciones no siempre conocen el `personaId`, y una ficha
 * que no está montada solo queda marcada como vieja.
 */
export function invalidarTrasAccion(cliente: QueryClient, entidades: readonly QueryKey[] = []): void {
  const claves: QueryKey[] = [...entidades, ['ficha'], ['cartera'], ['hoy'], ['embudo']]
  for (const clave of claves) void cliente.invalidateQueries({ queryKey: clave })
}

/** El mensaje de error de una acción, con el aspecto de toda la app. */
export function Fallo({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-3 text-sm font-bold leading-snug text-alerta',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** Los dos parámetros que cambian lo que dice este panel (SPEC §4.4, ambos 🔵 propuesta). */
export const PARAMETROS_CONTACTO = ['frio_intentos_sin_respuesta', 'cadencia_seguimiento_dias'] as const

/** Los parámetros cambian poco; no hace falta pedirlos en cada lead de la cola. Caché de interfaz. */
const PARAMETROS_VIGENTES_MS = 5 * 60 * 1000

export function useParametrosContacto() {
  return useQuery({
    queryKey: ['parametros', PARAMETROS_CONTACTO],
    queryFn: () => cargarParametrosPorId(PARAMETROS_CONTACTO),
    staleTime: PARAMETROS_VIGENTES_MS,
  })
}

/**
 * El umbral de fríos para `plantillaSugerida`, o `null` si no se puede usar
 * (rojo/negro o vacío: `enteroDeParametro`). Con `null` la sugerencia sigue la
 * escalera sin anticipar el «último mensaje»: no se inventa un umbral.
 */
export function umbralFrioDe(parametros: Record<string, Parametro | null> | undefined): number | null {
  return enteroDeParametro(parametros?.['frio_intentos_sin_respuesta'] ?? null)
}

/** El mensaje de WhatsApp sugerido para esta fila (plantillas.ts: sin cifras ni condiciones). */
export function mensajeSugerido(f: FilaCartera, agente: string | null, umbralFrio: number | null): string {
  const id = plantillaSugerida({
    totalContactos: f.totalContactos,
    intentosSinRespuesta: f.intentosSinRespuesta,
    situacion: f.situacion,
    origen: f.origen,
    entroSolo: f.entroSolo,
    umbralFrio,
  })
  return armarMensaje(id, datosDesdeCartera(f, agente))
}

// ===========================================================================
// El panel
// ===========================================================================

/** Donde se recuerda el último canal usado. Comodidad de este navegador (SPEC S2), no un dato. */
const CLAVE_CANAL = 'crm.contacto.canal'

function leerCanal(): CanalContacto {
  try {
    const guardado = window.localStorage.getItem(CLAVE_CANAL)
    return CANALES_CONTACTO.find((c) => c.valor === guardado)?.valor ?? 'whatsapp'
  } catch {
    return 'whatsapp'
  }
}

function recordarCanal(canal: CanalContacto): void {
  try {
    window.localStorage.setItem(CLAVE_CANAL, canal)
  } catch {
    // navegador sin almacenamiento (modo privado): simplemente no se recuerda
  }
}

/**
 * Atajos de agenda para el próximo paso tras una respuesta. Son como el
 * «mañana» de un calendario: los ELIGE el vendedor. No son plazos comerciales
 * ni la cadencia de seguimiento (esa vive en `cadencia_seguimiento_dias`).
 */
const PROXIMOS = [
  { valor: 'manana', etiqueta: 'Mañana', dias: 1 },
  { valor: 'tres_dias', etiqueta: 'En 3 días', dias: 3 },
  { valor: 'semana', etiqueta: 'En una semana', dias: 7 },
  { valor: 'elegir', etiqueta: 'Elegir fecha', dias: null },
] as const

type Proximo = (typeof PROXIMOS)[number]['valor']

const GRUPOS: readonly { grupo: GrupoResultado; titulo: string }[] = [
  { grupo: 'intento', titulo: 'Intento sin respuesta' },
  { grupo: 'respuesta', titulo: 'Hubo respuesta' },
  { grupo: 'cierre', titulo: 'Cierre' },
  { grupo: 'nota', titulo: 'Nota' },
]

/** Los que cierran el ciclo de forma difícil de revertir: piden un paso de confirmación. */
const CON_CONFIRMACION: ReadonlySet<ResultadoContacto> = new Set<ResultadoContacto>([
  'no_interesa',
  'pidio_no_contacto',
  'numero_equivocado',
])

function grupoDe(r: ResultadoContacto): GrupoResultado {
  return RESULTADOS_CONTACTO.find((x) => x.valor === r)?.grupo ?? 'nota'
}

/**
 * Lo que va a hacer la base con cada resultado, en palabras (SPEC §4.5,
 * `fn_registrar_contacto` paso 4). Es EXPLICACIÓN: si divergiera de la
 * función, manda la función.
 */
function consecuencia(r: ResultadoContacto, situacion: string): string {
  switch (r) {
    case 'no_contesta':
    case 'buzon':
    case 'visto_sin_respuesta':
      return 'Cuenta como intento sin respuesta. La base programa el siguiente intento según la cadencia de seguimiento.'
    case 'contesto':
    case 'respondio':
      return situacion === 'pausada'
        ? 'Vuelve de fríos a activos. Se cierra la tarea pendiente y se abre la siguiente en la fecha que elijas.'
        : 'Si estaba en «Prospecto captado» pasa a «Contactado». Se cierra la tarea pendiente y se abre la siguiente en la fecha que elijas.'
    case 'mas_adelante':
      return 'Pasa a fríos (motivo «Más adelante») con una tarea para volver a escribirle. Sin fecha, la base usa el parámetro congelado_por_defecto_dias.'
    case 'no_interesa':
      return 'Se descarta con motivo «No le interesa»: se cierran todas sus tareas y se cancelan sus visitas.'
    case 'pidio_no_contacto':
      return 'La persona queda en «No contactar»: su consentimiento pasa a «No» (SOP-SEGUIMIENTO:61), todas sus oportunidades se descartan, se cierran sus tareas y se cancelan sus visitas. Solo se revierte con consentimiento renovado.'
    case 'numero_equivocado':
      return 'Se descarta con motivo «Número inválido» y se cierran sus tareas.'
    case 'nota':
      return 'Solo queda en la actividad: no mueve el estado ni las tareas.'
  }
}

/** La línea que se enseña tras registrar (SPEC S2: «Registrado. Próximo: …»). */
function lineaResultado(r: RespuestaContacto, estadoAntes: string): string {
  if (r.pasoAFrios) {
    const reactivar = r.tarea === null ? '' : ` Reactivación: ${diaYHora(r.tarea.venceEl)}.`
    return `Pasó a fríos tras ${r.intentosSinRespuesta} intentos sin respuesta.${reactivar}`
  }
  if (r.descartada) return `Registrado. La oportunidad quedó ${etiquetaSituacion(r.situacion).toLowerCase()}.`

  const partes: string[] = ['Registrado.']
  if (r.reactivada) partes.push('Volvió de fríos a activos.')
  if (r.estado !== estadoAntes) partes.push(`Pasó a ${etiquetaEstado(r.estado)}.`)
  if (r.tarea !== null) partes.push(`Próximo: ${r.tarea.titulo} · ${diaYHora(r.tarea.venceEl)}`)
  return partes.join(' ')
}

function esCampoDeTexto(destino: EventTarget | null): boolean {
  if (!(destino instanceof HTMLElement)) return false
  return destino.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(destino.tagName)
}

const CLASE_DESHABILITADO_SOBRE_AZUL = 'disabled:bg-azul-600 disabled:text-azul-300 disabled:opacity-100'

export function PanelContacto({
  fila,
  compacto = false,
  atajos = false,
  alRegistrar,
  alAgendarVisita,
}: {
  fila: FilaCartera
  compacto?: boolean | undefined
  atajos?: boolean | undefined
  alRegistrar?: ((r: RespuestaContacto) => void) | undefined
  alAgendarVisita?: (() => void) | undefined
}) {
  const { rol, perfil } = useSesion()
  const cliente = useQueryClient()
  const parametros = useParametrosContacto()
  const idNota = useId()
  const idFecha = useId()
  const botonRegistrar = useRef<HTMLButtonElement | null>(null)

  const [canal, setCanal] = useState<CanalContacto>(leerCanal)
  const [resultado, setResultado] = useState<ResultadoContacto | null>(null)
  const [nota, setNota] = useState('')
  const [proximo, setProximo] = useState<Proximo>('manana')
  const [fechaElegida, setFechaElegida] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [plantillaUsada, setPlantillaUsada] = useState<string | null>(null)
  const [dialogoMensaje, setDialogoMensaje] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [hecho, setHecho] = useState<{ linea: string; avisos: string[] } | null>(null)

  // Otra oportunidad (la cola pasa al siguiente lead): el panel empieza limpio.
  useEffect(() => {
    setResultado(null)
    setNota('')
    setProximo('manana')
    setFechaElegida('')
    setConfirmando(false)
    setPlantillaUsada(null)
    setFallo(null)
    setHecho(null)
  }, [fila.id])

  const yo = perfil?.id ?? null
  const agente = perfil?.nombre ?? null
  const umbral = umbralFrioDe(parametros.data)
  const cadencia = parametros.data?.['cadencia_seguimiento_dias'] ?? null
  const mensaje = mensajeSugerido(fila, agente, umbral)

  const motivoBloqueo: string | null = !puedeOperarOportunidad(fila, rol, yo)
    ? 'Esta oportunidad la lleva otra persona: tu rol no registra contactos en ella (lo decide puede_operar_oportunidad en la base).'
    : fila.noContactar
      ? 'Pidió no ser contactada. No se registran contactos mientras no renueve su consentimiento (Ley 29733).'
      : fila.situacion !== 'activa' && fila.situacion !== 'pausada'
        ? `Está ${etiquetaSituacion(fila.situacion).toLowerCase()}: reactívala en «Situación» para registrar contactos.`
        : null
  const habilitado = motivoBloqueo === null

  function elegir(r: ResultadoContacto, desdeTeclado = false): void {
    setResultado((actual) => (actual === r && !desdeTeclado ? null : r))
    setConfirmando(false)
    setFallo(null)
    setHecho(null)
    if (desdeTeclado) window.setTimeout(() => botonRegistrar.current?.focus(), 0)
  }

  function cambiarCanal(c: CanalContacto | null): void {
    if (c === null) return
    setCanal(c)
    recordarCanal(c)
  }

  // Teclado del modo cola: dígito = resultado, «w» = WhatsApp, «l» = llamar.
  // Se ignora mientras se escribe en un campo o hay un diálogo abierto.
  useEffect(() => {
    if (!atajos || !habilitado) return
    const telefono = fila.telefonoE164

    function alTecla(e: KeyboardEvent): void {
      if (e.ctrlKey || e.metaKey || e.altKey || esCampoDeTexto(e.target)) return
      if (document.querySelector('[role="dialog"]') !== null) return

      const r = RESULTADOS_CONTACTO.find((x) => x.atajo === e.key)
      if (r !== undefined) {
        e.preventDefault()
        elegir(r.valor, true)
        return
      }
      const tecla = e.key.toLowerCase()
      if (telefono !== null && (tecla === 'w' || tecla === 'l')) {
        e.preventDefault()
        const c: CanalContacto = tecla === 'w' ? 'whatsapp' : 'llamada'
        cambiarCanal(c)
        window.location.href = tecla === 'w' ? enlaceWhatsApp(telefono, mensaje) : enlaceLlamada(telefono)
      }
    }

    window.addEventListener('keydown', alTecla)
    return () => window.removeEventListener('keydown', alTecla)
  }, [atajos, habilitado, fila.telefonoE164, mensaje])

  const grupo = resultado === null ? null : grupoDe(resultado)
  const pideConfirmacion = resultado !== null && CON_CONFIRMACION.has(resultado)

  /** El próximo paso elegido, en ISO; `undefined` = que lo decida la base; `null` = fecha inválida. */
  function proximoElegido(): string | null | undefined {
    if (resultado === 'mas_adelante') {
      if (fechaElegida.trim() === '') return undefined
      const iso = deEntradaLocal(fechaElegida)
      return iso !== null && Date.parse(iso) > Date.now() ? iso : null
    }
    if (grupo !== 'respuesta') return undefined
    const opcion = PROXIMOS.find((p) => p.valor === proximo)
    if (opcion === undefined || opcion.dias === null) {
      const iso = deEntradaLocal(fechaElegida)
      return iso !== null && Date.parse(iso) > Date.now() ? iso : null
    }
    return sumarDias(new Date(), opcion.dias).toISOString()
  }

  async function registrar(): Promise<void> {
    if (resultado === null || !habilitado) return
    if (pideConfirmacion && !confirmando) {
      setConfirmando(true)
      return
    }

    const proximoEl = proximoElegido()
    if (proximoEl === null) {
      setFallo('Elige una fecha y hora del próximo paso que sea futura.')
      return
    }
    if (resultado === 'nota' && nota.trim() === '') {
      setFallo('Escribe la nota antes de guardarla.')
      return
    }

    setEnviando(true)
    setFallo(null)
    const r = await registrarContacto({
      oportunidadId: fila.id,
      resultado,
      canal,
      nota,
      proximoEl: proximoEl ?? null,
      plantilla: plantillaUsada ?? undefined,
    })
    setEnviando(false)
    setConfirmando(false)

    if (!r.ok) {
      // Tal cual: los mensajes de fn_registrar_contacto ya vienen en español.
      setFallo(r.motivo)
      return
    }

    setHecho({ linea: lineaResultado(r.datos, fila.estado), avisos: r.datos.avisos })
    setResultado(null)
    setNota('')
    setFechaElegida('')
    setProximo('manana')
    setPlantillaUsada(null)
    invalidarTrasAccion(cliente, [['actividad', fila.id], ['visitas', fila.id]])
    alRegistrar?.(r.datos)
  }

  const etiquetaPlantilla =
    plantillaUsada === null
      ? null
      : (() => {
          const editada = plantillaUsada.endsWith('_editada')
          const id = editada ? plantillaUsada.slice(0, -'_editada'.length) : plantillaUsada
          const nombre = PLANTILLAS.find((p) => p.id === id)?.etiqueta ?? id
          return editada ? `${nombre} (editada)` : nombre
        })()

  const textoBoton =
    resultado === null
      ? 'Elige qué pasó'
      : confirmando
        ? `Sí, registrar «${etiquetaResultado(resultado)}»`
        : pideConfirmacion
          ? `Registrar «${etiquetaResultado(resultado)}»…`
          : `Registrar «${etiquetaResultado(resultado)}»`

  const notaPie = !habilitado
    ? 'No se puede registrar en esta oportunidad.'
    : resultado === null
      ? 'Toca lo que pasó en el contacto y luego regístralo.'
      : consecuencia(resultado, fila.situacion)

  return (
    <TarjetaConPie
      nota={compacto && resultado === null ? undefined : notaPie}
      acciones={
        <div className="flex flex-wrap items-center gap-2">
          {confirmando && (
            <Button
              variant="outlineCal"
              className="h-11"
              onClick={() => setConfirmando(false)}
              disabled={enviando}
            >
              <X aria-hidden="true" />
              Volver
            </Button>
          )}
          <Button
            ref={botonRegistrar}
            variant="ambar"
            className={cn('h-12 px-5 text-base', CLASE_DESHABILITADO_SOBRE_AZUL)}
            onClick={() => void registrar()}
            disabled={!habilitado || resultado === null || enviando}
          >
            {enviando ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Registrando…
              </>
            ) : (
              textoBoton
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className={cn('font-black tracking-tight text-foreground', compacto ? 'text-base' : 'text-lg')}>
              Registrar contacto
            </h2>
            <p className="text-xs text-suelo-700">
              {fila.totalContactos === 0
                ? 'Aún no hay ningún contacto registrado.'
                : `${fila.totalContactos} contacto(s) registrados · ${fila.intentosSinRespuesta} intento(s) seguidos sin respuesta`}
              {umbral !== null && fila.intentosSinRespuesta > 0 && (
                <>
                  {' '}
                  · pasa a fríos al llegar a {umbral} (frio_intentos_sin_respuesta{' '}
                  {simboloSemaforo(parametros.data?.['frio_intentos_sin_respuesta']?.estadoSemaforo ?? '')})
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {fila.telefonoE164 !== null && (
              <Button
                variant="outline"
                className="h-11 sm:h-9"
                onClick={() => setDialogoMensaje(true)}
                disabled={!habilitado}
              >
                <MessageSquareText aria-hidden="true" />
                Mensaje sugerido
              </Button>
            )}
            {alAgendarVisita !== undefined && (
              <Button
                variant="outline"
                className="h-11 sm:h-9"
                onClick={alAgendarVisita}
                disabled={!habilitado}
              >
                <CalendarPlus aria-hidden="true" />
                Agendar visita
              </Button>
            )}
          </div>
        </div>

        {motivoBloqueo !== null && (
          <AvisoPendiente className="rounded-md border border-border p-3">{motivoBloqueo}</AvisoPendiente>
        )}

        <GrupoChips
          etiqueta="Canal"
          opciones={CANALES_CONTACTO}
          valor={canal}
          alCambiar={cambiarCanal}
          compacto
          deshabilitado={!habilitado}
        />

        {etiquetaPlantilla !== null && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-suelo-700">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Mensaje usado: <span className="font-bold text-foreground">{etiquetaPlantilla}</span> — se
            guarda con este registro para la auditoría de lo que se le dijo.
            <button
              type="button"
              className="min-h-11 font-bold text-azul underline sm:min-h-0"
              onClick={() => setPlantillaUsada(null)}
            >
              Quitar
            </button>
          </p>
        )}

        <div className="space-y-3">
          {GRUPOS.map(({ grupo: g, titulo }) => {
            const opciones = RESULTADOS_CONTACTO.filter((r) => r.grupo === g)
            return (
              <div key={g} role="group" aria-label={titulo} className="space-y-1.5">
                <p className="text-xs font-bold uppercase tracking-wide text-suelo-500">{titulo}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {opciones.map((r) => {
                    const elegido = resultado === r.valor
                    return (
                      <button
                        key={r.valor}
                        type="button"
                        aria-pressed={elegido}
                        aria-keyshortcuts={atajos ? r.atajo : undefined}
                        disabled={!habilitado || enviando}
                        onClick={() => elegir(r.valor)}
                        className={cn(
                          'flex min-h-12 items-center justify-between gap-2 rounded-md border px-3 text-left text-sm transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          'disabled:cursor-not-allowed disabled:opacity-50',
                          elegido
                            ? 'border-azul bg-azul font-bold text-cal'
                            : 'border-input bg-white text-suelo hover:bg-accent',
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          {elegido && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                          {r.etiqueta}
                        </span>
                        {atajos && (
                          <kbd aria-hidden="true" className="hidden text-[0.6875rem] opacity-70 sm:inline">
                            {r.atajo}
                          </kbd>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {grupo === 'intento' && (
          <AvisoPendiente>
            El próximo intento se programa solo según la cadencia (parámetro cadencia_seguimiento_dias
            {cadencia !== null && ` ${simboloSemaforo(cadencia.estadoSemaforo)}`}
            {cadencia !== null && !estaConfirmado(cadencia) && ', propuesta sin ratificar'}).
          </AvisoPendiente>
        )}

        {grupo === 'respuesta' && (
          <div className="space-y-2">
            <GrupoChips
              etiqueta="Próximo paso"
              opciones={PROXIMOS}
              valor={proximo}
              alCambiar={(v) => v !== null && setProximo(v)}
              compacto
              deshabilitado={enviando}
            />
            {proximo === 'elegir' && (
              <div className="space-y-1.5">
                <label htmlFor={idFecha} className="block text-sm font-bold text-suelo">
                  Fecha y hora del próximo paso
                </label>
                <input
                  id={idFecha}
                  type="datetime-local"
                  value={fechaElegida}
                  onChange={(e) => setFechaElegida(e.target.value)}
                  className={claseCampo}
                />
              </div>
            )}
          </div>
        )}

        {resultado === 'mas_adelante' && (
          <div className="space-y-1.5">
            <label htmlFor={idFecha} className="block text-sm font-bold text-suelo">
              ¿Cuándo volver a escribirle? (opcional)
            </label>
            <input
              id={idFecha}
              type="datetime-local"
              value={fechaElegida}
              onChange={(e) => setFechaElegida(e.target.value)}
              className={claseCampo}
            />
          </div>
        )}

        {confirmando && resultado !== null && (
          <p
            role="alert"
            className="rounded-md border border-azul p-3 text-sm font-bold leading-snug text-foreground"
          >
            Confirma: {consecuencia(resultado, fila.situacion)} No se deshace con un clic.
          </p>
        )}

        <div className="space-y-1.5">
          <label htmlFor={idNota} className="block text-sm font-bold text-suelo">
            {resultado === 'nota' ? 'Nota' : 'Nota (opcional)'}
          </label>
          <textarea
            id={idNota}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={compacto ? 1 : 2}
            maxLength={1000}
            disabled={!habilitado}
            placeholder="Qué dijo, qué quedó pendiente…"
            className={cn(claseCampo, 'h-auto py-2')}
          />
        </div>

        {fallo !== null && <Fallo>{fallo}</Fallo>}

        {hecho !== null && (
          <div role="status" aria-live="polite" className="space-y-1.5">
            <p className="flex items-start gap-2 text-sm font-bold text-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {hecho.linea}
            </p>
            {hecho.avisos.map((a) => (
              <AvisoPendiente key={a}>{a}</AvisoPendiente>
            ))}
          </div>
        )}
      </div>

      <DialogoMensaje
        abierto={dialogoMensaje}
        alCerrar={() => setDialogoMensaje(false)}
        fila={fila}
        agente={agente}
        umbralFrio={umbral}
        alUsar={(idPlantilla) => {
          setPlantillaUsada(idPlantilla)
          cambiarCanal('whatsapp')
          // Se cierra en el siguiente turno: el clic en «Abrir WhatsApp» tiene
          // que terminar de seguir su enlace antes de desmontar el diálogo.
          window.setTimeout(() => setDialogoMensaje(false), 0)
        }}
      />
    </TarjetaConPie>
  )
}
