import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { migrateLegacyFiveStars } from '../model/migration.js'

test('旧版迁移只提取五星，并按老版完整流水计算包括最早五星在内的间隔', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-migrate-'))
  const dir = path.join(root, '12345', '100820596')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, '11.json')
  await fs.writeFile(file, JSON.stringify([
    { id: '1700000003', uid: '100820596', rank_type: '5', name: '五星乙', item_type: '角色', item_id: '2', time: '2023-11-14 22:13:23' },
    { id: '1700000002', uid: '100820596', rank_type: '4', name: '四星', item_type: '光锥', item_id: '3' },
    { id: '1700000001', uid: '100820596', rank_type: '5', name: '五星甲', item_type: '角色', item_id: '1', time: '2023-11-14 22:13:21' }
  ]))
  const result = await migrateLegacyFiveStars('12345', '100820596', root)
  assert.equal(result.foundRecords, 2)
  assert.deepEqual(result.data.data['角色跃迁'].map(item => item.name), ['五星乙', '五星甲'])
  assert.equal(result.data.data['角色跃迁'][0].gacha_count, 2)
  assert.equal(result.data.data['角色跃迁'][0].gacha_count_known, true)
  assert.equal(result.data.data['角色跃迁'][1].gacha_count, 1)
  assert.equal(result.data.data['角色跃迁'][1].gacha_count_known, true)
  assert.equal(result.data.data['角色跃迁'].some(item => item.name === '四星'), false)
  await fs.rm(root, { recursive: true, force: true })
})

test('旧版迁移计算五星间隔时按抽卡时间排序，而非假定记录 ID 一定按时间递增', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'srgacha-migrate-time-'))
  const dir = path.join(root, '12345', '100820596')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, '11.json'), JSON.stringify([
    { id: '9999999999999999999', rank_type: '5', name: '时间较新的五星', item_type: '角色', item_id: '2', time: '2024-01-03 12:00:00' },
    { id: '1000000000000000001', rank_type: '4', name: '四星', item_type: '角色', item_id: '3', time: '2024-01-01 12:00:00' },
    { id: '8888888888888888888', rank_type: '5', name: '时间较早的五星', item_type: '角色', item_id: '1', time: '2024-01-02 12:00:00' }
  ]))
  const result = await migrateLegacyFiveStars('12345', '100820596', root)
  const records = result.data.data['角色跃迁']
  assert.equal(records.find(item => item.name === '时间较早的五星').gacha_count, 2)
  assert.equal(records.find(item => item.name === '时间较新的五星').gacha_count, 1)
  // 持久化仍按 ID 倒序，供新版接口增量游标使用。
  assert.equal(records[0].id, '9999999999999999999')
  await fs.rm(root, { recursive: true, force: true })
})
