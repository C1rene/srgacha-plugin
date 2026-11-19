import crypto from 'node:crypto'
import {
  DEFAULT_DEVICE_ID,
  FIVE_STAR_ENDPOINT,
  GET_FP_ENDPOINT,
  MYS_VERSION,
  GACHA_LOGIN_ENDPOINT,
  USER_AGENT,
  getStarRailRegion
} from './constants.js'

function cryptoRandomUuid() {
  return crypto.randomUUID()
}

function randomId(length) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let output = ''
  for (let i = 0; i < length; i++) output += chars[Math.floor(Math.random() * chars.length)]
  return output
}

export class MysApiError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'MysApiError'
    this.code = details.code || 'MYS_API_ERROR'
    this.retcode = details.retcode ?? null
    this.httpStatus = details.httpStatus ?? null
    this.apiMessage = details.apiMessage || ''
    this.retryable = Boolean(details.retryable)
  }
}

function extractEhrpgToken(headers) {
  let setCookies = []
  try {
    if (typeof headers.getSetCookie === 'function') setCookies = headers.getSetCookie()
  } catch {}
  if (!setCookies.length) {
    const one = headers.get('set-cookie')
    if (one) setCookies = [one]
  }
  for (const cookie of setCookies) {
    const match = String(cookie).match(/(?:^|[,;]\s*)e_hkrpg_token=([^;,\s]+)/)
    if (match?.[1]) return match[1]
  }
  return ''
}

