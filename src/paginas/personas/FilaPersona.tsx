import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, Megaphone, UserRound } from 'lucide-react'
import { BotonesContacto } from '@/componentes/crm/BotonesContacto'
import { InsigniaTemperatura } from '@/componentes/crm/InsigniaTemperatura'
import { cn } from '@/lib/utils'
import type { Rol } from '@/auth/tipos-sesion'
import { LIMITE_CARTERA, type FilaCartera } from '@/lib/cartera'
import { etiquetaEstado } from '@/lib/embudo'
import { diaYHora, textoVencimiento } from '@/lib/fechas'
import { cargarParametrosPorId, enteroDeParametro } from '@/lib/parametros'
import { armarMensaje, datosDesdeCartera, plantillaSugerida } from '@/lib/plantillas'
import { formatearTelefono } from '@/lib/telefono'

/**
 * FILA DE PERSONA — una oportunidad de la cartera en dos líneas.
 *
 * Además de la fila, este archivo guarda lo poco que comparten la lista de
 * Personas y el Modo llamadas (src/paginas/cola): quién opera, a dónde lleva
 * la fila, qué mensaje se sugiere y qué se invalida tras una acción. Vive aquí
 * y no en index.tsx porque las pestañas importan de aquí y index.tsx importa
 * las pestañas: ponerlo en index.tsx sería una importación circular.
 *
 * ===========================================================================
 * TODA LA FILA ES UN ENLACE, PERO LOS BOTONES NO ESTÁN DENTRO DEL ENLACE
 * ===========================================================================
 * `BotonesContacto` pinta enlaces (`whatsapp://`, `tel:`), y un <a> dentro de
 * otro <a> es HTML inválido: cada navegador lo repara a su manera y el lector
 * de pantalla anuncia un enlace gigante con cuatro enlaces dentro. Se usa el
 * «enlace estirado»: el nombre es el único <a> a la ficha y su `::after` cubre
 * la fila entera; los botones y la casilla van por encima con `relative z-10`.
 * Resultado: tocar la fila abre la ficha, tocar «Llamar» llama, y el HTML es
 * válido.
 *
 * ===========================================================================
 * NINGÚN NÚMERO DE NEGOCIO
 * ===========================================================================
 * La fila no calcula nada: la temperatura y su motivo los da `v_cartera`
 * (fn_temperatura), el vencimiento lo redacta `textoVencimiento`, y el mensaje
 * sugerido lo arma src/lib/plantillas.ts, que solo usa datos de `parametros`
 * en 🟢 (07-crm/CLAUDE.md §2; SPEC §2).
 */

// ---------------------------------------------------------------------------
// Compartido con las pestañas y con el Modo llamadas
// ---------------------------------------------------------------------------

/**
 * Roles que pueden OPERAR una oportunidad: registrar contacto, enfriar,
 * descartar, asignar. Copiado de `puede_operar_oportunidad`
 * (13-seguimiento-comercial.sql, SPEC §4.5), no decidido aquí: dirección y
 * administración siempre; comercial en las suyas y en las sin dueño — ese
 * «en las suyas» lo comprueba la base, y lo que no le toca vuelve como error.
 * Contabilidad y lectura miran, no tocan.
 */
export const ROLES_OPERAN: readonly Rol[] = ['direccion', 'comercial', 'administracion']

export function puedeOperar(rol: Rol | null): boolean {
  return rol !== null && ROLES_OPERAN.includes(rol)
}

export type AlcanceResponsable = 'mios' | 'sin_dueno' | 'todos'

export const ALCANCES_RESPONSABLE = [
  { valor: 'mios', etiqueta: 'Míos' },
  { valor: 'sin_dueno', etiqueta: 'Sin dueño' },
  { valor: 'todos', etiqueta: 'Todos' },
] as const satisfies readonly { valor: AlcanceResponsable; etiqueta: string }[]

export function esAlcance(v: string | null): v is AlcanceResponsable {
  return v === 'mios' || v === 'sin_dueno' || v === 'todos'
}

/**
 * Qué cartera ve cada rol al entrar (SPEC §7 S1): el vendedor, la suya —es la
 * que tiene que trabajar—; dirección y administración, la de todos, porque su
 * trabajo es repartir y vigilar. Con RLS (02-rls.sql `oport_leer` +
 * `oport_leer_sin_dueno`), el «Todos» de un comercial son las suyas más las
 * que no tienen dueño: nunca las de otro vendedor.
 */
export function alcancePorDefecto(rol: Rol | null): AlcanceResponsable {
  return rol === 'comercial' ? 'mios' : 'todos'
}

/** A dónde lleva una fila: la ficha de la persona, abierta en ESTA oportunidad. */
export function rutaFicha(f: { personaId: string; id: string }): string {
  return `/personas/${encodeURIComponent(f.personaId)}?o=${encodeURIComponent(f.id)}`
}

/** Clave de sessionStorage con la que la lista y Registro rápido le pasan ids al Modo llamadas. */
export const CLAVE_IDS_COLA = 'crm.cola.ids'

