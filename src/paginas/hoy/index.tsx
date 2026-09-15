import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CabeceraPantalla } from '@/componentes/marca/CabeceraPantalla'
import { Badge } from '@/componentes/ui/badge'
import { useSesion } from '@/auth/ContextoSesion'
import type { Perfil } from '@/auth/tipos-sesion'
import { formatearMonto } from '@/lib/dinero'
import { fechaCorta, fechaHora, textoVencimiento } from '@/lib/fechas'
import { formatearTelefono } from '@/lib/telefono'
import {
  DIAS_VIGILANCIA_SEPARACION,
  cargarSeparacionesEnRiesgo,
  cargarSeparacionesPorVerificar,
  cargarSinSiguientePaso,
  cargarTareasDeHoy,
  cargarTareasVencidas,
  completarTarea,
  etiquetaEstado,
  type Lote,
  type SeparacionVigilada,
  type TareaFila,
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
 *   4 · tus tareas de hoy — lo que toca ahora.
 *
 * Cada fila lleva sus acciones al lado (interaccion · tarea · ficha) para que
 * nada cueste mas de dos clics: ver el encabezado de AccionesFila.tsx.
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

  /** Tras cualquier accion se recarga la pantalla entera: los bloques se
      alimentan unos a otros (crear una tarea saca una fila del bloque 3 y la
      mete en el 4), asi que refrescar solo uno dejaria la pantalla mintiendo. */
  function refrescar() {
    void cliente.invalidateQueries({ queryKey: ['hoy'] })
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

        {/* ---- 4 · TAREAS DE HOY ---- */}
        <BloqueHoy
          titulo="Tus tareas de hoy"
          descripcion="Vencen hoy y todavía están a tiempo."
          tono="neutro"
          {...estadoDe(deHoy)}
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
          <code>v_sin_siguiente_paso</code> y <code>tareas</code>. Ninguna cifra de esta pantalla
          está escrita en el código.
        </p>
      </div>
    </>
  )
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
  return (
    <FilaHoy
      principal={tarea.titulo}
      secundario={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {tarea.nombrePersona !== null && (
            <>
              <span className="font-bold">{tarea.nombrePersona}</span>
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
