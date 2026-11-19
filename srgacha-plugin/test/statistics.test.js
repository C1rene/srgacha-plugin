import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStatistics } from '../model/statistics.js'
import { buildRecordPoolView, buildRecordsView, selectPools } from '../model/renderData.js'
import { calculateGachaLuck } from '../model/gachaLuck.js'
import { resolveRecordIsUp } from '../model/poolMeta.js'
import { setMiaoModels } from '../model/itemMeta.js'
import { emptyGachaData, POOLS } from '../model/constants.js'

const knownCharacters = new Set(['希儿', '知更鸟·晴歌', '知更鸟•晴歌', '晴歌', '姬子', '瓦尔特', '开拓者'])
setMiaoModels({
  Character: {
    get(name) {
      const value = String(name || '')
      if (!knownCharacters.has(value)) return null
      const canonical = ['知更鸟·晴歌', '知更鸟•晴歌', '晴歌'].includes(value) ? '知更鸟•晴歌' : value
      return {
        name: canonical,
        abbr: canonical === '知更鸟•晴歌' ? '晴歌' : canonical,
        star: 5,
        imgs: { face: `/meta-sr/character/${canonical}/imgs/face.webp` }
      }
    }
  },
  Weapon: { get: () => null }
})

test('记录和统计模式保留新版六池范围，角色/光锥模式包含对应联动池', () => {
  assert.deepEqual(selectPools('character').map(pool => pool.id), ['11', '21'])
  assert.deepEqual(selectPools('lightcone').map(pool => pool.id), ['12', '22'])
  assert.deepEqual(selectPools('all').map(pool => pool.id), ['1', '2', '11', '12', '21', '22'])
})

test('记录视图采用老版五星时间线结构，并保留未知间隔和未知 UP 状态', () => {
  const data = emptyGachaData('100820596')
  data.data['角色跃迁'] = [
    { id: '1700000002', item_id: '2', rank_type: '5', item_type: '角色', name: '角色乙', icon: 'https://example.com/b.png', gacha_count: 80, gacha_count_known: true, is_up: true, time: '2024-01-02 12:00:00' },
    { id: '1700000001', item_id: '1', rank_type: '5', item_type: '角色', name: '角色甲', gacha_count: null, gacha_count_known: false, is_up: null, time: '2099-01-01 12:00:00' },
    { id: '1700000000', item_id: '4', rank_type: '4', name: '四星不应出现' }
  ]
  data.pity_counts['角色跃迁'] = 10
  const pool = POOLS.find(item => item.id === '11')
  const view = buildRecordPoolView(data, pool, { maxLog: 30 })
  assert.equal(view.poolName, '角色')
  assert.equal(view.gacha.fiveLog[0].isCurrent, true)
  assert.equal(view.gacha.fiveLog[1].countKnown, false)
  assert.equal(view.gacha.fiveLog[2].count, 80)
  assert.equal(view.gacha.fiveLog[1].isUp, null)
  assert.equal(view.gacha.stat.fiveNum, 2)
  assert.equal(view.gacha.stat.allNum, undefined)
  assert.equal(view.gacha.items['character:2'].img, 'https://example.com/b.png')
  assert.equal(buildRecordsView(data, 'character').totalFiveStars, 2)
})

test('记录分页保留第一页当前保底，并按老版每页记录数分组', () => {
  const data = emptyGachaData('100820596')
  data.pity_counts['角色跃迁'] = 5
  data.data['角色跃迁'] = Array.from({ length: 65 }, (_, index) => ({
    id: String(1700000000 + index), item_id: String(index), rank_type: '5', item_type: '角色',
    name: `角色${index}`, gacha_count: 70, gacha_count_known: true, is_up: index % 2 === 0,
    time: `2024-01-${String(index % 28 + 1).padStart(2, '0')} 12:00:00`
  }))
  const pool = POOLS.find(item => item.id === '11')
  const view = buildRecordPoolView(data, pool, { all: true, pageSize: 30 })
  assert.equal(view.pages.length, 3)
  assert.equal(view.pages[0].fiveLog[0].isCurrent, true)
  assert.equal(view.pages[0].fiveLog.length, 31)
  assert.equal(view.pages[1].fiveLog.length, 30)
  assert.equal(view.pages[2].fiveLog.length, 5)
})

