import { supabase } from '@/lib/supabase'
import { booleano, leerLote, monto, texto, type Lote } from '@/lib/lectura'
import type { Rol } from '@/auth/tipos-sesion'

/**
 * Datos de la pantalla Inventario.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ARCHIVO NO PUEDE HACER
 * ---------------------------------------------------------------------------
 * No decide que unidad se puede ofrecer. Eso lo decide `v_unidades_ofrecibles`
 * (03-vistas.sql §7), y la pantalla se limita a obedecerla. Aqui solo se
 * TRADUCE el «no» de esa vista a una frase que un humano pueda leer, usando
 * las banderas que devuelve `v_unidades_tablero`.
 *
 * Si algun dia la explicacion y la vista discreparan, manda la vista: la
 * pantalla apaga la fila igual, y dice que no sabe por que. Preferimos un
 * «no se» a una explicacion inventada — es literalmente la regla de
 * 07-crm\CLAUDE.md §3.
 *
 * ---------------------------------------------------------------------------
 * NINGUNA CIFRA DE NEGOCIO VIVE AQUI
 * ---------------------------------------------------------------------------
 * Ni precios, ni total de unidades, ni areas. El precio de una unidad no es un
 * numero en esta tabla: es `precio_parametro`, un PUNTERO a una fila de
 * `parametros`, que a su vez cita su archivo de 00-fuente-de-verdad. Por eso el
 * formulario de alta ofrece un desplegable de parametros y no una casilla
 * donde escribir soles.
 */

// ---------------------------------------------------------------------------
// El aviso permanente
// ---------------------------------------------------------------------------

/**
 * Texto literal del aviso que encabeza la pantalla. Se guarda aqui, y no
 * suelto en el JSX, porque es una afirmacion sobre el estado del negocio y
 * tiene fuente: si manana el plano aparece y las cifras se reconcilian, se
 * cambia en un sitio y se sabe cual.
 *
 * Fuente: D:\SCPCMO\00-fuente-de-verdad\inventario-maestro.md
 * (las 4 cifras en conflicto — 478 / 473 / 474 / 120 — estan citadas tambien
 * en el comentario de la tabla `unidades`, 01-schema.sql seccion 2).
 */
export const AVISO_INVENTARIO_BLOQUEADO =
  'El inventario maestro está bloqueado: falta el plano vigente y hay 4 cifras en conflicto. ' +
  'Solo se pueden ofrecer las unidades verificadas una por una.'

export const FUENTE_INVENTARIO = '00-fuente-de-verdad/inventario-maestro.md'

/**
 * Roles que pueden dar de alta o editar una unidad.
 *
 * ESTO NO ES SEGURIDAD: es comodidad, igual que src/auth/secciones.ts. Se
 * COPIA de la politica `unidades_escribir` de 02-rls.sql —
 * `es(array['direccion','administracion'])`, que a su vez viene del Acta
 * 03-O02 («Rosa es responsable de mantener el inventario»). Quien impide de
 * verdad la escritura es RLS, en el servidor. Aqui solo se evita dibujar un
 * formulario que iba a fallar al guardar.
 */
export const ROLES_QUE_MANTIENEN_INVENTARIO: readonly Rol[] = ['direccion', 'administracion']

export function puedeMantenerInventario(rol: Rol | null): boolean {
  return rol !== null && ROLES_QUE_MANTIENEN_INVENTARIO.includes(rol)
}

/** Tope de filas por consulta. Si se alcanza, la pantalla lo dice. */
export const LIMITE_UNIDADES = 1000

// ---------------------------------------------------------------------------
// Los dos semaforos de cada fila
// ---------------------------------------------------------------------------

/**
 * SEMAFORO 2 · estado del dato. Es literal: `unidades.estado_dato` ES el enum
 * `semaforo` de 01-schema.sql, con el significado que fija la tabla de
 * 07-crm\CLAUDE.md §3. Aqui no se interpreta nada, solo se pone el simbolo.
 */
export const SEMAFORO_DATO = {
  verde: { simbolo: '🟢', etiqueta: 'Verificada contra plano' },
  amarillo: { simbolo: '🟡', etiqueta: 'Por validar' },
  rojo: { simbolo: '🔴', etiqueta: 'Sin verificar' },
  azul: { simbolo: '🔵', etiqueta: 'Propuesta' },
  negro: { simbolo: '⚫', etiqueta: 'Histórico' },
} as const

