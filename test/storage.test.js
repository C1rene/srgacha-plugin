import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { GachaStorage } from '../model/storage.js'
import { emptyGachaData } from '../model/constants.js'

test('设备 ID 和设备指纹保存在新插件自己的 meta.json', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-storage-'))
  const storage = new GachaStorage('12345', '100820596', root)
  let generatedFor = ''
  const credentials = await storage.getDeviceCredentials('', {
    async generateDeviceFp(deviceId) { generatedFor = deviceId; return 'abcdef0123456' }
  })
  assert.equal(generatedFor, credentials.deviceId)
  assert.match(credentials.deviceId, /^[a-f0-9-]{32,36}$/i)
  assert.equal(credentials.deviceFp, 'abcdef0123456')
  const meta = JSON.parse(await fs.readFile(path.join(root, 'data', '12345', '100820596', 'meta.json'), 'utf8'))
  assert.equal(meta.device_id, credentials.deviceId)
  assert.equal(meta.device_fp, credentials.deviceFp)
  assert.equal('cookie' in meta, false)
  await storage.write(emptyGachaData('100820596'))
  assert.equal(await storage.exists(), true)
  await fs.rm(root, { recursive: true, force: true })
})


test('优先保存 genshin 提供的完整 device_id/device_fp 配对，不保存账号凭据', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-shared-device-'))
  const storage = new GachaStorage('12345', '100820596', root)
  let generated = false
  const credentials = await storage.getDeviceCredentials(
    'genshin-device-id-123',
    { async generateDeviceFp() { generated = true; return 'fffffffffffff' } },
    'abcdef0123456',
    { deviceIdSource: 'genshin_redis_pair', deviceFpSource: 'genshin_redis_pair' }
  )
  assert.equal(credentials.deviceId, 'genshin-device-id-123')
  assert.equal(credentials.deviceFp, 'abcdef0123456')
  assert.equal(credentials.deviceIdSource, 'genshin_redis_pair')
  assert.equal(credentials.deviceFpSource, 'genshin_redis_pair')
  assert.equal(generated, false)
  const meta = JSON.parse(await fs.readFile(path.join(root, 'data', '12345', '100820596', 'meta.json'), 'utf8'))
  assert.equal(meta.device_id_source, 'genshin_redis_pair')
  assert.equal(meta.device_fp_source, 'genshin_redis_pair')
  assert.equal(meta.device_uid, '100820596')
  assert.equal('cookie' in meta, false)
  assert.equal('stoken' in meta, false)
  await fs.rm(root, { recursive: true, force: true })
})

test('不复用 0.1.1 可能混配的旧 meta FP，而是针对当前 device_id 重新生成', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-old-meta-'))
  const storage = new GachaStorage('12345', '100820596', root)
  await fs.mkdir(storage.dir, { recursive: true })
  await fs.writeFile(storage.metaFile, JSON.stringify({
    schema_version: 1, device_id: 'database-device-id-123', device_fp: 'abcdef0123456',
    device_id_source: 'genshin_db', device_fp_source: 'genshin_redis'
  }))
  let generatedFor = ''
  const credentials = await storage.getDeviceCredentials(
    'database-device-id-123',
    { async generateDeviceFp(deviceId) { generatedFor = deviceId; return 'fffffffffffff' } },
    '',
    { deviceIdSource: 'genshin_db', deviceFpSource: 'srgacha_generated_for_device_id' }
  )
  assert.equal(generatedFor, 'database-device-id-123')
  assert.equal(credentials.deviceFp, 'fffffffffffff')
  assert.equal(credentials.deviceFpSource, 'srgacha_generated_for_device_id')
  await fs.rm(root, { recursive: true, force: true })
})
