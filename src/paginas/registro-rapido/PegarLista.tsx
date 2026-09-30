import { useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Copy,
  Loader2,
  PhoneCall,
  Search,
  UserCheck,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent } from '@/componentes/ui/card'
import { claseCampo, claseCampoCompacto } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { TarjetaConPie } from '@/componentes/marca/Superficies'
import { GrupoChips, GrupoChipsMultiple, type OpcionChip } from '@/componentes/crm/GrupoChips'
import { cn } from '@/lib/utils'
import { cargarEquipo } from '@/lib/contacto'
import {
  MAXIMO_FILAS_LOTE,
  analizarLista,
  marcarRepetidos,
  registrarLote,
  validarFilaLista,
  type ComunLote,
  type FilaLista,
  type ResultadoFilaLote,
  type ResultadoLote,
} from '@/lib/lote'
import {
  RUTA_COLA_SELECCION,
  canalConsentimientoLive,
  prepararCola,
  type ContextoRegistro,
} from './ConfiguracionSesion'

/**
 * PEGAR LISTA — los 50 leads del live, de una vez.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE (SPEC §0)
 * ---------------------------------------------------------------------------
 * El 28/09 llegaron 50 leads de un TikTok Live y nadie pudo cargarlos rapido:
 * de uno en uno son 25 minutos en el mejor caso. El objetivo aqui es que un
 * vendedor pegue la lista tal como la tenga (notas del celular, un chat de
 * WhatsApp, Excel o Google Sheets) y en MENOS DE 3 MINUTOS queden guardados,
 * sin duplicados, asignados, y con la cola de llamadas lista.
 *
 * ---------------------------------------------------------------------------
 * LOS TRES PASOS, Y POR QUE SON TRES
 * ---------------------------------------------------------------------------
 *  1. ANALIZAR (en el navegador, instantaneo): `analizarLista` separa nombre,
 *     telefono, @usuario y nota, y `marcarRepetidos` marca los repetidos de la
 *     propia lista. Se ve que entendio el CRM ANTES de tocar la base, y cada
 *     celda de nombre y telefono se corrige ahi mismo.
 *  2. VALIDAR CON LA BASE (`p_simular = true`, no escribe nada): quien es
 *     nuevo, quien ya existe y quien ya tiene dueño — el dueño lo sabe la
 *     base, no el navegador, porque RLS no deja ver las fichas de otros.
 *  3. GUARDAR: cada fila en su propia subtransaccion (una mala no tumba el
 *     lote, SPEC §4.5). Las que fallan se quedan en la vista para corregirlas;
 *     las guardadas ya no se reenvian.
 * «Guardar» solo se habilita si la validacion corresponde EXACTAMENTE a lo que
 * se ve (misma lista, misma sesion): si algo cambio despues, hay que volver a
 * validar. Guardar sobre una validacion vieja es guardar a ciegas.
 *
 * ---------------------------------------------------------------------------
 * CONSENTIMIENTO DEL LOTE (SPEC §3 · Ley 29733)
 * ---------------------------------------------------------------------------
 * `registrarLote` envia `consentimiento: true` para todo el lote. Eso solo es
 * cierto si el vendedor lo declara: por eso la casilla de declaracion es
 * OBLIGATORIA antes de llamar a la base, incluso para validar. La frase queda
 * guardada en cada persona (`fuente_del_dato`) con el nombre de la campaña, y
 * el canal ('tiktok_live'…) en `consentimiento_canal`. La version del aviso de
 * privacidad sigue '[PENDIENTE]', igual que en fn_registro_rapido. 🟡
 */

/** La frase de la declaracion, tal cual la pide SPEC §7 S6 para un live. */
const DECLARACION_LIVE =
  'Confirmo que cada persona de esta lista dejó sus datos por iniciativa propia (comentario o mensaje en el live) para que la contactemos sobre Mercado Media Luna.'

/** La misma declaracion cuando el origen del lote no es un live. */
const DECLARACION_OTRO_ORIGEN =
  'Confirmo que cada persona de esta lista dejó sus datos por iniciativa propia (comentario, mensaje o formulario) para que la contactemos sobre Mercado Media Luna.'

