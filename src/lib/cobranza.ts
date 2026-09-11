import { endOfMonth, format, startOfMonth } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { entero, leerLote, monto, texto, type Lote } from '@/lib/lectura'
import { aNumero, esMoneda, formatearMonto, type Moneda } from '@/lib/dinero'
import { fechaCorta } from '@/lib/fechas'

/**
 * Cobranza — las cuotas de los socios que ya compraron.
 *
 * ===========================================================================
 * NUNCA SE SUMAN DOS MONEDAS. NI UNA SOLA VEZ.
 * ===========================================================================
 * Los dos totales de arriba (por cobrar este mes · en mora) se calculan POR
 * MONEDA y se devuelven como una lista, no como un numero. Si hay cuotas en
 * PEN y en USD, salen dos cifras separadas. No hay ninguna funcion en este
 * archivo que devuelva «el total» a secas, porque la moneda de control del
 * negocio sigue [PENDIENTE] en 00-fuente-de-verdad\moneda-de-comunicacion.md
 * y convertir exigiria `tipo_cambio`, que nadie ha cargado.
 *
 * 🔴 AVISO SOBRE LA VISTA, ANOTADO Y NO DISIMULADO
 * `v_cobranza` (03-vistas.sql §6) calcula `pagado` como `sum(pg.monto)` SIN
 * mirar `pagos.monto_moneda`. Si alguna vez se registrara un pago en una
 * moneda distinta a la de su cuota, el `saldo` de esa fila seria una resta
 * entre dos monedas — un numero falso. Esta pantalla lo evita por el unico
 * lado que controla: `registrarPago` RECHAZA un pago cuya moneda no sea la de
 * la cuota. Arreglar la vista es una migracion y no se hace de tapadillo desde
 * aqui; queda escrito para que se decida.
 *
 * ===========================================================================
 * LOS TRAMOS SON LOS DE LA VISTA
 * ===========================================================================
 * Cuatro: por vencer · mora 1-30 · mora 31-60 · mora 60+. Esta pantalla no
 * los recalcula a partir de `dias_de_atraso`: los lee. 🟡 El brief de diseno
 * pide seis tramos (al dia / esta semana / 1-15 / 16-30 / 31-60 / 60+); no
 * coinciden con la vista y NO se inventan aqui partiendo los de la vista por
 * la mitad. Decision pendiente: o se cambia la vista, o se cambia el brief.
 */

// ---------------------------------------------------------------------------
// Los tramos
// ---------------------------------------------------------------------------

/**
 * `peso` traduce la antiguedad a JERARQUIA VISUAL, no a color.
 *
 * El brief de marca lo prohibe expresamente: «Sin color nuevo para estado de
 * pago… comunica el estado con texto + icono + peso tipografico». Asi que lo
 * que crece con la mora es el peso de la letra y el contraste de la etiqueta,
 * dentro de los colores que ya existen. Ningun rojo, ningun verde.
 */
export const TRAMOS = [
  {
    valor: 'por_vencer',
    etiqueta: 'Por vencer',
    orden: 0,
    variante: 'outline' as const,
    peso: 'font-normal',
  },
  {
    valor: 'mora_1_30',
    etiqueta: 'Mora 1–30 días',
    orden: 1,
    variante: 'secondary' as const,
    peso: 'font-bold',
  },
  {
    valor: 'mora_31_60',
    etiqueta: 'Mora 31–60 días',
    orden: 2,
    variante: 'default' as const,
    peso: 'font-bold',
  },
  {
    valor: 'mora_60_mas',
    etiqueta: 'Mora 60+ días',
    orden: 3,
    variante: 'default' as const,
    peso: 'font-black',
  },
] as const

export type Tramo = (typeof TRAMOS)[number]

export function leerTramo(valor: string): Tramo {
  const encontrado = TRAMOS.find((t) => t.valor === valor)
  if (encontrado !== undefined) return encontrado
  // Un tramo que este cliente no conoce no se disfraza de «por vencer»: se
  // enseña tal cual y al final de la lista.
  return {
    valor,
    etiqueta: valor,
    orden: 99,
    variante: 'outline',
    peso: 'font-normal',
  } as Tramo
}

