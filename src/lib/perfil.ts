import { supabase } from '@/lib/supabase'
import {
  comoRegistro,
  comoTextos,
  llamarRpc,
  mensajeDeError,
  type ResultadoAccion,
} from '@/lib/acciones'
import { booleano, monto, texto } from '@/lib/lectura'

/**
 * El perfil comercial de una oportunidad: que busca, para que, cuando, como
 * pagaria, con quien decide. Es lo que pidio el equipo el 29/09 (SPEC §0) y lo
 * que alimenta la temperatura (`fn_temperatura`) y la regla R5.
 *
 * ---------------------------------------------------------------------------
 * DONDE VIVE CADA DATO
 * ---------------------------------------------------------------------------
 * Las 4 preguntas de cualificacion (R5) siguen en `oportunidades.cal_*`
 * (01-schema.sql): la restriccion `calificado_requiere_las_4_respuestas` las
 * mira ahi y no se mudan. Todo lo demas vive en `oportunidad_perfil` (1:1,
 * SPEC §4.3). Leer mezcla las dos; ESCRIBIR va siempre por
 * `fn_guardar_perfil`, que es la unica que puede tocar la tabla (no hay
 * politica de insert/update) y la que registra el evento R9.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ARCHIVO NO HACE
 * ---------------------------------------------------------------------------
 *  · No escribe ningun monto: el capital lo escribe el vendedor, con su moneda
 *    al lado (R7). Las categorias de capital («le alcanza para la inicial»)
 *    NO llevan cifra: la inicial es un parametro de 00-fuente-de-verdad, no
 *    una etiqueta de la interfaz.
 *  · No ofrece condiciones: «financiado / facilidades» registra lo que la
 *    persona dijo; las condiciones las define Walter (financiamiento-vigente.md
 *    §3: no se cotiza ninguna condicion de financiamiento).
 *  · No aplica nada de la web por su cuenta: lo que llego del chat de la web
 *    se SUGIERE y el vendedor lo confirma (analisis/web.md §3: «declarado en
 *    web · por confirmar»).
 */

// ---------------------------------------------------------------------------
// Opciones (cada lista = el CHECK de su columna en 13-seguimiento-comercial.sql)
// ---------------------------------------------------------------------------

export const TIPOS_INTERES = [
  { valor: 'puesto', etiqueta: 'Puesto' },
  { valor: 'tienda', etiqueta: 'Tienda' },
  { valor: 'ambos', etiqueta: 'Ambos' },
] as const

/** `oportunidades.cal_operar_o_invertir` (CHECK `oportunidades_cal_operar_o_invertir_valido`). */
export const PROPOSITOS = [
  { valor: 'operar', etiqueta: 'Trabajarlo él/ella' },
  { valor: 'alquilar_a_terceros', etiqueta: 'Comprar para alquilarlo' },
  { valor: 'invertir', etiqueta: 'Inversión' },
  { valor: 'busca_alquilar', etiqueta: 'Busca ALQUILAR un puesto (no comprar)' },
] as const

export const SITUACIONES_ACTUALES = [
  { valor: 'alquila_puesto', etiqueta: 'Alquila un puesto' },
  { valor: 'ambulante_feria', etiqueta: 'Vende en calle o feria' },
  { valor: 'local_propio', etiqueta: 'Ya tiene local propio' },
  { valor: 'sin_negocio', etiqueta: 'Aún no tiene negocio' },
] as const

/** Zonificacion por rubro publicada en planos.html:269-277 (🟡: web, no fuente de verdad). */
export const RUBROS = [
  { valor: 'abarrotes', etiqueta: 'Abarrotes/bazar' },
  { valor: 'frutas_verduras', etiqueta: 'Frutas y verduras' },
  { valor: 'carnes', etiqueta: 'Carnes, pollo, pescado' },
  { valor: 'comida_jugos', etiqueta: 'Comida o jugos' },
  { valor: 'ropa_bazar', etiqueta: 'Ropa, librería, accesorios' },
  { valor: 'otro', etiqueta: 'Otro' },
] as const

