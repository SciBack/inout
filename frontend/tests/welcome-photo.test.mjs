import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('la bienvenida carga la foto por el código resuelto por identidad', async () => {
  const source = await readFile(
    new URL('../src/components/WelcomeScreen.tsx', import.meta.url),
    'utf8',
  )

  assert.match(
    source,
    /\/api\/patron-photo\/card\/\$\{encodeURIComponent\(patron\.cardnumber\)\}/,
  )
})

