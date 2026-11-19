import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getStarRailRegion } from '../model/constants.js'

const XIAOYAO_ROOT = path.join(process.cwd(), 'plugins', 'xiaoyao-cvs-plugin')
const COOKIE_API_CN = 'https://api-takumi.mihoyo.com/auth/api/getCookieAccountInfoBySToken'
const COOKIE_API_OS = 'https://api-os-takumi.mihoyo.com/auth/api/getCookieAccountInfoBySToken'
const GET_LTOKEN_BY_STOKEN = 'https://passport-api.mihoyo.com/account/auth/api/getLTokenBySToken'

async function loadXiaoyaoGsCfg() {
  const gsCfgPath = path.join(XIAOYAO_ROOT, 'model', 'gsCfg.js')
  if (!fs.existsSync(gsCfgPath)) {
    throw new Error('未找到账号绑定组件，请先安装并启用账号管理插件')
  }
  const module = await import(pathToFileURL(gsCfgPath).href)
  if (!module.default?.getUserStoken) {
    throw new Error('当前账号管理插件版本不提供 getUserStoken 账号读取接口')
  }
  return module.default
}

function normalizeAccountMap(accountMap) {
  // 兼容账号管理插件早期 YAML 中直接保存单条 stoken 对象的格式。
  if (accountMap?.stoken && accountMap?.stuid) {
    const key = String(accountMap.uid || accountMap.stuid)
    return { [key]: accountMap }
  }
  return accountMap || {}
}

function cachedStarRailUid(e) {
  return e?.user?._games?.sr?.uid || null
}

async function redisStarRailUid(userId) {
  try {
    return await global.redis?.get?.(`Yz:starrail:mys:qq-uid:${userId}`) || null
  } catch {
    return null
  }
}

function normalizeEntry(key, value) {
  return {
    ...(value || {}),
    uid: String(value?.uid || key),
    _key: String(key)
  }
}

function chooseStarRailEntry(entries) {
  const direct = entries.filter(item => String(item.region || '').startsWith('prod_'))
  if (direct.length === 1) return direct[0]
  if (direct.length > 1) {
    throw new Error(`检测到多个已绑定星铁 UID：${direct.map(item => item.uid).join('、')}。请在指令末尾指定 UID，例如：*wx更新抽卡记录 ${direct[0].uid}`)
  }
  throw new Error('账号管理插件的 stoken 记录中没有可识别的星铁角色区服信息。请先在账号管理插件完成星铁角色绑定/刷新 stoken，或在指令末尾指定已绑定的星铁 UID')
}


export async function getLtokenByStoken(entry, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 环境没有可用的 fetch')
  const params = new URLSearchParams({
    stuid: String(entry.stuid),
    stoken: String(entry.stoken)
  })
  if (entry.mid) params.set('mid', String(entry.mid))
  const cookie = `stuid=${entry.stuid};stoken=${entry.stoken};${entry.mid ? `mid=${entry.mid};` : ''}`
  let response
  try {
    response = await fetchImpl(`${GET_LTOKEN_BY_STOKEN}?${params.toString()}`, {
      method: 'GET',
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow'
    })
  } catch (error) {
    throw new Error(`通过 v2 stoken 换取 ltoken 时网络失败：${error?.message || error}`)
  }
  if (!response.ok) throw new Error(`v2 stoken 换取 ltoken 失败（HTTP ${response.status}）`)
  let result
  try { result = await response.json() } catch { throw new Error('v2 stoken 换取 ltoken 返回无效 JSON') }
  const ltoken = result?.data?.ltoken
  if (Number(result?.retcode) !== 0 || !ltoken || String(ltoken).startsWith('v2_')) {
    throw new Error(`v2 stoken 换取 ltoken 失败：${result?.message || result?.msg || result?.retcode || '未返回有效 ltoken'}`)
  }
  return String(ltoken)
}

export async function getCookieToken(entry, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 环境没有可用的 fetch')
  const params = new URLSearchParams({
    game_biz: 'hk4e_cn',
    uid: String(entry.stuid),
    stoken: String(entry.stoken)
  })
  if (entry.mid) params.set('mid', String(entry.mid))
  const isOverseasAccount = String(entry.uid)[0] > '5'
  const url = `${isOverseasAccount ? COOKIE_API_OS : COOKIE_API_CN}?${params.toString()}`
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(12000),
      redirect: 'follow'
    })
  } catch (error) {
    throw new Error(`向账号管理插件账号凭据接口换取 Cookie 时网络失败：${error?.message || error}`)
  }
  if (!response.ok) throw new Error(`账号管理插件账号凭据接口 HTTP ${response.status}`)
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('账号管理插件账号凭据接口返回了无效 JSON')
  }
  if (Number(result?.retcode) !== 0 || !result?.data?.cookie_token) {
    throw new Error(`账号管理插件凭据换取 Cookie 失败：${result?.message || result?.msg || result?.retcode || '没有返回 cookie_token'}`)
  }
  return String(result.data.cookie_token)
}

