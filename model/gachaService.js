import { POOLS, emptyGachaData } from './constants.js'
import { fetchPoolRecords } from './gachaFetcher.js'
import { migrateLegacyFiveStars } from './migration.js'
import { GachaStorage, withRefreshLock } from './storage.js'
import { resolveGenshinDeviceInfo } from '../adapter/device.js'

function compareIdDesc(a, b) {
  const left = String(a?.id || '0'), right = String(b?.id || '0')
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const x = BigInt(left), y = BigInt(right)
    return x > y ? -1 : x < y ? 1 : 0
  }
  return right.localeCompare(left)
}

function hasKnownPullCount(record) {
  const count = Number(record?.gacha_count)
  return record?.gacha_count_known !== false && record?.gacha_count != null && Number.isFinite(count) && count >= 1
}

export function mergeFiveStarRecords(...lists) {
  const byId = new Map()
  for (const list of lists) {
    for (const record of (Array.isArray(list) ? list : [])) {
      if (!record || record.id == null || String(record.id) === '') continue
      const id = String(record.id)
      const previous = byId.get(id) || {}
      // 后面的数据源优先：API > 新版历史 > 旧版迁移。
      const merged = { ...previous, ...record, id }
      // 新接口未提供区间抽数时，不要用 null/0 覆盖旧版完整流水推导出的有效区间。
      if (!hasKnownPullCount(record) && hasKnownPullCount(previous)) {
        merged.gacha_count = Number(previous.gacha_count)
        merged.gacha_count_known = true
      }
      byId.set(id, merged)
    }
  }
  return [...byId.values()].sort(compareIdDesc)
}

function poolCountKey(id) {
  return ({
    '1': 'normal_gacha_num', '2': 'begin_gacha_num', '11': 'char_gacha_num',
    '12': 'weapon_gacha_num', '21': 'char_collabo_gacha_num', '22': 'weapon_collabo_gacha_num'
  })[String(id)]
}

function formatShanghaiTime(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(date).replace('T', ' ')
}

function countAllRecords(data) {
  for (const pool of POOLS) data[poolCountKey(pool.id)] = (data.data[pool.name] || []).length
}

function cloneData(data, uid) {
  const empty = emptyGachaData(uid)
  if (!data || typeof data !== 'object') return empty
  const result = { ...empty, ...data, uid: String(uid), data: { ...empty.data, ...(data.data || {}) } }
  for (const pool of POOLS) {
    if (!Array.isArray(result.data[pool.name])) result.data[pool.name] = []
    result.data[pool.name] = result.data[pool.name].filter(record => record && String(record.rank_type) === '5')
  }
  result.pity_counts = data.pity_counts && typeof data.pity_counts === 'object' ? { ...data.pity_counts } : {}
  result.pool_data_time = data.pool_data_time && typeof data.pool_data_time === 'object' ? { ...data.pool_data_time } : {}
  countAllRecords(result)
  return result
}

/**
 * 普通模式：已有新版文件时只增量更新新版文件；首次运行时先迁移旧版五星。
 * 强制模式：旧版五星 + 新版文件（若有）+ API 全量结果三源合并。
 */