/** `oportunidades.cal_forma_pago` (01-schema.sql: 'contado' | 'facilidades'). */
export const FORMAS_PAGO = [
  { valor: 'contado', etiqueta: 'Contado' },
  {
    valor: 'facilidades',
    etiqueta: 'Financiado / facilidades',
    ayuda: 'Las condiciones las define Walter: no se ofrecen cuotas',
  },
] as const

/**
 * Categorias SIN cifra. La inicial minima es el parametro `inicial_minima`
 * (DEC-018 P-12); aqui solo se registra si la persona dice que le alcanza.
 */
export const CAPITAL_CATEGORIAS = [
  { valor: 'cubre_contado', etiqueta: 'Le alcanza para contado' },
  { valor: 'cubre_inicial', etiqueta: 'Le alcanza para la inicial' },
  { valor: 'menor_inicial', etiqueta: 'Menos que la inicial' },
  { valor: 'no_declara', etiqueta: 'No lo dijo' },
] as const

/** `horizonte_compra` → `mes_objetivo` lo calcula la base en hora de Lima (fn_guardar_perfil). */
export const HORIZONTES = [
  { valor: 'este_mes', etiqueta: 'Este mes' },
  { valor: 'proximo_mes', etiqueta: 'El próximo mes' },
  { valor: '2_3_meses', etiqueta: 'En 2–3 meses' },
  { valor: 'mas_adelante', etiqueta: 'Más adelante' },
] as const

export const DECIDE_CON = [
  { valor: 'pareja', etiqueta: 'Pareja' },
  { valor: 'familia', etiqueta: 'Familia' },
  { valor: 'socio', etiqueta: 'Socio' },
  { valor: 'otro', etiqueta: 'Otra persona' },
] as const

/**
 * Desde donde escribe. Etiquetas internas (no van al cliente): por eso aqui si
 * puede aparecer la referencia «Jicamarca», que es la misma que muestra la web
 * (embudo.js:75). El DISTRITO no se nombra en ningun sitio (analisis/negocio.md §1).
 */
export const ZONAS = [
  { valor: 'cerca', etiqueta: 'Cerca de Jicamarca' },
  { valor: 'lima', etiqueta: 'Otra zona de Lima' },
  { valor: 'provincia', etiqueta: 'Provincia' },
  { valor: 'extranjero', etiqueta: 'Fuera del Perú' },
] as const

/** Objeciones frecuentes (11-Plantillas §5, codigos O-01..O-12 agrupados). */
export const OBJECIONES = [
  { valor: 'precio', etiqueta: 'Precio' },
  { valor: 'confianza_legal', etiqueta: 'Confianza / legal' },
  { valor: 'distancia', etiqueta: 'Distancia' },
  { valor: 'avance_obra', etiqueta: 'Avance de obra' },
  { valor: 'financiamiento', etiqueta: 'Financiamiento' },
  { valor: 'ubicacion', etiqueta: 'Ubicación del puesto' },
  { valor: 'otro', etiqueta: 'Otra' },
] as const

export const CANALES_PREFERIDOS = [
  { valor: 'whatsapp', etiqueta: 'WhatsApp' },
  { valor: 'llamada', etiqueta: 'Llamada' },
  { valor: 'email', etiqueta: 'Correo' },
] as const

/** El enum `moneda` de 01-schema.sql. No hay una tercera (R7). */
export const MONEDAS_CAPITAL = [
  { valor: 'PEN', etiqueta: 'S/' },
  { valor: 'USD', etiqueta: 'US$' },
] as const

export type TipoInteres = (typeof TIPOS_INTERES)[number]['valor']
export type Proposito = (typeof PROPOSITOS)[number]['valor']
export type SituacionActual = (typeof SITUACIONES_ACTUALES)[number]['valor']
export type Rubro = (typeof RUBROS)[number]['valor']
export type FormaPago = (typeof FORMAS_PAGO)[number]['valor']
export type CapitalCategoria = (typeof CAPITAL_CATEGORIAS)[number]['valor']
export type Horizonte = (typeof HORIZONTES)[number]['valor']
export type DecideCon = (typeof DECIDE_CON)[number]['valor']
export type Zona = (typeof ZONAS)[number]['valor']
export type Objecion = (typeof OBJECIONES)[number]['valor']
export type CanalPreferido = (typeof CANALES_PREFERIDOS)[number]['valor']
export type MonedaCapital = (typeof MONEDAS_CAPITAL)[number]['valor']

