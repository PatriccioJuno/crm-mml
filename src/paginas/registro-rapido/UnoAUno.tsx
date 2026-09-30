import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ExternalLink, Loader2, PhoneCall, Timer, UserPlus } from 'lucide-react'
import { Badge } from '@/componentes/ui/badge'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { Input, claseCampo } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { TarjetaConPie } from '@/componentes/marca/Superficies'
import { GrupoChips } from '@/componentes/crm/GrupoChips'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { cn } from '@/lib/utils'
import { fechaHora } from '@/lib/fechas'
import { formatearTelefono, normalizarTelefono } from '@/lib/telefono'
import { REDES_SOCIALES, registrarProspecto, type ProspectoRegistrado, type RedSocial } from '@/lib/lote'
import {
  PROPOSITOS,
  TIPOS_INTERES,
  type CambiosPerfil,
  type Proposito,
  type TipoInteres,
} from '@/lib/perfil'
import { canalConsentimientoLive, type ContextoRegistro } from './ConfiguracionSesion'

/**
 * UNO A UNO — el registro de 30 segundos, ahora con campaña, @usuario y dos
 * preguntas opcionales.
 *
 * ---------------------------------------------------------------------------
 * EL OBJETIVO DURO SIGUE SIENDO EL TIEMPO: MENOS DE 30 SEGUNDOS
 * ---------------------------------------------------------------------------
 * Se usa en directo, en un celular, con el live corriendo. Por eso:
 *  · Foco en el nombre al abrir la pestaña y despues de cada guardado.
 *  · Enter avanza: nombre → telefono → (si no hay telefono, @usuario) →
 *    casilla de consentimiento → guarda. Los campos opcionales (chips, nota)
 *    se saltan: estan para quien tenga el dato, no para frenar a quien no.
 *  · Lo comun (origen, campaña, responsable, hora del live) no se pregunta
 *    aqui: se pone una vez en la sesion (ConfiguracionSesion.tsx).
 *  · Un cronometro real, desde la primera tecla, para comprobar el objetivo
 *    en vez de suponerlo.
 *
 * ---------------------------------------------------------------------------
 * LO QUE NO SE ARRASTRA DE UN LEAD AL SIGUIENTE
 * ---------------------------------------------------------------------------
 * El consentimiento (Ley 29733: es un acto afirmativo de CADA persona) ni las
 * respuestas del perfil (son de esa persona). Si se arrastra la red del
 * @usuario elegida a mano: no es un dato personal.
 *
 * La transaccion (persona + oportunidad + tarea, y la deduplicacion por
 * telefono o @usuario con candado) esta en la base: `fn_registrar_prospecto`
 * (SPEC §4.5), via `registrarProspecto` de src/lib/lote.ts.
 */

/** Objetivo declarado en el encargo de 06. Solo decide el tono del cronometro. */
const OBJETIVO_SEGUNDOS = 30

// ---------------------------------------------------------------------------
// Lo registrado en esta sesion (compartido con «Mensaje de la web»)
// ---------------------------------------------------------------------------

export type EstadoRegistro = 'nuevo' | 'ya_existia' | 'tiene_dueno'

export type RegistroSesion = {
  /** Clave de React: una misma oportunidad puede registrarse dos veces en la sesion. */
  clave: string
  personaId: string
  oportunidadId: string
  nombre: string
  /** Teléfono formateado o @usuario: lo que el vendedor reconoce a simple vista. */
  contacto: string
  estado: EstadoRegistro
  responsableNombre: string | null
  tareaVenceEl: string | null
  avisos: string[]
  segundos: number | null
}

