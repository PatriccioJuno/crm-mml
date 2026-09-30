import { supabase } from '@/lib/supabase'
import {
  comoRegistro,
  comoTextos,
  llamarRpc,
  mensajeDeError,
  type ResultadoAccion,
} from '@/lib/acciones'
import { booleano, entero, leerLote, texto } from '@/lib/lectura'
import { ETIQUETAS_RESPUESTA_WEB, type CambiosPerfil } from '@/lib/perfil'
import { normalizarTelefono } from '@/lib/telefono'

/**
 * Registrar prospectos: uno a uno, en lote (la lista del live) o desde el
 * mensaje de WhatsApp que arma la web.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 * ---------------------------------------------------------------------------
 * El 28/09 llegaron 50 leads de un TikTok Live y nadie pudo cargarlos rapido
 * (SPEC §0). El registro rapido de 06 es de uno en uno, con 5 campos fijos y
 * sin campaña ni hora del live. Aqui: se pega la lista tal como viene (de las
 * notas del celular, de Excel, de un CSV), se ve que entendio el CRM antes de
 * guardar, se valida contra la base SIN escribir (`p_simular`), y se guarda.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ARCHIVO NO HACE
 * ---------------------------------------------------------------------------
 *  · No adivina un telefono: lo que no normaliza `normalizarTelefono` queda
 *    como error de esa fila, con su motivo, y no se envia.
 *  · No decide duplicados contra la base: eso lo hace `fn_registrar_prospecto`
 *    con un candado por telefono (SPEC §4.5). Aqui solo se marcan los
 *    repetidos DENTRO de la misma lista, que la base tambien rechazaria.
 *  · No firma el consentimiento por nadie: el lote exige la declaracion del
 *    vendedor (texto de evidencia) y la base la guarda por persona, con la
 *    version del aviso en '[PENDIENTE]' igual que fn_registro_rapido. 🟡
 *  · No contiene ninguna cifra de negocio. El unico numero es el tope de filas
 *    por lote, que es el de la funcion de la base (SPEC §4.5).
 */

// ---------------------------------------------------------------------------
// Listas
// ---------------------------------------------------------------------------

export const PLATAFORMAS_CAMPANA = [
  { valor: 'tiktok', etiqueta: 'TikTok' },
  { valor: 'meta', etiqueta: 'Meta (FB/IG) anuncios' },
  { valor: 'instagram', etiqueta: 'Instagram' },
  { valor: 'facebook', etiqueta: 'Facebook' },
  { valor: 'youtube', etiqueta: 'YouTube' },
  { valor: 'web', etiqueta: 'Web' },
  { valor: 'presencial', etiqueta: 'Presencial' },
  { valor: 'otra', etiqueta: 'Otra' },
] as const

export type PlataformaCampana = (typeof PLATAFORMAS_CAMPANA)[number]['valor']

/** `personas.red_social` (CHECK `personas_red_social_valido`, SPEC §4.2). */
export const REDES_SOCIALES = [
  { valor: 'tiktok', etiqueta: 'TikTok' },
  { valor: 'instagram', etiqueta: 'Instagram' },
  { valor: 'facebook', etiqueta: 'Facebook' },
  { valor: 'youtube', etiqueta: 'YouTube' },
  { valor: 'otra', etiqueta: 'Otra' },
] as const

export type RedSocial = (typeof REDES_SOCIALES)[number]['valor']

/** Tope de `fn_registrar_lote` (SPEC §4.5). Limite tecnico, no de negocio. */
export const MAXIMO_FILAS_LOTE = 500

// ---------------------------------------------------------------------------
// Analizar una lista pegada
// ---------------------------------------------------------------------------

export type FilaLista = {
  /** Posicion en la lista analizada (0 = primera fila de datos). La pantalla muestra indice + 1. */
  indice: number
  /** El texto original de la fila, para que el vendedor vea de donde salio cada dato. */
  linea: string
  nombre: string
  telefonoOriginal: string
  telefonoE164: string | null
  usuarioRed: string | null
  nota: string
  errores: string[]
}

const ERROR_NOMBRE = 'Falta el nombre'
const ERROR_CONTACTO = 'Falta teléfono o @usuario'
const PREFIJO_REPETIDO = 'Repetido en esta lista'