/** Etiqueta de un valor de cualquiera de las listas de arriba; el valor crudo si no se conoce. */
export function etiquetaDe(
  opciones: readonly { valor: string; etiqueta: string }[],
  valor: string | null,
): string {
  if (valor === null) return 'Sin dato'
  return opciones.find((o) => o.valor === valor)?.etiqueta ?? valor
}

// ---------------------------------------------------------------------------
// Respuestas del chat de la web
// ---------------------------------------------------------------------------

/**
 * Lo que puede traer `respuestas` del chat de la web, con el rotulo y el texto
 * EXACTOS que ve el visitante — para que el vendedor reconozca lo que la
 * persona eligio, y para que analizarMensajeWeb (lote.ts) pueda leer el
 * mensaje de WhatsApp que arma la web.
 *
 * Fuente: 08-web/mercado-media-luna/assets/embudo.js:32-115 (preguntas y
 * ROTULOS), evento.js:543-598 y config.js:197-212 (pregunta del miercoles).
 * Si la web cambia una opcion, esto se actualiza detras citando el archivo.
 * Nada de esto es un dato del negocio: es lo que la persona DECLARO.
 */
export const ETIQUETAS_RESPUESTA_WEB: Record<
  string,
  { pregunta: string; opciones: Record<string, string> }
> = {
  uso: {
    pregunta: 'El puesto',
    opciones: {
      operar: 'Para trabajarlo yo',
      invertir: 'Como inversión',
      viendo: 'Todavía lo estoy viendo',
    },
  },
  alquiler: {
    pregunta: 'Hoy',
    opciones: {
      si: 'Sí, pago alquiler',
      calle: 'Vendo en la calle o en feria',
      propio: 'No, ya tengo local propio',
      sin_negocio: 'Todavía no tengo negocio',
    },
  },
  antes: {
    pregunta: 'Compra previa',
    opciones: { si: 'Sí, ya compré', no: 'No, sería la primera vez' },
  },
  giro: {
    pregunta: 'Rubro',
    opciones: {
      abarrotes: 'Abarrotes',
      frutas: 'Frutas y verduras',
      carnes: 'Carnes, pollo o pescado',
      comida: 'Comida o jugos',
      otro: 'Otra cosa',
    },
  },
  zona: {
    pregunta: 'Escribe desde',
    opciones: {
      cerca: 'Cerca de Jicamarca',
      lima: 'Otra zona de Lima',
      provincia: 'Provincia',
      extranjero: 'Fuera del Perú',
    },
  },
  pago: {
    pregunta: 'Pago',
    opciones: {
      ahorros: 'Con mis ahorros',
      partes: 'Hoy no tengo el monto completo',
      nose: 'Todavía no lo sé',
    },
  },
  decide: {
    pregunta: 'Decisión',
    opciones: { solo: 'Lo decido yo', familia: 'Con mi familia o mi socio' },
  },
  visita: {
    pregunta: 'Visita',
    opciones: {
      semana: 'Esta semana',
      mes: 'Este mes',
      videos: 'Primero quiero ver videos',
      video_semana: 'Por videollamada, esta semana',
      video_mes: 'Por videollamada, este mes',
    },
  },
  miercoles: {
    pregunta: 'Evento del miércoles',
    opciones: {
      si: 'Sí, me conecto',
      quizas: 'Voy a intentarlo',
      info: 'Mándame la información primero',
      otro: 'Prefiero otro miércoles',
    },
  },
}

/**
 * Mismo filtro que aplica la base a `respuestas_web` (SPEC §4.3): claves
 * conocidas, valores `^[a-z_]{1,40}$`.
 */
const VALOR_WEB_VALIDO = /^[a-z_]{1,40}$/

/**
 * Deja solo lo que se puede mostrar: clave conocida y valor con forma de
 * codigo. `carga` llega de un formulario publico — cualquiera puede mandar
 * cualquier JSON a la funcion (analisis/web.md §3) — asi que no se pinta nada
 * que no este en la lista.
 */
