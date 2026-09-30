import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Plus, Settings2 } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent } from '@/componentes/ui/card'
import { claseCampo } from '@/componentes/ui/input'
import { SelectorResponsable } from '@/componentes/crm/SelectorResponsable'
import { cn } from '@/lib/utils'
import { aEntradaLocal, deEntradaLocal, diaYHora } from '@/lib/fechas'
import { cargarEquipo } from '@/lib/contacto'
import { ORIGENES, esOrigen, type Origen } from '@/lib/registro-rapido'
import {
  PLATAFORMAS_CAMPANA,
  REDES_SOCIALES,
  asegurarCampana,
  cargarCampanas,
  type Campana,
  type PlataformaCampana,
  type RedSocial,
} from '@/lib/lote'

/**
 * CONFIGURACION DE LA SESION DE REGISTRO — lo que es COMUN a todos los leads
 * que se cargan seguidos: de donde vienen, de que campaña, a cargo de quien y
 * a que hora entraron.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE (SPEC §0 y §7 S6)
 * ---------------------------------------------------------------------------
 * El 28/09 entraron 50 leads de un TikTok Live y se cargaron al dia siguiente.
 * Con el registro de 06 cada uno quedaba sin campaña y con la hora de cuando
 * se teclearon, no la del live: el SLA de primera respuesta decia «a tiempo»
 * de leads que llevaban un dia esperando. Aqui la hora del live se pone UNA
 * vez y la heredan todos.
 *
 * ---------------------------------------------------------------------------
 * QUE SE GUARDA Y DONDE
 * ---------------------------------------------------------------------------
 * `sessionStorage['crm.registro.sesion']`, con try/catch: si el navegador no
 * deja (modo privado, almacenamiento lleno), la pantalla funciona igual y solo
 * se pierde la comodidad de no volver a elegir la campaña. Solo se guardan
 * elecciones de trabajo (origen, id de campaña, id de responsable, hora, red),
 * NUNCA un dato personal ni el consentimiento: el consentimiento es un acto de
 * cada persona (Ley 29733) y no se arrastra de un lead al siguiente.
 *
 * Se guarda tambien el id de quien la configuro: si otra persona entra al CRM
 * en la misma pestaña, no hereda la campaña ni el responsable del anterior.
 */

// ---------------------------------------------------------------------------
// Estado de la sesion
// ---------------------------------------------------------------------------

export type SesionRegistro = {
  /** Perfil que la configuro. Otra persona en la misma pestaña empieza de cero. */
  perfilId: string | null
  origen: Origen
  campanaId: string | null
  /** `null` = quien registra (la base pone `auth.uid()`, SPEC §4.5). */
  responsableId: string | null
  /** Valor del `<input type="datetime-local">`. Vacio = la hora de cada guardado. */
  fechaIngresoLocal: string
  /** Red de los @usuario cuando la campaña no la dice (Meta, web, presencial, sin campaña). */
  redSocial: RedSocial | null
}

const CLAVE_SESION = 'crm.registro.sesion'

function sesionInicial(perfilId: string | null): SesionRegistro {
  return {
    perfilId,
    // En un live entran veinte seguidos por el mismo canal: el origen por
    // defecto es el del caso que motivo esta pantalla (SPEC §0).
    origen: 'live',
    campanaId: null,
    responsableId: null,
    fechaIngresoLocal: '',
    redSocial: null,
  }
}

function esRedSocial(v: unknown): v is RedSocial {
  return typeof v === 'string' && REDES_SOCIALES.some((r) => r.valor === v)
}

function textoONulo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/**
 * Lee la sesion guardada SIN suponer su forma (lo guardado pudo escribirlo
 * otra version de la pantalla). Lo que no se reconoce vuelve al valor inicial.
 */
export function leerSesion(perfilId: string | null): SesionRegistro {
  const inicial = sesionInicial(perfilId)
  let crudo: unknown = null
  try {
    const texto = window.sessionStorage.getItem(CLAVE_SESION)
    crudo = texto === null ? null : (JSON.parse(texto) as unknown)
  } catch {
    return inicial
  }
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return inicial
  const g = crudo as Record<string, unknown>
  if (g['perfilId'] !== perfilId) return inicial

  const fecha = typeof g['fechaIngresoLocal'] === 'string' ? g['fechaIngresoLocal'] : ''
  return {
    perfilId,
    origen: esOrigen(g['origen']) ? g['origen'] : inicial.origen,
    campanaId: textoONulo(g['campanaId']),
    responsableId: textoONulo(g['responsableId']),
    // Una hora que ya no se entiende se descarta: mejor «ahora» a la vista que
    // una hora rara heredada sin que nadie la vea.
    fechaIngresoLocal: deEntradaLocal(fecha) === null ? '' : fecha,
    redSocial: esRedSocial(g['redSocial']) ? g['redSocial'] : null,
  }
}