/** Enum `estado_cuota` de 01-schema.sql §0. */
export const ESTADOS_CUOTA: Readonly<Record<string, string>> = {
  pendiente: 'Pendiente',
  pagada: 'Pagada',
  parcial: 'Parcial',
  vencida: 'Vencida',
  condonada: 'Condonada',
}

export function etiquetaEstadoCuota(estado: string): string {
  return ESTADOS_CUOTA[estado] ?? estado
}

// ---------------------------------------------------------------------------
// La fila de la tabla — `v_cobranza`
// ---------------------------------------------------------------------------

/**
 * Una cuota pendiente, tal como la devuelve la vista.
 *
 * 🟡 La vista NO trae `cuota_id` ni `persona_id`: se queda en (contrato_id,
 * numero), que es la clave unica de `cuotas`. Por eso registrar un pago pide
 * una consulta mas — ver `buscarCuotaParaPago`. Se deja asi en vez de leer la
 * tabla por nuestra cuenta porque el encargo pide que la tabla salga de la
 * vista, y porque partir la lista en dos fuentes es como acaban divergiendo.
 */
export type FilaCobranza = {
  contratoId: string
  nombreCompleto: string
  telefono: string | null
  codigoUnidad: string | null
  numero: number
  fechaVencimiento: string
  monto: number | string | null
  montoMoneda: string | null
  estado: string
  pagado: number | string | null
  saldo: number | string | null
  diasDeAtraso: number | null
  tramo: string
}

const COLUMNAS_COBRANZA =
  'contrato_id, nombre_completo, telefono_e164, codigo_unidad, numero, fecha_vencimiento, ' +
  'monto, monto_moneda, estado, pagado, saldo, dias_de_atraso, tramo'

function interpretarFila(fila: unknown): FilaCobranza | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const contratoId = texto(f['contrato_id'])
  const nombreCompleto = texto(f['nombre_completo'])
  const numero = entero(f['numero'])
  const fechaVencimiento = texto(f['fecha_vencimiento'])
  const estado = texto(f['estado'])
  const tramo = texto(f['tramo'])
  if (
    contratoId === null ||
    nombreCompleto === null ||
    numero === null ||
    fechaVencimiento === null ||
    estado === null ||
    tramo === null
  ) {
    return null
  }

  return {
    contratoId,
    nombreCompleto,
    telefono: texto(f['telefono_e164']),
    codigoUnidad: texto(f['codigo_unidad']),
    numero,
    fechaVencimiento,
    monto: monto(f['monto']),
    montoMoneda: texto(f['monto_moneda']),
    estado,
    pagado: monto(f['pagado']),
    saldo: monto(f['saldo']),
    diasDeAtraso: entero(f['dias_de_atraso']),
    tramo,
  }
}

export const LIMITE_COBRANZA = 500

export async function cargarCobranza(): Promise<Lote<FilaCobranza>> {
  const { data, error } = await supabase
    .from('v_cobranza')
    .select(COLUMNAS_COBRANZA)
    .limit(LIMITE_COBRANZA)

  if (error !== null) throw new Error(mensajeDeError(error.message))

  const lote = leerLote(data, interpretarFila)
  return {
    ...lote,
    filas: [...lote.filas].sort((a, b) => {
      const porTramo = leerTramo(b.tramo).orden - leerTramo(a.tramo).orden
      if (porTramo !== 0) return porTramo
      return a.fechaVencimiento.localeCompare(b.fechaVencimiento)
    }),
  }
}

// ---------------------------------------------------------------------------
// Los dos totales de arriba — SIEMPRE por moneda
// ---------------------------------------------------------------------------

export type TotalPorMoneda = {
  moneda: Moneda | '[MONEDA PENDIENTE]'
  monto: number
  cuotas: number
}