export async function refreshGacha({ userId, account, force = false, api, pluginRoot, legacyRoot, sleep, config = {}, deviceResolver = resolveGenshinDeviceInfo, deviceResolverOptions = {} }) {
  const storage = new GachaStorage(userId, account.uid, pluginRoot)
  const lockKey = `${userId}:${account.uid}`
  return withRefreshLock(lockKey, async () => {
    const existed = await storage.exists()
    let current = storage.empty()
    if (existed) {
      try {
        current = cloneData(await storage.read(), account.uid)
      } catch (error) {
        return { ok: false, message: `新版记录文件读取失败，未覆盖原文件：${error.message}` }
      }
    }

    let migrated = storage.empty()
    let migrationCount = 0
    const needsMigration = !existed || force || Number(current.schema_version || 0) < 2
    if (needsMigration) {
      try {
        const migration = await migrateLegacyFiveStars(userId, account.uid, legacyRoot)
        migrated = migration.data
        migrationCount = migration.foundRecords
      } catch (error) {
        return { ok: false, message: `读取旧版五星记录失败：${error.message}` }
      }
    }

    let baseline
    if (force || (existed && Number(current.schema_version || 0) < 2)) {
      baseline = cloneData(current, account.uid)
      for (const pool of POOLS) {
        baseline.data[pool.name] = mergeFiveStarRecords(migrated.data[pool.name], current.data[pool.name])
      }
      baseline.pity_counts = { ...migrated.pity_counts, ...current.pity_counts }
      baseline.pool_data_time = { ...migrated.pool_data_time, ...current.pool_data_time }
    } else if (existed) {
      baseline = current
    } else {
      baseline = migrated
    }

    let deviceCredentials
    let sharedDeviceInfo
    try {
      sharedDeviceInfo = await deviceResolver({
        cookie: account.cookie,
        ltuid: account.ltuid || account.stuid || '',
        accountDeviceId: account.deviceId || '',
        ...deviceResolverOptions
      })
      deviceCredentials = await storage.getDeviceCredentials(
        sharedDeviceInfo?.deviceId || account.deviceId || '',
        api,
        sharedDeviceInfo?.deviceFp || '',
        {
          deviceIdSource: sharedDeviceInfo?.deviceIdSource,
          deviceFpSource: sharedDeviceInfo?.deviceFpSource,
          deviceInfo: sharedDeviceInfo?.bindInfo || null,
          userAgent: sharedDeviceInfo?.userAgent || ''
        }
      )
    } catch (error) {
      return { ok: false, message: `读取/初始化设备标识和指纹失败：${error.message}` }
    }

    let auth
    try {
      auth = await api.loginGachaAccount(account.uid, account.cookie, account.region)
    } catch (error) {
      return { ok: false, message: `星铁抽卡账号验证失败：${error.message}` }
    }

    const result = cloneData(baseline, account.uid)
    const failedPools = []
    const added = Object.fromEntries(POOLS.map(pool => [pool.name, 0]))
    let successPools = 0

    for (const pool of POOLS) {
      const oldRecords = result.data[pool.name] || []
      const latestId = oldRecords.length ? oldRecords[0].id : null
      try {
        const fetched = await fetchPoolRecords({
          api,
          uid: account.uid,
          region: account.region,
          cookie: auth.cookie,
          deviceId: deviceCredentials.deviceId,
          deviceFp: deviceCredentials.deviceFp,
          userAgent: sharedDeviceInfo?.userAgent || '',
          pool,
          latestId,
          force,
          sleep: sleep || (ms => new Promise(resolve => setTimeout(resolve, config.pageDelayMs ?? 300))),
          maxPages: config.maxPagesPerPool ?? 1000
        })
        const oldIds = new Set(oldRecords.map(record => String(record.id)))
        added[pool.name] = fetched.records.filter(record => !oldIds.has(String(record.id))).length
        result.data[pool.name] = mergeFiveStarRecords(oldRecords, fetched.records)
        result.pity_counts[pool.name] = fetched.pityCount
        result.pool_data_time[pool.name] = formatShanghaiTime()
        successPools++
      } catch (error) {
        failedPools.push({ pool: pool.name, message: error.message, retcode: error.retcode ?? null })
      }
      if (sleep) await sleep(config.poolDelayMs ?? 250)
      else await new Promise(resolve => setTimeout(resolve, config.poolDelayMs ?? 250))
    }

    if (successPools === 0) {
      // 首次迁移即使 API 暂时不可用，也保留已成功提取的旧版五星；已有文件则绝不覆盖。
      if (!existed && migrationCount > 0) {
        result.data_time = formatShanghaiTime()
        countAllRecords(result)
        await storage.write(result)
        return {
          ok: false, savedMigrationOnly: true, migrationCount,
          failedPools,
          message: `新版接口六种卡池均未获取成功；已将旧版 ${migrationCount} 条五星记录迁移到新插件，保底信息待接口恢复后更新。首个错误：${failedPools[0]?.pool || ''} ${failedPools[0]?.message || ''}`
        }
      }
      return {
        ok: false,
        message: `六种卡池均未获取成功，未覆盖本地数据。首个错误：${failedPools[0]?.pool || ''} ${failedPools[0]?.message || ''}`, 
        failedPools
      }
    }

    result.data_time = formatShanghaiTime()
    result.schema_version = 2
    countAllRecords(result)
    await storage.write(result)

    const totalAdded = Object.values(added).reduce((sum, value) => sum + value, 0)
    const details = POOLS.map(pool => `${pool.name} ${added[pool.name]} 条`).join('\n')
    const failedText = failedPools.length
      ? `\n失败卡池：${failedPools.map(item => `${item.pool}（${item.message}）`).join('；')}\n失败卡池保留原有记录和保底。`
      : ''
    return {
      ok: failedPools.length === 0,
      partial: failedPools.length > 0,
      uid: String(account.uid),
      totalAdded,
      added,
      migrationCount,
      failedPools,
      message: `${force ? '强制全量更新' : '增量更新'}完成。\n新增五星记录 ${totalAdded} 条。\n${details}${migrationCount ? `\n首次/强制迁移旧版五星 ${migrationCount} 条。` : ''}${failedText}`
    }
  })
}

export default refreshGacha
