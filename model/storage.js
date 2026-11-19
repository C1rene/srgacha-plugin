import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { emptyGachaData, POOLS } from './constants.js'

const MODEL_DIR = path.dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = path.resolve(MODEL_DIR, '..')

function safeSegment(value, label) {
  const text = String(value ?? '')
  if (!/^\d{1,20}$/.test(text)) throw new Error(`${label} 格式不正确`)
  return text
}

export class GachaStorage {
  constructor(userId, uid, root = PLUGIN_ROOT) {
    this.userId = safeSegment(userId, 'QQ号')
    this.uid = safeSegment(uid, '星铁UID')
    this.root = root
    this.dir = path.join(root, 'data', this.userId, this.uid)
    this.file = path.join(this.dir, 'gacha_logs_new.json')
    this.metaFile = path.join(this.dir, 'meta.json')
  }

  async exists() {
    try { await fs.access(this.file); return true } catch { return false }
  }

  async read() {
    const text = await fs.readFile(this.file, 'utf8')
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object' || !data.data || typeof data.data !== 'object') {
      throw new Error('新版抽卡记录文件结构无效')
    }
    for (const pool of POOLS) {
      if (!Array.isArray(data.data[pool.name])) data.data[pool.name] = []
    }
    return data
  }

  async readMeta() {
    try {
      const meta = JSON.parse(await fs.readFile(this.metaFile, 'utf8'))
      return meta && typeof meta === 'object' ? meta : {}
    } catch {
      return {}
    }
  }

  async getDeviceCredentials(preferredId = '', api = null, preferredFp = '', sources = {}) {
    const meta = await this.readMeta()
    const validPreferred = preferredId && /^[A-Za-z0-9-]{8,64}$/.test(String(preferredId))
      ? String(preferredId) : ''
    const deviceId = validPreferred || (meta.device_uid === this.uid ? meta.device_id : '') || crypto.randomUUID()
    const validPreferredFp = /^[a-f0-9]{13}$/i.test(String(preferredFp || ''))
      ? String(preferredFp).toLowerCase() : ''
    const deviceInfo = sources.deviceInfo && typeof sources.deviceInfo === 'object' ? sources.deviceInfo : null
    const deviceInfoSignature = deviceInfo ? crypto.createHash('sha256').update(JSON.stringify(deviceInfo)).digest('hex') : ''
    const canReuseMetaFp = Number(meta.schema_version) >= 2 && meta.device_uid === this.uid && meta.device_id === deviceId &&
      (meta.device_info_signature || '') === deviceInfoSignature
    let deviceFp = validPreferredFp || (canReuseMetaFp ? meta.device_fp : '') || ''
    if (!/^[a-f0-9]{13}$/i.test(deviceFp)) deviceFp = ''
    if (!deviceFp && typeof api?.generateDeviceFp === 'function') {
      try { deviceFp = await api.generateDeviceFp(deviceId, deviceInfo) } catch {}
    }
    if (!/^[a-f0-9]{13}$/i.test(String(deviceFp || ''))) {
      deviceFp = crypto.randomBytes(7).toString('hex').slice(0, 13)
    }
    const deviceIdSource = validPreferred ? (sources.deviceIdSource || 'external')
      : (meta.device_uid === this.uid && meta.device_id === deviceId ? (meta.device_id_source || 'srgacha_uid') : 'srgacha_uid_generated')
    const deviceFpSource = validPreferredFp ? (sources.deviceFpSource || 'external_pair')
      : (canReuseMetaFp ? (meta.device_fp_source || 'srgacha_meta_pair') : 'srgacha_generated_for_device_id')
    await this.writeAtomic(this.metaFile, {
      schema_version: 2,
      device_uid: this.uid,
      device_id: deviceId,
      device_fp: String(deviceFp).toLowerCase(),
      device_id_source: deviceIdSource,
      device_fp_source: deviceFpSource,
      device_info_signature: deviceInfoSignature,
      created_at: meta.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    return {
      deviceId,
      deviceFp: String(deviceFp).toLowerCase(),
      deviceIdSource,
      deviceFpSource,
      deviceInfoSignature
    }
  }

  async getDeviceId(preferredId = '') {
    return (await this.getDeviceCredentials(preferredId)).deviceId
  }

  async write(data) {
    await fs.mkdir(this.dir, { recursive: true })
    await this.writeAtomic(this.file, data)
  }

  async writeAtomic(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`)
    let handle
    try {
      handle = await fs.open(temp, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await fs.rename(temp, file)
    } finally {
      if (handle) await handle.close().catch(() => {})
      await fs.unlink(temp).catch(() => {})
    }
  }

  empty() {
    return emptyGachaData(this.uid)
  }
}

const locks = new Map()
export async function withRefreshLock(key, callback) {
  const lockKey = String(key)
  const previous = locks.get(lockKey) || Promise.resolve()
  let release
  const current = new Promise(resolve => { release = resolve })
  locks.set(lockKey, current)
  await previous.catch(() => {})
  try {
    return await callback()
  } finally {
    release()
    if (locks.get(lockKey) === current) locks.delete(lockKey)
  }
}
