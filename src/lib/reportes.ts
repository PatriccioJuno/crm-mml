import { supabase } from '@/lib/supabase'
import { entero, leerLote, monto, texto, type Lote } from '@/lib/lectura'
import { aNumero, esMoneda, type Moneda } from '@/lib/dinero'
import { ESTADOS, etiquetaEstado } from '@/lib/embudo'

/**
 * Reportes — lo que las vistas SQL ya calculan, y NADA MAS.
 *
 * ===========================================================================
 * LA REGLA DE ESTE ARCHIVO
 * ===========================================================================
 * «Ningún gráfico debe inventar una escala ni un promedio que la vista no
 * calcule: si un dato no está en la vista SQL, el gráfico no lo muestra.»
 *
 * En la práctica eso significa que aquí no hay ni una división, ni un
 * porcentaje, ni una media. Las tasas vienen calculadas de `v_conversion`; los
 * costos por lead y por contrato, de `v_rendimiento_campanas`. Este archivo
 * LEE y ORDENA. Si una tasa que hace falta no existe en ninguna vista, se dice
 * que falta (ver `TASAS_SIN_VISTA`) en vez de calcularla en el navegador: una
 * cifra calculada en el cliente no se puede auditar contra el SQL, y en un
 * reporte que va a leer Walter eso es exactamente el problema que el CRM viene
 * a resolver.
 *
 * ===========================================================================
 * MONEDAS
 * ===========================================================================
 * Ni un solo total mezcla PEN con USD. Donde hay dinero —inversión de campañas
 * y pagos de los insumos— se devuelve una lista por moneda, nunca un número.
 */

// ---------------------------------------------------------------------------
// 1 · El embudo
// ---------------------------------------------------------------------------

export type FilaEmbudo = {
  estado: string
  etiqueta: string
  activas: number
  ganadas: number
  perdidas: number
  total: number
}

export async function cargarEmbudo(): Promise<Lote<FilaEmbudo>> {
  const { data, error } = await supabase
    .from('v_embudo')
    .select('estado, activas, ganadas, perdidas, total')

  if (error !== null) throw new Error(mensajeDeError(error.message))

  return leerLote(data, (fila) => {
    if (typeof fila !== 'object' || fila === null) return null
    const f = fila as Record<string, unknown>
    const estado = texto(f['estado'])
    if (estado === null) return null
    return {
      estado,
      etiqueta: etiquetaEstado(estado),
      activas: entero(f['activas']) ?? 0,
      ganadas: entero(f['ganadas']) ?? 0,
      perdidas: entero(f['perdidas']) ?? 0,
      total: entero(f['total']) ?? 0,
    }
  })
}

/**
 * Las 10 etapas, en su orden, incluidas las que la vista no devolvió.
 *
 * `v_embudo` agrupa con `count(*)`, y un grupo vacío no existe: una etapa por
 * la que todavía no ha pasado nadie sencillamente NO viene en la respuesta. Si
 * el gráfico dibujara solo lo que llega, el embudo aparecería sin los escalones
 * vacíos y se leería como si esas etapas no existieran.
 *
 * Rellenar con 0 no es inventar un dato: es la lectura correcta de un
 * `group by` — «ninguna oportunidad», no «no se sabe». Es el mismo criterio
 * que ya usa `pivotarPorLanzamiento`.
 *
 * Un estado que la base devuelva y este cliente no conozca NO se descarta: se
 * añade al final con su nombre crudo, para que se vea que el enum cambió.
 */
export function completarEmbudo(filas: readonly FilaEmbudo[]): FilaEmbudo[] {
  const conocidas = ESTADOS.map((e) => {
    const encontrada = filas.find((f) => f.estado === e.valor)
    return (
      encontrada ?? {
        estado: e.valor,
        etiqueta: e.etiqueta,
        activas: 0,
        ganadas: 0,
        perdidas: 0,
        total: 0,
      }
    )
  })

  const valores = ESTADOS.map((e) => e.valor) as readonly string[]
  const desconocidas = filas.filter((f) => !valores.includes(f.estado))

  return [...conocidas, ...desconocidas]
}

