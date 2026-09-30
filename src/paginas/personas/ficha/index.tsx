import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Building2, MessageCircle, PhoneCall } from 'lucide-react'
import { Button, buttonVariants } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { PestanaCabecera } from '@/componentes/marca/CabeceraPantalla'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useSesion } from '@/auth/ContextoSesion'
import { comoRegistro } from '@/lib/acciones'
import { leerLote, monto, reventar, texto } from '@/lib/lectura'
import {
  cargarOportunidadesDePersona,
  elegirOportunidadPrincipal,
  etiquetaSituacion,
  type FilaCartera,
} from '@/lib/cartera'
import { etiquetaEstado } from '@/lib/embudo'
import { ESTADOS_UNIDAD } from '@/lib/inventario'
import { enlaceWhatsApp } from '@/lib/whatsapp'
import { fechaCorta } from '@/lib/fechas'
import { CabeceraFicha } from './CabeceraFicha'
import {
  Fallo,
  PanelContacto,
  mensajeSugerido,
  puedeOperarOportunidad,
  umbralFrioDe,
  useParametrosContacto,
} from './PanelContacto'
import { SeccionPerfil } from './SeccionPerfil'
import { SeccionVisitas } from './SeccionVisitas'
import { SeccionDocumentos } from './SeccionDocumentos'
import { Actividad } from './Actividad'
import { DatosPersona, cargarPersona, type PersonaFicha } from './DatosPersona'
import { ControlesSituacion } from './ControlesSituacion'

/**
 * FICHA DE PERSONA — `/personas/:personaId?o=:oportunidadId` — SPEC §7 S2.
 *
 * ===========================================================================
 * POR QUÉ ES ASÍ
 * ===========================================================================
 * Es la pantalla donde se trabaja UN lead: registrar el contacto, completar el
 * perfil, agendar la visita, subir el voucher. Todo lo que obliga a salir de
 * aquí es un seguimiento que no se registra (Walter: «hay semanas, incluso
 * meses, en los que no hacemos seguimiento»).
 *
 * Una persona puede tener varias oportunidades (una perdida del lanzamiento
 * anterior y una activa de este). Se abre la de `?o=` si llega; si no, la que
 * elige `elegirOportunidadPrincipal` (la activa más nueva). Con más de una, un
 * selector en la franja de pestañas — el `?o=` va en la URL para que el enlace
 * de una fila de Hoy o del embudo abra exactamente esa.
 *
 * Una persona SIN oportunidad (p. ej. un titular cargado desde el inventario,
 * `personas.es_socio`) también tiene ficha: sus datos, sus documentos y las
 * unidades de las que es titular. No se le muestra el panel de contacto
 * comercial: no hay proceso que registrar, y abrir uno es decisión de quien
 * gestiona la cartera de socios, no un clic accidental aquí.
 *
 * Orden en el móvil (una columna): contacto, perfil, visitas, actividad,
 * documentos, datos, situación — de lo que se usa en cada llamada a lo que se
 * toca una vez. Abajo, fija, una barra con WhatsApp y «Registrar contacto»:
 * el pulgar no tiene que subir a la cabecera para lo que más se repite.
 *
 * Claves de consulta: todo bajo ['ficha', personaId, …] (SPEC §8), para que
 * `invalidarTrasAccion` refresque la ficha entera tras cualquier acción.
 */

export function FichaPersona() {
  const { personaId } = useParams()
  if (personaId === undefined || personaId.trim() === '') {
    return <Fallo>Falta el identificador de la persona en la dirección.</Fallo>
  }
  // `key`: al saltar de una ficha a otra no se arrastra el estado local.
  return <Ficha key={personaId} personaId={personaId} />
}

