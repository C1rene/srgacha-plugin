import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { refreshGacha } from '../model/gachaService.js'
import { POOLS } from '../model/constants.js'

test('首次运行迁移旧版五星并写入新插件目录', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-service-'))
  const legacyRoot = path.join(root, 'legacy')
  const legacyDir = path.join(legacyRoot, '12345', '100820596')
  await fs.mkdir(legacyDir, { recursive: true })
  await fs.writeFile(path.join(legacyDir, '11.json'), JSON.stringify([
    { id: '1700000001', rank_type: '5', name: '旧五星', item_type: '角色', item_id: '1', uid: '100820596' },
    { id: '1700000000', rank_type: '4', name: '旧四星', item_type: '光锥', item_id: '2', uid: '100820596' }
  ]))
  const api = {
    async loginGachaAccount() { return { cookie: 'cookie;e_hkrpg_token=token' } },
    async getFiveStarList({ gachaType }) {
      const pool = POOLS.find(item => item.code === gachaType)
      return { retcode: 0, data: { has_more: false, next_max_id: null, version_id: 'v1', list: [
        { id: '0', item: null, gacha_count: 8 },
        ...(pool.id === '11' ? [{ id: '1700000002', item: { item_id: 2, name: '新五星', item_type: 'Avatar', rarity: 5, icon: '' }, is_up: true, gacha_count: 70 }] : [])
      ] } }
    }
  }
  const result = await refreshGacha({
    userId: '12345', account: { uid: '100820596', cookie: 'cookie' }, api,
    pluginRoot: path.join(root, 'plugin'), legacyRoot, sleep: async () => {},
    config: { pageDelayMs: 0, poolDelayMs: 0 }
  })
  assert.equal(result.totalAdded, 1)
  const saved = JSON.parse(await fs.readFile(path.join(root, 'plugin', 'data', '12345', '100820596', 'gacha_logs_new.json'), 'utf8'))
  assert.deepEqual(saved.data['角色跃迁'].map(item => item.name), ['新五星', '旧五星'])
  assert.equal(saved.data['角色跃迁'].some(item => item.name === '旧四星'), false)
  await fs.rm(root, { recursive: true, force: true })
})

test('强制更新合并旧版、新版和接口三份数据', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-force-'))
  const pluginRoot = path.join(root, 'plugin')
  const legacyRoot = path.join(root, 'legacy')
  const legacyDir = path.join(legacyRoot, '12345', '100820596')
  const newDir = path.join(pluginRoot, 'data', '12345', '100820596')
  await fs.mkdir(legacyDir, { recursive: true })
  await fs.mkdir(newDir, { recursive: true })
  await fs.writeFile(path.join(legacyDir, '11.json'), JSON.stringify([
    { id: '1700000001', rank_type: '5', name: '旧源五星', item_type: '角色', item_id: '1', uid: '100820596' }
  ]))
  const existing = {
    uid: '100820596', data: Object.fromEntries(POOLS.map(pool => [pool.name, []])),
    pity_counts: {}, pool_data_time: {}
  }
  existing.data['角色跃迁'].push({ id: '1700000002', rank_type: '5', name: '新版文件五星', item_type: '角色', gacha_type: '11' })
  await fs.writeFile(path.join(newDir, 'gacha_logs_new.json'), JSON.stringify(existing))
  const api = {
    async loginGachaAccount() { return { cookie: 'cookie' } },
    async getFiveStarList({ gachaType }) {
      const pool = POOLS.find(item => item.code === gachaType)
      return { retcode: 0, data: { has_more: false, list: [
        { id: '0', item: null, gacha_count: 4 },
        ...(pool.id === '11' ? [{ id: '1700000003', item: { item_id: 3, name: '接口五星', item_type: 'Avatar', rarity: 5 }, is_up: false, gacha_count: 60 }] : [])
      ] } }
    }
  }
  const result = await refreshGacha({ userId: '12345', account: { uid: '100820596', cookie: 'cookie' }, force: true, api, pluginRoot, legacyRoot, sleep: async () => {}, config: { poolDelayMs: 0, pageDelayMs: 0 } })
  assert.equal(result.totalAdded, 1)
  const saved = JSON.parse(await fs.readFile(path.join(newDir, 'gacha_logs_new.json'), 'utf8'))
  assert.deepEqual(saved.data['角色跃迁'].map(item => item.name), ['接口五星', '新版文件五星', '旧源五星'])
  await fs.rm(root, { recursive: true, force: true })
})

test('六池全失败时不覆盖已存在的新文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-failed-'))
  const dir = path.join(root, 'data', '12345', '100820596')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'gacha_logs_new.json')
  const original = { uid: '100820596', data: Object.fromEntries(POOLS.map(pool => [pool.name, []])), pity_counts: { '角色跃迁': 3 } }
  await fs.writeFile(file, JSON.stringify(original))
  const api = {
    async loginGachaAccount() { return { cookie: 'cookie' } },
    async getFiveStarList() { return { retcode: -1, message: '暂时失败' } }
  }
  const result = await refreshGacha({ userId: '12345', account: { uid: '100820596', cookie: 'cookie' }, api, pluginRoot: root, legacyRoot: path.join(root, 'missing'), sleep: async () => {}, config: { poolDelayMs: 0, pageDelayMs: 0 } })
  assert.equal(result.ok, false)
  const after = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.deepEqual(after, original)
  await fs.rm(root, { recursive: true, force: true })
})