export type Semaforo = keyof typeof SEMAFORO_DATO

export const SEMAFOROS: readonly Semaforo[] = ['verde', 'amarillo', 'rojo', 'azul', 'negro']

export function esSemaforo(valor: unknown): valor is Semaforo {
  return typeof valor === 'string' && (SEMAFOROS as readonly string[]).includes(valor)
}

/**
 * SEMAFORO 1 · estado comercial.
 *
 * 🔵 PROPUESTA — a diferencia del anterior, este NO es un enum semaforo en la
 * base: `unidades.estado_comercial` es el enum `estado_unidad`, que tiene siete
 * valores y ningun color asociado. El simbolo de aqui es una LECTURA, y
 * responde a una sola pregunta, la que se hace quien mira el inventario:
 *
 *     ¿se puede ofrecer hoy?
 *
 *   🟢 libre · 🟡 bloqueo temporal · ⚫ ya colocada · 🔴 fuera de venta
 *
 * Por eso el simbolo NUNCA va solo: al lado va siempre la palabra exacta del
 * enum. La palabra es el dato; el simbolo es la urgencia. Y por eso una unidad
 * `contratada` sale en ⚫ y no en rojo: esta fuera de la oferta, que no es lo
 * mismo que estar mal.
 *
 * Sin ratificar por Direccion. Si Walter prefiere otra lectura, se cambia esta
 * tabla y no hay que tocar la base.
 */
export const ESTADOS_UNIDAD = [
  { valor: 'disponible', etiqueta: 'Disponible', simbolo: '🟢' },
  { valor: 'reservada_temporal', etiqueta: 'Reservada temporal', simbolo: '🟡' },
  { valor: 'separada', etiqueta: 'Separada', simbolo: '⚫' },
  { valor: 'contratada', etiqueta: 'Contratada', simbolo: '⚫' },
  { valor: 'pagada', etiqueta: 'Pagada', simbolo: '⚫' },
  { valor: 'entregada', etiqueta: 'Entregada', simbolo: '⚫' },
  { valor: 'no_disponible', etiqueta: 'No disponible', simbolo: '🔴' },
] as const

export type EstadoUnidad = (typeof ESTADOS_UNIDAD)[number]['valor']

export function esEstadoUnidad(valor: unknown): valor is EstadoUnidad {
  return (
    typeof valor === 'string' && ESTADOS_UNIDAD.some((e) => e.valor === valor)
  )
}

/** Estado comercial desconocido: se muestra crudo, no se maquilla. */
export function leerEstadoComercial(valor: string): { etiqueta: string; simbolo: string } {
  const conocido = ESTADOS_UNIDAD.find((e) => e.valor === valor)
  return conocido ?? { etiqueta: valor, simbolo: '❔' }
}

// ---------------------------------------------------------------------------
// La fila
// ---------------------------------------------------------------------------

export type Unidad = {
  id: string
  codigoUnidad: string
  tipo: string | null
  /** `numeric` de Postgres: se conserva como llega (ver src/lib/lectura.ts). */
  areaM2: number | string | null
  etapa: string | null
  bloque: string | null
  ubicacion: string | null
  estadoComercial: string
  estadoDato: string
  fuentePlano: string | null
  /** Puntero a `parametros.id`. NUNCA un precio. */
  precioParametro: string | null
  tipoSocio: string | null
  estadoLegal: string | null
  observaciones: string | null
  actualizadoEl: string | null

  /** LA respuesta, tal cual la da `v_unidades_ofrecibles`. */
  ofrecible: boolean | null
  /** Los motivos. Solo explican; no deciden. */
  verificadaContraPlano: boolean | null
  disponibleComercialmente: boolean | null
  tieneAsignacionActiva: boolean | null
  tieneSeparacionViva: boolean | null
}

const COLUMNAS_UNIDAD =
  'id, codigo_unidad, tipo, area_m2, etapa, bloque, ubicacion, estado_comercial, ' +
  'estado_dato, fuente_plano, precio_parametro, tipo_socio, estado_legal, observaciones, ' +
  'actualizado_el, ofrecible, verificada_contra_plano, disponible_comercialmente, ' +
  'tiene_asignacion_activa, tiene_separacion_viva'

