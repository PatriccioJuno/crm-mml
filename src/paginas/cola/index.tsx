import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ExternalLink,
  History,
  Megaphone,
  RotateCcw,
  SkipForward,
} from 'lucide-react'
import { CabeceraPantalla, MigajaVolver } from '@/componentes/marca/CabeceraPantalla'
import { Button } from '@/componentes/ui/button'
import { claseCampo } from '@/componentes/ui/input'
import { Progress } from '@/componentes/ui/progress'
import { BotonesContacto } from '@/componentes/crm/BotonesContacto'
import { GrupoChips } from '@/componentes/crm/GrupoChips'
import { InsigniaTemperatura } from '@/componentes/crm/InsigniaTemperatura'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import type { Rol } from '@/auth/tipos-sesion'
import {
  cargarCartera,
  etiquetaSituacion,
  rangoTemperatura,
  type FilaCartera,
  type FiltroCartera,
} from '@/lib/cartera'
import { cargarActividad, etiquetaResultado, type RespuestaContacto } from '@/lib/contacto'
import { etiquetaEstado, etiquetaOrigen } from '@/lib/embudo'
import { diaYHora, fechaHora, fechaRelativa, textoVencimiento } from '@/lib/fechas'
import { leerLote, texto } from '@/lib/lectura'
import { cargarCampanas } from '@/lib/lote'
import { supabase } from '@/lib/supabase'
import { formatearTelefono } from '@/lib/telefono'
import {
  ALCANCES_RESPONSABLE,
  AvisosLote,
  CLAVE_IDS_COLA,
  Cargando,
  ErrorAlerta,
  alcancePorDefecto,
  esAlcance,
  invalidarTrasAccion,
  mensajeParaFila,
  rutaFicha,
  tareaVencida,
  tieneVisitaAbierta,
  useUmbralFrio,
  type AlcanceResponsable,
} from '@/paginas/personas/FilaPersona'
import { PanelContacto } from '@/paginas/personas/ficha/PanelContacto'
import { PerfilRapido } from '@/paginas/personas/ficha/SeccionPerfil'
import { DialogoAgendarVisita } from '@/paginas/personas/ficha/SeccionVisitas'

/**
 * MODO LLAMADAS — un lead por pantalla, de arriba abajo, sin volver a la lista.
 *
 * ===========================================================================
 * POR QUÉ EXISTE
 * ===========================================================================
 * El 28/09/2026 entraron 50 leads de un TikTok Live y nadie pudo trabajarlos
 * rápido (SPEC §0). Ir y volver de la lista a la ficha cincuenta veces es lo
 * que mata el speed to lead (analisis/sales.md §3). Aquí el vendedor ve UN
 * lead, lo contacta con un toque, registra cómo fue con otro, y la pantalla
 * pasa sola al siguiente.
 *
 * ===========================================================================
 * LA COLA SE CONGELA AL EMPEZAR
 * ===========================================================================
 * El orden se toma UNA vez (temperatura y luego quién entró antes, SPEC §7 S7)
 * y no se recalcula mientras se trabaja: al registrar un contacto, el lead
 * deja de ser «nuevo» o su tarea pasa a mañana, y si la cola se rearmara con
 * cada registro los índices bailarían y «Lead 3 de 48» mentiría. Los DATOS de
 * cada lead sí se refrescan; el orden, no. «Rehacer la cola» vuelve a tomarlo.
 *
 * El avance se guarda en sessionStorage (`crm.cola.sesion`): abrir la ficha de
 * un lead y volver no devuelve al lead 1. Solo se guardan ids y conteos, nunca
 * nombres ni teléfonos (Ley 29733: dato mínimo), y el almacenamiento puede
 * fallar sin romper nada (try/catch): en el peor caso se empieza de nuevo.
 *
 * ===========================================================================
 * LO QUE LA PANTALLA NO DECIDE
 * ===========================================================================
 * Qué pasa tras cada resultado (intentos, frío, descarte, próximo paso) lo
 * decide `fn_registrar_contacto` con la cadencia y el umbral de `parametros`
 * (🔵 propuesta). El panel de contacto es el mismo de la ficha
 * (PanelContacto); esta pantalla solo ordena, avanza y resume.
 */

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

const VISTAS = [
  { valor: 'nuevos', etiqueta: 'Nuevos', descripcion: 'Nadie les ha escrito todavía.' },
  {
    valor: 'pendientes',
    etiqueta: 'Pendientes de hoy',
    descripcion: 'Su próximo paso vence hoy o ya venció, o no tienen ninguno.',
  },
  {
    valor: 'seleccion',
    etiqueta: 'Selección',
    descripcion: 'Los que elegiste en Personas o acabas de registrar.',
  },
  { valor: 'campana', etiqueta: 'Por campaña', descripcion: 'Los activos de una campaña.' },
] as const

type Vista = (typeof VISTAS)[number]['valor']

function esVista(v: string | null): v is Vista {
  return VISTAS.some((x) => x.valor === v)
}

