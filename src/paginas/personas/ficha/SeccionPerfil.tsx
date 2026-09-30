import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Globe, Loader2, Lock } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { claseCampo } from '@/componentes/ui/input'
import { ChipsSiNo, GrupoChips, GrupoChipsMultiple } from '@/componentes/crm/GrupoChips'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import {
  CANALES_PREFERIDOS,
  CAPITAL_CATEGORIAS,
  DECIDE_CON,
  ETIQUETAS_RESPUESTA_WEB,
  FORMAS_PAGO,
  HORIZONTES,
  MONEDAS_CAPITAL,
  OBJECIONES,
  PREGUNTAS_CUALIFICACION,
  PROPOSITOS,
  RUBROS,
  SITUACIONES_ACTUALES,
  TIPOS_INTERES,
  ZONAS,
  cargarPerfil,
  faltantesCualificacion,
  guardarPerfil,
  sugerenciasDesdeWeb,
  textoMesObjetivo,
  type CambiosPerfil,
  type PerfilComercial,
  type SugerenciaPerfil,
} from '@/lib/perfil'
import { Fallo, invalidarTrasAccion } from './PanelContacto'

/**
 * PERFIL COMERCIAL — lo que el vendedor anota DURANTE la llamada.
 *
 * ===========================================================================
 * QUE PIDIO EL EQUIPO (SPEC §0, 29/09)
 * ===========================================================================
 * «Cuánto capital tiene», «contado o financiado», «tienda o puesto y cuál»,
 * «este mes o el siguiente», «ya tiene puesto / quiere alquilar / invertir».
 * Cada pregunta es un grupo de chips: un toque con el teléfono en la otra
 * mano, y ver todas las respuestas posibles le recuerda qué preguntar
 * (GrupoChips.tsx).
 *
 * ===========================================================================
 * GUARDADO
 * ===========================================================================
 * Cada chip se guarda AL INSTANTE (`guardarPerfil` con solo esa clave), con la
 * respuesta pintada antes de que vuelva la base y deshecha si la base la
 * rechaza. Los textos se guardan al salir del campo o con Intro. No hay botón
 * «Guardar» que olvidar al colgar.
 *
 * Quien escribe es `fn_guardar_perfil` (la tabla no tiene política de
 * escritura): valida con los mismos CHECK, recalcula `mes_objetivo` en hora de
 * Lima y deja el evento R9. Las 4 preguntas de R5 viven en `oportunidades.cal_*`
 * y la restricción `calificado_requiere_las_4_respuestas` las mira ahí.
 *
 * ===========================================================================
 * NINGUNA CIFRA
 * ===========================================================================
 * Las categorías de capital no llevan montos (la inicial es un parámetro de
 * 00-fuente-de-verdad, no una etiqueta). El monto, si la persona lo dice, lo
 * escribe el vendedor con su moneda al lado (R7). «Financiado» registra lo que
 * la persona dijo; las condiciones las define Walter.
 *
 * Lo que llegó del chat de la web se SUGIERE con «Confirmar»; nunca se aplica
 * solo (analisis/web.md §3: «declarado en web · por confirmar»).
 */

// ---------------------------------------------------------------------------
// Estado editable compartido (ficha completa y perfil rápido de la cola)
// ---------------------------------------------------------------------------

/** Clave de `fn_guardar_perfil` → campo de `PerfilComercial` (para pintar antes de que vuelva la base). */
const CAMPO_PERFIL = {
  tipo_interes: 'tipoInteres',
  interes_detalle: 'interesDetalle',
  rubro: 'rubro',
  situacion_actual: 'situacionActual',
  capital_categoria: 'capitalCategoria',
  capital_monto: 'capitalMonto',
  capital_moneda: 'capitalMoneda',
  horizonte_compra: 'horizonteCompra',
  decide_con: 'decideCon',
  zona_procedencia: 'zonaProcedencia',
  objeciones: 'objeciones',
  canal_preferido: 'canalPreferido',
  horario_preferido: 'horarioPreferido',
  proposito: 'proposito',
  forma_pago: 'formaPago',
  decide_solo: 'decideSolo',
  compro_antes: 'compraAntes',
} as const satisfies Partial<Record<keyof CambiosPerfil, keyof PerfilComercial>>

const CAMPOS: Readonly<Record<string, keyof PerfilComercial | undefined>> = CAMPO_PERFIL

