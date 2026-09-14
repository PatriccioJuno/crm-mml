import { supabase } from '@/lib/supabase'
import { entero, leerLote, monto, texto, type Lote } from '@/lib/lectura'

/**
 * `parametros` — el unico sitio del sistema donde puede vivir una cifra.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE MODULO EXISTE
 * ---------------------------------------------------------------------------
 * 07-crm\CLAUDE.md §2: ningun precio, monto, plazo, cantidad de unidades ni
 * condicion comercial se escribe literal en el codigo, en el esquema, en un
 * `seed`, en la interfaz ni en un documento. Todo vive en `parametros`, con su
 * `fuente` apuntando al archivo exacto de 00-fuente-de-verdad y su
 * `estado_semaforo`.
 *
 * La consecuencia practica es esta: cuando una pantalla necesita una cifra, no
 * la tiene — la PIDE. Y tiene que saber tratar la respuesta «todavia no hay
 * valor», que hoy es la respuesta de casi todos (14 de los 16 parametros
 * sembrados estan en 🔴 rojo a proposito, 04-seed-parametros.sql).
 *
 * ---------------------------------------------------------------------------
 * LA REGLA QUE HACE CUMPLIR ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 * Un parametro en 🔴 rojo NO tiene valor utilizable, aunque su columna traiga
 * un numero. Se muestra `PENDIENTE` y no se cotiza con el. Nunca se «rellena
 * el hueco» con lo ultimo que se vio: asi nacieron los 8 precios y las 4
 * politicas de financiamiento en conflicto que documenta 00-fuente-de-verdad.
 */

/**
 * Lo que se ESCRIBE en pantalla en lugar de una cifra que no se puede afirmar.
 * Texto literal pedido por 04-seed-parametros.sql («la interfaz debe mostrarlo
 * como…»). Se declara una vez para que las cuatro pantallas digan lo mismo.
 */
export const PENDIENTE = '[PENDIENTE — ver 00-fuente-de-verdad]'

export type Parametro = {
  id: string
  descripcion: string
  valorTexto: string | null
  /** `numeric` de Postgres: se conserva como llega (ver src/lib/lectura.ts). */
  valorNumerico: number | string | null
  valorMoneda: string | null
  valorEntero: number | null
  unidad: string | null
  fuente: string
  estadoSemaforo: string
  nota: string | null
}

const COLUMNAS =
  'id, descripcion, valor_texto, valor_numerico, valor_moneda, valor_entero, ' +
  'unidad, fuente, estado_semaforo, nota'

function interpretarParametro(fila: unknown): Parametro | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const descripcion = texto(f['descripcion'])
  const fuente = texto(f['fuente'])
  const estadoSemaforo = texto(f['estado_semaforo'])
  if (id === null || descripcion === null || fuente === null || estadoSemaforo === null) {
    return null
  }

  return {
    id,
    descripcion,
    valorTexto: texto(f['valor_texto']),
    valorNumerico: monto(f['valor_numerico']),
    valorMoneda: texto(f['valor_moneda']),
    valorEntero: entero(f['valor_entero']),
    unidad: texto(f['unidad']),
    fuente,
    estadoSemaforo,
    nota: texto(f['nota']),
  }
}

/** Simbolo del semaforo, para poder enseñar el estado junto al valor. */
export function simboloSemaforo(estado: string): string {
  switch (estado) {
    case 'verde':
      return '🟢'
    case 'amarillo':
      return '🟡'
    case 'rojo':
      return '🔴'
    case 'azul':
      return '🔵'
    case 'negro':
      return '⚫'
    default:
      return '❔'
  }
}

/**
 * ¿Este parametro esta CONFIRMADO? Solo 🟢 verde.
 *
 * Es la unica respuesta que permite presentar la cifra como un hecho. Un
 * 🟡 o un 🔵 pueden proponerse, pero llevando su simbolo y su aviso al lado;
 * un 🔴 o un ⚫ no se usan para nada.
 */