test('统计视图按老版卡池版本分组，全部统计仍汇总六种卡池', () => {
  const data = emptyGachaData('100820596')
  data.data['角色跃迁'] = [
    { id: '1700000002', item_id: '2', rank_type: '5', item_type: '角色', name: '角色乙', gacha_count: 80, gacha_count_known: true, is_up: true, time: '2024-01-02 12:00:00' },
    { id: '1700000001', item_id: '1', rank_type: '5', item_type: '角色', name: '角色甲', gacha_count: 70, gacha_count_known: true, is_up: false, time: '2024-01-01 12:00:00' }
  ]
  data.data['光锥跃迁'] = [
    { id: '1700000003', item_id: '3', rank_type: '5', item_type: '光锥', name: '光锥丙', gacha_count: 60, gacha_count_known: true, is_up: true, time: '2024-01-03 12:00:00' }
  ]
  for (const pool of POOLS) data.pity_counts[pool.name] = 0
  const role = buildStatistics(data, 'character')
  assert.equal(role.totalFiveStars, 2)
  assert.equal(role.versionData.length, 1)
  assert.equal(role.versionData[0].stats.star5Num, 2)
  assert.equal(role.versionData[0].stats.upNum, 1)
  assert.equal(role.versionData[0].stats.totalNum, 150)
  assert.equal(role.versionData[0].stats.totalNumKnown, true)
  assert.equal(role.totalStat.totalNum, 150)

  const all = buildStatistics(data, 'all')
  assert.equal(all.totalFiveStars, 3)
  assert.equal(all.versionData.length, 1)
  assert.equal(all.versionData[0].version, '全部统计')
  assert.equal(all.versionData[0].stats.totalNum, 210)
  assert.equal(all.totalStat.c5UpNum, 1)
  assert.equal(all.totalStat.w5UpNum, 1)
  assert.equal(all.totalStat.totalNum, 210)
})

test('缺少 is_up 时按本地卡池版本名单回退，常驻池按老版规则判定', () => {
  const rolePool = POOLS.find(item => item.id === '11')
  const normalPool = POOLS.find(item => item.id === '1')
  assert.equal(resolveRecordIsUp({ name: '希儿', item_type: '角色', time: '2023-04-26 12:00:00', is_up: null }, rolePool), true)
  assert.equal(resolveRecordIsUp({ name: '普通常驻物品', item_type: '角色', time: '2023-04-26 12:00:00', is_up: null }, normalPool), false)
  assert.equal(resolveRecordIsUp({ name: '未来未知角色', item_type: '角色', time: '2099-01-01 00:00:00', is_up: null }, rolePool), null)
  assert.equal(resolveRecordIsUp({ name: '知更鸟·晴歌', item_type: '角色', time: '2026-08-27 12:00:00', is_up: null }, rolePool), true)
})

test('常驻池即使没有 UP 字段，也能按五星抽数计算老版出金运气', () => {
  const data = emptyGachaData('100820596')
  data.data['群星跃迁'] = [
    { id: '1700000002', item_id: '2', rank_type: '5', item_type: '角色', name: '常驻角色乙', gacha_count: 80, gacha_count_known: true, is_up: null, time: '2024-01-02 12:00:00' },
    { id: '1700000001', item_id: '1', rank_type: '5', item_type: '光锥', name: '常驻光锥甲', gacha_count: 70, gacha_count_known: true, is_up: null, time: '2024-01-01 12:00:00' }
  ]
  data.pity_counts['群星跃迁'] = 10
  const pool = POOLS.find(item => item.id === '1')
  const view = buildRecordPoolView(data, pool)
  assert.ok(view.gacha.luck)
  assert.equal(view.gacha.luck.isUpPool, false)
  assert.equal(view.gacha.stat.fiveAvg, '75.00')
})

test('老版欧皇度概率模型可按星铁角色池和光锥池计算', () => {
  const role = calculateGachaLuck({ poolId: '11', isUpPool: true, upNum: 2, upUsed: 150, fiveNum: 3, fiveUsed: 220, smallNum: 2, smallWin: 1 })
  const lightcone = calculateGachaLuck({ poolId: '12', isUpPool: true, upNum: 2, upUsed: 120, fiveNum: 3, fiveUsed: 190, smallNum: 2, smallWin: 1 })
  assert.ok(role && role.title)
  assert.ok(lightcone && lightcone.title)
  assert.equal(role.isUpPool, true)
  assert.equal(lightcone.isUpPool, true)
})

test('新版记录统计补齐老版右侧汇总数据与欧非分析，名称按老版简称展示', () => {
  const data = emptyGachaData('100820596')
  data.data['角色跃迁'] = [
    { id: '1787800000', item_id: '1006', rank_type: '5', item_type: '角色', name: '银狼', gacha_count: 70, gacha_count_known: true, is_up: false, time: '2026-08-27 12:00:00' },
    { id: '1787700000', item_id: '1512', rank_type: '5', item_type: '角色', name: '知更鸟·晴歌', gacha_count: 80, gacha_count_known: true, is_up: true, time: '2026-08-27 11:00:00' }
  ]
  data.pity_counts['角色跃迁'] = 12
  const view = buildRecordPoolView(data, POOLS.find(pool => pool.id === '11'))
  assert.equal(view.gacha.stat.allNum, 162)
  assert.equal(view.gacha.stat.fiveNum, 2)
  assert.equal(view.gacha.stat.wai, 1)
  assert.equal(view.gacha.stat.fiveAvg, '75.00')
  assert.equal(view.gacha.stat.upYs, '1.28w')
  assert.ok(view.gacha.luck)
  assert.equal(view.gacha.luck.isUpPool, true)
  assert.equal(view.gacha.items['character:1512'].name, '知更鸟•晴歌')
  assert.equal(view.gacha.items['character:1512'].abbr, '晴歌')
  assert.match(view.gacha.items['character:1512'].img, /miao-plugin\/resources\/meta-sr\/character\/知更鸟•晴歌\/imgs\/face\.webp$/)
})