/**
 * Agrupa saldos por moneda. Nunca devuelve un total unico.
 *
 * Las filas sin moneda legible se agrupan aparte, bajo `[MONEDA PENDIENTE]`:
 * meterlas con las de soles seria suponer una moneda, y un monto sin moneda no
 * es un dato (R7).
 */
function agruparPorMoneda(filas: readonly FilaCobranza[]): TotalPorMoneda[] {
  const mapa = new Map<string, TotalPorMoneda>()

  for (const fila of filas) {
    const saldo = aNumero(fila.saldo)
    if (saldo === null) continue

    const clave = esMoneda(fila.montoMoneda) ? fila.montoMoneda : '[MONEDA PENDIENTE]'
    const previo = mapa.get(clave)
    if (previo === undefined) {
      mapa.set(clave, {
        moneda: clave as Moneda | '[MONEDA PENDIENTE]',
        monto: saldo,
        cuotas: 1,
      })
    } else {
      previo.monto += saldo
      previo.cuotas += 1
    }
  }

  return [...mapa.values()].sort((a, b) => a.moneda.localeCompare(b.moneda))
}

/**
 * Lo que vence DENTRO del mes en curso, esté o no vencido ya.
 *
 * El encargo dice «monto total por cobrar este mes». Se toma literal: todas
 * las cuotas cuyo vencimiento cae entre el 1 y el último día de este mes. No
 * se excluyen las que ya se pasaron de fecha dentro del propio mes — siguen
 * siendo cobro de este mes, y esconderlas haría que el total de arriba fuera
 * menor que la suma de la tabla de abajo.
 */
export function porCobrarEsteMes(filas: readonly FilaCobranza[], hoy = new Date()): TotalPorMoneda[] {
  const desde = format(startOfMonth(hoy), 'yyyy-MM-dd')
  const hasta = format(endOfMonth(hoy), 'yyyy-MM-dd')
  return agruparPorMoneda(
    filas.filter((f) => f.fechaVencimiento >= desde && f.fechaVencimiento <= hasta),
  )
}

/** Lo que ya está en mora, sea de este mes o de hace un año. */
export function enMora(filas: readonly FilaCobranza[]): TotalPorMoneda[] {
  return agruparPorMoneda(filas.filter((f) => f.tramo !== 'por_vencer'))
}

// ---------------------------------------------------------------------------
// El mensaje que se copia al portapapeles
// ---------------------------------------------------------------------------

/**
 * Texto de gestion de cobranza, para copiar y pegar.
 *
 * NO se conecta con WhatsApp ni abre `wa.me`: el encargo dice copiar y pegar,
 * y ademas un enlace automatico mandaria el telefono de un tercero a un
 * dominio externo sin que nadie lo haya decidido (Ley 29733, documento 05).
 *
 * El monto va con su moneda, como en todas partes (R7), y no lleva ninguna
 * amenaza ni recargo: los intereses de mora no estan definidos en ningun sitio
 * y este CRM no los va a estrenar en un mensaje de WhatsApp.
 */
export function mensajeDeCobranza(fila: FilaCobranza): string {
  const saldo = formatearMonto(fila.saldo ?? fila.monto, fila.montoMoneda)
  const unidad = fila.codigoUnidad === null ? '' : ` de la unidad ${fila.codigoUnidad}`

  return (
    `Hola ${fila.nombreCompleto}, le escribimos de Mercado Media Luna. ` +
    `La cuota n.º ${fila.numero}${unidad} es de ${saldo} y vence el ` +
    `${fechaCorta(fila.fechaVencimiento)}. ` +
    'Cualquier duda sobre el pago, quedamos atentos por este medio.'
  )
}