export function estaConfirmado(p: Parametro | null): boolean {
  return p !== null && p.estadoSemaforo === 'verde'
}

/**
 * ¿Se puede PROPONER este valor en un formulario?
 *
 * Rojo y negro, nunca: rojo es «sin resolver» y negro es «reemplazado».
 * Amarillo y azul si, porque son un indicio o una propuesta con procedencia —
 * pero quien los muestre tiene que enseñar el simbolo y decir que no estan
 * confirmados. Y ademas tiene que haber un valor de verdad: un parametro verde
 * con la columna vacia sigue sin ser un dato.
 */
export function sePuedeProponer(p: Parametro | null): boolean {
  if (p === null) return false
  if (p.estadoSemaforo === 'rojo' || p.estadoSemaforo === 'negro') return false
  return p.valorTexto !== null || p.valorNumerico !== null || p.valorEntero !== null
}

/**
 * El valor de texto, o `PENDIENTE`. Nunca devuelve cadena vacia ni «—»:
 * un hueco silencioso se lee como «no aplica», y aqui significa «nadie lo ha
 * confirmado todavia».
 */
export function textoDeParametro(p: Parametro | null): string {
  if (!sePuedeProponer(p) || p === null) return PENDIENTE
  return p.valorTexto ?? PENDIENTE
}

/** El monto propuesto, o `null` si no se puede proponer. */
export function numeroDeParametro(p: Parametro | null): number | string | null {
  if (!sePuedeProponer(p) || p === null) return null
  return p.valorNumerico
}

/** El entero (plazos, cupos), o `null` si no se puede proponer. */
export function enteroDeParametro(p: Parametro | null): number | null {
  if (!sePuedeProponer(p) || p === null) return null
  return p.valorEntero
}

function mensajeDeError(mensaje: string): string {
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level')) {
    return 'Tu rol no puede leer los parámetros (política parametros_leer de RLS). Habla con Walter.'
  }
  if (mensaje.includes('JWT') || mensaje.includes('sesión activa')) {
    return 'Se cerró tu sesión. Vuelve a entrar al CRM.'
  }
  return mensaje
}

/**
 * Todos los parametros. Politica que lo permite: `parametros_leer`
 * (02-rls.sql) — todos leen, solo direccion escribe. Un vendedor que pudiera
 * editar el precio haria inutil toda la regla de la fuente de verdad.
 */
export async function cargarParametros(): Promise<Lote<Parametro>> {
  const { data, error } = await supabase
    .from('parametros')
    .select(COLUMNAS)
    .order('id', { ascending: true })

  if (error !== null) throw new Error(mensajeDeError(error.message))
  return leerLote(data, interpretarParametro)
}

/**
 * Solo los parametros pedidos, por id.
 *
 * Devuelve un mapa para que quien lo use tenga que preguntar por cada uno y
 * enfrentarse al `null`, en vez de recibir una lista donde es facil no darse
 * cuenta de que falta el que importa.
 */
export async function cargarParametrosPorId(
  ids: readonly string[],
): Promise<Record<string, Parametro | null>> {
  const { data, error } = await supabase.from('parametros').select(COLUMNAS).in('id', [...ids])

  if (error !== null) throw new Error(mensajeDeError(error.message))

  const lote = leerLote(data, interpretarParametro)
  const mapa: Record<string, Parametro | null> = {}
  for (const id of ids) {
    mapa[id] = lote.filas.find((p) => p.id === id) ?? null
  }
  return mapa
}


// ===========================================================================
// ESCRITURA — solo dirección
// ===========================================================================
/**
 * Todo lo que sigue existe para la pantalla /parametros.
 *
 * Quien puede escribir lo decide la base, no este archivo: la política
 * `parametros_escribir` de 02-rls.sql es
 * `for all to authenticated using (es(array['direccion']))`. La interfaz
 * esconde el botón de editar a los demás roles, pero eso es comodidad. Si
 * alguien llamara a `guardarParametro` desde la consola del navegador con otro
 * rol, PostgREST devolvería CERO filas sin error — y abajo eso se convierte en
 * un mensaje explícito, nunca en un «guardado» que no ocurrió.
 */

