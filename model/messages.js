export const UPDATE_HELP_TEXT = '私发抽卡链接获取完整数据，或发送【wx更新抽卡记录】从微信小程序更新五星记录'

export const UPDATE_QUERY_HINT = '可以通过以下指令查询抽卡记录【wx角色记录】【wx光锥记录】【wx常驻记录】【wx全部记录】'

/**
 * 只在新版接口成功获取到至少一个卡池的数据时，追加查询指令提示。
 * 全部失败、仅读取/迁移旧数据等情况不展示该提示。
 */
export function buildUpdateReply(result) {
  const message = result?.message || '抽卡记录更新完成'
  return result?.ok === true || result?.partial === true
    ? `${message}\n${UPDATE_QUERY_HINT}`
    : message
}