/**
 * 只读复用账号管理插件账号：读取 gsCfg.getUserStoken() 返回的 stoken 记录，
 * 使用同一套 getCookieAccountInfoBySToken 接口交换短期 cookie_token。
 * 不导入账号管理插件 User 类，避免其构造过程触发配置初始化或 YAML 兼容写入。
 * 不修改账号管理插件 YAML，不把 Cookie/token 保存到本插件。
 */
export async function resolveXiaoyaoAccount(e, requestedUid = null, options = {}) {
  const requireCredentials = options.requireCredentials !== false
  const gsCfg = await loadXiaoyaoGsCfg()
  const rawMap = await gsCfg.getUserStoken(String(e.user_id))
  const accountMap = normalizeAccountMap(rawMap)
  const entries = Object.entries(accountMap)
    .map(([key, value]) => normalizeEntry(key, value))
    .filter(item => item.stoken && item.stuid)

  const explicitUid = requestedUid ? String(requestedUid) : null
  const cachedUid = explicitUid ? null : (cachedStarRailUid(e) || await redisStarRailUid(e.user_id))
  const selectedUid = explicitUid || (cachedUid ? String(cachedUid) : null)
  if (entries.length === 0) {
    if (!requireCredentials && selectedUid) {
      return { uid: selectedUid, region: getStarRailRegion(selectedUid), regionName: '', stuid: '', tokenUid: '', deviceId: e?.device_id || e?.deviceId || '', cookie: '' }
    }
    throw new Error('没有找到账号管理插件已绑定的 stoken，请先完成账号管理插件账号绑定')
  }
  let selected = null
  if (selectedUid) {
    selected = entries.find(item => item.uid === selectedUid || item._key === selectedUid) || null
  }
  if (!selected && explicitUid && requireCredentials) {
    throw new Error(`账号管理插件账号数据中没有 UID ${explicitUid}，请先在账号管理插件绑定该星铁角色`)
  }
  if (selected && explicitUid && requireCredentials && selected.region && !String(selected.region).startsWith('prod_')) {
    throw new Error(`UID ${explicitUid} 在账号管理插件账号数据中不是星铁区服记录（region=${selected.region}），请检查 UID`)
  }
  if (!selected && explicitUid && !requireCredentials) {
    return { uid: explicitUid, region: getStarRailRegion(explicitUid), regionName: '', stuid: '', tokenUid: '', deviceId: e?.device_id || e?.deviceId || '', cookie: '' }
  }
  if (!selected && cachedUid) {
    const knownStarRail = entries.filter(item => String(item.region || '').startsWith('prod_'))
    if (knownStarRail.length === 1) selected = knownStarRail[0]
    else if (knownStarRail.length > 1) {
      throw new Error(`检测到多个已绑定星铁 UID：${knownStarRail.map(item => item.uid).join('、')}。请在指令末尾指定 UID`)
    }
  }
  if (!selected && !cachedUid) selected = chooseStarRailEntry(entries)
  if (!selected && !requireCredentials && selectedUid) {
    return { uid: selectedUid, region: getStarRailRegion(selectedUid), regionName: '', stuid: '', tokenUid: '', deviceId: e?.device_id || e?.deviceId || '', cookie: '' }
  }
  if (!selected) {
    throw new Error(`没有找到 UID ${selectedUid} 对应的 stoken 记录，请确认该 UID 已在账号管理插件绑定`)
  }
  if (!requireCredentials) {
    return { uid: String(selected.uid), region: selected.region || getStarRailRegion(selected.uid), regionName: selected.region_name || '', stuid: String(selected.stuid), tokenUid: String(selected.uid), deviceId: e?.device_id || e?.deviceId || '', cookie: '' }
  }

  let cookieToken
  try {
    cookieToken = await getCookieToken(selected, options.fetchImpl)
  } catch (error) {
    throw new Error(`UID ${selected.uid}：${error.message}`)
  }
  let ltoken = String(selected.ltoken || '')
  // 账号管理插件的原始登录逻辑对 v2 stoken 单独调用 getLTokenBySToken，
  // 再把返回的 v1 ltoken 与 cookie_token 组合为抽卡登录 Cookie。
  if (!ltoken || ltoken.startsWith('v2_')) {
    try {
      ltoken = await getLtokenByStoken(selected, options.fetchImpl)
    } catch (error) {
      // 已保存的 v2 ltoken 不能直接冒充 v1 ltoken；若换取失败应明确停止。
      if (ltoken.startsWith('v2_')) throw new Error(`UID ${selected.uid}：${error.message}`)
      // 旧账号记录可能没有 ltoken 字段；保留账号管理插件原有的空值兼容行为。
      ltoken = ''
    }
  }
  const cookie = `ltoken=${ltoken};ltuid=${selected.stuid};cookie_token=${cookieToken}; account_id=${selected.stuid};`
  return {
    uid: String(selected.uid),
    region: String(selected.region || '').startsWith('prod_') ? selected.region : getStarRailRegion(selected.uid),
    regionName: selected.region_name || '',
    stuid: String(selected.stuid),
    tokenUid: String(selected.uid),
    deviceId: e?.device_id || e?.deviceId || '',
    cookie
  }
}