/** Los cinco estados del enum `semaforo` (01-schema.sql línea 49). */
export const SEMAFOROS_PARAMETRO = [
  {
    valor: 'verde',
    etiqueta: 'Confirmado',
    ayuda: 'Hay acta o documento que lo respalda. El CRM puede afirmar y cotizar esta cifra.',
  },
  {
    valor: 'amarillo',
    etiqueta: 'Por validar',
    ayuda: 'Indicio con procedencia. Se puede proponer, siempre mostrando que no está cerrado.',
  },
  {
    valor: 'azul',
    etiqueta: 'Propuesta',
    ayuda: 'Alguien lo propuso y Dirección todavía no lo ha ratificado.',
  },
  {
    valor: 'rojo',
    etiqueta: 'Sin resolver',
    ayuda: 'No hay valor utilizable. Las pantallas mostrarán PENDIENTE en su lugar.',
  },
  {
    valor: 'negro',
    etiqueta: 'Histórico',
    ayuda: 'Reemplazado por otro. Se conserva para poder auditar, no se usa.',
  },
] as const

export type EstadoSemaforo = (typeof SEMAFOROS_PARAMETRO)[number]['valor']

/** El enum `moneda` de 01-schema.sql línea 68. No hay una tercera. */
export const MONEDAS = ['PEN', 'USD'] as const

export type CampoParametro =
  | 'descripcion'
  | 'valor'
  | 'valorNumerico'
  | 'valorEntero'
  | 'fuente'

/** El formulario trabaja en cadenas; la conversión ocurre al guardar. */
export type DatosParametro = {
  descripcion: string
  valorTexto: string
  valorNumerico: string
  valorMoneda: string
  valorEntero: string
  unidad: string
  fuente: string
  estadoSemaforo: EstadoSemaforo
  nota: string
}

export type ResultadoGuardado =
  | { ok: true; id: string }
  | { ok: false; motivo: string; campo?: CampoParametro }

function esSemaforo(valor: string): valor is EstadoSemaforo {
  return SEMAFOROS_PARAMETRO.some((s) => s.valor === valor)
}

export function parametroAFormulario(p: Parametro): DatosParametro {
  return {
    descripcion: p.descripcion,
    valorTexto: p.valorTexto ?? '',
    valorNumerico: p.valorNumerico === null ? '' : String(p.valorNumerico),
    valorMoneda: p.valorMoneda ?? '',
    valorEntero: p.valorEntero === null ? '' : String(p.valorEntero),
    unidad: p.unidad ?? '',
    fuente: p.fuente,
    // Un semáforo que este cliente no conoce NO se degrada a verde ni se
    // adivina: se muestra como rojo, que es el estado que no deja usar la
    // cifra. Fallar cerrado, igual que interpretarPerfil.
    estadoSemaforo: esSemaforo(p.estadoSemaforo) ? p.estadoSemaforo : 'rojo',
    nota: p.nota ?? '',
  }
}

/** ¿El formulario trae alguna cifra o texto en alguno de los cuatro huecos? */
export function tieneValor(datos: DatosParametro): boolean {
  return (
    datos.valorTexto.trim() !== '' ||
    datos.valorNumerico.trim() !== '' ||
    datos.valorEntero.trim() !== ''
  )
}

