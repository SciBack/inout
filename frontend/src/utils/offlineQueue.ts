// Cola local de escaneos (Fase 4 — resiliencia parte B: cero pérdida).
//
// Módulo puro, SIN dependencias de React: importable desde el handler de
// escaneo, desde el estado de desconexión, o desde donde haga falta.
//
// Por qué existe: sin esto, un escaneo hecho mientras el kiosko no tiene
// conexión con el backend simplemente se pierde. Este módulo lo persiste en
// localStorage con su hora REAL de captura (no la de reenvío) y lo reenvía
// en orden cronológico apenas vuelve la conexión — es la hora de captura la
// que hace que el backend calcule bien permanencia, hora punta y aforo, y el
// orden cronológico el que evita que entrada/salida se rompan (ver
// backend/app/routers/scan.py y el plan en
// docs/design/2026-07-24-kiosko-resiliencia-y-campus-origen.md, Fase 4).

const STORAGE_KEY = 'inout_offline_queue'

// Igual que el timeout de handleScan en App.tsx: con red lenta el fetch no
// debe colgar el vaciado indefinidamente.
const FLUSH_TIMEOUT_MS = 5000

export interface QueuedScan {
  clientEventId: string
  cardnumber: string
  spaceId: number | undefined
  scannedAt: string // ISO — hora REAL de captura en el kiosko, no de reenvío
}

export interface FlushResult {
  flushed: number
  remaining: number
}

function readQueue(): QueuedScan[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // localStorage inaccesible o con basura (JSON corrupto): tratar como cola
    // vacía en vez de romper el kiosko. Se pierde lo que hubiera ahí, pero un
    // kiosko que no arranca es peor que una cola vacía.
    return []
  }
}

function writeQueue(items: QueuedScan[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Cuota agotada / modo privado sin storage: no hay dónde persistir. No
    // debe tumbar el flujo de escaneo del kiosko.
  }
}

function removeFromQueue(clientEventId: string): void {
  const queue = readQueue()
  writeQueue(queue.filter((item) => item.clientEventId !== clientEventId))
}

function generateClientEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: no necesita ser criptográficamente fuerte, solo único dentro
  // de la cola de este kiosko.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Encola un escaneo que no se pudo enviar en vivo. Captura la hora real de
 * captura AHORA (no cuando eventualmente se reenvíe) — es lo que el backend
 * usará como `scanned_at` para que permanencia, hora punta y aforo queden
 * correctos aunque el reenvío ocurra minutos u horas después.
 */
export function enqueueOfflineScan(cardnumber: string, spaceId: number | undefined): void {
  const item: QueuedScan = {
    clientEventId: generateClientEventId(),
    cardnumber,
    spaceId,
    scannedAt: new Date().toISOString(),
  }
  const queue = readQueue()
  queue.push(item)
  writeQueue(queue)
}

/** Cuántos escaneos hay pendientes de reenvío en este momento. */
export function getPendingCount(): number {
  return readQueue().length
}

/**
 * Vacía la cola local reenviando al backend EN ORDEN CRONOLÓGICO (por
 * scannedAt), nunca en paralelo: el orden es lo único que garantiza que
 * entrada/salida no se rompan, porque el backend decide entrada/salida
 * mirando el último evento registrado de ese carnet.
 *
 * - Éxito (2xx): el ítem se remueve de la cola persistida de inmediato (no
 *   se espera a terminar todo el vaciado), así un cierre/recarga a mitad de
 *   camino no pierde progreso ni reenvía lo ya confirmado.
 * - Falla de red genuina (fetch lanza, o timeout): se detiene el vaciado ahí
 *   mismo. Ese ítem y todos los siguientes quedan intactos y en su orden
 *   original para el próximo intento — saltarse o reordenar ítems rompería
 *   entrada/salida.
 * - Rechazo permanente del backend (400 scanned_at_invalido, 429
 *   duplicate_scan): reintentar nunca lo arreglaría. Se descarta SOLO ese
 *   ítem (con aviso en consola) y se continúa con el siguiente — un registro
 *   malo no debe matar la corrida entera (misma lección que el bug de sync
 *   arreglado en el commit 6701564 de este repo).
 * - Cualquier otra respuesta del servidor (5xx, etc.): no es ni una falla de
 *   red ni un rechazo permanente conocido. Se trata con la misma cautela que
 *   la falla de red — se detiene el vaciado — para no arriesgar el orden
 *   entrada/salida contra un backend en mal estado.
 */
export async function flushOfflineQueue(): Promise<FlushResult> {
  const ordered = [...readQueue()].sort(
    (a, b) => new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime()
  )

  let flushed = 0

  for (const item of ordered) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS)

    let res: Response
    try {
      res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardnumber: item.cardnumber,
          space_id: item.spaceId ?? null,
          scanned_at: item.scannedAt,
          client_event_id: item.clientEventId,
        }),
        signal: controller.signal,
      })
    } catch {
      clearTimeout(timeoutId)
      break
    }
    clearTimeout(timeoutId)

    if (res.ok) {
      removeFromQueue(item.clientEventId)
      flushed++
      continue
    }

    if (res.status === 400 || res.status === 429) {
      console.warn(
        `offlineQueue: descartando evento ${item.clientEventId} (cardnumber ${item.cardnumber}) — rechazo permanente del backend (HTTP ${res.status})`
      )
      removeFromQueue(item.clientEventId)
      continue
    }

    break
  }

  return { flushed, remaining: getPendingCount() }
}