/** Tope de `consentimiento_evidencia` en fn_registrar_prospecto (SPEC §4.5). Limite tecnico. */
const MAXIMO_EVIDENCIA = 300

/** Objetivo del encargo (SPEC §0 / orden de trabajo): 50 leads en menos de 3 minutos. */
const OBJETIVO_LOTE_SEGUNDOS = 3 * 60

/** Mismos prefijos que usan lote.ts y fn_registrar_lote para los repetidos. */
const PREFIJO_REPETIDO = 'Repetido en esta lista'

const FALTA_RED = 'Falta la red del @usuario: elígela en la sesión o usa una campaña con plataforma'

/** Tres lineas de ejemplo con los formatos que se ven en la practica (lote.ts, analizarLista). */
const EJEMPLO = [
  'Rosa Quispe 987 654 321 - quiere puesto',
  '@juanito_mml 912 345 678 Juan',
  'Carmen Huamán, +51 999 888 777',
].join('\n')

type EstadoFila =
  | { tipo: 'listo' }
  | { tipo: 'error'; motivo: string }
  | { tipo: 'repetido'; motivo: string }
  | { tipo: 'nuevo'; guardada: boolean }
  | { tipo: 'ya_existe'; guardada: boolean }
  | { tipo: 'tiene_dueno'; nombre: string; guardada: boolean }

type Filtro = 'todas' | 'errores'

const FILTROS: readonly OpcionChip<Filtro>[] = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'errores', etiqueta: 'Solo con error' },
]

type CampoEditable = 'nombre' | 'telefono'

function claveBorrador(indice: number, campo: CampoEditable): string {
  return `${indice}:${campo}`
}

function formatoDuracion(segundos: number): string {
  const s = Math.round(segundos)
  const m = Math.floor(s / 60)
  return m === 0 ? `${s} s` : `${m} min ${String(s % 60).padStart(2, '0')} s`
}

/** Errores locales de una fila, con la falta de red que añadiria `registrarLote`. */
function erroresLocales(f: FilaLista, redSocial: string | null): string[] {
  return f.usuarioRed !== null && redSocial === null ? [...f.errores, FALTA_RED] : f.errores
}

function estadoDeResultado(r: ResultadoFilaLote, guardada: boolean, nombres: ReadonlyMap<string, string>): EstadoFila {
  if (!r.ok) {
    const motivo = r.motivo ?? 'La base no aceptó esta fila.'
    return motivo.startsWith(PREFIJO_REPETIDO) ? { tipo: 'repetido', motivo } : { tipo: 'error', motivo }
  }
  if (r.responsableOtro) {
    const nombre = (r.responsableId === null ? undefined : nombres.get(r.responsableId)) ?? 'otra persona'
    return { tipo: 'tiene_dueno', nombre, guardada }
  }
  return r.accion === 'creada' ? { tipo: 'nuevo', guardada } : { tipo: 'ya_existe', guardada }
}

