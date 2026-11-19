export const POOLS = [
  { name: '群星跃迁', code: 'GachaType_Standard', id: '1', kind: 'other', maxPity: 90 },
  { name: '始发跃迁', code: 'GachaType_Newbie', id: '2', kind: 'other', maxPity: 50 },
  { name: '角色跃迁', code: 'GachaType_AvatarUp', id: '11', kind: 'character', maxPity: 90 },
  { name: '光锥跃迁', code: 'GachaType_EquipmentUp', id: '12', kind: 'lightcone', maxPity: 80 },
  { name: '角色联动跃迁', code: 'GachaType_CollabAvatarUp', id: '21', kind: 'character', maxPity: 90 },
  { name: '光锥联动跃迁', code: 'GachaType_CollabEquipmentUp', id: '22', kind: 'lightcone', maxPity: 80 }
]

export const POOL_BY_ID = Object.fromEntries(POOLS.map(pool => [pool.id, pool]))

export const SERVER_BY_UID_PREFIX = {
  '1': 'prod_gf_cn',
  '2': 'prod_gf_cn',
  '5': 'prod_qd_cn',
  '6': 'prod_official_usa',
  '7': 'prod_official_euro',
  '8': 'prod_official_asia',
  '9': 'prod_official_cht'
}

export const FIVE_STAR_ENDPOINT = 'https://act-api-takumi.mihoyo.com/event/rpg_gacha_record/five_star_list'
export const GET_FP_ENDPOINT = 'https://public-data-api.mihoyo.com/device-fp/api/getFp'
export const MYS_VERSION = '2.102.1'
export const GACHA_LOGIN_ENDPOINT = 'https://api-takumi.mihoyo.com/common/badge/v1/login/account'
export const DEFAULT_DEVICE_ID = '3c183681c7f983cb'
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export function getStarRailRegion(uid) {
  return SERVER_BY_UID_PREFIX[String(uid || '')[0]] || 'prod_gf_cn'
}

export function emptyGachaData(uid) {
  return {
    schema_version: 2,
    uid: String(uid),
    data_time: '',
    normal_gacha_num: 0,
    begin_gacha_num: 0,
    char_gacha_num: 0,
    weapon_gacha_num: 0,
    char_collabo_gacha_num: 0,
    weapon_collabo_gacha_num: 0,
    pity_counts: {},
    pool_data_time: {},
    data: Object.fromEntries(POOLS.map(pool => [pool.name, []]))
  }
}
