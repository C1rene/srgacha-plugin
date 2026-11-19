import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveSrItemMeta, normalizeSrItemName, setMiaoModels, toMiaoResourcePath } from '../model/itemMeta.js'
import { POOLS } from '../model/constants.js'

const characterPool = POOLS.find(pool => pool.id === '11')
const lightconePool = POOLS.find(pool => pool.id === '12')

const characterModels = {
  '知更鸟·晴歌': { name: '知更鸟•晴歌', abbr: '晴歌', star: 5, imgs: { face: '/meta-sr/character/知更鸟•晴歌/imgs/face.webp' } },
  '知更鸟•晴歌': { name: '知更鸟•晴歌', abbr: '晴歌', star: 5, imgs: { face: '/meta-sr/character/知更鸟•晴歌/imgs/face.webp' } },
  '晴歌': { name: '知更鸟•晴歌', abbr: '晴歌', star: 5, imgs: { face: '/meta-sr/character/知更鸟•晴歌/imgs/face.webp' } }
}
const weaponModels = {
  '比阳光更明亮的': { name: '比阳光更明亮的', abbr: '比阳光更明亮', star: 5, img: 'meta-sr/weapon/毁灭/比阳光更明亮的/icon.webp' }
}
setMiaoModels({
  Character: { get: name => characterModels[String(name)] || null },
  Weapon: { get: name => weaponModels[String(name)] || null }
})

test('角色名称、简称和头像由 Miao Character 模型解析', () => {
  const item = resolveSrItemMeta({
    item_id: '1512', name: '知更鸟·晴歌', item_type: '角色', rank_type: '5'
  }, characterPool)
  assert.equal(item.name, '知更鸟•晴歌')
  assert.equal(item.abbr, '晴歌')
  assert.equal(item.type, 'char')
  assert.equal(item.img, '../../miao-plugin/resources/meta-sr/character/知更鸟•晴歌/imgs/face.webp')
  assert.equal(item.imgRemote, false)
})

test('光锥名称、简称和图标由 Miao Weapon 模型解析', () => {
  const item = resolveSrItemMeta({
    item_id: '23015', name: '比阳光更明亮的', item_type: '光锥', rank_type: '5'
  }, lightconePool)
  assert.equal(item.type, 'weapon')
  assert.equal(item.abbr, '比阳光更明亮')
  assert.equal(item.img, '../../miao-plugin/resources/meta-sr/weapon/毁灭/比阳光更明亮的/icon.webp')
  assert.equal(item.imgRemote, false)
})

test('Miao 模型别名解析保持标准名称，并将资源路径指向老版插件', () => {
  assert.equal(normalizeSrItemName('知更鸟·晴歌'), '知更鸟•晴歌')
  assert.equal(normalizeSrItemName('晴歌'), '知更鸟•晴歌')
  assert.equal(toMiaoResourcePath('/meta-sr/character/common/imgs/banner.webp'), '../../miao-plugin/resources/meta-sr/character/common/imgs/banner.webp')
})

test('元数据缺失时保留接口图标，不伪造角色简称', () => {
  const item = resolveSrItemMeta({
    item_id: '999999', name: '未来角色', item_type: '角色', rank_type: '5', icon: 'https://example.com/face.webp'
  }, characterPool)
  assert.equal(item.name, '未来角色')
  assert.equal(item.abbr, '未来角色')
  assert.equal(item.img, 'https://example.com/face.webp')
  assert.equal(item.imgRemote, true)
})


test('新版不再携带重复 meta-sr，元数据统一由老版插件提供', () => {
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  assert.equal(fs.existsSync(path.join(pluginRoot, 'resources/meta-sr')), false)
})
