import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../resources/html')

test('HTML templates keep a separator between object literal and template close delimiter', async () => {
  for (const name of ['records.html', 'statistics.html']) {
    const source = await readFile(path.join(root, name), 'utf8')
    // In Miao-Yunzai's template syntax, `}}` closes an expression. A literal
    // object ending as `}}}` is parsed as part of the delimiter and breaks compilation.
    assert.doesNotMatch(source, /\{\{set[^\n]*=\s*\{[^\n]*\}\}\}/, `${name} contains an ambiguous object-literal close`)
  }
})


test('新版展示使用独立资源根路径，并且不输出紫卡统计字段', async () => {
  const records = await readFile(path.join(root, 'records.html'), 'utf8')
  const statistics = await readFile(path.join(root, 'statistics.html'), 'utf8')
  assert.match(records, /_res_path\}\}\{\{item\.img\}\}/)
  assert.match(records, /item\.imgRemote/)
  assert.match(statistics, /_res_path\}\}\{\{item\.img\}\}/)
  assert.match(statistics, /item\.imgRemote/)
  for (const key of ['fourNum', 'star4Num', 'c4Num', 'w4Num']) {
    assert.doesNotMatch(records + statistics, new RegExp(key))
  }
})


test('记录页同一天的最后一条记录不会再次强制显示日期标题', async () => {
  const source = await readFile(path.join(root, 'records.html'), 'utf8')
  assert.match(source, /hasDate = \(idx === 0 \|\| \(idx > 0 && gacha\.fiveLog\[idx - 1\]\.dateKey !== ds\.dateKey\)\)/)
  assert.doesNotMatch(source, /hasDate = \([^\n]*idx === gacha\.fiveLog\.length - 1/)
})

test('统计页每期显示抽卡总数，并明确五星间隔跨期的统计限制', async () => {
  const source = await readFile(path.join(root, 'statistics.html'), 'utf8')
  assert.match(source, /stats\.totalNumKnown \? stats\.totalNum : '—'/)
  assert.match(source, /抽卡总数\*/)
  assert.match(source, /跨期垫抽无法精确拆分/)
})


test('记录页不为最后一条记录添加 last 终点精灵，避免底部露出半个星形符号', async () => {
  const source = await readFile(path.join(root, 'records.html'), 'utf8')
  assert.match(source, /class="dot \{\{idx === 0 \? 'first' : ''\}\}"/)
  assert.doesNotMatch(source, /idx === gacha\.fiveLog\.length - 1 \? 'last'/)
})
