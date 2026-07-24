import { useEffect, useState } from 'react'
import { isDaytime } from '../utils/sunTimes'

/**
 * Modo día/noche real del kiosko, según la ubicación geográfica de la sede.
 *
 * Sin coordenadas (sede sin lat/lon cargadas todavía por el admin) cae
 * SIEMPRE a 'night' — es el look oscuro que el kiosko siempre tuvo, cero
 * regresión visual el día que esto se despliegue antes de que alguien cargue
 * coordenadas.
 *
 * Con coordenadas, calcula al montar y recalcula cada 60s: el kiosko queda
 * encendido días enteros, no hace falta más precisión que eso para un
 * cambio de tema visual.
 */
export function useDayNightMode(lat: number | null, lon: number | null): 'day' | 'night' {
  const [mode, setMode] = useState<'day' | 'night'>(() =>
    lat !== null && lon !== null ? (isDaytime(lat, lon) ? 'day' : 'night') : 'night'
  )

  useEffect(() => {
    if (lat === null || lon === null) {
      setMode('night')
      return
    }

    const recompute = () => setMode(isDaytime(lat, lon, new Date()) ? 'day' : 'night')
    recompute()

    const id = setInterval(recompute, 60000)
    return () => clearInterval(id)
  }, [lat, lon])

  return mode
}