test('已有新版文件的普通更新不会重新读取旧版文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-incremental-'))
  const pluginRoot = path.join(root, 'plugin')
  const legacyRoot = path.join(root, 'legacy')
  const legacyDir = path.join(legacyRoot, '12345', '100820596')
  const newDir = path.join(pluginRoot, 'data', '12345', '100820596')
  await fs.mkdir(legacyDir, { recursive: true })
  await fs.mkdir(newDir, { recursive: true })
  await fs.writeFile(path.join(legacyDir, '11.json'), JSON.stringify([
    { id: '1700000001', rank_type: '5', name: '不应重复迁移的旧五星', item_type: '角色', item_id: '1', uid: '100820596' }
  ]))
  const existing = { uid: '100820596', data: Object.fromEntries(POOLS.map(pool => [pool.name, []])), pity_counts: {}, pool_data_time: {} }
  existing.data['角色跃迁'].push({ id: '1700000002', rank_type: '5', name: '新版已有五星', item_type: '角色', gacha_type: '11' })
  await fs.writeFile(path.join(newDir, 'gacha_logs_new.json'), JSON.stringify(existing))
  const api = {
    async loginGachaAccount() { return { cookie: 'cookie' } },
    async getFiveStarList() { return { retcode: 0, data: { has_more: false, list: [{ id: '0', item: null, gacha_count: 5 }] } } }
  }
  const result = await refreshGacha({ userId: '12345', account: { uid: '100820596', cookie: 'cookie' }, api, pluginRoot, legacyRoot, sleep: async () => {}, config: { poolDelayMs: 0, pageDelayMs: 0 } })
  const saved = JSON.parse(await fs.readFile(path.join(newDir, 'gacha_logs_new.json'), 'utf8'))
  assert.equal(result.migrationCount, 0)
  assert.deepEqual(saved.data['角色跃迁'].map(item => item.name), ['新版已有五星'])
  await fs.rm(root, { recursive: true, force: true })
})

test('更新流程优先使用共享设备适配器返回的 genshin device_id/device_fp', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-device-integration-'))
  let resolverInput
  const seenDevices = []
  const api = {
    async loginGachaAccount() { return { cookie: 'cookie' } },
    async getFiveStarList(args) {
      seenDevices.push({ deviceId: args.deviceId, deviceFp: args.deviceFp })
      return { retcode: 0, data: { has_more: false, list: [{ id: '0', item: null, gacha_count: 6 }] } }
    }
  }
  const result = await refreshGacha({
    userId: '12345',
    account: { uid: '100820596', cookie: 'ltuid=123456;cookie_token=x;' },
    api,
    pluginRoot: path.join(root, 'plugin'),
    legacyRoot: path.join(root, 'legacy'),
    sleep: async () => {},
    config: { pageDelayMs: 0, poolDelayMs: 0 },
    async deviceResolver(input) {
      resolverInput = input
      return {
        deviceId: 'genshin-device-id-123',
        deviceFp: 'abcdef0123456',
        deviceIdSource: 'genshin_redis',
        deviceFpSource: 'genshin_redis'
      }
    }
  })
  assert.equal(resolverInput.cookie, 'ltuid=123456;cookie_token=x;')
  assert.equal(seenDevices.length, POOLS.length)
  assert.ok(seenDevices.every(item => item.deviceId === 'genshin-device-id-123' && item.deviceFp === 'abcdef0123456'))
  assert.doesNotMatch(result.message, /认证结果：|设备信息来源：|device_id=|device_fp=/)
  const meta = JSON.parse(await fs.readFile(path.join(root, 'plugin', 'data', '12345', '100820596', 'meta.json'), 'utf8'))
  assert.equal(meta.device_id_source, 'genshin_redis')
  assert.equal(meta.device_fp_source, 'genshin_redis')
  await fs.rm(root, { recursive: true, force: true })
})