type EstadoGrupo = { tipo: 'guardando' } | { tipo: 'guardado' } | { tipo: 'fallo'; motivo: string }

/** Cuánto se ve el «Guardado». Tiempo de interfaz, no del negocio. */
const MS_AVISO_GUARDADO = 2000

function sinCampos(capa: Partial<PerfilComercial>, campos: readonly string[]): Partial<PerfilComercial> {
  const copia: Record<string, unknown> = { ...capa }
  for (const c of campos) delete copia[c]
  return copia as Partial<PerfilComercial>
}

function usePerfilEditable(oportunidadId: string, alGuardar: (() => void) | undefined) {
  const cliente = useQueryClient()
  const consulta = useQuery({
    queryKey: ['perfil', oportunidadId],
    queryFn: () => cargarPerfil(oportunidadId),
  })

  // Lo que se pintó antes de que la base contestara, encima de lo leído.
  const [capa, setCapa] = useState<Partial<PerfilComercial>>({})
  const [estados, setEstados] = useState<Record<string, EstadoGrupo>>({})
  const secuencia = useRef<Record<string, number>>({})
  const contador = useRef(0)
  const temporizadores = useRef<Record<string, number>>({})

  useEffect(() => {
    setCapa({})
    setEstados({})
  }, [oportunidadId])

  useEffect(
    () => () => {
      for (const t of Object.values(temporizadores.current)) window.clearTimeout(t)
    },
    [],
  )

  const perfil: PerfilComercial | null = consulta.data === undefined ? null : { ...consulta.data, ...capa }

  async function guardar(grupo: string, cambios: CambiosPerfil): Promise<boolean> {
    const local: Record<string, unknown> = {}
    for (const [clave, valor] of Object.entries(cambios)) {
      const campo = CAMPOS[clave]
      if (campo !== undefined) local[campo] = valor
    }
    const campos = Object.keys(local)

    // Si se toca dos veces el mismo campo, solo la ÚLTIMA respuesta decide lo
    // que queda pintado: la anterior, al volver, no pisa a la nueva. Se cuenta
    // por CAMPO (lo pintado) y por GRUPO (el «Guardando… / Guardado»).
    const n = (contador.current += 1)
    for (const c of campos) secuencia.current[c] = n
    secuencia.current[`grupo:${grupo}`] = n
    setCapa((c) => ({ ...c, ...(local as Partial<PerfilComercial>) }))
    setEstados((e) => ({ ...e, [grupo]: { tipo: 'guardando' } }))

    const r = await guardarPerfil(oportunidadId, cambios)
    const vigentes = campos.filter((c) => secuencia.current[c] === n)
    const grupoVigente = secuencia.current[`grupo:${grupo}`] === n

    if (!r.ok) {
      // Se deshace lo pintado (si nadie lo cambió después) y se dice por qué,
      // siempre: un fallo no se esconde aunque haya otro guardado en curso.
      setCapa((c) => sinCampos(c, vigentes))
      setEstados((e) => ({ ...e, [grupo]: { tipo: 'fallo', motivo: r.motivo } }))
      return false
    }

    cliente.setQueryData<PerfilComercial>(['perfil', oportunidadId], (viejo) =>
      viejo === undefined
        ? viejo
        : {
            ...viejo,
            ...(local as Partial<PerfilComercial>),
            ...('horizonte_compra' in cambios ? { mesObjetivo: r.datos.mesObjetivo } : {}),
          },
    )
    setCapa((c) => sinCampos(c, vigentes))
    if (grupoVigente) {
      setEstados((e) => ({ ...e, [grupo]: { tipo: 'guardado' } }))
      const previo = temporizadores.current[grupo]
      if (previo !== undefined) window.clearTimeout(previo)
      temporizadores.current[grupo] = window.setTimeout(() => {
        setEstados((e) => {
          const copia = { ...e }
          if (copia[grupo]?.tipo === 'guardado') delete copia[grupo]
          return copia
        })
      }, MS_AVISO_GUARDADO)
    }
    // La temperatura y el medidor de R5 de la cartera dependen del perfil.
    invalidarTrasAccion(cliente, [['perfil', oportunidadId]])
    alGuardar?.()
    return true
  }

  return { consulta, perfil, estados, guardar }
}

/** Un valor de la base, estrechado a una opción conocida (o `null`: la pantalla dice que no lo reconoce). */
function enLista<T extends string>(opciones: readonly { valor: T }[], v: string | null): T | null {
  return opciones.find((o) => o.valor === v)?.valor ?? null
}