export type FilaLanzamiento = {
  lanzamiento: string
  estado: string
  etiqueta: string
  n: number
}

export async function cargarEmbudoPorLanzamiento(): Promise<Lote<FilaLanzamiento>> {
  const { data, error } = await supabase
    .from('v_embudo_por_lanzamiento')
    .select('lanzamiento, estado, n')

  if (error !== null) throw new Error(mensajeDeError(error.message))

  return leerLote(data, (fila) => {
    if (typeof fila !== 'object' || fila === null) return null
    const f = fila as Record<string, unknown>
    const lanzamiento = texto(f['lanzamiento'])
    const estado = texto(f['estado'])
    if (lanzamiento === null || estado === null) return null
    return { lanzamiento, estado, etiqueta: etiquetaEstado(estado), n: entero(f['n']) ?? 0 }
  })
}

/**
 * Pivota `v_embudo_por_lanzamiento` a una fila por estado con una columna por
 * lanzamiento, que es lo que come un BarChart agrupado.
 *
 * Esto es REORDENAR, no calcular: no se suma nada que la vista no haya contado
 * ya, y los estados sin fila para un lanzamiento salen como 0 porque la vista
 * agrupa con `count(*)` y un grupo vacío no existe — un 0 aquí significa
 * «ninguna oportunidad», no «no se sabe».
 */
export function pivotarPorLanzamiento(filas: readonly FilaLanzamiento[]): {
  lanzamientos: string[]
  datos: Record<string, string | number>[]
} {
  const lanzamientos = [...new Set(filas.map((f) => f.lanzamiento))].sort()
  const estados = [...new Set(filas.map((f) => f.estado))].sort()

  const datos = estados.map((estado) => {
    const fila: Record<string, string | number> = { etapa: etiquetaEstado(estado) }
    for (const l of lanzamientos) {
      fila[l] = filas.find((f) => f.estado === estado && f.lanzamiento === l)?.n ?? 0
    }
    return fila
  })

  return { lanzamientos, datos }
}

// ---------------------------------------------------------------------------
// 2 · Conversiones
// ---------------------------------------------------------------------------

/**
 * Las tasas que `v_conversion` CALCULA, con la fórmula literal de
 * D:\SCPCMO\01-comercial\embudo-y-metricas.md §4 al lado.
 *
 * La fórmula no es decoración: va en el tooltip de cada tarjeta para que quien
 * lea un 12 % pueda comprobar de qué es el 12 %. `numerador` y `denominador`
 * nombran las columnas de la vista, que también se enseñan — así se ve el
 * conteo del que sale el porcentaje sin tener que abrir el SQL.
 */
export const TASAS = [
  {
    clave: 'tasa_contacto_pct',
    titulo: 'Tasa de contacto',
    formula: 'Prospectos contactados / prospectos asignados',
    numerador: 'contactados',
    denominador: 'captados',
  },
  {
    clave: 'tasa_asistencia_pct',
    titulo: 'Tasa de asistencia',
    formula: 'Asistentes / registrados',
    numerador: 'asistentes',
    denominador: 'registrados',
  },
  {
    clave: 'tasa_separacion_pct',
    titulo: 'Tasa de separación',
    formula: 'Separaciones / visitas o asistentes',
    numerador: 'separaciones',
    denominador: 'asistentes',
  },
  {
    clave: 'tasa_contrato_pct',
    titulo: 'Tasa de contrato',
    formula: 'Contratos / separaciones',
    numerador: 'contratos',
    denominador: 'separaciones',
  },
  {
    clave: 'tasa_inicial_pct',
    titulo: 'Tasa de inicial',
    formula: 'Iniciales cobradas / contratos',
    numerador: 'iniciales',
    denominador: 'contratos',
  },
  {
    clave: 'prospecto_a_contrato_pct',
    titulo: 'Prospecto a contrato',
    formula: 'Contratos / prospectos captados (recorrido completo del embudo)',
    numerador: 'contratos',
    denominador: 'captados',
  },
] as const

