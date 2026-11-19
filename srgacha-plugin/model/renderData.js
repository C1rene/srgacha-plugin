import { POOLS } from './constants.js'
import { calculateGachaLuck } from './gachaLuck.js'
import { resolveRecordIsUp, getPoolVersion, parseShanghaiTime } from './poolMeta.js'
import { resolveSrItemMeta } from './itemMeta.js'

function compareRecordTimeDesc(a, b) {
  const leftTime = parseShanghaiTime(a?.time)
  const rightTime = parseShanghaiTime(b?.time)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime
  const left = String(a?.id || '0')
  const right = String(b?.id || '0')
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const x = BigInt(left), y = BigInt(right)
    return x > y ? -1 : x < y ? 1 : 0
  }
  return right.localeCompare(left)
}

function formatDateParts(value) {
  const timestamp = parseShanghaiTime(value)
  if (Number.isFinite(timestamp)) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(timestamp))
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
    const dateKey = `${values.year}-${values.month}-${values.day}`
    return { dateKey, date: `${values.month}-${values.day}` }
  }
  return { dateKey: 'unknown', date: '日期未知' }
}

function getItemKey(record, pool) {
  const itemId = String(record.item_id || '').trim()
  const type = (pool?.kind === 'lightcone' || record.item_type === '光锥' || record.item_type === '武器') ? 'lightcone' : 'character'
  return `${type}:${itemId || record.name || 'unknown'}`
}

function isKnownPullCount(record) {
  const count = Number(record?.gacha_count)
  return record?.gacha_count_known !== false && record?.gacha_count != null && Number.isFinite(count) && count >= 1
}

function buildPoolAnalysis(data, pool) {
  const records = (data?.data?.[pool.name] || [])
    .filter(record => String(record.rank_type) === '5')
    .slice()
    .sort(compareRecordTimeDesc)
  const itemMap = {}
  const resolvedIsUp = records.map(record => resolveRecordIsUp(record, pool))
  const fiveLog = records.map((record, recordIndex) => {
    const key = getItemKey(record, pool)
    const item = resolveSrItemMeta(record, pool)
    if (!itemMap[key]) itemMap[key] = item
    else if ((!itemMap[key].img || itemMap[key].img === 'html/old-theme/imgs/no-avatar.webp') && item.img) {
      itemMap[key].img = item.img
      itemMap[key].imgRemote = Boolean(item.imgRemote)
    }

    const countKnown = isKnownPullCount(record)
    const count = countKnown ? Number(record.gacha_count) : null
    const maxPity = pool.maxPity || 90
    return {
      id: key,
      isUp: resolvedIsUp[recordIndex],
      count,
      countKnown,
      barWidth: countKnown ? Math.max(2, count / maxPity * 100) : 0,
      barClass: !countKnown ? 'unknown' : count <= 10 ? 'gold' : count < maxPity * 0.5 ? 'good' : count < maxPity * 0.83 ? 'normal' : 'bad',
      ...formatDateParts(record.time),
      time: String(record.time || ''),
      logId: String(record.id || '')
    }
  })

  const pityValue = data?.pity_counts?.[pool.name]
  const pity = pityValue == null || !Number.isFinite(Number(pityValue)) ? null : Number(pityValue)
  const knownIntervals = fiveLog.filter(item => item.countKnown).map(item => item.count)
  const allIntervalsKnown = records.length > 0 && knownIntervals.length === records.length
  const fiveUsed = allIntervalsKnown ? knownIntervals.reduce((sum, value) => sum + value, 0) : null
  const isUpStatusKnown = resolvedIsUp.every(value => value === true || value === false)
  const upCount = resolvedIsUp.filter(value => value === true).length
  const waiCount = resolvedIsUp.filter(value => value === false).length
  const isUpPool = ['11', '12', '21', '22'].includes(String(pool.id))
  const chronological = [...fiveLog].reverse()
  let smallNum = 0
  let smallWin = 0
  let bigNum = 0
  let maxUpStreak = 0
  let maxWaiStreak = 0
  let upStreak = 0
  let waiStreak = 0
  let isGuarantee = false

  if (isUpPool && isUpStatusKnown) {
    for (const item of chronological) {
      if (isGuarantee) {
        item.isBig = true
        bigNum++
      } else {
        smallNum++
        if (item.isUp) {
          smallWin++
          upStreak++
          waiStreak = 0
        } else {
          waiStreak++
          upStreak = 0
        }
        maxUpStreak = Math.max(maxUpStreak, upStreak)
        maxWaiStreak = Math.max(maxWaiStreak, waiStreak)
      }
      isGuarantee = !item.isUp
    }
  }

  const stat = {
    fiveNum: records.length,
    wai: waiCount
  }
  if (pity != null && (records.length === 0 || allIntervalsKnown)) {
    stat.allNum = (fiveUsed || 0) + pity
    stat.noFiveNum = pity
  }
  if (allIntervalsKnown && records.length) stat.fiveAvg = (fiveUsed / records.length).toFixed(2)

  let upUsed = null
  if (allIntervalsKnown && isUpStatusKnown && isUpPool && upCount > 0) {
    const latest = fiveLog[0]
    upUsed = fiveUsed - (latest && latest.isUp === false ? (latest.count || 0) : 0)
    stat.isvalidNum = (upUsed / upCount).toFixed(2)
    const jade = Number(stat.isvalidNum) * 160
    stat.upYs = jade >= 10000 ? `${(jade / 10000).toFixed(2)}w` : jade.toFixed(0)
  }

  const hasNewPool = records.some(record => !getPoolVersion(record.time))
  let luck = null
  // 如果当前卡池版本的 UP 名单尚未收录，仍按五星出金概率计算欧非度；
  // 不把未知 UP 状态擅自判成歪卡，也不展示大小保底/UP 胜率统计。
  if (allIntervalsKnown && records.length) {
    const canAnalyzeUp = isUpPool && isUpStatusKnown
    luck = calculateGachaLuck({
      poolId: pool.id,
      isUpPool: canAnalyzeUp,
      upNum: canAnalyzeUp ? upCount : 0,
      upUsed: canAnalyzeUp ? (upUsed ?? 0) : 0,
      fiveNum: records.length,
      fiveUsed,
      smallNum: canAnalyzeUp ? smallNum : 0,
      smallWin: canAnalyzeUp ? smallWin : 0
    })
    if (luck) {
      Object.assign(luck, {
        smallNum: canAnalyzeUp ? smallNum : 0,
        smallWin: canAnalyzeUp ? smallWin : 0,
        bigNum: canAnalyzeUp ? bigNum : 0,
        noWaiRate: canAnalyzeUp && smallNum ? (smallWin / smallNum * 100).toFixed(1) : 0,
        maxUpStreak: canAnalyzeUp ? maxUpStreak : 0,
        maxWaiStreak: canAnalyzeUp ? maxWaiStreak : 0,
        hasNewPool
      })
    }
  }

  if (pity != null && pity > 0) {
    itemMap['888'] = {
      type: pool.kind === 'lightcone' ? 'weapon' : 'char',
      star: 5,
      name: '已抽',
      abbr: '已抽',
      img: 'html/old-theme/imgs/no-avatar.webp'
    }
    const currentDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    fiveLog.unshift({
      id: '888', isUp: true, count: pity, countKnown: true, dateKey: currentDate, date: currentDate.slice(5), isCurrent: true,
      barWidth: Math.max(2, pity / (pool.maxPity || 90) * 100),
      barClass: pity <= 10 ? 'gold' : pity < (pool.maxPity || 90) * 0.5 ? 'good' : pity < (pool.maxPity || 90) * 0.83 ? 'normal' : 'bad'
    })
  }

  return {
    name: pool.name,
    poolId: String(pool.id),
    poolKind: pool.kind,
    maxPity: pool.maxPity,
    count: records.length,
    pity,
    records,
    gacha: { stat, fiveLog, items: itemMap, luck }
  }
}