test('常驻统计按老版口径汇总为单独常驻池，而不是按活动版本拆分', () => {
  const data = emptyGachaData('100820596')
  data.data['群星跃迁'] = [
    { id: '1700000002', item_id: '1003', rank_type: '5', item_type: '角色', name: '姬子', gacha_count: 80, gacha_count_known: true, is_up: null, time: '2024-01-02 12:00:00' },
    { id: '1700000001', item_id: '1004', rank_type: '5', item_type: '角色', name: '瓦尔特', gacha_count: 70, gacha_count_known: true, is_up: null, time: '2024-01-01 12:00:00' }
  ]
  data.pity_counts['群星跃迁'] = 10
  const result = buildStatistics(data, 'normal')
  assert.equal(result.versionData.length, 1)
  assert.equal(result.versionData[0].version, '常驻池')
  assert.equal(result.totalStat.totalNum, 160)
})


test('最新版本 UP 名单未知时仍展示五星欧非分析，并明确提示 UP 判定未收录', () => {
  const data = emptyGachaData('100820596')
  data.data['角色跃迁'] = [
    { id: '4070908800', item_id: '1512', rank_type: '5', item_type: '角色', name: '知更鸟·晴歌', gacha_count: 80, gacha_count_known: true, is_up: null, time: '2099-01-01 12:00:00' }
  ]
  data.pity_counts['角色跃迁'] = 5
  const view = buildRecordPoolView(data, POOLS.find(pool => pool.id === '11'))
  assert.ok(view.gacha.luck)
  assert.equal(view.gacha.luck.isUpPool, false)
  assert.equal(view.gacha.luck.hasNewPool, true)
})

test('记录时间线严格按真实抽卡时间排序，不依赖可能不连续的记录 ID', () => {
  const data = emptyGachaData('100820596')
  data.data['角色跃迁'] = [
    { id: '9999999999999999999', item_id: '1003', rank_type: '5', item_type: '角色', name: '姬子', gacha_count: 70, gacha_count_known: true, is_up: false, time: '2026-07-15 20:00:00' },
    { id: '1000000000000000001', item_id: '1004', rank_type: '5', item_type: '角色', name: '瓦尔特', gacha_count: 75, gacha_count_known: true, is_up: false, time: '2026-07-15 12:00:00' },
    { id: '8888888888888888888', item_id: '1005', rank_type: '5', item_type: '角色', name: '开拓者', gacha_count: 80, gacha_count_known: true, is_up: false, time: '2026-07-14 23:00:00' }
  ]
  data.pity_counts['角色跃迁'] = 6
  const view = buildRecordPoolView(data, POOLS.find(pool => pool.id === '11'))
  const history = view.gacha.fiveLog.filter(item => !item.isCurrent)
  assert.deepEqual(history.map(item => item.date), ['07-15', '07-15', '07-14'])
  assert.deepEqual(history.map(item => item.dateKey), ['2026-07-15', '2026-07-15', '2026-07-14'])
  assert.equal(history[0].time, '2026-07-15 20:00:00')
  assert.equal(history[1].time, '2026-07-15 12:00:00')
})

test('记录视图可注入与老版一致的真实玩家头像信息', () => {
  const data = emptyGachaData('100820596')
  data.pity_counts['角色跃迁'] = 0
  const face = { name: 'Destiny', banner: 'meta-sr/character/common/imgs/banner.webp', face: 'meta-sr/character/某角色/imgs/face.webp', qFace: 'meta-sr/character/某角色/imgs/face.webp' }
  const view = buildRecordPoolView(data, POOLS.find(pool => pool.id === '11'), { face })
  assert.equal(view.face.name, 'Destiny')
  assert.equal(view.face.face, face.face)
})


test('卡池标题角色名使用老版 Character 模型简称', () => {
  const data = emptyGachaData('100820596')
  data.data['角色跃迁'] = [
    { id: '1787800000', item_id: '1512', rank_type: '5', item_type: '角色', name: '知更鸟·晴歌', gacha_count: 75, gacha_count_known: true, is_up: true, time: '2026-08-27 12:00:00' }
  ]
  const result = buildStatistics(data, 'character')
  assert.equal(result.versionData[0].name, '晴歌 / 风堇')
})
