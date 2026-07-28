#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// COPIA de sciback-design-system/canonico/scripts/verificar-stack.mjs
// Sincronizado el 2026-07-28. NO se edita aquí: se arregla en el design system y se
// vuelve a sincronizar con `node scripts/sincronizar-verificadores.mjs <frontend>`.
//
// Para saber si se descolgó:
//   diff scripts/design-system/verificar-stack.mjs \
//        ~/proyectos/sciback/sciback-design-system/canonico/scripts/verificar-stack.mjs
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Verifica que un producto use el stack de la casa y no otra librería de componentes.
 *
 * Por qué hace falta: el documento describía el stack desde el 20-jul-2026 y admitía
 * «ambos caminos». Medido el 27-jul, NINGÚN producto lo cumplía entero — el RIMS iba
 * con Mantine y tokens `--sb-*`, QuipuQ con Radix pero tokens propios `--qq-*`. Una
 * política que solo vive en un `.md` la incumple todo el mundo de buena fe, porque
 * nadie relee el manual antes de instalar un paquete.
 *
 * Lo que mira, en este orden:
 *   1. librerías de componentes ajenas (Mantine, MUI, Ant, Chakra…) — error
 *   2. Tailwind presente — error si falta
 *   3. tokens propios `--xx-*` en vez de los canónicos `--sb-*` — aviso con su cuenta
 *
 * Uso:  node scripts/verificar-stack.mjs <ruta-del-producto> [--permitir-legado mantine]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const AJENAS = {
  '@mantine/core': 'Mantine',
  '@mui/material': 'MUI',
  antd: 'Ant Design',
  '@chakra-ui/react': 'Chakra',
  'react-bootstrap': 'React-Bootstrap',
  '@blueprintjs/core': 'Blueprint',
}
const EXIGIDAS = ['tailwindcss']

const IGNORAR = new Set(['node_modules', 'dist', 'build', '.git', '.astro', 'coverage'])
const EXT = ['.ts', '.tsx', '.js', '.jsx', '.css']

function archivos(dir, acc = []) {
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue
    const ruta = join(dir, entrada)
    const info = statSync(ruta)
    if (info.isDirectory()) archivos(ruta, acc)
    else if (EXT.some((e) => entrada.endsWith(e))) acc.push(ruta)
  }
  return acc
}

function paquete(dir) {
  for (const candidato of [join(dir, 'package.json'), join(dir, '..', 'package.json')]) {
    if (existsSync(candidato)) {
      const json = JSON.parse(readFileSync(candidato, 'utf8'))
      return { ruta: candidato, deps: { ...json.dependencies, ...json.devDependencies } }
    }
  }
  return null
}

const raiz = process.argv[2]
const legadoPermitido = (() => {
  const i = process.argv.indexOf('--permitir-legado')
  return i >= 0 ? (process.argv[i + 1] ?? '').toLowerCase() : ''
})()

if (!raiz || !existsSync(raiz)) {
  console.error('uso: node scripts/verificar-stack.mjs <ruta-del-producto> [--permitir-legado mantine]')
  process.exit(2)
}

const pkg = paquete(raiz)
const problemas = []
const avisos = []

if (pkg) {
  for (const [dep, nombre] of Object.entries(AJENAS)) {
    if (!pkg.deps[dep]) continue
    // El legado se permite por nombre explícito y SOLO durante una migración con plan.
    if (legadoPermitido && nombre.toLowerCase().includes(legadoPermitido)) {
      avisos.push(`${nombre} sigue instalado como legado — la migración no ha terminado`)
    } else {
      problemas.push(`${pkg.ruta}: usa ${nombre}; la casa es shadcn/ui (ui.shadcn.com)`)
    }
  }
  for (const dep of EXIGIDAS) {
    if (!pkg.deps[dep]) problemas.push(`${pkg.ruta}: falta ${dep}, que es la capa de estilos de la casa`)
  }
}

// Tokens: los canónicos son los de `canonico/tokens.css`, y se llaman `--color-*`
// porque es el espacio de nombres que Tailwind 4 convierte en utilidades (`bg-fondo`,
// `text-tinta`). Un prefijo propio significa que el producto se hizo su propio sistema
// y ya no comparte nada con los demás, que es como QuipuQ acabó con `--qq-*`
// cumpliendo el stack y sin cumplir el diseño.
//
// CORREGIDO el 28-jul-2026. La versión anterior decía «los canónicos son --sb-*» y
// dejaba pasar ese prefijo sin mirar. `--sb-*` no está definido en NINGÚN sitio del
// design system: es un nombre que el RIMS se inventó, con sus propios hexes, exactamente
// igual que QuipuQ con `--qq-*`. Es decir, el verificador daba por bueno al RIMS por el
// nombre del prefijo, no por su origen — el fallo que este script existe para evitar.
// Además el patrón `[a-z]{2,4}` no podía ni capturar `color`, así que los tokens buenos
// eran invisibles para él.
const CANONICO = 'color'
// Espacios de nombres de `@theme` que define el propio Tailwind: no son invención del
// producto, son la forma documentada de configurar fuentes, tamaños y demás.
const TAILWIND = new Set([
  'font', 'text', 'spacing', 'radius', 'shadow', 'breakpoint', 'container',
  'tracking', 'leading', 'ease', 'animate', 'blur', 'perspective', 'aspect', 'tw',
])
// Prefijos de otras librerías presentes por convivencia, no por decisión de diseño.
const AJENOS_TOLERADOS = new Set(['mantine', 'radix'])

const propios = new Map()
for (const ruta of archivos(raiz)) {
  const contenido = readFileSync(ruta, 'utf8')
  for (const [, prefijo] of contenido.matchAll(/--([a-z]{2,}?)-[a-z][\w-]*\s*:/g)) {
    if (prefijo === CANONICO || TAILWIND.has(prefijo) || AJENOS_TOLERADOS.has(prefijo)) continue
    propios.set(prefijo, (propios.get(prefijo) ?? 0) + 1)
  }
}
for (const [prefijo, n] of propios) {
  if (n >= 5) avisos.push(`${n} tokens propios --${prefijo}-* : los canónicos son --color-*`)
}

for (const aviso of avisos) console.warn(`stack: aviso — ${aviso}`)

if (problemas.length) {
  console.error(`stack: ${problemas.length} incumplimiento(s):`)
  for (const p of problemas) console.error(`- ${p}`)
  process.exit(1)
}

console.log(`stack: OK${avisos.length ? ` — con ${avisos.length} aviso(s)` : ''}`)
process.exit(0)
