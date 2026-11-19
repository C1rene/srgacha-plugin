import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { matchCommand } from '../model/commands.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const read = (file) => readFile(path.join(root, file), 'utf8')

test('记录页“查看全部”提示按卡池类型指向正确的全部记录指令', async () => {
  const app = await read('apps/srgacha.js')
  const template = await read('resources/html/records.html')
  assert.match(template, /发送 \{\{gacha\.allRecordsCommand\}\} 查看全部/)
  assert.doesNotMatch(template, /发送 \*wx全部记录 查看全部/)
  for (const command of [
    "character: '*wx角色全部记录'",
    "lightcone: '*wx光锥全部记录'",
    "normal: '*wx常驻全部记录'",
    "all: '*wx全部记录'"
  ]) assert.ok(app.includes(command), `missing mapping ${command}`)
})

test('统计页“查看全部”提示与对应的全部统计指令一致', async () => {
  const app = await read('apps/srgacha.js')
  const template = await read('resources/html/statistics.html')
  assert.match(template, /发送 \{\{gacha\.allStatsCommand\}\} 查看全部/)
  assert.match(template, /if gacha\.allStatsCommand/)
  for (const command of [
    "character: '*wx角色全部统计'",
    "lightcone: '*wx光锥全部统计'",
    "normal: '*wx常驻全部统计'"
  ]) assert.ok(app.includes(command), `missing mapping ${command}`)
})

test('所有抽卡图片先以 base64 消息段形式渲染，不使用默认自动发送模式', async () => {
  const app = await read('apps/srgacha.js')
  const renderCalls = app.match(/this\.renderImg\([\s\S]*?\{ scale: 1\.4, retType: 'base64' \}\)/g) || []
  assert.equal(renderCalls.length, 2, 'records and statistics should both render with retType=base64')
  assert.doesNotMatch(app, /this\.renderImg\([\s\S]*?\{ scale: 1\.4 \}\)/)
  assert.match(app, /await this\.e\.reply\(images\[0\]\)/)
  assert.match(app, /await this\.e\.reply\(image\)/)
  assert.doesNotMatch(app, /await this\.reply\(images\[0\]\)|await this\.reply\(image\)/)
})

test('多张记录与统计图片只通过一次合并转发发送', async () => {
  const app = await read('apps/srgacha.js')
  assert.match(app, /if \(images\.length === 1\)\s*\{\s*await this\.e\.reply\(images\[0\]\)/)
  assert.match(app, /await this\.e\.reply\(await common\.makeForwardMsg\(this\.e, images, title\)\)/)
  assert.match(app, /await this\.e\.reply\(await common\.makeForwardMsg\(this\.e, images, `UID:/)
  assert.equal((app.match(/common\.makeForwardMsg\(this\.e, images/g) || []).length, 2)
})


test('图片模板中所有写死的命令提示均能被新版命令识别', async () => {
  const templates = `${await read('resources/html/records.html')}\n${await read('resources/html/statistics.html')}`
  const commands = [...templates.matchAll(/\*wx[\u4e00-\u9fff]+/g)].map((match) => match[0])
  assert.ok(commands.length > 0)
  for (const command of new Set(commands)) {
    assert.ok(matchCommand(command), `template shows an unrecognized command: ${command}`)
  }
  for (const command of [
    '*wx角色全部记录', '*wx光锥全部记录', '*wx常驻全部记录', '*wx全部记录',
    '*wx角色全部统计', '*wx光锥全部统计', '*wx常驻全部统计'
  ]) {
    assert.ok(matchCommand(command), `footer command is not registered: ${command}`)
  }
})
