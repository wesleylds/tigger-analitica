import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(existsSync)

const chromePath = process.env.CHROME_PATH || chromeCandidates[0]
if (!chromePath) {
  throw new Error('Chrome nao encontrado. Defina CHROME_PATH apontando para chrome.exe.')
}

const sourceExtensionDir = path.join(process.cwd(), 'tools', 'bbtips-bridge-extension')
const extensionDir = process.env.BBTIPS_BRIDGE_EXTENSION_DIR ||
  path.join(process.env.USERPROFILE || process.cwd(), 'tigger-bbtips-bridge-extension')
const profileDir = process.env.BBTIPS_BRIDGE_PROFILE_DIR ||
  path.join(process.cwd(), 'captures', 'bbtips-bridge-chrome-profile')

mkdirSync(profileDir, { recursive: true })
rmSync(extensionDir, { force: true, recursive: true })
cpSync(sourceExtensionDir, extensionDir, { recursive: true })

const args = [
  `--user-data-dir=${profileDir}`,
  `--load-extension=${extensionDir}`,
  `--remote-debugging-port=${process.env.BBTIPS_BRIDGE_DEBUG_PORT || '9223'}`,
  '--no-first-run',
  '--no-default-browser-check',
  'https://app.bbtips.com.br/betano/futebol/horarios',
  'https://app.bbtips.com.br/playpix/futebol/horarios',
  'https://app.bbtips.com.br/futebol/horarios',
]

const child = spawn(chromePath, args, {
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
})

child.unref()

console.log('Chrome bridge aberto com a extensao Tigger BBTips Bridge.')
console.log(`Perfil: ${profileDir}`)
console.log('Deixe a BBTips logada nessas abas; a extensao alimenta http://127.0.0.1:5173/api/bbtips/ingest automaticamente.')
