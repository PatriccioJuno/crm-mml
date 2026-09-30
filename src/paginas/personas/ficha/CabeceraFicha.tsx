import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, Loader2, UserPlus } from 'lucide-react'
import { Badge } from '@/componentes/ui/badge'
import { Button } from '@/componentes/ui/button'
import { CabeceraPantalla, type Indicador } from '@/componentes/marca/CabeceraPantalla'
import { BotonesContacto } from '@/componentes/crm/BotonesContacto'
import { InsigniaTemperatura } from '@/componentes/crm/InsigniaTemperatura'
import { useSesion } from '@/auth/ContextoSesion'
import { etiquetaSituacion, type FilaCartera } from '@/lib/cartera'
import { reclamarOportunidad } from '@/lib/contacto'
import { etiquetaEstado } from '@/lib/embudo'
import { ESTADOS_VISITA, TIPOS_VISITA } from '@/lib/visitas'
import { diaYHora, diasHasta, fechaCorta, textoVencimiento } from '@/lib/fechas'
import type { PersonaFicha } from './DatosPersona'
import { invalidarTrasAccion, mensajeSugerido, umbralFrioDe, useParametrosContacto } from './PanelContacto'

/**
 * CABECERA DE LA FICHA — SPEC §7 S2.
 *
 * Lo que un vendedor necesita ver ANTES de llamar, sin bajar: quién es, qué
 * tan caliente está, de quién es, qué toca y cuándo fue el último contacto.
 * Por eso esos cuatro datos van como indicadores grandes y no dentro de una
 * tarjeta del cuerpo.
 *
 * Sin oportunidad (un titular cargado desde el inventario) no hay embudo ni
 * responsable: la cabecera solo dice quién es y que no tiene proceso abierto.
 * No se inventan indicadores vacíos para que «parezca» una ficha completa.
 *
 * Los botones de contacto se esconden si la persona pidió no ser contactada
 * (Ley 29733): un botón de WhatsApp visible es una invitación a escribirle.
 */

function etiquetaDe(lista: readonly { valor: string; etiqueta: string }[], valor: string | null): string {
  if (valor === null) return ''
  return lista.find((o) => o.valor === valor)?.etiqueta ?? valor
}

function indicadoresDe(f: FilaCartera): Indicador[] {
  const vencida = (diasHasta(f.proximaTareaVenceEl) ?? 0) < 0
  return [
    {
      titulo: 'Responsable',
      // `null` con responsableId puesto = RLS no deja leer ese perfil: no es «sin dueño».
      valor: f.responsableNombre ?? (f.sinDueno ? 'Sin dueño' : 'No visible'),
      destacado: f.sinDueno,
    },
    {
      titulo: 'Próximo paso',
      valor: f.proximaTareaTitulo ?? 'Sin tarea',
      nota:
        f.proximaTareaVenceEl !== null
          ? textoVencimiento(f.proximaTareaVenceEl)
          : f.situacion === 'activa'
            ? 'Toda oportunidad activa necesita una (R6)'
            : undefined,
      destacado: (f.situacion === 'activa' && f.proximaTareaId === null) || vencida,
    },
    {
      titulo: 'Visita',
      valor: f.visitaInicioEl !== null ? diaYHora(f.visitaInicioEl) : 'Sin visita',
      nota:
        f.visitaInicioEl !== null
          ? [etiquetaDe(TIPOS_VISITA, f.visitaTipo), etiquetaDe(ESTADOS_VISITA, f.visitaEstado)]
              .filter((t) => t !== '')
              .join(' · ')
          : undefined,
    },
    {
      titulo: 'Sin contacto',
      valor:
        f.totalContactos === 0
          ? 'Nunca'
          : f.diasSinContacto === null
            ? '—'
            : f.diasSinContacto === 1
              ? '1 día'
              : `${f.diasSinContacto} días`,
      nota:
        f.fechaUltimoContacto !== null
          ? `Último: ${fechaCorta(f.fechaUltimoContacto)}`
          : `Entró el ${fechaCorta(f.fechaIngreso)}`,
    },
  ]
}

