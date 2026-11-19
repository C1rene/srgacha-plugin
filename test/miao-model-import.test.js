import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const appPath = new URL('../apps/srgacha.js', import.meta.url)
const source = fs.readFileSync(appPath, 'utf8')

test('Miao 模型通过同级插件相对路径导入，不依赖 srgacha package 的 #miao.models 别名', () => {
  assert.match(source, /from ['"]\.\.\/\.\.\/miao-plugin\/models\/index\.js['"]/)
  assert.doesNotMatch(source, /#miao\.models/)
})


test('星铁卡池版本元数据直接复用同级 miao-plugin，未从新版目录读取副本', () => {
  const poolMetaPath = new URL('../model/poolMeta.js', import.meta.url)
  const poolMetaSource = fs.readFileSync(poolMetaPath, 'utf8')
  const itemMetaPath = new URL('../model/itemMeta.js', import.meta.url)
  const itemMetaSource = fs.readFileSync(itemMetaPath, 'utf8')
  assert.match(poolMetaSource, /\.\.\/\.\.\/miao-plugin\/resources\/meta-sr\/info\/index\.js/)
  assert.doesNotMatch(poolMetaSource + itemMetaSource, /\.\.\/resources\/meta-sr/)
})