/**
 * Las fórmulas de §4 que NINGUNA vista calcula todavía.
 *
 * Se enseñan en pantalla como huecos, con su motivo. Calcularlas en el
 * navegador sería inventar la escala que el encargo prohíbe, y además dos de
 * las tres necesitan datos que el CRM aún no registra.
 */
export const TASAS_SIN_VISTA = [
  {
    titulo: 'Tasa de visita',
    formula: 'Visitas realizadas / asistentes',
    porQue:
      'No hay estado ni tabla de «visita al terreno»: el embudo salta de asistente a separación.',
  },
  {
    titulo: 'Conversión a efectivo',
    formula: 'Efectivo cobrado / valor contractual',
    porQue:
      'Exige sumar pagos y precios de contrato, que pueden estar en PEN y en USD. La moneda de ' +
      'control sigue [PENDIENTE], así que la suma no se puede hacer sin inventar un tipo de cambio.',
  },
  {
    titulo: 'Costo por venta',
    formula: '(Publicidad + evento) / contratos cerrados',
    porQue:
      'El costo del evento presencial no está en ninguna tabla: `campanas.inversion` solo cubre ' +
      'la publicidad.',
  },
] as const

export type Conversion = {
  captados: number
  contactados: number
  registrados: number
  asistentes: number
  separaciones: number
  calificados: number
  contratos: number
  iniciales: number
  pagosTotales: number
  /** Las tasas, tal como las redondeó la vista. `null` = la vista no pudo. */
  tasas: Record<string, number | null>
}

export async function cargarConversion(): Promise<Conversion | null> {
  const { data, error } = await supabase
    .from('v_conversion')
    .select(
      'captados, contactados, registrados, asistentes, separaciones, calificados, contratos, ' +
        'iniciales, pagos_totales, tasa_contacto_pct, tasa_asistencia_pct, tasa_separacion_pct, ' +
        'tasa_contrato_pct, tasa_inicial_pct, prospecto_a_contrato_pct',
    )
    .maybeSingle()

  if (error !== null) throw new Error(mensajeDeError(error.message))
  if (data === null || typeof data !== 'object') return null

  const f = data as Record<string, unknown>
  const tasas: Record<string, number | null> = {}
  for (const t of TASAS) {
    // `round(numeric)` llega como cadena por PostgREST; `nullif` hace que una
    // tasa sin denominador venga en null. Null NO se convierte en 0: «no hay
    // con qué calcularla» y «es cero» son cosas distintas.
    tasas[t.clave] = aNumero(monto(f[t.clave]))
  }

  return {
    captados: entero(f['captados']) ?? 0,
    contactados: entero(f['contactados']) ?? 0,
    registrados: entero(f['registrados']) ?? 0,
    asistentes: entero(f['asistentes']) ?? 0,
    separaciones: entero(f['separaciones']) ?? 0,
    calificados: entero(f['calificados']) ?? 0,
    contratos: entero(f['contratos']) ?? 0,
    iniciales: entero(f['iniciales']) ?? 0,
    pagosTotales: entero(f['pagos_totales']) ?? 0,
    tasas,
  }
}

/** El conteo que hay detrás de una tasa, para enseñarlo junto al porcentaje. */
export function conteoDeTasa(
  conversion: Conversion,
  campo: string,
): number | null {
  const mapa: Record<string, number> = {
    captados: conversion.captados,
    contactados: conversion.contactados,
    registrados: conversion.registrados,
    asistentes: conversion.asistentes,
    separaciones: conversion.separaciones,
    contratos: conversion.contratos,
    iniciales: conversion.iniciales,
  }
  return mapa[campo] ?? null
}

// ---------------------------------------------------------------------------
// 3 · Rendimiento de campañas
// ---------------------------------------------------------------------------

