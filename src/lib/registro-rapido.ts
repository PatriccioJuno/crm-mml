import { supabase } from '@/lib/supabase'
import { normalizarTelefono } from '@/lib/telefono'

/**
 * Alta de prospecto en una sola transaccion.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO LLAMA A UNA FUNCION DE LA BASE Y NO HACE TRES INSERT
 * ---------------------------------------------------------------------------
 * El encargo pide que persona + oportunidad + tarea se creen «en una sola
 * transaccion». Desde el navegador eso no se puede: supabase-js manda una
 * peticion HTTP por tabla y no hay BEGIN/COMMIT que las abarque. Si la segunda
 * fallara quedaria una persona sin oportunidad; si fallara la tercera, una
 * oportunidad activa sin tarea abierta — o sea, la regla R6 rota justo en el
 * acto de registrar.
 *
 * Por eso la transaccion vive en la base: `fn_registro_rapido`, en
 * 02-codigo\sql\06-registro-rapido.sql. Es SECURITY INVOKER, asi que RLS se
 * sigue evaluando: esta funcion da atomicidad, no permisos.
 *
 * ---------------------------------------------------------------------------
 * AQUI NO HAY NINGUNA CIFRA DE NEGOCIO
 * ---------------------------------------------------------------------------
 * Los «15 minutos» de la tarea de primer contacto no estan escritos ni aqui ni
 * en el SQL: salen de `parametros('sla_primera_respuesta_minutos')`, que hoy
 * esta en 🔵 azul y sin valor. Mientras siga sin cargarse, la tarea vence en el
 * acto y `slaMinutos` vuelve `null` para que la pantalla lo diga en voz alta.
 * (07-crm\CLAUDE.md, seccion 2.)
 */

/**
 * Los cinco origenes admitidos, con su etiqueta para el desplegable.
 *
 * NO son una lista inventada para la interfaz: son exactamente los que enumera
 * el comentario de `personas.origen` en 01-schema.sql (seccion 3), y los mismos
 * que valida `origenes_admitidos()` en la base. Si hay que anadir uno, se anade
 * primero en el esquema.
 */
export const ORIGENES = [
  { valor: 'live', etiqueta: 'Live / transmisión' },
  { valor: 'meta_ads', etiqueta: 'Meta Ads' },
  { valor: 'organico', etiqueta: 'Orgánico' },
  { valor: 'referido', etiqueta: 'Referido' },
  { valor: 'base_historica', etiqueta: 'Base histórica' },
] as const

export type Origen = (typeof ORIGENES)[number]['valor']

const VALORES_ORIGEN: readonly string[] = ORIGENES.map((o) => o.valor)

export function esOrigen(valor: unknown): valor is Origen {
  return typeof valor === 'string' && VALORES_ORIGEN.includes(valor)
}

export type DatosRegistroRapido = {
  nombre: string
  telefono: string
  origen: Origen
  consentimiento: boolean
}

export type RegistroCreado = {
  personaId: string
  oportunidadId: string
  tareaId: string
  /** Cuando vence la tarea «Primer contacto». */
  tareaVenceEl: string
  /** Minutos del SLA leidos de `parametros`. `null` = parametro sin cargar. */
  slaMinutos: number | null
  /** La persona ya existia con ese telefono: se reutilizo su ficha. */
  personaReutilizada: boolean
  /** Ya tenia una oportunidad activa: no se abrio una segunda. */
  oportunidadReutilizada: boolean
}

export type ResultadoRegistro =
  | { ok: true; registro: RegistroCreado }
  | { ok: false; motivo: string; campo?: keyof DatosRegistroRapido }

/**
 * Lector en tiempo de ejecucion de la fila que devuelve `fn_registro_rapido`.
 *
 * `src/lib/tipos.ts` sigue vacio (faltan los tipos generados), asi que la
 * respuesta llega sin tipar. Se sigue el mismo patron que `interpretarPerfil`
 * en src/auth/tipos-sesion.ts: no se afirma una forma, se COMPRUEBA, y una
 * fila que no cumple se rechaza en vez de adivinarse.
 */
