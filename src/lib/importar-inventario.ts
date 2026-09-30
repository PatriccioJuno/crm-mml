import { llamarRpc, comoRegistro, type ResultadoAccion } from '@/lib/acciones'
import { entero } from '@/lib/lectura'

/**
 * CARGA INICIAL DEL INVENTARIO — el plano vigente + el inventario gráfico.
 *
 * ---------------------------------------------------------------------------
 * QUÉ CRUZA Y QUIÉN MANDA EN CADA DATO
 * ---------------------------------------------------------------------------
 * Dos archivos que Dirección o Administración eligen desde su equipo:
 *
 *  1. `inventario-unidades.csv` (D:\SCPCMO\00-fuente-de-verdad): el cuadro de
 *     áreas del plano A-1 entregado por Walter el 21/09/2026. MANDA en la
 *     existencia de la unidad, su tipo y su área (inventario-maestro.md §1).
 *  2. `seed.json` del inventario gráfico (02-marketing\diseño\inventario
 *     grafico\data): el polígono de cada unidad sobre el plano de zonificación,
 *     el rubro de la zona, la disponibilidad de Libres.xlsx y el titular del
 *     kardex MML 2026. APORTA lo que el plano no dice.
 *
 * Cuando los dos no coinciden, no se elige en silencio (07-crm/CLAUDE.md §6):
 * la fila entra con el dato del plano y el desacuerdo escrito en `revisar`, y
 * si el desacuerdo afecta a si la unidad se puede ofrecer, su `estado_dato`
 * baja a 🟡 y deja de ser ofrecible hasta que Rosa lo confirme.
 *
 * ---------------------------------------------------------------------------
 * QUÉ NO SE CARGA, A PROPÓSITO
 * ---------------------------------------------------------------------------
 *  · Los montos del kardex (monto total, abonado, saldo): vienen sin moneda
 *    (R7) y son cobranza, no inventario. Se cargan con la plantilla de socios
 *    (05-datos\importaciones\IMPORTAR-SOCIOS-instrucciones.md), no aquí.
 *  · El estado civil del titular: no lo necesita ningún proceso del CRM (Ley
 *    29733, dato mínimo necesario).
 *  · Las celdas crudas del kardex (`sources`): la fila de origen se cita en
 *    `fuente_del_dato`, no se copia.
 *
 * Las reglas son las mismas que se probaron el 29/09/2026 con un script sobre
 * los archivos reales: 485 unidades, 217 titulares.
 */

// ---------------------------------------------------------------------------
// Constantes de procedencia (texto, no cifras de negocio)
// ---------------------------------------------------------------------------

export const FUENTE_PLANO =
  'ARQUITECTURA Mercado Media Luna 2024 1.pdf, lámina A-1 (cajetín agosto 2022), entregado por Walter Iván ' +
  'el 21/09/2026 · 00-fuente-de-verdad/inventario-unidades.csv'

const FUENTE_TITULAR =
  'Kardex MML 2026 - Actualizado.xlsx (hojas P./T. FORMER, P./T. NEW, P. REACTIVA) vía inventario gráfico'

/**
 * Tiendas que el plano de disponibilidad marca como libres
 * (inventario-maestro.md §4, conteo del 28/09/2026). Es la única lista de
 * tiendas libres que tiene la fuente de verdad; el kardex marca otras.
 */
const TIENDAS_LIBRES_EN_PLANO: ReadonlySet<string> = new Set([
  'T-7', 'T-8A', 'T-26', 'T-27', 'T-28', 'T-32', 'T-34', 'T-35', 'T-37',
])

/** Diferencia de área, en m², a partir de la cual plano y kardex «no coinciden». Tolerancia de lectura, no dato comercial. */
const TOLERANCIA_AREA_M2 = 0.1

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type TitularCarga = {
  clave: string
  nombre: string
  doc_tipo: string | null
  doc_numero: string | null
  telefono: string | null
  fuente: string
  notas: string | null
}

export type UnidadCarga = {
  codigo: string
  tipo: 'puesto' | 'tienda'
  area_m2: number | null
  estado_comercial: 'disponible' | 'contratada' | 'no_disponible'
  estado_dato: 'verde' | 'amarillo' | 'rojo'
  fuente_plano: string
  fuente_disponibilidad: string
  geometria: [number, number][] | null
  zona_rubro: string | null
  observaciones: string | null
  tipo_socio: string | null
  titular: string | null
  revisar: string | null
}

export type ResumenCarga = {
  unidades: number
  puestos: number
  tiendas: number
  titulares: number
  ofrecibles: number
  disponiblesPuestos: number
  disponiblesTiendas: number
  porRevisar: number
  sinUbicacion: string[]
  sinArea: string[]
  soloEnPlano: string[]
  soloEnInventarioGrafico: string[]
}