export type Campana = {
  id: string
  nombre: string
  plataforma: string | null
  lanzamiento: string | null
  inversion: number | string | null
  inversionMoneda: string | null
  leads: number
  contratos: number
  costoPorLead: number | string | null
  costoPorContrato: number | string | null
}

export async function cargarRendimientoCampanas(): Promise<Lote<Campana>> {
  const { data, error } = await supabase
    .from('v_rendimiento_campanas')
    .select(
      'id, nombre, plataforma, lanzamiento, inversion, inversion_moneda, leads, contratos, ' +
        'costo_por_lead, costo_por_contrato',
    )

  if (error !== null) throw new Error(mensajeDeError(error.message))

  const lote = leerLote(data, (fila) => {
    if (typeof fila !== 'object' || fila === null) return null
    const f = fila as Record<string, unknown>
    const id = texto(f['id'])
    const nombre = texto(f['nombre'])
    if (id === null || nombre === null) return null
    return {
      id,
      nombre,
      plataforma: texto(f['plataforma']),
      lanzamiento: texto(f['lanzamiento']),
      inversion: monto(f['inversion']),
      inversionMoneda: texto(f['inversion_moneda']),
      leads: entero(f['leads']) ?? 0,
      contratos: entero(f['contratos']) ?? 0,
      costoPorLead: monto(f['costo_por_lead']),
      costoPorContrato: monto(f['costo_por_contrato']),
    }
  })

  return { ...lote, filas: [...lote.filas].sort((a, b) => b.leads - a.leads) }
}

/**
 * Agrupa las campañas por moneda de inversión.
 *
 * El gráfico comparativo se dibuja por moneda, no todo junto: un costo por
 * lead en soles y otro en dólares en la misma barra es una comparación falsa,
 * y no hay tipo de cambio cargado para arreglarla.
 */
export function campanasPorMoneda(
  campanas: readonly Campana[],
): { moneda: Moneda | '[MONEDA PENDIENTE]'; campanas: Campana[] }[] {
  const mapa = new Map<string, Campana[]>()
  for (const c of campanas) {
    const clave = esMoneda(c.inversionMoneda) ? c.inversionMoneda : '[MONEDA PENDIENTE]'
    const previo = mapa.get(clave)
    if (previo === undefined) mapa.set(clave, [c])
    else previo.push(c)
  }
  return [...mapa.entries()]
    .map(([moneda, lista]) => ({ moneda: moneda as Moneda | '[MONEDA PENDIENTE]', campanas: lista }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda))
}

// ---------------------------------------------------------------------------
// 4 · Calidad del dato
// ---------------------------------------------------------------------------

/**
 * Los ocho contadores de `v_calidad_del_dato`, con lo que significa cada uno.
 *
 * Van arriba del todo porque, como dice el comentario de la vista, «un CRM
 * miente en silencio»: si estos números son altos, todos los demás gráficos de
 * esta pantalla están calculados sobre datos incompletos, y eso hay que verlo
 * ANTES que las tasas, no después.
 */
export const INDICADORES_CALIDAD = [
  { clave: 'personas_sin_telefono', titulo: 'Personas sin teléfono', porQue: 'No se las puede contactar.' },
  {
    clave: 'personas_sin_consentimiento',
    titulo: 'Sin consentimiento',
    porQue: 'Ley 29733: no se les debería escribir hasta registrarlo.',
  },
  { clave: 'personas_sin_documento', titulo: 'Sin documento', porQue: 'Bloquea emitir su constancia (R3).' },
  {
    clave: 'oportunidades_sin_responsable',
    titulo: 'Oportunidades sin responsable',
    porQue: 'Nadie las está trabajando y nadie responde por ellas.',
  },
  {
    clave: 'oportunidades_sin_tarea',
    titulo: 'Sin siguiente paso',
    porQue: 'Incumplimientos vivos de R6: entraron y nadie les está haciendo nada.',
  },
  {
    clave: 'unidades_sin_verificar',
    titulo: 'Unidades sin verificar',
    porQue: 'No se pueden ofrecer hasta contrastarlas con el plano (Acta 03-O02).',
  },
  {
    clave: 'separaciones_esperando_a_walter',
    titulo: 'Separaciones esperando a Dirección',
    porQue: 'Sin su verificación no se emite constancia ni recibo (R2, R3).',
  },
  {
    clave: 'parametros_no_confirmados',
    titulo: 'Parámetros sin confirmar',
    porQue: 'Cada uno es una cifra que el CRM no puede afirmar.',
  },
] as const

