import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Download, Loader2, Mail, MessageCircle, Send } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { claseCampo } from '@/componentes/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog'
import { GrupoChips } from '@/componentes/crm/GrupoChips'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { cn } from '@/lib/utils'
import { armarAviso, type PlantillaAviso } from '@/lib/aviso-visita'
import {
  cargarDatosAviso,
  descargarIcs,
  enlaceCorreo,
  enviarAvisoAutomatico,
  envioAutomaticoConfigurado,
  registrarAviso,
} from '@/lib/visitas'
import { enlaceWhatsApp } from '@/lib/whatsapp'
import { copiarAlPortapapeles } from '@/lib/cobranza'
import { fechaHora } from '@/lib/fechas'
import { actualizarPersona } from './DatosPersona'
import { Fallo, invalidarTrasAccion } from './PanelContacto'

/**
 * AVISO DE VISITA — confirmación, recordatorio o cancelación, por WhatsApp o
 * por correo (con su invitación .ics).
 *
 * ===========================================================================
 * DECISION DEL 29/09 (SPEC §1): LAS DOS VIAS
 * ===========================================================================
 *  (a) Manual, desde hoy: el texto listo para WhatsApp, un `mailto:` y el
 *      `.ics` descargable. Lo envía el vendedor desde SU correo o SU WhatsApp.
 *  (b) Automático: la Edge Function `aviso-visita` + Resend. Está desplegada
 *      INERTE hasta que existan los secretos RESEND_API_KEY y CORREO_REMITENTE;
 *      el botón solo aparece cuando la función dice que está configurada.
 *
 * ===========================================================================
 * LO QUE ESTE DIALOGO NO DECIDE
 * ===========================================================================
 *  · El TEXTO lo arma `armarAviso` (src/lib/aviso-visita.ts) solo con datos 🟢
 *    (`parametro_publico`): sin distrito, sin precio, sin promesas. Lo que
 *    falta se dice como «Falta cargar en Parámetros: …», no se rellena.
 *  · SI SE PUEDE escribirle: si la persona pidió no ser contactada o no dio su
 *    consentimiento, no se ofrece NINGUNA acción (Ley 29733), y se explica.
 *  · «Preparado» no es «enviado»: abrir WhatsApp o el correo no prueba que se
 *    haya mandado, así que el manual se registra como 'preparada'
 *    (registrarAviso, src/lib/visitas.ts).
 */

const PLANTILLAS_AVISO: readonly { valor: PlantillaAviso; etiqueta: string }[] = [
  { valor: 'confirmacion', etiqueta: 'Confirmación' },
  { valor: 'recordatorio', etiqueta: 'Recordatorio' },
  { valor: 'cancelacion', etiqueta: 'Cancelación' },
]

const VIAS = [
  { valor: 'whatsapp', etiqueta: 'WhatsApp' },
  { valor: 'correo', etiqueta: 'Correo' },
] as const

type Via = (typeof VIAS)[number]['valor']

/** Nombre legible de cada parámetro que puede faltar en el aviso (SPEC §4.4). */
const NOMBRE_PARAMETRO: Readonly<Record<string, string>> = {
  visita_mapa_url: 'ubicación',
  visita_punto_encuentro: 'punto de encuentro',
  visita_horario: 'horario de visitas',
  correo_contacto_publico: 'correo de contacto',
  whatsapp_empresa: 'WhatsApp de la empresa',
  razon_social: 'razón social',
  ruc: 'RUC',
  aviso_privacidad_version: 'versión del aviso de privacidad',
}

