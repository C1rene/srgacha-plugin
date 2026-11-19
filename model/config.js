import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULTS = {
  requestTimeoutMs: 12000,
  networkRetryCount: 1,
  pageDelayMs: 300,
  poolDelayMs: 250,
  maxPagesPerPool: 1000,
  detailMaxLog: 30,
  statMaxVersion: 10
}

export function getConfig() {
  try {
    const file = path.join(ROOT, 'config', 'settings.json')
    const custom = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { ...DEFAULTS, ...(custom || {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export default getConfig
