import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const publicDir = resolve(root, 'quadstream-globe/node_modules/.cache/quadstream-public')
const data = resolve(publicDir, 'globe-data')
// Keep geographic assets separate from JS, fetched only on demand.
for (const folder of ['world', 'us', 'test-atlas']) {
  mkdirSync(resolve(data, folder), { recursive: true })
}
for (const name of ['50m', '110m']) {
  cpSync(resolve(root, 'node_modules/visionscarto-world-atlas/world', name + '.json'), resolve(data, 'world', name + '.json'))
  cpSync(resolve(root, 'node_modules/world-atlas', 'countries-' + name + '.json'), resolve(data, 'test-atlas', 'countries-' + name + '.json'))
}
for (const name of ['states-10m.json', 'counties-10m.json']) {
  cpSync(resolve(root, 'node_modules/us-atlas', name), resolve(data, 'us', name))
}
cpSync(resolve(root, 'examples/globe/regional-data'), resolve(data, 'regional'), { recursive: true })

export default defineConfig({
  plugins: [react()],
  publicDir,
  server: { fs: { allow: [root] } },
})