/** Cadena vacía -> null. Un campo en blanco es «no hay dato», no una cadena. */
function oNulo(valor: string): string | null {
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

/**
 * Las reglas que este formulario hace cumplir, y de dónde sale cada una.
 *
 * 1 · `descripcion` y `fuente` son obligatorias porque la base las declara
 *     `not null` (01-schema.sql, tabla `parametros`). Aquí solo se avisa antes
 *     de gastar un viaje a la red; quien lo impide es la columna.
 *
 * 2 · 🟢 VERDE EXIGE UN VALOR. Esta regla NO la impone la base todavía: sale
 *     de `sePuedeProponer` de este mismo archivo, que ya decía que un parámetro
 *     verde con la columna vacía sigue sin ser un dato. Un formulario se
 *     esquiva —el panel de Supabase, una importación— así que lo correcto sería
 *     además una restricción `verde_exige_valor` en la tabla. Mientras no
 *     exista, esto es un aviso honesto, no una garantía. Queda dicho.
 */
function validar(datos: DatosParametro): { motivo: string; campo: CampoParametro } | null {
  if (datos.descripcion.trim() === '') {
    return { motivo: 'La descripción es obligatoria.', campo: 'descripcion' }
  }

  if (datos.fuente.trim() === '') {
    return {
      motivo:
        'Falta la fuente. Un número sin decir de dónde sale es exactamente el hueco rellenado ' +
        'que produjo las cifras en conflicto de 00-fuente-de-verdad.',
      campo: 'fuente',
    }
  }

  const numerico = datos.valorNumerico.trim()
  if (numerico !== '' && !Number.isFinite(Number(numerico))) {
    return { motivo: 'El monto no es un número válido.', campo: 'valorNumerico' }
  }

  const entero = datos.valorEntero.trim()
  if (entero !== '' && !Number.isInteger(Number(entero))) {
    return { motivo: 'El entero tiene que ser un número sin decimales.', campo: 'valorEntero' }
  }

  if (datos.estadoSemaforo === 'verde' && !tieneValor(datos)) {
    return {
      motivo:
        'No se puede confirmar un parámetro vacío. Un 🟢 sin cifra se lee como «ya está ' +
        'decidido» y no lo está: cárgale el valor, o déjalo en 🔵 propuesta.',
      campo: 'valor',
    }
  }

  return null
}

/**
 * Guarda un parámetro existente. No hay alta: los 16 parámetros nacen en
 * 04-seed-parametros.sql, y crear uno nuevo desde la interfaz sin pasar por ese
 * archivo dejaría la semilla mintiendo sobre lo que hay en la base.
 */
export async function guardarParametro(
  datos: DatosParametro,
  id: string,
): Promise<ResultadoGuardado> {
  const fallo = validar(datos)
  if (fallo !== null) return { ok: false, motivo: fallo.motivo, campo: fallo.campo }

  // Quién lo tocó. `actualizado_por` referencia `perfiles(id)`, que es el mismo
  // uuid de auth.users. Se lee de la sesión local: no hace falta ir a la red.
  const { data: sesion } = await supabase.auth.getSession()
  const actor = sesion.session?.user.id ?? null

  const fila = {
    descripcion: datos.descripcion.trim(),
    valor_texto: oNulo(datos.valorTexto),
    // Los `numeric` se mandan como cadena, igual que llegan: convertirlos a
    // `number` de camino a la base es redondear dinero por el camino.
    valor_numerico: oNulo(datos.valorNumerico),
    valor_moneda: oNulo(datos.valorMoneda),
    valor_entero: oNulo(datos.valorEntero) === null ? null : Number(datos.valorEntero.trim()),
    unidad: oNulo(datos.unidad),
    fuente: datos.fuente.trim(),
    estado_semaforo: datos.estadoSemaforo,
    nota: oNulo(datos.nota),
    actualizado_el: new Date().toISOString(),
    actualizado_por: actor,
  }

  const { data, error } = await supabase
    .from('parametros')
    .update(fila)
    .eq('id', id)
    .select('id')

  if (error !== null) return { ok: false, motivo: mensajeDeError(error.message) }

  // RLS no da error cuando esconde una fila: devuelve cero. Sin esto, un
  // `comercial` vería «guardado» y no se habría guardado nada.
  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no guardó nada y tampoco devolvió un error: tu rol no puede escribir ' +
        'parámetros. Solo Dirección puede (política parametros_escribir de RLS).',
    }
  }

  return { ok: true, id }
}
