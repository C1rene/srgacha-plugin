import test from 'node:test'
import assert from 'node:assert/strict'
import { extractLtuid, resolveGenshinDeviceInfo, buildBoundDeviceUserAgent } from '../adapter/device.js'

function fakeRedis(values) {
  const calls = []
  return {
    calls,
    async get(key) {
      calls.push(key)
      return values[key] ?? null
    }
  }
}

test('从 v1/v2 Cookie 中提取 genshin 设备缓存使用的 ltuid', () => {
  assert.equal(extractLtuid('ltoken=x; ltuid=123456; cookie_token=y;'), '123456')
  assert.equal(extractLtuid('ltoken_v2=x; ltuid_v2=234567; cookie_token_v2=y;'), '234567')
  assert.equal(extractLtuid('account_id=654321; cookie_token=y;'), '654321')
  assert.equal(extractLtuid('cookie_token=y;'), '')
})

test('优先读取 genshin Redis 中同一命名空间的完整 device_id/device_fp 配对', async () => {
  const redis = fakeRedis({
    'genshin:device_fp:123456:id': 'genshin-device-id-123',
    'genshin:device_fp:123456:fp': 'abcdef0123456'
  })
  let dbCalls = 0
  const result = await resolveGenshinDeviceInfo({
    cookie: 'ltuid=123456; cookie_token=x',
    redisClient: redis,
    async dbLookup() { dbCalls++; return 'database-device-id' }
  })
  assert.equal(result.deviceId, 'genshin-device-id-123')
  assert.equal(result.deviceFp, 'abcdef0123456')
  assert.equal(result.deviceIdSource, 'genshin_redis_pair')
  assert.equal(result.deviceFpSource, 'genshin_redis_pair')
  assert.equal(result.devicePairSource, 'genshin_redis_pair')
  assert.equal(dbCalls, 0)
})

test('Redis 只有 device_fp 时丢弃孤立 FP，读取数据库 ID 并为该 ID 重新生成 FP', async () => {
  const redis = fakeRedis({ 'genshin:device_fp:123456:fp': '1234567890abc' })
  let dbLtuid = ''
  const result = await resolveGenshinDeviceInfo({
    cookie: 'ltuid=123456; cookie_token=x',
    redisClient: redis,
    async dbLookup(ltuid) { dbLtuid = ltuid; return 'database-device-id-123' }
  })
  assert.equal(dbLtuid, '123456')
  assert.equal(result.deviceId, 'database-device-id-123')
  assert.equal(result.deviceFp, '')
  assert.equal(result.deviceIdSource, 'genshin_db')
  assert.equal(result.deviceFpSource, 'srgacha_generated_for_device_id')
  assert.equal(result.devicePairSource, 'device_id_repaired_with_new_fp')
})

test('Redis 只有 device_id 时不混用另一来源的 FP', async () => {
  const redis = fakeRedis({ 'genshin:device_fp:123456:id': 'redis-device-id-123' })
  const result = await resolveGenshinDeviceInfo({
    cookie: 'ltuid=123456;', redisClient: redis,
    async dbLookup() { return 'database-device-id' }
  })
  assert.equal(result.deviceId, 'redis-device-id-123')
  assert.equal(result.deviceFp, '')
  assert.equal(result.deviceIdSource, 'genshin_redis_id_only')
})

test('没有 genshin 设备 ID 时回退事件 ID，并为该 ID 生成配套 FP', async () => {
  const result = await resolveGenshinDeviceInfo({
    cookie: 'ltuid=123456; cookie_token=x',
    accountDeviceId: 'event-device-id-123',
    redisClient: fakeRedis({}),
    async dbLookup() { return '' }
  })
  assert.equal(result.deviceId, 'event-device-id-123')
  assert.equal(result.deviceFp, '')
  assert.equal(result.deviceIdSource, 'event_context')
  assert.equal(result.deviceFpSource, 'srgacha_generated_for_device_id')
})

test('兼容 genshin 的 ZZZ 旧 Redis 键，但必须完整成对', async () => {
  const redis = fakeRedis({
    'ZZZ:DEVICE_FP:123456:ID': 'zzz-device-id-123',
    'ZZZ:DEVICE_FP:123456:FP': 'fedcba9876543'
  })
  const result = await resolveGenshinDeviceInfo({
    cookie: 'ltuid=123456;', redisClient: redis,
    async dbLookup() { throw new Error('不应查询数据库') }
  })
  assert.equal(result.deviceId, 'zzz-device-id-123')
  assert.equal(result.deviceFp, 'fedcba9876543')
  assert.equal(result.devicePairSource, 'genshin_redis_pair')
})

test('读取并解析 genshin 绑定设备画像，用于生成匹配的 FP 和 UA', async () => {
  const bindInfo = {
    deviceName: 'XQ-BC52', deviceBoard: 'lahaina', deviceModel: 'XQ-BC52_EEA',
    oaid: 'abc', androidVersion: '13',
    deviceFingerprint: 'Sony/XQ-BC52_EEA/XQ-BC52:13/61.2.A.0.472A/061002A0000472A0046651803:user/release-keys',
    deviceProduct: 'XQ-BC52_EEA'
  }
  const result = await resolveGenshinDeviceInfo({
    cookie: 'ltuid=123456;', redisClient: fakeRedis({ 'genshin:device_fp:123456:bind': JSON.stringify(bindInfo) }),
    async dbLookup() { return 'database-device-id-123' }
  })
  assert.deepEqual(result.bindInfo, bindInfo)
  assert.match(result.userAgent, /Android 13/)
  assert.match(result.userAgent, /XQ-BC52_EEA/)
  assert.match(buildBoundDeviceUserAgent(bindInfo), /miHoYoBBS\/2\.102\.1/)
})

test('只读查询 genshin MysUserDB 对应表的 device 字段', async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { readGenshinDbDeviceId } = await import('../adapter/device.js')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-genshin-db-'))
  const modulePath = path.join(root, 'BaseModel.mjs')
  let querySeen
  await fs.writeFile(modulePath, `export const sequelize = { async query(sql, options) { globalThis.__deviceQuery = { sql, options }; return [[{ device: options.replacements.ltuid === '123456' ? 'db-device-id-123' : null }], {}] } }`)
  assert.equal(await readGenshinDbDeviceId('123456', { dbPath: modulePath }), 'db-device-id-123')
  querySeen = globalThis.__deviceQuery
  assert.match(querySeen.sql, /SELECT device FROM MysUsers WHERE ltuid/)
  assert.deepEqual(querySeen.options.replacements, { ltuid: '123456' })
  assert.equal(await readGenshinDbDeviceId('bad-id', { dbPath: modulePath }), '')
  delete globalThis.__deviceQuery
  await fs.rm(root, { recursive: true, force: true })
})
