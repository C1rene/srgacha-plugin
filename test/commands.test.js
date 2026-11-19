import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COMMANDS, matchCommand } from '../model/commands.js'

function miaoNormalizeStarRailPrefix(message) {
  return String(message).replace(/^#?(\*|星铁|星轨|穹轨|星穹|崩铁|星穹铁道|崩坏星穹铁道|铁道)+/, '#星铁')
}

test('普通更新允许省略星号，并兼容 Miao-Yunzai 规范化前缀', () => {
  assert.equal(matchCommand('*wx更新抽卡记录')?.name, 'update')
  assert.equal(matchCommand('wx更新抽卡记录')?.name, 'update')
  assert.equal(matchCommand(miaoNormalizeStarRailPrefix('*wx更新抽卡记录'))?.name, 'update')
  assert.equal(matchCommand('wx更新抽卡记录 100820596')?.uid, '100820596')
})

test('强制更新规则支持框架规范化，但无星号原始消息不能执行', () => {
  assert.equal(matchCommand('*强制更新抽卡记录')?.name, 'force')
  assert.equal(matchCommand(miaoNormalizeStarRailPrefix('*强制更新抽卡记录'))?.name, 'force')
  assert.equal(matchCommand('强制更新抽卡记录'), null)
  const appSource = readFileSync(new URL('../apps/srgacha.js', import.meta.url), 'utf8')
  assert.match(appSource, /rawMessage\.startsWith\('\*'\)/)
})

test('查看和统计命令允许省略星号，补齐老版全部记录/全部统计及常驻池命令', () => {
  const cases = [
    ['*抽卡帮助', 'help'], ['#星铁抽卡帮助', 'help'],
    ['*wx角色记录', 'roleRecords'], ['wx角色记录', 'roleRecords'],
    ['wx抽卡记录', 'roleRecords'], ['*wx抽卡记录', 'roleRecords'],
    ['*wx光锥记录', 'lightconeRecords'], ['wx武器记录', 'lightconeRecords'],
    ['wx全部记录', 'allRecords'], ['wx角色全部记录', 'roleAllRecords'],
    ['*wx角色全部记录 100820596', 'roleAllRecords'],
    ['wx光锥全部记录', 'lightconeAllRecords'], ['wx常驻记录', 'normalRecords'],
    ['wx常驻全部记录', 'normalAllRecords'], ['wx角色全部统计', 'roleAllStats'],
    ['wx光锥全部统计', 'lightconeAllStats'], ['wx常驻统计', 'normalStats'],
    ['wx常驻全部统计', 'normalAllStats'], ['wx角色统计', 'roleStats'],
    ['*wx抽卡统计', 'roleStats'], ['wx角色记录 100820596', 'roleRecords'],
    ['wx全部统计 100820596', 'allStats'], ['wx光锥统计', 'lightconeStats'],
    ['wx武器统计', 'lightconeStats'], ['wx全部统计', 'allStats']
  ]
  for (const [input, expected] of cases) assert.equal(matchCommand(input)?.name, expected, input)

  const normalizedCases = [
    ['*抽卡帮助', 'help'], ['*wx抽卡记录', 'roleRecords'], ['*wx角色记录', 'roleRecords'],
    ['*wx光锥记录', 'lightconeRecords'], ['*wx全部记录', 'allRecords'],
    ['*wx角色全部记录', 'roleAllRecords'], ['*wx光锥全部记录', 'lightconeAllRecords'],
    ['*wx角色统计', 'roleStats'], ['*wx角色全部统计', 'roleAllStats'],
    ['*wx光锥统计', 'lightconeStats'],
    ['*wx全部统计', 'allStats']
  ]
  for (const [input, expected] of normalizedCases) {
    const normalized = miaoNormalizeStarRailPrefix(input)
    assert.equal(matchCommand(normalized)?.name, expected, `${input} => ${normalized}`)
  }
})

test('Miao-Yunzai 事件规则使用同一组命令正则，避免业务解析与事件匹配不一致', () => {
  const appSource = readFileSync(new URL('../apps/srgacha.js', import.meta.url), 'utf8')
  for (const key of Object.keys(COMMANDS)) {
    assert.match(appSource, new RegExp(`reg: COMMANDS\\.${key}`))
  }
  assert.match(appSource, /async gachaHelp\(\)/)
  const normalized = miaoNormalizeStarRailPrefix('*wx抽卡记录')
  assert.equal(normalized, '#星铁wx抽卡记录')
  assert.equal(COMMANDS.roleRecords.test(normalized), true)
})