export type CalidadDelDato = Record<string, number>

export async function cargarCalidadDelDato(): Promise<CalidadDelDato | null> {
  const { data, error } = await supabase
    .from('v_calidad_del_dato')
    .select(INDICADORES_CALIDAD.map((i) => i.clave).join(', '))
    .maybeSingle()

  if (error !== null) throw new Error(mensajeDeError(error.message))
  if (data === null || typeof data !== 'object') return null

  const f = data as Record<string, unknown>
  const resultado: CalidadDelDato = {}
  for (const i of INDICADORES_CALIDAD) {
    resultado[i.clave] = entero(f[i.clave]) ?? 0
  }
  return resultado
}

// ---------------------------------------------------------------------------
// 5 · Insumos del reporte semanal (partes 1, 2 y 3 del reporte de 7 partes)
// ---------------------------------------------------------------------------

export type ActividadDia = {
  dia: string
  interacciones: number
  whatsapp: number
  llamadas: number
}

export type CambioEstadoDia = {
  dia: string
  aEstado: string
  etiqueta: string
  n: number
}

export type PagosPorMoneda = {
  moneda: Moneda | '[MONEDA PENDIENTE]'
  monto: number
  pagos: number
}

export type Insumos = {
  desde: string
  hasta: string
  actividad: ActividadDia[]
  cambios: CambioEstadoDia[]
  separacionesNuevas: number
  separacionesVerificadas: number
  pagos: PagosPorMoneda[]
  /** Filas que no se pudieron leer, sumadas de todas las consultas. */
  descartadas: number
}

/**
 * Reúne la materia prima del reporte semanal para un rango de fechas.
 *
 * Son cinco consultas y NO se convierten en una: cada una sale de su propia
 * vista o tabla, y mezclarlas en una sola respuesta haría imposible decir cuál
 * de las cinco falló. Lo que se devuelve es lo que cada fuente contó; aquí no
 * se suma nada entre fuentes.
 *
 * `v_actividad_diaria` agrupa además por `actor_id`, así que un mismo día
 * puede traer varias filas. Se acumulan por día sumando LOS CONTEOS QUE LA
 * VISTA YA HIZO — es agregación de conteos, no un cálculo nuevo.
 */
