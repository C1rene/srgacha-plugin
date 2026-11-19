/**
 * 星铁物品元数据统一从同级 miao-plugin 读取。
 * 由 apps/srgacha.js 注入 Character / Weapon，避免在此处重复维护 meta-sr。
 */
let miaoModels = { Character: null, Weapon: null }

export function setMiaoModels(models = {}) {
  miaoModels = {
    Character: models.Character || miaoModels.Character,
    Weapon: models.Weapon || miaoModels.Weapon
  }
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[·・]/g, '•')
    .replace(/[\s\u200b\u200c\u200d]/g, '')
    .toLocaleLowerCase('zh-CN')
}

function getModel(name, kind) {
  const Model = kind === 'lightcone' || kind === 'weapon' ? miaoModels.Weapon : miaoModels.Character
  if (!Model?.get || name == null || name === '') return null
  try {
    return Model.get(String(name), 'sr') || null
  } catch {
    return null
  }
}

/**
 * 图片模板的 _res_path 指向 srgacha-plugin/resources。
 * 通过相对路径回到 plugins/miao-plugin/resources，实际图片只保留一份。
 */
export function toMiaoResourcePath(resourcePath) {
  const value = String(resourcePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!value) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value
  return `../../miao-plugin/resources/${value}`
}

function resolveModel(record, kind) {
  const candidates = [record?.name, record?.item_id].filter(Boolean)
  for (const candidate of candidates) {
    const model = getModel(candidate, kind)
    if (model) return model
  }
  return null
}

export function resolveSrItemMeta(record, pool) {
  const isWeapon = pool?.kind === 'lightcone' || ['光锥', '武器'].includes(String(record?.item_type || ''))
  const kind = isWeapon ? 'lightcone' : 'character'
  const model = resolveModel(record, kind)

  if (model) {
    const name = String(model.name || record?.name || '未知物品')
    const imagePath = isWeapon
      ? (model.img || model.imgs?.icon || '')
      : (model.imgs?.face || model.face || '')
    return {
      type: isWeapon ? 'weapon' : 'char',
      star: Number(model.star) || Number(record?.rank_type) || 5,
      name,
      abbr: String(model.abbr || model.sName || name),
      img: toMiaoResourcePath(imagePath) || 'html/old-theme/imgs/no-avatar.webp',
      imgRemote: false
    }
  }

  const name = String(record?.name || '未知物品')
  const remoteIcon = /^https?:\/\//i.test(String(record?.icon || ''))
  return {
    type: isWeapon ? 'weapon' : 'char',
    star: Number(record?.rank_type) || 5,
    name,
    abbr: name,
    img: remoteIcon ? String(record.icon) : 'html/old-theme/imgs/no-avatar.webp',
    imgRemote: remoteIcon
  }
}

export function normalizeSrItemName(name, kind = 'character') {
  const model = getModel(name, kind)
  if (model?.name) return normalizeName(model.name)
  return normalizeName(name)
}

export function getSrItemAbbr(name, kind = 'character') {
  const model = getModel(name, kind)
  if (!model) return String(name || '')
  return String(model.abbr || model.sName || model.name || name || '')
}

export default resolveSrItemMeta