export function PegarLista({
  contexto,
  yoId,
  alGuardar,
}: {
  contexto: ContextoRegistro
  /** Perfil de quien registra: la cola se arma con SUS leads. */
  yoId: string | null
  /** Cuantos leads se guardaron (para el contador de la sesion). */
  alGuardar: (cuantos: number) => void
}) {
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const equipo = useQuery({ queryKey: ['equipo'], queryFn: cargarEquipo, staleTime: 5 * 60 * 1000 })
  const nombres: ReadonlyMap<string, string> = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre]))

  const [texto, setTexto] = useState('')
  const [filas, setFilas] = useState<FilaLista[] | null>(null)
  /** Lo que se esta escribiendo en una celda; se aplica al salir de ella (ver `confirmarCelda`). */
  const [borradores, setBorradores] = useState<Readonly<Record<string, string>>>({})
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [declaracion, setDeclaracion] = useState(false)
  const [repartir, setRepartir] = useState<string[]>([])

  /** Ultimo resultado de la base por fila (validacion o guardado). Se borra al editar la fila. */
  const [resultados, setResultados] = useState<ReadonlyMap<number, ResultadoFilaLote>>(new Map())
  /** La sesion (lo comun) con la que se obtuvieron esos resultados. */
  const [comunDeResultados, setComunDeResultados] = useState<string | null>(null)
  /** Firma de lo que se valido. Guardar exige que coincida con lo que se ve ahora. */
  const [firmaValidada, setFirmaValidada] = useState<string | null>(null)
  /** Filas ya guardadas de verdad: no se editan ni se reenvian. */
  const [guardadas, setGuardadas] = useState<ReadonlyMap<number, ResultadoFilaLote>>(new Map())
  const [ultimoGuardado, setUltimoGuardado] = useState<{ lote: ResultadoLote; segundos: number | null } | null>(
    null,
  )

  const [ocupado, setOcupado] = useState<'validando' | 'guardando' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorCola, setErrorCola] = useState<string | null>(null)

  /** Desde que se analizo la lista, para medir el objetivo de los 3 minutos. */
  const inicio = useRef<number | null>(null)
  const refVistaPrevia = useRef<HTMLHeadingElement>(null)

  // ---- Lo comun del lote -----------------------------------------------------

  const campanaNombre = contexto.campana?.nombre ?? null
  const esLive = contexto.origen === 'live'
  const fraseDeclaracion = esLive ? DECLARACION_LIVE : DECLARACION_OTRO_ORIGEN
  const canal = esLive ? canalConsentimientoLive(contexto.campana?.plataforma ?? null) : `lista_${contexto.origen}`
  const comun: ComunLote = {
    origen: contexto.origen,
    campanaId: contexto.campanaId,
    responsableId: contexto.responsableId,
    repartirEntre: repartir,
    fechaIngreso: contexto.fechaIngreso,
    consentimientoCanal: canal,
    consentimientoEvidencia: `${fraseDeclaracion}${campanaNombre === null ? '' : ` Campaña: ${campanaNombre}.`}`.slice(
      0,
      MAXIMO_EVIDENCIA,
    ),
    lanzamiento: contexto.campana?.lanzamiento ?? null,
    redSocial: contexto.redSocial,
  }
  const firmaComun = JSON.stringify(comun)

  const pendientes = (filas ?? []).filter((f) => !guardadas.has(f.indice))
  const firmaActual = JSON.stringify([
    firmaComun,
    pendientes.map((f) => [f.indice, f.nombre, f.telefonoE164, f.usuarioRed, f.nota, f.errores.length]),
  ])
  const resultadosVigentes = comunDeResultados === firmaComun
  const validacionVigente = firmaValidada !== null && firmaValidada === firmaActual

  function estadoDe(f: FilaLista): EstadoFila {
    const guardada = guardadas.get(f.indice)
    if (guardada !== undefined) return estadoDeResultado(guardada, true, nombres)
    const locales = erroresLocales(f, contexto.redSocial)
    if (locales.length > 0) {
      const repetido = locales.find((e) => e.startsWith(PREFIJO_REPETIDO))
      return repetido !== undefined ? { tipo: 'repetido', motivo: repetido } : { tipo: 'error', motivo: locales.join(' · ') }
    }
    const r = resultadosVigentes ? resultados.get(f.indice) : undefined
    return r === undefined ? { tipo: 'listo' } : estadoDeResultado(r, false, nombres)
  }

  // ---- Conteos -----------------------------------------------------------------

  const estados = (filas ?? []).map((f) => ({ fila: f, estado: estadoDe(f) }))
  const pendientesEstados = estados.filter((e) => !guardadas.has(e.fila.indice))
  const conErrorLocal = pendientes.filter((f) => erroresLocales(f, contexto.redSocial).length > 0).length
  const listas = pendientes.length - conErrorLocal
  const aGuardar = validacionVigente
    ? pendientesEstados.filter((e) => e.estado.tipo === 'nuevo' || e.estado.tipo === 'ya_existe' || e.estado.tipo === 'tiene_dueno').length
    : 0
  const visibles =
    filtro === 'errores' ? estados.filter((e) => e.estado.tipo === 'error' || e.estado.tipo === 'repetido') : estados
  const demasiadas = listas > MAXIMO_FILAS_LOTE

  // ---- Acciones ----------------------------------------------------------------

  function reiniciar(): void {
    setFilas(null)
    setBorradores({})
    setFiltro('todas')
    setResultados(new Map())
    setComunDeResultados(null)
    setFirmaValidada(null)
    setGuardadas(new Map())
    setUltimoGuardado(null)
    setError(null)
    setErrorCola(null)
    inicio.current = null
  }

  function analizar(): void {
    reiniciar()
    const analizadas = marcarRepetidos(analizarLista(texto))
    if (analizadas.length === 0) {
      setError('No se encontró ninguna fila. Pega la lista (una persona por línea) y vuelve a analizar.')
      return
    }
    setFilas(analizadas)
    inicio.current = Date.now()
    // Al preview: en el móvil queda debajo del pliegue y hay que saber que salió.
    window.requestAnimationFrame(() => refVistaPrevia.current?.focus())
  }

  function alTeclaTexto(e: KeyboardEvent<HTMLTextAreaElement>): void {
    // Ctrl/Cmd + Enter analiza sin soltar el teclado; Enter solo es salto de línea.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      analizar()
    }
  }

  function olvidarResultado(indice: number): void {
    if (!resultados.has(indice)) return
    const nuevo = new Map(resultados)
    nuevo.delete(indice)
    setResultados(nuevo)
  }

  /**
   * La celda se aplica al SALIR de ella (blur o Enter), no en cada tecla:
   * `validarFilaLista` limpia bordes y espacios, y aplicarla mientras se
   * escribe se comeria el espacio entre nombre y apellido.
   */
  function confirmarCelda(f: FilaLista, campo: CampoEditable): void {
    const clave = claveBorrador(f.indice, campo)
    const valor = borradores[clave]
    if (valor === undefined) return
    const resto: Record<string, string> = { ...borradores }
    delete resto[clave]
    setBorradores(resto)
    const actual = campo === 'nombre' ? f.nombre : f.telefonoOriginal
    if (valor === actual) return

    const base = {
      indice: f.indice,
      linea: f.linea,
      nombre: f.nombre,
      telefonoOriginal: f.telefonoOriginal,
      usuarioRed: f.usuarioRed,
      nota: f.nota,
    }
    const corregida = validarFilaLista(
      campo === 'nombre' ? { ...base, nombre: valor } : { ...base, telefonoOriginal: valor },
    )
    setFilas((previas) =>
      previas === null ? previas : marcarRepetidos(previas.map((p) => (p.indice === f.indice ? corregida : p))),
    )
    olvidarResultado(f.indice)
  }

  function quitar(f: FilaLista): void {
    // Solo sale de ESTA vista previa (no es un dato guardado): nada se borra de la base.
    setFilas((previas) => (previas === null ? previas : marcarRepetidos(previas.filter((p) => p.indice !== f.indice))))
    olvidarResultado(f.indice)
  }

  async function enviar(simular: boolean): Promise<void> {
    if (ocupado !== null) return
    setError(null)
    setErrorCola(null)
    if (!declaracion) {
      setError('Marca la declaración de consentimiento del lote: sin ella no se envía ningún dato (Ley 29733).')
      return
    }
    if (contexto.fechaFutura) {
      setError('La hora del ingreso de la sesión está en el futuro: corrígela arriba.')
      return
    }

    setOcupado(simular ? 'validando' : 'guardando')
    const firma = firmaActual
    const r = await registrarLote(pendientes, comun, simular)
    setOcupado(null)

    if (!r.ok) {
      setError(r.motivo)
      return
    }

    const porFila = new Map<number, ResultadoFilaLote>()
    for (const fila of r.datos.filas) porFila.set(fila.indice, fila)

    if (simular) {
      setResultados(porFila)
      setComunDeResultados(firmaComun)
      setFirmaValidada(firma)
      return
    }

    // Guardado de verdad: las que entraron pasan a `guardadas` y ya no se
    // reenvian; las que fallaron se quedan con su motivo para corregirlas.
    const nuevasGuardadas = new Map(guardadas)
    const fallidas = new Map<number, ResultadoFilaLote>()
    let entraron = 0
    for (const [indice, fila] of porFila) {
      if (fila.ok) {
        nuevasGuardadas.set(indice, fila)
        entraron += 1
      } else fallidas.set(indice, fila)
    }
    setGuardadas(nuevasGuardadas)
    setResultados(fallidas)
    setComunDeResultados(firmaComun)
    setFirmaValidada(null)
    setUltimoGuardado({
      lote: r.datos,
      segundos: inicio.current === null ? null : (Date.now() - inicio.current) / 1000,
    })
    alGuardar(entraron)
    // SPEC §8: lo que cuenta leads se vuelve a pedir. 'bandeja' tambien: un
    // lead web sin dueño que venia en la lista pasa a tener dueño.
    for (const clave of ['hoy', 'cartera', 'embudo', 'bandeja']) {
      void cliente.invalidateQueries({ queryKey: [clave] })
    }
  }

  // ---- La cola -------------------------------------------------------------------

  const guardadasOk = [...guardadas.values()].filter((g) => g.ok && g.oportunidadId !== null)
  // A la cola van los leads de QUIEN registra. Los que tienen otro dueño no se
  // llaman desde aqui (ya recibio el aviso en su ficha), y los repartidos a
  // otra persona los vera esa persona en su propio Modo llamadas.
  const idsCola = guardadasOk
    .filter((g) => !g.responsableOtro && (g.responsableId === null || g.responsableId === yoId))
    .map((g) => g.oportunidadId)
    .filter((id): id is string => id !== null)
  const deOtros = guardadasOk.filter((g) => !g.responsableOtro && g.responsableId !== null && g.responsableId !== yoId)
  const conDueno = guardadasOk.filter((g) => g.responsableOtro).length

  function empezarALlamar(): void {
    if (!prepararCola(idsCola)) {
      setErrorCola(
        'Este navegador no deja preparar la cola (almacenamiento bloqueado). Abre Modo llamadas → «Nuevos»: ahí están.',
      )
      return
    }
    navegar(RUTA_COLA_SELECCION)
  }

  // ---- Pantalla ------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* ---- 1 · PEGAR ---- */}
      <Card>
        <CardContent className="space-y-3 p-5 sm:p-6">
          <Label htmlFor="rr-lista" className="flex items-center gap-2 text-base font-black">
            <ClipboardList className="h-4 w-4 text-suelo-500" strokeWidth={1.75} aria-hidden="true" />
            Pega la lista
          </Label>
          <p id="rr-lista-ayuda" className="text-sm text-suelo-700">
            Una persona por línea, como venga: de las notas del celular, de un chat o copiada de Excel o Google
            Sheets (con cabecera «nombre», «teléfono», «usuario», «nota» también vale). Nada se guarda hasta el
            último paso.
          </p>
          <textarea
            id="rr-lista"
            aria-describedby="rr-lista-ayuda"
            className={cn(claseCampo, 'h-auto min-h-48 py-2 font-normal')}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alTeclaTexto}
            placeholder={EJEMPLO}
            spellCheck={false}
            rows={8}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="lg" disabled={texto.trim() === '' || ocupado !== null} onClick={analizar}>
              <Search aria-hidden="true" />
              Analizar
            </Button>
            <span className="text-xs text-suelo-500">Ctrl + Enter también analiza.</span>
          </div>
        </CardContent>
      </Card>

      {error !== null && filas === null && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      {filas !== null && (
        <>
          {/* ---- 2 · REVISAR ---- */}
          <section aria-labelledby="rr-vista-previa" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2
                  id="rr-vista-previa"
                  ref={refVistaPrevia}
                  tabIndex={-1}
                  className="text-lg font-black text-foreground focus:outline-none"
                >
                  Lo que entendió el CRM
                </h2>
                <p className="text-sm text-suelo-700" aria-live="polite">
                  {filas.length} {filas.length === 1 ? 'fila' : 'filas'} · {listas} listas
                  {conErrorLocal > 0 && ` · ${conErrorLocal} con error (no se envían)`}
                  {guardadas.size > 0 && ` · ${guardadas.size} ya guardadas`}
                </p>
              </div>
              <GrupoChips etiqueta="Mostrar" etiquetaOculta opciones={FILTROS} valor={filtro} alCambiar={(v) => setFiltro(v ?? 'todas')} compacto />
            </div>

            <p className="text-xs text-suelo-500">
              Corrige el nombre o el teléfono tocando la celda. El estado se actualiza al salir de ella.
            </p>

            {/* Cabecera de columnas: solo desde `sm`, en el móvil cada fila es una tarjeta. */}
            <div
              aria-hidden="true"
              className="hidden px-3 text-xs font-bold text-suelo-500 sm:grid sm:grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,12rem)_2.75rem] sm:gap-3"
            >
              <span>#</span>
              <span>Nombre</span>
              <span>Teléfono / @usuario</span>
              <span>Estado</span>
              <span />
            </div>

            <ol className="space-y-2">
              {visibles.map(({ fila, estado }) => (
                <FilaVistaPrevia
                  key={fila.indice}
                  fila={fila}
                  estado={estado}
                  bloqueada={guardadas.has(fila.indice) || ocupado !== null}
                  borradorNombre={borradores[claveBorrador(fila.indice, 'nombre')]}
                  borradorTelefono={borradores[claveBorrador(fila.indice, 'telefono')]}
                  alEscribir={(campo, valor) =>
                    setBorradores((b) => ({ ...b, [claveBorrador(fila.indice, campo)]: valor }))
                  }
                  alConfirmar={(campo) => confirmarCelda(fila, campo)}
                  alQuitar={() => quitar(fila)}
                />
              ))}
            </ol>
            {visibles.length === 0 && (
              <p className="rounded-md border border-border p-4 text-sm text-suelo-700">
                Ninguna fila con error. Pasa al paso 3.
              </p>
            )}
          </section>

          {/* ---- 3 · DECLARAR, VALIDAR Y GUARDAR ---- */}
          {pendientes.length > 0 && (
            <TarjetaConPie
              nota={
                ocupado === 'validando'
                  ? 'Preguntando a la base, fila por fila…'
                  : ocupado === 'guardando'
                    ? 'Guardando: cada fila en su propia transacción…'
                    : validacionVigente
                      ? 'Validado. Guardar crea persona, oportunidad y tarea por fila; las filas con error no se envían.'
                      : firmaValidada !== null
                        ? 'Cambió la lista o la sesión después de validar: vuelve a validar.'
                        : 'Validar no guarda nada: pregunta a la base quién es nuevo, quién ya existe y quién tiene dueño.'
              }
              acciones={
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outlineCal"
                    className="h-12"
                    disabled={ocupado !== null || listas === 0 || demasiadas}
                    onClick={() => void enviar(true)}
                  >
                    {ocupado === 'validando' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                    Validar con la base
                  </Button>
                  <Button
                    type="button"
                    variant="ambar"
                    size="lg"
                    disabled={ocupado !== null || !validacionVigente || !declaracion || aGuardar === 0}
                    onClick={() => void enviar(false)}
                    className="disabled:bg-azul-600 disabled:text-azul-300 disabled:opacity-100"
                  >
                    {ocupado === 'guardando' ? (
                      <>
                        <Loader2 className="animate-spin" aria-hidden="true" />
                        Guardando…
                      </>
                    ) : (
                      `Guardar ${aGuardar} ${aGuardar === 1 ? 'lead' : 'leads'}`
                    )}
                  </Button>
                </div>
              }
            >
              <div className="space-y-5">
                {/* La declaración: obligatoria ANTES de llamar a la base
                    (registrarLote envía consentimiento:true). La etiqueta entera
                    es la zona táctil. */}
                <label
                  htmlFor="rr-declaracion"
                  className={cn(
                    'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3',
                    error !== null && !declaracion ? 'border-alerta' : 'border-border',
                  )}
                >
                  <input
                    id="rr-declaracion"
                    type="checkbox"
                    checked={declaracion}
                    onChange={(e) => setDeclaracion(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-input accent-azul"
                  />
                  <span className="text-sm leading-snug">
                    {fraseDeclaracion}
                    <span className="mt-1 block text-xs text-suelo-500">
                      Obligatorio (Ley 29733). Se guarda en cada persona
                      {campanaNombre === null ? '' : `, con la campaña «${campanaNombre}»`}, canal{' '}
                      <code>{canal}</code>. 🟡 La versión del aviso de privacidad sigue [PENDIENTE].
                    </span>
                  </span>
                </label>

                {equipo.isSuccess && equipo.data.length > 1 && (
                  <div className="space-y-1.5">
                    <GrupoChipsMultiple
                      etiqueta="Repartir los nuevos entre (opcional)"
                      opciones={equipo.data.map((m) => ({ valor: m.id, etiqueta: m.nombre }))}
                      valores={repartir}
                      alCambiar={setRepartir}
                      compacto
                    />
                    <p className="text-xs text-suelo-500">
                      Por turnos, solo los leads nuevos. Los que ya tienen dueño siguen con el suyo; los que ya
                      existían sin dueño quedan a cargo de quien elegiste en la sesión.
                    </p>
                  </div>
                )}

                {demasiadas && (
                  <p role="alert" className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                    Son {listas} filas y el máximo por envío es {MAXIMO_FILAS_LOTE}. Pártela en dos listas.
                  </p>
                )}
                {error !== null && (
                  <p role="alert" className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                    {error}
                  </p>
                )}
                {validacionVigente && (
                  <ResumenValidacion estados={pendientesEstados.map((e) => e.estado)} />
                )}
              </div>
            </TarjetaConPie>
          )}

          {/* ---- 4 · RESULTADO Y COLA ---- */}
          {ultimoGuardado !== null && (
            <section aria-live="polite" className="space-y-3 rounded-lg bg-azul p-5 text-cal sm:p-6">
              <h2 className="text-base font-black text-cal">
                {ultimoGuardado.lote.creadas + ultimoGuardado.lote.reutilizadas} guardados
                {ultimoGuardado.segundos !== null && (
                  <span className="ml-2 text-sm font-normal text-cal/70">
                    en {formatoDuracion(ultimoGuardado.segundos)}
                    {ultimoGuardado.segundos > OBJETIVO_LOTE_SEGUNDOS &&
                      ` · sobre el objetivo de ${formatoDuracion(OBJETIVO_LOTE_SEGUNDOS)}`}
                  </span>
                )}
              </h2>
              <p className="text-sm text-cal/80">
                {ultimoGuardado.lote.creadas} nuevos · {ultimoGuardado.lote.reutilizadas} ya existían
                {ultimoGuardado.lote.conError > 0 && ` · ${ultimoGuardado.lote.conError} con error (siguen arriba para corregirlos)`}
              </p>
              {conDueno > 0 && (
                <p className="text-sm text-cal/80">
                  {conDueno} ya {conDueno === 1 ? 'la lleva' : 'las llevan'} otra persona: se le avisó en su ficha y no
                  cambió de dueño.
                </p>
              )}
              {deOtros.length > 0 && (
                <p className="text-sm text-cal/80">
                  {deOtros.length} quedaron a cargo de otras personas del equipo: los verán en su Modo llamadas.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {idsCola.length > 0 && (
                  <Button type="button" variant="ambar" size="lg" onClick={empezarALlamar}>
                    <PhoneCall aria-hidden="true" />
                    Empezar a llamarlos ({idsCola.length})
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outlineCal"
                  className="h-12"
                  onClick={() => {
                    reiniciar()
                    setTexto('')
                    setDeclaracion(false)
                  }}
                >
                  Empezar otra lista
                </Button>
              </div>
              {errorCola !== null && (
                <p role="alert" className="rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta">
                  {errorCola}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Una fila de la vista previa
// ---------------------------------------------------------------------------

function FilaVistaPrevia({
  fila,
  estado,
  bloqueada,
  borradorNombre,
  borradorTelefono,
  alEscribir,
  alConfirmar,
  alQuitar,
}: {
  fila: FilaLista
  estado: EstadoFila
  bloqueada: boolean
  borradorNombre: string | undefined
  borradorTelefono: string | undefined
  alEscribir: (campo: CampoEditable, valor: string) => void
  alConfirmar: (campo: CampoEditable) => void
  alQuitar: () => void
}) {
  const numero = fila.indice + 1
  const alTecla = (campo: CampoEditable) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      alConfirmar(campo)
    }
  }
  const claseCelda = cn(claseCampoCompacto, 'h-11 sm:h-9')

  return (
    <li className="rounded-md border border-border bg-card p-3 sm:grid sm:grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,12rem)_2.75rem] sm:items-start sm:gap-3">
      {/* El número lleva la línea original en el `title`: de dónde salió cada dato. */}
      <span className="text-xs font-bold tabular-nums text-suelo-500 sm:pt-2" title={fila.linea}>
        <span className="sm:hidden">Fila </span>
        {numero}
      </span>

      <div className="mt-1 sm:mt-0">
        <input
          aria-label={`Nombre (fila ${numero})`}
          className={claseCelda}
          value={borradorNombre ?? fila.nombre}
          readOnly={bloqueada}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => alEscribir('nombre', e.target.value)}
          onBlur={() => alConfirmar('nombre')}
          onKeyDown={alTecla('nombre')}
        />
      </div>

      <div className="mt-2 sm:mt-0">
        <input
          aria-label={`Teléfono (fila ${numero})`}
          className={claseCelda}
          type="tel"
          inputMode="tel"
          value={borradorTelefono ?? fila.telefonoOriginal}
          readOnly={bloqueada}
          autoComplete="off"
          placeholder={fila.usuarioRed === null ? 'Teléfono' : 'Sin teléfono'}
          onChange={(e) => alEscribir('telefono', e.target.value)}
          onBlur={() => alConfirmar('telefono')}
          onKeyDown={alTecla('telefono')}
        />
        {fila.usuarioRed !== null && <p className="mt-1 text-xs text-suelo-700">@{fila.usuarioRed}</p>}
      </div>

      <div className="mt-2 sm:mt-0 sm:pt-2">
        <EstadoVisible estado={estado} />
      </div>

      <div className="mt-2 flex justify-end sm:mt-0">
        {!bloqueada && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 sm:h-9 sm:w-9"
            aria-label={`Quitar la fila ${numero} de la lista (no se guarda)`}
            title="Quitar de la lista"
            onClick={alQuitar}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>

      {fila.nota !== '' && (
        <p className="mt-2 text-xs text-suelo-700 sm:col-span-5 sm:col-start-2 sm:mt-0">Nota: {fila.nota}</p>
      )}
    </li>
  )
}

/** Estado = texto + icono de línea + peso (sin colores de semáforo, SPEC §2). */
function EstadoVisible({ estado }: { estado: EstadoFila }) {
  const guardada = 'guardada' in estado && estado.guardada ? 'Guardado · ' : ''
  switch (estado.tipo) {
    case 'listo':
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-suelo-700">
          <Check className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          Listo
        </span>
      )
    case 'error':
      return (
        <span className="inline-flex items-start gap-1.5 text-sm font-bold text-alerta">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          <span>Error: {estado.motivo}</span>
        </span>
      )
    case 'repetido':
      return (
        <span className="inline-flex items-start gap-1.5 text-sm font-bold text-suelo-700">
          <Copy className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>{estado.motivo}</span>
        </span>
      )
    case 'nuevo':
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
          <UserPlus className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {guardada}Nuevo
        </span>
      )
    case 'ya_existe':
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-suelo-700">
          <UserCheck className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {guardada}Ya existe
        </span>
      )
    case 'tiene_dueno':
      return (
        <span className="inline-flex items-start gap-1.5 text-sm font-bold text-suelo-700">
          <UserRound className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>
            {guardada}Tiene dueño: {estado.nombre}
          </span>
        </span>
      )
  }
}

function ResumenValidacion({ estados }: { estados: readonly EstadoFila[] }) {
  const cuenta = (t: EstadoFila['tipo']): number => estados.filter((e) => e.tipo === t).length
  const nuevos = cuenta('nuevo')
  const existen = cuenta('ya_existe')
  const conDueno = cuenta('tiene_dueno')
  const conError = cuenta('error') + cuenta('repetido')
  return (
    <p className="rounded-md border border-border p-3 text-sm text-suelo-700" aria-live="polite">
      <span className="font-bold text-foreground">Validación:</span> {nuevos} nuevos · {existen} ya existen
      {conDueno > 0 && ` · ${conDueno} con dueño (se le avisa, no cambia)`}
      {conError > 0 && ` · ${conError} con error`}. Todavía no se guardó nada.
    </p>
  )
}
