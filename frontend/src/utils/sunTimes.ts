// Amanecer/atardecer astronómico real por coordenadas — sin API externa.
//
// Por qué sin API: un kiosko no puede depender de que un servicio de terceros
// esté arriba para saber si debe verse claro u oscuro. La fórmula NOAA de baja
// precisión (~1 min de error) corre offline con el reloj del dispositivo,
// siempre disponible. Referencia: NOAA Solar Calculator / Jean Meeus,
// "Astronomical Algorithms" — matemática astronómica de dominio público, el
// mismo cálculo que usan los widgets de clima y los relojes de pared solares.

export interface SunTimes {
  sunrise: Date
  sunset: Date
}

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/** Día juliano (para el mediodía UTC de la fecha dada, sin hora). */
function julianDay(date: Date): number {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  const a = Math.floor((14 - m) / 12)
  const y2 = y + 4800 - a
  const m2 = m + 12 * a - 3
  return (
    d +
    Math.floor((153 * m2 + 2) / 5) +
    365 * y2 +
    Math.floor(y2 / 4) -
    Math.floor(y2 / 100) +
    Math.floor(y2 / 400) -
    32045
  )
}

/**
 * Amanecer y atardecer para una fecha + coordenadas, en hora LOCAL del
 * navegador (Date en UTC internamente, se muestra según la zona del cliente).
 *
 * Devuelve null si el sol no sale o no se pone ese día (círculo polar) — caso
 * de borde real que NO debe romper el kiosko: quien llame a esto debe caer a
 * un modo por defecto (ver useDayNightMode).
 */
export function getSunTimes(lat: number, lon: number, date: Date = new Date()): SunTimes | null {
  const jd = julianDay(date)
  const n = jd - 2451545.0 + 0.0008

  // Tiempo solar medio aproximado
  const meanSolarTime = n - lon / 360

  // Anomalía solar media
  const M = (357.5291 + 0.98560028 * meanSolarTime) % 360
  const Mrad = toRad(M)

  // Ecuación del centro
  const C =
    1.9148 * Math.sin(Mrad) +
    0.02 * Math.sin(2 * Mrad) +
    0.0003 * Math.sin(3 * Mrad)

  // Longitud eclíptica
  const lambda = (M + 102.9372 + C + 180) % 360
  const lambdaRad = toRad(lambda)

  // Tiempo solar verdadero (para el mediodía solar)
  const Jtransit = 2451545.0 + meanSolarTime + 0.0053 * Math.sin(Mrad) - 0.0069 * Math.sin(2 * lambdaRad)

  // Declinación solar
  const sinDelta = Math.sin(lambdaRad) * Math.sin(toRad(23.4397))
  const delta = Math.asin(sinDelta)

  // Ángulo horario (altitud del sol = -0.833°, refracción atmosférica estándar)
  const latRad = toRad(lat)
  const cosH =
    (Math.sin(toRad(-0.833)) - Math.sin(latRad) * Math.sin(delta)) /
    (Math.cos(latRad) * Math.cos(delta))

  if (cosH > 1 || cosH < -1) return null // sol siempre abajo o siempre arriba

  const H = toDeg(Math.acos(cosH))

  const Jrise = Jtransit - H / 360
  const Jset = Jtransit + H / 360

  return {
    sunrise: julianToDate(Jrise),
    sunset: julianToDate(Jset),
  }
}

function julianToDate(jd: number): Date {
  const millis = (jd - 2440587.5) * 86400000
  return new Date(millis)
}

/** ¿Es de día ahora mismo en esas coordenadas? */
export function isDaytime(lat: number, lon: number, now: Date = new Date()): boolean {
  const times = getSunTimes(lat, lon, now)
  if (!times) return true // círculo polar: caer a "día" (más común en la práctica que oscuridad total)
  return now >= times.sunrise && now < times.sunset
}
