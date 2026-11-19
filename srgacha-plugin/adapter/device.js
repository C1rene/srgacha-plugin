import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const GENSHIN_ROOT = path.join(process.cwd(), 'plugins', 'genshin')
const REDIS_KEY_PREFIXES = [
  { prefix: 'genshin:device_fp', id: 'id', fp: 'fp', bind: 'bind' },
  { prefix: 'ZZZ:DEVICE_FP', id: 'ID', fp: 'FP', bind: 'BIND' }
]

function normalizeDeviceId(value) {
  const text = String(value ?? '').trim()
  return /^[A-Za-z0-9-]{8,64}$/.test(text) ? text : ''
}

function normalizeDeviceFp(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return /^[a-f0-9]{13}$/.test(text) ? text : ''
}

function parseBindInfo(value) {
  if (!value) return null
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!parsed || typeof parsed !== 'object') return null
    return {
      deviceName: String(parsed.deviceName || ''),
      deviceBoard: String(parsed.deviceBoard || ''),
      deviceModel: String(parsed.deviceModel || ''),
      oaid: String(parsed.oaid || ''),
      androidVersion: String(parsed.androidVersion || ''),
      deviceFingerprint: String(parsed.deviceFingerprint || ''),
      deviceProduct: String(parsed.deviceProduct || '')
    }
  } catch {
    return null
  }
}

export function buildBoundDeviceUserAgent(bindInfo = {}) {
  bindInfo = bindInfo || {}
  const fingerprint = String(bindInfo.deviceFingerprint || '')
  const parts = fingerprint.split('/')
  if (!bindInfo.deviceModel || parts.length < 4 || !parts[3]) return ''
  const model = parts[1] || bindInfo.deviceModel
  const build = parts[3]
  const androidVersion = bindInfo.androidVersion || '13'
  // 与 GsCore BaseMysApi._mys_request 根据 device_info 重写 UA 的格式保持一致。
  return `Mozilla/5.0 (Linux; Android ${androidVersion}; ${model} ${build} ; wv)AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/104.0.5112.97 Mobile Safari/537.36 miHoYoBBS/2.102.1`
}

export function extractLtuid(cookie = '') {
  const match = String(cookie).match(/(?:^|;\s*)(?:ltuid|ltuid_v2|account_id|account_id_v2|stuid)=(\d+)/i)
  return match?.[1] || ''
}

async function redisGet(redisClient, key) {
  try {
    if (typeof redisClient?.get !== 'function') return ''
    const value = await redisClient.get(key)
    return value == null ? '' : String(value)
  } catch {
    return ''
  }
}

/**
 * 只把同一个 Redis 命名空间中同时存在的 device_id + device_fp 当作一组。
 * 不能把 genshin_db 的 ID 与另一来源的 FP 拼在一起；半套缓存只用于
 * 选择 ID 或设备画像，缺失的 FP 必须针对最终 ID 重新生成。
 */
async function readRedisDeviceInfo(ltuid, redisClient) {
  if (!ltuid) return { deviceId: '', deviceFp: '', bindInfo: null, pairComplete: false }
  let firstDeviceId = ''
  let firstBindInfo = null
  for (const item of REDIS_KEY_PREFIXES) {
    const [rawId, rawFp, rawBind] = await Promise.all([
      redisGet(redisClient, `${item.prefix}:${ltuid}:${item.id}`),
      redisGet(redisClient, `${item.prefix}:${ltuid}:${item.fp}`),
      redisGet(redisClient, `${item.prefix}:${ltuid}:${item.bind}`)
    ])
    const deviceId = normalizeDeviceId(rawId)
    const deviceFp = normalizeDeviceFp(rawFp)
    const bindInfo = parseBindInfo(rawBind)
    if (!firstDeviceId && deviceId) firstDeviceId = deviceId
    if (!firstBindInfo && bindInfo) firstBindInfo = bindInfo
    if (deviceId && deviceFp) {
      return {
        deviceId,
        deviceFp,
        bindInfo,
        pairComplete: true,
        deviceIdSource: 'genshin_redis',
        deviceFpSource: 'genshin_redis'
      }
    }
  }
  return {
    deviceId: firstDeviceId,
    // 故意丢弃没有同源 ID 的缓存 FP，避免跨设备混用。
    deviceFp: '',
    bindInfo: firstBindInfo,
    pairComplete: false,
    deviceIdSource: firstDeviceId ? 'genshin_redis_id_only' : '',
    deviceFpSource: 'srgacha_generated'
  }
}