export function filtrarRespuestasWeb(valor: unknown): Record<string, string> {
  const registro = comoRegistro(valor)
  if (registro === null) return {}
  const limpias: Record<string, string> = {}
  for (const clave of Object.keys(ETIQUETAS_RESPUESTA_WEB)) {
    const v = registro[clave]
    if (typeof v === 'string' && VALOR_WEB_VALIDO.test(v)) limpias[clave] = v
  }
  return limpias
}

// ---------------------------------------------------------------------------
// El perfil
// ---------------------------------------------------------------------------

export type PerfilComercial = {
  oportunidadId: string
  tipoInteres: string | null
  /** «Cuál»: codigo, zona o rubro, en texto libre mientras no hay inventario enlazado. */
  interesDetalle: string | null
  rubro: string | null
  situacionActual: string | null
  capitalCategoria: string | null
  /** `numeric` de Postgres: se conserva como llega (lectura.ts, `monto`). */
  capitalMonto: number | string | null
  capitalMoneda: string | null
  horizonteCompra: string | null
  mesObjetivo: string | null
  decideCon: string | null
  zonaProcedencia: string | null
  objeciones: string[]
  canalPreferido: string | null
  horarioPreferido: string | null
  respuestasWeb: Record<string, string>
  fuentePerfil: string
  /** `oportunidades.cal_operar_o_invertir` (R5). */
  proposito: string | null
  /** `oportunidades.cal_forma_pago` (R5). */
  formaPago: string | null
  /** `oportunidades.cal_decide_solo` (R5). */
  decideSolo: boolean | null
  /** `oportunidades.cal_compro_antes` (R5). */
  compraAntes: boolean | null
  actualizadoEl: string | null
}

const COLUMNAS_PERFIL =
  'oportunidad_id, tipo_interes, interes_detalle, rubro, situacion_actual, ' +
  'capital_categoria, capital_monto, capital_moneda, horizonte_compra, mes_objetivo, ' +
  'decide_con, zona_procedencia, objeciones, canal_preferido, horario_preferido, ' +
  'respuestas_web, fuente_perfil, actualizado_el'

const COLUMNAS_CUALIFICACION =
  'id, cal_operar_o_invertir, cal_compro_antes, cal_forma_pago, cal_decide_solo'

function mensajeDePerfil(mensaje: string): string {
  if (mensaje.includes('oportunidad_perfil')) {
    return 'La base todavía no tiene la tabla del perfil comercial: hay que ejecutar sql/13-seguimiento-comercial.sql en Supabase.'
  }
  return mensajeDeError(mensaje)
}

/**
 * El perfil de una oportunidad. Lanza error si no se pudo leer (para useQuery).
 *
 * Que no haya fila en `oportunidad_perfil` es normal (nadie lo ha llenado
 * todavia) y tambien es lo que ve un rol que no puede leerla — lectura y
 * contabilidad, por el capital (SPEC §4.3). En los dos casos los campos salen
 * `null`: «no se», nunca «no».
 *
 * Lo que SI es un error es que no aparezca la oportunidad: o no existe, o RLS
 * no la deja ver. No se devuelve un perfil vacio con cara de perfil real.
 */