function interpretarRegistro(fila: unknown): RegistroCreado | null {
  if (typeof fila !== 'object' || fila === null) return null

  const f = fila as Record<string, unknown>
  const { persona_id, oportunidad_id, tarea_id, tarea_vence_el, sla_minutos } = f
  const { persona_reutilizada, oportunidad_reutilizada } = f

  if (typeof persona_id !== 'string' || persona_id === '') return null
  if (typeof oportunidad_id !== 'string' || oportunidad_id === '') return null
  if (typeof tarea_id !== 'string' || tarea_id === '') return null
  if (typeof tarea_vence_el !== 'string') return null
  if (sla_minutos !== null && typeof sla_minutos !== 'number') return null
  if (typeof persona_reutilizada !== 'boolean') return null
  if (typeof oportunidad_reutilizada !== 'boolean') return null

  return {
    personaId: persona_id,
    oportunidadId: oportunidad_id,
    tareaId: tarea_id,
    tareaVenceEl: tarea_vence_el,
    slaMinutos: sla_minutos,
    personaReutilizada: persona_reutilizada,
    oportunidadReutilizada: oportunidad_reutilizada,
  }
}

/**
 * Traduce el error que devuelve Postgres a algo que se pueda leer de un
 * vistazo mientras hay un live en marcha.
 *
 * Solo se reescriben los errores cuya causa se conoce con certeza. Cualquier
 * otro se muestra tal cual: preferimos un mensaje feo y cierto a uno bonito
 * que oculte lo que de verdad paso.
 */
function mensajeDeError(mensaje: string): string {
  if (mensaje.includes('fn_registro_rapido') && mensaje.includes('schema cache')) {
    return (
      'Falta ejecutar 02-codigo\\sql\\06-registro-rapido.sql en Supabase. ' +
      'Sin esa función el alta no puede ser transaccional, y no se registra a medias.'
    )
  }
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level')) {
    return 'Tu rol no tiene permiso para registrar prospectos (RLS). Habla con Walter.'
  }
  if (mensaje.includes('JWT') || mensaje.includes('sesión activa')) {
    return 'Se cerró tu sesión. Vuelve a entrar al CRM.'
  }
  return mensaje
}

/**
 * Valida, normaliza y guarda. Una sola llamada a la base.
 *
 * La validacion del telefono se hace aqui, en el cliente, ANTES de la llamada,
 * para que un numero mal escrito no cueste una ida y vuelta a la red durante
 * un live. La base vuelve a comprobarlo igualmente: el cliente valida por
 * velocidad, la base por correccion.
 */
export async function registrarRapido(datos: DatosRegistroRapido): Promise<ResultadoRegistro> {
  const nombre = datos.nombre.trim()
  if (nombre === '') {
    return { ok: false, motivo: 'El nombre es obligatorio.', campo: 'nombre' }
  }

  const telefono = normalizarTelefono(datos.telefono)
  if (!telefono.ok) {
    return { ok: false, motivo: telefono.motivo, campo: 'telefono' }
  }

  if (!esOrigen(datos.origen)) {
    return { ok: false, motivo: 'Elige un origen.', campo: 'origen' }
  }

  // Ley 29733: sin consentimiento no se guarda el dato personal. La base lo
  // vuelve a exigir; esto solo evita el viaje.
  if (!datos.consentimiento) {
    return {
      ok: false,
      motivo: 'Sin consentimiento no se puede registrar el dato (Ley 29733).',
      campo: 'consentimiento',
    }
  }

  const { data, error } = await supabase.rpc('fn_registro_rapido', {
    p_nombre_completo: nombre,
    p_telefono_e164: telefono.e164,
    p_origen: datos.origen,
    p_consentimiento: true,
    p_consentimiento_canal: 'crm_registro_rapido',
  })

  if (error) {
    return { ok: false, motivo: mensajeDeError(error.message) }
  }

  // `returns table` de Postgres llega como array de una fila.
  const fila = Array.isArray(data) ? data[0] : data
  const registro = interpretarRegistro(fila)

  if (registro === null) {
    return {
      ok: false,
      motivo:
        'Se guardó, pero la base devolvió una respuesta que este cliente no reconoce. ' +
        'Comprueba en Personas antes de volver a registrar a esta persona.',
    }
  }

  return { ok: true, registro }
}