/**
 * 只读查询 genshin 的 MysUserDB.device。
 * 通过已初始化的 Sequelize 连接执行 SELECT，不导入 MysUserDB.js，避免触发 sync()。
 */
export async function readGenshinDbDeviceId(ltuid, options = {}) {
  if (!/^\d{1,20}$/.test(String(ltuid || ''))) return ''
  const dbPath = options.dbPath || path.join(GENSHIN_ROOT, 'model', 'db', 'BaseModel.js')
  if (!fs.existsSync(dbPath)) return ''
  try {
    const module = await import(pathToFileURL(dbPath).href)
    const sequelize = module.sequelize
    if (typeof sequelize?.query !== 'function') return ''
    const result = await sequelize.query(
      'SELECT device FROM MysUsers WHERE ltuid = :ltuid LIMIT 1',
      { replacements: { ltuid: String(ltuid) } }
    )
    const rows = Array.isArray(result?.[0]) ? result[0] : result
    return normalizeDeviceId(rows?.[0]?.device)
  } catch {
    return ''
  }
}

/**
 * 设备选择策略：
 * 1. genshin Redis 中完整的同源 ID/FP 组合；
 * 2. genshin Redis 的 ID（若 FP 缺失，后续针对该 ID 重新生成）；
 * 3. genshin MysUserDB.device（同样重新生成配套 FP）；
 * 4. 事件上下文 ID；
 * 5. 交给 storage 为当前星铁 UID 生成稳定设备 ID。
 *
 * device_fp 永远不会从与最终 device_id 不同来源的半套缓存中拿取。
 */
export async function resolveGenshinDeviceInfo({
  cookie = '',
  ltuid = '',
  accountDeviceId = '',
  redisClient = globalThis.redis,
  dbLookup = readGenshinDbDeviceId
} = {}) {
  const resolvedLtuid = String(ltuid || extractLtuid(cookie) || '')
  const redisInfo = await readRedisDeviceInfo(resolvedLtuid, redisClient)

  if (redisInfo.pairComplete) {
    return {
      ltuid: resolvedLtuid,
      deviceId: redisInfo.deviceId,
      deviceFp: redisInfo.deviceFp,
      bindInfo: redisInfo.bindInfo,
      userAgent: buildBoundDeviceUserAgent(redisInfo.bindInfo),
      userAgentSource: buildBoundDeviceUserAgent(redisInfo.bindInfo) ? 'genshin_redis_bind' : 'starrailuid_default',
      deviceIdSource: 'genshin_redis_pair',
      deviceFpSource: 'genshin_redis_pair',
      devicePairSource: 'genshin_redis_pair'
    }
  }

  let deviceId = redisInfo.deviceId
  let deviceIdSource = deviceId ? 'genshin_redis_id_only' : ''
  if (!deviceId) {
    deviceId = normalizeDeviceId(await dbLookup(resolvedLtuid))
    if (deviceId) deviceIdSource = 'genshin_db'
  }
  if (!deviceId) {
    deviceId = normalizeDeviceId(accountDeviceId)
    if (deviceId) deviceIdSource = 'event_context'
  }

  return {
    ltuid: resolvedLtuid,
    deviceId,
    // 不复用单独存在的 Redis FP，交由 storage 按最终 device_id 生成。
    deviceFp: '',
    bindInfo: redisInfo.bindInfo,
    userAgent: buildBoundDeviceUserAgent(redisInfo.bindInfo),
    userAgentSource: buildBoundDeviceUserAgent(redisInfo.bindInfo) ? 'genshin_redis_bind' : 'starrailuid_default',
    deviceIdSource: deviceIdSource || 'srgacha_uid_device',
    deviceFpSource: 'srgacha_generated_for_device_id',
    devicePairSource: deviceIdSource ? 'device_id_repaired_with_new_fp' : 'srgacha_uid_pair'
  }
}

export default resolveGenshinDeviceInfo
