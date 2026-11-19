import fs from 'node:fs/promises'
import path from 'node:path'
import { POOLS, emptyGachaData } from './constants.js'

function parseTime(value) {
  const text = String(value || '').trim()
  if (!text) return NaN
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}+08:00`)
}

function compareRecordTime(a, b) {
  const leftTime = parseTime(a?.time)
  const rightTime = parseTime(b?.time)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime
  const left = String(a?.id || '0')
  const right = String(b?.id || '0')
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const x = BigInt(left), y = BigInt(right)
    return x < y ? -1 : x > y ? 1 : 0
  }
  return left.localeCompare(right)
}


function compareIdDesc(a, b) {
  const left = String(a?.id || '0')
  const right = String(b?.id || '0')
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const x = BigInt(left), y = BigInt(right)
    return x > y ? -1 : x < y ? 1 : 0
  }
  return right.localeCompare(left)
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

function normalizeLegacyRecord(raw, pool, gachaCount, known) {
  const id = String(raw.id ?? '')
  if (!id) return null
  const itemType = String(raw.item_type || '')
  return {
    uid: String(raw.uid || ''),
    gacha_id: String(raw.gacha_id || ''),
    gacha_type: String(pool.id),
    item_id: String(raw.item_id || ''),
    count: String(raw.count || '1'),
    time: String(raw.time || timestampToTime(id)),
    name: String(raw.name || '未知物品'),
    lang: String(raw.lang || 'zh-cn'),
    item_type: /光锥|武器/i.test(itemType) || pool.kind === 'lightcone' ? '光锥' : '角色',
    rank_type: '5',
    id,
    gacha_count: Number.isFinite(gachaCount) ? gachaCount : null,
    gacha_count_known: Boolean(known),
    is_up: typeof raw.is_up === 'boolean' ? raw.is_up : null,
    icon: raw.icon || raw.big_icon || ''
  }
}

/**
 * 只读读取原版 genshin 星铁数据：data/srJson/QQ/UID/{1,2,11,12,21,22}.json。
 * 只迁移 rank_type=5 的记录，不会修改或删除旧文件。
 */
export async function migrateLegacyFiveStars(userId, uid, legacyRoot = path.resolve(process.cwd(), 'data', 'srJson')) {
  const result = emptyGachaData(uid)
  const dir = path.join(legacyRoot, String(userId), String(uid))
  let foundFiles = 0
  let foundRecords = 0
  for (const pool of POOLS) {
    const file = path.join(dir, `${pool.id}.json`)
    let rawList
    try {
      rawList = JSON.parse(await fs.readFile(file, 'utf8'))
      foundFiles++
    } catch {
      continue
    }
    if (!Array.isArray(rawList)) continue
    const chronological = [...rawList].sort(compareRecordTime)
    let pullsSinceFive = 0
    const fiveStars = []
    for (const raw of chronological) {
      pullsSinceFive++
      if (String(raw?.rank_type) !== '5') continue
      const count = pullsSinceFive
      const record = normalizeLegacyRecord(raw, pool, count, pullsSinceFive > 0)
      if (record) fiveStars.push(record)
      pullsSinceFive = 0
    }
    result.data[pool.name] = fiveStars.sort(compareIdDesc)
    result[poolCountKey(pool.id)] = fiveStars.length
    foundRecords += fiveStars.length
  }
  result.data_time = new Date().toISOString()
  return { data: result, foundFiles, foundRecords, sourceDir: dir }
}

function poolCountKey(id) {
  return ({
    '1': 'normal_gacha_num', '2': 'begin_gacha_num', '11': 'char_gacha_num',
    '12': 'weapon_gacha_num', '21': 'char_collabo_gacha_num', '22': 'weapon_collabo_gacha_num'
  })[String(id)]
}
