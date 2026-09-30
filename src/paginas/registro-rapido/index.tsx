import { useEffect, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PhoneCall } from 'lucide-react'
import { CabeceraPantalla, PestanaCabecera } from '@/componentes/marca/CabeceraPantalla'
import { Badge } from '@/componentes/ui/badge'
import { Button } from '@/componentes/ui/button'
import { useSesion } from '@/auth/ContextoSesion'
import {
  ConfiguracionSesion,
  RUTA_COLA_SELECCION,
  guardarSesion,
  leerSesion,
  prepararCola,
  resolverContexto,
  useCampanas,
  type SesionRegistro,
} from './ConfiguracionSesion'
import { ListaRegistrados, UnoAUno, type RegistroSesion } from './UnoAUno'
import { PegarLista } from './PegarLista'
import { MensajeWeb } from './MensajeWeb'

/**
 * REGISTRO RAPIDO v2 — tres formas de meter leads, una sola sesion.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SE REHIZO (SPEC §0, §7 S6)
 * ---------------------------------------------------------------------------
 * La version de 06 (cuatro campos y un boton) cumplia su objetivo de 30
 * segundos por lead, pero el 28/09 llegaron 50 de un TikTok Live y a 30
 * segundos son 25 minutos, sin campaña y con la hora equivocada. Ahora:
 *
 *  · UNO A UNO — el mismo flujo de 30 segundos (foco automatico, Enter
 *    avanza, cronometro real, consentimiento que no se arrastra), mas
 *    @usuario y dos preguntas opcionales. Ver UnoAUno.tsx.
 *  · PEGAR LISTA — la lista del live tal como venga; analizar, validar con la
 *    base sin escribir, guardar, y a la cola de llamadas. Objetivo: 50 leads
 *    en menos de 3 minutos. Ver PegarLista.tsx.
 *  · MENSAJE DE LA WEB — el WhatsApp que arma la web, leido solo. Ver
 *    MensajeWeb.tsx.
 *
 * Lo comun (origen, campaña, responsable, hora del live, red de los @usuario)
 * se pone UNA vez arriba (ConfiguracionSesion.tsx) y lo heredan las tres.
 *
 * ---------------------------------------------------------------------------
 * DETALLES QUE NO SON CAPRICHO
 * ---------------------------------------------------------------------------
 *  · La pestaña va en la URL (`?modo=lista|web`): la Bandeja web de Personas
 *    manda aqui a pegar los mensajes de WhatsApp, y un enlace directo ahorra
 *    buscar la pestaña.
 *  · Las tres pestañas quedan MONTADAS (solo se ocultan): si el vendedor
 *    pasa a «Uno a uno» con una lista a medio corregir, al volver la lista
 *    sigue ahi. Perder 50 filas corregidas por un toque es inaceptable.
 *  · Los desplegables y casillas son controles NATIVOS: en el movil un
 *    <select> nativo abre el selector del sistema, mas rapido que un menu
 *    flotante. En una pantalla cuyo requisito es el tiempo, eso pesa mas que
 *    la uniformidad visual.
 *  · Todo alta pasa por la base en una transaccion (`fn_registrar_prospecto`
 *    / `fn_registrar_lote`, SPEC §4.5): aqui no se hacen inserciones sueltas.
 */

const MODOS = [
  { valor: 'uno', etiqueta: 'Uno a uno', corta: 'Uno a uno' },
  { valor: 'lista', etiqueta: 'Pegar lista', corta: 'Lista' },
  { valor: 'web', etiqueta: 'Mensaje de la web', corta: 'Web' },
] as const

type Modo = (typeof MODOS)[number]['valor']

function leerModo(valor: string | null): Modo {
  return MODOS.find((m) => m.valor === valor)?.valor ?? 'uno'
}

const DESCRIPCIONES: Readonly<Record<Modo, string>> = {
  uno: 'Nombre, teléfono, Enter. Menos de 30 segundos por lead.',
  lista: 'Pega la lista del live, revísala, valida y guarda. 50 leads en menos de 3 minutos.',
  web: 'Pega el WhatsApp que arma la web: el CRM lee sus respuestas.',
}

