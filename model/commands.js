export const COMMANDS = {
  help: /^(?:\*|#星铁)抽卡帮助$/,
  update: /^(?:\*|#星铁)?[wW][xX]更新抽卡记录(?:\s+(\d{9,12}))?$/,
  // #星铁 是 Miao-Yunzai 对原始 * 星铁前缀的规范化形式；实际执行时仍校验 raw_message。
  force: /^(?:\*|#星铁)强制更新抽卡记录(?:\s+(\d{9,12}))?$/,
  roleAllRecords: /^(?:\*|#星铁)?[wW][xX]角色全部记录(?:\s+(\d{9,12}))?$/,
  lightconeAllRecords: /^(?:\*|#星铁)?[wW][xX](?:光锥|武器)全部记录(?:\s+(\d{9,12}))?$/,
  normalAllRecords: /^(?:\*|#星铁)?[wW][xX]常驻全部记录(?:\s+(\d{9,12}))?$/,
  roleRecords: /^(?:\*|#星铁)?[wW][xX](?:角色记录|角色抽卡记录|抽卡记录|抽奖记录|up记录)(?:\s+(\d{9,12}))?$/,
  lightconeRecords: /^(?:\*|#星铁)?[wW][xX](?:光锥记录|光锥抽卡记录|武器记录)(?:\s+(\d{9,12}))?$/,
  normalRecords: /^(?:\*|#星铁)?[wW][xX]常驻记录(?:\s+(\d{9,12}))?$/,
  allRecords: /^(?:\*|#星铁)?[wW][xX]全部记录(?:\s+(\d{9,12}))?$/,
  roleAllStats: /^(?:\*|#星铁)?[wW][xX]角色全部统计(?:\s+(\d{9,12}))?$/,
  lightconeAllStats: /^(?:\*|#星铁)?[wW][xX](?:光锥|武器)全部统计(?:\s+(\d{9,12}))?$/,
  normalAllStats: /^(?:\*|#星铁)?[wW][xX]常驻全部统计(?:\s+(\d{9,12}))?$/,
  roleStats: /^(?:\*|#星铁)?[wW][xX](?:角色统计|角色抽卡统计|抽卡统计|抽奖统计|up统计)(?:\s+(\d{9,12}))?$/,
  lightconeStats: /^(?:\*|#星铁)?[wW][xX](?:光锥统计|光锥抽卡统计|武器统计)(?:\s+(\d{9,12}))?$/,
  normalStats: /^(?:\*|#星铁)?[wW][xX]常驻统计(?:\s+(\d{9,12}))?$/,
  allStats: /^(?:\*|#星铁)?[wW][xX]全部统计(?:\s+(\d{9,12}))?$/
}

export function matchCommand(message) {
  const msg = String(message || '').trim()
  for (const [name, regex] of Object.entries(COMMANDS)) {
    const match = msg.match(regex)
    if (match) return { name, uid: match[1] || null }
  }
  return null
}