export function guardarSesion(s: SesionRegistro): void {
  try {
    window.sessionStorage.setItem(CLAVE_SESION, JSON.stringify(s))
  } catch {
    // Sin almacenamiento la pantalla sigue funcionando; solo no recuerda.
  }
}

// ---------------------------------------------------------------------------
// La cola de llamadas (Modo cola, SPEC §7 S7)
// ---------------------------------------------------------------------------

/** Clave compartida con Personas y Modo cola: un JSON con los ids de OPORTUNIDAD. */
const CLAVE_COLA = 'crm.cola.ids'

/** Ruta de la cola en modo «selección» (lee `CLAVE_COLA`). */
export const RUTA_COLA_SELECCION = '/cola?vista=seleccion'

/**
 * Deja en `sessionStorage` las oportunidades a llamar. `false` si el navegador
 * no deja guardar: entonces la pantalla lo dice en vez de abrir una cola vacia.
 */
export function prepararCola(oportunidadIds: readonly string[]): boolean {
  try {
    window.sessionStorage.setItem(CLAVE_COLA, JSON.stringify([...new Set(oportunidadIds)]))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Campañas y lo que se deduce de ellas
// ---------------------------------------------------------------------------

/** Las campañas cambian poco durante un live. Cache de interfaz, no dato de negocio. */
const CAMPANAS_VIGENTES_MS = 60 * 1000

/** Clave `['campanas']` (SPEC §8), compartida con cualquier pantalla que las liste. */
export function useCampanas() {
  return useQuery({ queryKey: ['campanas'], queryFn: cargarCampanas, staleTime: CAMPANAS_VIGENTES_MS })
}

/**
 * Plataforma de la campaña → red de los @usuario. Solo las que son UNA red:
 * «Meta (FB/IG) anuncios» puede ser cualquiera de las dos, y web o presencial
 * no tienen @usuario. En esos casos la red se elige a mano.
 */
const RED_DE_PLATAFORMA: Readonly<Partial<Record<string, RedSocial>>> = {
  tiktok: 'tiktok',
  instagram: 'instagram',
  facebook: 'facebook',
  youtube: 'youtube',
}

export function redDePlataforma(plataforma: string | null): RedSocial | null {
  return plataforma === null ? null : (RED_DE_PLATAFORMA[plataforma] ?? null)
}

export function etiquetaPlataforma(plataforma: string | null): string {
  return PLATAFORMAS_CAMPANA.find((p) => p.valor === plataforma)?.etiqueta ?? 'Sin plataforma'
}

/**
 * Canal del consentimiento de un lead que llego en un live (SPEC §3, §7 S6):
 * 'tiktok_live', 'instagram_live'…; 'live' si la campaña no dice la red.
 * Tiene que cumplir `^[a-z_]{3,40}$` (fn_registrar_prospecto, SPEC §4.5).
 */
export function canalConsentimientoLive(plataforma: string | null): string {
  const red = redDePlataforma(plataforma)
  return red === null ? 'live' : `${red}_live`
}

/**
 * Lo que las tres formas de registrar necesitan, ya resuelto: la sesion
 * guardada mas la campaña cargada de la base.
 */
export type ContextoRegistro = {
  origen: Origen
  campanaId: string | null
  campana: Campana | null
  /** La campaña guardada ya no esta entre las vigentes (archivada): se deja de usar. */
  campanaPerdida: boolean
  responsableId: string | null
  /** ISO, o `null` = la hora de cada guardado. */
  fechaIngreso: string | null
  /** La base rechaza una hora futura (SPEC §4.5); se avisa antes del viaje. */
  fechaFutura: boolean
  redSocial: RedSocial | null
  /** La red salio de la plataforma de la campaña (y no de la eleccion manual). */
  redPorCampana: boolean
}

/** Un minuto de holgura: el `datetime-local` no tiene segundos. No es una regla de negocio. */
const HOLGURA_RELOJ_MS = 60 * 1000

export function resolverContexto(
  s: SesionRegistro,
  campanas: readonly Campana[] | undefined,
): ContextoRegistro {
  const campana = s.campanaId === null ? null : (campanas?.find((c) => c.id === s.campanaId) ?? null)
  // Mientras la lista no llega, el id guardado se respeta (la base lo valida).
  const campanaPerdida = campanas !== undefined && s.campanaId !== null && campana === null
  const redCampana = redDePlataforma(campana?.plataforma ?? null)
  const fechaIngreso = deEntradaLocal(s.fechaIngresoLocal)

  return {
    origen: s.origen,
    campanaId: campanaPerdida ? null : s.campanaId,
    campana,
    campanaPerdida,
    responsableId: s.responsableId,
    fechaIngreso,
    fechaFutura: fechaIngreso !== null && new Date(fechaIngreso).getTime() > Date.now() + HOLGURA_RELOJ_MS,
    redSocial: redCampana ?? s.redSocial,
    redPorCampana: redCampana !== null,
  }
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

/** 'aaaa-mm-dd' → 'dd/mm', para el nombre sugerido de la campaña. */
function diaMes(fecha: string): string {
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
}

function nombreSugerido(plataforma: PlataformaCampana, fecha: string): string {
  const base = PLATAFORMAS_CAMPANA.find((p) => p.valor === plataforma)?.etiqueta ?? 'Campaña'
  return fecha === '' ? `${base} Live` : `${base} Live ${diaMes(fecha)}`
}

function esPlataforma(v: string): v is PlataformaCampana {
  return PLATAFORMAS_CAMPANA.some((p) => p.valor === v)
}

export function ConfiguracionSesion({
  sesion,
  contexto,
  alCambiar,
  yoId,
}: {
  sesion: SesionRegistro
  contexto: ContextoRegistro
  alCambiar: (s: SesionRegistro) => void
  /** Perfil de quien registra: el responsable por defecto. */
  yoId: string | null
}) {
  const idCuerpo = useId()
  const idOrigen = useId()
  const idCampana = useId()
  const idFecha = useId()
  const idNotaFecha = useId()
  const idRed = useId()

  // Abierta la primera vez (nada elegido todavia); plegada si ya hay campaña u
  // hora: en un live el vendedor la mira una vez y se pone a registrar.
  const [abierta, setAbierta] = useState(sesion.campanaId === null && sesion.fechaIngresoLocal === '')
  const campanas = useCampanas()
  const equipo = useQuery({ queryKey: ['equipo'], queryFn: cargarEquipo, staleTime: 5 * 60 * 1000 })

  const cambiar = (parcial: Partial<SesionRegistro>): void => alCambiar({ ...sesion, ...parcial })

  const responsableEfectivo = sesion.responsableId ?? yoId
  const nombreResponsable =
    responsableEfectivo === null || responsableEfectivo === yoId
      ? 'tú'
      : (equipo.data?.find((m) => m.id === responsableEfectivo)?.nombre ?? 'otra persona')
  const etiquetaOrigen = ORIGENES.find((o) => o.valor === sesion.origen)?.etiqueta ?? sesion.origen

  const resumen = [
    etiquetaOrigen,
    contexto.campana?.nombre ?? (contexto.campanaId === null ? 'Sin campaña' : 'Campaña elegida'),
    `A cargo de ${nombreResponsable}`,
    contexto.fechaIngreso === null ? 'Hora: la de cada guardado' : `Hora del ingreso: ${diaYHora(contexto.fechaIngreso)}`,
  ]

  return (
    <Card className="mb-6">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-black text-foreground">
              <Settings2 className="h-4 w-4 shrink-0 text-suelo-500" strokeWidth={1.75} aria-hidden="true" />
              Sesión de registro
            </p>
            {/* El resumen se ve siempre, también plegada: registrar 50 leads en
                la campaña equivocada es peor que tardar un segundo en leerlo. */}
            <p className="mt-1 text-sm text-suelo-700">{resumen.join(' · ')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 sm:h-10"
            aria-expanded={abierta}
            aria-controls={idCuerpo}
            onClick={() => setAbierta((a) => !a)}
          >
            {abierta ? (
              <>
                <ChevronUp aria-hidden="true" />
                Listo
              </>
            ) : (
              <>
                <ChevronDown aria-hidden="true" />
                Cambiar
              </>
            )}
          </Button>
        </div>

        {contexto.fechaFutura && (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            La hora del ingreso está en el futuro. La base no la acepta: corrígela o déjala vacía.
          </p>
        )}
        {contexto.campanaPerdida && (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            La campaña que tenías elegida ya no está vigente (se archivó). Elige otra antes de registrar.
          </p>
        )}

        <div id={idCuerpo} hidden={!abierta} className="mt-4 space-y-5 border-t border-border pt-4">
          <div className="grid gap-5 sm:grid-cols-2">
            {/* ---- ORIGEN ---- */}
            <div className="space-y-1.5">
              <label htmlFor={idOrigen} className="block text-sm font-bold text-suelo">
                Origen
              </label>
              {/* Nativo: en el móvil abre el selector del sistema, que es lo
                  más rápido con una mano (ver la cabecera de index.tsx). */}
              <select
                id={idOrigen}
                className={claseCampo}
                value={sesion.origen}
                onChange={(e) => {
                  if (esOrigen(e.target.value)) cambiar({ origen: e.target.value })
                }}
              >
                {ORIGENES.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </div>

            {/* ---- RESPONSABLE ---- */}
            <SelectorResponsable
              etiqueta="A cargo de"
              valor={responsableEfectivo}
              alCambiar={(id) => cambiar({ responsableId: id === yoId ? null : id })}
            />

            {/* ---- CAMPAÑA ---- */}
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor={idCampana} className="block text-sm font-bold text-suelo">
                Campaña
              </label>
              {/* `flex-wrap`: el formulario de «Nueva campaña» abierto ocupa la
                  fila entera (basis-full) debajo del desplegable. */}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <select
                  id={idCampana}
                  className={cn(claseCampo, 'sm:flex-1')}
                  value={contexto.campanaId ?? ''}
                  disabled={campanas.isPending}
                  aria-busy={campanas.isPending || undefined}
                  onChange={(e) => cambiar({ campanaId: e.target.value === '' ? null : e.target.value })}
                >
                  <option value="">{campanas.isPending ? 'Cargando campañas…' : 'Sin campaña'}</option>
                  {(campanas.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                      {c.plataforma === null ? '' : ` · ${etiquetaPlataforma(c.plataforma)}`}
                    </option>
                  ))}
                </select>
                <NuevaCampana
                  fechaIngresoLocal={sesion.fechaIngresoLocal}
                  alCrear={(id) => cambiar({ campanaId: id })}
                />
              </div>
              {campanas.isError && (
                <p role="alert" className="rounded-md bg-alerta-suave p-2 text-xs font-bold text-alerta">
                  No se pudieron cargar las campañas: {campanas.error.message}
                </p>
              )}
            </div>

            {/* ---- FECHA Y HORA DEL LIVE ---- */}
            <div className="space-y-1.5">
              <label htmlFor={idFecha} className="block text-sm font-bold text-suelo">
                Fecha y hora del live / ingreso
              </label>
              <div className="flex gap-2">
                <input
                  id={idFecha}
                  type="datetime-local"
                  className={cn(claseCampo, 'flex-1')}
                  value={sesion.fechaIngresoLocal}
                  max={aEntradaLocal(new Date())}
                  aria-describedby={idNotaFecha}
                  onChange={(e) => cambiar({ fechaIngresoLocal: e.target.value })}
                />
                {sesion.fechaIngresoLocal !== '' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-[3.25rem] shrink-0"
                    onClick={() => cambiar({ fechaIngresoLocal: '' })}
                  >
                    Ahora
                  </Button>
                )}
              </div>
              <p id={idNotaFecha} className="text-xs text-suelo-500">
                Vacío = la hora de cada guardado. Para los leads de ayer pon la hora del live: así el SLA no
                miente.
              </p>
            </div>

            {/* ---- RED DE LOS @USUARIO ---- */}
            <div className="space-y-1.5">
              {contexto.redPorCampana ? (
                <>
                  <p className="text-sm font-bold text-suelo">Red de los @usuario</p>
                  <p className="flex min-h-[3.25rem] items-center text-sm text-suelo-700">
                    {REDES_SOCIALES.find((r) => r.valor === contexto.redSocial)?.etiqueta}, por la plataforma de
                    la campaña.
                  </p>
                </>
              ) : (
                <>
                  <label htmlFor={idRed} className="block text-sm font-bold text-suelo">
                    Red de los @usuario
                  </label>
                  <select
                    id={idRed}
                    className={claseCampo}
                    value={sesion.redSocial ?? ''}
                    onChange={(e) => cambiar({ redSocial: esRedSocial(e.target.value) ? e.target.value : null })}
                  >
                    <option value="">Sin elegir</option>
                    {REDES_SOCIALES.map((r) => (
                      <option key={r.valor} value={r.valor}>
                        {r.etiqueta}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-suelo-500">
                    Solo hace falta para los leads que dejaron únicamente su @usuario.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * «Nueva campaña» en linea, sin salir de la pantalla: el live es AHORA y la
 * campaña de hoy no existe todavia. `fn_campana_asegurar` busca por nombre
 * antes de crear, asi que dos vendedores que la crean a la vez con el nombre
 * sugerido acaban en la misma. La inversion NO se pide: queda nula hasta que
 * alguien la cargue con su fuente (07-crm/CLAUDE.md §2).
 */
function NuevaCampana({
  fechaIngresoLocal,
  alCrear,
}: {
  fechaIngresoLocal: string
  alCrear: (id: string) => void
}) {
  const cliente = useQueryClient()
  const idNombre = useId()
  const idPlataforma = useId()
  const idFechaCampana = useId()

  const [abierta, setAbierta] = useState(false)
  const [plataforma, setPlataforma] = useState<PlataformaCampana>('tiktok')
  const [fecha, setFecha] = useState('')
  const [nombre, setNombre] = useState('')
  // Mientras el vendedor no toque el nombre, sigue a la plataforma y la fecha.
  const [nombreEditado, setNombreEditado] = useState(false)
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function abrir(): void {
    // La fecha del live si ya se puso; si no, hoy.
    const dia = (fechaIngresoLocal === '' ? aEntradaLocal(new Date()) : fechaIngresoLocal).slice(0, 10)
    setPlataforma('tiktok')
    setFecha(dia)
    setNombre(nombreSugerido('tiktok', dia))
    setNombreEditado(false)
    setError(null)
    setAbierta(true)
  }

  async function crear(): Promise<void> {
    if (creando) return
    setCreando(true)
    setError(null)
    const r = await asegurarCampana(nombre, plataforma, fecha === '' ? null : fecha, null)
    setCreando(false)
    if (!r.ok) {
      setError(r.motivo)
      return
    }
    await cliente.invalidateQueries({ queryKey: ['campanas'] })
    alCrear(r.datos)
    setAbierta(false)
  }

  if (!abierta) {
    return (
      <Button type="button" variant="outline" className="h-[3.25rem] shrink-0" onClick={abrir}>
        <Plus aria-hidden="true" />
        Nueva campaña
      </Button>
    )
  }

  return (
    <div className="w-full space-y-3 rounded-md border border-border p-3 sm:basis-full">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_11rem]">
        <div className="space-y-1.5">
          <label htmlFor={idNombre} className="block text-sm font-bold text-suelo">
            Nombre
          </label>
          <input
            id={idNombre}
            className={claseCampo}
            value={nombre}
            autoComplete="off"
            onChange={(e) => {
              setNombre(e.target.value)
              setNombreEditado(true)
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={idPlataforma} className="block text-sm font-bold text-suelo">
            Plataforma
          </label>
          <select
            id={idPlataforma}
            className={claseCampo}
            value={plataforma}
            onChange={(e) => {
              const v = e.target.value
              if (!esPlataforma(v)) return
              setPlataforma(v)
              if (!nombreEditado) setNombre(nombreSugerido(v, fecha))
            }}
          >
            {PLATAFORMAS_CAMPANA.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={idFechaCampana} className="block text-sm font-bold text-suelo">
            Fecha
          </label>
          <input
            id={idFechaCampana}
            type="date"
            className={claseCampo}
            value={fecha}
            onChange={(e) => {
              setFecha(e.target.value)
              if (!nombreEditado) setNombre(nombreSugerido(plataforma, e.target.value))
            }}
          />
        </div>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" className="h-11 sm:h-10" disabled={creando} onClick={() => void crear()}>
          {creando ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
          Crear y usar
        </Button>
        <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={() => setAbierta(false)}>
          Cancelar
        </Button>
        <p className="text-xs text-suelo-500">Si ya existe una con ese nombre, se usa esa.</p>
      </div>
    </div>
  )
}
