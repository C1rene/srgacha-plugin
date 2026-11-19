import test from 'node:test'
import assert from 'node:assert/strict'
import { UPDATE_HELP_TEXT, UPDATE_QUERY_HINT, buildUpdateReply } from '../model/messages.js'

test('抽卡帮助返回用户指定的完整文本', () => {
  assert.equal(UPDATE_HELP_TEXT, '私发抽卡链接获取完整数据，或发送【wx更新抽卡记录】从微信小程序更新五星记录')
})

test('成功更新后在原提示末尾换行追加查询指令', () => {
  const original = '增量更新完成。\n新增五星记录 3 条。'
  assert.equal(buildUpdateReply({ ok: true, message: original }), `${original}\n${UPDATE_QUERY_HINT}`)
})

test('部分卡池成功也追加查询指令', () => {
  const original = '增量更新完成。\n部分卡池失败。'
  assert.equal(buildUpdateReply({ ok: false, partial: true, message: original }), `${original}\n${UPDATE_QUERY_HINT}`)
})

test('全部失败或仅迁移旧数据时不追加查询指令', () => {
  assert.equal(buildUpdateReply({ ok: false, message: '六种卡池均未获取成功。' }), '六种卡池均未获取成功。')
  assert.equal(buildUpdateReply({ ok: false, savedMigrationOnly: true, migrationCount: 5, message: '仅迁移旧版数据。' }), '仅迁移旧版数据。')
})