export function registroDesdeProspecto(
  p: ProspectoRegistrado,
  nombre: string,
  contacto: string,
  segundos: number | null,
): RegistroSesion {
  return {
    clave: `${p.oportunidadId}-${Date.now()}`,
    personaId: p.personaId,
    oportunidadId: p.oportunidadId,
    nombre,
    contacto,
    // «Tiene dueño» manda sobre «ya existía»: es lo que cambia lo que hay que
    // hacer (no llamarla; la lleva otra persona, que ya recibió el aviso).
    estado: p.responsableOtro
      ? 'tiene_dueno'
      : p.personaReutilizada || p.oportunidadReutilizada
        ? 'ya_existia'
        : 'nuevo',
    responsableNombre: p.responsableNombre,
    tareaVenceEl: p.tareaVenceEl,
    avisos: p.avisos,
    segundos,
  }
}

export function InsigniaRegistro({ r }: { r: Pick<RegistroSesion, 'estado' | 'responsableNombre'> }) {
  if (r.estado === 'nuevo') return <Badge variant="default">Nuevo</Badge>
  if (r.estado === 'ya_existia') return <Badge variant="outline">Ya existía</Badge>
  return <Badge variant="secondary">Tiene dueño: {r.responsableNombre ?? 'otra persona'}</Badge>
}

/**
 * «Registrados en esta sesión» — el acuse de recibo, a un lado. No
 * interrumpe: el formulario ya esta limpio y enfocado.
 */
