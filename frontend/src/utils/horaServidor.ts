// Hora del servidor (19-nov-2026). Un terminal del CRAI tenía el reloj del sistema 5 horas atrasado: el reloj
// grande y los anillos de las salas salían mal. Con cada respuesta del tablero (cada 5 s) se toma la cabecera
// «Date» del servidor y la pantalla usa esa hora, no la del equipo.
let desfase = 0

export function anotarHoraServidor(res: Response): void {
  const t = Date.parse(res.headers.get('date') ?? '')
  if (!Number.isNaN(t)) desfase = t - Date.now()
}

export function ahoraServidor(): Date {
  return new Date(Date.now() + desfase)
}
