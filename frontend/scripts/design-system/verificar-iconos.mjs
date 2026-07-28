#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// COPIA de sciback-design-system/canonico/scripts/verificar-iconos.mjs
// Sincronizado el 2026-07-28. NO se edita aquí: se arregla en el design system y se
// vuelve a sincronizar con `node scripts/sincronizar-verificadores.mjs <frontend>`.
//
// Para saber si se descolgó:
//   diff scripts/design-system/verificar-iconos.mjs \
//        ~/proyectos/sciback/sciback-design-system/canonico/scripts/verificar-iconos.mjs
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Verifica que un producto use UN SOLO pack de iconos: `reicon-react`.
 *
 * Por qué hace falta: el 27-jul-2026 se midió el ecosistema y había DOS packs en
 * uso —`@tabler/icons-react` en el RIMS y `lucide-react` en QuipuQ— más un tercero
 * propuesto. Ningún type-check ni linter dice nada: cada import es válido por sí
 * mismo. Lo que se rompe es la coherencia entre pantallas, y eso no se nota hasta
 * que dos productos se ven distintos al lado.
 *
 * `lucide-react` se admite como LEGADO mientras quede código sin migrar, y se
 * reporta con su cuenta para que la migración tenga una barra de progreso: el
 * número solo puede bajar. Un producto NUEVO no debería tener ninguno.
 *
 * Uso:  node scripts/verificar-iconos.mjs <ruta-del-producto> [--sin-legado]
 * Sale 1 si hay un pack prohibido, o si con `--sin-legado` queda algún import de
 * `lucide-react`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// El pack de la casa es *reicon*, con un build por framework. Añadido 2026-07-27
// al auditar el SGC: es Vue, y el verificador solo conocía el build de React, así
// que un producto podía usar el pack correcto y salir como si no usara ninguno.
const CASA = ['reicon-react', 'reicon-vue']
const LEGADO = 'lucide-react'

// Iconos por CLASE CSS, no por import. Los emiten plugins como el `lucideIconsPlugin`
// del preset de frappe-ui: `<span class="lucide-award" />`. Descubierto 2026-07-27 en
// el SGC, donde el verificador daba OK con «0 ficheros con reicon-react» porque miraba
// solo imports y package.json — y la pantalla estaba llena de iconos lucide.
const CLASES_ICONO = [
  { pack: 'lucide', re: /\b(?:i-)?lucide-[a-z0-9-]+\b/g, legado: true },
  { pack: '@tabler/icons', re: /\b(?:i-)?tabler-[a-z0-9-]+\b/g, legado: false },
  { pack: 'reicon', re: /\b(?:i-)?reicon-[a-z0-9-]+\b/g, legado: false, esCasa: true },
]

// `lucide-react` dentro de un import encaja con el patrón de clase `lucide-*`, y sin
// esto un producto React que usa el legado por import se contaba DOS veces y pasaba a
// fallar. Le ocurrió a Pulso DTI al estrenar la detección por clase: 26 «clases CSS»
// que en realidad eran su import. El sufijo de framework distingue paquete de clase.
const SUFIJOS_DE_PAQUETE = /-(react|vue|vue-next|svelte|preact|solid|angular)$/
const esNombreDePaquete = (token) => SUFIJOS_DE_PAQUETE.test(token)
// Packs que NO se aceptan ni siquiera como legado: nunca fueron la norma, y
// tenerlos significa que alguien instaló un pack por conveniencia de un día.
const PROHIBIDOS = [
  '@tabler/icons-react',
  'react-icons',
  '@heroicons/react',
  '@phosphor-icons/react',
  '@ant-design/icons',
  'react-feather',
]

const IGNORAR = new Set(['node_modules', 'dist', 'build', '.git', '.astro', 'coverage'])
const EXTENSIONES = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte']

function archivos(dir, acc = []) {
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue
    const ruta = join(dir, entrada)
    const info = statSync(ruta)
    if (info.isDirectory()) archivos(ruta, acc)
    else if (EXTENSIONES.some((e) => entrada.endsWith(e))) acc.push(ruta)
  }
  return acc
}

/** Importa `paquete` en este fichero (import estático, dinámico o require). */
function importa(contenido, paquete) {
  const esc = paquete.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(String.raw`(?:from|import|require\()\s*['"]${esc}(?:/[^'"]*)?['"]`).test(contenido)
}

const raiz = process.argv[2]
const sinLegado = process.argv.includes('--sin-legado')
if (!raiz || !existsSync(raiz)) {
  console.error('uso: node scripts/verificar-iconos.mjs <ruta-del-producto> [--sin-legado]')
  process.exit(2)
}

