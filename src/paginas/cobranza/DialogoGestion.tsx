import { useEffect, useState } from 'react'
import { AlertTriangle, Copy, Loader2 } from 'lucide-react'
import { claseCampo } from '@/componentes/ui/input'
import { Button } from '@/componentes/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog'
import { Label } from '@/componentes/ui/label'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import {
  CANALES_GESTION,
  copiarAlPortapapeles,
  mensajeDeCobranza,
  personaDelContrato,
  registrarGestion,
  type CanalGestion,
  type FilaCobranza,
} from '@/lib/cobranza'

/**
 * LA GESTIÓN DE COBRANZA — el mensaje se copia; la gestión se registra.
 *
 * ===========================================================================
 * NO SE CONECTA CON WHATSAPP, Y ES A PROPÓSITO
 * ===========================================================================
 * El encargo pide copiar y pegar. Además, abrir `wa.me/<teléfono>` mandaría el
 * número de un tercero a un dominio externo sin que nadie lo haya decidido
 * (Ley 29733; ver 01-documentacion\05-SEGURIDAD-BACKUPS-Y-LEY-29733.md). Aquí
 * el texto va al portapapeles y la persona lo pega donde quiera.
 *
 * ===========================================================================
 * COPIAR NO ES GESTIONAR
 * ===========================================================================
 * Son dos botones separados y en ese orden: copiar el texto no registra nada,
 * porque copiar no es lo mismo que haber escrito al socio. La interacción se
 * escribe cuando la persona dice que ya lo hizo, y por el canal que dice. Si
 * se registrara sola al copiar, `v_actividad_diaria` —y con ella la parte 1
 * del reporte de 7 partes— contaría gestiones que nunca ocurrieron.
 *
 * Si el navegador no deja copiar (sin HTTPS, sin permiso), se enseña el texto
 * para copiarlo a mano en vez de decir que ya se copió.
 */
export function DialogoGestion({
  fila,
  cerrar,
  alRegistrar,
}: {
  fila: FilaCobranza
  cerrar: () => void
  alRegistrar: () => void
}) {
  const { perfil } = useSesion()

  const [personaId, setPersonaId] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(true)
  const [canal, setCanal] = useState<CanalGestion>('whatsapp')
  const [resumen, setResumen] = useState('')
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const texto = mensajeDeCobranza(fila)

  // `v_cobranza` no trae `persona_id` y `interacciones.persona_id` es NOT NULL.
  useEffect(() => {
    let vivo = true
    personaDelContrato(fila.contratoId)
      .then((id) => {
        if (!vivo) return
        setPersonaId(id)
        if (id === null) {
          setError(
            'No se pudo averiguar a qué persona pertenece este contrato, así que la gestión no ' +
              'se puede registrar contra nadie. El mensaje sí se puede copiar.',
          )
        }
      })
      .catch((fallo: unknown) => {
        if (!vivo) return
        setError(fallo instanceof Error ? fallo.message : String(fallo))
      })
      .finally(() => {
        if (vivo) setBuscando(false)
      })

    return () => {
      vivo = false
    }
  }, [fila.contratoId])

  async function copiar() {
    const ok = await copiarAlPortapapeles(texto)
    setCopiado(ok ? 'si' : 'no')
  }

  async function guardar() {
    if (guardando || personaId === null) return

    // `actor_id` va explícito: una gestión sin autor no demuestra nada (R9).
    if (perfil === null) {
      setError('No hay perfil en sesión. Vuelve a entrar al CRM.')
      return
    }

    setGuardando(true)
    setError(null)

    const canalEtiqueta = CANALES_GESTION.find((c) => c.valor === canal)?.etiqueta ?? canal
    const escrito = resumen.trim()
    const resultado = await registrarGestion(
      personaId,
      canal,
      escrito === ''
        ? `Gestión de cobranza por ${canalEtiqueta}: cuota n.º ${fila.numero}.`
        : escrito,
      perfil.id,
    )
    setGuardando(false)

    if (!resultado.ok) {
      setError(resultado.motivo)
      return
    }
    alRegistrar()
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gestión de cobranza</DialogTitle>
          <DialogDescription>
            {fila.nombreCompleto} · cuota n.º {fila.numero}
            {fila.telefono === null ? ' · sin teléfono registrado' : ` · ${fila.telefono}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mensaje">Mensaje para copiar y pegar</Label>
            <p
              id="mensaje"
              className="rounded-md border border-border bg-cal p-3 text-sm leading-snug text-suelo-700"
            >
              {texto}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => void copiar()}>
                <Copy strokeWidth={1.75} aria-hidden="true" />
                Copiar mensaje
              </Button>
              {copiado === 'si' && (
                <span className="text-xs font-bold text-suelo-700">Copiado al portapapeles.</span>
              )}
              {copiado === 'no' && (
                <span className="text-xs font-bold text-alerta">
                  El navegador no dejó copiar. Selecciónalo arriba y cópialo a mano.
                </span>
              )}
            </div>
            <p className="text-xs leading-snug text-suelo-500">
              No lleva recargos ni intereses de mora: no están definidos en ningún sitio, y este
              CRM no los va a estrenar en un mensaje de WhatsApp.
            </p>
          </div>

          <hr className="border-tinta-fila" />

          <div className="space-y-2">
            <Label htmlFor="canal">Canal de la gestión</Label>
            <select
              id="canal"
              value={canal}
              onChange={(e) => setCanal(e.target.value as CanalGestion)}
              className={claseCampo}
            >
              {CANALES_GESTION.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.etiqueta}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="resumen">Qué pasó (opcional)</Label>
            <textarea
              id="resumen"
              value={resumen}
              onChange={(e) => setResumen(e.target.value)}
              rows={2}
              placeholder="Se le escribió, quedó en pagar el viernes…"
              className={cn(claseCampo, 'h-auto py-2')}
            />
            <p className="text-xs leading-snug text-suelo-500">
              Se escribe en <code>interacciones</code> con tu nombre y la fecha. Es lo que
              convierte «se le insistió varias veces» en algo que se puede demostrar — y alimenta
              la parte 1 del reporte semanal.
            </p>
          </div>
        </div>

        {error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-3 text-sm font-bold leading-snug text-alerta"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={cerrar} disabled={guardando}>
            Cerrar sin registrar
          </Button>
          <Button
            onClick={() => void guardar()}
            disabled={guardando || buscando || personaId === null}
          >
            {guardando ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Registrando…
              </>
            ) : (
              'Registrar la gestión'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