export function PantallaRegistroRapido() {
  const { perfil } = useSesion()
  const yoId = perfil?.id ?? null
  const navegar = useNavigate()
  const [parametros, setParametros] = useSearchParams()
  const modo = leerModo(parametros.get('modo'))

  const [sesion, setSesion] = useState<SesionRegistro>(() => leerSesion(yoId))
  const campanas = useCampanas()
  const contexto = resolverContexto(sesion, campanas.data)

  /** Lo registrado uno a uno y desde la web en esta visita, el más reciente primero. */
  const [registros, setRegistros] = useState<RegistroSesion[]>([])
  const [altasLote, setAltasLote] = useState(0)
  const [errorCola, setErrorCola] = useState<string | null>(null)

  // Si el perfil llega después del primer pintado, la sesión se relee para
  // ESE perfil (no se hereda la de nadie más: ver ConfiguracionSesion.tsx).
  useEffect(() => {
    if (sesion.perfilId !== yoId) setSesion(leerSesion(yoId))
  }, [sesion.perfilId, yoId])

  useEffect(() => {
    // Solo la sesión del perfil ya cargado: guardar una con `perfilId: null`
    // en el primer pintado pisaría la que esa persona dejó configurada.
    if (yoId !== null && sesion.perfilId === yoId) guardarSesion(sesion)
  }, [sesion, yoId])

  function cambiarModo(m: Modo): void {
    // `replace`: cambiar de pestaña no es navegar; «Atrás» saca de la pantalla.
    setParametros(m === 'uno' ? {} : { modo: m }, { replace: true })
  }

  /** Flechas entre pestañas (patrón WAI-ARIA de pestañas). */
  function alTeclaPestanas(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = MODOS.findIndex((m) => m.valor === modo)
    const siguiente = MODOS[(i + (e.key === 'ArrowRight' ? 1 : MODOS.length - 1)) % MODOS.length]
    if (siguiente === undefined) return
    e.preventDefault()
    cambiarModo(siguiente.valor)
    document.getElementById(`rr-pestana-${siguiente.valor}`)?.focus()
  }

  function alRegistrar(r: RegistroSesion): void {
    setRegistros((previos) => [r, ...previos])
    setErrorCola(null)
  }

  function llamarRegistrados(): void {
    // Los que ya lleva otra persona no se llaman desde aquí: ya tienen dueño.
    const ids = registros.filter((r) => r.estado !== 'tiene_dueno').map((r) => r.oportunidadId)
    if (!prepararCola(ids)) {
      setErrorCola(
        'Este navegador no deja preparar la cola (almacenamiento bloqueado). Abre Modo llamadas → «Nuevos»: ahí están.',
      )
      return
    }
    navegar(RUTA_COLA_SELECCION)
  }

  const altas = registros.length + altasLote
  const lista = <ListaRegistrados registros={registros} alLlamar={llamarRegistrados} errorCola={errorCola} />

  return (
    <>
      {/* Fuera del contenedor de ancho máximo: la franja azul llega al borde.
          El título se alinea con el cuerpo vía `ancho="medio"` (max-w-4xl):
          la vista previa de una lista pegada necesita más que el formulario
          estrecho de 06. */}
      <CabeceraPantalla
        titulo="Registro rápido"
        ancho="medio"
        descripcion={DESCRIPCIONES[modo]}
        distintivos={
          altas > 0 ? (
            <Badge variant="cal" aria-live="polite">
              {altas} {altas === 1 ? 'registro' : 'registros'} en esta sesión
            </Badge>
          ) : undefined
        }
        acciones={
          <Button asChild variant="outlineCal" className="h-11 sm:h-10">
            <Link to="/cola?vista=nuevos">
              <PhoneCall strokeWidth={1.75} aria-hidden="true" />
              Modo llamadas
            </Link>
          </Button>
        }
        pestanas={
          <div role="tablist" aria-label="Forma de registrar" className="flex gap-1" onKeyDown={alTeclaPestanas}>
            {MODOS.map((m) => {
              const activa = m.valor === modo
              return (
                <PestanaCabecera
                  key={m.valor}
                  id={`rr-pestana-${m.valor}`}
                  role="tab"
                  aria-selected={activa}
                  aria-controls={`rr-panel-${m.valor}`}
                  tabIndex={activa ? 0 : -1}
                  activa={activa}
                  onClick={() => cambiarModo(m.valor)}
                >
                  {/* En el móvil caben las tres solo con el nombre corto. */}
                  <span className="sm:hidden">{m.corta}</span>
                  <span className="hidden sm:inline">{m.etiqueta}</span>
                </PestanaCabecera>
              )
            })}
          </div>
        }
      />

      <div className="mx-auto w-full max-w-4xl">
        <ConfiguracionSesion sesion={sesion} contexto={contexto} alCambiar={setSesion} yoId={yoId} />

        <div id="rr-panel-uno" role="tabpanel" aria-labelledby="rr-pestana-uno" hidden={modo !== 'uno'}>
          <UnoAUno contexto={contexto} activo={modo === 'uno'} alRegistrar={alRegistrar} lateral={lista} />
        </div>

        <div id="rr-panel-lista" role="tabpanel" aria-labelledby="rr-pestana-lista" hidden={modo !== 'lista'}>
          <PegarLista contexto={contexto} yoId={yoId} alGuardar={(n) => setAltasLote((a) => a + n)} />
        </div>

        <div id="rr-panel-web" role="tabpanel" aria-labelledby="rr-pestana-web" hidden={modo !== 'web'}>
          <MensajeWeb contexto={contexto} alRegistrar={alRegistrar} lateral={lista} />
        </div>
      </div>
    </>
  )
}