/**
 * Guarda los ids para el Modo llamadas. Devuelve `false` si el navegador no
 * deja escribir (modo privado estricto, almacenamiento lleno): quien llama lo
 * dice en pantalla en vez de abrir una cola vacía con cara de «no hay nadie».
 */
export function guardarIdsCola(ids: readonly string[]): boolean {
  try {
    window.sessionStorage.setItem(CLAVE_IDS_COLA, JSON.stringify([...ids]))
    return true
  } catch {
    return false
  }
}

/**
 * Tras cualquier acción sobre una oportunidad: la cartera (todas sus
 * variantes, por prefijo), Hoy, el embudo, la bandeja y —si se sabe— la ficha
 * de esa persona (SPEC §8). Invalidar de más cuesta una consulta; invalidar de
 * menos deja una lista que miente hasta que alguien recargue.
 */
export function invalidarTrasAccion(cliente: QueryClient, personaId?: string | undefined): void {
  void cliente.invalidateQueries({ queryKey: ['cartera'] })
  void cliente.invalidateQueries({ queryKey: ['hoy'] })
  void cliente.invalidateQueries({ queryKey: ['embudo'] })
  void cliente.invalidateQueries({ queryKey: ['bandeja'] })
  if (personaId !== undefined) void cliente.invalidateQueries({ queryKey: ['ficha', personaId] })
}

const ID_UMBRAL_FRIO = 'frio_intentos_sin_respuesta'

/** Cuánto se fía la pantalla del parámetro leído. Tiempo de interfaz, no de negocio. */
const PARAMETRO_VIGENTE_MS = 5 * 60_000

/**
 * El umbral de frío (`frio_intentos_sin_respuesta`, 🔵 propuesta en
 * `parametros`, SPEC §4.4). Solo sirve para que la plantilla sugerida sea el
 * «último mensaje por ahora» ANTES de que el lead pase a fríos, no después.
 * Si no se puede leer, `null`: la sugerencia sigue la escalera sin ese matiz.
 * No se inventa un umbral por defecto — lo aplica la base, no esta pantalla.
 */
export function useUmbralFrio(): number | null {
  const consulta = useQuery({
    queryKey: ['parametros', 'por-id', ID_UMBRAL_FRIO],
    queryFn: () => cargarParametrosPorId([ID_UMBRAL_FRIO]),
    staleTime: PARAMETRO_VIGENTE_MS,
  })
  return enteroDeParametro(consulta.data?.[ID_UMBRAL_FRIO] ?? null)
}

/**
 * El mensaje de WhatsApp que se propone para esta fila. Es una SUGERENCIA
 * (plantillaSugerida): el panel de contacto deja elegir otra plantilla.
 */