export function selectPools(mode = 'all') {
  if (mode === 'character') return POOLS.filter(pool => pool.kind === 'character')
  if (mode === 'lightcone') return POOLS.filter(pool => pool.kind === 'lightcone')
  if (mode === 'normal') return POOLS.filter(pool => pool.id === '1')
  if (mode === 'beginner') return POOLS.filter(pool => pool.id === '2')
  return POOLS
}

export function buildRecordPoolView(data, pool, options = {}) {
  const analysis = buildPoolAnalysis(data, pool)
  const maxLog = Math.max(0, Number(options.maxLog) || 0)
  let fiveLog = analysis.gacha.fiveLog
  const current = fiveLog[0]?.isCurrent ? [fiveLog[0]] : []
  const history = fiveLog.slice(current.length)
  const pageSize = Math.max(1, Number(options.pageSize) || 30)
  const isAll = Boolean(options.all)
  let hiddenNum = 0
  let shownNum = history.length
  if (!isAll && maxLog > 0 && history.length > maxLog) {
    hiddenNum = history.length - maxLog
    shownNum = maxLog
    analysis.gacha.fiveLog = current.concat(history.slice(0, maxLog))
  }
  let pages
  if (isAll && history.length > pageSize) {
    const total = Math.ceil(history.length / pageSize)
    pages = Array.from({ length: total }, (_, index) => ({
      fiveLog: (index === 0 ? current : []).concat(history.slice(index * pageSize, (index + 1) * pageSize)),
      page: index + 1,
      total,
      from: index * pageSize + 1,
      to: Math.min((index + 1) * pageSize, history.length),
      count: history.length
    }))
  } else {
    pages = [{ fiveLog: analysis.gacha.fiveLog, page: 1, total: 1, from: 1, to: shownNum, count: shownNum }]
  }

  const face = options.face || {
    name: '开拓者',
    banner: '../../miao-plugin/resources/meta-sr/character/common/imgs/banner.webp',
    face: 'html/old-theme/imgs/no-avatar.webp',
    qFace: 'html/old-theme/imgs/no-avatar.webp'
  }
  return {
    uid: String(data?.uid || ''),
    face,
    game: 'sr',
    type: analysis.poolKind === 'lightcone' ? 'weapon' : 'char',
    poolName: ({ '1': '常驻', '2': '始发', '11': '角色', '12': '光锥', '21': '角色联动', '22': '光锥联动' })[String(pool.id)] || analysis.name,
    maxPity: analysis.maxPity,
    gacha: {
      ...analysis.gacha,
      shownNum,
      hiddenNum
    },
    pages
  }
}

export function buildRecordsView(data, mode = 'all') {
  const pools = selectPools(mode).map(pool => buildPoolAnalysis(data, pool))
    .filter(pool => pool.records.length > 0 || pool.pity != null)
  return {
    uid: String(data?.uid || ''),
    title: mode === 'character' ? '角色跃迁五星记录' : mode === 'lightcone' ? '光锥跃迁五星记录' : '全部卡池五星记录',
    totalFiveStars: pools.reduce((sum, pool) => sum + pool.count, 0),
    pools
  }
}
