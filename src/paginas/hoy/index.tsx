import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Inbox, PhoneCall } from 'lucide-react'
import { BotonesContacto } from '@/componentes/crm/BotonesContacto'
import { CabeceraPantalla } from '@/componentes/marca/CabeceraPantalla'
import { Badge } from '@/componentes/ui/badge'
import { Button } from '@/componentes/ui/button'
import { useSesion } from '@/auth/ContextoSesion'
import type { Perfil } from '@/auth/tipos-sesion'
import { formatearMonto } from '@/lib/dinero'
import { diaYHora, fechaCorta, fechaHora, textoVencimiento } from '@/lib/fechas'
import { formatearTelefono } from '@/lib/telefono'
import {
  ESTADOS_VISITA,
  TIPOS_VISITA,
  cargarVisitasProximas,
  type VisitaProxima,
} from '@/lib/visitas'
import { puedeOperar, rutaFicha } from '@/paginas/personas/FilaPersona'
import { useBandeja } from '@/paginas/personas/PestanaBandeja'
import {
  DIAS_VIGILANCIA_SEPARACION,
  LIMITE_HOY,
  LIMITE_VISITAS_PROXIMAS,
  cargarSeparacionesEnRiesgo,
  cargarSeparacionesPorVerificar,
  cargarSinSiguientePaso,
  cargarTareasDeHoy,
  cargarTareasVencidas,
  completarTarea,
  contarLeadsNuevos,
  etiquetaEstado,
  type Lote,
  type SeparacionVigilada,
  type TareaFila,
  ventanaVisitasHoy,
} from '@/lib/hoy'
import { AccionesFila, BotonHecha } from './AccionesFila'
import { BloqueHoy, FilaHoy } from './BloqueHoy'

/**
 * HOY — la pantalla de inicio.
 *
 * ---------------------------------------------------------------------------
 * EL ORDEN DE LOS BLOQUES ES LA PANTALLA
 * ---------------------------------------------------------------------------
 * No estan ordenados por bonitos ni por cuantos hay: estan ordenados por lo
 * que cuesta no mirarlos.
 *
 *   0 · (solo Direccion) separaciones esperando su verificacion — R2/R3: sin
 *       verificar no hay recibo ni constancia; es dinero parado esperando a
 *       una sola persona.
 *   1 · separaciones cuyo plazo se acaba en 3 dias o menos — el unico rojo de
 *       la interfaz. Un plazo de devolucion que se pasa es un problema legal,
 *       no un recordatorio.
 *   2 · tus tareas vencidas — lo que ya deberia estar hecho.
 *   3 · oportunidades sin siguiente paso — incumplimientos vivos de R6, la
 *       razon por la que existe el CRM: «hay semanas, incluso meses, en los
 *       que no hacemos seguimiento» (Walter).
 *   4 · visitas de hoy y mañana — alguien que se desplaza a vernos; si nadie
 *       la confirma ni la cierra, se pierde la venta mas caliente.
 *   5 · tus tareas de hoy — lo que toca ahora.
 *
 * Encima de los bloques, en la franja azul, las dos llamadas a la accion de la
 * entrega 13 (30/09/2026): «N leads nuevos sin contactar → Modo llamadas» y
 * «Bandeja web: N esperando». Nacen del live de TikTok del 28/09: llegaron 50
 * leads y nadie supo por donde empezar (SPEC §0).
 *
 * Cada fila lleva sus acciones al lado (interaccion · tarea · ficha) para que
 * nada cueste mas de dos clics: ver el encabezado de AccionesFila.tsx. En las
 * filas de tareas manda el NOMBRE de la persona, no el titulo de la tarea: al
 * vendedor le importa a quien llama, y «Seguimiento» repetido veinte veces no
 * distingue nada.
 *
 * Cada bloque recibe su tope (`limite`): si una consulta llega justo a el, el
 * bloque dice «50+» y avisa de que puede haber mas.
 */
export function PantallaHoy() {
  const { perfil } = useSesion()

  // El cascaron va detras de <RutaProtegida>, asi que aqui siempre hay perfil.
  // La comprobacion se hace en ESTE componente, antes de montar el de dentro,
  // para que todos los hooks vivan en un componente donde el perfil ya existe:
  // salir antes de un hook es como se rompen las reglas de los hooks.
  if (perfil === null) return null

  return <HoyConPerfil perfil={perfil} />
}