function EstadoGuardado({ estado }: { estado: EstadoGrupo | undefined }) {
  if (estado === undefined) return null
  if (estado.tipo === 'guardando') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-suelo-500">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Guardando…
      </span>
    )
  }
  if (estado.tipo === 'guardado') {
    return (
      <span role="status" className="inline-flex items-center gap-1 text-xs font-bold text-suelo-700">
        <Check className="h-3 w-3" aria-hidden="true" />
        Guardado
      </span>
    )
  }
  return null
}

/** Un grupo del perfil: la pregunta, su estado de guardado y, si falló, por qué. */
function Grupo({
  estado,
  children,
  nota,
  className,
}: {
  estado: EstadoGrupo | undefined
  children: ReactNode
  nota?: ReactNode | undefined
  className?: string | undefined
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {children}
      <div className="flex min-h-4 flex-wrap items-center gap-2">
        <EstadoGuardado estado={estado} />
      </div>
      {nota}
      {estado?.tipo === 'fallo' && <Fallo className="p-2 text-xs">{estado.motivo}</Fallo>}
    </div>
  )
}

function ValorRaro({ valor, lista }: { valor: string | null; lista: readonly { valor: string }[] }) {
  if (valor === null || lista.some((o) => o.valor === valor)) return null
  return <p className="text-xs text-suelo-700">Guardado en la base: «{valor}» (esta pantalla no lo reconoce).</p>
}

/**
 * Un texto que se guarda al salir del campo o con Intro. Mientras no se toca,
 * sigue a lo que dice la base; mientras se escribe, manda lo escrito.
 */