export async function cargarPerfil(oportunidadId: string): Promise<PerfilComercial> {
  const [cual, perfil] = await Promise.all([
    supabase.from('oportunidades').select(COLUMNAS_CUALIFICACION).eq('id', oportunidadId).maybeSingle(),
    supabase
      .from('oportunidad_perfil')
      .select(COLUMNAS_PERFIL)
      .eq('oportunidad_id', oportunidadId)
      .maybeSingle(),
  ])

  if (cual.error !== null) throw new Error(mensajeDePerfil(cual.error.message))
  if (perfil.error !== null) throw new Error(mensajeDePerfil(perfil.error.message))

  const o = comoRegistro(cual.data)
  if (o === null) {
    throw new Error('No se encontró la oportunidad, o tu rol no puede verla.')
  }
  const p = comoRegistro(perfil.data) ?? {}

  return {
    oportunidadId,
    tipoInteres: texto(p['tipo_interes']),
    interesDetalle: texto(p['interes_detalle']),
    rubro: texto(p['rubro']),
    situacionActual: texto(p['situacion_actual']),
    capitalCategoria: texto(p['capital_categoria']),
    capitalMonto: monto(p['capital_monto']),
    capitalMoneda: texto(p['capital_moneda']),
    horizonteCompra: texto(p['horizonte_compra']),
    mesObjetivo: texto(p['mes_objetivo']),
    decideCon: texto(p['decide_con']),
    zonaProcedencia: texto(p['zona_procedencia']),
    objeciones: comoTextos(p['objeciones']),
    canalPreferido: texto(p['canal_preferido']),
    horarioPreferido: texto(p['horario_preferido']),
    respuestasWeb: filtrarRespuestasWeb(p['respuestas_web']),
    // La columna es `not null default 'agente'`; sin fila, se usa ese mismo
    // valor por defecto de la base.
    fuentePerfil: texto(p['fuente_perfil']) ?? 'agente',
    proposito: texto(o['cal_operar_o_invertir']),
    formaPago: texto(o['cal_forma_pago']),
    decideSolo: booleano(o['cal_decide_solo']),
    compraAntes: booleano(o['cal_compro_antes']),
    actualizadoEl: texto(p['actualizado_el']),
  }
}

// ---------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------

/**
 * Las claves que acepta `fn_guardar_perfil` (SPEC §4.5). Solo se manda lo que
 * cambio: en modo 'reemplazar' una clave presente fija el valor (JSON null lo
 * borra) y una ausente no se toca.
 */
export type CambiosPerfil = Partial<{
  tipo_interes: string | null
  interes_detalle: string | null
  rubro: string | null
  situacion_actual: string | null
  capital_categoria: string | null
  capital_monto: string | null
  capital_moneda: string | null
  horizonte_compra: string | null
  decide_con: string | null
  zona_procedencia: string | null
  objeciones: string[]
  canal_preferido: string | null
  horario_preferido: string | null
  proposito: string | null
  forma_pago: string | null
  decide_solo: boolean | null
  compro_antes: boolean | null
  respuestas_web: Record<string, string>
  fuente_perfil: string
}>

/** `oportunidad_perfil.fuente_perfil` (SPEC §4.3). */
const FUENTES_PERFIL: readonly string[] = ['agente', 'web', 'mixto']

/** Claves con lista cerrada: se comprueban antes del viaje para dar un mensaje claro. */
const OPCIONES_POR_CLAVE: Readonly<Record<string, readonly { valor: string; etiqueta: string }[]>> = {
  tipo_interes: TIPOS_INTERES,
  rubro: RUBROS,
  situacion_actual: SITUACIONES_ACTUALES,
  capital_categoria: CAPITAL_CATEGORIAS,
  capital_moneda: MONEDAS_CAPITAL,
  horizonte_compra: HORIZONTES,
  decide_con: DECIDE_CON,
  zona_procedencia: ZONAS,
  canal_preferido: CANALES_PREFERIDOS,
  proposito: PROPOSITOS,
  forma_pago: FORMAS_PAGO,
}

/**
 * Comprobaciones de velocidad, no de correccion: la base vuelve a comprobarlo
 * todo (CHECKs y `capital_con_moneda`). Esto solo evita un viaje y da un
 * mensaje que se entiende.
 */
function validarCambios(cambios: CambiosPerfil): string | null {
  for (const [clave, opciones] of Object.entries(OPCIONES_POR_CLAVE)) {
    const v = (cambios as Record<string, unknown>)[clave]
    if (typeof v === 'string' && !opciones.some((o) => o.valor === v)) {
      return `«${v}» no es una opción válida para ${clave.replace(/_/g, ' ')}.`
    }
  }

  if (cambios.objeciones !== undefined) {
    const raras = cambios.objeciones.filter((x) => !OBJECIONES.some((o) => o.valor === x))
    if (raras.length > 0) return `Objeción no reconocida: ${raras.join(', ')}.`
  }

  if (cambios.fuente_perfil !== undefined && !FUENTES_PERFIL.includes(cambios.fuente_perfil)) {
    return `«${cambios.fuente_perfil}» no es una fuente de perfil válida.`
  }

  const capital = cambios.capital_monto
  if (typeof capital === 'string') {
    const limpio = capital.trim()
    // Sin separadores de miles: «1.500» y «1,500» significan cosas distintas
    // segun quien lo escriba, y un monto adivinado es peor que uno pedido otra vez.
    if (!/^\d+(\.\d{1,2})?$/.test(limpio)) {
      return 'Escribe el capital solo con dígitos (y, si hace falta, punto y hasta dos decimales), sin separador de miles.'
    }
    // R7: si en este mismo cambio se borra la moneda, el monto se queda suelto.
    if ('capital_moneda' in cambios && cambios.capital_moneda === null) {
      return 'El capital necesita su moneda al lado (R7).'
    }
  }

  return null
}