/**
 * Copia al portapapeles. Devuelve `false` si el navegador no deja —pasa cuando
 * la pagina no esta en HTTPS o sin permiso—, para que la pantalla pueda
 * enseñar el texto y que se copie a mano en vez de decir que ya se copio.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Registrar un pago
// ---------------------------------------------------------------------------

/**
 * Lo que hace falta para registrar un pago y que la vista no trae.
 *
 * `pagos.persona_id` es NOT NULL y `pagos.cuota_id` apunta a la cuota, no al
 * contrato; `v_cobranza` no devuelve ninguno de los dos. Se buscan por la
 * clave unica (contrato_id, numero) en el momento de abrir el formulario, y si
 * no aparecen NO se abre: es mejor no ofrecer el formulario que registrar el
 * dinero contra la cuota equivocada.
 */
export type CuotaParaPago = {
  cuotaId: string
  personaId: string
  moneda: Moneda | null
  monto: number | string | null
  estado: string
}

export async function buscarCuotaParaPago(
  contratoId: string,
  numero: number,
): Promise<CuotaParaPago | null> {
  const { data, error } = await supabase
    .from('cuotas')
    .select('id, monto, monto_moneda, estado, contratos(persona_id)')
    .eq('contrato_id', contratoId)
    .eq('numero', numero)
    .maybeSingle()

  if (error !== null) throw new Error(mensajeDeError(error.message))
  if (data === null || typeof data !== 'object') return null

  const f = data as Record<string, unknown>
  const cuotaId = texto(f['id'])
  const estado = texto(f['estado'])
  const contrato =
    typeof f['contratos'] === 'object' && f['contratos'] !== null && !Array.isArray(f['contratos'])
      ? (f['contratos'] as Record<string, unknown>)
      : null
  const personaId = contrato === null ? null : texto(contrato['persona_id'])

  if (cuotaId === null || estado === null || personaId === null) return null

  const monedaCruda = texto(f['monto_moneda'])
  return {
    cuotaId,
    personaId,
    moneda: esMoneda(monedaCruda) ? monedaCruda : null,
    monto: monto(f['monto']),
    estado,
  }
}

export const MEDIOS_DE_PAGO = ['transferencia', 'depósito', 'yape', 'efectivo'] as const

export type DatosPago = {
  monto: string
  montoMoneda: Moneda | ''
  fechaPago: string
  medio: string
  banco: string
  nroOperacion: string
  nota: string
}

export function pagoEnBlanco(): DatosPago {
  return {
    monto: '',
    montoMoneda: '',
    fechaPago: format(new Date(), 'yyyy-MM-dd'),
    medio: '',
    banco: '',
    nroOperacion: '',
    nota: '',
  }
}

export type ResultadoPago =
  | { ok: true; estadoCuota: string; aviso: string | null }
  | { ok: false; motivo: string }

/**
 * Registra el pago y ACTUALIZA EL ESTADO DE LA CUOTA.
 *
 * Lo segundo hay que hacerlo desde aqui porque no existe ningun disparador que
 * lo haga: `01-schema.sql` tiene disparadores para el historial, para los dos
 * relojes de la separacion y para la bitacora, pero ninguno que mire los pagos
 * de una cuota. Y `v_cobranza` filtra por `cu.estado <> 'pagada'`, asi que una
 * cuota cobrada que siguiera en `pendiente` se quedaria en la lista de cobro
 * para siempre.
 *
 * 🟡 Que esto lo haga el cliente es una debilidad conocida: si la pestaña se
 * cierra entre el insert del pago y el update de la cuota, queda un pago
 * registrado con la cuota sin actualizar. El dinero NO se pierde —el pago esta
 * escrito—, pero la cuota se ve como si no se hubiera cobrado. Lo correcto es
 * un disparador en la base; queda anotado como decision pendiente.
 *
 * El total cobrado se suma SOLO sobre los pagos en la misma moneda que la
 * cuota. Si apareciera uno en otra moneda, no se suma y se avisa: sumar PEN
 * con USD para decidir si una cuota esta pagada es como se pierde dinero sin
 * que nadie se entere.
 */