function interpretarUnidad(fila: unknown): Unidad | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const codigoUnidad = texto(f['codigo_unidad'])
  const estadoComercial = texto(f['estado_comercial'])
  const estadoDato = texto(f['estado_dato'])
  if (id === null || codigoUnidad === null) return null
  if (estadoComercial === null || estadoDato === null) return null

  return {
    id,
    codigoUnidad,
    tipo: texto(f['tipo']),
    areaM2: monto(f['area_m2']),
    etapa: texto(f['etapa']),
    bloque: texto(f['bloque']),
    ubicacion: texto(f['ubicacion']),
    estadoComercial,
    estadoDato,
    fuentePlano: texto(f['fuente_plano']),
    precioParametro: texto(f['precio_parametro']),
    tipoSocio: texto(f['tipo_socio']),
    estadoLegal: texto(f['estado_legal']),
    observaciones: texto(f['observaciones']),
    actualizadoEl: texto(f['actualizado_el']),
    ofrecible: booleano(f['ofrecible']),
    verificadaContraPlano: booleano(f['verificada_contra_plano']),
    disponibleComercialmente: booleano(f['disponible_comercialmente']),
    tieneAsignacionActiva: booleano(f['tiene_asignacion_activa']),
    tieneSeparacionViva: booleano(f['tiene_separacion_viva']),
  }
}

/**
 * ¿Se puede seleccionar esta unidad para asignarla?
 *
 * `ofrecible === true` y nada mas. Un `null` (la vista no devolvio la bandera,
 * o llego con una forma que este cliente no reconoce) cuenta como NO: ante la
 * duda, en la defensa contra la doble asignacion se falla cerrado.
 */
export function esSeleccionable(u: Unidad): boolean {
  return u.ofrecible === true
}

/**
 * Por que esta unidad no se puede ofrecer, en frases sueltas.
 *
 * Devuelve TODOS los motivos que apliquen, no el primero: una unidad puede
 * estar a la vez sin verificar y ya asignada, y arreglar solo uno de los dos
 * no la desbloquea. Que la pantalla los liste todos ahorra un viaje.
 */
export function motivosNoOfrecible(u: Unidad): string[] {
  if (esSeleccionable(u)) return []

  const motivos: string[] = []

  if (u.verificadaContraPlano === false) {
    motivos.push('sin verificar contra plano')
  }
  if (u.tieneAsignacionActiva === true) {
    motivos.push('ya tiene una asignación activa')
  }
  if (u.tieneSeparacionViva === true) {
    motivos.push('tiene una separación viva (pendiente de verificar o verificada)')
  }
  if (u.disponibleComercialmente === false) {
    motivos.push(
      `su estado comercial es «${leerEstadoComercial(u.estadoComercial).etiqueta}», no «Disponible»`,
    )
  }

  if (motivos.length === 0) {
    // La vista dice que no, y ninguna bandera lo explica. Se dice tal cual.
    motivos.push(
      'la base la excluye de v_unidades_ofrecibles y este cliente no sabe por qué. ' +
        'No se ofrece hasta saberlo',
    )
  }

  return motivos
}

/**
 * Traduce el error de Postgres. Solo lo que se conoce con certeza; el resto se
 * muestra crudo.
 */
function mensajeDeError(mensaje: string): string {
  if (mensaje.includes('v_unidades_tablero') || mensaje.includes('v_unidades_ofrecibles')) {
    return (
      'Falta ejecutar 02-codigo\\sql\\08-vistas-embudo-e-inventario.sql en Supabase. ' +
      'Sin esa vista la pantalla no puede saber qué unidad se puede ofrecer, y no va a adivinarlo.'
    )
  }
  if (mensaje.includes('verde_exige_plano')) {
    return (
      'La base rechazó el guardado: una unidad no puede declararse 🟢 verificada sin decir ' +
      'contra qué plano. Rellena «Fuente del plano» o baja el estado del dato.'
    )
  }
  if (mensaje.includes('unidades_codigo_unidad_key') || mensaje.includes('duplicate key')) {
    return 'Ya existe una unidad con ese código. Los códigos son únicos.'
  }
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level')) {
    return (
      'Tu rol no puede escribir en el inventario (política unidades_escribir de RLS: solo ' +
      'dirección y administración). Habla con Walter o con Rosa.'
    )
  }
  if (mensaje.includes('JWT') || mensaje.includes('sesión activa')) {
    return 'Se cerró tu sesión. Vuelve a entrar al CRM.'
  }
  return mensaje
}

