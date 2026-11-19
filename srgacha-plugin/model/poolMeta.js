import { poolDetailSr } from '../../miao-plugin/resources/meta-sr/info/index.js'
import { normalizeSrItemName } from './itemMeta.js'

export function parseShanghaiTime(value) {
  const text = String(value || '').trim()
  if (!text) return NaN
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}+08:00`)
}

export function getPoolVersion(time) {
  const timestamp = parseShanghaiTime(time)
  if (!Number.isFinite(timestamp)) return null
  return poolDetailSr.find(item => timestamp >= parseShanghaiTime(item.from) && timestamp <= parseShanghaiTime(item.to)) || null
}

export function isLightconeRecord(record, pool) {
  return pool?.kind === 'lightcone' || record?.item_type === '光锥' || record?.item_type === '武器'
}

/**
 * Prefer the explicit new-API is_up flag. If it is absent, fall back to the
 * Miao-Plugin pool metadata for known event periods. Standard/newbie
 * pools have no UP guarantee; the old analysis treats items outside the
 * current banner's featured list as non-UP.
 */
export function resolveRecordIsUp(record, pool) {
  if (record?.is_up === true || record?.is_up === false) return record.is_up
  const version = getPoolVersion(record?.time)
  if (!version) return pool?.kind === 'other' && Number.isFinite(parseShanghaiTime(record?.time)) ? false : null
  const isLightcone = isLightconeRecord(record, pool)
  const featured = isLightcone ? version.weapon5 : version.char5
  if (!Array.isArray(featured)) return null
  const name = normalizeSrItemName(record?.name, isLightcone ? 'lightcone' : 'character')
  return featured.some(item => normalizeSrItemName(item, isLightcone ? 'lightcone' : 'character') === name)
}

export function formatShortDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  return match ? `${match[1].slice(-2)}-${match[2]}-${match[3]}` : ''
}

export { poolDetailSr }
