import { useId, useState } from 'react'
import { Check, Copy, MessageCircle } from 'lucide-react'
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
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { cn } from '@/lib/utils'
import type { FilaCartera } from '@/lib/cartera'
import {
  PLANTILLAS,
  armarMensaje,
  datosDesdeCartera,
  esIdPlantilla,
  plantillaSugerida,
  type IdPlantilla,
} from '@/lib/plantillas'
import { enlaceWhatsApp } from '@/lib/whatsapp'
import { copiarAlPortapapeles } from '@/lib/cobranza'

/**
 * MENSAJE SUGERIDO — elegir una plantilla, retocarla y abrir WhatsApp.
 *
 * Las plantillas (src/lib/plantillas.ts) ya vienen escritas para cumplir
 * 07-crm/CLAUDE.md y SPEC §2: de usted, 2–3 líneas, sin distrito, sin precio,
 * sin cuotas, sin «últimos cupos», sin pedir dinero ni DNI. La que se propone
 * es la de `plantillaSugerida` (escalera de seguimiento de analisis/sales.md
 * §3), pero el vendedor elige otra si la conversación va por otro lado.
 *
 * Se puede editar el texto, porque ninguna plantilla sabe lo que la persona
 * contestó ayer. Pero si se edita, al registro va `<id>_editada`: la columna
 * `interacciones.plantilla` existe para auditar lo que se le dijo al cliente
 * (SPEC §4.2), y un texto retocado ya no es la plantilla revisada.
 *
 * Abrir WhatsApp NO registra el contacto (mismo criterio que BotonesContacto):
 * solo marca qué mensaje se usó, y se guarda con el próximo «Registrar».
 */

export function DialogoMensaje({
  abierto,
  alCerrar,
  fila,
  agente,
  umbralFrio,
  alUsar,
}: {
  abierto: boolean
  alCerrar: () => void
  fila: FilaCartera
  agente: string | null
  umbralFrio: number | null
  /** Recibe el id para `registrarContacto({ plantilla })`: el de la plantilla o `<id>_editada`. */
  alUsar: (idParaRegistro: string) => void
}) {
  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="sm:max-w-lg">
        {/* El contenido se monta al abrir: así cada apertura empieza en la
            plantilla sugerida para el estado ACTUAL del lead, no en la de la
            vez anterior. */}
        {abierto && (
          <Contenido fila={fila} agente={agente} umbralFrio={umbralFrio} alUsar={alUsar} alCerrar={alCerrar} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Contenido({
  fila,
  agente,
  umbralFrio,
  alUsar,
  alCerrar,
}: {
  fila: FilaCartera
  agente: string | null
  umbralFrio: number | null
  alUsar: (idParaRegistro: string) => void
  alCerrar: () => void
}) {
  const idPlantilla = useId()
  const idTexto = useId()
  const datos = datosDesdeCartera(fila, agente)
  const sugerida = plantillaSugerida({
    totalContactos: fila.totalContactos,
    intentosSinRespuesta: fila.intentosSinRespuesta,
    situacion: fila.situacion,
    origen: fila.origen,
    entroSolo: fila.entroSolo,
    umbralFrio,
  })

  const [plantilla, setPlantilla] = useState<IdPlantilla>(sugerida)
  const [texto, setTexto] = useState(() => armarMensaje(sugerida, datos))
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null)

  const original = armarMensaje(plantilla, datos)
  const editado = texto.trim() !== original.trim()
  const idParaRegistro = editado ? `${plantilla}_editada` : plantilla
  const telefono = fila.telefonoE164

  function cambiarPlantilla(valor: string): void {
    if (!esIdPlantilla(valor)) return
    setPlantilla(valor)
    setTexto(armarMensaje(valor, datos))
    setCopiado(null)
  }

  async function copiar(): Promise<void> {
    const ok = await copiarAlPortapapeles(texto)
    setCopiado(ok ? 'si' : 'no')
    if (ok) alUsar(idParaRegistro)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-black">Mensaje sugerido</DialogTitle>
        <DialogDescription>
          Para {fila.nombreCompleto}. Se abre en tu WhatsApp; el contacto lo registras tú después,
          diciendo cómo fue.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={idPlantilla} className="block text-sm font-bold text-suelo">
            Plantilla
          </label>
          <select
            id={idPlantilla}
            value={plantilla}
            onChange={(e) => cambiarPlantilla(e.target.value)}
            className={claseCampo}
          >
            {PLANTILLAS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.etiqueta}
                {p.id === sugerida ? ' (sugerida)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={idTexto} className="block text-sm font-bold text-suelo">
            Texto {editado && <span className="font-normal text-suelo-700">· editado</span>}
          </label>
          <textarea
            id={idTexto}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              setCopiado(null)
            }}
            rows={5}
            className={cn(claseCampo, 'h-auto py-2 font-normal')}
          />
          <AvisoPendiente className="text-xs">
            Si lo retocas, no agregues precio, cuotas, rentabilidad, fechas de entrega, el distrito ni
            «últimos cupos», y no pidas dinero ni DNI por aquí (07-crm/CLAUDE.md §2). Queda registrado
            como plantilla editada.
          </AvisoPendiente>
        </div>

        {copiado === 'si' && (
          <p role="status" className="flex items-center gap-2 text-xs font-bold text-suelo-700">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Copiado. Pégalo en el chat.
          </p>
        )}
        {copiado === 'no' && (
          <p role="alert" className="text-xs font-bold text-alerta">
            El navegador no dejó copiar. Selecciona el texto y cópialo a mano.
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" className="h-11 sm:h-10" onClick={alCerrar}>
          Cerrar
        </Button>
        <Button variant="outline" className="h-11 sm:h-10" onClick={() => void copiar()}>
          <Copy aria-hidden="true" />
          Copiar mensaje
        </Button>
        {telefono !== null && (
          <Button asChild className="h-11 sm:h-10">
            <a href={enlaceWhatsApp(telefono, texto)} onClick={() => alUsar(idParaRegistro)}>
              <MessageCircle aria-hidden="true" />
              Abrir WhatsApp
            </a>
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