export type CargaPreparada = {
  unidades: UnidadCarga[]
  titulares: TitularCarga[]
  corte: string
  resumen: ResumenCarga
}

// ---------------------------------------------------------------------------
// Lectura de los dos archivos
// ---------------------------------------------------------------------------

type FilaPlano = { codigo: string; tipo: string; area: number | null }

/** CSV del cuadro de áreas. Cabecera esperada: codigo,tipo,area_m2,… (acepta BOM y ; como separador). */
export function leerCsvPlano(textoCsv: string): FilaPlano[] {
  const lineas = textoCsv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const cabecera = lineas[0]
  if (cabecera === undefined) throw new Error('El CSV del plano está vacío.')
  const sep = cabecera.includes(';') && !cabecera.includes(',') ? ';' : ','
  const columnas = cabecera.split(sep).map((c) => c.trim().toLowerCase())
  const iCodigo = columnas.indexOf('codigo')
  const iTipo = columnas.indexOf('tipo')
  const iArea = columnas.indexOf('area_m2')
  if (iCodigo < 0 || iTipo < 0 || iArea < 0) {
    throw new Error('El CSV del plano no tiene las columnas codigo, tipo y area_m2 (00-fuente-de-verdad/inventario-unidades.csv).')
  }
  const filas: FilaPlano[] = []
  for (const linea of lineas.slice(1)) {
    const celdas = linea.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
    const codigo = celdas[iCodigo] ?? ''
    if (codigo === '') continue
    const area = Number.parseFloat(celdas[iArea] ?? '')
    filas.push({ codigo, tipo: (celdas[iTipo] ?? '').toLowerCase(), area: Number.isFinite(area) ? area : null })
  }
  return filas
}

type UnidadGrafica = {
  id: string
  kind: string
  status: string
  owner: string
  dni: string
  phone: string
  group: string
  zone: string
  area: string
  notes: string
  review: string
  geometry: [number, number][] | null
  availabilitySource: string | null
  previousOwner: string | null
}