export function mensajeParaFila(
  f: FilaCartera,
  agente: string | null,
  umbralFrio: number | null,
): string {
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

/** Estados de visita que siguen ABIERTOS (SPEC §4.3): las demás son historia. */
const VISITA_ABIERTA: readonly string[] = ['agendada', 'confirmada']

export function tieneVisitaAbierta(f: FilaCartera): boolean {
  return f.visitaInicioEl !== null && f.visitaEstado !== null && VISITA_ABIERTA.includes(f.visitaEstado)
}

/** La tarea ya pasó su hora. `textoVencimiento` cuenta días; esto mira el instante. */
export function tareaVencida(venceEl: string | null, ahora: number = Date.now()): boolean {
  if (venceEl === null) return false
  const t = Date.parse(venceEl)
  return !Number.isNaN(t) && t < ahora
}

// ---------------------------------------------------------------------------
// La fila
// ---------------------------------------------------------------------------

export function FilaPersona({
  fila,
  agente,
  umbralFrio,
  mostrarResponsable = false,
  seleccionable = false,
  seleccionada = false,
  alSeleccionar,
  detalle,
  acciones,
}: {
  fila: FilaCartera
  /** Nombre de quien escribe, para el saludo de la plantilla. */
  agente: string | null
  umbralFrio: number | null
  /** En «Todos» / «Sin dueño» importa de quién es; en «Míos», sobra. */
  mostrarResponsable?: boolean | undefined
  seleccionable?: boolean | undefined
  seleccionada?: boolean | undefined
  alSeleccionar?: ((id: string, elegida: boolean) => void) | undefined
  /** Tercera línea propia de una pestaña: el motivo del frío o del descarte. */
  detalle?: ReactNode | undefined
  /** Botones propios de una pestaña (Reactivar, Mover a fríos…), junto a los de contacto. */
  acciones?: ReactNode | undefined
}) {
  const f = fila
  const vencida = tareaVencida(f.proximaTareaVenceEl)
  const contacto =
    f.telefonoE164 !== null
      ? formatearTelefono(f.telefonoE164)
      : f.usuarioRed !== null
        ? `@${f.usuarioRed.replace(/^@+/, '')}`
        : null

  return (
    <li
      className={cn(
        'relative flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-tinta-fila px-3 py-3',
        'last:border-b-0 focus-within:bg-tinta-grupo hover:bg-tinta-grupo sm:px-4',
        seleccionada && 'bg-tinta-banda',
      )}
    >
      {seleccionable && (
        // 44 × 44 de objetivo aunque la casilla mida 20: se marca con el pulgar.
        <label className="relative z-10 -my-1 -ml-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={seleccionada}
            onChange={(e) => alSeleccionar?.(f.id, e.target.checked)}
            className="h-5 w-5 cursor-pointer accent-azul"
          />
          <span className="sr-only">Elegir a {f.nombreCompleto}</span>
        </label>
      )}

      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={rutaFicha(f)}
            className={cn(
              'rounded-sm font-bold text-foreground hover:underline',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              // El enlace estirado: ver la cabecera de este archivo.
              'after:absolute after:inset-0 after:content-[""]',
            )}
          >
            {f.nombreCompleto}
          </Link>
          <InsigniaTemperatura temperatura={f.temperatura} motivo={f.temperaturaMotivo} compacta />
          <span className="text-xs text-suelo-700">{etiquetaEstado(f.estado)}</span>
          {f.sinDueno && <span className="text-xs font-bold text-suelo-700">· Sin dueño</span>}
        </p>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-suelo-700">
          {contacto !== null && <span className="tabular-nums">{contacto}</span>}

          {f.campanaNombre !== null && (
            <span className="inline-flex items-center gap-1">
              <Megaphone className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              {f.campanaNombre}
            </span>
          )}

          {mostrarResponsable && !f.sinDueno && (
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              {/* `null` con responsable puesto = RLS no deja leer ese perfil
                  (cartera.ts): se dice, no se deja en blanco. */}
              {f.responsableNombre ?? 'Responsable sin nombre visible'}
            </span>
          )}

          <ProximoPaso fila={f} vencida={vencida} />

          {tieneVisitaAbierta(f) && (
            <span className="inline-flex items-center gap-1 font-bold text-foreground">
              <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Visita {diaYHora(f.visitaInicioEl)}
            </span>
          )}
        </p>

        {detalle !== undefined && <div className="mt-1 text-xs text-suelo-700">{detalle}</div>}
      </div>

      <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-2">
        {acciones}
        <BotonesContacto
          telefonoE164={f.telefonoE164}
          usuarioRed={f.usuarioRed}
          redSocial={f.redSocial}
          mensaje={f.noContactar ? undefined : mensajeParaFila(f, agente, umbralFrio)}
          tamano="sm"
        />
      </div>
    </li>
  )
}

/**
 * El próximo paso, o su ausencia. Una oportunidad activa SIN tarea abierta es
 * R6 roto (07-crm/CLAUDE.md §4: «hay semanas, incluso meses, en los que no
 * hacemos seguimiento»): se dice en Bold y con icono, no se deja en blanco.
 * Vencida = Black, al día = Regular (brief de diseño: peso, no color).
 */
function ProximoPaso({ fila, vencida }: { fila: FilaCartera; vencida: boolean }) {
  if (fila.proximaTareaVenceEl === null) {
    if (fila.situacion !== 'activa') return null
    return (
      <span className="inline-flex items-center gap-1 font-bold text-foreground">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        Sin próximo paso
      </span>
    )
  }

  return (
    <span className={cn(vencida ? 'font-black text-foreground' : 'font-normal')}>
      {fila.proximaTareaTitulo ?? 'Próximo paso'} · {textoVencimiento(fila.proximaTareaVenceEl)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Estados de carga compartidos por las pestañas y la cola
// ---------------------------------------------------------------------------

export function Cargando({ texto }: { texto: string }) {
  return (
    <p className="flex items-center gap-2 py-10 text-sm text-suelo-500">
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
      {texto}
    </p>
  )
}

export function ErrorAlerta({ mensaje, className }: { mensaje: string; className?: string | undefined }) {
  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-3 text-sm font-bold leading-snug text-alerta',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      {mensaje}
    </p>
  )
}

/** Una línea de «hecho» tras una acción. `role="status"`: el lector la anuncia sin robar el foco. */
export function AvisoHecho({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md border border-border bg-card p-3 text-sm leading-snug text-foreground"
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/**
 * Lo que la lista NO está enseñando. Filas ilegibles (descartadas por
 * `leerLote`) y el tope técnico LIMITE_CARTERA: una lista que llega justo al
 * tope casi seguro tiene más detrás, y decirlo es la diferencia entre «no hay
 * más» y «no te las estoy enseñando» (mismo criterio que LIMITE_TARJETAS).
 */
export function AvisosLote({ descartadas, filas }: { descartadas: number; filas: number }) {
  if (descartadas === 0 && filas < LIMITE_CARTERA) return null
  return (
    <div className="space-y-1">
      {filas >= LIMITE_CARTERA && (
        <p className="text-xs font-bold text-foreground">
          Mostrando {LIMITE_CARTERA} de más. Faltan las que entraron antes: acota con la búsqueda,
          la campaña o el responsable.
        </p>
      )}
      {descartadas > 0 && (
        <p className="text-xs font-bold text-alerta">
          🔴 {descartadas} {descartadas === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer'}{' '}
          y no están en la lista. Revisa que sql/13-seguimiento-comercial.sql esté aplicado entero.
        </p>
      )}
    </div>
  )
}