function HoyConPerfil({ perfil }: { perfil: Perfil }) {
  const cliente = useQueryClient()

  const yo = perfil.id
  const esDireccion = perfil.rol === 'direccion'

  const porVerificar = useQuery({
    queryKey: ['hoy', 'separaciones-por-verificar'],
    queryFn: cargarSeparacionesPorVerificar,
    enabled: esDireccion,
  })
  const enRiesgo = useQuery({
    queryKey: ['hoy', 'separaciones-en-riesgo'],
    queryFn: cargarSeparacionesEnRiesgo,
  })
  const vencidas = useQuery({
    queryKey: ['hoy', 'tareas-vencidas', yo],
    queryFn: () => cargarTareasVencidas(yo),
  })
  const sinPaso = useQuery({
    queryKey: ['hoy', 'sin-siguiente-paso'],
    queryFn: cargarSinSiguientePaso,
  })
  const deHoy = useQuery({
    queryKey: ['hoy', 'tareas-de-hoy', yo],
    queryFn: () => cargarTareasDeHoy(yo),
  })
  // Sin filtro de responsable: quien ve cada visita lo decide RLS (la ve
  // quien ve su oportunidad). La ventana se calcula al pedir, no al montar,
  // para que un refresco pasada la medianoche no se quede con el «mañana» de ayer.
  const visitas = useQuery({
    queryKey: ['hoy', 'visitas-proximas'],
    queryFn: () => {
      const { desde, hasta } = ventanaVisitasHoy()
      return cargarVisitasProximas(desde, hasta)
    },
  })

  // Las dos llamadas a la accion solo existen para los roles que operan la
  // cartera (los mismos que entran al Modo llamadas y a la bandeja); a
  // `contabilidad` y `lectura` ni se les pregunta a la base.
  const opera = puedeOperar(perfil.rol)
  const leadsNuevos = useQuery({
    queryKey: ['hoy', 'leads-nuevos', perfil.rol, yo],
    queryFn: () => contarLeadsNuevos(perfil.rol, yo),
    enabled: opera,
  })
  // Misma clave ['bandeja'] que la pestaña de Personas: una sola consulta.
  const bandeja = useBandeja(perfil.rol)

  /** Tras cualquier accion se recarga la pantalla entera: los bloques se
      alimentan unos a otros (crear una tarea saca una fila del bloque 3 y la
      mete en el 5), asi que refrescar solo uno dejaria la pantalla mintiendo.
      Tambien se invalidan cartera, embudo y bandeja (SPEC §8): una interaccion
      registrada aqui cambia la temperatura y el «sin contacto» de alli. */
  function refrescar() {
    void cliente.invalidateQueries({ queryKey: ['hoy'] })
    void cliente.invalidateQueries({ queryKey: ['cartera'] })
    void cliente.invalidateQueries({ queryKey: ['embudo'] })
    void cliente.invalidateQueries({ queryKey: ['bandeja'] })
  }

  const [completando, setCompletando] = useState<string | null>(null)
  const marcarHecha = useMutation({
    mutationFn: completarTarea,
    onMutate: (id: string) => setCompletando(id),
    onSettled: () => {
      setCompletando(null)
      refrescar()
    },
  })

  return (
    <>
      {/* La cabecera va FUERA del contenedor de ancho máximo: su franja azul
          tiene que llegar a los bordes de la ventana, y `max-w-4xl mx-auto`
          se lo impediría. El texto de dentro sí se alinea a ese mismo ancho,
          vía `ancho="medio"`. */}
      <CabeceraPantalla
        titulo="Hoy"
        ancho="medio"
        descripcion={
          <>
            {perfil.nombre} · {fechaCorta(new Date())}
          </>
        }
        distintivos={<Badge variant="outlineCal">Lo más urgente arriba</Badge>}
        acciones={
          opera ? (
            <>
              {/* Ámbar sobre la franja azul: permitido (tailwind.config.js). */}
              <Button asChild variant="ambar" className="h-11 sm:h-10">
                <Link
                  to="/cola?vista=nuevos"
                  title={leadsNuevos.error === null ? undefined : leadsNuevos.error.message}
                >
                  <PhoneCall strokeWidth={2} aria-hidden="true" />
                  {textoLeadsNuevos(leadsNuevos.data, leadsNuevos.error !== null)}
                </Link>
              </Button>
              <Button asChild variant="outlineCal" className="h-11 sm:h-10">
                <Link
                  to="/personas?tab=bandeja"
                  title={bandeja.error === null ? undefined : bandeja.error.message}
                >
                  <Inbox strokeWidth={1.75} aria-hidden="true" />
                  {textoBandeja(bandeja.data?.filas.length, bandeja.error !== null)}
                </Link>
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mx-auto w-full max-w-4xl">
        <div className="space-y-4">
        {/* ---- 0 · SOLO DIRECCION ---- */}
        {esDireccion && (
          <BloqueHoy
            titulo="Esperando tu verificación"
            descripcion="Sin verificar no se emite recibo ni constancia (R3). Solo tú puedes hacerlo (R2)."
            tono="azul"
            {...estadoDe(porVerificar)}
            limite={LIMITE_HOY}
            vacio="No hay separaciones esperándote. "
          >
            {(porVerificar.data?.filas ?? []).map((s) => (
              <FilaSeparacion key={s.id} separacion={s} alTerminar={refrescar} />
            ))}
          </BloqueHoy>
        )}

        {/* ---- 1 · SEPARACIONES QUE VENCEN ---- */}
        <BloqueHoy
          titulo={`Separaciones que vencen en ${DIAS_VIGILANCIA_SEPARACION} días o menos`}
          descripcion="Los dos relojes van por separado y nunca se calcula uno del otro (R4)."
          tono="alerta"
          {...estadoDe(enRiesgo)}
            limite={LIMITE_HOY}
          vacio="Ninguna separación tiene un plazo a punto de acabarse."
        >
          {(enRiesgo.data?.filas ?? []).map((s) => (
            <FilaSeparacion key={s.id} separacion={s} alTerminar={refrescar} />
          ))}
        </BloqueHoy>

        {/* ---- 2 · TAREAS VENCIDAS ---- */}
        <BloqueHoy
          titulo="Tus tareas vencidas"
          descripcion="Ya pasó su fecha y siguen abiertas."
          tono="azul"
          {...estadoDe(vencidas)}
            limite={LIMITE_HOY}
          vacio="No tienes tareas vencidas."
        >
          {(vencidas.data?.filas ?? []).map((t) => (
            <FilaTarea
              key={t.id}
              tarea={t}
              alTerminar={refrescar}
              marcarHecha={(id) => marcarHecha.mutate(id)}
              ocupado={completando === t.id}
            />
          ))}
        </BloqueHoy>

        {/* ---- 3 · SIN SIGUIENTE PASO ---- */}
        <BloqueHoy
          titulo="Oportunidades sin siguiente paso"
          descripcion="Activas y sin ninguna tarea abierta: son incumplimientos vivos de R6."
          tono="neutro"
          {...estadoDe(sinPaso)}
            limite={LIMITE_HOY}
          vacio="Todas las oportunidades activas tienen su siguiente paso puesto."
        >
          {(sinPaso.data?.filas ?? []).map((o) => (
            <FilaHoy
              key={o.id}
              principal={o.nombreCompleto}
              secundario={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-bold">{etiquetaEstado(o.estado)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {o.diasSinContacto === null
                      ? 'sin fecha de contacto'
                      : `${o.diasSinContacto} días sin contacto`}
                  </span>
                  {o.telefono !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{formatearTelefono(o.telefono)}</span>
                    </>
                  )}
                </span>
              }
              acciones={
                <AccionesFila
                  objetivo={{
                    personaId: o.personaId,
                    oportunidadId: o.id,
                    nombre: o.nombreCompleto,
                  }}
                  alTerminar={refrescar}
                />
              }
            />
          ))}
        </BloqueHoy>

        {/* ---- 4 · VISITAS DE HOY Y MAÑANA ---- */}
        <BloqueHoy
          titulo="Visitas de hoy y mañana"
          descripcion="Confírmalas la víspera y ciérralas al terminar: realizada, no asistió o reprogramada."
          tono="neutro"
          {...estadoDe(visitas)}
          limite={LIMITE_VISITAS_PROXIMAS}
          vacio="No hay visitas agendadas para hoy ni para mañana."
        >
          {(visitas.data?.filas ?? []).map((v) => (
            <FilaVisita key={v.id} visita={v} />
          ))}
        </BloqueHoy>

        {/* ---- 5 · TAREAS DE HOY ---- */}
        <BloqueHoy
          titulo="Tus tareas de hoy"
          descripcion="Vencen hoy y todavía están a tiempo."
          tono="neutro"
          {...estadoDe(deHoy)}
            limite={LIMITE_HOY}
          vacio="No te quedan tareas para hoy."
        >
          {(deHoy.data?.filas ?? []).map((t) => (
            <FilaTarea
              key={t.id}
              tarea={t}
              alTerminar={refrescar}
              marcarHecha={(id) => marcarHecha.mutate(id)}
              ocupado={completando === t.id}
            />
          ))}
          </BloqueHoy>
        </div>

        <p className="mt-6 text-xs leading-relaxed text-suelo-500">
          Los conteos salen de <code>v_separaciones_vigilancia</code>,{' '}
          <code>v_sin_siguiente_paso</code>, <code>tareas</code>, <code>visitas</code>,{' '}
          <code>v_cartera</code> y <code>fn_bandeja</code>. Ninguna cifra de esta pantalla está
          escrita en el código.
        </p>
      </div>
    </>
  )
}