/** Ids guardados por Personas («Llamar a estos») o Registro rápido. `null` = no hay selección. */
function leerIdsCola(): { ids: string[]; crudo: string } | null {
  try {
    const crudo = window.sessionStorage.getItem(CLAVE_IDS_COLA)
    if (crudo === null) return null
    const valor: unknown = JSON.parse(crudo)
    if (!Array.isArray(valor)) return null
    const ids = valor.filter((x): x is string => typeof x === 'string' && x !== '')
    return ids.length === 0 ? null : { ids, crudo }
  } catch {
    return null
  }
}

/** Huella corta de un texto, para saber si la selección guardada cambió. No es seguridad. */
function huella(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function finDeHoy(): number {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

function instante(iso: string | null): number {
  if (iso === null) return 0
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/** Orden de la cola (SPEC §7 S7): temperatura (cartera.ts) y, a igualdad, quién lleva más esperando. */
function ordenarCola(filas: readonly FilaCartera[]): FilaCartera[] {
  return [...filas].sort(
    (a, b) =>
      rangoTemperatura(a.temperatura) - rangoTemperatura(b.temperatura) ||
      instante(a.fechaIngreso) - instante(b.fechaIngreso),
  )
}

function entraEnVista(f: FilaCartera, vista: Vista, seleccion: ReadonlySet<string>, limiteHoy: number): boolean {
  switch (vista) {
    case 'nuevos':
      return f.totalContactos === 0
    case 'pendientes':
      return f.proximaTareaVenceEl === null || instante(f.proximaTareaVenceEl) <= limiteHoy
    case 'seleccion':
      // Personas guarda ids de OPORTUNIDAD; Registro rápido puede guardar los
      // de la persona. Se aceptan los dos para que ninguna de las dos
      // pantallas tenga que adivinar qué espera la otra.
      return seleccion.has(f.id) || seleccion.has(f.personaId)
    case 'campana':
      return true
  }
}

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

export function PantallaCola() {
  const { rol, perfil } = useSesion()
  const [params, setParams] = useSearchParams()
  const idCampana = useId()

  const vistaCruda = params.get('vista')
  const vista: Vista = esVista(vistaCruda) ? vistaCruda : 'pendientes'
  const campana = params.get('campana')
  const respCruda = params.get('resp')
  const alcance: AlcanceResponsable = esAlcance(respCruda) ? respCruda : alcancePorDefecto(rol)

  // La selección se lee UNA vez al entrar: si Personas guarda otra mientras
  // tanto, esta cola no cambia debajo del vendedor.
  const [seleccion] = useState(leerIdsCola)
  const campanas = useQuery({ queryKey: ['campanas'], queryFn: cargarCampanas, enabled: vista === 'campana' })

  function cambiar(cambios: Partial<Record<'vista' | 'campana' | 'resp', string | null>>): void {
    setParams(
      (previos) => {
        const nuevos = new URLSearchParams(previos)
        for (const [clave, valor] of Object.entries(cambios)) {
          if (valor === null || valor === undefined) nuevos.delete(clave)
          else nuevos.set(clave, valor)
        }
        return nuevos
      },
      { replace: true },
    )
  }

  const definicion = VISTAS.find((v) => v.valor === vista)
  const nombreCampana =
    vista === 'campana' && campana !== null ? (campanas.data?.find((c) => c.id === campana)?.nombre ?? null) : null

  // Cada combinación de vista + campaña + responsable (+ selección) es una
  // cola distinta, con su propio avance guardado.
  const clave = [
    vista,
    vista === 'campana' ? (campana ?? '') : '',
    vista === 'seleccion' ? (seleccion === null ? 'vacia' : huella(seleccion.crudo)) : alcance,
  ].join('|')

  return (
    // La franja azul va FUERA del ancho de lectura: su margen negativo tiene que
    // llegar al borde del <main> (ver CabeceraPantalla), como en
    // contratos/FormularioContrato.tsx. El `pb-28` deja sitio a la barra fija
    // de abajo en el móvil.
    <div className="w-full pb-28 sm:pb-0">
      <CabeceraPantalla
        ancho="formulario"
        migaja={<MigajaVolver a="/personas">Personas</MigajaVolver>}
        titulo="Modo llamadas"
        descripcion={
          nombreCampana !== null ? `${definicion?.etiqueta ?? ''} · ${nombreCampana}` : definicion?.descripcion
        }
      />

      <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 space-y-3">
        <GrupoChips
          etiqueta="¿Qué cola?"
          etiquetaOculta
          opciones={VISTAS}
          valor={vista}
          alCambiar={(v) => v !== null && cambiar({ vista: v, campana: v === 'campana' ? campana : null })}
          compacto
        />

        {vista !== 'seleccion' && (
          <GrupoChips
            etiqueta="Responsable"
            etiquetaOculta
            opciones={ALCANCES_RESPONSABLE}
            valor={alcance}
            alCambiar={(v) => cambiar({ resp: v === null || v === alcancePorDefecto(rol) ? null : v })}
            compacto
          />
        )}

        {vista === 'campana' && (
          <div className="max-w-sm">
            <label htmlFor={idCampana} className="mb-1 block text-sm font-bold text-foreground">
              Campaña
            </label>
            <select
              id={idCampana}
              value={campana ?? ''}
              onChange={(e) => cambiar({ campana: e.target.value === '' ? null : e.target.value })}
              className={claseCampo}
            >
              <option value="">Elige una campaña…</option>
              {(campanas.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            {campanas.error !== null && (
              <p className="mt-1 text-xs font-bold text-alerta">
                No se pudieron cargar las campañas: {campanas.error.message}
              </p>
            )}
          </div>
        )}
      </div>

      {vista === 'seleccion' && seleccion === null ? (
        <Vacia titulo="No hay ninguna selección guardada.">
          En <Enlace a="/personas">Personas</Enlace> pulsa «Elegir varios», marca a quienes quieras y
          «Llamar a estos». O registra la lista del live en{' '}
          <Enlace a="/registro-rapido">Registro rápido</Enlace> y pulsa «Empezar a llamarlos».
        </Vacia>
      ) : vista === 'campana' && campana === null ? (
        <p className="text-sm text-suelo-700">Elige la campaña para armar su cola.</p>
      ) : (
        <SesionCola
          key={clave}
          clave={clave}
          vista={vista}
          filtro={{
            vista: 'activos',
            // Una selección explícita manda sobre «míos»: si la eligió, la quiere llamar.
            responsable: vista === 'seleccion' ? 'todos' : alcance,
            yo: perfil?.id ?? undefined,
            campanaId: vista === 'campana' && campana !== null ? campana : undefined,
          }}
          seleccion={seleccion?.ids ?? null}
          rol={rol}
          yo={perfil?.id ?? null}
          agente={perfil?.nombre ?? null}
        />
      )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// La sesión de llamadas
// ---------------------------------------------------------------------------

/** Lo que se recuerda de cada registro. Sin datos personales: ids y banderas. */
type Registro = {
  interaccionId: string
  situacion: string
  pasoAFrios: boolean
  descartada: boolean
}

type EstadoGuardado = {
  clave: string
  orden: string[]
  personas: Record<string, string>
  indice: number
  registros: Record<string, Registro>
  saltados: string[]
  visitas: string[]
}

const CLAVE_SESION = 'crm.cola.sesion'

function esListaDeTextos(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function esRegistro(v: unknown): v is Registro {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r['interaccionId'] === 'string' &&
    typeof r['situacion'] === 'string' &&
    typeof r['pasoAFrios'] === 'boolean' &&
    typeof r['descartada'] === 'boolean'
  )
}

/** Lee el avance guardado de ESTA cola, o `null`. Lo ilegible se ignora, no se repara. */
function leerSesion(clave: string): EstadoGuardado | null {
  try {
    const crudo = window.sessionStorage.getItem(CLAVE_SESION)
    if (crudo === null) return null
    const v: unknown = JSON.parse(crudo)
    if (typeof v !== 'object' || v === null) return null
    const e = v as Record<string, unknown>
    if (e['clave'] !== clave) return null
    const orden = e['orden']
    const saltados = e['saltados']
    const visitas = e['visitas']
    const indice = e['indice']
    const personas = e['personas']
    const registros = e['registros']
    if (!esListaDeTextos(orden) || !esListaDeTextos(saltados) || !esListaDeTextos(visitas)) return null
    if (typeof indice !== 'number' || !Number.isInteger(indice) || indice < 0) return null
    if (typeof personas !== 'object' || personas === null) return null
    if (typeof registros !== 'object' || registros === null) return null
    const personasOk: Record<string, string> = {}
    for (const [k, p] of Object.entries(personas)) if (typeof p === 'string') personasOk[k] = p
    const registrosOk: Record<string, Registro> = {}
    for (const [k, r] of Object.entries(registros)) if (esRegistro(r)) registrosOk[k] = r
    return {
      clave,
      orden,
      personas: personasOk,
      indice: Math.min(indice, orden.length),
      registros: registrosOk,
      saltados,
      visitas,
    }
  } catch {
    return null
  }
}

function guardarSesion(e: EstadoGuardado): void {
  try {
    window.sessionStorage.setItem(CLAVE_SESION, JSON.stringify(e))
  } catch {
    // Sin almacenamiento la cola sigue funcionando; solo no sobrevive a salir.
  }
}

function borrarSesion(): void {
  try {
    window.sessionStorage.removeItem(CLAVE_SESION)
  } catch {
    // Idem.
  }
}

/** Una línea para el lead que se acaba de dejar atrás. */
function lineaRegistro(r: RespuestaContacto): string {
  if (r.pasoAFrios) return `pasó a fríos tras ${r.intentosSinRespuesta} intentos sin respuesta.`
  if (r.descartada) return 'descartado.'
  if (r.situacion === 'pausada') return 'pasó a fríos.'
  const partes = ['registrado.']
  if (r.reactivada) partes.push('Se reactivó.')
  if (r.tarea !== null) partes.push(`Próximo: ${r.tarea.titulo} · ${diaYHora(r.tarea.venceEl)}.`)
  return partes.join(' ')
}

function esCampoDeTexto(objetivo: EventTarget | null): boolean {
  if (!(objetivo instanceof HTMLElement)) return false
  const etiqueta = objetivo.tagName
  return etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || etiqueta === 'SELECT' || objetivo.isContentEditable
}

/** Puede editar el perfil: la misma regla que `puede_operar_oportunidad` (SPEC §4.5). */
function puedeEditar(f: FilaCartera, rol: Rol | null, yo: string | null): boolean {
  if (rol === 'direccion' || rol === 'administracion') return true
  return rol === 'comercial' && (f.sinDueno || (yo !== null && f.responsableId === yo))
}

function SesionCola({
  clave,
  vista,
  filtro,
  seleccion,
  rol,
  yo,
  agente,
}: {
  clave: string
  vista: Vista
  filtro: FiltroCartera
  seleccion: readonly string[] | null
  rol: Rol | null
  yo: string | null
  agente: string | null
}) {
  const cliente = useQueryClient()
  const umbralFrio = useUmbralFrio()
  const sinSesion = filtro.responsable === 'mios' && yo === null

  const consulta = useQuery({
    queryKey: ['cartera', filtro],
    queryFn: () => cargarCartera(filtro),
    enabled: !sinSesion,
  })

  const [guardado] = useState(() => leerSesion(clave))
  const [orden, setOrden] = useState<string[] | null>(guardado?.orden ?? null)
  const [personas, setPersonas] = useState<Record<string, string>>(guardado?.personas ?? {})
  const [indice, setIndice] = useState(guardado?.indice ?? 0)
  const [registros, setRegistros] = useState<Record<string, Registro>>(guardado?.registros ?? {})
  const [saltados, setSaltados] = useState<ReadonlySet<string>>(new Set(guardado?.saltados ?? []))
  const [visitas, setVisitas] = useState<ReadonlySet<string>>(new Set(guardado?.visitas ?? []))
  const [ultimo, setUltimo] = useState<{ nombre: string; linea: string; avisos: string[] } | null>(null)
  const [agendando, setAgendando] = useState(false)

  // Última versión conocida de cada lead: si sale de «activos» (pasó a fríos)
  // se sigue pudiendo nombrar en el resumen o al volver atrás.
  const conocidas = useRef(new Map<string, FilaCartera>())
  const filas = consulta.data?.filas ?? []
  for (const f of filas) conocidas.current.set(f.id, f)
  const vivas = new Map(filas.map((f) => [f.id, f]))

  const [rehaciendo, setRehaciendo] = useState(false)

  function armar(desde: readonly FilaCartera[]): void {
    const conjunto = new Set(seleccion ?? [])
    const limite = finDeHoy()
    const entran = ordenarCola(desde.filter((f) => entraEnVista(f, vista, conjunto, limite)))
    setOrden(entran.map((f) => f.id))
    setPersonas(Object.fromEntries(entran.map((f) => [f.id, f.personaId])))
  }

  // Congelar el orden la primera vez que llegan datos (ver cabecera).
  useEffect(() => {
    if (orden !== null || rehaciendo || consulta.data === undefined) return
    armar(consulta.data.filas)
    // `armar` se rehace en cada render, pero solo lee `seleccion` y `vista`,
    // que ya están en la lista: con ellas basta.
  }, [orden, rehaciendo, consulta.data, seleccion, vista])

  useEffect(() => {
    if (orden === null) return
    guardarSesion({
      clave,
      orden,
      personas,
      indice,
      registros,
      saltados: [...saltados],
      visitas: [...visitas],
    })
  }, [clave, orden, personas, indice, registros, saltados, visitas])

  const total = orden?.length ?? 0
  const idActual = orden !== null && indice < total ? (orden[indice] ?? null) : null
  const filaActual = idActual === null ? null : (vivas.get(idActual) ?? conocidas.current.get(idActual) ?? null)
  const salioDeLaCola = idActual !== null && consulta.isSuccess && !vivas.has(idActual)
  const idSiguiente = orden !== null ? (orden[indice + 1] ?? null) : null
  const siguienteId = idSiguiente === null ? undefined : vivas.get(idSiguiente)?.id
  const siguientePersona = idSiguiente === null ? undefined : vivas.get(idSiguiente)?.personaId

  // Adelantar la actividad del siguiente: al pasar, ya está.
  useEffect(() => {
    if (siguienteId === undefined || siguientePersona === undefined) return
    void cliente.prefetchQuery({
      queryKey: ['actividad', siguienteId],
      queryFn: () => cargarActividad(siguienteId, siguientePersona),
    })
  }, [siguienteId, siguientePersona, cliente])

  function siguiente(): void {
    if (orden === null || indice >= total) return
    if (idActual !== null && registros[idActual] === undefined) {
      setSaltados((previos) => new Set(previos).add(idActual))
    }
    setUltimo(null)
    setIndice((i) => Math.min(i + 1, total))
    window.scrollTo({ top: 0 })
  }

  function anterior(): void {
    if (indice <= 0) return
    setUltimo(null)
    setIndice((i) => Math.max(i - 1, 0))
    window.scrollTo({ top: 0 })
  }

  function alRegistrar(r: RespuestaContacto): void {
    if (idActual === null || filaActual === null) return
    const id = idActual
    setRegistros((previos) => ({
      ...previos,
      [id]: {
        interaccionId: r.interaccionId,
        situacion: r.situacion,
        pasoAFrios: r.pasoAFrios,
        descartada: r.descartada,
      },
    }))
    setSaltados((previos) => {
      if (!previos.has(id)) return previos
      const n = new Set(previos)
      n.delete(id)
      return n
    })
    setUltimo({ nombre: filaActual.nombreCompleto, linea: lineaRegistro(r), avisos: r.avisos })
    // Avance automático: es la razón de ser de esta pantalla.
    setIndice((i) => Math.min(i + 1, total))
    window.scrollTo({ top: 0 })
  }

  function rehacer(soloSaltados: boolean): void {
    const nuevos = soloSaltados && orden !== null ? orden.filter((id) => saltados.has(id)) : null
    borrarSesion()
    setUltimo(null)
    setIndice(0)
    setSaltados(new Set())
    if (nuevos !== null) {
      // Segunda vuelta: los mismos saltados, en el mismo orden.
      setOrden(nuevos)
      return
    }
    // Rehacer desde cero con datos FRESCOS: armarla con los de la caché
    // devolvería como «nuevos» a los que se acaban de contactar.
    setRegistros({})
    setVisitas(new Set())
    setOrden(null)
    setRehaciendo(true)
    void consulta.refetch().then((r) => {
      setRehaciendo(false)
      if (r.data !== undefined) armar(r.data.filas)
    })
  }

  // Teclado de escritorio: → / n siguiente, ← / p anterior. Los dígitos, «w»
  // y «l» son del panel de contacto. Se ignora al escribir, con un diálogo
  // abierto, y las flechas dentro de un grupo de chips (ahí mueven el foco).
  useEffect(() => {
    function alTecla(e: KeyboardEvent): void {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (esCampoDeTexto(e.target)) return
      if (document.querySelector('[role="dialog"]') !== null) return
      const enChips = e.target instanceof HTMLElement && e.target.closest('[role="radiogroup"]') !== null
      const tecla = e.key
      if (tecla === 'n' || tecla === 'N' || (tecla === 'ArrowRight' && !enChips)) {
        e.preventDefault()
        siguiente()
      } else if (tecla === 'p' || tecla === 'P' || (tecla === 'ArrowLeft' && !enChips)) {
        e.preventDefault()
        anterior()
      }
    }
    window.addEventListener('keydown', alTecla)
    return () => window.removeEventListener('keydown', alTecla)
  })

  if (sinSesion) return <ErrorAlerta mensaje="No se sabe quién eres todavía: vuelve a entrar para ver «Míos»." />
  if (orden === null) {
    if (consulta.error !== null) return <ErrorAlerta mensaje={consulta.error.message} />
    return <Cargando texto={rehaciendo ? 'Rehaciendo la cola con datos frescos…' : 'Armando la cola…'} />
  }

  if (total === 0) return <ColaVacia vista={vista} />

  const nRegistrados = Object.keys(registros).length
  const avance = Math.round((Math.min(indice, total) / total) * 100)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-lg font-black text-foreground" aria-live="polite">
            {indice < total ? `Lead ${indice + 1} de ${total}` : `Cola terminada · ${total} leads`}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-suelo-700">
            <span>
              {nRegistrados} registrados · {saltados.size} saltados · {visitas.size} visitas
            </span>
            {indice < total && (
              <Button
                variant="ghost"
                size="sm"
                className="h-11 sm:h-8"
                onClick={() => {
                  setUltimo(null)
                  setIndice(total)
                }}
              >
                Terminar y ver resumen
              </Button>
            )}
          </p>
        </div>
        <Progress value={avance} aria-label="Avance de la cola" />
      </div>

      {ultimo !== null && (
        <div role="status" className="rounded-md border border-border bg-card p-3 text-sm leading-snug">
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>
              <span className="font-bold">{ultimo.nombre}:</span> {ultimo.linea}
            </span>
          </p>
          {ultimo.avisos.map((a) => (
            <p key={a} className="mt-1 pl-6 text-xs text-suelo-700">
              {a}
            </p>
          ))}
        </div>
      )}

      {consulta.error !== null && (
        <ErrorAlerta mensaje={`No se pudieron refrescar los datos: ${consulta.error.message}`} />
      )}

      {indice >= total ? (
        <ResumenCola
          orden={orden}
          registros={registros}
          saltados={saltados}
          visitas={visitas}
          alRepasarSaltados={() => rehacer(true)}
          alRehacer={() => rehacer(false)}
        />
      ) : filaActual === null ? (
        <Cargando texto="Cargando el lead…" />
      ) : salioDeLaCola ? (
        <Vacia titulo={`${filaActual.nombreCompleto} ya no está entre los activos.`}>
          {registros[filaActual.id] !== undefined
            ? `Tras el contacto quedó «${etiquetaSituacion(registros[filaActual.id]?.situacion ?? null)}». `
            : 'Pasó a fríos, se descartó o cambió de responsable después de entrar en la cola. '}
          Su ficha tiene el detalle.
          <span className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" className="h-12 sm:h-10">
              <Link to={rutaFicha({ id: filaActual.id, personaId: personas[filaActual.id] ?? filaActual.personaId })}>
                <ExternalLink strokeWidth={1.75} aria-hidden="true" />
                Abrir ficha
              </Link>
            </Button>
          </span>
        </Vacia>
      ) : (
        <>
          <TarjetaLead
            fila={filaActual}
            mensaje={mensajeParaFila(filaActual, agente, umbralFrio)}
            visitaEnSesion={visitas.has(filaActual.id)}
          />
          <PerfilRapido
            key={`perfil-${filaActual.id}`}
            oportunidadId={filaActual.id}
            puedeEditar={puedeEditar(filaActual, rol, yo)}
            alGuardar={() => void cliente.invalidateQueries({ queryKey: ['cartera'] })}
          />
          <PanelContacto
            key={`panel-${filaActual.id}`}
            fila={filaActual}
            compacto
            atajos
            alRegistrar={alRegistrar}
            alAgendarVisita={() => setAgendando(true)}
          />
          <DialogoAgendarVisita
            key={`visita-${filaActual.id}`}
            abierto={agendando}
            alCerrar={() => setAgendando(false)}
            oportunidadId={filaActual.id}
            alAgendar={() => {
              const id = filaActual.id
              setVisitas((previos) => new Set(previos).add(id))
              invalidarTrasAccion(cliente, filaActual.personaId)
            }}
          />
        </>
      )}

      {consulta.data !== undefined && (
        <AvisosLote descartadas={consulta.data.descartadas} filas={consulta.data.filas.length} />
      )}

      {indice < total && (
        <Navegacion
          puedeAnterior={indice > 0}
          yaRegistrado={idActual !== null && registros[idActual] !== undefined}
          fichaA={
            filaActual !== null
              ? rutaFicha({ id: filaActual.id, personaId: personas[filaActual.id] ?? filaActual.personaId })
              : null
          }
          alAnterior={anterior}
          alSiguiente={siguiente}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// El lead
// ---------------------------------------------------------------------------

/** Cuántos movimientos recientes se enseñan: los justos para saber de qué se habló. */
const ACTIVIDAD_VISIBLE = 3

function TarjetaLead({
  fila,
  mensaje,
  visitaEnSesion,
}: {
  fila: FilaCartera
  mensaje: string
  visitaEnSesion: boolean
}) {
  const f = fila
  const actividad = useQuery({
    queryKey: ['actividad', f.id],
    queryFn: () => cargarActividad(f.id, f.personaId),
  })
  const vencida = tareaVencida(f.proximaTareaVenceEl)
  const usuario = f.usuarioRed === null ? null : `@${f.usuarioRed.replace(/^@+/, '')}`

  return (
    <section aria-labelledby="nombre-lead" className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="nombre-lead" className="text-2xl font-black tracking-tight text-foreground">
          {f.nombreCompleto}
        </h2>
        <InsigniaTemperatura temperatura={f.temperatura} motivo={f.temperaturaMotivo} />
        <span className="text-sm text-suelo-700">{etiquetaEstado(f.estado)}</span>
      </div>
      {f.temperaturaMotivo !== null && (
        <p className="mt-1 text-xs text-suelo-700">{f.temperaturaMotivo}</p>
      )}

      <div className="mt-4 space-y-3">
        {f.telefonoE164 !== null && (
          <p className="text-3xl font-black tabular-nums tracking-tight text-foreground sm:text-4xl">
            {formatearTelefono(f.telefonoE164)}
          </p>
        )}
        {usuario !== null && <p className="text-sm font-bold text-suelo-700">{usuario}</p>}
        <BotonesContacto
          telefonoE164={f.telefonoE164}
          usuarioRed={f.usuarioRed}
          redSocial={f.redSocial}
          mensaje={mensaje}
        />
      </div>

      <ul className="mt-4 space-y-1 text-sm text-suelo-700">
        <li className="flex flex-wrap items-center gap-x-2">
          <Megaphone className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>
            {f.campanaNombre ?? 'Sin campaña'}
            {f.origen !== null && ` · ${etiquetaOrigen(f.origen)}`}
            {` · entró ${fechaRelativa(f.fechaIngreso)}`}
          </span>
        </li>
        <li className={cn('flex flex-wrap items-center gap-x-2', vencida && 'font-black text-foreground')}>
          <History className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {f.proximaTareaVenceEl === null ? (
            <span className="font-bold text-foreground">Sin próximo paso</span>
          ) : (
            <span>
              {f.proximaTareaTitulo ?? 'Próximo paso'} · {textoVencimiento(f.proximaTareaVenceEl)}
            </span>
          )}
          {f.intentosSinRespuesta > 0 && (
            <span className="font-normal">
              · {f.intentosSinRespuesta === 1 ? '1 intento' : `${f.intentosSinRespuesta} intentos`} sin
              respuesta
            </span>
          )}
        </li>
        {(tieneVisitaAbierta(f) || visitaEnSesion) && (
          <li className="flex flex-wrap items-center gap-x-2 font-bold text-foreground">
            <CalendarClock className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {tieneVisitaAbierta(f) ? `Visita ${diaYHora(f.visitaInicioEl)}` : 'Visita agendada en esta sesión'}
          </li>
        )}
      </ul>

      <div className="mt-4 border-t border-tinta-fila pt-3">
        <p className="text-xs font-bold text-suelo-700">Lo último</p>
        {actividad.isPending && <p className="mt-1 text-xs text-suelo-500">Cargando…</p>}
        {actividad.error !== null && (
          <p className="mt-1 text-xs font-bold text-alerta">No se pudo leer la actividad: {actividad.error.message}</p>
        )}
        {actividad.isSuccess && actividad.data.length === 0 && (
          <p className="mt-1 text-xs text-suelo-700">Nada todavía: este es el primer contacto.</p>
        )}
        {actividad.isSuccess && actividad.data.length > 0 && (
          <ul className="mt-1 space-y-1">
            {actividad.data.slice(0, ACTIVIDAD_VISIBLE).map((a) => (
              <li key={`${a.tipo}-${a.id}`} className="text-xs leading-snug">
                <span className="tabular-nums text-suelo-500">{fechaHora(a.ocurrioEl)}</span>{' '}
                <span className="font-bold text-foreground">{a.titulo}</span>
                {a.detalle !== null && <span className="text-suelo-700"> — {a.detalle}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

/**
 * En el móvil, barra fija abajo: se maneja con el pulgar sin subir la
 * pantalla (48 px de alto). En escritorio, una fila normal con los atajos a
 * la vista.
 */
function Navegacion({
  puedeAnterior,
  yaRegistrado,
  fichaA,
  alAnterior,
  alSiguiente,
}: {
  puedeAnterior: boolean
  yaRegistrado: boolean
  fichaA: string | null
  alAnterior: () => void
  alSiguiente: () => void
}) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background px-4 pt-2',
        'pb-[calc(0.5rem+env(safe-area-inset-bottom))]',
        'sm:static sm:border-0 sm:bg-transparent sm:p-0',
      )}
    >
      <div className="mx-auto grid max-w-3xl grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Button variant="outline" className="h-12 sm:h-10" disabled={!puedeAnterior} onClick={alAnterior}>
          <ArrowLeft strokeWidth={1.75} aria-hidden="true" />
          Anterior
        </Button>
        <Button variant={yaRegistrado ? 'default' : 'outline'} className="h-12 sm:h-10" onClick={alSiguiente}>
          {yaRegistrado ? (
            <>
              Siguiente
              <ArrowRight strokeWidth={1.75} aria-hidden="true" />
            </>
          ) : (
            <>
              <SkipForward strokeWidth={1.75} aria-hidden="true" />
              Saltar
            </>
          )}
        </Button>
        {fichaA !== null ? (
          <Button asChild variant="outline" className="h-12 sm:h-10">
            <Link to={fichaA}>
              <ExternalLink strokeWidth={1.75} aria-hidden="true" />
              Ficha
            </Link>
          </Button>
        ) : (
          <span />
        )}
        <p className="hidden text-xs text-suelo-500 sm:ml-auto sm:block">
          Teclas: <kbd>1</kbd>–<kbd>0</kbd> resultado · <kbd>W</kbd> WhatsApp · <kbd>L</kbd> llamar ·{' '}
          <kbd>←</kbd>/<kbd>→</kbd> anterior / siguiente
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

/**
 * Los resultados EXACTOS de la sesión se leen de `interacciones` por id: la
 * respuesta de `fn_registrar_contacto` no repite el resultado elegido, y
 * deducirlo de sus banderas confundiría «Contestó» con «Me escribió». Si la
 * lectura falla, el resumen se queda con lo que sí se sabe (fríos,
 * descartados, visitas) y lo dice.
 */
async function cargarResultados(ids: readonly string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {}
  const { data, error } = await supabase.from('interacciones').select('id, resultado').in('id', [...ids])
  if (error !== null) throw new Error(error.message)
  const lote = leerLote(data, (fila) => {
    if (typeof fila !== 'object' || fila === null) return null
    const f = fila as Record<string, unknown>
    return texto(f['id']) === null ? null : { resultado: texto(f['resultado']) }
  })
  const conteo: Record<string, number> = {}
  for (const f of lote.filas) {
    const etiqueta = etiquetaResultado(f.resultado)
    conteo[etiqueta] = (conteo[etiqueta] ?? 0) + 1
  }
  return conteo
}

function ResumenCola({
  orden,
  registros,
  saltados,
  visitas,
  alRepasarSaltados,
  alRehacer,
}: {
  orden: readonly string[]
  registros: Readonly<Record<string, Registro>>
  saltados: ReadonlySet<string>
  visitas: ReadonlySet<string>
  alRepasarSaltados: () => void
  alRehacer: () => void
}) {
  const lista = Object.values(registros)
  const ids = lista.map((r) => r.interaccionId).sort()
  const resultados = useQuery({
    queryKey: ['cola', 'resumen', ids],
    queryFn: () => cargarResultados(ids),
    enabled: ids.length > 0,
  })

  const aFrios = lista.filter((r) => r.pasoAFrios || r.situacion === 'pausada').length
  const descartados = lista.filter((r) => r.descartada || r.situacion === 'perdida').length
  const sinTocar = orden.filter((id) => registros[id] === undefined).length

  return (
    <section aria-labelledby="titulo-resumen" className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 id="titulo-resumen" className="text-xl font-black text-foreground">
        Resumen de la sesión
      </h2>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cifra titulo="Registrados" valor={lista.length} />
        <Cifra titulo="Sin registrar" valor={sinTocar} />
        <Cifra titulo="Pasaron a fríos" valor={aFrios} />
        <Cifra titulo="Visitas agendadas" valor={visitas.size} />
      </dl>

      {descartados > 0 && (
        <p className="text-sm text-suelo-700">
          {descartados === 1 ? '1 quedó descartado' : `${descartados} quedaron descartados`} (no le
          interesa, número equivocado o no contactar).
        </p>
      )}

      <div>
        <p className="text-sm font-bold text-foreground">Por resultado</p>
        {ids.length === 0 && <p className="mt-1 text-sm text-suelo-700">No se registró ningún contacto.</p>}
        {resultados.isPending && ids.length > 0 && <p className="mt-1 text-sm text-suelo-500">Contando…</p>}
        {resultados.error !== null && (
          <p className="mt-1 text-xs font-bold text-alerta">
            No se pudo leer el detalle por resultado ({resultados.error.message}). Las cifras de
            arriba sí son de esta sesión.
          </p>
        )}
        {resultados.data !== undefined && (
          <ul className="mt-1 space-y-0.5 text-sm">
            {Object.entries(resultados.data)
              .sort((a, b) => b[1] - a[1])
              .map(([etiqueta, n]) => (
                <li key={etiqueta}>
                  <span className="font-bold tabular-nums">{n}</span> · {etiqueta}
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {saltados.size > 0 && (
          <Button className="h-12 sm:h-10" onClick={alRepasarSaltados}>
            <RotateCcw strokeWidth={1.75} aria-hidden="true" />
            Repasar los {saltados.size} saltados
          </Button>
        )}
        <Button variant="outline" className="h-12 sm:h-10" onClick={alRehacer}>
          <CalendarPlus strokeWidth={1.75} aria-hidden="true" />
          Rehacer la cola
        </Button>
        <Button asChild variant="ghost" className="h-12 sm:h-10">
          <Link to="/personas">Volver a Personas</Link>
        </Button>
      </div>
    </section>
  )
}

function Cifra({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="border-l-[3px] border-tinta-fila pl-3">
      <dt className="text-xs font-bold text-suelo-700">{titulo}</dt>
      <dd className="text-2xl font-black tabular-nums text-foreground">{valor}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vacíos
// ---------------------------------------------------------------------------

function Enlace({ a, children }: { a: string; children: ReactNode }) {
  return (
    <Link to={a} className="font-bold text-primary underline-offset-4 hover:underline">
      {children}
    </Link>
  )
}

function Vacia({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 text-sm">
      <p className="font-bold text-foreground">{titulo}</p>
      <p className="mt-1 leading-relaxed text-suelo-700">{children}</p>
    </div>
  )
}

function ColaVacia({ vista }: { vista: Vista }) {
  switch (vista) {
    case 'nuevos':
      return (
        <Vacia titulo="No queda ningún lead sin contactar.">
          Todos tienen al menos un contacto registrado. Sigue con «Pendientes de hoy», o registra
          leads nuevos en <Enlace a="/registro-rapido">Registro rápido</Enlace>.
        </Vacia>
      )
    case 'pendientes':
      return (
        <Vacia titulo="No hay seguimientos pendientes para hoy.">
          Nadie tiene un próximo paso que venza hoy o antes. Mira los «Nuevos» o la{' '}
          <Enlace a="/personas?tab=bandeja">Bandeja web</Enlace>.
        </Vacia>
      )
    case 'seleccion':
      return (
        <Vacia titulo="Ninguno de los elegidos sigue activo.">
          Puede que ya estén en fríos o descartados, o que no tengas acceso a ellos. Revísalos en{' '}
          <Enlace a="/personas?tab=frios">Fríos</Enlace>.
        </Vacia>
      )
    case 'campana':
      return (
        <Vacia titulo="Esta campaña no tiene activos.">
          Sus leads pueden estar en fríos o descartados, o asignados a otra persona. Prueba con
          «Todos» o revisa <Enlace a="/personas?tab=frios">Fríos</Enlace>.
        </Vacia>
      )
  }
}