export async function cargarUnidades(): Promise<Lote<Unidad>> {
  const { data, error } = await supabase
    .from('v_unidades_tablero')
    .select(COLUMNAS_UNIDAD)
    .order('codigo_unidad', { ascending: true })
    .limit(LIMITE_UNIDADES)

  if (error !== null) throw new Error(mensajeDeError(error.message))
  return leerLote(data, interpretarUnidad)
}

// ---------------------------------------------------------------------------
// Unidades ofrecibles — el selector de la pantalla de separaciones
// ---------------------------------------------------------------------------

export type UnidadOfrecible = {
  id: string
  codigoUnidad: string
  tipo: string | null
  areaM2: number | string | null
}

function interpretarOfrecible(fila: unknown): UnidadOfrecible | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const codigoUnidad = texto(f['codigo_unidad'])
  if (id === null || codigoUnidad === null) return null

  return {
    id,
    codigoUnidad,
    tipo: texto(f['tipo']),
    areaM2: monto(f['area_m2']),
  }
}

/**
 * Las unidades que se pueden ofrecer, leidas de `v_unidades_ofrecibles`.
 *
 * Se consulta LA VISTA, no la tabla con un filtro: es la unica definicion de
 * «que se puede ofrecer» (Acta 03-O02) y reconstruirla aqui con un par de
 * `.eq()` seria tener dos criterios que un dia van a discrepar. Lo que esta
 * lista devuelve es lo unico que el formulario de separacion puede ofrecer.
 */
export async function cargarUnidadesOfrecibles(): Promise<Lote<UnidadOfrecible>> {
  const { data, error } = await supabase
    .from('v_unidades_ofrecibles')
    .select('id, codigo_unidad, tipo, area_m2')
    .order('codigo_unidad', { ascending: true })
    .limit(LIMITE_UNIDADES)

  if (error !== null) throw new Error(mensajeDeError(error.message))
  return leerLote(data, interpretarOfrecible)
}

// ---------------------------------------------------------------------------
// Alta y edicion
// ---------------------------------------------------------------------------

/** Lo que escribe el formulario. Todo cadena: es lo que dan los `<input>`. */
export type DatosUnidad = {
  codigoUnidad: string
  tipo: string
  areaM2: string
  etapa: string
  bloque: string
  ubicacion: string
  estadoComercial: EstadoUnidad
  estadoDato: Semaforo
  fuentePlano: string
  /** Id de `parametros`, o cadena vacia. Nunca un importe. */
  precioParametro: string
  observaciones: string
}

export type CampoUnidad = keyof DatosUnidad

export type ResultadoGuardado =
  | { ok: true; id: string }
  | { ok: false; motivo: string; campo?: CampoUnidad }

