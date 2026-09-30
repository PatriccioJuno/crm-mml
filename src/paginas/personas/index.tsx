import { useEffect, useId, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckSquare, PhoneCall, Search, UserPlus, Users, X } from 'lucide-react'
import { CabeceraPantalla, PestanaCabecera, type Indicador } from '@/componentes/marca/CabeceraPantalla'
import { Button } from '@/componentes/ui/button'
import { claseCampoCompacto } from '@/componentes/ui/input'
import { GrupoChips } from '@/componentes/crm/GrupoChips'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import { puedeVerSeccion } from '@/auth/secciones'
import type { Rol } from '@/auth/tipos-sesion'
import {
  LIMITE_CARTERA,
  cargarCartera,
  contarCartera,
  type FiltroCartera,
} from '@/lib/cartera'
import { cargarCampanas } from '@/lib/lote'
import { DialogoAsignar } from './DialogoAsignar'
import {
  ALCANCES_RESPONSABLE,
  AvisoHecho,
  AvisosLote,
  Cargando,
  ErrorAlerta,
  FilaPersona,
  alcancePorDefecto,
  esAlcance,
  guardarIdsCola,
  puedeOperar,
  useUmbralFrio,
  type AlcanceResponsable,
} from './FilaPersona'
import { PestanaBandeja, useBandeja } from './PestanaBandeja'
import { PestanaDescartados, PestanaFrios } from './PestanaFrios'

/**
 * PERSONAS — la cartera comercial: a quién hay que escribir hoy.
 *
 * ===========================================================================
 * CUATRO PESTAÑAS, UNA SOLA FUENTE
 * ===========================================================================
 * Cartera, Fríos y Descartados leen `v_cartera` (13-seguimiento-comercial.sql,
 * SPEC §4.6) con la vista que les toca; la Bandeja web lee `fn_bandeja`. La
 * pestaña va en la URL (`?tab=`) y el responsable también (`?resp=`): así
 * «Personas → Bandeja web» se puede enlazar desde Hoy y un recargo no
 * devuelve a otra lista.
 *
 * ===========================================================================
 * LA TEMPERATURA LA CALCULA LA BASE
 * ===========================================================================
 * `fn_temperatura`, con umbrales 🔵 en `parametros` que Walter ratifica desde
 * Parámetros (SPEC §1). Esta pantalla solo FILTRA por ella; no la recalcula.
 * El filtro de temperatura se aplica en el navegador porque la temperatura no
 * es una columna filtrable de la consulta (cartera.ts); búsqueda, responsable
 * y campaña sí van al servidor.
 *
 * ===========================================================================
 * LOS INDICADORES DE LA CABECERA
 * ===========================================================================
 * Activos, Sin contactar y En fríos son conteos EXACTOS del servidor
 * (`contarCartera`, los mismos filtros que la lista). Calientes se cuenta
 * sobre la lista de activos, porque la temperatura no se puede filtrar en el
 * servidor; si esa lista llega al tope técnico se dice «al menos».
 * Cuentan todo lo que tu rol puede ver (RLS), no solo lo tuyo.
 */

const PESTANAS = [
  { valor: 'cartera', etiqueta: 'Cartera' },
  { valor: 'frios', etiqueta: 'Fríos' },
  { valor: 'descartados', etiqueta: 'Descartados' },
  { valor: 'bandeja', etiqueta: 'Bandeja web' },
] as const

type Pestana = (typeof PESTANAS)[number]['valor']

function esPestana(v: string | null): v is Pestana {
  return PESTANAS.some((p) => p.valor === v)
}

type Indicadores = {
  activos: number
  sinContactar: number
  enFrios: number
  calientes: number
  calientesIncompleto: boolean
}

async function cargarIndicadores(): Promise<Indicadores> {
  const [activos, sinContactar, enFrios, lista] = await Promise.all([
    contarCartera({ vista: 'activos' }),
    contarCartera({ vista: 'activos', soloNuevos: true }),
    contarCartera({ vista: 'frios' }),
    cargarCartera({ vista: 'activos' }),
  ])
  return {
    activos,
    sinContactar,
    enFrios,
    calientes: lista.filas.filter((f) => f.temperatura === 'caliente').length,
    calientesIncompleto: lista.filas.length >= LIMITE_CARTERA,
  }
}