/** Minusculas, sin tildes, sin espacios sobrantes: para comparar lo que escribe una persona. */
function normalizarClave(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** '@Rosita_Ventas' → 'rosita_ventas'; `null` si no tiene el formato que acepta la base. */
function normalizarUsuario(crudo: string): string | null {
  const u = crudo.trim().replace(/^@+/, '').toLowerCase()
  return /^[a-z0-9._]{2,40}$/.test(u) ? u : null
}

/** Quita separadores y comillas sueltas de los bordes y junta espacios. */
function limpiarBordes(s: string): string {
  return s
    .replace(/^[\s\-–—,;:|/·•*"']+/, '')
    .replace(/[\s\-–—,;:|/·•*"']+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Rehace los datos derivados de una fila (telefono normalizado y errores) a
 * partir de lo que tiene escrito. Se usa al analizar y cada vez que el
 * vendedor corrige una celda en la vista previa, para que el estado de la
 * fila nunca se quede con el diagnostico de antes de la correccion.
 * Los errores de «repetido» los pone `marcarRepetidos`, no esta funcion.
 */
export function validarFilaLista(f: {
  indice: number
  linea: string
  nombre: string
  telefonoOriginal: string
  usuarioRed: string | null
  nota: string
}): FilaLista {
  const nombre = limpiarBordes(f.nombre)
  const telefonoOriginal = f.telefonoOriginal.trim()
  const usuarioRed = f.usuarioRed === null ? null : normalizarUsuario(f.usuarioRed)
  const errores: string[] = []

  if (nombre === '') errores.push(ERROR_NOMBRE)

  let telefonoE164: string | null = null
  if (telefonoOriginal !== '') {
    const t = normalizarTelefono(telefonoOriginal)
    if (t.ok) telefonoE164 = t.e164
    else errores.push(t.motivo)
  } else if (usuarioRed === null) {
    errores.push(ERROR_CONTACTO)
  }

  if (f.usuarioRed !== null && f.usuarioRed.trim() !== '' && usuarioRed === null) {
    errores.push(`«${f.usuarioRed.trim()}» no parece un @usuario válido (letras, números, punto o guion bajo)`)
  }

  return {
    indice: f.indice,
    linea: f.linea,
    nombre,
    telefonoOriginal,
    telefonoE164,
    usuarioRed,
    nota: f.nota.replace(/\s+/g, ' ').trim(),
    errores,
  }
}

// --- CSV -------------------------------------------------------------------

type ColumnaConocida = 'nombre' | 'apellidos' | 'telefono' | 'usuario' | 'nota'

/**
 * Nombres de columna que se reconocen en una cabecera (ya normalizados: sin
 * tildes, minusculas, espacios como '_'). Incluye los de la plantilla
 * 05-datos/plantillas-csv/captura-dia-0.csv y los que pone Excel por costumbre.
 */
const COLUMNAS_CONOCIDAS: Readonly<Record<string, ColumnaConocida>> = {
  nombre: 'nombre',
  nombres: 'nombre',
  nombre_completo: 'nombre',
  nombre_y_apellido: 'nombre',
  nombre_y_apellidos: 'nombre',
  name: 'nombre',
  cliente: 'nombre',
  contacto: 'nombre',
  apellido: 'apellidos',
  apellidos: 'apellidos',
  telefono: 'telefono',
  telefonos: 'telefono',
  telefono_e164: 'telefono',
  celular: 'telefono',
  cel: 'telefono',
  movil: 'telefono',
  whatsapp: 'telefono',
  numero: 'telefono',
  phone: 'telefono',
  tel: 'telefono',
  usuario: 'usuario',
  usuario_red: 'usuario',
  tiktok: 'usuario',
  instagram: 'usuario',
  handle: 'usuario',
  user: 'usuario',
  cuenta: 'usuario',
  '@': 'usuario',
  arroba: 'usuario',
  nota: 'nota',
  notas: 'nota',
  comentario: 'nota',
  comentarios: 'nota',
  observacion: 'nota',
  observaciones: 'nota',
  detalle: 'nota',
  mensaje: 'nota',
}

function claveColumna(celda: string): string {
  return normalizarClave(celda.replace(/^"|"$/g, '')).replace(/[^a-z0-9@_ ]/g, '').trim().replace(/ /g, '_')
}

/**
 * Columna de una cabecera: primero por nombre exacto; si no, por lo que
 * contiene («Número de celular», «Usuario TikTok», «Comentario del live»).
 * El orden importa: «nombre de usuario» es usuario, no nombre.
 */
function columnaDeTitulo(titulo: string): ColumnaConocida | null {
  const clave = claveColumna(titulo)
  const exacta = COLUMNAS_CONOCIDAS[clave]
  if (exacta !== undefined) return exacta
  if (/usuario|tiktok|instagram|^@/.test(clave)) return 'usuario'
  if (/telefono|celular|whatsapp|movil/.test(clave)) return 'telefono'
  if (/apellido/.test(clave)) return 'apellidos'
  if (/nombre/.test(clave)) return 'nombre'
  if (/nota|coment|observ/.test(clave)) return 'nota'
  return null
}

type FilaCsv = { celdas: string[]; linea: string }

/**
 * CSV al estilo RFC 4180 / Excel: campos entre comillas con el separador,
 * comillas dobles («""») o saltos de linea dentro. Devuelve cada registro con
 * su texto original (para `linea`).
 */
function parsearCsv(texto: string, separador: string): FilaCsv[] {
  const filas: FilaCsv[] = []
  let celdas: string[] = []
  let celda = ''
  let entreComillas = false
  let inicio = 0

  const cerrarFila = (fin: number): void => {
    celdas.push(celda)
    filas.push({ celdas, linea: texto.slice(inicio, fin) })
    celdas = []
    celda = ''
  }

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charAt(i)
    if (entreComillas) {
      if (c === '"') {
        if (texto.charAt(i + 1) === '"') {
          celda += '"'
          i += 1
        } else entreComillas = false
      } else celda += c
      continue
    }
    if (c === '"' && celda.trim() === '') {
      celda = ''
      entreComillas = true
    } else if (c === separador) {
      celdas.push(celda)
      celda = ''
    } else if (c === '\n') {
      cerrarFila(i)
      inicio = i + 1
    } else celda += c
  }
  if (celda !== '' || celdas.length > 0) cerrarFila(texto.length)
  return filas
}

type Cabecera = { separador: string; columnas: (ColumnaConocida | null)[]; titulos: string[] }

/**
 * ¿La primera linea es una cabecera? Lo es si, partida por tabulador, punto y
 * coma o coma (en ese orden: Excel copia con tabulador, el CSV peruano va con
 * «;» y el de Google con «,»), nombra una columna de nombre y una de telefono
 * o de usuario. Si no, la lista se lee como lineas libres.
 */
function detectarCabecera(primera: string): Cabecera | null {
  for (const separador of ['\t', ';', ',']) {
    if (!primera.includes(separador)) continue
    const titulos = primera.split(separador).map((t) => t.trim().replace(/^"|"$/g, ''))
    const columnas = titulos.map(columnaDeTitulo)
    const tieneNombre = columnas.includes('nombre')
    const tieneContacto = columnas.includes('telefono') || columnas.includes('usuario')
    if (tieneNombre && tieneContacto) return { separador, columnas, titulos }
  }
  return null
}

function filasDesdeCsv(cuerpo: string, cabecera: Cabecera): FilaLista[] {
  const resultado: FilaLista[] = []
  const registros = parsearCsv(cuerpo, cabecera.separador)

  for (const registro of registros) {
    if (registro.celdas.every((c) => c.trim() === '')) continue

    const partes: Record<ColumnaConocida, string[]> = {
      nombre: [],
      apellidos: [],
      telefono: [],
      usuario: [],
      nota: [],
    }
    const extras: string[] = []
    registro.celdas.forEach((valor, i) => {
      const v = valor.trim()
      if (v === '') return
      const col = cabecera.columnas[i] ?? null
      if (col === null) {
        // Una columna que no se reconoce no se tira: va a la nota con su titulo.
        const titulo = cabecera.titulos[i] ?? ''
        extras.push(titulo === '' ? v : `${titulo}: ${v}`)
      } else partes[col].push(v)
    })

    const usuario = partes.usuario[0] ?? ''
    resultado.push(
      validarFilaLista({
        indice: resultado.length,
        linea: registro.linea.trim(),
        nombre: [...partes.nombre, ...partes.apellidos].join(' '),
        telefonoOriginal: partes.telefono[0] ?? '',
        usuarioRed: usuario === '' ? null : usuario,
        nota: [...partes.nota, ...partes.telefono.slice(1), ...extras].join(' · '),
      }),
    )
  }
  return resultado
}

// --- Lineas libres ---------------------------------------------------------

/**
 * Tramos que pueden ser un telefono: empiezan y acaban en digito, con
 * espacios, guiones, puntos o parentesis entre medio.
 */
const TRAMO_TELEFONO = /\+?\(?\d[\d \t\-.()]*\d\)?/g

const PARTICULAS = ['de', 'del', 'la', 'las', 'los', 'y', 'san', 'e']

/**
 * Parte «Juan Pérez quiere tienda» en nombre y resto, cuando no hay un
 * separador explicito: el nombre son las palabras iniciales en Mayuscula
 * (con «de», «la», «del»… entre medio). Si todo esta en minusculas o todo en
 * mayusculas no hay pista, y todo se toma como nombre: el vendedor lo corrige
 * en la vista previa, que para eso esta.
 */
function partirNombre(segmento: string): { nombre: string; resto: string } {
  const palabras = segmento.split(' ').filter((p) => p !== '')
  const conMayuscula = (p: string): boolean => /^\p{Lu}/u.test(p)
  const hayMayusculas = palabras.some(conMayuscula)
  const hayMinusculas = palabras.some((p) => /^\p{Ll}/u.test(p) && !PARTICULAS.includes(p))
  if (!hayMayusculas || !hayMinusculas) return { nombre: segmento, resto: '' }

  const esParticula = (p: string): boolean => PARTICULAS.includes(p.toLowerCase())
  let fin = 0
  while (fin < palabras.length) {
    const p = palabras[fin] ?? ''
    if (conMayuscula(p)) {
      fin += 1
      continue
    }
    // «de la Cruz»: una o varias particulas seguidas cuentan como nombre solo
    // si despues viene otra palabra en Mayuscula.
    let salto = fin
    while (salto < palabras.length && esParticula(palabras[salto] ?? '')) salto += 1
    if (fin > 0 && salto > fin && conMayuscula(palabras[salto] ?? '')) {
      fin = salto
      continue
    }
    break
  }
  if (fin === 0) return { nombre: segmento, resto: '' }
  return { nombre: palabras.slice(0, fin).join(' '), resto: palabras.slice(fin).join(' ') }
}

/** Separadores explicitos entre nombre y nota: « - », «,», «;», «|», tabulador, « / ». */
const SEPARADOR_SEGMENTO = /\s+[-–—]\s+|\s*[,;|\t]\s*|\s+\/\s+/

function segmentos(s: string): string[] {
  return s
    .split(SEPARADOR_SEGMENTO)
    .map(limpiarBordes)
    .filter((x) => x !== '')
}

function filaDesdeLinea(lineaOriginal: string, indice: number): FilaLista {
  // Viñetas y numeracion de lista («1. », «- », «• »). «\d{1,3}[.)]» no toca un
  // telefono porque exige el punto o el parentesis pegado.
  let resto = lineaOriginal.replace(/^\s*(?:[-*•·]+|\d{1,3}[.)])\s+/, '')

  // @usuario
  let usuarioRed: string | null = null
  const usuario = /(^|[\s,;(])@([A-Za-z0-9._]{2,40})/.exec(resto)
  if (usuario !== null) {
    usuarioRed = usuario[2] ?? null
    const antesDelUsuario = resto.slice(0, usuario.index)
    const despuesDelUsuario = resto.slice(usuario.index + usuario[0].length)
    resto = `${antesDelUsuario}${usuario[1] ?? ''} ${despuesDelUsuario}`
  }

  // Telefono: el tramo con mas digitos, si tiene al menos 9 (un celular
  // peruano). Si no hay ninguno de 9, uno de 7-8 se toma igual para que el
  // error «no es un telefono completo» se vea en vez de perderse en la nota.
  const tramos = [...resto.matchAll(TRAMO_TELEFONO)].map((m) => ({
    texto: m[0],
    inicio: m.index ?? 0,
    digitos: m[0].replace(/\D/g, '').length,
  }))
  const candidatos = tramos.filter((t) => t.digitos >= 9)
  const normalizable = candidatos
    .filter((t) => normalizarTelefono(t.texto).ok)
    .sort((a, b) => b.digitos - a.digitos)[0]
  const elegido =
    normalizable ??
    [...candidatos].sort((a, b) => b.digitos - a.digitos)[0] ??
    tramos.filter((t) => t.digitos >= 7).sort((a, b) => b.digitos - a.digitos)[0]

  let antes = resto
  let despues = ''
  let telefonoOriginal = ''
  if (elegido !== undefined) {
    telefonoOriginal = elegido.texto.trim()
    antes = resto.slice(0, elegido.inicio)
    despues = resto.slice(elegido.inicio + elegido.texto.length)
  }

  // Nombre: lo que va antes del telefono; si no hay nada antes («+51 912…,
  // Luis»), el primer tramo de lo que va despues. El resto es nota.
  const segAntes = segmentos(antes)
  const segDespues = segmentos(despues)
  let nombre = ''
  const notas: string[] = []

  const tomarNombreDe = (seg: string[]): void => {
    const primero = seg[0] ?? ''
    const partido = seg.length === 1 ? partirNombre(primero) : { nombre: primero, resto: '' }
    nombre = partido.nombre
    if (partido.resto !== '') notas.push(partido.resto)
    notas.push(...seg.slice(1))
  }

  if (segAntes.length > 0) {
    tomarNombreDe(segAntes)
    notas.push(...segDespues)
  } else {
    tomarNombreDe(segDespues)
  }

  return validarFilaLista({
    indice,
    linea: lineaOriginal.trim(),
    nombre,
    telefonoOriginal,
    usuarioRed,
    nota: notas.join(' · '),
  })
}

/**
 * Convierte una lista pegada en filas para la vista previa.
 *
 * Acepta (SPEC §6.A):
 *  · CSV/TSV con cabecera (nombre/telefono/usuario/nota y sinonimos; «;», «,»
 *    o tabulador; comillas de Excel; BOM al principio);
 *  · lineas libres: «Juan Pérez 987654321», «María Quispe - 987 654 321 -
 *    quiere tienda», «@rosita_ventas 999888777 Rosa», «+51 912 345 678, Luis».
 * Las lineas en blanco se saltan. Cada fila sale con sus errores; ninguna se
 * «arregla» por su cuenta.
 */
export function analizarLista(texto: string): FilaLista[] {
  const limpio = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lineas = limpio.split('\n')
  const iPrimera = lineas.findIndex((l) => l.trim() !== '')
  if (iPrimera === -1) return []

  const cabecera = detectarCabecera(lineas[iPrimera] ?? '')
  if (cabecera !== null) {
    return filasDesdeCsv(lineas.slice(iPrimera + 1).join('\n'), cabecera)
  }

  const filas: FilaLista[] = []
  for (const linea of lineas) {
    if (linea.trim() === '') continue
    filas.push(filaDesdeLinea(linea, filas.length))
  }
  return filas
}

/**
 * Marca las filas repetidas dentro de la lista (mismo telefono o mismo
 * @usuario). La primera aparicion se queda limpia; las siguientes dicen cual
 * es la original. Idempotente: se puede volver a llamar despues de corregir
 * una celda, porque primero quita las marcas anteriores.
 */
export function marcarRepetidos(filas: FilaLista[]): FilaLista[] {
  const vistos = new Map<string, number>()
  return filas.map((f) => {
    const errores = f.errores.filter((e) => !e.startsWith(PREFIJO_REPETIDO))
    const claves = [
      f.telefonoE164 === null ? null : `tel:${f.telefonoE164}`,
      f.usuarioRed === null ? null : `red:${f.usuarioRed}`,
    ].filter((c): c is string => c !== null)

    let original: number | undefined
    for (const c of claves) {
      const previa = vistos.get(c)
      if (previa !== undefined && original === undefined) original = previa
    }
    for (const c of claves) if (!vistos.has(c)) vistos.set(c, f.indice)

    if (original !== undefined) errores.push(`${PREFIJO_REPETIDO} (fila ${original + 1})`)
    return { ...f, errores }
  })
}

// ---------------------------------------------------------------------------
// Registrar un lote
// ---------------------------------------------------------------------------

export type ComunLote = {
  origen: string
  campanaId: string | null
  responsableId: string | null
  /** Reparto por turnos entre estos perfiles, solo para las oportunidades NUEVAS. */
  repartirEntre: string[]
  /** Hora del live / de ingreso (ISO). `null` = ahora. Con la hora real el SLA no miente. */
  fechaIngreso: string | null
  consentimientoCanal: string
  /** La declaracion del vendedor para todo el lote (+ campaña). Se guarda en `fuente_del_dato`. */
  consentimientoEvidencia: string
  lanzamiento: string | null
  /** Red de los @usuario del lote (la de la campaña). */
  redSocial: string | null
}

export type ResultadoFilaLote = {
  /** Indice de la fila en la lista analizada (FilaLista.indice), no en lo enviado. */
  indice: number
  ok: boolean
  accion: string | null
  motivo: string | null
  personaId: string | null
  oportunidadId: string | null
  responsableId: string | null
  responsableOtro: boolean
}

export type ResultadoLote = {
  simulado: boolean
  /** Todas las filas de la lista, incluidas las que no salieron del navegador por error local. */
  total: number
  validas: number
  /** Errores de la base + errores locales. */
  conError: number
  creadas: number
  reutilizadas: number
  /** Una por fila de la lista, en su orden. */
  filas: ResultadoFilaLote[]
}

/** Solo las claves con dato: un `null` enviado podria leerse en la base como «bórralo». */
function sinVacios(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    r[k] = typeof v === 'string' ? v.trim() : v
  }
  return r
}

function interpretarFilaResultado(
  cruda: unknown,
  indicesEnviados: readonly number[],
): ResultadoFilaLote | null {
  const f = comoRegistro(cruda)
  if (f === null) return null
  const posicion = entero(f['indice'])
  const ok = booleano(f['ok'])
  if (posicion === null || ok === null) return null
  const indice = indicesEnviados[posicion]
  if (indice === undefined) return null
  return {
    indice,
    ok,
    accion: texto(f['accion']),
    motivo: texto(f['motivo']),
    personaId: texto(f['persona_id']),
    oportunidadId: texto(f['oportunidad_id']),
    responsableId: texto(f['responsable_id']),
    responsableOtro: booleano(f['responsable_otro']) === true,
  }
}

/**
 * Valida (`simular = true`, no escribe nada) o guarda un lote.
 *
 * Solo se envian las filas SIN errores locales; las demas vuelven en el
 * resultado con su motivo, para que la pantalla muestre una linea por cada
 * fila pegada. `indice` del resultado es siempre el de la lista original.
 *
 * Una fila mala nunca tumba el lote: la base procesa cada una en su propio
 * bloque `begin … exception` (SPEC §4.5).
 */
export async function registrarLote(
  filas: readonly FilaLista[],
  comun: ComunLote,
  simular: boolean,
): Promise<ResultadoAccion<ResultadoLote>> {
  if (comun.consentimientoCanal.trim() === '' || comun.consentimientoEvidencia.trim() === '') {
    return {
      ok: false,
      motivo: 'Falta la declaración de consentimiento del lote: sin ella no se guarda ningún dato (Ley 29733).',
    }
  }
  if (comun.origen.trim() === '') return { ok: false, motivo: 'Elige el origen del lote.' }

  const locales: ResultadoFilaLote[] = []
  const enviables: FilaLista[] = []
  for (const f of filas) {
    const errores = [...f.errores]
    // La base exige la red junto con el @usuario; sin red elegida, esa fila no puede entrar.
    if (f.usuarioRed !== null && comun.redSocial === null) {
      errores.push('Falta la red del @usuario (elige la red o una campaña con plataforma)')
    }
    if (errores.length > 0) {
      locales.push({
        indice: f.indice,
        ok: false,
        accion: null,
        motivo: errores.join(' · '),
        personaId: null,
        oportunidadId: null,
        responsableId: null,
        responsableOtro: false,
      })
    } else enviables.push(f)
  }

  if (enviables.length === 0) {
    return { ok: false, motivo: 'No hay ninguna fila lista para enviar: corrige los errores de la vista previa.' }
  }
  if (enviables.length > MAXIMO_FILAS_LOTE) {
    return {
      ok: false,
      motivo: `Son ${enviables.length} filas y el máximo por lote es ${MAXIMO_FILAS_LOTE}. Pártelas en dos listas.`,
    }
  }

  const indicesEnviados = enviables.map((f) => f.indice)
  const pFilas = enviables.map((f) =>
    sinVacios({
      nombre: f.nombre,
      telefono: f.telefonoE164,
      usuario_red: f.usuarioRed,
      nota: f.nota,
    }),
  )
  const pComun = sinVacios({
    origen: comun.origen,
    campana_id: comun.campanaId,
    responsable_id: comun.responsableId,
    repartir_entre: comun.repartirEntre,
    fecha_ingreso: comun.fechaIngreso,
    // El vendedor declaro el consentimiento del lote en la pantalla (casilla
    // obligatoria); la base lo vuelve a exigir y lo guarda por persona.
    consentimiento: true,
    consentimiento_canal: comun.consentimientoCanal,
    consentimiento_evidencia: comun.consentimientoEvidencia,
    lanzamiento: comun.lanzamiento,
    red_social: comun.redSocial,
  })

  return llamarRpc(
    'fn_registrar_lote',
    { p_filas: pFilas, p_comun: pComun, p_simular: simular },
    (respuesta): ResultadoLote | null => {
      const r = comoRegistro(respuesta)
      if (r === null || !Array.isArray(r['filas'])) return null
      const validas = entero(r['validas'])
      const conError = entero(r['con_error'])
      const creadas = entero(r['creadas'])
      const reutilizadas = entero(r['reutilizadas'])
      if (validas === null || conError === null || creadas === null || reutilizadas === null) return null

      const remotas: ResultadoFilaLote[] = []
      for (const cruda of r['filas']) {
        const fila = interpretarFilaResultado(cruda, indicesEnviados)
        // Una fila de respuesta ilegible invalida el resultado entero: no se
        // puede decir «guardada» de una fila que no se sabe cual es.
        if (fila === null) return null
        remotas.push(fila)
      }

      return {
        simulado: booleano(r['simulado']) ?? simular,
        total: filas.length,
        validas,
        conError: conError + locales.length,
        creadas,
        reutilizadas,
        filas: [...locales, ...remotas].sort((a, b) => a.indice - b.indice),
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Registrar un prospecto (uno a uno, o desde un mensaje de la web)
// ---------------------------------------------------------------------------

export type DatosProspecto = {
  nombre: string
  /** Como lo escribio el vendedor; se normaliza aqui. Puede ir vacio si hay `usuarioRed`. */
  telefono: string
  usuarioRed?: string | undefined
  redSocial?: string | undefined
  email?: string | undefined
  origen: string
  campanaId?: string | null | undefined
  responsableId?: string | null | undefined
  fechaIngreso?: string | null | undefined
  consentimiento: boolean
  consentimientoCanal: string
  consentimientoEvidencia?: string | undefined
  nota?: string | undefined
  perfil?: CambiosPerfil | undefined
}

export type ProspectoRegistrado = {
  accion: string
  personaId: string
  oportunidadId: string
  tareaVenceEl: string | null
  personaReutilizada: boolean
  oportunidadReutilizada: boolean
  /** La oportunidad ya la lleva otra persona: se le avisó con una interaccion. */
  responsableOtro: boolean
  responsableNombre: string | null
  avisos: string[]
}

function interpretarProspecto(respuesta: unknown): ProspectoRegistrado | null {
  const r = comoRegistro(respuesta)
  if (r === null) return null
  const accion = texto(r['accion'])
  const personaId = texto(r['persona_id'])
  const oportunidadId = texto(r['oportunidad_id'])
  const personaReutilizada = booleano(r['persona_reutilizada'])
  const oportunidadReutilizada = booleano(r['oportunidad_reutilizada'])
  if (
    accion === null ||
    personaId === null ||
    oportunidadId === null ||
    personaReutilizada === null ||
    oportunidadReutilizada === null
  ) {
    return null
  }
  return {
    accion,
    personaId,
    oportunidadId,
    tareaVenceEl: texto(r['tarea_vence_el']),
    personaReutilizada,
    oportunidadReutilizada,
    responsableOtro: booleano(r['responsable_otro']) === true,
    responsableNombre: texto(r['responsable_nombre']),
    avisos: comoTextos(r['avisos']),
  }
}

/**
 * Registra UN prospecto (`fn_registrar_prospecto`): persona + oportunidad +
 * tarea de primer contacto en una transaccion, reutilizando la persona y la
 * oportunidad activa si el telefono (o el @usuario) ya existe — tambien si la
 * lleva otro vendedor, que en ese caso recibe el aviso.
 *
 * El telefono se normaliza aqui primero para no gastar un viaje durante un
 * live; la base lo vuelve a comprobar. Sin telefono solo se admite si hay
 * @usuario (leads de TikTok que solo dejaron su cuenta).
 */
export async function registrarProspecto(d: DatosProspecto): Promise<ResultadoAccion<ProspectoRegistrado>> {
  const nombre = d.nombre.replace(/\s+/g, ' ').trim()
  if (nombre === '') return { ok: false, motivo: 'El nombre es obligatorio.' }

  const usuarioCrudo = d.usuarioRed?.trim() ?? ''
  const usuario = usuarioCrudo === '' ? null : normalizarUsuario(usuarioCrudo)
  if (usuarioCrudo !== '' && usuario === null) {
    return { ok: false, motivo: `«${usuarioCrudo}» no parece un @usuario válido (letras, números, punto o guion bajo).` }
  }
  if (usuario !== null && (d.redSocial ?? '').trim() === '') {
    return { ok: false, motivo: 'Elige la red social del @usuario.' }
  }

  let telefono: string | null = null
  if (d.telefono.trim() === '' && usuario === null) {
    return { ok: false, motivo: 'Falta el teléfono (o, si solo dejó su cuenta, el @usuario).' }
  }
  if (d.telefono.trim() !== '') {
    const t = normalizarTelefono(d.telefono)
    if (!t.ok) return { ok: false, motivo: t.motivo }
    telefono = t.e164
  }

  if (!d.consentimiento) {
    return { ok: false, motivo: 'Sin consentimiento no se puede registrar el dato (Ley 29733).' }
  }
  if (d.origen.trim() === '') return { ok: false, motivo: 'Elige un origen.' }
  if (d.consentimientoCanal.trim() === '') {
    return { ok: false, motivo: 'Falta el canal por el que la persona dio su consentimiento.' }
  }

  const datos = sinVacios({
    nombre,
    telefono,
    usuario_red: usuario,
    red_social: usuario === null ? undefined : d.redSocial,
    email: d.email,
    origen: d.origen,
    campana_id: d.campanaId,
    responsable_id: d.responsableId,
    fecha_ingreso: d.fechaIngreso,
    consentimiento: true,
    consentimiento_canal: d.consentimientoCanal,
    consentimiento_evidencia: d.consentimientoEvidencia,
    nota: d.nota,
  })
  if (d.perfil !== undefined && Object.keys(d.perfil).length > 0) datos['perfil'] = d.perfil

  return llamarRpc('fn_registrar_prospecto', { p_datos: datos, p_simular: false }, interpretarProspecto)
}

// ---------------------------------------------------------------------------
// Mensaje de la web
// ---------------------------------------------------------------------------

export type MensajeWeb = {
  tipo: 'embudo' | 'evento' | 'generico' | 'reclamo' | 'desconocido'
  nombre: string | null
  /** Lo que la web puso entre parentesis: web, anuncio, referido, live, base, página del evento… */
  origenEtiqueta: string | null
  /** Uno de ORIGENES (registro-rapido.ts). */
  origenSugerido: string
  /** Codigos de ETIQUETAS_RESPUESTA_WEB (perfil.ts): { uso: 'operar', … }. */
  respuestas: Record<string, string>
  telefonoE164: string | null
  /**
   * Documento del registro al evento, si la persona lo escribio. Se EXTRAE
   * para que el vendedor sepa que vino, no para guardarlo: el DNI solo se
   * sube cuando hace falta para separar (Ley 29733, dato minimo necesario).
   */
  dni: string | null
  /** Lineas que no se entendieron (la persona pudo editar el texto antes de enviarlo). */
  noReconocido: string[]
}

/**
 * Rotulos de las viñetas (embudo.js ROTULOS, evento.js:598), normalizados.
 * El rotulo del miercoles lleva la fecha («El miércoles 30 de septiembre»),
 * asi que se reconoce aparte.
 */
const ROTULOS_WEB: Readonly<Record<string, string>> = {
  'el puesto': 'uso',
  hoy: 'alquiler',
  'compra previa': 'antes',
  rubro: 'giro',
  'escribo desde': 'zona',
  'me conecto desde': 'zona',
  pago: 'pago',
  decision: 'decide',
  visita: 'visita',
  'este miercoles': 'miercoles',
  asistencia: 'miercoles',
}

/** Textos que la web usa ademas de los de ETIQUETAS_RESPUESTA_WEB (evento.js:578, respaldo sin config). */
const TEXTOS_ALTERNOS: Readonly<Record<string, Record<string, string>>> = {
  miercoles: { 'si, cuenta conmigo': 'si' },
}

/** texto normalizado → codigo, por pregunta. */
function codigoDeRespuesta(clave: string, textoOpcion: string): string | null {
  const buscado = normalizarClave(textoOpcion).replace(/[.!]+$/, '')
  const opciones = ETIQUETAS_RESPUESTA_WEB[clave]?.opciones ?? {}
  for (const [codigo, etiqueta] of Object.entries(opciones)) {
    if (normalizarClave(etiqueta) === buscado) return codigo
  }
  return TEXTOS_ALTERNOS[clave]?.[buscado] ?? null
}

const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']

function claveDeRotulo(rotulo: string): string | null {
  const r = normalizarClave(rotulo)
  const directa = ROTULOS_WEB[r]
  if (directa !== undefined) return directa
  // «El miércoles 30 de septiembre» / «El sábado 10 de octubre»
  if (r.startsWith('el ') && DIAS_SEMANA.some((d) => r.startsWith(`el ${d}`))) return 'miercoles'
  return null
}

/** Etiqueta entre parentesis → origen admitido (origenes_admitidos(), 06-registro-rapido.sql). */
function origenDeEtiqueta(etiqueta: string | null): string {
  switch (normalizarClave(etiqueta ?? '')) {
    case 'anuncio':
      return 'meta_ads'
    case 'referido':
      return 'referido'
    case 'live':
      return 'live'
    case 'base':
      return 'base_historica'
    default:
      // 'web', 'página del evento', una seccion ('inicio', 'pie') o nada.
      return 'organico'
  }
}

/**
 * Lee el mensaje de WhatsApp que arma la web (analisis/web.md §4):
 *
 *   Hola, soy {nombre}. Vengo de la web de Mercado Media Luna ({web|anuncio|…}).
 *   • El puesto: para trabajarlo yo
 *   • Hoy: sí, pago alquiler
 *   …
 *   Mi número: +51…            (solo en el respaldo del modo CRM)
 *
 * tambien el del registro al evento («Quiero registrarme al evento…», con
 * «• DNI: …» opcional), los mensajes fijos de los botones («Hola, vi la web…»,
 * «Hola, vi el plano…», «Hola, vi la página del evento…») y los reclamos
 * («LIBRO DE RECLAMACIONES · …»), que NUNCA son un lead.
 *
 * Todo lo que no encaja va a `noReconocido`: la persona pudo editar el texto
 * antes de enviarlo, y la vista previa se lo enseña al vendedor.
 */
export function analizarMensajeWeb(texto: string): MensajeWeb {
  const limpio = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
  const lineas = limpio.split('\n').map((l) => l.trim()).filter((l) => l !== '')

  const mensaje: MensajeWeb = {
    tipo: 'desconocido',
    nombre: null,
    origenEtiqueta: null,
    origenSugerido: 'organico',
    respuestas: {},
    telefonoE164: null,
    dni: null,
    noReconocido: [],
  }

  if (/^libro de reclamaciones/.test(normalizarClave(limpio))) {
    return { ...mensaje, tipo: 'reclamo' }
  }

  const primera = lineas[0] ?? ''
  let desde = 0
  const presentacion = /^hola,?\s+soy\s+(.+?)\.\s+(vengo de la web|quiero registrarme)/i.exec(primera)
  if (presentacion !== null) {
    mensaje.tipo = /^vengo/i.test(presentacion[2] ?? '') ? 'embudo' : 'evento'
    const nombre = limpiarBordes(presentacion[1] ?? '')
    mensaje.nombre = nombre === '' ? null : nombre
    desde = 1
  } else if (/^hola,?\s+vi\s+(la web|el plano|la pagina del evento)/.test(normalizarClave(primera))) {
    mensaje.tipo = 'generico'
    desde = 1
  }

  if (desde === 1) {
    const etiqueta = /\(([^()]+)\)\.?\s*$/.exec(primera)
    mensaje.origenEtiqueta = etiqueta === null ? null : (etiqueta[1] ?? '').trim()
    mensaje.origenSugerido = origenDeEtiqueta(mensaje.origenEtiqueta)
  }

  for (const linea of lineas.slice(desde)) {
    const numero = /^mi\s+n[uú]mero\s*:\s*(.+)$/i.exec(linea)
    if (numero !== null) {
      const t = normalizarTelefono(numero[1] ?? '')
      if (t.ok) mensaje.telefonoE164 = t.e164
      else mensaje.noReconocido.push(linea)
      continue
    }

    const vineta = /^[•·*-]\s*([^:]+):\s*(.+)$/.exec(linea)
    if (vineta === null) {
      mensaje.noReconocido.push(linea)
      continue
    }
    const rotulo = (vineta[1] ?? '').trim()
    const valor = (vineta[2] ?? '').trim()
    const rotuloNormal = normalizarClave(rotulo)

    if (rotuloNormal === 'dni' || rotuloNormal === 'documento') {
      const doc = valor.replace(/[^0-9A-Za-z]/g, '')
      if (doc !== '') mensaje.dni = doc
      else mensaje.noReconocido.push(linea)
      continue
    }
    if (rotuloNormal === 'mi numero' || rotuloNormal === 'telefono') {
      const t = normalizarTelefono(valor)
      if (t.ok) mensaje.telefonoE164 = t.e164
      else mensaje.noReconocido.push(linea)
      continue
    }

    const clave = claveDeRotulo(rotulo)
    const codigo = clave === null ? null : codigoDeRespuesta(clave, valor)
    if (clave === null || codigo === null) mensaje.noReconocido.push(linea)
    else mensaje.respuestas[clave] = codigo
  }

  return mensaje
}

// ---------------------------------------------------------------------------
// Campañas
// ---------------------------------------------------------------------------

export type Campana = {
  id: string
  nombre: string
  plataforma: string | null
  fechaInicio: string | null
  lanzamiento: string | null
}

function interpretarCampana(fila: unknown): Campana | null {
  const f = comoRegistro(fila)
  if (f === null) return null
  const id = texto(f['id'])
  const nombre = texto(f['nombre'])
  if (id === null || nombre === null) return null
  return {
    id,
    nombre,
    plataforma: texto(f['plataforma']),
    fechaInicio: texto(f['fecha_inicio']),
    lanzamiento: texto(f['lanzamiento']),
  }
}

/**
 * Campañas no archivadas, la mas nueva primero. Lanza error (para useQuery).
 * No se lee `inversion`: la pantalla de registro no la necesita, y un monto
 * que no se usa no tiene por que viajar.
 */
export async function cargarCampanas(): Promise<Campana[]> {
  const { data, error } = await supabase
    .from('campanas')
    .select('id, nombre, plataforma, fecha_inicio, lanzamiento')
    .is('archivado_el', null)
    .order('creado_el', { ascending: false })
    .limit(200)

  if (error !== null) throw new Error(mensajeDeError(error.message))
  return leerLote(data, interpretarCampana).filas
}

/**
 * Busca la campaña por nombre (sin distinguir mayusculas ni espacios) o la
 * crea (`fn_campana_asegurar`). Devuelve su id. La inversion NO se pide ni se
 * escribe: queda nula hasta que alguien la cargue con su fuente.
 */
export async function asegurarCampana(
  nombre: string,
  plataforma: string,
  fecha: string | null,
  lanzamiento: string | null,
): Promise<ResultadoAccion<string>> {
  const limpio = nombre.replace(/\s+/g, ' ').trim()
  if (limpio === '') return { ok: false, motivo: 'Escribe el nombre de la campaña.' }
  if (!PLATAFORMAS_CAMPANA.some((p) => p.valor === plataforma)) {
    return { ok: false, motivo: 'Elige la plataforma de la campaña.' }
  }

  const lanz = lanzamiento?.trim() ?? ''
  return llamarRpc(
    'fn_campana_asegurar',
    {
      p_nombre: limpio,
      p_plataforma: plataforma,
      p_fecha: fecha === null || fecha.trim() === '' ? null : fecha,
      p_lanzamiento: lanz === '' ? null : lanz,
    },
    // `returns uuid` llega como el texto del id (no como objeto).
    (r) => (typeof r === 'string' && r !== '' ? r : null),
  )
}