export type PerfilGuardado = {
  cualificacionCompleta: boolean
  faltan: string[]
  mesObjetivo: string | null
  cambios: string[]
}

function interpretarGuardado(respuesta: unknown): PerfilGuardado | null {
  const r = comoRegistro(respuesta)
  if (r === null) return null
  const cualificacionCompleta = booleano(r['cualificacion_completa'])
  if (cualificacionCompleta === null) return null
  return {
    cualificacionCompleta,
    faltan: comoTextos(r['faltan']),
    mesObjetivo: texto(r['mes_objetivo']),
    cambios: comoTextos(r['cambios']),
  }
}

/**
 * Guarda los cambios del perfil. 'completar' solo llena lo que esta vacio: es
 * el modo de lo que viene de la web, que nunca pisa lo que ya anoto el
 * vendedor (SPEC §4.5).
 */
export async function guardarPerfil(
  oportunidadId: string,
  cambios: CambiosPerfil,
  modo: 'reemplazar' | 'completar' = 'reemplazar',
): Promise<ResultadoAccion<PerfilGuardado>> {
  if (Object.keys(cambios).length === 0) {
    return { ok: false, motivo: 'No hay nada que guardar.' }
  }
  const invalido = validarCambios(cambios)
  if (invalido !== null) return { ok: false, motivo: invalido }

  const perfil: Record<string, unknown> = { ...cambios }
  if (typeof cambios.capital_monto === 'string') perfil['capital_monto'] = cambios.capital_monto.trim()
  for (const clave of ['interes_detalle', 'horario_preferido'] as const) {
    const v = cambios[clave]
    // Un texto en blanco es «no hay dato», no una cadena vacia guardada.
    if (typeof v === 'string') perfil[clave] = v.trim() === '' ? null : v.trim()
  }

  return llamarRpc(
    'fn_guardar_perfil',
    { p_oportunidad_id: oportunidadId, p_perfil: perfil, p_modo: modo },
    interpretarGuardado,
  )
}

// ---------------------------------------------------------------------------
// Cualificacion (R5)
// ---------------------------------------------------------------------------

/**
 * Las 4 preguntas de R5, con la redaccion de la ficha. Fuente: 07-crm/CLAUDE.md
 * §4 R5; auditoria-embudo.md:133-146. 🟡 «¿Compró antes?» se pregunta como
 * «un puesto o local»; el comentario del esquema dice «en el mercado»
 * (01-schema.sql:224) — la diferencia esta escalada, no resuelta aqui.
 */
export const PREGUNTAS_CUALIFICACION = [
  { clave: 'proposito', etiqueta: '¿Para qué lo quiere?' },
  { clave: 'compro_antes', etiqueta: '¿Compró antes un puesto o local?' },
  { clave: 'forma_pago', etiqueta: '¿Contado o financiado?' },
  { clave: 'decide_solo', etiqueta: '¿Decide solo?' },
] as const