export function PantallaPersonas() {
  const { rol, perfil } = useSesion()
  const [params, setParams] = useSearchParams()
  const tabCruda = params.get('tab')
  const tab: Pestana = esPestana(tabCruda) ? tabCruda : 'cartera'
  const respCruda = params.get('resp')
  const alcance: AlcanceResponsable = esAlcance(respCruda) ? respCruda : alcancePorDefecto(rol)

  const yo = perfil?.id ?? null
  const agente = perfil?.nombre ?? null
  const umbralFrio = useUmbralFrio()
  const bandeja = useBandeja(rol)
  const indicadores = useQuery({ queryKey: ['cartera', 'indicadores'], queryFn: cargarIndicadores })

  const puedeRegistrar = rol !== null && puedeVerSeccion(rol, 'registro-rapido')
  const opera = puedeOperar(rol)

  function cambiarParam(clave: 'tab' | 'resp', valor: string | null): void {
    setParams(
      (previos) => {
        const nuevos = new URLSearchParams(previos)
        if (valor === null) nuevos.delete(clave)
        else nuevos.set(clave, valor)
        return nuevos
      },
      { replace: true },
    )
  }

  const nBandeja = bandeja.data?.filas.length ?? null

  return (
    <div className="w-full">
      <CabeceraPantalla
        titulo="Personas"
        descripcion="A quién escribir hoy, quién se enfrió y quién llegó solo desde la web."
        indicadores={construirIndicadores(indicadores.data, indicadores.isError)}
        acciones={
          puedeRegistrar ? (
            <>
              <Button asChild variant="outlineCal" className="h-11 sm:h-10">
                <Link to="/registro-rapido">
                  <UserPlus strokeWidth={1.75} aria-hidden="true" />
                  Registrar leads
                </Link>
              </Button>
              {/* Ámbar sobre la franja azul: permitido (tailwind.config.js). */}
              <Button asChild variant="ambar" className="h-11 sm:h-10">
                <Link to="/cola?vista=pendientes">
                  <PhoneCall strokeWidth={2} aria-hidden="true" />
                  Modo llamadas
                </Link>
              </Button>
            </>
          ) : undefined
        }
        pestanas={PESTANAS.filter((p) => p.valor !== 'bandeja' || opera).map((p) => (
          <PestanaCabecera
            key={p.valor}
            activa={tab === p.valor}
            aria-pressed={tab === p.valor}
            onClick={() => cambiarParam('tab', p.valor === 'cartera' ? null : p.valor)}
          >
            {p.etiqueta}
            {p.valor === 'bandeja' && nBandeja !== null && (
              // Texto y no una insignia: la pestaña activa es clara y la
              // inactiva es azul, y el contador ámbar no puede ir sobre claro.
              <span className="ml-1 font-black">· {nBandeja}</span>
            )}
          </PestanaCabecera>
        ))}
      />

      {indicadores.error !== null && (
        <ErrorAlerta className="mb-4" mensaje={`No se pudieron contar las personas: ${indicadores.error.message}`} />
      )}

      {tab !== 'bandeja' && (
        <GrupoChips
          etiqueta="Responsable"
          etiquetaOculta
          opciones={ALCANCES_RESPONSABLE}
          valor={alcance}
          alCambiar={(v) => cambiarParam('resp', v === null || v === alcancePorDefecto(rol) ? null : v)}
          compacto
          className="mb-4"
        />
      )}

      {tab === 'cartera' && (
        <PestanaCartera alcance={alcance} yo={yo} rol={rol} agente={agente} umbralFrio={umbralFrio} />
      )}
      {tab === 'frios' && (
        <PestanaFrios alcance={alcance} yo={yo} rol={rol} agente={agente} umbralFrio={umbralFrio} />
      )}
      {tab === 'descartados' && (
        <PestanaDescartados alcance={alcance} yo={yo} rol={rol} agente={agente} umbralFrio={umbralFrio} />
      )}
      {tab === 'bandeja' && <PestanaBandeja rol={rol} />}
    </div>
  )
}

