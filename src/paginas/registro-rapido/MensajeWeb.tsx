import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ExternalLink, Globe, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent } from '@/componentes/ui/card'
import { Input, claseCampo } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { TarjetaConPie } from '@/componentes/marca/Superficies'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { cn } from '@/lib/utils'
import { aEntradaLocal, deEntradaLocal } from '@/lib/fechas'
import { formatearTelefono, normalizarTelefono } from '@/lib/telefono'
import { ORIGENES, esOrigen, type Origen } from '@/lib/registro-rapido'
import { analizarMensajeWeb, registrarProspecto, type MensajeWeb as Mensaje } from '@/lib/lote'
import { ETIQUETAS_RESPUESTA_WEB, perfilWebDirecto } from '@/lib/perfil'
import { InsigniaRegistro, registroDesdeProspecto, type RegistroSesion } from './UnoAUno'
import type { ContextoRegistro } from './ConfiguracionSesion'

/**
 * MENSAJE DE LA WEB — el WhatsApp que arma mercadomedialuna.com, pegado aqui.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 * ---------------------------------------------------------------------------
 * La web todavia envia su formulario por WhatsApp (config.js
 * `destinoFormulario:'whatsapp'`) y no a la base, hasta que Direccion ratifique
 * `aviso_privacidad_version` (analisis/web.md). Mientras tanto esos leads solo
 * existen en el celular de quien atiende. Aqui se pega el mensaje, el CRM lo
 * lee (`analizarMensajeWeb`, src/lib/lote.ts) y se registra con sus
 * respuestas, sin volver a teclearlas.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTA PANTALLA SE NIEGA A HACER
 * ---------------------------------------------------------------------------
 *  · Guardar el DNI. Si el mensaje del evento lo trae, se avisa que vino y NO
 *    se guarda: el DNI se pide solo cuando hace falta para separar (Ley 29733,
 *    dato minimo necesario). Ni siquiera se muestra el numero.
 *  · Registrar un reclamo como lead: va al Libro de Reclamaciones.
 *  · Aplicar al perfil lo que la web solo SUGIERE. Se guardan las respuestas
 *    tal cual (`respuestas_web`) y solo las tres correspondencias directas
 *    (situacion, rubro, zona) con `fuente_perfil 'web'` (`perfilWebDirecto`).
 *    Las cuatro de R5 (proposito, forma de pago…) quedan como sugerencia en la
 *    ficha hasta que el vendedor las confirme hablando con la persona.
 *  · Usar la campaña de la sesion: un mensaje de la web no viene del live.
 */

const TIPOS_MENSAJE: Readonly<Record<Mensaje['tipo'], string>> = {
  embudo: 'Formulario de la web, con respuestas',
  evento: 'Registro al evento',
  generico: 'Botón de la web (mensaje fijo, sin respuestas)',
  reclamo: 'Libro de Reclamaciones',
  desconocido: 'Formato no reconocido: revisa los datos a mano',
}

/** Canal del consentimiento de estos leads (SPEC §7 S6): escribieron por WhatsApp desde la web. */
const CANAL_WEB = 'web_whatsapp'

/** Un minuto de holgura: el `datetime-local` no tiene segundos. No es una regla de negocio. */
const HOLGURA_RELOJ_MS = 60 * 1000

function etiquetaOrigen(o: Origen): string {
  return ORIGENES.find((x) => x.valor === o)?.etiqueta ?? o
}