/** Cadena vacia -> null. Un campo en blanco es «no hay dato», no una cadena. */
function oNulo(valor: string): string | null {
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

/**
 * Comprobaciones previas.
 *
 * La de `verde` + `fuente_plano` es un ESPEJO de la restriccion
 * `verde_exige_plano` (08-vistas-embudo-e-inventario.sql §3), no un sustituto:
 * esta ahorra el viaje a la red, aquella es la que de verdad lo impide. Si
 * alguna vez discrepan, gana la base y el mensaje de error lo dira.
 */
function validar(datos: DatosUnidad): { motivo: string; campo: CampoUnidad } | null {
  if (datos.codigoUnidad.trim() === '') {
    return { motivo: 'El código de la unidad es obligatorio.', campo: 'codigoUnidad' }
  }
  if (datos.tipo.trim() === '') {
    return { motivo: 'El tipo es obligatorio (puesto, tienda… según el plano).', campo: 'tipo' }
  }

  const area = datos.areaM2.trim()
  if (area !== '') {
    const n = Number(area.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) {
      return { motivo: 'El área debe ser un número mayor que cero, o quedarse vacía.', campo: 'areaM2' }
    }
  }

  if (datos.estadoDato === 'verde' && datos.fuentePlano.trim() === '') {
    return {
      motivo:
        'Para marcarla 🟢 verificada hay que decir contra qué plano se verificó. ' +
        'Sin eso, «verificada» no es comprobable por nadie (restricción verde_exige_plano).',
      campo: 'fuentePlano',
    }
  }

  return null
}

function aFila(datos: DatosUnidad): Record<string, string | number | null> {
  const area = datos.areaM2.trim()
  return {
    codigo_unidad: datos.codigoUnidad.trim(),
    tipo: datos.tipo.trim(),
    area_m2: area === '' ? null : Number(area.replace(',', '.')),
    etapa: oNulo(datos.etapa),
    bloque: oNulo(datos.bloque),
    ubicacion: oNulo(datos.ubicacion),
    estado_comercial: datos.estadoComercial,
    estado_dato: datos.estadoDato,
    fuente_plano: oNulo(datos.fuentePlano),
    precio_parametro: oNulo(datos.precioParametro),
    observaciones: oNulo(datos.observaciones),
  }
}

/**
 * Da de alta o actualiza una unidad.
 *
 * `id === null` es alta. Igual que en el embudo, el `.select()` no es
 * decoracion: con RLS, un `update` que no encaja en la politica devuelve 200 y
 * cero filas, sin error. Sin comprobarlo, la pantalla diria «guardado» sobre
 * una base que no cambio.
 *
 * Nada se borra (R8): para retirar una unidad se usa `archivado_el`, y eso no
 * se hace desde este formulario.
 */
export async function guardarUnidad(
  datos: DatosUnidad,
  id: string | null,
): Promise<ResultadoGuardado> {
  const fallo = validar(datos)
  if (fallo !== null) return { ok: false, motivo: fallo.motivo, campo: fallo.campo }

  const fila = aFila(datos)

  const { data, error } =
    id === null
      ? await supabase.from('unidades').insert(fila).select('id')
      : await supabase.from('unidades').update(fila).eq('id', id).select('id')

  if (error !== null) return { ok: false, motivo: mensajeDeError(error.message) }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no guardó nada y tampoco devolvió un error: tu rol no puede escribir en el ' +
        'inventario (política unidades_escribir de RLS).',
    }
  }

  const guardadoId = texto((data[0] as Record<string, unknown>)['id'])
  if (guardadoId === null) {
    return {
      ok: false,
      motivo: 'Se guardó, pero la base devolvió una respuesta que este cliente no reconoce.',
    }
  }

  return { ok: true, id: guardadoId }
}

/** Los valores del formulario cuando se abre para dar de alta. */
export function unidadEnBlanco(): DatosUnidad {
  return {
    codigoUnidad: '',
    tipo: '',
    areaM2: '',
    etapa: '',
    bloque: '',
    ubicacion: '',
    // Una unidad nace como la hace nacer 01-schema.sql: no disponible y con el
    // dato en rojo. Nada entra al inventario dandose por bueno.
    estadoComercial: 'no_disponible',
    estadoDato: 'rojo',
    fuentePlano: '',
    precioParametro: '',
    observaciones: '',
  }
}

/** Los valores del formulario cuando se abre para editar una fila existente. */
export function unidadAFormulario(u: Unidad): DatosUnidad {
  return {
    codigoUnidad: u.codigoUnidad,
    tipo: u.tipo ?? '',
    areaM2: u.areaM2 === null ? '' : String(u.areaM2),
    etapa: u.etapa ?? '',
    bloque: u.bloque ?? '',
    ubicacion: u.ubicacion ?? '',
    // Si la base trae un valor que este cliente no conoce (alguien amplio el
    // enum sin actualizar la interfaz), el formulario cae al valor mas cerrado
    // en vez de mostrar uno inventado. Es un cambio visible: quien edite lo
    // vera en el desplegable antes de guardar.
    estadoComercial: esEstadoUnidad(u.estadoComercial) ? u.estadoComercial : 'no_disponible',
    estadoDato: esSemaforo(u.estadoDato) ? u.estadoDato : 'rojo',
    fuentePlano: u.fuentePlano ?? '',
    precioParametro: u.precioParametro ?? '',
    observaciones: u.observaciones ?? '',
  }
}