function cadena(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function leerGeometria(v: unknown): [number, number][] | null {
  if (!Array.isArray(v) || v.length < 3) return null
  const puntos: [number, number][] = []
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2) return null
    const x = Number(p[0])
    const y = Number(p[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    puntos.push([x, y])
  }
  return puntos
}

/** seed.json del inventario gráfico: `{ units: [...] }`. Lo que no se pueda leer se descarta y se cuenta. */
export function leerInventarioGrafico(textoJson: string): { unidades: UnidadGrafica[]; descartadas: number } {
  let crudo: unknown
  try {
    crudo = JSON.parse(textoJson.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('El archivo del inventario gráfico no es un JSON válido (se espera data/seed.json).')
  }
  const raiz = comoRegistro(crudo)
  const lista = raiz !== null && Array.isArray(raiz['units']) ? (raiz['units'] as unknown[]) : null
  if (lista === null) throw new Error('El JSON no tiene la lista «units» del inventario gráfico.')
  const unidades: UnidadGrafica[] = []
  let descartadas = 0
  for (const item of lista) {
    const u = comoRegistro(item)
    const id = u === null ? '' : cadena(u['id']).trim()
    if (u === null || id === '') {
      descartadas += 1
      continue
    }
    unidades.push({
      id,
      kind: cadena(u['kind']),
      status: cadena(u['status']),
      owner: cadena(u['owner']).trim(),
      dni: cadena(u['dni']),
      phone: cadena(u['phone']),
      group: cadena(u['group']).trim(),
      zone: cadena(u['zone']).trim(),
      area: cadena(u['area']),
      notes: cadena(u['notes']).trim(),
      review: cadena(u['review']).trim(),
      geometry: leerGeometria(u['geometry']),
      availabilitySource: cadena(u['availabilitySource']) || null,
      previousOwner: cadena(u['previousOwner']) || null,
    })
  }
  return { unidades, descartadas }
}

// ---------------------------------------------------------------------------
// Normalizaciones (mismas reglas que src/lib/telefono.ts, sin adivinar)
// ---------------------------------------------------------------------------

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Celular peruano de 9 dígitos → E.164. Cualquier otra cosa → null: un teléfono inventado es peor que uno vacío. */
function telefonoE164(t: string): string | null {
  const d = t.replace(/\D/g, '')
  if (d.length === 9 && d.startsWith('9')) return `+51${d}`
  if (d.length === 11 && d.startsWith('519')) return `+${d}`
  return null
}

function documento(t: string): { tipo: string | null; numero: string | null } {
  const d = t.replace(/\D/g, '')
  if (d.length === 8) return { tipo: 'DNI', numero: d }
  if (d.length === 11 && ['10', '15', '17', '20'].includes(d.slice(0, 2))) return { tipo: 'RUC', numero: d }
  return { tipo: null, numero: null }
}

function nombreValido(n: string): boolean {
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(n)
}

// ---------------------------------------------------------------------------
// El cruce
// ---------------------------------------------------------------------------

export function prepararCarga(textoCsv: string, textoJson: string): CargaPreparada {
  const plano = leerCsvPlano(textoCsv)
  const { unidades: grafico } = leerInventarioGrafico(textoJson)
  const porCodigo = new Map(grafico.map((u) => [u.id, u]))
  const codigosPlano = new Set(plano.map((p) => p.codigo))

  // ---- titulares: una persona por DNI, si no por teléfono, si no por nombre ----
  const titulares = new Map<string, TitularCarga & { unidades: string[]; avisos: string[] }>()
  const claveDeUnidad = new Map<string, string>()
  for (const u of grafico) {
    if (u.status !== 'Ocupado' || !nombreValido(u.owner)) continue
    const doc = documento(u.dni)
    const tel = telefonoE164(u.phone)
    const clave = doc.numero !== null ? `doc:${doc.numero}` : tel !== null ? `tel:${tel}` : `nom:${sinTildes(u.owner)}`
    let t = titulares.get(clave)
    if (t === undefined) {
      t = { clave, nombre: u.owner, doc_tipo: doc.tipo, doc_numero: doc.numero, telefono: tel, fuente: '', notas: null, unidades: [], avisos: [] }
      titulares.set(clave, t)
    } else if (sinTildes(t.nombre) !== sinTildes(u.owner)) {
      t.avisos.push(`${u.id} lo nombra «${u.owner}»`)
    }
    if (t.telefono === null && tel !== null) t.telefono = tel
    t.unidades.push(u.id)
    claveDeUnidad.set(u.id, clave)
  }
  const listaTitulares: TitularCarga[] = [...titulares.values()].map((t) => {
    const notas: string[] = []
    if (t.unidades.length > 1) notas.push('Titular de varias unidades.')
    if (t.avisos.length > 0) notas.push(`Revisar nombre: ${t.avisos.join('; ')}.`)
    return {
      clave: t.clave,
      nombre: t.nombre,
      doc_tipo: t.doc_tipo,
      doc_numero: t.doc_numero,
      telefono: t.telefono,
      fuente: `${FUENTE_TITULAR} · unidades: ${[...t.unidades].sort().join(', ')}`,
      notas: notas.length > 0 ? notas.join(' ') : null,
    }
  })

  // ---- unidades: una por fila del plano ----
  const unidades: UnidadCarga[] = plano.map((p) => {
    const g = porCodigo.get(p.codigo)
    const tipo: 'puesto' | 'tienda' = p.tipo === 'tienda' ? 'tienda' : 'puesto'
    const revisar: string[] = []
    let estadoDato: UnidadCarga['estado_dato'] = 'verde'
    const bajarA = (e: 'amarillo' | 'rojo') => {
      if (e === 'rojo' || estadoDato === 'verde') estadoDato = e
    }
    if (p.area === null) {
      bajarA('rojo')
      revisar.push('Sin área en el plano: no se ofrece, no se cotiza y no se separa hasta que Walter confirme el área (inventario-maestro.md §3.3).')
    }
    let estadoComercial: UnidadCarga['estado_comercial'] = 'no_disponible'
    let fuenteDisp = 'No figura en el inventario gráfico (29/09/2026)'
    if (g === undefined) {
      revisar.push('Está en el cuadro de áreas del plano pero no en el inventario gráfico ni en el kardex.')
    } else {
      if (g.status === 'Libre') {
        estadoComercial = 'disponible'
        fuenteDisp =
          g.availabilitySource === 'Libres.xlsx'
            ? 'Libres.xlsx (lista de puestos libres de secretaría) · inventario gráfico 29/09/2026'
            : 'Observación de vacío en el kardex MML 2026 - Actualizado.xlsx · inventario gráfico 29/09/2026'
        if (tipo === 'tienda' && !TIENDAS_LIBRES_EN_PLANO.has(p.codigo)) {
          bajarA('amarillo')
          revisar.push('Libre según el kardex, pero el plano de disponibilidad no la marca como libre: confirmar con Rosa y con el responsable de tiendas.')
        }
      } else if (g.status === 'Ocupado') {
        estadoComercial = 'contratada'
        fuenteDisp = 'Ocupada según el kardex MML 2026 - Actualizado.xlsx (tiene titular) · estado exacto (contratada, pagada o entregada) por confirmar'
      } else {
        fuenteDisp = 'Por verificar en el inventario gráfico (29/09/2026)'
        bajarA('amarillo')
        revisar.push('Por verificar: el inventario gráfico no pudo decidir si está libre u ocupada.')
      }
      if (tipo === 'tienda' && TIENDAS_LIBRES_EN_PLANO.has(p.codigo) && g.status !== 'Libre') {
        bajarA('amarillo')
        revisar.push(`El plano de disponibilidad la marca libre, pero el inventario gráfico dice «${g.status}».`)
      }
      const areaKardex = Number.parseFloat(g.area)
      if (p.area !== null && Number.isFinite(areaKardex) && Math.abs(areaKardex - p.area) > TOLERANCIA_AREA_M2) {
        revisar.push(`El kardex (hoja Inf. P) le da ${areaKardex} m²; el cuadro de áreas del plano, ${p.area} m². Para contrato manda el plano.`)
      }
      if (g.review !== '') revisar.push(`Kardex: ${g.review}`)
      if (g.previousOwner !== null) revisar.push('Tiene titular anterior registrado en el kardex.')
    }
    return {
      codigo: p.codigo,
      tipo,
      area_m2: p.area,
      estado_comercial: estadoComercial,
      estado_dato: estadoDato,
      fuente_plano: FUENTE_PLANO,
      fuente_disponibilidad: fuenteDisp,
      geometria: g?.geometry ?? null,
      zona_rubro: g !== undefined && g.zone !== '' ? g.zone : null,
      observaciones: g !== undefined && g.notes !== '' ? g.notes : null,
      tipo_socio: g !== undefined && g.status === 'Ocupado' && g.group !== '' ? g.group : null,
      titular: claveDeUnidad.get(p.codigo) ?? null,
      revisar: revisar.length > 0 ? revisar.join(' ') : null,
    }
  })

  const disponiblesPuestos = unidades.filter((u) => u.tipo === 'puesto' && u.estado_comercial === 'disponible').length
  const disponiblesTiendas = unidades.filter((u) => u.tipo === 'tienda' && u.estado_comercial === 'disponible').length
  const corte =
    'Puestos: Libres.xlsx (lista de puestos libres de secretaría). Tiendas: observaciones de vacío del kardex MML 2026 - ' +
    'Actualizado.xlsx, contrastadas con el plano de disponibilidad (las que no coinciden quedan 🟡). Importado del inventario ' +
    `gráfico: ${disponiblesPuestos} puestos y ${disponiblesTiendas} tiendas marcados como disponibles. Confirmar con Rosa antes de separar.`

  return {
    unidades,
    titulares: listaTitulares,
    corte,
    resumen: {
      unidades: unidades.length,
      puestos: unidades.filter((u) => u.tipo === 'puesto').length,
      tiendas: unidades.filter((u) => u.tipo === 'tienda').length,
      titulares: listaTitulares.length,
      ofrecibles: unidades.filter((u) => u.estado_comercial === 'disponible' && u.estado_dato === 'verde').length,
      disponiblesPuestos,
      disponiblesTiendas,
      porRevisar: unidades.filter((u) => u.revisar !== null).length,
      sinUbicacion: unidades.filter((u) => u.geometria === null).map((u) => u.codigo),
      sinArea: unidades.filter((u) => u.area_m2 === null).map((u) => u.codigo),
      soloEnPlano: plano.filter((p) => !porCodigo.has(p.codigo)).map((p) => p.codigo),
      soloEnInventarioGrafico: grafico.filter((g) => !codigosPlano.has(g.id)).map((g) => g.id),
    },
  }
}

// ---------------------------------------------------------------------------
// La llamada a la base
// ---------------------------------------------------------------------------

export type CargaHecha = { simulado: boolean; unidades: number; titularesNuevos: number; titularesReutilizados: number }

/** `simular = true` valida en la base sin escribir nada (permiso, inventario vacío, códigos únicos). */
export async function importarInventario(carga: CargaPreparada, simular: boolean): Promise<ResultadoAccion<CargaHecha>> {
  return llamarRpc(
    'fn_importar_inventario',
    { p_unidades: carga.unidades, p_titulares: carga.titulares, p_corte: carga.corte, p_simular: simular },
    (respuesta) => {
      const r = comoRegistro(respuesta)
      if (r === null) return null
      return {
        simulado: r['simulado'] === true,
        unidades: entero(r['unidades']) ?? 0,
        titularesNuevos: entero(r['titulares_nuevos']) ?? 0,
        titularesReutilizados: entero(r['titulares_reutilizados']) ?? 0,
      }
    },
  )
}