function construirIndicadores(d: Indicadores | undefined, fallo: boolean): readonly Indicador[] {
  // Mientras carga, «…»; si falló, «—» y el error se dice debajo. Nunca un 0
  // que no se ha contado.
  const vacio = fallo ? '—' : '…'
  return [
    { titulo: 'Activos', valor: d?.activos ?? vacio },
    {
      titulo: 'Calientes',
      valor: d === undefined ? vacio : d.calientesIncompleto ? `${d.calientes}+` : d.calientes,
      nota: d?.calientesIncompleto === true ? 'al menos: la lista llegó al tope' : undefined,
    },
    {
      titulo: 'Sin contactar',
      valor: d?.sinContactar ?? vacio,
      nota: 'nadie les ha escrito aún',
      // El que exige atención: speed to lead (analisis/sales.md §3).
      destacado: (d?.sinContactar ?? 0) > 0,
    },
    { titulo: 'En fríos', valor: d?.enFrios ?? vacio },
  ]
}

// ---------------------------------------------------------------------------
// Cartera
// ---------------------------------------------------------------------------

const FILTROS_TEMPERATURA = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'caliente', etiqueta: 'Caliente' },
  { valor: 'tibio', etiqueta: 'Tibio' },
  { valor: 'frio', etiqueta: 'Frío' },
  { valor: 'nuevo', etiqueta: 'Nuevo' },
] as const

type FiltroTemperatura = (typeof FILTROS_TEMPERATURA)[number]['valor']

/** Espera tras la última tecla antes de consultar (SPEC §7 S1). Tiempo de interfaz. */
const ESPERA_BUSQUEDA_MS = 300

/** Valores del desplegable de campaña que no son un id. */
const CAMPANA_TODAS = ''
const CAMPANA_NINGUNA = '__sin_campana'