test('不混用 genshin 半套设备缓存：按最终 device_id 重新生成 FP 并使用绑定画像 UA', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-device-pair-repair-'))
  const bindInfo = {
    deviceName: 'XQ-BC52', deviceBoard: 'lahaina', deviceModel: 'XQ-BC52_EEA',
    oaid: 'test-oaid', androidVersion: '13',
    deviceFingerprint: 'Sony/XQ-BC52_EEA/XQ-BC52:13/61.2.A.0.472A/061002A0000472A0046651803:user/release-keys',
    deviceProduct: 'XQ-BC52_EEA'
  }
  let generatedFor = ''
  let generatedWith = null
  const seen = []
  const api = {
    async loginGachaAccount() { return { cookie: 'cookie', hasEhrpgToken: true } },
    async generateDeviceFp(deviceId, deviceInfo) {
      generatedFor = deviceId
      generatedWith = deviceInfo
      return 'fedcba9876543'
    },
    async getFiveStarList(args) {
      seen.push(args)
      return { retcode: 0, data: { has_more: false, list: [{ id: '0', item: null, gacha_count: 6 }] } }
    }
  }
  const result = await refreshGacha({
    userId: '12345', account: { uid: '100820596', cookie: 'cookie' }, api,
    pluginRoot: path.join(root, 'plugin'), legacyRoot: path.join(root, 'legacy'),
    sleep: async () => {}, config: { pageDelayMs: 0, poolDelayMs: 0 },
    async deviceResolver() {
      return {
        deviceId: 'database-device-id-123', deviceFp: '', bindInfo,
        userAgent: 'bound-device-user-agent', userAgentSource: 'genshin_redis_bind',
        deviceIdSource: 'genshin_db', deviceFpSource: 'srgacha_generated_for_device_id',
        devicePairSource: 'device_id_repaired_with_new_fp'
      }
    }
  })
  assert.equal(generatedFor, 'database-device-id-123')
  assert.deepEqual(generatedWith, bindInfo)
  assert.equal(seen.length, POOLS.length)
  assert.ok(seen.every(item => item.deviceId === 'database-device-id-123'))
  assert.ok(seen.every(item => item.deviceFp === 'fedcba9876543'))
  assert.ok(seen.every(item => item.userAgent === 'bound-device-user-agent'))
  assert.doesNotMatch(result.message, /认证结果：|设备信息来源：|device_id=|device_fp=/)
  await fs.rm(root, { recursive: true, force: true })
})

test('schema v1 旧数据在普通更新时自动回迁最早五星间隔并升级 schema v2', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-schema-upgrade-'))
  const pluginRoot = path.join(root, 'plugin')
  const legacyRoot = path.join(root, 'legacy')
  const legacyDir = path.join(legacyRoot, '12345', '100820596')
  const newDir = path.join(pluginRoot, 'data', '12345', '100820596')
  await fs.mkdir(legacyDir, { recursive: true })
  await fs.mkdir(newDir, { recursive: true })
  await fs.writeFile(path.join(legacyDir, '11.json'), JSON.stringify([
    { id: '1700000003', rank_type: '5', name: '较新的五星', item_type: '角色', item_id: '2', time: '2023-11-14 22:13:23' },
    { id: '1700000002', rank_type: '4', name: '四星', item_type: '角色', item_id: '3', time: '2023-11-14 22:13:22' },
    { id: '1700000001', rank_type: '5', name: '最早五星', item_type: '角色', item_id: '1', time: '2023-11-14 22:13:21' }
  ]))
  const old = {
    schema_version: 1, uid: '100820596',
    data: Object.fromEntries(POOLS.map(pool => [pool.name, []])),
    pity_counts: {}, pool_data_time: {}
  }
  old.data['角色跃迁'].push({ id: '1700000001', rank_type: '5', name: '最早五星', item_type: '角色', item_id: '1', gacha_count: null, gacha_count_known: false, time: '2023-11-14 22:13:21' })
  await fs.writeFile(path.join(newDir, 'gacha_logs_new.json'), JSON.stringify(old))
  const api = {
    async loginGachaAccount() { return { cookie: 'cookie' } },
    async getFiveStarList() { return { retcode: 0, data: { has_more: false, list: [{ id: '0', item: null, gacha_count: 6 }] } } }
  }
  const result = await refreshGacha({
    userId: '12345', account: { uid: '100820596', cookie: 'cookie' }, api,
    pluginRoot, legacyRoot, sleep: async () => {}, config: { pageDelayMs: 0, poolDelayMs: 0 }
  })
  assert.equal(result.ok, true)
  const saved = JSON.parse(await fs.readFile(path.join(newDir, 'gacha_logs_new.json'), 'utf8'))
  assert.equal(saved.schema_version, 2)
  const earliest = saved.data['角色跃迁'].find(item => item.id === '1700000001')
  assert.equal(earliest.gacha_count, 1)
  assert.equal(earliest.gacha_count_known, true)
  await fs.rm(root, { recursive: true, force: true })
})

test('合并时接口缺失抽数不覆盖旧版完整流水已推导出的有效抽数', async () => {
  const { mergeFiveStarRecords } = await import('../model/gachaService.js')
  const merged = mergeFiveStarRecords(
    [{ id: '1', gacha_count: 41, gacha_count_known: true, name: '旧版记录' }],
    [{ id: '1', gacha_count: null, gacha_count_known: false, name: '接口记录' }]
  )
  assert.equal(merged[0].name, '接口记录')
  assert.equal(merged[0].gacha_count, 41)
  assert.equal(merged[0].gacha_count_known, true)
})
