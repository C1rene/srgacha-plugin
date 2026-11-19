import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchPoolRecords } from '../model/gachaFetcher.js'
import { POOLS } from '../model/constants.js'

test('五星接口分页、保底解析及增量停止', async () => {
  const pool = POOLS.find(item => item.id === '11')
  const calls = []
  const api = {
    async getFiveStarList(args) {
      calls.push(args)
      if (calls.length === 1) return {
        retcode: 0,
        data: {
          has_more: true, next_max_id: '2000000000000000002', version_id: 'v1',
          list: [
            { id: '2000000000000000003', item: { item_id: 8001, name: '角色甲', item_type: 'Virtual', rarity: 5, icon: 'https://example.test/a.png' }, is_up: true, gacha_count: 75 },
            { id: '0', item: null, gacha_count: 12 }
          ]
        }
      }
      return { retcode: 0, data: { has_more: false, next_max_id: null, version_id: 'v1', list: [] } }
    }
  }
  const result = await fetchPoolRecords({ api, uid: '100820596', cookie: 'secret', deviceId: 'device', pool, latestId: '2000000000000000001', sleep: async () => {} })
  assert.equal(result.records.length, 1)
  assert.equal(result.records[0].name, '角色甲')
  assert.equal(result.pityCount, 12)
  assert.equal(result.records[0].is_up, true)
  assert.equal(calls.length, 2)
})

test('接口业务错误保留错误信息', async () => {
  const pool = POOLS[0]
  const api = { async getFiveStarList() { return { retcode: -1, message: '请从游戏内打开参与活动' } } }
  await assert.rejects(() => fetchPoolRecords({ api, uid: '100820596', cookie: 'x', deviceId: 'd', pool, sleep: async () => {} }), /请从游戏内打开参与活动/)
})

test('增量遇到本地旧记录后仍提取同页保底记录', async () => {
  const pool = POOLS.find(item => item.id === '11')
  const api = {
    async getFiveStarList() {
      return { retcode: 0, data: { has_more: false, list: [
        { id: '300', item: { item_id: 1, name: '新五星', item_type: 'Avatar', rarity: 5 }, gacha_count: 70, is_up: true },
        { id: '200', item: { item_id: 2, name: '本地已有五星', item_type: 'Avatar', rarity: 5 }, gacha_count: 80, is_up: false },
        { id: '0', item: null, gacha_count: 9 }
      ] } }
    }
  }
  const result = await fetchPoolRecords({ api, uid: '100820596', cookie: 'c', deviceId: 'd', pool, latestId: '200', sleep: async () => {} })
  assert.equal(result.records.length, 1)
  assert.equal(result.pityCount, 9)
})

test('新版接口缺失五星间隔时标记为未知，不把缺失值伪装成 0 抽', async () => {
  const { normalizeFiveStarItem } = await import('../model/gachaFetcher.js')
  const pool = POOLS.find(item => item.id === '11')
  const missing = normalizeFiveStarItem({
    id: '2000000000000000004',
    item: { item_id: 1006, name: '银狼', item_type: 'Avatar', rarity: 5 }
  }, '100820596', pool)
  assert.equal(missing.gacha_count, null)
  assert.equal(missing.gacha_count_known, false)
  const known = normalizeFiveStarItem({
    id: '2000000000000000005',
    item: { item_id: 1006, name: '银狼', item_type: 'Avatar', rarity: 5 },
    gacha_count: 76
  }, '100820596', pool)
  assert.equal(known.gacha_count, 76)
  assert.equal(known.gacha_count_known, true)
})
