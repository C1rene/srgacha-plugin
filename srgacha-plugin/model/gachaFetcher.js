import { POOLS } from './constants.js'

function compareNumericId(a, b) {
  const left = String(a || '0'), right = String(b || '0')
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const x = BigInt(left), y = BigInt(right)
    return x < y ? -1 : x > y ? 1 : 0
  }
  return left.localeCompare(right)
}

function timestampToTime(id) {
  const text = String(id || '')
  if (text.length < 10 || !/^\d{10,}$/.test(text)) return ''
  const date = new Date(Number(text.slice(0, 10)) * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(date).replaceAll('/', '-')
}

function normalizeIsUp(value) {
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  return null
}

export function normalizeFiveStarItem(raw, uid, pool) {
  const item = raw?.item
  if (!item || Number(item.rarity) !== 5) return null
  const id = String(raw.id || '')
  if (!id || id === '0') return null
  const itemType = String(item.item_type || '')
  const rawGachaCount = raw.gacha_count
  const parsedGachaCount = rawGachaCount == null || rawGachaCount === '' ? NaN : Number(rawGachaCount)
  const gachaCountKnown = Number.isFinite(parsedGachaCount) && parsedGachaCount >= 1
  return {
    uid: String(uid),
    gacha_id: '',
    gacha_type: String(pool.id),
    item_id: String(item.item_id || ''),
    count: '1',
    time: timestampToTime(id),
    name: String(item.name || '未知物品'),
    lang: 'zh-cn',
    item_type: itemType.includes('Avatar') ? '角色' : '光锥',
    rank_type: '5',
    id,
    gacha_count: gachaCountKnown ? parsedGachaCount : null,
    gacha_count_known: gachaCountKnown,
    is_up: normalizeIsUp(raw.is_up),
    icon: item.icon || item.big_icon || ''
  }
}

export async function fetchPoolRecords({ api, uid, region, cookie, deviceId, deviceFp, userAgent = '', pool, latestId = null, force = false, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxPages = 1000 }) {
  const records = []
  let pityCount = null
  let sawRecords = false
  let nextMaxId = null
  let versionId = null
  let hasMore = true
  let stopped = false
  let page = 0

  while (hasMore && !stopped) {
    if (++page > maxPages) throw new Error(`${pool.name} 分页超过安全上限 ${maxPages}`)
    const response = await api.getFiveStarList({
      uid, region, cookie, deviceId, deviceFp, gachaType: pool.code,
      maxId: nextMaxId, versionId, userAgent
    })
    if (!response || Number(response.retcode) !== 0) {
      const message = response?.message || response?.msg || '接口未返回成功状态'
      const error = new Error(`${pool.name}：${message}`)
      error.retcode = response?.retcode ?? null
      error.apiMessage = message
      throw error
    }
    const data = response.data
    if (!data || !Array.isArray(data.list)) throw new Error(`${pool.name} 返回数据格式异常：data.list 不是数组`)
    hasMore = Boolean(data.has_more)
    nextMaxId = data.next_max_id ? String(data.next_max_id) : null
    versionId = data.version_id ? String(data.version_id) : null

    for (const raw of data.list) {
      const id = String(raw?.id ?? '')
      // 与 StarRailUID 一致：即使已经遇到本地旧记录，也继续识别页内的特殊保底记录。
      if (id === '0' && raw?.item == null) {
        if (Number.isFinite(Number(raw.gacha_count))) pityCount = Number(raw.gacha_count)
        continue
      }
      if (stopped || !id || id === '0') continue
      sawRecords = true
      if (!force && latestId && compareNumericId(id, latestId) <= 0) {
        stopped = true
        continue
      }
      const normalized = normalizeFiveStarItem(raw, uid, pool)
      if (normalized) records.push(normalized)
    }

    if (stopped || !hasMore) break
    if (!nextMaxId) throw new Error(`${pool.name} 分页游标缺失（has_more=true 但 next_max_id 为空）`)
    await sleep(300)
  }

  if (pityCount == null && sawRecords) throw new Error(`${pool.name} 未返回当前保底记录`)
  return { records, pityCount: pityCount ?? 0, pages: page }
}

export function isKnownPoolName(name) {
  return POOLS.some(pool => pool.name === name)
}