/** Etiquetas de las preguntas de R5 que siguen sin respuesta, en el orden de la ficha. */
export function faltantesCualificacion(p: PerfilComercial): string[] {
  const respondida: Record<(typeof PREGUNTAS_CUALIFICACION)[number]['clave'], boolean> = {
    proposito: p.proposito !== null,
    compro_antes: p.compraAntes !== null,
    forma_pago: p.formaPago !== null,
    decide_solo: p.decideSolo !== null,
  }
  return PREGUNTAS_CUALIFICACION.filter((q) => !respondida[q.clave]).map((q) => q.etiqueta)
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

/** 'AAAA-MM' del mes en curso en hora de Lima — el mismo reloj que usa `mes_lima()` en la base. */
function mesActualLima(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(ahora)
  const anio = partes.find((x) => x.type === 'year')?.value ?? ''
  const mes = partes.find((x) => x.type === 'month')?.value ?? ''
  return `${anio}-${mes}`
}

/**
 * «octubre de 2026», «sin fecha», o «se pasó: septiembre de 2026».
 *
 * `mes_objetivo` es un `date` ('2026-10-01'). NO se pasa por `new Date()`:
 * esa lectura lo toma como medianoche UTC, que en Lima es el dia anterior — y
 * el 1 de octubre se mostraria como septiembre. Se lee el texto tal cual.
 */
export function textoMesObjetivo(mes: string | null): string {
  if (mes === null) return 'sin fecha'
  const m = /^(\d{4})-(\d{2})/.exec(mes)
  if (m === null) return mes
  const anio = m[1] ?? ''
  const nombre = MESES[Number(m[2]) - 1]
  if (nombre === undefined) return mes

  const texto = `${nombre} de ${anio}`
  return `${anio}-${m[2] ?? ''}` < mesActualLima() ? `se pasó: ${texto}` : texto
}

// ---------------------------------------------------------------------------
// Sugerencias desde la web
// ---------------------------------------------------------------------------

export type SugerenciaPerfil = {
  campo: keyof CambiosPerfil
  valor: string | boolean
  /** Lo que quedaria en el CRM, en palabras: «Decide solo: Sí». */
  etiqueta: string
  /** De donde sale, con lo que la persona eligio: «Web · Decisión: «Lo decido yo»». */
  origen: string
}

function origenWeb(clave: string, codigo: string): string {
  const e = ETIQUETAS_RESPUESTA_WEB[clave]
  const pregunta = e?.pregunta ?? clave
  const opcion = e?.opciones[codigo] ?? codigo
  return `Web · ${pregunta}: «${opcion}»`
}

const USO_A_PROPOSITO: Readonly<Record<string, Proposito>> = { operar: 'operar', invertir: 'invertir' }
const PAGO_A_FORMA: Readonly<Record<string, FormaPago>> = { ahorros: 'contado', partes: 'facilidades' }
const ALQUILER_A_SITUACION: Readonly<Record<string, SituacionActual>> = {
  si: 'alquila_puesto',
  calle: 'ambulante_feria',
  propio: 'local_propio',
  sin_negocio: 'sin_negocio',
}
const GIRO_A_RUBRO: Readonly<Record<string, Rubro>> = {
  abarrotes: 'abarrotes',
  frutas: 'frutas_verduras',
  carnes: 'carnes',
  comida: 'comida_jugos',
  otro: 'otro',
}
const ZONAS_WEB: readonly string[] = ZONAS.map((z) => z.valor)

/**
 * Lo que las respuestas de la web SUGIEREN para el perfil. Nunca se aplica
 * solo: cada sugerencia se muestra con un «Confirmar» (SPEC §7 S3).
 *
 * Correspondencias (analisis/web.md §3, SPEC §6.A):
 *  · uso operar/invertir → proposito ('viendo' no sugiere nada)
 *  · decide solo/familia → decide_solo true/false
 *  · antes si/no → compro_antes. ⚠ La web pregunta «¿ya compraste un puesto o
 *    local?» y el esquema «¿compró antes en el mercado?»: solo sugerencia.
 *  · pago ahorros/partes → forma_pago contado/facilidades. Señal DEBIL: «con
 *    mis ahorros» no es necesariamente contado, y «no tengo el monto completo»
 *    no es una solicitud de financiamiento. 'nose' no sugiere nada.
 *  · alquiler → situacion_actual · giro → rubro · zona → zona_procedencia
 */
export function sugerenciasDesdeWeb(respuestas: Record<string, string>): SugerenciaPerfil[] {
  const s: SugerenciaPerfil[] = []

  const uso = respuestas['uso']
  const proposito = uso === undefined ? undefined : USO_A_PROPOSITO[uso]
  if (uso !== undefined && proposito !== undefined) {
    s.push({
      campo: 'proposito',
      valor: proposito,
      etiqueta: `Para qué: ${etiquetaDe(PROPOSITOS, proposito)}`,
      origen: origenWeb('uso', uso),
    })
  }

  const decide = respuestas['decide']
  if (decide === 'solo' || decide === 'familia') {
    s.push({
      campo: 'decide_solo',
      valor: decide === 'solo',
      etiqueta: `Decide solo: ${decide === 'solo' ? 'Sí' : 'No'}`,
      origen: origenWeb('decide', decide),
    })
  }

  const antes = respuestas['antes']
  if (antes === 'si' || antes === 'no') {
    s.push({
      campo: 'compro_antes',
      valor: antes === 'si',
      etiqueta: `Compró antes: ${antes === 'si' ? 'Sí' : 'No'} (la web lo pregunta distinto: confírmalo)`,
      origen: origenWeb('antes', antes),
    })
  }

  const pago = respuestas['pago']
  const forma = pago === undefined ? undefined : PAGO_A_FORMA[pago]
  if (pago !== undefined && forma !== undefined) {
    s.push({
      campo: 'forma_pago',
      valor: forma,
      etiqueta: `Forma de pago: ${etiquetaDe(FORMAS_PAGO, forma)} (señal débil: confírmalo)`,
      origen: origenWeb('pago', pago),
    })
  }

  s.push(...sugerenciasDirectas(respuestas))
  return s
}

/** Las tres correspondencias limpias (sin reinterpretar la pregunta): situacion, rubro, zona. */
function sugerenciasDirectas(respuestas: Record<string, string>): SugerenciaPerfil[] {
  const s: SugerenciaPerfil[] = []

  const alquiler = respuestas['alquiler']
  const situacion = alquiler === undefined ? undefined : ALQUILER_A_SITUACION[alquiler]
  if (alquiler !== undefined && situacion !== undefined) {
    s.push({
      campo: 'situacion_actual',
      valor: situacion,
      etiqueta: `Situación actual: ${etiquetaDe(SITUACIONES_ACTUALES, situacion)}`,
      origen: origenWeb('alquiler', alquiler),
    })
  }

  const giro = respuestas['giro']
  const rubro = giro === undefined ? undefined : GIRO_A_RUBRO[giro]
  if (giro !== undefined && rubro !== undefined) {
    s.push({
      campo: 'rubro',
      valor: rubro,
      etiqueta: `Rubro: ${etiquetaDe(RUBROS, rubro)}`,
      origen: origenWeb('giro', giro),
    })
  }

  const zona = respuestas['zona']
  if (zona !== undefined && ZONAS_WEB.includes(zona)) {
    s.push({
      campo: 'zona_procedencia',
      valor: zona,
      etiqueta: `Desde dónde: ${etiquetaDe(ZONAS, zona)}`,
      origen: origenWeb('zona', zona),
    })
  }

  return s
}

/**
 * El perfil que se guarda al registrar un lead desde un mensaje de la web
 * (SPEC §7 S6): las respuestas filtradas + SOLO las tres correspondencias
 * directas, con `fuente_perfil 'web'`. Las cuatro de R5 no se escriben aqui:
 * se quedan como sugerencia en la ficha hasta que el vendedor las confirme.
 * Pensado para `guardarPerfil(..., 'completar')` / `perfil` de registrarProspecto.
 */
export function perfilWebDirecto(respuestas: Record<string, string>): CambiosPerfil {
  const cambios: CambiosPerfil = { respuestas_web: filtrarRespuestasWeb(respuestas), fuente_perfil: 'web' }
  for (const sug of sugerenciasDirectas(respuestas)) {
    if (typeof sug.valor !== 'string') continue
    if (sug.campo === 'situacion_actual') cambios.situacion_actual = sug.valor
    else if (sug.campo === 'rubro') cambios.rubro = sug.valor
    else if (sug.campo === 'zona_procedencia') cambios.zona_procedencia = sug.valor
  }
  return cambios
}