/** La función cambia poco (se configura una vez). Caché de interfaz. */
const AUTOMATICO_VIGENTE_MS = 5 * 60 * 1000

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function DialogoAvisoVisita({
  abierto,
  alCerrar,
  visitaId,
  plantilla,
}: {
  abierto: boolean
  alCerrar: () => void
  visitaId: string | null
  plantilla: PlantillaAviso
}) {
  return (
    <Dialog open={abierto && visitaId !== null} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-black">Avisar de la visita</DialogTitle>
          <DialogDescription>
            El texto sale de los datos confirmados (🟢). Lo que no esté confirmado no se escribe.
          </DialogDescription>
        </DialogHeader>
        {abierto && visitaId !== null && <PanelAviso visitaId={visitaId} plantillaInicial={plantilla} />}
        <DialogFooter>
          <Button variant="ghost" className="h-11 sm:h-10" onClick={alCerrar}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * El cuerpo del aviso, sin el diálogo: DialogoAgendarVisita lo muestra dentro
 * de su propio paso de «visita agendada», para no abrir un diálogo encima de
 * otro en el móvil.
 */
export function PanelAviso({
  visitaId,
  plantillaInicial,
}: {
  visitaId: string
  plantillaInicial: PlantillaAviso
}) {
  const cliente = useQueryClient()
  const idTexto = useId()
  const idCorreo = useId()

  const datos = useQuery({
    queryKey: ['visitas', 'aviso', visitaId],
    queryFn: async () => {
      const r = await cargarDatosAviso(visitaId)
      if (!r.ok) throw new Error(r.motivo)
      return r.datos
    },
  })
  const automatico = useQuery({
    queryKey: ['aviso-automatico'],
    queryFn: envioAutomaticoConfigurado,
    staleTime: AUTOMATICO_VIGENTE_MS,
  })

  const [plantilla, setPlantilla] = useState<PlantillaAviso>(plantillaInicial)
  const [via, setVia] = useState<Via>('whatsapp')
  const [textoWa, setTextoWa] = useState<string | null>(null)
  const [registrados, setRegistrados] = useState<ReadonlySet<string>>(new Set())
  const [correoNuevo, setCorreoNuevo] = useState('')
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  if (datos.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-suelo-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Preparando el aviso…
      </p>
    )
  }
  if (datos.isError) return <Fallo>{datos.error.message}</Fallo>

  const d = datos.data
  const aviso = armarAviso(d, plantilla)
  const textoWhatsApp = textoWa ?? aviso.whatsapp

  const bloqueo = d.persona.noContactar
    ? 'Pidió no ser contactada: no se le envía ningún aviso (Ley 29733). Si hay que cancelar la visita, se cancela sin escribirle.'
    : !d.persona.consentimiento
      ? 'No hay consentimiento registrado para contactarla (Ley 29733). Sin él no se le envía ningún aviso: primero hay que registrarlo al captarla.'
      : null

  // El correo sale solo si la base lo permite (`puede_enviar_email`), salvo la
  // cancelación, que la base deja al llamador porque la visita ya está cancelada.
  const correoPermitido = bloqueo === null && d.persona.email !== null && (d.puedeEnviarEmail || plantilla === 'cancelacion')

  async function registrar(canal: 'whatsapp' | 'email' | 'ics', destinatario: string | null): Promise<void> {
    const clave = `${plantilla}:${canal}`
    if (registrados.has(clave)) return
    const r = await registrarAviso({ visitaId, canal, modo: 'manual', plantilla, destinatario })
    if (!r.ok) {
      setFallo(`Se abrió, pero no se pudo registrar el aviso: ${r.motivo}`)
      return
    }
    setRegistrados((s) => new Set([...s, clave]))
    setHecho('Queda registrado como aviso preparado. El CRM no ve si llegó a enviarse: eso lo confirmas tú.')
    invalidarTrasAccion(cliente, [['visitas'], ['actividad']])
  }

  async function copiar(): Promise<void> {
    const ok = await copiarAlPortapapeles(textoWhatsApp)
    if (!ok) {
      setFallo('El navegador no dejó copiar. Selecciona el texto y cópialo a mano.')
      return
    }
    await registrar('whatsapp', d.persona.telefonoE164)
  }

  async function guardarCorreo(): Promise<void> {
    const correo = correoNuevo.trim()
    if (!CORREO_VALIDO.test(correo)) {
      setFallo('Ese correo no parece válido.')
      return
    }
    setTrabajando('correo')
    setFallo(null)
    const r = await actualizarPersona(d.persona.id, { email: correo })
    setTrabajando(null)
    if (!r.ok) {
      setFallo(r.motivo)
      return
    }
    setCorreoNuevo('')
    invalidarTrasAccion(cliente, [['visitas', 'aviso', visitaId]])
  }

  async function enviarAutomatico(): Promise<void> {
    setTrabajando('automatico')
    setFallo(null)
    const r = await enviarAvisoAutomatico(visitaId, plantilla)
    setTrabajando(null)
    if (!r.ok) {
      setFallo(r.motivo)
      return
    }
    setHecho(`Correo enviado con la invitación adjunta (envío ${r.datos}).`)
    invalidarTrasAccion(cliente, [['visitas'], ['actividad']])
  }

  const faltantes = aviso.faltantes.map((f) => NOMBRE_PARAMETRO[f] ?? f)
  const mailto = enlaceCorreo(d, aviso)

  return (
    <div className="space-y-4">
      <GrupoChips
        etiqueta="¿Qué aviso?"
        opciones={PLANTILLAS_AVISO}
        valor={plantilla}
        alCambiar={(v) => {
          if (v === null) return
          setPlantilla(v)
          setTextoWa(null)
          setHecho(null)
        }}
        compacto
      />

      {faltantes.length > 0 && (
        <AvisoPendiente>
          Falta cargar en Parámetros: {faltantes.join(', ')}. El aviso sale sin esos datos; no se rellenan
          a mano.
        </AvisoPendiente>
      )}

      {bloqueo !== null ? (
        <p className="rounded-md border border-border p-3 text-sm font-bold leading-snug text-foreground">{bloqueo}</p>
      ) : (
        <>
          <GrupoChips etiqueta="¿Por dónde?" opciones={VIAS} valor={via} alCambiar={(v) => v !== null && setVia(v)} compacto />

          {via === 'whatsapp' && (
            <div className="space-y-2">
              <label htmlFor={idTexto} className="block text-sm font-bold text-suelo">
                Mensaje
              </label>
              <textarea
                id={idTexto}
                value={textoWhatsApp}
                onChange={(e) => setTextoWa(e.target.value)}
                rows={5}
                className={cn(claseCampo, 'h-auto py-2 font-normal')}
              />
              <div className="flex flex-wrap gap-2">
                {d.persona.telefonoE164 !== null && (
                  <Button asChild className="h-11 sm:h-10">
                    <a
                      href={enlaceWhatsApp(d.persona.telefonoE164, textoWhatsApp)}
                      onClick={() => void registrar('whatsapp', d.persona.telefonoE164)}
                    >
                      <MessageCircle aria-hidden="true" />
                      Abrir WhatsApp
                    </a>
                  </Button>
                )}
                <Button variant="outline" className="h-11 sm:h-10" onClick={() => void copiar()}>
                  <Copy aria-hidden="true" />
                  Copiar mensaje
                </Button>
              </div>
              {d.persona.telefonoE164 === null && (
                <p className="text-xs text-suelo-700">No tiene teléfono: copia el mensaje y envíalo por donde te escribió.</p>
              )}
            </div>
          )}

          {via === 'correo' && (
            <div className="space-y-3">
              {d.persona.email === null ? (
                <div className="space-y-2">
                  <label htmlFor={idCorreo} className="block text-sm font-bold text-suelo">
                    No tiene un correo válido registrado. Añádelo primero:
                  </label>
                  <input
                    id={idCorreo}
                    type="email"
                    inputMode="email"
                    value={correoNuevo}
                    onChange={(e) => setCorreoNuevo(e.target.value)}
                    placeholder="nombre@correo.com"
                    className={claseCampo}
                  />
                  <Button
                    className="h-11 sm:h-10"
                    onClick={() => void guardarCorreo()}
                    disabled={trabajando !== null || correoNuevo.trim() === ''}
                  >
                    {trabajando === 'correo' && <Loader2 className="animate-spin" aria-hidden="true" />}
                    Guardar correo
                  </Button>
                </div>
              ) : (
                <>
                  <div className="rounded-md border border-border bg-cal p-3 text-sm">
                    <p className="font-bold text-foreground">Para: {d.persona.email}</p>
                    <p className="mt-1 font-bold text-foreground">{aviso.asunto}</p>
                    <p className="mt-2 whitespace-pre-line text-suelo-700">{aviso.texto}</p>
                  </div>
                  {!correoPermitido && d.motivoNoEnvio !== null && (
                    <AvisoPendiente>{d.motivoNoEnvio}</AvisoPendiente>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {correoPermitido && mailto !== null && (
                      <Button asChild className="h-11 sm:h-10">
                        <a href={mailto} onClick={() => void registrar('email', d.persona.email)}>
                          <Mail aria-hidden="true" />
                          Abrir en mi correo
                        </a>
                      </Button>
                    )}
                    {correoPermitido && (
                      <Button
                        variant="outline"
                        className="h-11 sm:h-10"
                        onClick={() => {
                          descargarIcs(d, plantilla === 'cancelacion' ? 'CANCEL' : 'REQUEST')
                          void registrar('ics', d.persona.email)
                        }}
                      >
                        <Download aria-hidden="true" />
                        Descargar invitación .ics
                      </Button>
                    )}
                    {correoPermitido && automatico.data === true && (
                      <Button
                        variant="outline"
                        className="h-11 sm:h-10"
                        onClick={() => void enviarAutomatico()}
                        disabled={trabajando !== null}
                      >
                        {trabajando === 'automatico' ? (
                          <Loader2 className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Send aria-hidden="true" />
                        )}
                        Enviar automático
                      </Button>
                    )}
                  </div>
                  <p className="text-xs leading-snug text-suelo-700">
                    La invitación .ics se adjunta al correo que abras: así la visita entra en su calendario y,
                    si se reprograma, se mueve en vez de duplicarse.
                    {automatico.data !== true &&
                      ' El envío automático está apagado hasta que se carguen los secretos del proveedor de correo (decisión del 29/09).'}
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}

      <p className="text-xs text-suelo-500">
        Visita del {fechaHora(d.visita.inicioEl)}
        {d.agente.nombre !== null && ` · atiende ${d.agente.nombre}`}
      </p>

      {fallo !== null && <Fallo>{fallo}</Fallo>}
      {hecho !== null && (
        <p role="status" className="flex items-start gap-2 text-sm font-bold text-foreground">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {hecho}
        </p>
      )}
    </div>
  )
}