function Ficha({ personaId }: { personaId: string }) {
  const [params, setParams] = useSearchParams()
  const { rol, perfil } = useSesion()
  const [abrirAgenda, setAbrirAgenda] = useState(false)

  const oportunidades = useQuery({
    queryKey: ['ficha', personaId, 'oportunidades'],
    queryFn: () => cargarOportunidadesDePersona(personaId),
  })
  // Misma clave y misma función que DatosPersona: una sola lectura en caché.
  const persona = useQuery({
    queryKey: ['ficha', personaId, 'persona'],
    queryFn: () => cargarPersona(personaId),
  })

  if (oportunidades.isPending || persona.isPending) {
    return <p className="text-sm text-suelo-700">Cargando la ficha…</p>
  }
  if (oportunidades.isError) {
    return <Fallo>No se pudo abrir la ficha. {oportunidades.error.message}</Fallo>
  }

  const filas = oportunidades.data.filas
  const datosPersona = persona.data ?? null

  if (filas.length === 0 && datosPersona === null) {
    return (
      <Fallo>
        No se encontró a esta persona, o tu rol no puede verla. Vuelve a Personas y búscala por nombre o teléfono.
      </Fallo>
    )
  }

  const pedida = params.get('o')
  const principal = filas.find((f) => f.id === pedida) ?? elegirOportunidadPrincipal(filas)

  if (principal === null) {
    return <FichaSinOportunidad personaId={personaId} persona={datosPersona} esGestion={esGestion(rol)} />
  }

  const puedeEditar = puedeOperarOportunidad(principal, rol, perfil?.id ?? null)

  function elegir(id: string) {
    const siguientes = new URLSearchParams(params)
    siguientes.set('o', id)
    setParams(siguientes, { replace: true })
  }

  const selector =
    filas.length > 1 ? (
      <div className="flex gap-1 overflow-x-auto whitespace-nowrap" role="tablist" aria-label="Oportunidades de esta persona">
        {filas.map((f) => (
          <PestanaCabecera
            key={f.id}
            role="tab"
            aria-selected={f.id === principal.id}
            activa={f.id === principal.id}
            onClick={() => elegir(f.id)}
          >
            {etiquetaEstado(f.estado)}
            {f.situacion !== 'activa' && ` · ${etiquetaSituacion(f.situacion)}`}
            <span className="ml-1 font-normal">· {f.lanzamiento ?? fechaCorta(f.creadoEl)}</span>
          </PestanaCabecera>
        ))}
      </div>
    ) : undefined

  return (
    <div className="w-full pb-24 lg:pb-0">
      <CabeceraFicha persona={datosPersona} fila={principal} selector={selector} />

      {pedida !== null && pedida !== principal.id && (
        <AvisoPendiente className="mb-4">
          La oportunidad del enlace ya no está visible para tu rol; se abrió la principal de esta persona.
        </AvisoPendiente>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <div id="panel-contacto" className="scroll-mt-4">
            <PanelContacto key={principal.id} fila={principal} alAgendarVisita={() => setAbrirAgenda(true)} />
          </div>
          <SeccionPerfil key={`perfil-${principal.id}`} oportunidadId={principal.id} puedeEditar={puedeEditar} />
          <SeccionVisitas
            key={`visitas-${principal.id}`}
            fila={principal}
            puedeEditar={puedeEditar}
            abrirAgenda={abrirAgenda}
            alCerrarAgenda={() => setAbrirAgenda(false)}
          />
        </div>
        <aside className="min-w-0 space-y-6">
          <Actividad oportunidadId={principal.id} personaId={personaId} />
          <SeccionDocumentos
            personaId={personaId}
            oportunidadId={principal.id}
            estado={principal.estado}
            puedeEditar={puedeEditar}
          />
          <DatosPersona personaId={personaId} puedeEditar={puedeEditar} />
          <ControlesSituacion key={`situacion-${principal.id}`} fila={principal} puedeEditar={puedeEditar} />
        </aside>
      </div>

      <BarraMovil fila={principal} />
    </div>
  )
}

function esGestion(rol: string | null): boolean {
  return rol === 'direccion' || rol === 'administracion'
}

/**
 * La barra fija del móvil. WhatsApp abre la app instalada (`whatsapp://`, no
 * `wa.me`: el número de un tercero no sale a un dominio web) con el mensaje
 * sugerido; «Registrar contacto» baja al panel. Ámbar solo sobre azul.
 */
function BarraMovil({ fila }: { fila: FilaCartera }) {
  const { perfil } = useSesion()
  const parametros = useParametrosContacto()
  const whatsapp =
    fila.telefonoE164 !== null && !fila.noContactar
      ? enlaceWhatsApp(
          fila.telefonoE164,
          mensajeSugerido(fila, perfil?.nombre ?? null, umbralFrioDe(parametros.data)),
        )
      : null

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 bg-azul px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:hidden">
      {whatsapp !== null && (
        <a href={whatsapp} className={cn(buttonVariants({ variant: 'ambar' }), 'h-12 flex-1')}>
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          WhatsApp
        </a>
      )}
      <Button
        variant="outlineCal"
        className="h-12 flex-1"
        onClick={() =>
          document.getElementById('panel-contacto')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      >
        <PhoneCall className="h-4 w-4" aria-hidden="true" />
        Registrar contacto
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Persona sin oportunidad
// ---------------------------------------------------------------------------

type UnidadTitular = {
  id: string
  codigo: string
  tipo: string | null
  areaM2: number | string | null
  estado: string | null
}

function leerUnidad(fila: unknown): UnidadTitular | null {
  const f = comoRegistro(fila)
  if (f === null) return null
  const id = texto(f['id'])
  const codigo = texto(f['codigo_unidad'])
  if (id === null || codigo === null) return null
  return {
    id,
    codigo,
    tipo: texto(f['tipo']),
    areaM2: monto(f['area_m2']),
    estado: texto(f['estado_comercial']),
  }
}

async function cargarUnidadesDeTitular(personaId: string): Promise<UnidadTitular[]> {
  const { data, error } = await supabase
    .from('unidades')
    .select('id, codigo_unidad, tipo, area_m2, estado_comercial')
    .eq('titular_persona_id', personaId)
    .is('archivado_el', null)
    .order('codigo_unidad', { ascending: true })
  reventar('No se pudieron leer las unidades de esta persona', error)
  return leerLote(data, leerUnidad).filas
}

function FichaSinOportunidad({
  personaId,
  persona,
  esGestion: gestion,
}: {
  personaId: string
  persona: PersonaFicha | null
  esGestion: boolean
}) {
  const unidades = useQuery({
    queryKey: ['ficha', personaId, 'unidades'],
    queryFn: () => cargarUnidadesDeTitular(personaId),
  })

  return (
    <div className="w-full">
      <CabeceraFicha persona={persona} fila={null} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <AvisoPendiente>
            Esta persona no tiene una oportunidad comercial abierta: por eso no aparecen el panel de contacto, el
            perfil ni las visitas. Suele ser un titular cargado desde el inventario.
          </AvisoPendiente>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-black">
                <Building2 className="h-5 w-5" aria-hidden="true" />
                Unidades de las que es titular
              </CardTitle>
            </CardHeader>
            <CardContent>
              {unidades.isPending && <p className="text-sm text-suelo-700">Cargando unidades…</p>}
              {unidades.isError && <Fallo>{unidades.error.message}</Fallo>}
              {unidades.isSuccess && unidades.data.length === 0 && (
                <p className="text-sm text-suelo-700">
                  No figura como titular de ninguna unidad (o tu rol no puede ver el inventario).
                </p>
              )}
              {unidades.isSuccess && unidades.data.length > 0 && (
                <ul className="divide-y divide-input">
                  {unidades.data.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
                      <span className="font-bold text-suelo">
                        {u.codigo}
                        {u.tipo !== null && <span className="font-normal text-suelo-700"> · {u.tipo}</span>}
                        {u.areaM2 !== null && <span className="font-normal text-suelo-700"> · {u.areaM2} m²</span>}
                      </span>
                      <span className="text-suelo-700">
                        {ESTADOS_UNIDAD.find((e) => e.valor === u.estado)?.etiqueta ?? u.estado ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <aside className="min-w-0 space-y-6">
          <SeccionDocumentos personaId={personaId} oportunidadId={null} estado={null} puedeEditar={gestion} />
          <DatosPersona personaId={personaId} puedeEditar={gestion} />
        </aside>
      </div>
    </div>
  )
}