function PestanaCartera({
  alcance,
  yo,
  rol,
  agente,
  umbralFrio,
}: {
  alcance: AlcanceResponsable
  yo: string | null
  rol: Rol | null
  agente: string | null
  umbralFrio: number | null
}) {
  const navigate = useNavigate()
  const idBusqueda = useId()
  const idCampana = useId()
  const [busqueda, setBusqueda] = useState('')
  const [busquedaFirme, setBusquedaFirme] = useState('')
  const [temperatura, setTemperatura] = useState<FiltroTemperatura>('todas')
  const [campana, setCampana] = useState<string>(CAMPANA_TODAS)
  const [eligiendo, setEligiendo] = useState(false)
  const [elegidos, setElegidos] = useState<ReadonlySet<string>>(new Set())
  // Los ids se copian al abrir: si la elección cambia detrás, el diálogo sigue
  // hablando de las que se eligieron cuando se abrió.
  const [asignando, setAsignando] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setBusquedaFirme(busqueda.trim()), ESPERA_BUSQUEDA_MS)
    return () => window.clearTimeout(t)
  }, [busqueda])

  const campanas = useQuery({ queryKey: ['campanas'], queryFn: cargarCampanas })

  const sinSesion = alcance === 'mios' && yo === null
  const filtro: FiltroCartera = {
    vista: 'activos',
    responsable: alcance,
    yo: yo ?? undefined,
    campanaId: campana === CAMPANA_TODAS ? undefined : campana === CAMPANA_NINGUNA ? null : campana,
    busqueda: busquedaFirme === '' ? undefined : busquedaFirme,
  }
  const consulta = useQuery({
    queryKey: ['cartera', filtro],
    queryFn: () => cargarCartera(filtro),
    enabled: !sinSesion,
    placeholderData: (previos) => previos,
  })

  const todas = consulta.data?.filas ?? []
  const visibles = temperatura === 'todas' ? todas : todas.filter((f) => f.temperatura === temperatura)
  const nombres: Record<string, string> = {}
  for (const f of todas) nombres[f.id] = f.nombreCompleto

  const opciones = FILTROS_TEMPERATURA.map((o) => {
    const n = o.valor === 'todas' ? todas.length : todas.filter((f) => f.temperatura === o.valor).length
    return { valor: o.valor, etiqueta: consulta.isSuccess ? `${o.etiqueta} · ${n}` : o.etiqueta }
  })

  const opera = puedeOperar(rol)
  const hayFiltros = busquedaFirme !== '' || campana !== CAMPANA_TODAS
  const elegidosVisibles = visibles.filter((f) => elegidos.has(f.id))

  function alternar(id: string, elegida: boolean): void {
    setElegidos((previos) => {
      const n = new Set(previos)
      if (elegida) n.add(id)
      else n.delete(id)
      return n
    })
  }

  function terminarEleccion(): void {
    setEligiendo(false)
    setElegidos(new Set())
  }

  function llamarAEstos(): void {
    setError(null)
    const ids = elegidosVisibles.map((f) => f.id)
    if (ids.length === 0) return
    if (!guardarIdsCola(ids)) {
      setError('El navegador no deja guardar la lista para el Modo llamadas (¿modo privado?). Abre la cola por campaña o por pendientes.')
      return
    }
    navigate('/cola?vista=seleccion')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor={idBusqueda} className="sr-only">
            Buscar por nombre, teléfono o @usuario
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-suelo-500"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <input
              id={idBusqueda}
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Nombre, dígitos del teléfono o @usuario"
              className={cn(claseCampoCompacto, 'h-11 pl-9 sm:h-9')}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="min-w-0 basis-56">
          <label htmlFor={idCampana} className="mb-1 block text-xs font-bold text-suelo-700">
            Campaña
          </label>
          <select
            id={idCampana}
            value={campana}
            onChange={(e) => setCampana(e.target.value)}
            className={cn(claseCampoCompacto, 'h-11 sm:h-9')}
          >
            <option value={CAMPANA_TODAS}>Todas las campañas</option>
            <option value={CAMPANA_NINGUNA}>Sin campaña</option>
            {(campanas.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        {opera && !eligiendo && todas.length > 0 && (
          <Button variant="outline" className="h-11 sm:h-9" onClick={() => setEligiendo(true)}>
            <CheckSquare strokeWidth={1.75} aria-hidden="true" />
            Elegir varios
          </Button>
        )}
      </div>

      <GrupoChips
        etiqueta="Temperatura"
        etiquetaOculta
        opciones={opciones}
        valor={temperatura}
        alCambiar={(v) => setTemperatura(v ?? 'todas')}
        compacto
      />

      {campanas.error !== null && (
        <p className="text-xs font-bold text-alerta">
          No se pudieron cargar las campañas: {campanas.error.message}
        </p>
      )}

      {eligiendo && (
        <div
          role="region"
          aria-label="Acciones con los elegidos"
          className={cn(
            'sticky z-20 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 shadow-sm',
            // Debajo de la cabecera móvil (CabeceraMovil: sticky, h-14, más el
            // área segura); en escritorio no hay cabecera fija y va al borde.
            'top-[calc(env(safe-area-inset-top)+3.5rem)] lg:top-0',
          )}
        >
          <span className="px-2 text-sm font-bold text-foreground">
            {elegidosVisibles.length === 1 ? '1 elegido' : `${elegidosVisibles.length} elegidos`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 sm:h-8"
            onClick={() =>
              setElegidos(
                elegidosVisibles.length === visibles.length ? new Set() : new Set(visibles.map((f) => f.id)),
              )
            }
          >
            {elegidosVisibles.length === visibles.length && visibles.length > 0
              ? 'Quitar todos'
              : `Elegir los ${visibles.length} de la lista`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 sm:h-8"
            disabled={elegidosVisibles.length === 0}
            onClick={() => setAsignando(elegidosVisibles.map((f) => f.id))}
          >
            <Users strokeWidth={1.75} aria-hidden="true" />
            Asignar a…
          </Button>
          <Button
            size="sm"
            className="h-11 sm:h-8"
            disabled={elegidosVisibles.length === 0}
            onClick={llamarAEstos}
          >
            <PhoneCall strokeWidth={1.75} aria-hidden="true" />
            Llamar a estos
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto h-11 sm:h-8" onClick={terminarEleccion}>
            <X strokeWidth={1.75} aria-hidden="true" />
            Terminar
          </Button>
        </div>
      )}

      {error !== null && <ErrorAlerta mensaje={error} />}
      {hecho !== null && <AvisoHecho>{hecho}</AvisoHecho>}

      {sinSesion && <ErrorAlerta mensaje="No se sabe quién eres todavía: vuelve a entrar para ver «Míos»." />}
      {!sinSesion && consulta.isPending && <Cargando texto="Cargando la cartera…" />}
      {consulta.error !== null && <ErrorAlerta mensaje={consulta.error.message} />}

      {consulta.isSuccess && visibles.length === 0 && (
        <CarteraVacia
          alcance={alcance}
          hayFiltros={hayFiltros}
          busqueda={busquedaFirme}
          temperatura={temperatura}
          hayFilas={todas.length > 0}
        />
      )}

      {visibles.length > 0 && (
        <ul
          className={cn(
            'overflow-hidden rounded-lg border border-border bg-card transition-opacity',
            consulta.isPlaceholderData && 'opacity-60',
          )}
          aria-busy={consulta.isFetching}
        >
          {visibles.map((f) => (
            <FilaPersona
              key={f.id}
              fila={f}
              agente={agente}
              umbralFrio={umbralFrio}
              mostrarResponsable={alcance !== 'mios'}
              seleccionable={eligiendo}
              seleccionada={elegidos.has(f.id)}
              alSeleccionar={alternar}
            />
          ))}
        </ul>
      )}

      {consulta.data !== undefined && (
        <AvisosLote descartadas={consulta.data.descartadas} filas={consulta.data.filas.length} />
      )}

      {asignando !== null && (
        <DialogoAsignar
          ids={asignando}
          nombres={nombres}
          alCerrar={() => setAsignando(null)}
          alAsignar={(a) => {
            setHecho(
              a.asignadas === 1 ? 'Se asignó 1 oportunidad.' : `Se asignaron ${a.asignadas} oportunidades.`,
            )
            terminarEleccion()
          }}
        />
      )}
    </div>
  )
}

/** Una lista vacía dice POR QUÉ está vacía y qué hacer, nunca solo «sin resultados». */
function CarteraVacia({
  alcance,
  hayFiltros,
  busqueda,
  temperatura,
  hayFilas,
}: {
  alcance: AlcanceResponsable
  hayFiltros: boolean
  busqueda: string
  temperatura: FiltroTemperatura
  hayFilas: boolean
}) {
  let titulo: string
  let ayuda: ReactNode

  if (hayFilas) {
    const etiqueta = FILTROS_TEMPERATURA.find((t) => t.valor === temperatura)?.etiqueta ?? temperatura
    titulo = `Nadie con temperatura «${etiqueta.toLowerCase()}» en esta lista.`
    ayuda = 'Elige «Todas» para ver el resto.'
  } else if (hayFiltros) {
    titulo = busqueda !== '' ? `Nadie coincide con «${busqueda}».` : 'Nadie en esa campaña.'
    ayuda = (
      <>
        Busca por nombre, por dígitos del teléfono o por @usuario. Las tildes cuentan: «maria» no encuentra «María». Si no está, puede estar en Fríos o
        Descartados, o no haberse registrado aún.
      </>
    )
  } else if (alcance === 'mios') {
    titulo = 'No tienes personas activas a tu cargo.'
    ayuda = (
      <>
        Registra los leads del live en{' '}
        <Link to="/registro-rapido" className="font-bold text-primary underline-offset-4 hover:underline">
          Registro rápido
        </Link>
        , toma leads de la «Bandeja web» o mira «Sin dueño».
      </>
    )
  } else {
    titulo = 'No hay personas activas en esta vista.'
    ayuda = (
      <>
        Empieza por{' '}
        <Link to="/registro-rapido" className="font-bold text-primary underline-offset-4 hover:underline">
          Registro rápido
        </Link>
        : un lead por línea o la lista entera pegada del live.
      </>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5 text-sm">
      <p className="font-bold text-foreground">{titulo}</p>
      <p className="mt-1 leading-relaxed text-suelo-700">{ayuda}</p>
    </div>
  )
}