export function MensajeWeb({
  contexto,
  alRegistrar,
  lateral,
}: {
  contexto: ContextoRegistro
  alRegistrar: (r: RegistroSesion) => void
  lateral?: ReactNode | undefined
}) {
  const cliente = useQueryClient()
  const idLlegada = useId()

  const [texto, setTexto] = useState('')
  // `null` = seguir lo que dice el mensaje; texto = lo que corrigio el vendedor.
  const [nombreEditado, setNombreEditado] = useState<string | null>(null)
  const [telefonoEditado, setTelefonoEditado] = useState<string | null>(null)
  const [llegada, setLlegada] = useState('')
  const [nota, setNota] = useState('')
  const [consentimiento, setConsentimiento] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimo, setUltimo] = useState<RegistroSesion | null>(null)

  const mensaje = useMemo(() => (texto.trim() === '' ? null : analizarMensajeWeb(texto)), [texto])

  const nombre = nombreEditado ?? mensaje?.nombre ?? ''
  const telefono =
    telefonoEditado ??
    (mensaje === null || mensaje.telefonoE164 === null ? '' : formatearTelefono(mensaje.telefonoE164))
  const origen: Origen = mensaje !== null && esOrigen(mensaje.origenSugerido) ? mensaje.origenSugerido : 'organico'
  const respuestas = Object.entries(mensaje?.respuestas ?? {})
  const esReclamo = mensaje?.tipo === 'reclamo'

  function alPegar(valor: string): void {
    setTexto(valor)
    // Mensaje nuevo: las correcciones del anterior no aplican.
    setNombreEditado(null)
    setTelefonoEditado(null)
    setError(null)
  }

  async function guardar(): Promise<void> {
    if (guardando || mensaje === null || esReclamo) return
    setError(null)

    if (nombre.trim() === '') {
      setError('Falta el nombre: si el mensaje no lo trae, usa el del perfil de WhatsApp.')
      return
    }
    const t = normalizarTelefono(telefono)
    if (!t.ok) {
      setError(telefono.trim() === '' ? 'Falta el teléfono: cópialo del chat desde el que te escribió.' : t.motivo)
      return
    }
    const fechaIngreso = deEntradaLocal(llegada)
    if (fechaIngreso !== null && new Date(fechaIngreso).getTime() > Date.now() + HOLGURA_RELOJ_MS) {
      setError('La hora de llegada está en el futuro: corrígela o déjala vacía.')
      return
    }
    if (!consentimiento) {
      setError('Sin consentimiento no se puede registrar el dato (Ley 29733).')
      return
    }

    setGuardando(true)
    const r = await registrarProspecto({
      nombre,
      telefono: t.e164,
      origen,
      responsableId: contexto.responsableId,
      fechaIngreso,
      consentimiento: true,
      consentimientoCanal: CANAL_WEB,
      consentimientoEvidencia: `Escribió por WhatsApp con el mensaje de la web (${TIPOS_MENSAJE[mensaje.tipo]}).`,
      nota: nota.trim() === '' ? undefined : nota.trim(),
      // Sin respuestas no hay perfil que guardar: un `fuente_perfil 'web'`
      // vacío diría que la web aportó algo que no aportó.
      perfil: respuestas.length > 0 ? perfilWebDirecto(mensaje.respuestas) : undefined,
    })
    setGuardando(false)

    if (!r.ok) {
      setError(r.motivo)
      return
    }

    const registro = registroDesdeProspecto(r.datos, nombre.trim(), formatearTelefono(t.e164), null)
    setUltimo(registro)
    alRegistrar(registro)
    for (const clave of ['hoy', 'cartera', 'embudo', 'bandeja']) {
      void cliente.invalidateQueries({ queryKey: [clave] })
    }
    alPegar('')
    setLlegada('')
    setNota('')
    setConsentimiento(false)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-3 p-5 sm:p-6">
            <Label htmlFor="rr-web" className="flex items-center gap-2 text-base font-black">
              <Globe className="h-4 w-4 text-suelo-500" strokeWidth={1.75} aria-hidden="true" />
              Pega el mensaje de WhatsApp
            </Label>
            <p id="rr-web-ayuda" className="text-sm text-suelo-700">
              El que empieza con «Hola, soy… Vengo de la web de Mercado Media Luna». El CRM lo lee al pegarlo.
            </p>
            <textarea
              id="rr-web"
              aria-describedby="rr-web-ayuda"
              className={cn(claseCampo, 'h-auto min-h-40 py-2 font-normal')}
              value={texto}
              onChange={(e) => alPegar(e.target.value)}
              spellCheck={false}
              rows={7}
              placeholder={'Hola, soy …. Vengo de la web de Mercado Media Luna (web).\n• El puesto: …\n• Hoy: …'}
            />
          </CardContent>
        </Card>

        {mensaje !== null && esReclamo && (
          // Bloqueo explicado, no error de validación: no hay nada que corregir.
          <div role="note" className="flex items-start gap-3 rounded-lg border-[1.5px] border-primary bg-card p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-black text-foreground">Es un reclamo: va al Libro de Reclamaciones.</p>
              <p className="text-suelo-700">
                No es un lead y no se registra aquí. Pásalo a Dirección tal como llegó, con la fecha y la hora del
                mensaje.
              </p>
            </div>
          </div>
        )}

        {mensaje !== null && !esReclamo && (
          <TarjetaConPie
            nota="Crea persona, oportunidad y tarea de primer contacto. Si el teléfono ya existe, se reutiliza la ficha."
            acciones={
              <Button
                type="button"
                variant="ambar"
                size="lg"
                disabled={guardando || !consentimiento}
                onClick={() => void guardar()}
                className="w-full sm:w-auto disabled:bg-azul-600 disabled:text-azul-300 disabled:opacity-100"
              >
                {guardando ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Guardando…
                  </>
                ) : (
                  'Registrar lead'
                )}
              </Button>
            }
          >
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault()
                void guardar()
              }}
            >
              <div className="space-y-1">
                <p className="text-xs font-bold text-suelo-500">Lo que entendió el CRM</p>
                <p className="text-base font-black text-foreground">{TIPOS_MENSAJE[mensaje.tipo]}</p>
                <p className="text-sm text-suelo-700">
                  Origen: {etiquetaOrigen(origen)}
                  {mensaje.origenEtiqueta !== null && ` (la web dijo «${mensaje.origenEtiqueta}»)`}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="rr-web-nombre">Nombre</Label>
                  <Input
                    id="rr-web-nombre"
                    value={nombre}
                    onChange={(e) => setNombreEditado(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="words"
                    spellCheck={false}
                    placeholder="El del perfil de WhatsApp"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rr-web-telefono">Teléfono</Label>
                  <Input
                    id="rr-web-telefono"
                    type="tel"
                    inputMode="tel"
                    value={telefono}
                    onChange={(e) => setTelefonoEditado(e.target.value)}
                    autoComplete="off"
                    placeholder="999 888 777"
                    aria-describedby="rr-web-telefono-ayuda"
                  />
                  <p id="rr-web-telefono-ayuda" className="text-xs text-suelo-500">
                    {mensaje.telefonoE164 === null
                      ? 'El mensaje no trae el número. Copia el número desde el que te escribió.'
                      : 'Venía en el mensaje. Si te escribió desde otro número, copia ese.'}
                  </p>
                </div>
              </div>

              {respuestas.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-suelo">Lo que respondió en la web</p>
                  <ul className="flex flex-wrap gap-2">
                    {respuestas.map(([clave, codigo]) => {
                      const e = ETIQUETAS_RESPUESTA_WEB[clave]
                      return (
                        <li
                          key={clave}
                          className="inline-flex min-h-8 items-center rounded-full border border-border px-3 text-xs text-foreground"
                        >
                          <span className="font-bold">{e?.pregunta ?? clave}:</span>&nbsp;
                          {e?.opciones[codigo] ?? codigo}
                        </li>
                      )
                    })}
                  </ul>
                  <p className="text-xs text-suelo-500">
                    Se guardan tal cual. Situación, rubro y zona pasan al perfil; el resto queda como sugerencia en
                    la ficha, para confirmarlo hablando con la persona.
                  </p>
                </div>
              )}

              {mensaje.noReconocido.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-bold text-suelo">No se entendió (revísalo a mano)</p>
                  <ul className="space-y-0.5 text-sm text-suelo-700">
                    {mensaje.noReconocido.map((l, i) => (
                      <li key={`${i}-${l}`} className="break-words">
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {mensaje.dni !== null && (
                <AvisoPendiente>
                  El mensaje trae un documento. <span className="font-bold">No se guarda</span>: el DNI se pide solo
                  cuando hace falta para separar (Ley 29733, dato mínimo necesario).
                </AvisoPendiente>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={idLlegada}>
                    ¿Cuándo llegó? <span className="font-normal text-suelo-500">(opcional)</span>
                  </Label>
                  <input
                    id={idLlegada}
                    type="datetime-local"
                    className={claseCampo}
                    value={llegada}
                    max={aEntradaLocal(new Date())}
                    onChange={(e) => setLlegada(e.target.value)}
                  />
                  <p className="text-xs text-suelo-500">Vacío = ahora. Con la hora real, el SLA no miente.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rr-web-nota">
                    Nota <span className="font-normal text-suelo-500">(opcional)</span>
                  </Label>
                  <Input
                    id="rr-web-nota"
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    autoComplete="off"
                    maxLength={1000}
                  />
                </div>
              </div>

              <label
                htmlFor="rr-web-consentimiento"
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3"
              >
                <input
                  id="rr-web-consentimiento"
                  type="checkbox"
                  checked={consentimiento}
                  onChange={(e) => setConsentimiento(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-input accent-azul"
                />
                <span className="text-sm leading-snug">
                  Nos escribió por iniciativa propia desde la web y acepta que SCP Inmobiliaria guarde sus datos y le
                  contacte.
                  <span className="mt-0.5 block text-xs text-suelo-500">
                    Obligatorio: Ley 29733. Canal <code>{CANAL_WEB}</code>. 🟡 La versión del aviso de privacidad
                    sigue [PENDIENTE].
                  </span>
                </span>
              </label>

              {error !== null && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {error}
                </p>
              )}
            </form>
          </TarjetaConPie>
        )}

        {ultimo !== null && (
          <Card className="shadow-none" aria-live="polite">
            <CardContent className="flex items-start gap-3 py-4">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-suelo-700" strokeWidth={2} aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-bold text-foreground">
                  Registrado: {ultimo.nombre}
                  <InsigniaRegistro r={ultimo} />
                </p>
                {ultimo.avisos.map((a) => (
                  <p key={a} className="text-xs text-suelo-700">
                    🟡 {a}
                  </p>
                ))}
                <Link
                  to={`/personas/${ultimo.personaId}?o=${ultimo.oportunidadId}`}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-primary underline-offset-4 hover:underline"
                >
                  Abrir ficha: ahí están las sugerencias de la web para confirmar
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {lateral}
    </div>
  )
}