export async function registrarPago(
  cuota: CuotaParaPago,
  datos: DatosPago,
  comprobanteRuta: string | null,
  creadoPor: string,
): Promise<ResultadoPago> {
  const importe = Number(datos.monto.trim().replace(',', '.'))
  if (datos.monto.trim() === '' || !Number.isFinite(importe) || importe <= 0) {
    return { ok: false, motivo: 'Escribe el monto pagado. Tiene que ser mayor que cero.' }
  }
  if (datos.montoMoneda === '') {
    return { ok: false, motivo: 'Elige la moneda del pago. Un monto sin moneda no es un dato (R7).' }
  }
  if (datos.fechaPago.trim() === '') {
    return { ok: false, motivo: 'Escribe la fecha del pago.' }
  }

  // La guarda que impide crear el dato malo que la vista no sabria sumar.
  if (cuota.moneda !== null && datos.montoMoneda !== cuota.moneda) {
    return {
      ok: false,
      motivo:
        `La cuota está en ${cuota.moneda} y estás registrando un pago en ${datos.montoMoneda}. ` +
        'No se acepta: la vista v_cobranza restaría dos monedas distintas y el saldo saldría ' +
        'falso. Si el socio pagó en otra moneda, hay que decidir primero el tipo de cambio ' +
        '(tabla tipo_cambio) y eso sigue [PENDIENTE].',
    }
  }

  const { data, error } = await supabase
    .from('pagos')
    .insert({
      cuota_id: cuota.cuotaId,
      persona_id: cuota.personaId,
      monto: importe,
      monto_moneda: datos.montoMoneda,
      fecha_pago: datos.fechaPago,
      medio: datos.medio.trim() === '' ? null : datos.medio.trim(),
      banco: datos.banco.trim() === '' ? null : datos.banco.trim(),
      nro_operacion: datos.nroOperacion.trim() === '' ? null : datos.nroOperacion.trim(),
      comprobante_url: comprobanteRuta,
      nota: datos.nota.trim() === '' ? null : datos.nota.trim(),
      creado_por: creadoPor,
    })
    .select('id')

  if (error !== null) return { ok: false, motivo: mensajeDeError(error.message) }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no guardó el pago y tampoco devolvió un error: tu rol no puede registrar pagos ' +
        '(política pagos_crear reserva esto a dirección y administración).',
    }
  }

  return await actualizarEstadoDeCuota(cuota)
}

async function actualizarEstadoDeCuota(cuota: CuotaParaPago): Promise<ResultadoPago> {
  const { data, error } = await supabase
    .from('pagos')
    .select('monto, monto_moneda')
    .eq('cuota_id', cuota.cuotaId)
    .is('archivado_el', null)

  if (error !== null) {
    return {
      ok: true,
      estadoCuota: cuota.estado,
      aviso:
        'El pago quedó registrado, pero no se pudo releer el total cobrado para actualizar el ' +
        `estado de la cuota (${mensajeDeError(error.message)}). La cuota sigue como estaba.`,
    }
  }

  let cobrado = 0
  let hayOtraMoneda = false
  for (const cruda of Array.isArray(data) ? data : []) {
    if (typeof cruda !== 'object' || cruda === null) continue
    const f = cruda as Record<string, unknown>
    const valor = aNumero(monto(f['monto']))
    const moneda = texto(f['monto_moneda'])
    if (valor === null) continue
    if (cuota.moneda !== null && moneda !== cuota.moneda) {
      hayOtraMoneda = true
      continue
    }
    cobrado += valor
  }

  const debido = aNumero(cuota.monto)
  if (debido === null) {
    return {
      ok: true,
      estadoCuota: cuota.estado,
      aviso:
        'El pago quedó registrado, pero la cuota no tiene un monto legible, así que no se puede ' +
        'decidir si está saldada. Su estado no se ha tocado.',
    }
  }

  // Se compara en céntimos enteros: 0.1 + 0.2 en coma flotante no da 0.3, y
  // una cuota saldada no puede quedarse en «parcial» por ese redondeo.
  const nuevoEstado = Math.round(cobrado * 100) >= Math.round(debido * 100) ? 'pagada' : 'parcial'

  const { error: errorCuota } = await supabase
    .from('cuotas')
    .update({ estado: nuevoEstado })
    .eq('id', cuota.cuotaId)

  if (errorCuota !== null) {
    return {
      ok: true,
      estadoCuota: cuota.estado,
      aviso:
        'El pago quedó registrado, pero no se pudo actualizar el estado de la cuota: ' +
        `${mensajeDeError(errorCuota.message)}. La cuota sigue apareciendo como pendiente.`,
    }
  }

  return {
    ok: true,
    estadoCuota: nuevoEstado,
    aviso: hayOtraMoneda
      ? 'Esta cuota tiene además pagos en otra moneda, que NO se han sumado para decidir si ' +
        'está saldada. Revísala a mano: el saldo que muestra v_cobranza no es fiable en esa fila.'
      : null,
  }
}

