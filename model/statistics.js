import { POOLS } from './constants.js'
import { getPoolVersion, isLightconeRecord, parseShanghaiTime, resolveRecordIsUp, formatShortDate } from './poolMeta.js'
import { resolveSrItemMeta, getSrItemAbbr } from './itemMeta.js'

function getVersion(time) {
  const found = getPoolVersion(time)
  if (found) return found
  return { version: '未知卡池', half: '', from: '', to: '', char5: [], weapon5: [] }
}

function selectedPools(mode) {
  if (mode === 'character') return POOLS.filter(pool => pool.kind === 'character')
  if (mode === 'lightcone') return POOLS.filter(pool => pool.kind === 'lightcone')
  if (mode === 'normal') return POOLS.filter(pool => pool.id === '1')
  if (mode === 'beginner') return POOLS.filter(pool => pool.id === '2')
  return POOLS
}

function recordKey(record, pool) {
  return `${isLightconeRecord(record, pool) ? 'lightcone' : 'character'}:${record.item_id || record.name || 'unknown'}`
}

function createGroup(key, meta, isAll = false) {
  return {
    key,
    version: isAll ? '全部统计' : meta.version,
    half: isAll ? '' : meta.half,
    from: isAll ? '' : formatShortDate(meta.from),
    to: isAll ? '' : formatShortDate(meta.to),
    name: isAll ? '' : (meta.char5 || []).map(name => getSrItemAbbr(name, 'character')).join(' / '),
    items: new Map(),
    stats: { star5Num: 0, upNum: 0, c5UpNum: 0, w5UpNum: 0, totalNum: 0, totalNumKnown: true }
  }
}

function addRecord(group, record, pool, itemMap) {
  const key = recordKey(record, pool)
  const item = itemMap[key] || resolveSrItemMeta(record, pool)
  if ((!item.img || item.img === 'html/old-theme/imgs/no-avatar.webp') && record.icon && /^https?:\/\//i.test(String(record.icon))) {
    item.img = String(record.icon)
    item.imgRemote = true
  }
  itemMap[key] = item
  const isUp = resolveRecordIsUp(record, pool)
  const status = isUp == null ? null : isUp ? 1 : 0
  const previous = group.items.get(key) || { id: key, num: 0, star: 5, isUp: status }
  if (previous.num > 0 && previous.isUp !== status) previous.isUp = null
  previous.num++
  group.items.set(key, previous)
  group.stats.star5Num++
  const interval = record?.gacha_count == null || record.gacha_count === '' ? NaN : Number(record.gacha_count)
  const intervalKnown = record?.gacha_count_known !== false && Number.isFinite(interval) && interval >= 1
  if (intervalKnown) group.stats.totalNum += interval
  else group.stats.totalNumKnown = false
  if (isUp === true) {
    group.stats.upNum++
    if (isLightconeRecord(record, pool)) group.stats.w5UpNum++
    else group.stats.c5UpNum++
  }
}

function finalizeGroup(group) {
  const items = [...group.items.values()].sort((a, b) => b.star - a.star || b.num - a.num || (Number(b.isUp) - Number(a.isUp)))
  const stats = { ...group.stats }
  if (!stats.totalNumKnown) stats.totalNum = null
  return {
    version: group.version,
    half: group.half,
    from: group.from,
    to: group.to,
    name: group.name,
    items,
    stats
  }
}

export function buildStatistics(data, mode = 'all') {
  const pools = selectedPools(mode)
  const itemMap = {}
  const groups = new Map()
  const isAll = mode === 'all'
  const isNormal = mode === 'normal'
  const isBeginner = mode === 'beginner'
  const allRecords = []

  for (const pool of pools) {
    const records = (data?.data?.[pool.name] || [])
      .filter(record => String(record.rank_type) === '5')
    for (const record of records) allRecords.push({ record, pool })
  }
  allRecords.sort((a, b) => parseShanghaiTime(b.record.time) - parseShanghaiTime(a.record.time))

  for (const { record, pool } of allRecords) {
    const meta = isNormal
      ? { version: '常驻池', half: '', from: '', to: '', char5: [] }
      : isBeginner
        ? { version: '始发跃迁', half: '', from: '', to: '', char5: [] }
        : getVersion(record.time)
    const key = isAll ? 'all' : (isNormal ? 'normal' : isBeginner ? 'beginner' : `${meta.version}|${meta.half}|${meta.from}|${meta.to}`)
    if (!groups.has(key)) groups.set(key, createGroup(key, meta, isAll))
    addRecord(groups.get(key), record, pool, itemMap)
  }

  const versionData = [...groups.values()].map(finalizeGroup)
  const totalStats = { star5Num: 0, upNum: 0, c5UpNum: 0, w5UpNum: 0 }
  let unknownUpCount = 0
  for (const { record, pool } of allRecords) if (pool.kind !== 'other' && resolveRecordIsUp(record, pool) == null) unknownUpCount++
  for (const group of groups.values()) {
    totalStats.star5Num += group.stats.star5Num
    totalStats.upNum += group.stats.upNum
    totalStats.c5UpNum += group.stats.c5UpNum
    totalStats.w5UpNum += group.stats.w5UpNum
  }

  // 总抽数只能在所选卡池的五星间隔与当前保底均完整时还原；不完整时不展示该项。
  let totalPulls = 0
  let allPullsKnown = true
  for (const pool of pools) {
    const records = (data?.data?.[pool.name] || []).filter(record => String(record.rank_type) === '5')
    let poolPulls = 0
    for (const record of records) {
      const known = record.gacha_count_known !== false && record.gacha_count != null && Number.isFinite(Number(record.gacha_count)) && Number(record.gacha_count) >= 1
      if (!known) {
        allPullsKnown = false
        break
      }
      poolPulls += Number(record.gacha_count)
    }
    const pity = data?.pity_counts?.[pool.name]
    if (pity == null || !Number.isFinite(Number(pity))) allPullsKnown = false
    else poolPulls += Number(pity)
    totalPulls += poolPulls
  }
  if (allPullsKnown) totalStats.totalNum = totalPulls
  totalStats.avgUpNum = totalStats.upNum > 0 && totalStats.totalNum != null
    ? (totalStats.totalNum / totalStats.upNum).toFixed(1)
    : 0

  return {
    uid: String(data?.uid || ''),
    game: 'sr',
    face: {
      name: '开拓者',
      banner: 'html/old-theme/common/bg/bg-sr.webp',
      face: 'html/old-theme/imgs/no-avatar.webp',
      qFace: 'html/old-theme/imgs/no-avatar.webp'
    },
    title: mode === 'character' ? '角色跃迁统计' : mode === 'lightcone' ? '光锥跃迁统计' : mode === 'normal' ? '常驻跃迁统计' : mode === 'beginner' ? '始发跃迁统计' : '全部跃迁统计',
    totalFiveStars: totalStats.star5Num,
    totalUp: totalStats.upNum,
    unknownUpCount,
    totalStat: totalStats,
    itemMap,
    isMix: false,
    versionData,
    note: '仅统计五星记录；四星、三星数量及无法确认的抽数不计入统计。'
  }
}
export default buildStatistics