function CampoTexto({
  etiqueta,
  valor,
  alConfirmar,
  deshabilitado,
  placeholder,
  inputMode,
}: {
  etiqueta: string
  valor: string | null
  alConfirmar: (v: string) => void
  deshabilitado: boolean
  placeholder?: string | undefined
  inputMode?: 'text' | 'decimal' | undefined
}) {
  const id = useId()
  const [borrador, setBorrador] = useState(valor ?? '')
  const [editando, setEditando] = useState(false)

  useEffect(() => {
    if (!editando) setBorrador(valor ?? '')
  }, [valor, editando])

  function confirmar(): void {
    setEditando(false)
    if (borrador.trim() !== (valor ?? '').trim()) alConfirmar(borrador)
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-bold text-suelo">
        {etiqueta}
      </label>
      <input
        id={id}
        value={borrador}
        inputMode={inputMode}
        placeholder={placeholder}
        disabled={deshabilitado}
        onFocus={() => setEditando(true)}
        onChange={(e) => setBorrador(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        className={claseCampo}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Medidor de cualificación (R5)
// ---------------------------------------------------------------------------

function MedidorCualificacion({ perfil }: { perfil: PerfilComercial }) {
  const faltan = faltantesCualificacion(perfil)
  const total = PREGUNTAS_CUALIFICACION.length
  const respondidas = total - faltan.length

  return (
    <div className="space-y-1.5">
      <p className="text-sm text-foreground">
        <span className="font-bold">
          Cualificación {respondidas} de {total}
        </span>
        {faltan.length === 0 ? (
          <span className="text-suelo-700"> · completa: ya puede pasar a Calificado (R5)</span>
        ) : (
          <span className="text-suelo-700"> · falta: {faltan.join(' · ')}</span>
        )}
      </p>
      <div className="flex gap-1" aria-hidden="true">
        {PREGUNTAS_CUALIFICACION.map((q, i) => (
          <span key={q.clave} className={cn('h-1.5 flex-1 rounded-full', i < respondidas ? 'bg-azul' : 'bg-cal-300')} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bloques reutilizados por las dos vistas
// ---------------------------------------------------------------------------

type Editable = ReturnType<typeof usePerfilEditable>

function PreguntaInteres({ e, p, deshabilitado, compacto }: { e: Editable; p: PerfilComercial; deshabilitado: boolean; compacto: boolean }) {
  const tipo = enLista(TIPOS_INTERES, p.tipoInteres)
  return (
    <Grupo
      estado={e.estados['interes']}
      nota={
        tipo === 'tienda' || tipo === 'ambos' ? (
          <AvisoPendiente className="text-xs">
            Tiendas: se deriva al responsable de tiendas. Aquí solo se registra el interés, nunca se cotiza
            (precios-vigentes §0.2, Resolución P-07).
          </AvisoPendiente>
        ) : undefined
      }
    >
      <GrupoChips
        etiqueta="¿Qué busca?"
        opciones={TIPOS_INTERES}
        valor={tipo}
        alCambiar={(v) => void e.guardar('interes', { tipo_interes: v })}
        permitirVacio
        compacto={compacto}
        deshabilitado={deshabilitado}
      />
      <ValorRaro valor={p.tipoInteres} lista={TIPOS_INTERES} />
      <CampoTexto
        etiqueta="¿Cuál? (código, zona o rubro)"
        valor={p.interesDetalle}
        alConfirmar={(v) => void e.guardar('interes', { interes_detalle: v })}
        deshabilitado={deshabilitado}
        placeholder="B-12, zona de comidas…"
      />
    </Grupo>
  )
}

function PreguntaProposito({ e, p, deshabilitado, compacto }: { e: Editable; p: PerfilComercial; deshabilitado: boolean; compacto: boolean }) {
  const proposito = enLista(PROPOSITOS, p.proposito)
  return (
    <Grupo
      estado={e.estados['proposito']}
      nota={
        proposito === 'busca_alquilar' ? (
          <AvisoPendiente className="text-xs">
            Hoy no se ofrece alquiler: regístralo tal cual y no le prometas un puesto en alquiler.
          </AvisoPendiente>
        ) : undefined
      }
    >
      <GrupoChips
        etiqueta="¿Para qué lo quiere? (R5)"
        opciones={PROPOSITOS}
        valor={proposito}
        alCambiar={(v) => void e.guardar('proposito', { proposito: v })}
        permitirVacio
        compacto={compacto}
        deshabilitado={deshabilitado}
      />
      <ValorRaro valor={p.proposito} lista={PROPOSITOS} />
    </Grupo>
  )
}

function PreguntaHorizonte({ e, p, deshabilitado, compacto }: { e: Editable; p: PerfilComercial; deshabilitado: boolean; compacto: boolean }) {
  const horizonte = enLista(HORIZONTES, p.horizonteCompra)
  return (
    <Grupo
      estado={e.estados['horizonte']}
      nota={
        horizonte !== null ? (
          <p className="text-xs text-suelo-700">
            Mes objetivo: <span className="font-bold text-foreground">{textoMesObjetivo(p.mesObjetivo)}</span>{' '}
            (lo calcula la base en hora de Lima)
          </p>
        ) : undefined
      }
    >
      <GrupoChips
        etiqueta="¿Cuándo compraría?"
        opciones={HORIZONTES}
        valor={horizonte}
        alCambiar={(v) => void e.guardar('horizonte', { horizonte_compra: v })}
        permitirVacio
        compacto={compacto}
        deshabilitado={deshabilitado}
      />
      <ValorRaro valor={p.horizonteCompra} lista={HORIZONTES} />
    </Grupo>
  )
}

function PreguntaFormaPago({ e, p, deshabilitado, compacto }: { e: Editable; p: PerfilComercial; deshabilitado: boolean; compacto: boolean }) {
  return (
    <Grupo estado={e.estados['forma_pago']}>
      <GrupoChips
        etiqueta="¿Contado o financiado? (R5)"
        opciones={FORMAS_PAGO}
        valor={enLista(FORMAS_PAGO, p.formaPago)}
        alCambiar={(v) => void e.guardar('forma_pago', { forma_pago: v })}
        permitirVacio
        compacto={compacto}
        deshabilitado={deshabilitado}
      />
      <ValorRaro valor={p.formaPago} lista={FORMAS_PAGO} />
    </Grupo>
  )
}

function PreguntaCapitalCategoria({ e, p, deshabilitado, compacto }: { e: Editable; p: PerfilComercial; deshabilitado: boolean; compacto: boolean }) {
  return (
    <Grupo estado={e.estados['capital']}>
      <GrupoChips
        etiqueta="¿Cuánto capital tiene?"
        opciones={CAPITAL_CATEGORIAS}
        valor={enLista(CAPITAL_CATEGORIAS, p.capitalCategoria)}
        alCambiar={(v) => void e.guardar('capital', { capital_categoria: v })}
        permitirVacio
        compacto={compacto}
        deshabilitado={deshabilitado}
      />
      <ValorRaro valor={p.capitalCategoria} lista={CAPITAL_CATEGORIAS} />
    </Grupo>
  )
}

/**
 * El monto, opcional, SIEMPRE con su moneda (R7). La moneda no tiene valor por
 * defecto: suponer soles sería elegir por la persona (la moneda de control
 * sigue [PENDIENTE] en el repo, 07-crm/CLAUDE.md R7).
 */
function CapitalMonto({ e, p, deshabilitado }: { e: Editable; p: PerfilComercial; deshabilitado: boolean }) {
  const idMonto = useId()
  const idMoneda = useId()
  const montoGuardado = p.capitalMonto === null ? '' : String(p.capitalMonto)
  const [monto, setMonto] = useState(montoGuardado)
  const [moneda, setMoneda] = useState(p.capitalMoneda ?? '')
  const [editando, setEditando] = useState(false)
  const [avisoR7, setAvisoR7] = useState<string | null>(null)

  useEffect(() => {
    if (!editando) {
      setMonto(montoGuardado)
      setMoneda(p.capitalMoneda ?? '')
    }
  }, [montoGuardado, p.capitalMoneda, editando])

  function confirmar(nuevoMonto: string, nuevaMoneda: string): void {
    const m = nuevoMonto.trim()
    if (m === '') {
      setAvisoR7(null)
      if (p.capitalMonto !== null) void e.guardar('capital_monto', { capital_monto: null, capital_moneda: null })
      return
    }
    if (nuevaMoneda === '') {
      setAvisoR7('Elige la moneda: un monto sin moneda no se guarda (R7).')
      return
    }
    setAvisoR7(null)
    if (m === montoGuardado && nuevaMoneda === (p.capitalMoneda ?? '')) return
    void e.guardar('capital_monto', { capital_monto: m, capital_moneda: nuevaMoneda })
  }

  return (
    <Grupo estado={e.estados['capital_monto']}>
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
        <div className="space-y-1.5">
          <label htmlFor={idMoneda} className="block text-sm font-bold text-suelo">
            Moneda
          </label>
          <select
            id={idMoneda}
            value={moneda}
            disabled={deshabilitado}
            onChange={(ev) => {
              setMoneda(ev.target.value)
              confirmar(monto, ev.target.value)
            }}
            className={claseCampo}
          >
            <option value="">—</option>
            {MONEDAS_CAPITAL.map((mo) => (
              <option key={mo.valor} value={mo.valor}>
                {mo.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={idMonto} className="block text-sm font-bold text-suelo">
            Monto que dijo (opcional)
          </label>
          <input
            id={idMonto}
            value={monto}
            inputMode="decimal"
            placeholder="Solo dígitos"
            disabled={deshabilitado}
            onFocus={() => setEditando(true)}
            onChange={(ev) => setMonto(ev.target.value)}
            onBlur={() => {
              setEditando(false)
              confirmar(monto, moneda)
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault()
                ev.currentTarget.blur()
              }
            }}
            className={claseCampo}
          />
        </div>
      </div>
      {avisoR7 !== null && (
        <p role="alert" className="text-xs font-bold text-alerta">
          {avisoR7}
        </p>
      )}
      <p className="flex items-start gap-1.5 text-xs text-suelo-700">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        Dato sensible: solo lo ven Dirección, Administración y el vendedor a cargo.
      </p>
    </Grupo>
  )
}

// ---------------------------------------------------------------------------
// Sugerencias de la web
// ---------------------------------------------------------------------------

function valorActual(p: PerfilComercial, campo: keyof CambiosPerfil): unknown {
  const c = CAMPOS[campo]
  return c === undefined ? undefined : p[c]
}

function SugerenciasWeb({ e, p, deshabilitado }: { e: Editable; p: PerfilComercial; deshabilitado: boolean }) {
  const claves = Object.keys(p.respuestasWeb)
  if (claves.length === 0) return null
  const pendientes = sugerenciasDesdeWeb(p.respuestasWeb).filter((s) => valorActual(p, s.campo) !== s.valor)
  const estadoWeb = e.estados['web']

  function confirmar(s: SugerenciaPerfil): void {
    const cambios: Record<string, string | boolean> = { [s.campo]: s.valor }
    void e.guardar('web', cambios as CambiosPerfil)
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Globe className="h-4 w-4 text-azul" strokeWidth={1.75} aria-hidden="true" />
        Declarado en la web · por confirmar
      </p>
      <ul className="flex flex-wrap gap-2">
        {claves.map((k) => {
          const e2 = ETIQUETAS_RESPUESTA_WEB[k]
          const codigo = p.respuestasWeb[k] ?? ''
          return (
            <li key={k} className="rounded-full border border-input px-3 py-1 text-xs text-suelo">
              {e2?.pregunta ?? k}: <span className="font-bold">{e2?.opciones[codigo] ?? codigo}</span>
            </li>
          )
        })}
      </ul>
      {pendientes.length > 0 && (
        <ul className="space-y-2">
          {pendientes.map((s) => (
            <li key={`${s.campo}-${String(s.valor)}`} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm">
                <span className="font-bold text-foreground">{s.etiqueta}</span>
                <span className="block text-xs text-suelo-700">{s.origen}</span>
              </span>
              {!deshabilitado && (
                <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => confirmar(s)}>
                  <Check aria-hidden="true" />
                  Confirmar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <EstadoGuardado estado={estadoWeb} />
      {estadoWeb?.tipo === 'fallo' && <Fallo className="p-2 text-xs">{estadoWeb.motivo}</Fallo>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Estados de carga comunes
// ---------------------------------------------------------------------------

function CargaPerfil({ e }: { e: Editable }) {
  if (e.consulta.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-suelo-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Cargando el perfil…
      </p>
    )
  }
  if (e.consulta.isError) {
    return (
      <div className="space-y-2">
        <Fallo>{e.consulta.error.message}</Fallo>
        <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => void e.consulta.refetch()}>
          Reintentar
        </Button>
      </div>
    )
  }
  return null
}

/** Lectura y contabilidad no leen `oportunidad_perfil` (el capital es dato sensible, SPEC §4.3). */
function useSinAccesoAlPerfil(): boolean {
  const { rol } = useSesion()
  return rol === 'lectura' || rol === 'contabilidad'
}

// ---------------------------------------------------------------------------
// Las dos vistas
// ---------------------------------------------------------------------------

export function SeccionPerfil({
  oportunidadId,
  puedeEditar,
  alGuardar,
}: {
  oportunidadId: string
  puedeEditar: boolean
  alGuardar?: (() => void) | undefined
}) {
  const e = usePerfilEditable(oportunidadId, alGuardar)
  const sinAcceso = useSinAccesoAlPerfil()
  const p = e.perfil
  const d = !puedeEditar

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Perfil comercial</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <CargaPerfil e={e} />
        {sinAcceso && (
          <AvisoPendiente>
            Tu rol no ve el perfil comercial (dato sensible). Los campos vacíos significan «no se puede
            ver», no «no respondió».
          </AvisoPendiente>
        )}
        {!puedeEditar && !sinAcceso && p !== null && (
          <AvisoPendiente>Solo lectura: esta oportunidad la lleva otra persona.</AvisoPendiente>
        )}

        {p !== null && (
          <>
            <MedidorCualificacion perfil={p} />
            <SugerenciasWeb e={e} p={p} deshabilitado={d} />

            <PreguntaInteres e={e} p={p} deshabilitado={d} compacto={false} />
            <PreguntaProposito e={e} p={p} deshabilitado={d} compacto={false} />

            <Grupo estado={e.estados['situacion_actual']}>
              <GrupoChips
                etiqueta="Situación actual (¿ya tiene puesto?)"
                opciones={SITUACIONES_ACTUALES}
                valor={enLista(SITUACIONES_ACTUALES, p.situacionActual)}
                alCambiar={(v) => void e.guardar('situacion_actual', { situacion_actual: v })}
                permitirVacio
                deshabilitado={d}
              />
              <ValorRaro valor={p.situacionActual} lista={SITUACIONES_ACTUALES} />
            </Grupo>

            <Grupo
              estado={e.estados['rubro']}
              nota={
                <p className="text-xs text-suelo-700">
                  🟡 Rubros según la zonificación publicada en la web (planos.html), no según
                  00-fuente-de-verdad.
                </p>
              }
            >
              <GrupoChips
                etiqueta="Rubro"
                opciones={RUBROS}
                valor={enLista(RUBROS, p.rubro)}
                alCambiar={(v) => void e.guardar('rubro', { rubro: v })}
                permitirVacio
                deshabilitado={d}
              />
              <ValorRaro valor={p.rubro} lista={RUBROS} />
            </Grupo>

            <PreguntaHorizonte e={e} p={p} deshabilitado={d} compacto={false} />
            <PreguntaFormaPago e={e} p={p} deshabilitado={d} compacto={false} />

            <div className="space-y-3">
              <PreguntaCapitalCategoria e={e} p={p} deshabilitado={d} compacto={false} />
              <CapitalMonto e={e} p={p} deshabilitado={d} />
            </div>

            <Grupo estado={e.estados['decide_solo']}>
              <ChipsSiNo
                etiqueta="¿Decide solo? (R5)"
                valor={p.decideSolo}
                alCambiar={(v) => void e.guardar('decide_solo', { decide_solo: v })}
                deshabilitado={d}
              />
              {p.decideSolo === false && (
                <GrupoChips
                  etiqueta="¿Con quién decide?"
                  opciones={DECIDE_CON}
                  valor={enLista(DECIDE_CON, p.decideCon)}
                  alCambiar={(v) => void e.guardar('decide_solo', { decide_con: v })}
                  permitirVacio
                  compacto
                  deshabilitado={d}
                />
              )}
            </Grupo>

            <Grupo
              estado={e.estados['compro_antes']}
              nota={
                <p className="text-xs text-suelo-700">
                  🟡 El esquema lo describe como «¿compró antes en el mercado?»; la diferencia está escalada.
                </p>
              }
            >
              <ChipsSiNo
                etiqueta="¿Compró antes un puesto o local? (R5)"
                valor={p.compraAntes}
                alCambiar={(v) => void e.guardar('compro_antes', { compro_antes: v })}
                deshabilitado={d}
              />
            </Grupo>

            <Grupo estado={e.estados['zona']}>
              <GrupoChips
                etiqueta="¿Desde dónde escribe?"
                opciones={ZONAS}
                valor={enLista(ZONAS, p.zonaProcedencia)}
                alCambiar={(v) => void e.guardar('zona', { zona_procedencia: v })}
                permitirVacio
                deshabilitado={d}
              />
            </Grupo>

            <Grupo estado={e.estados['objeciones']}>
              <GrupoChipsMultiple
                etiqueta="Objeciones que puso"
                opciones={OBJECIONES}
                valores={p.objeciones.filter((x): x is (typeof OBJECIONES)[number]['valor'] =>
                  OBJECIONES.some((o) => o.valor === x),
                )}
                alCambiar={(v) => void e.guardar('objeciones', { objeciones: v })}
                deshabilitado={d}
              />
            </Grupo>

            <Grupo estado={e.estados['canal']}>
              <GrupoChips
                etiqueta="Canal preferido"
                opciones={CANALES_PREFERIDOS}
                valor={enLista(CANALES_PREFERIDOS, p.canalPreferido)}
                alCambiar={(v) => void e.guardar('canal', { canal_preferido: v })}
                permitirVacio
                compacto
                deshabilitado={d}
              />
              <CampoTexto
                etiqueta="Horario preferido"
                valor={p.horarioPreferido}
                alConfirmar={(v) => void e.guardar('canal', { horario_preferido: v })}
                deshabilitado={d}
                placeholder="Por las tardes, después de las 6…"
              />
            </Grupo>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * La versión corta para el modo cola (SPEC S7): lo que decide si vale la pena
 * seguir en la misma llamada — qué busca y cuál, para qué, cuándo, cómo
 * pagaría y si le alcanza. El resto se completa en la ficha.
 */
export function PerfilRapido({
  oportunidadId,
  puedeEditar,
  alGuardar,
}: {
  oportunidadId: string
  puedeEditar: boolean
  alGuardar?: (() => void) | undefined
}) {
  const e = usePerfilEditable(oportunidadId, alGuardar)
  const sinAcceso = useSinAccesoAlPerfil()
  const p = e.perfil
  const d = !puedeEditar

  return (
    <div className="space-y-4">
      <CargaPerfil e={e} />
      {sinAcceso && <AvisoPendiente>Tu rol no ve el perfil comercial (dato sensible).</AvisoPendiente>}
      {p !== null && (
        <>
          <MedidorCualificacion perfil={p} />
          <PreguntaInteres e={e} p={p} deshabilitado={d} compacto />
          <PreguntaProposito e={e} p={p} deshabilitado={d} compacto />
          <PreguntaHorizonte e={e} p={p} deshabilitado={d} compacto />
          <PreguntaFormaPago e={e} p={p} deshabilitado={d} compacto />
          <PreguntaCapitalCategoria e={e} p={p} deshabilitado={d} compacto />
        </>
      )}
    </div>
  )
}