/**
 * Texto del boton «Modo llamadas». Mientras carga o si fallo, no se inventa un
 * numero: un «0 leads nuevos» falso haria que nadie abriera la cola.
 */
function textoLeadsNuevos(n: number | undefined, fallo: boolean): string {
  if (fallo || n === undefined) return 'Modo llamadas'
  if (n === 0) return 'Sin leads nuevos · Modo llamadas'
  return `${n} ${n === 1 ? 'lead nuevo sin contactar' : 'leads nuevos sin contactar'} → Modo llamadas`
}

function textoBandeja(n: number | undefined, fallo: boolean): string {
  if (fallo || n === undefined) return 'Bandeja web'
  return `Bandeja web: ${n} esperando`
}

/**
 * Traduce el estado de una consulta de react-query a lo que espera BloqueHoy.
 * Se escribe una vez para que los cinco bloques traten igual el fallo: un
 * bloque que no pudo cargar tiene que decirlo, no quedarse en cero — un cero
 * falso en esta pantalla es peor que un error a la vista.
 */
function estadoDe<T>(consulta: {
  data: Lote<T> | undefined
  isPending: boolean
  isFetching: boolean
  error: Error | null
}): { conteo: number | null; cargando: boolean; error: string | null; descartadas: number } {
  const primeraCarga = consulta.isPending && consulta.data === undefined
  return {
    conteo: consulta.error !== null ? null : (consulta.data?.filas.length ?? null),
    cargando: primeraCarga,
    error: consulta.error === null ? null : consulta.error.message,
    descartadas: consulta.data?.descartadas ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

/**
 * Una separacion. Muestra LOS DOS RELOJES, cada uno con su nombre.
 *
 * Aqui esta la regla R4 hecha pantalla: no hay un «vence en N dias» unico,
 * porque no existe. Uno es el derecho de devolucion desde el deposito
 * efectivo; el otro, la vigencia del precio despues del evento. Se muestran
 * separados y etiquetados para que nadie los confunda al leer, que es
 * exactamente como se mezclan en la practica.
 */
function FilaSeparacion({
  separacion,
  alTerminar,
}: {
  separacion: SeparacionVigilada
  alTerminar: () => void
}) {
  const s = separacion
  return (
    <FilaHoy
      principal={
        <>
          {s.nombreCompleto}
          {s.codigoUnidad !== null && (
            <span className="ml-2 font-normal text-suelo-500">{s.codigoUnidad}</span>
          )}
        </>
      }
      secundario={
        <div className="space-y-0.5">
          <p className="flex flex-wrap items-center gap-x-2">
            {/* R7: el monto nunca va suelto, siempre con su moneda. */}
            <span className="font-bold">{formatearMonto(s.monto, s.montoMoneda)}</span>
            {s.esperaVerificacion && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-bold">sin verificar</span>
              </>
            )}
          </p>
          <p>
            <span className="text-suelo-500">Devolución:</span>{' '}
            {s.fechaLimiteDevolucion === null ? (
              <span className="font-bold">[PENDIENTE] falta el depósito efectivo</span>
            ) : (
              <span className={cnPlazo(s.diasParaFinDevolucion)}>
                {textoVencimiento(s.fechaLimiteDevolucion)}
              </span>
            )}
          </p>
          <p>
            <span className="text-suelo-500">Vigencia del precio:</span>{' '}
            {s.fechaLimitePrecio === null ? (
              <span>[PENDIENTE]</span>
            ) : (
              <span className={cnPlazo(s.diasParaFinPrecio)}>
                {textoVencimiento(s.fechaLimitePrecio)}
              </span>
            )}
          </p>
        </div>
      }
      acciones={
        <AccionesFila
          objetivo={{
            personaId: s.personaId,
            oportunidadId: s.oportunidadId,
            nombre: s.nombreCompleto,
          }}
          alTerminar={alTerminar}
        />
      }
    />
  )
}

/**
 * Peso tipografico segun lo cerca que este el plazo. Sin color: el rojo ya lo
 * pone la cabecera del bloque, y repetirlo en cada linea lo volveria ruido.
 */
function cnPlazo(dias: number | null): string {
  if (dias === null) return ''
  return dias <= 0 ? 'font-black' : 'font-bold'
}

function FilaTarea({
  tarea,
  alTerminar,
  marcarHecha,
  ocupado,
}: {
  tarea: TareaFila
  alTerminar: () => void
  marcarHecha: (id: string) => void
  ocupado: boolean
}) {
  // El nombre manda; si la tarea no cuelga de nadie, el titulo ocupa su sitio
  // y no se repite abajo.
  return (
    <FilaHoy
      principal={tarea.nombrePersona ?? tarea.titulo}
      secundario={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {tarea.nombrePersona !== null && (
            <>
              <span className="font-bold">{tarea.titulo}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span title={fechaHora(tarea.venceEl)}>{textoVencimiento(tarea.venceEl)}</span>
          {tarea.telefonoPersona !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatearTelefono(tarea.telefonoPersona)}</span>
            </>
          )}
        </span>
      }
      acciones={
        <AccionesFila
          objetivo={{
            personaId: tarea.personaId,
            oportunidadId: tarea.oportunidadId,
            nombre: tarea.nombrePersona ?? tarea.titulo,
          }}
          alTerminar={alTerminar}
          extra={<BotonHecha onClick={() => marcarHecha(tarea.id)} ocupado={ocupado} />}
        />
      }
    />
  )
}

/**
 * Una visita proxima: hora · nombre arriba, tipo · estado abajo. Las acciones
 * son contactar (confirmarla o avisar de un retraso es una llamada o un
 * WhatsApp) y abrir la ficha, que es donde se confirma, se envia el aviso y se
 * marca realizada o no asistio (SeccionVisitas). Aqui no se duplican esos
 * botones: dos sitios para cerrar una visita son dos formas de cerrarla mal.
 */
function FilaVisita({ visita }: { visita: VisitaProxima }) {
  const v = visita
  const tipo = TIPOS_VISITA.find((t) => t.valor === v.tipo)?.etiqueta ?? v.tipo
  const estado = ESTADOS_VISITA.find((e) => e.valor === v.estado)?.etiqueta ?? v.estado
  // Una visita que ya empezo y sigue abierta es la que hay que cerrar.
  const empezada = new Date(v.inicioEl).getTime() <= Date.now()

  return (
    <FilaHoy
      principal={
        <>
          <span className="tabular-nums">{diaYHora(v.inicioEl)}</span>
          <span aria-hidden="true"> · </span>
          {v.nombreCompleto}
        </>
      }
      secundario={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>{tipo}</span>
          <span aria-hidden="true">·</span>
          <span className={v.estado === 'confirmada' ? 'font-bold' : undefined}>{estado}</span>
          {v.avisoEnviadoEl === null && (
            <>
              <span aria-hidden="true">·</span>
              <span>sin aviso enviado</span>
            </>
          )}
          {empezada && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-black">ya empezó: ciérrala en la ficha</span>
            </>
          )}
        </span>
      }
      acciones={
        <>
          <BotonesContacto telefonoE164={v.telefonoE164} tamano="sm" />
          <Button variant="ghost" size="sm" asChild title="Abrir la ficha">
            <Link to={rutaFicha({ personaId: v.personaId, id: v.oportunidadId })}>
              <FileText strokeWidth={1.75} aria-hidden="true" />
              <span className="sr-only">Abrir ficha de {v.nombreCompleto}</span>
            </Link>
          </Button>
        </>
      }
    />
  )
}