export function ListaRegistrados({
  registros,
  alLlamar,
  errorCola,
}: {
  registros: readonly RegistroSesion[]
  alLlamar: () => void
  errorCola: string | null
}) {
  // Los que lleva otra persona no se ofrecen para llamar: ya tienen dueño.
  const llamables = registros.filter((r) => r.estado !== 'tiene_dueno').length

  return (
    <Card className="shadow-none" aria-live="polite">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Registrados en esta sesión</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {registros.length === 0 ? (
          <p className="text-sm text-suelo-500">
            Aún nada. Cada lead que guardes aparece aquí, con su ficha a un toque.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {registros.map((r) => (
              <li key={r.clave} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{r.nombre}</p>
                  <p className="text-xs text-suelo-700">{r.contacto}</p>
                  <div className="mt-1">
                    <InsigniaRegistro r={r} />
                  </div>
                </div>
                <Link
                  to={`/personas/${r.personaId}?o=${r.oportunidadId}`}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-2 text-sm font-bold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Abrir ficha
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {llamables > 0 && (
          <Button type="button" className="h-11 w-full sm:h-10" onClick={alLlamar}>
            <PhoneCall aria-hidden="true" />
            Llamar a estos ({llamables})
          </Button>
        )}
        {errorCola !== null && (
          <p role="alert" className="rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta">
            {errorCola}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Cronometro
// ---------------------------------------------------------------------------

/**
 * Cuenta desde la primera tecla. Vive en su propio componente para que el
 * tic de cada segundo no vuelva a pintar el formulario entero.
 */
function Cronometro({ inicio }: { inicio: number | null }) {
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    if (inicio === null) return
    setAhora(Date.now())
    const id = window.setInterval(() => setAhora(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [inicio])

  if (inicio === null) return null
  const segundos = Math.max(0, Math.floor((ahora - inicio) / 1000))
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs tabular-nums text-suelo-500',
        segundos > OBJETIVO_SEGUNDOS && 'font-bold text-suelo-700',
      )}
      aria-hidden="true"
    >
      <Timer className="h-3.5 w-3.5" strokeWidth={1.75} />
      {segundos} s
    </span>
  )
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

type Campo = 'nombre' | 'telefono' | 'usuario' | 'red' | 'consentimiento'

/** Mismo formato que acepta la base para `usuario_red` (SPEC §4.5). Solo para enfocar el campo. */
const USUARIO_VALIDO = /^[a-z0-9._]{2,40}$/

function esRedSocial(v: string): v is RedSocial {
  return REDES_SOCIALES.some((r) => r.valor === v)
}

export function UnoAUno({
  contexto,
  activo,
  alRegistrar,
  lateral,
}: {
  contexto: ContextoRegistro
  /** La pestaña esta a la vista: entonces el foco va al nombre. */
  activo: boolean
  alRegistrar: (r: RegistroSesion) => void
  lateral?: ReactNode | undefined
}) {
  const cliente = useQueryClient()

  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [usuario, setUsuario] = useState('')
  // Red elegida AQUI cuando la sesion no la define. Se conserva entre leads.
  const [redLocal, setRedLocal] = useState<RedSocial | null>(null)
  const [tipoInteres, setTipoInteres] = useState<TipoInteres | null>(null)
  const [proposito, setProposito] = useState<Proposito | null>(null)
  const [nota, setNota] = useState('')
  const [consentimiento, setConsentimiento] = useState(false)

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<{ motivo: string; campo?: Campo | undefined } | null>(null)
  const [ultimo, setUltimo] = useState<RegistroSesion | null>(null)
  /** Momento de la primera tecla de este lead. `null` = aun no empezo. */
  const [inicio, setInicio] = useState<number | null>(null)

  const refNombre = useRef<HTMLInputElement>(null)
  const refTelefono = useRef<HTMLInputElement>(null)
  const refUsuario = useRef<HTMLInputElement>(null)
  const refRed = useRef<HTMLSelectElement>(null)
  const refConsentimiento = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (activo) refNombre.current?.focus()
  }, [activo])

  const red = contexto.redSocial ?? redLocal
  const usuarioLimpio = usuario.trim().replace(/^@+/, '').toLowerCase()
  const pideRed = usuarioLimpio !== '' && contexto.redSocial === null

  function marcarInicio(): void {
    if (inicio === null) setInicio(Date.now())
  }

  function limpiar(): void {
    setNombre('')
    setTelefono('')
    setUsuario('')
    setTipoInteres(null)
    setProposito(null)
    setNota('')
    setConsentimiento(false)
    setError(null)
    setInicio(null)
    refNombre.current?.focus()
  }

  function fallar(motivo: string, campo?: Campo | undefined): void {
    setError({ motivo, campo })
    // El foco vuelve al campo que fallo: corregir y seguir, sin buscar nada.
    const destino: Record<Campo, HTMLElement | null> = {
      nombre: refNombre.current,
      telefono: refTelefono.current,
      usuario: refUsuario.current,
      red: refRed.current,
      consentimiento: refConsentimiento.current,
    }
    if (campo !== undefined) destino[campo]?.focus()
  }

  async function guardar(): Promise<void> {
    if (guardando) return

    // Comprobaciones de velocidad (para enfocar el campo exacto); la base
    // vuelve a comprobarlo todo.
    const nombreLimpio = nombre.replace(/\s+/g, ' ').trim()
    if (nombreLimpio === '') return fallar('El nombre es obligatorio.', 'nombre')
    const tel = telefono.trim()
    if (tel === '' && usuarioLimpio === '') {
      return fallar('Falta el teléfono (o, si solo dejó su cuenta, el @usuario).', 'telefono')
    }
    let e164: string | null = null
    if (tel !== '') {
      const t = normalizarTelefono(tel)
      if (!t.ok) return fallar(t.motivo, 'telefono')
      e164 = t.e164
    }
    if (usuarioLimpio !== '' && !USUARIO_VALIDO.test(usuarioLimpio)) {
      return fallar(`«${usuario.trim()}» no parece un @usuario válido (letras, números, punto o guion bajo).`, 'usuario')
    }
    if (usuarioLimpio !== '' && red === null) return fallar('Elige la red social del @usuario.', 'red')
    if (!consentimiento) {
      return fallar('Sin consentimiento no se puede registrar el dato (Ley 29733).', 'consentimiento')
    }
    if (contexto.fechaFutura) {
      return fallar('La hora del ingreso de la sesión está en el futuro: corrígela arriba.')
    }

    const perfil: CambiosPerfil = {}
    if (tipoInteres !== null) perfil.tipo_interes = tipoInteres
    if (proposito !== null) perfil.proposito = proposito
    if (Object.keys(perfil).length > 0) perfil.fuente_perfil = 'agente'

    const campana = contexto.campana?.nombre
    setGuardando(true)
    setError(null)
    const r = await registrarProspecto({
      nombre: nombreLimpio,
      telefono: tel,
      usuarioRed: usuarioLimpio === '' ? undefined : usuarioLimpio,
      redSocial: usuarioLimpio === '' || red === null ? undefined : red,
      origen: contexto.origen,
      campanaId: contexto.campanaId,
      responsableId: contexto.responsableId,
      fechaIngreso: contexto.fechaIngreso,
      consentimiento: true,
      // El canal es por donde la persona dio su dato: en un live, la red del
      // live ('tiktok_live'…); si no, el canal historico de esta pantalla (06).
      consentimientoCanal:
        contexto.origen === 'live'
          ? canalConsentimientoLive(contexto.campana?.plataforma ?? null)
          : 'crm_registro_rapido',
      consentimientoEvidencia: `Registro uno a uno${campana === undefined ? '' : ` · Campaña: ${campana}`}`.slice(0, 300),
      nota: nota.trim() === '' ? undefined : nota.trim(),
      perfil: Object.keys(perfil).length > 0 ? perfil : undefined,
    })
    setGuardando(false)

    if (!r.ok) return fallar(r.motivo)

    const segundos = inicio === null ? null : (Date.now() - inicio) / 1000
    const contacto = e164 !== null ? formatearTelefono(e164) : `@${usuarioLimpio}`
    const registro = registroDesdeProspecto(r.datos, nombreLimpio, contacto, segundos)
    setUltimo(registro)
    alRegistrar(registro)
    // SPEC §8: tras registrar, lo que cuenta leads se vuelve a pedir. 'bandeja'
    // tambien: un lead web sin dueño que se registra aqui pasa a tener dueño.
    for (const clave of ['hoy', 'cartera', 'embudo', 'bandeja']) {
      void cliente.invalidateQueries({ queryKey: [clave] })
    }
    limpiar()
  }

  /** Enter avanza al siguiente control que haga falta, o guarda. */
  function alPulsar(evento: KeyboardEvent, siguiente: () => HTMLElement | null): void {
    if (evento.key !== 'Enter') return
    evento.preventDefault()
    const destino = siguiente()
    if (destino === null) void guardar()
    else destino.focus()
  }

  /** Despues de los datos de contacto: la red si falta, la casilla si falta, o guardar. */
  const trasContacto = (): HTMLElement | null => {
    if (pideRed && red === null) return refRed.current
    if (!consentimiento) return refConsentimiento.current
    return null
  }

  const listo = nombre.trim() !== '' && (telefono.trim() !== '' || usuarioLimpio !== '') && consentimiento

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="space-y-4">
        <TarjetaConPie
          nota={
            <>
              Crea persona, oportunidad y tarea de primer contacto, todo o nada. Si el teléfono o el @usuario ya
              existe, se reutiliza la ficha.
            </>
          }
          acciones={
            <Button
              type="button"
              variant="ambar"
              size="lg"
              onClick={() => void guardar()}
              disabled={!listo || guardando}
              className={cn(
                'w-full sm:w-auto',
                // Deshabilitado no se «apaga» con opacidad: sobre azul, un ámbar
                // al 50 % queda ilegible (mismo criterio que la versión de 06).
                'disabled:bg-azul-600 disabled:text-azul-300 disabled:opacity-100',
              )}
            >
              {guardando ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Guardando…
                </>
              ) : (
                'Guardar'
              )}
            </Button>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void guardar()
            }}
            className="space-y-5"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-base font-black text-foreground">
                <UserPlus className="h-4 w-4 text-suelo-500" strokeWidth={1.75} aria-hidden="true" />
                Nuevo prospecto
              </p>
              <Cronometro inicio={inicio} />
            </div>

            {/* ---- NOMBRE ---- */}
            <div className="space-y-2">
              <Label htmlFor="rr-nombre">Nombre</Label>
              <Input
                id="rr-nombre"
                ref={refNombre}
                value={nombre}
                onChange={(e) => {
                  marcarInicio()
                  setNombre(e.target.value)
                }}
                onKeyDown={(e) => alPulsar(e, () => refTelefono.current)}
                autoComplete="off"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="next"
                placeholder="Nombre y apellidos"
                aria-invalid={error?.campo === 'nombre'}
                className={cn(error?.campo === 'nombre' && 'border-alerta')}
              />
            </div>

            {/* ---- TELEFONO ---- */}
            <div className="space-y-2">
              <Label htmlFor="rr-telefono">Teléfono</Label>
              <Input
                id="rr-telefono"
                ref={refTelefono}
                value={telefono}
                onChange={(e) => {
                  marcarInicio()
                  setTelefono(e.target.value)
                }}
                // Sin teléfono, Enter lleva al @usuario (leads de TikTok que solo
                // dejaron su cuenta); con teléfono, directo a la casilla.
                onKeyDown={(e) =>
                  alPulsar(e, () => (telefono.trim() === '' ? refUsuario.current : trasContacto()))
                }
                // `tel` abre el teclado numérico en el móvil. La normalización a
                // E.164 la hace src/lib/telefono.ts, no este campo.
                type="tel"
                inputMode="tel"
                autoComplete="off"
                enterKeyHint="next"
                placeholder="999 888 777"
                aria-invalid={error?.campo === 'telefono'}
                className={cn(error?.campo === 'telefono' && 'border-alerta')}
              />
            </div>

            {/* ---- @USUARIO (opcional) ---- */}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <div className="space-y-2">
                <Label htmlFor="rr-usuario">
                  @usuario <span className="font-normal text-suelo-500">(opcional)</span>
                </Label>
                <Input
                  id="rr-usuario"
                  ref={refUsuario}
                  value={usuario}
                  onChange={(e) => {
                    marcarInicio()
                    setUsuario(e.target.value)
                  }}
                  onKeyDown={(e) => alPulsar(e, trasContacto)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  placeholder="@usuario"
                  aria-invalid={error?.campo === 'usuario'}
                  className={cn(error?.campo === 'usuario' && 'border-alerta')}
                />
              </div>
              {pideRed && (
                <div className="space-y-2">
                  <Label htmlFor="rr-red">Red</Label>
                  <select
                    id="rr-red"
                    ref={refRed}
                    className={cn(claseCampo, error?.campo === 'red' && 'border-alerta')}
                    value={redLocal ?? ''}
                    onChange={(e) => setRedLocal(esRedSocial(e.target.value) ? e.target.value : null)}
                    onKeyDown={(e) =>
                      alPulsar(e, () => (consentimiento ? null : refConsentimiento.current))
                    }
                  >
                    <option value="">Elige…</option>
                    {REDES_SOCIALES.map((r) => (
                      <option key={r.valor} value={r.valor}>
                        {r.etiqueta}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {usuarioLimpio !== '' && contexto.redSocial !== null && (
              <p className="-mt-3 text-xs text-suelo-500">
                Red: {REDES_SOCIALES.find((r) => r.valor === contexto.redSocial)?.etiqueta}, según la sesión.
              </p>
            )}

            {/* ---- PREGUNTAS RAPIDAS (opcionales) ----
                Solo dos, las que se saben en un comentario del live. El perfil
                completo está en la ficha (SeccionPerfil). */}
            <div className="space-y-3">
              <GrupoChips
                etiqueta="¿Qué busca? (opcional)"
                opciones={TIPOS_INTERES}
                valor={tipoInteres}
                alCambiar={setTipoInteres}
                permitirVacio
                compacto
              />
              {(tipoInteres === 'tienda' || tipoInteres === 'ambos') && (
                // Las tiendas se venden por otro canal (precios-vigentes §0.2,
                // Resolución P-07): aquí se anota el interés, nunca se cotiza.
                <AvisoPendiente>Tiendas: se deriva al responsable de tiendas.</AvisoPendiente>
              )}
              <GrupoChips
                etiqueta="¿Para qué? (opcional)"
                opciones={PROPOSITOS}
                valor={proposito}
                alCambiar={setProposito}
                permitirVacio
                compacto
              />
              {proposito === 'busca_alquilar' && (
                <AvisoPendiente>Hoy no se ofrece alquiler: anótalo y sigue.</AvisoPendiente>
              )}
            </div>

            {/* ---- NOTA (opcional) ---- */}
            <div className="space-y-2">
              <Label htmlFor="rr-nota">
                Nota <span className="font-normal text-suelo-500">(opcional)</span>
              </Label>
              <Input
                id="rr-nota"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                onKeyDown={(e) => alPulsar(e, () => (consentimiento ? null : refConsentimiento.current))}
                autoComplete="off"
                enterKeyHint="next"
                maxLength={1000}
                placeholder="Lo que comentó en el live"
              />
            </div>

            {/* ---- CONSENTIMIENTO ----
                La casilla entera es la etiqueta: 44 px o más de alto para el
                pulgar. NO se conserva entre leads (Ley 29733). */}
            <label
              htmlFor="rr-consentimiento"
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3',
                error?.campo === 'consentimiento' ? 'border-alerta' : 'border-border',
              )}
            >
              <input
                id="rr-consentimiento"
                ref={refConsentimiento}
                type="checkbox"
                checked={consentimiento}
                onChange={(e) => {
                  marcarInicio()
                  setConsentimiento(e.target.checked)
                }}
                // Espacio marca (nativo); Enter guarda. Así el último paso del
                // flujo de teclado es «Espacio, Enter».
                onKeyDown={(e) => alPulsar(e, () => null)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-input accent-azul"
              />
              <span className="text-sm leading-snug">
                Autoriza que SCP Inmobiliaria guarde sus datos y le contacte.
                <span className="mt-0.5 block text-xs text-suelo-500">
                  Obligatorio: Ley 29733. Sin esto no se guarda nada. 🟡 La versión del aviso de privacidad sigue
                  [PENDIENTE].
                </span>
              </span>
            </label>

            {error !== null && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {error.motivo}
              </p>
            )}
          </form>
        </TarjetaConPie>

        {/* ---- ACUSE DEL ULTIMO ---- */}
        {ultimo !== null && <AcuseUltimo r={ultimo} />}
      </div>

      {lateral}
    </div>
  )
}

function AcuseUltimo({ r }: { r: RegistroSesion }) {
  return (
    <Card className="shadow-none" aria-live="polite">
      <CardContent className="flex items-start gap-3 py-4">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-suelo-700" strokeWidth={2} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-bold text-foreground">
            Guardado: {r.nombre}
            <InsigniaRegistro r={r} />
            {r.segundos !== null && (
              <span
                className={cn(
                  'text-xs tabular-nums',
                  r.segundos <= OBJETIVO_SEGUNDOS ? 'font-normal text-suelo-500' : 'font-bold text-suelo-700',
                )}
              >
                {r.segundos.toFixed(1)} s
                {r.segundos > OBJETIVO_SEGUNDOS && ` · sobre el objetivo de ${OBJETIVO_SEGUNDOS} s`}
              </span>
            )}
          </p>
          {r.tareaVenceEl !== null && (
            <p className="text-suelo-700">Próximo paso: primer contacto para {fechaHora(r.tareaVenceEl)}.</p>
          )}
          {/* Los avisos de la base van tal cual: «ya la lleva X», «estaba en
              fríos: se reactivó», el SLA sin cargar… */}
          {r.avisos.map((a) => (
            <p key={a} className="text-xs text-suelo-700">
              🟡 {a}
            </p>
          ))}
          <Link
            to={`/personas/${r.personaId}?o=${r.oportunidadId}`}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-primary underline-offset-4 hover:underline"
          >
            Abrir ficha
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
