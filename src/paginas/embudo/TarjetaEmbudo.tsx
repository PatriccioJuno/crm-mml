import { GripVertical } from 'lucide-react'
import { claseCampoCompacto } from '@/componentes/ui/input'
import { cn } from '@/lib/utils'
import { formatearTelefono } from '@/lib/telefono'
import {
  ESTADOS,
  DIAS_SIN_CONTACTO_ALERTA,
  estaEnfriada,
  exigeCualificacion,
  type EstadoEmbudo,
  type Tarjeta,
} from '@/lib/embudo'

/**
 * Una tarjeta del tablero.
 *
 * ---------------------------------------------------------------------------
 * ARRASTRAR NO PUEDE SER LA UNICA FORMA DE MOVERLA
 * ---------------------------------------------------------------------------
 * El arrastrar y soltar de HTML5 no existe en una pantalla tactil y no se
 * puede usar con el teclado. Este CRM se usa en el movil (el registro rapido
 * se hizo para eso), asi que una tarjeta que solo se moviera arrastrando seria
 * una tarjeta que en el movil no se mueve.
 *
 * Por eso cada tarjeta lleva ademas un desplegable NATIVO con los 10 estados.
 * Mismo camino, mismo aviso, mismo rechazo: los dos acaban llamando a
 * `moverOportunidad`. El desplegable es nativo por lo mismo que en el registro
 * rapido — en el movil abre el selector del sistema, que es mas rapido que
 * cualquier menu flotante.
 *
 * ---------------------------------------------------------------------------
 * EL ROJO
 * ---------------------------------------------------------------------------
 * El borde y el numero en rojo (`alerta`) marcan las tarjetas con mas de
 * `DIAS_SIN_CONTACTO_ALERTA` dias sin contacto. Es el segundo uso del token
 * `alerta`, que nacio en la pantalla Hoy como 🔵 propuesta y sigue sin estar en
 * el manual de marca; se usa aqui porque el encargo lo pide expresamente. Lo
 * que NO cambia es la prohibicion del brief de diseno: nada de rojo/verde para
 * el estado de pago.
 */
export function TarjetaEmbudo({
  tarjeta,
  arrastrando,
  alEmpezarArrastre,
  alTerminarArrastre,
  alMover,
  ocupada,
}: {
  tarjeta: Tarjeta
  arrastrando: boolean
  alEmpezarArrastre: () => void
  alTerminarArrastre: () => void
  alMover: (estado: EstadoEmbudo) => void
  /** Hay un movimiento de esta tarjeta en vuelo. */
  ocupada: boolean
}) {
  const t = tarjeta
  const fria = estaEnfriada(t.diasSinContacto)

  // R5: avisar antes de que la base lo rechace. No sustituye a la restriccion
  // — solo evita el viaje y la sorpresa.
  const bloqueadaParaCalificar = t.cualificacionCompleta === false

  return (
    <li
      draggable={!ocupada}
      onDragStart={(evento) => {
        evento.dataTransfer.setData('text/plain', t.id)
        evento.dataTransfer.effectAllowed = 'move'
        alEmpezarArrastre()
      }}
      onDragEnd={alTerminarArrastre}
      className={cn(
        'group rounded-lg border bg-card p-3 shadow-tarjeta',
        'border-border',
        fria && 'border-l-4 border-l-alerta',
        ocupada ? 'cursor-progress opacity-60' : 'cursor-grab active:cursor-grabbing',
        arrastrando && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical
          className="mt-0.5 h-4 w-4 shrink-0 text-suelo-500 opacity-0 transition-opacity group-hover:opacity-100"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold leading-tight text-foreground">
            {t.nombreCompleto}
          </p>

          <p className="mt-1 text-xs text-suelo-700">
            {t.telefono === null ? (
              <span className="text-suelo-500">sin teléfono</span>
            ) : (
              formatearTelefono(t.telefono)
            )}
          </p>

          <p className="mt-1 text-xs">
            {t.diasSinContacto === null ? (
              <span className="text-suelo-500">sin fecha de contacto</span>
            ) : (
              <span className={cn(fria ? 'font-black text-alerta' : 'text-suelo-700')}>
                {t.diasSinContacto} {t.diasSinContacto === 1 ? 'día' : 'días'} sin contacto
                {fria && ` · más de ${DIAS_SIN_CONTACTO_ALERTA}`}
              </span>
            )}
          </p>

          <p className="mt-1 truncate text-xs text-suelo-500">{textoResponsable(t)}</p>

          {bloqueadaParaCalificar && !exigeCualificacion(t.estado) && (
            <p className="mt-1.5 text-xs font-bold leading-snug text-suelo-700">
              🟡 Faltan las 4 respuestas: la base no la dejará pasar de Separación (R5).
            </p>
          )}
        </div>
      </div>

      {/* Camino alternativo al arrastre: tactil y teclado. */}
      <label className="mt-2 block">
        <span className="sr-only">Mover {t.nombreCompleto} a otro estado</span>
        <select
          value={t.estado}
          disabled={ocupada}
          onChange={(evento) => alMover(evento.target.value as EstadoEmbudo)}
          // Más bajo aún que `claseCampoCompacto`: va dentro de una tarjeta
          // del tablero, donde cada píxel de alto es una tarjeta menos a la
          // vista. El borde y el anillo siguen siendo los de la familia.
          className={cn(claseCampoCompacto, 'h-8 px-2 text-xs text-suelo-700')}
        >
          {ESTADOS.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
        </select>
      </label>
    </li>
  )
}

/**
 * Quien la lleva. Se distinguen tres casos, porque significan cosas distintas:
 * no tener responsable es un problema de datos; no poder leer el nombre es un
 * efecto de RLS (ver 08-vistas-embudo-e-inventario.sql §1). Ninguno de los dos
 * se disimula con un guion.
 */
function textoResponsable(t: Tarjeta): string {
  if (t.responsableId === null) return '🟡 sin responsable asignado'
  if (t.responsableNombre === null) return 'responsable: [sin acceso al nombre]'
  return t.responsableNombre
}