// También el `package.json`: un pack DECLARADO acaba usándose aunque hoy no lo
// importe nadie. Encontrado el 27-jul-2026 — QuipuQ tenía `lucide-react` instalado
// y cero imports; el verificador lo daba por limpio y en la siguiente pantalla
// alguien lo habría usado sin saber que no era el de la casa.
function paquetesDeclarados(dir) {
  for (const candidato of [join(dir, 'package.json'), join(dir, '..', 'package.json')]) {
    if (!existsSync(candidato)) continue
    const json = JSON.parse(readFileSync(candidato, 'utf8'))
    return { ruta: candidato, deps: { ...json.dependencies, ...json.devDependencies } }
  }
  return null
}

const declarado = paquetesDeclarados(raiz)

const fuentes = archivos(raiz)
const prohibidos = []
const legado = []
const porClase = new Map() // pack -> nº de ficheros que lo usan por clase CSS
let conCasa = 0

for (const ruta of fuentes) {
  const contenido = readFileSync(ruta, 'utf8')
  for (const paquete of PROHIBIDOS) {
    if (importa(contenido, paquete)) prohibidos.push(`${ruta}: ${paquete}`)
  }
  if (importa(contenido, LEGADO)) legado.push(ruta)
  if (CASA.some((p) => importa(contenido, p))) conCasa += 1

  for (const { pack, re, legado: esLegado, esCasa } of CLASES_ICONO) {
    re.lastIndex = 0 // el flag /g mantiene estado entre ficheros
    const clases = (contenido.match(re) ?? []).filter((t) => !esNombreDePaquete(t))
    if (!clases.length) continue
    porClase.set(pack, (porClase.get(pack) ?? 0) + 1)
    if (esCasa) conCasa += 1
    else if (esLegado) legado.push(`${ruta} (clase CSS ${pack}-*)`)
    else prohibidos.push(`${ruta}: clase CSS ${pack}-* (pack ajeno)`)
  }
}

if (declarado) {
  for (const paquete of PROHIBIDOS) {
    if (declarado.deps[paquete]) prohibidos.push(`${declarado.ruta}: declara ${paquete}`)
  }
  if (declarado.deps[LEGADO] && !legado.length) {
    console.warn(
      `iconos: ${declarado.ruta} declara ${LEGADO} y no lo importa nadie — desinstálalo ` +
        'antes de que alguien lo use por costumbre.',
    )
  }
}

// Cero iconos de la casa y sí de otro pack. Es AVISO, no fallo: el método tolera
// `lucide` como legado a propósito («la barra de progreso de la migración, y solo
// puede bajar»), así que convertirlo en error rompería a los productos que aún no
// migraron. Lo que sí era un bug —y esto lo arregla— es que ni siquiera se veía:
// el SGC reportaba «0 ficheros con reicon-react · OK» con 12 ficheros llenos de
// iconos lucide por clase CSS, porque solo se mirabann imports y package.json.
if (conCasa === 0 && legado.length > 0) {
  const detalle = [...porClase].map(([p, n]) => `${p}: ${n} fichero(s)`).join(' · ')
  console.warn(
    `iconos: aviso — ningún icono de la casa (${CASA.join(' | ')}) y ${legado.length} uso(s) de legado.` +
      (detalle ? `\n  detectado por clase CSS — ${detalle}` : '') +
      '\n  Migración pendiente; con --sin-legado esto falla.',
  )
}

if (prohibidos.length) {
  console.error(`iconos: ${prohibidos.length} import(s) de un pack que no es de la casa (${CASA}):`)
  for (const linea of prohibidos.slice(0, 25)) console.error(`- ${linea}`)
  if (prohibidos.length > 25) console.error(`  … y ${prohibidos.length - 25} más`)
  process.exit(1)
}

if (legado.length && sinLegado) {
  console.error(`iconos: quedan ${legado.length} fichero(s) con ${LEGADO}, y se pidió --sin-legado.`)
  for (const ruta of legado.slice(0, 25)) console.error(`- ${ruta}`)
  process.exit(1)
}

const resumen = [`${conCasa} fichero(s) con reicon`]
if (legado.length) resumen.push(`${legado.length} con lucide (legado, solo puede bajar)`)
if (!conCasa && !legado.length) resumen.push('sin iconos detectados')
console.log(`iconos: OK — ${resumen.join(' · ')}`)
process.exit(0)