export class MysApi {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 30000, retryCount = 1 } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 环境没有可用的 fetch')
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
    this.retryCount = retryCount
  }

  async request(url, options, { retryNetwork = true } = {}) {
    let lastError
    const attempts = retryNetwork ? this.retryCount + 1 : 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          ...options,
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: 'follow'
        })
        let data
        try {
          data = await response.json()
        } catch {
          const bodyText = await response.text().catch(() => '')
          throw new MysApiError(`米游社返回了非 JSON 响应（HTTP ${response.status}）`, {
            code: 'NON_JSON_RESPONSE', httpStatus: response.status,
            apiMessage: bodyText.slice(0, 160), retryable: response.status >= 500
          })
        }
        if (!response.ok) {
          throw new MysApiError(`米游社 HTTP 请求失败（${response.status}）`, {
            code: `HTTP_${response.status}`, httpStatus: response.status,
            apiMessage: data?.message || data?.msg || '', retryable: response.status >= 500 || response.status === 429
          })
        }
        return { data, response }
      } catch (error) {
        lastError = error
        const retryable = error?.retryable || error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.cause?.code === 'ECONNRESET'
        if (!retryable || attempt >= attempts - 1) break
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
    if (lastError instanceof MysApiError) throw lastError
    throw new MysApiError(`请求米游社失败：${lastError?.message || '网络错误'}`, {
      code: 'NETWORK_ERROR', retryable: true
    })
  }

  async generateDeviceFp(deviceId, boundDevice = null) {
    const randomHex = length => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase()
    const randomId64 = () => randomId(64)
    const seedId = cryptoRandomUuid()
    const seedTime = String(Date.now())
    const timeDiff = Date.now()

    const fingerprint = String(boundDevice?.deviceFingerprint || '')
    const parts = fingerprint.split('/')
    const brand = parts[0] || 'OnePlus'
    const modelName = boundDevice?.deviceModel || 'PHK110'
    const productName = boundDevice?.deviceProduct || 'PHK110'
    const deviceType = boundDevice?.deviceName || 'OP5913L1'
    const board = boundDevice?.deviceBoard || 'taro'
    const oaid = boundDevice?.oaid || '1f1971b188c472f0'
    const osVersion = boundDevice?.androidVersion || '14'
    const deviceInfo = fingerprint || 'OnePlus/PHK110/OP5913L1:13/SKQ1.221119.001/T.1328291_b9_41:user/release-keys'
    const randomA = 400000 + Math.floor(Math.random() * 200001)
    const randomB = 150000 + Math.floor(Math.random() * 150001)
    const extFields = {
      proxyStatus: 0, isRoot: 1, romCapacity: '512', deviceName: boundDevice?.deviceName || '私人手机',
      productName, romRemain: '491', hostname: 'dg02-pool06-kvm82', screenSize: '1264x2640',
      isTablet: 0, aaid: randomId64(), model: modelName, brand, hardware: 'qcom', deviceType,
      devId: 'REL', serialNumber: 'unknown', sdCapacity: randomA, buildTime: '1717740969000',
      buildUser: 'root', simState: 5, ramRemain: String(randomB), appUpdateTimeDiff: timeDiff,
      deviceInfo, vaid: randomId64(), buildType: 'user', sdkVersion: '34', ui_mode: 'UI_MODE_TYPE_NORMAL',
      isMockLocation: 0, cpuType: 'arm64-v8a', isAirMode: 0, ringMode: 1, chargeStatus: 1,
      manufacturer: brand, emulatorStatus: 0, appMemory: '512', osVersion, vendor: '中国联通',
      accelerometer: '-1.3004991x6.38764x7.19103', sdRemain: randomB, buildTags: 'release-keys',
      packageName: 'com.mihoyo.hyperion', networkType: 'WiFi', oaid, debugStatus: 1,
      ramCapacity: String(randomA), magnetometer: '27.1084x-48.5804x-24.8758',
      display: parts[3] || `${modelName}_${osVersion}.0.0.810(CN01)`, appInstallTimeDiff: String(timeDiff),
      packageVersion: '2.20.2', gyroscope: '-0.02543317x0.005725792x0.003195791',
      batteryStatus: 50, hasKeyboard: 0, board
    }
    // 与 GsCore BaseMysApi.generate_fp 的 payload 字段保持一致：
    // bbs_device_id 必须是最终请求使用的 device_id，FP 为该 ID 单独生成。
    const payload = {
      device_id: randomHex(16),
      seed_id: seedId,
      platform: '2',
      seed_time: seedTime,
      ext_fields: JSON.stringify(extFields),
      app_name: 'bbs_cn',
      bbs_device_id: deviceId,
      device_fp: randomHex(13)
    }
    const headers = {
      'x-rpc-app_version': MYS_VERSION,
      'X-Requested-With': 'com.mihoyo.hyperion',
      'User-Agent': `Mozilla/5.0 (Linux; Android 13; PHK110 Build/SKQ1.221119.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.133 Mobile Safari/537.36 miHoYoBBS/${MYS_VERSION}`,
      'x-rpc-client_type': '5',
      Referer: 'https://webstatic.mihoyo.com/',
      Origin: 'https://webstatic.mihoyo.com/',
      'Content-Type': 'application/json'
    }
    try {
      const { data } = await this.request(GET_FP_ENDPOINT, {
        method: 'POST', headers, body: JSON.stringify(payload)
      }, { retryNetwork: true })
      if (Number(data?.data?.code) === 200 && /^[a-f0-9]{13}$/i.test(String(data?.data?.device_fp || ''))) {
        return String(data.data.device_fp).toLowerCase()
      }
    } catch {}
    // 与 GsCore 一样，设备指纹接口不可用时生成 13 位备用值，并由 storage 持久化。
    return randomHex(13)
  }

  async loginGachaAccount(uid, cookie, regionOverride = '') {
    const normalizedCookie = String(cookie || '').split(';').map(part => part.trim()).filter(Boolean).join('; ')
    const payload = {
      game_biz: 'hkrpg_cn',
      lang: 'zh-cn',
      region: regionOverride || getStarRailRegion(uid),
      uid: String(uid)
    }
    const { data, response } = await this.request(GACHA_LOGIN_ENDPOINT, {
      method: 'POST',
      headers: {
        Origin: 'https://act.mihoyo.com',
        Referer: 'https://act.mihoyo.com/',
        'User-Agent': USER_AGENT,
        Cookie: normalizedCookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }, { retryNetwork: true })

    if (Number(data?.retcode) !== 0) {
      throw new MysApiError(`星铁抽卡账号验证失败：${data?.message || data?.msg || '未知业务错误'}`, {
        code: 'GACHA_LOGIN_REJECTED', retcode: data?.retcode,
        apiMessage: data?.message || data?.msg || ''
      })
    }
    const eToken = extractEhrpgToken(response.headers)
    // StarRailUID 原实现允许接口成功但响应未下发 e_hkrpg_token 时继续使用原 Cookie。
    return {
      cookie: eToken ? `${normalizedCookie}; e_hkrpg_token=${eToken}` : normalizedCookie,
      hasEhrpgToken: Boolean(eToken),
      retcode: data.retcode
    }
  }

  async getFiveStarList({ uid, region: regionOverride, cookie, gachaType, deviceId, deviceFp, userAgent = '', maxId, versionId }) {
    const region = regionOverride || getStarRailRegion(uid)
    const params = new URLSearchParams({
      game_biz: 'hkrpg_cn',
      badge_region: region,
      badge_uid: String(uid),
      region,
      uid: String(uid),
      gacha_type: String(gachaType)
    })
    if (maxId) params.set('max_id', String(maxId))
    if (versionId) params.set('version_id', String(versionId))

    const url = `${FIVE_STAR_ENDPOINT}?${params.toString()}`
    const { data } = await this.request(url, {
      method: 'GET',
      headers: {
        Origin: 'https://act.mihoyo.com',
        Referer: 'https://act.mihoyo.com/',
        'User-Agent': userAgent || USER_AGENT,
        Cookie: cookie,
        'x-rpc-device_id': deviceId || DEFAULT_DEVICE_ID,
        ...(deviceFp ? { 'x-rpc-device_fp': deviceFp } : {}),
        'x-rpc-platform': 'pc',
        'x-rpc-jump_source': '2'
      }
    }, { retryNetwork: true })
    return data
  }
}

export default MysApi
