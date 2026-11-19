import test from 'node:test'
import assert from 'node:assert/strict'
import { MysApi } from '../model/mysApi.js'

test('登录接口提取 e_hkrpg_token 并保留原 Cookie', async () => {
  let seen
  const api = new MysApi({ fetchImpl: async (url, options) => {
    seen = { url, options }
    return {
      ok: true, status: 200,
      headers: { getSetCookie: () => ['e_hkrpg_token=token-value; Path=/; HttpOnly'], get: () => null },
      async json() { return { retcode: 0, message: 'OK', data: {} } }
    }
  } })
  const result = await api.loginGachaAccount('100820596', 'ltoken=x;cookie_token=y;')
  assert.equal(result.cookie, 'ltoken=x; cookie_token=y; e_hkrpg_token=token-value')
  assert.equal(result.hasEhrpgToken, true)
  assert.equal(seen.url, 'https://api-takumi.mihoyo.com/common/badge/v1/login/account')
  assert.equal(JSON.parse(seen.options.body).uid, '100820596')
  assert.equal(seen.options.headers.Cookie, 'ltoken=x; cookie_token=y')
})

test('五星接口请求包含 StarRailUID 显式请求参数和请求头', async () => {
  let seen
  const api = new MysApi({ fetchImpl: async (url, options) => {
    seen = { url, options }
    return { ok: true, status: 200, headers: { get: () => null }, async json() { return { retcode: 0, data: { list: [] } } } }
  } })
  await api.getFiveStarList({ uid: '100820596', region: 'prod_gf_cn', cookie: 'cookie', deviceId: 'persisted-device', deviceFp: '0123456789abc', userAgent: 'Bound Android UA', gachaType: 'GachaType_AvatarUp', maxId: '123', versionId: 'v1' })
  const url = new URL(seen.url)
  assert.equal(url.origin + url.pathname, 'https://act-api-takumi.mihoyo.com/event/rpg_gacha_record/five_star_list')
  assert.equal(url.searchParams.get('game_biz'), 'hkrpg_cn')
  assert.equal(url.searchParams.get('region'), 'prod_gf_cn')
  assert.equal(url.searchParams.get('gacha_type'), 'GachaType_AvatarUp')
  assert.equal(url.searchParams.get('max_id'), '123')
  assert.equal(url.searchParams.get('version_id'), 'v1')
  assert.equal(seen.options.headers['x-rpc-device_id'], 'persisted-device')
  assert.equal(seen.options.headers['x-rpc-device_fp'], '0123456789abc')
  assert.equal(seen.options.headers['User-Agent'], 'Bound Android UA')
  assert.equal(seen.options.headers['x-rpc-platform'], 'pc')
  assert.equal(seen.options.headers.Cookie, 'cookie')
})

test('区服映射与 StarRailUID/GsCore UID 前缀规则一致', async () => {
  const { getStarRailRegion } = await import('../model/constants.js')
  assert.equal(getStarRailRegion('100820596'), 'prod_gf_cn')
  assert.equal(getStarRailRegion('600820596'), 'prod_official_usa')
  assert.equal(getStarRailRegion('800820596'), 'prod_official_asia')
})

test('账号绑定组件 stoken 换 cookie_token 复用原始接口和参数', async () => {
  const { getCookieToken } = await import('../adapter/xiaoyao.js')
  let seen
  const token = await getCookieToken({ uid: '100820596', stuid: '123456', stoken: 'stoken-value', mid: 'mid-value' }, async (url, options) => {
    seen = { url, options }
    return { ok: true, status: 200, async json() { return { retcode: 0, data: { cookie_token: 'cookie-token-value' } } } }
  })
  const url = new URL(seen.url)
  assert.equal(url.origin, 'https://api-takumi.mihoyo.com')
  assert.equal(url.pathname, '/auth/api/getCookieAccountInfoBySToken')
  assert.equal(url.searchParams.get('game_biz'), 'hk4e_cn')
  assert.equal(url.searchParams.get('uid'), '123456')
  assert.equal(url.searchParams.get('stoken'), 'stoken-value')
  assert.equal(url.searchParams.get('mid'), 'mid-value')
  assert.equal(seen.options.method, 'GET')
  assert.equal(token, 'cookie-token-value')
})

test('海外账号按账号区服请求方式使用 OS Cookie API', async () => {
  const { getCookieToken } = await import('../adapter/xiaoyao.js')
  let seen
  await getCookieToken({ uid: '700820596', stuid: '654321', stoken: 'stoken-os' }, async (url, options) => {
    seen = { url, options }
    return { ok: true, status: 200, async json() { return { retcode: 0, data: { cookie_token: 'os-cookie-token' } } } }
  })
  assert.equal(new URL(seen.url).origin, 'https://api-os-takumi.mihoyo.com')
  assert.equal(seen.options.method, 'GET')
})


test('设备指纹按 GsCore 请求结构获取并返回 13 位 fp', async () => {
  let seen
  const api = new MysApi({ fetchImpl: async (url, options) => {
    seen = { url, options }
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      async json() { return { data: { code: 200, device_fp: 'abcdef0123456' } } }
    }
  } })
  const fp = await api.generateDeviceFp('persisted-device-id', {
    deviceName: 'XQ-BC52', deviceBoard: 'lahaina', deviceModel: 'XQ-BC52_EEA',
    oaid: 'test-oaid', androidVersion: '13',
    deviceFingerprint: 'Sony/XQ-BC52_EEA/XQ-BC52:13/61.2.A.0.472A/061002A0000472A0046651803:user/release-keys',
    deviceProduct: 'XQ-BC52_EEA'
  })
  assert.equal(fp, 'abcdef0123456')
  assert.equal(seen.url, 'https://public-data-api.mihoyo.com/device-fp/api/getFp')
  const body = JSON.parse(seen.options.body)
  assert.equal(body.bbs_device_id, 'persisted-device-id')
  assert.equal(body.platform, '2')
  assert.equal(body.app_name, 'bbs_cn')
  assert.equal(body.bbs_device_id, 'persisted-device-id')
  const extFields = JSON.parse(body.ext_fields)
  assert.equal(extFields.model, 'XQ-BC52_EEA')
  assert.equal(extFields.oaid, 'test-oaid')
  assert.equal(extFields.deviceInfo, 'Sony/XQ-BC52_EEA/XQ-BC52:13/61.2.A.0.472A/061002A0000472A0046651803:user/release-keys')
  assert.equal(seen.options.headers['x-rpc-app_version'], '2.102.1')
})

test('v2 stoken 按账号组件原流程换取 v1 ltoken', async () => {
  const { getLtokenByStoken } = await import('../adapter/xiaoyao.js')
  let seen
  const ltoken = await getLtokenByStoken({ stuid: '123456', stoken: 'v2_stoken-value', mid: 'mid-value' }, async (url, options) => {
    seen = { url, options }
    return { ok: true, status: 200, async json() { return { retcode: 0, data: { ltoken: 'legacy-ltoken-value' } } } }
  })
  const url = new URL(seen.url)
  assert.equal(url.origin, 'https://passport-api.mihoyo.com')
  assert.equal(url.pathname, '/account/auth/api/getLTokenBySToken')
  assert.equal(url.searchParams.get('stuid'), '123456')
  assert.equal(url.searchParams.get('stoken'), 'v2_stoken-value')
  assert.equal(url.searchParams.get('mid'), 'mid-value')
  assert.match(seen.options.headers.Cookie, /stoken=v2_stoken-value/)
  assert.equal(ltoken, 'legacy-ltoken-value')
})