// ---------------------------------------------------------------------------
// La gestion queda registrada como interaccion
// ---------------------------------------------------------------------------

/** Los dos canales que el encargo pide para una gestión de cobranza. */
export const CANALES_GESTION = [
  { valor: 'llamada', etiqueta: 'Llamada' },
  { valor: 'whatsapp', etiqueta: 'WhatsApp' },
] as const

export type CanalGestion = (typeof CANALES_GESTION)[number]['valor']

/**
 * Deja constancia de la gestion en `interacciones`.
 *
 * Sin esto, «se le escribió tres veces» es un recuerdo. Con esto es una fila
 * con fecha y actor, que ademas alimenta `v_actividad_diaria` y por tanto la
 * parte 1 del reporte de 7 partes.
 *
 * `oportunidad_id` se deja nulo a proposito: la cobranza es de un socio que ya
 * compro, y su oportunidad puede estar cerrada. La columna lo permite.
 */
export async function registrarGestion(
  personaId: string,
  canal: CanalGestion,
  resumen: string,
  actorId: string,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { data, error } = await supabase
    .from('interacciones')
    .insert({
      persona_id: personaId,
      canal,
      entrante: false,
      resumen,
      actor_id: actorId,
    })
    .select('id')

  if (error !== null) return { ok: false, motivo: mensajeDeError(error.message) }
  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no registró la gestión y tampoco devolvió un error: tu rol no puede crear ' +
        'interacciones (política inter_crear).',
    }
  }
  return { ok: true }
}

/**
 * A quien pertenece una fila de cobranza, para poder registrar la gestion.
 * Otra vez: `v_cobranza` no trae `persona_id`.
 */
export async function personaDelContrato(contratoId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('contratos')
    .select('persona_id')
    .eq('id', contratoId)
    .maybeSingle()

  if (error !== null) throw new Error(mensajeDeError(error.message))
  if (data === null || typeof data !== 'object') return null
  return texto((data as Record<string, unknown>)['persona_id'])
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

function mensajeDeError(mensaje: string): string {
  if (mensaje.includes('Nada se borra')) return mensaje

  if (mensaje.includes('pago_pertenece_a_algo')) {
    return 'Un pago tiene que colgar de una cuota o de una separación. No se guardó nada.'
  }
  if (mensaje.includes('v_cobranza')) {
    return (
      'Falta ejecutar 02-codigo\\sql\\03-vistas.sql en Supabase: la vista v_cobranza no existe.'
    )
  }
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level')) {
    return (
      'Tu rol no puede hacer eso en cobranza. Las políticas pagos_crear y cuotas_escribir la ' +
      'reservan a dirección y administración; contabilidad y lectura solo miran.'
    )
  }
  if (mensaje.includes('JWT') || mensaje.includes('sesión activa')) {
    return 'Se cerró tu sesión. Vuelve a entrar al CRM.'
  }
  if (mensaje.includes('Failed to fetch') || mensaje.includes('NetworkError')) {
    return 'No hay conexión con el servidor. No se guardó nada.'
  }
  return mensaje
}
