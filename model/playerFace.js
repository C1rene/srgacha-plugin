/**
 * Build the same player banner data used by the old Miao gacha template.
 * Player / Character models are injected from miao-plugin.
 */
function toMiaoResourcePath(value, fallback) {
  const path = String(value || '').replace(/^\/+/, '')
  if (!path) return fallback
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path
  return `../../miao-plugin/resources/${path}`
}

export function getMiaoPlayerFace(uid, { Player, Character } = {}) {
  const fallback = {
    name: '旅行者',
    banner: '../../miao-plugin/resources/meta-sr/character/common/imgs/banner.webp',
    face: 'html/old-theme/imgs/no-avatar.webp',
    qFace: 'html/old-theme/imgs/no-avatar.webp'
  }
  if (!uid || !Player?.create || !Character?.get) return fallback
  try {
    const player = Player.create(uid, 'sr')
    const defaultFaceChar = 1005
    const faceChar = Character.get(player?.face || defaultFaceChar, 'sr')
    let imgs = faceChar?.imgs || {}
    if (!imgs.face) imgs = Character.get(defaultFaceChar, 'sr')?.imgs || {}
    return {
      banner: toMiaoResourcePath(imgs.banner, fallback.banner),
      face: toMiaoResourcePath(imgs.face, fallback.face),
      qFace: toMiaoResourcePath(imgs.qFace || imgs.face, fallback.qFace),
      name: player?.name || '旅行者',
      sign: player?.sign || '',
      level: player?.level || ''
    }
  } catch {
    return fallback
  }
}

export default getMiaoPlayerFace