export function CabeceraFicha({
  persona,
  fila,
  selector,
  alTomado,
}: {
  persona: PersonaFicha | null
  /** La oportunidad que se está viendo; `null` si la persona no tiene ninguna. */
  fila: FilaCartera | null
  /** El selector de oportunidades, si hay más de una (va en la franja de pestañas). */
  selector?: ReactNode | undefined
  alTomado?: (() => void) | undefined
}) {
  const { rol, perfil } = useSesion()
  const cliente = useQueryClient()
  const parametros = useParametrosContacto()
  const [tomando, setTomando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nombre = fila?.nombreCompleto ?? persona?.nombreCompleto ?? 'Persona'
  const telefono = fila?.telefonoE164 ?? persona?.telefonoE164 ?? null
  const noContactar = fila?.noContactar === true || (persona !== null && persona.noContactarEl !== null)
  const puedeTomar =
    fila !== null && fila.sinDueno && (rol === 'comercial' || rol === 'direccion' || rol === 'administracion')

  async function tomar() {
    if (fila === null) return
    setTomando(true)
    setError(null)
    const r = await reclamarOportunidad(fila.id)
    setTomando(false)
    if (!r.ok) return setError(r.motivo)
    invalidarTrasAccion(cliente, [['bandeja'], ['perfil', fila.id]])
    alTomado?.()
  }

  const migaja = (
    <Link to="/personas" className="inline-flex min-h-11 items-center gap-1 text-cal hover:underline sm:min-h-0">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Personas
    </Link>
  )

  const distintivos = (
    <>
      {fila !== null ? (
        <>
          <InsigniaTemperatura temperatura={fila.temperatura} motivo={fila.temperaturaMotivo} sobreAzul />
          <Badge variant="cal">{etiquetaEstado(fila.estado)}</Badge>
          {fila.situacion !== 'activa' && <Badge variant="outlineCal">{etiquetaSituacion(fila.situacion)}</Badge>}
          {fila.campanaNombre !== null && <Badge variant="outlineCal">{fila.campanaNombre}</Badge>}
        </>
      ) : (
        <Badge variant="outlineCal">Sin oportunidad comercial</Badge>
      )}
      {noContactar && (
        <Badge variant="outlineCal" className="gap-1">
          <Ban className="h-3.5 w-3.5" aria-hidden="true" />
          No contactar
        </Badge>
      )}
    </>
  )

  const agente = perfil?.nombre ?? null
  const mensaje = fila !== null ? mensajeSugerido(fila, agente, umbralFrioDe(parametros.data)) : undefined

  const acciones = (
    <div className="flex flex-wrap items-center gap-2">
      {!noContactar && telefono !== null && (
        <BotonesContacto
          telefonoE164={telefono}
          usuarioRed={fila?.usuarioRed ?? persona?.usuarioRed ?? null}
          redSocial={fila?.redSocial ?? persona?.redSocial ?? null}
          mensaje={mensaje}
          sobreAzul
        />
      )}
      {puedeTomar && (
        <Button variant="ambar" className="h-11" disabled={tomando} onClick={() => void tomar()}>
          {tomando ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus className="h-4 w-4" aria-hidden="true" />
          )}
          Tomar
        </Button>
      )}
      {error !== null && (
        <p role="alert" className="w-full rounded-md bg-alerta-suave p-2 text-sm font-bold text-alerta">
          {error}
        </p>
      )}
    </div>
  )

  return (
    <CabeceraPantalla
      migaja={migaja}
      titulo={nombre}
      descripcion={
        fila === null
          ? 'No tiene un proceso comercial abierto en el CRM.'
          : fila.entroSolo
            ? 'Llegó sola (web)'
            : undefined
      }
      distintivos={distintivos}
      acciones={acciones}
      {...(fila !== null ? { indicadores: indicadoresDe(fila) } : {})}
      {...(selector !== undefined ? { pestanas: selector } : {})}
    />
  )
}