export async function cargarInsumos(desde: string, hasta: string): Promise<Insumos> {
  const [actividad, cambios, nuevas, verificadas, pagos] = await Promise.all([
    supabase
      .from('v_actividad_diaria')
      .select('dia, interacciones, whatsapp, llamadas')
      .gte('dia', desde)
      .lte('dia', hasta),
    supabase
      .from('v_cambios_de_estado_por_dia')
      .select('dia, a_estado, n')
      .gte('dia', desde)
      .lte('dia', hasta),
    supabase
      .from('separaciones')
      .select('id', { count: 'exact', head: true })
      .is('archivado_el', null)
      .gte('creado_el', desde)
      .lte('creado_el', `${hasta}T23:59:59.999Z`),
    supabase
      .from('separaciones')
      .select('id', { count: 'exact', head: true })
      .is('archivado_el', null)
      .not('verificada_el', 'is', null)
      .gte('verificada_el', desde)
      .lte('verificada_el', `${hasta}T23:59:59.999Z`),
    supabase
      .from('pagos')
      .select('monto, monto_moneda')
      .is('archivado_el', null)
      .gte('fecha_pago', desde)
      .lte('fecha_pago', hasta),
  ])

  const primerError =
    actividad.error ?? cambios.error ?? nuevas.error ?? verificadas.error ?? pagos.error
  if (primerError !== null) throw new Error(mensajeDeError(primerError.message))

  let descartadas = 0

  // --- actividad, acumulada por día ---
  const porDia = new Map<string, ActividadDia>()
  for (const cruda of Array.isArray(actividad.data) ? actividad.data : []) {
    if (typeof cruda !== 'object' || cruda === null) {
      descartadas += 1
      continue
    }
    const f = cruda as Record<string, unknown>
    const dia = texto(f['dia'])
    if (dia === null) {
      descartadas += 1
      continue
    }
    const previo = porDia.get(dia) ?? { dia, interacciones: 0, whatsapp: 0, llamadas: 0 }
    previo.interacciones += entero(f['interacciones']) ?? 0
    previo.whatsapp += entero(f['whatsapp']) ?? 0
    previo.llamadas += entero(f['llamadas']) ?? 0
    porDia.set(dia, previo)
  }

  // --- cambios de estado ---
  const listaCambios: CambioEstadoDia[] = []
  for (const cruda of Array.isArray(cambios.data) ? cambios.data : []) {
    if (typeof cruda !== 'object' || cruda === null) {
      descartadas += 1
      continue
    }
    const f = cruda as Record<string, unknown>
    const dia = texto(f['dia'])
    const aEstado = texto(f['a_estado'])
    if (dia === null || aEstado === null) {
      descartadas += 1
      continue
    }
    listaCambios.push({ dia, aEstado, etiqueta: etiquetaEstado(aEstado), n: entero(f['n']) ?? 0 })
  }

  // --- pagos, agrupados POR MONEDA ---
  const porMoneda = new Map<string, PagosPorMoneda>()
  for (const cruda of Array.isArray(pagos.data) ? pagos.data : []) {
    if (typeof cruda !== 'object' || cruda === null) {
      descartadas += 1
      continue
    }
    const f = cruda as Record<string, unknown>
    const valor = aNumero(monto(f['monto']))
    if (valor === null) {
      descartadas += 1
      continue
    }
    const monedaCruda = texto(f['monto_moneda'])
    const clave = esMoneda(monedaCruda) ? monedaCruda : '[MONEDA PENDIENTE]'
    const previo = porMoneda.get(clave)
    if (previo === undefined) {
      porMoneda.set(clave, { moneda: clave as Moneda | '[MONEDA PENDIENTE]', monto: valor, pagos: 1 })
    } else {
      previo.monto += valor
      previo.pagos += 1
    }
  }

  return {
    desde,
    hasta,
    actividad: [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
    cambios: listaCambios.sort((a, b) => a.dia.localeCompare(b.dia) || a.aEstado.localeCompare(b.aEstado)),
    separacionesNuevas: nuevas.count ?? 0,
    separacionesVerificadas: verificadas.count ?? 0,
    pagos: [...porMoneda.values()].sort((a, b) => a.moneda.localeCompare(b.moneda)),
    descartadas,
  }
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

function mensajeDeError(mensaje: string): string {
  if (
    mensaje.includes('v_embudo') ||
    mensaje.includes('v_conversion') ||
    mensaje.includes('v_rendimiento_campanas') ||
    mensaje.includes('v_calidad_del_dato') ||
    mensaje.includes('v_actividad_diaria') ||
    mensaje.includes('v_cambios_de_estado_por_dia')
  ) {
    return (
      'Falta ejecutar 02-codigo\\sql\\03-vistas.sql en Supabase: esa vista de reportes no ' +
      `existe todavía. (${mensaje})`
    )
  }
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level')) {
    return 'Tu rol no puede leer estos datos. Habla con Walter.'
  }
  if (mensaje.includes('JWT') || mensaje.includes('sesión activa')) {
    return 'Se cerró tu sesión. Vuelve a entrar al CRM.'
  }
  if (mensaje.includes('Failed to fetch') || mensaje.includes('NetworkError')) {
    return 'No hay conexión con el servidor.'
  }
  return mensaje
}
