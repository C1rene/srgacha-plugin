import plugin from '../../../lib/plugins/plugin.js'
import common from '../../../lib/common/common.js'
import { COMMANDS, matchCommand } from '../model/commands.js'
import { resolveXiaoyaoAccount } from '../adapter/xiaoyao.js'
import { MysApi } from '../model/mysApi.js'
import { refreshGacha } from '../model/gachaService.js'
import { GachaStorage } from '../model/storage.js'
import { buildRecordPoolView, selectPools } from '../model/renderData.js'
import { buildStatistics } from '../model/statistics.js'
import { getConfig } from '../model/config.js'
import { Character, Player, Weapon } from '../../miao-plugin/models/index.js'
import { setMiaoModels } from '../model/itemMeta.js'
import { getMiaoPlayerFace } from '../model/playerFace.js'
import { getCopyrightOptions } from '../model/copyright.js'
import { UPDATE_HELP_TEXT, buildUpdateReply } from '../model/messages.js'

// 角色、光锥别名、简称与图标统一使用老版插件的模型及 meta-sr。
setMiaoModels({ Character, Weapon })

export class srgacha extends plugin {
  constructor() {
    super({
      name: '星铁新版抽卡记录',
      dsc: '星铁五星抽卡记录更新、查看与统计',
      event: 'message',
      priority: 40,
      rule: [
        // 保留新版原有的指令正则与注册方式，避免与老版插件冲突。
        { reg: COMMANDS.help, fnc: 'gachaHelp' },
        { reg: COMMANDS.update, fnc: 'update' },
        { reg: COMMANDS.force, fnc: 'forceUpdate' },
        { reg: COMMANDS.roleAllRecords, fnc: 'roleAllRecords' },
        { reg: COMMANDS.lightconeAllRecords, fnc: 'lightconeAllRecords' },
        { reg: COMMANDS.normalAllRecords, fnc: 'normalAllRecords' },
        { reg: COMMANDS.roleRecords, fnc: 'roleRecords' },
        { reg: COMMANDS.lightconeRecords, fnc: 'lightconeRecords' },
        { reg: COMMANDS.normalRecords, fnc: 'normalRecords' },
        { reg: COMMANDS.allRecords, fnc: 'allRecords' },
        { reg: COMMANDS.roleAllStats, fnc: 'roleAllStats' },
        { reg: COMMANDS.lightconeAllStats, fnc: 'lightconeAllStats' },
        { reg: COMMANDS.normalAllStats, fnc: 'normalAllStats' },
        { reg: COMMANDS.roleStats, fnc: 'roleStats' },
        { reg: COMMANDS.lightconeStats, fnc: 'lightconeStats' },
        { reg: COMMANDS.normalStats, fnc: 'normalStats' },
        { reg: COMMANDS.allStats, fnc: 'allStats' }
      ]
    })
  }

  getPlayerFace(uid) {
    // 与老版 Gacha.getFace 使用相同的 Player/Character 资料来源和默认角色。
    return getMiaoPlayerFace(uid, { Player, Character })
  }

  async getAccount(explicitUid = null, requireCredentials = true) {
    try {
      return await resolveXiaoyaoAccount(this.e, explicitUid, { requireCredentials })
    } catch (error) {
      await this.e.reply(`星铁账号读取失败：${error.message}`)
      return null
    }
  }

  async gachaHelp() {
    await this.e.reply(UPDATE_HELP_TEXT)
    return true
  }

  async update() {
    const command = matchCommand(this.e.raw_message || this.e.msg)
    const account = await this.getAccount(command?.uid)
    if (!account) return true
    return this.runUpdate(account, false)
  }

  async forceUpdate() {
    const rawMessage = String(this.e.raw_message || this.e.msg || '').trim()
    // 严格要求原始消息以 * 开头；不能仅凭框架规范化后的 #星铁 判断。
    if (!rawMessage.startsWith('*')) return false
    const command = matchCommand(rawMessage)
    if (!command || command.name !== 'force') return false
    const account = await this.getAccount(command.uid)
    if (!account) return true
    return this.runUpdate(account, true)
  }

  async runUpdate(account, force) {
    await this.e.reply(`UID${account.uid} 开始${force ? '强制全量' : '增量'}更新星铁五星抽卡记录，请勿重复触发...`)
    try {
      const result = await refreshGacha({
        userId: this.e.user_id,
        account,
        force,
        api: new MysApi({ timeoutMs: getConfig().requestTimeoutMs, retryCount: getConfig().networkRetryCount }),
        config: getConfig()
      })
      await this.e.reply(buildUpdateReply(result))
      if (result.failedPools?.length) {
        for (const item of result.failedPools) {
          logger.warn(`[srgacha][${account.uid}][${item.pool}] ${item.message} (retcode=${item.retcode ?? 'N/A'})`)
        }
      }
      return true
    } catch (error) {
      logger.error(`[srgacha][${account.uid}] 更新失败：${error?.stack || error}`)
      await this.e.reply(`星铁抽卡记录更新失败：${error.message}`)
      return true
    }
  }

  async getStoredData(explicitUid = null) {
    const account = await this.getAccount(explicitUid, false)
    if (!account) return null
    const storage = new GachaStorage(this.e.user_id, account.uid)
    if (!await storage.exists()) {
      await this.e.reply(`UID${account.uid} 尚无新版五星记录，请先发送「*wx更新抽卡记录」`)
      return null
    }
    try {
      return { account, data: await storage.read() }
    } catch (error) {
      await this.e.reply(`新版抽卡记录读取失败：${error.message}`)
      return null
    }
  }

  async sendRecords(mode, explicitUid = null, showAll = false) {
    const stored = await this.getStoredData(explicitUid)
    if (!stored) return true
    const config = getConfig()
    const isAll = showAll || mode === 'all'
    const maxLog = isAll ? 0 : Math.max(0, Number(config.detailMaxLog ?? 30))
    const configuredPageSize = Number(config.detailPageSize ?? config.detailMaxLog ?? 30)
    const pageSize = configuredPageSize > 0 ? configuredPageSize : Number.MAX_SAFE_INTEGER
    const selected = selectPools(mode)
    const face = this.getPlayerFace(stored.account.uid)
    const images = []
    let totalFiveStars = 0

    for (const pool of selected) {
      const view = buildRecordPoolView(stored.data, pool, { maxLog, pageSize, all: isAll, face })
      if (!view.gacha.fiveLog.length) continue
      totalFiveStars += view.gacha.stat.fiveNum || 0
      for (const page of view.pages) {
        const pageInfo = page.total > 1 ? {
          page: page.page,
          total: page.total,
          from: page.from,
          to: page.to,
          count: page.count
        } : null
        // base64 模式只返回图片消息段，不会在渲染时自动发送；后续统一直发或合并转发。
        const image = await this.renderImg('srgacha-plugin', 'html/records', {
          ...view,
          ...getCopyrightOptions(),
          gacha: {
            ...view.gacha,
            fiveLog: page.fiveLog,
            allRecordsCommand: {
              character: '*wx角色全部记录',
              lightcone: '*wx光锥全部记录',
              normal: '*wx常驻全部记录',
              all: '*wx全部记录'
            }[mode] || '*wx全部记录'
          },
          pageInfo
        }, { scale: 1.4, retType: 'base64' })
        images.push(image)
      }
    }

    if (!images.length) {
      await this.e.reply('当前没有可展示的五星记录或保底信息。')
      return true
    }
    if (images.length === 1) {
      await this.e.reply(images[0])
      return true
    }
    const title = `UID:${stored.account.uid} ${mode === 'character' ? '角色' : mode === 'lightcone' ? '光锥' : mode === 'normal' ? '常驻' : mode === 'beginner' ? '始发' : '全部'}抽卡记录，共${totalFiveStars}条五星记录，分${images.length}张图`
    await this.e.reply(await common.makeForwardMsg(this.e, images, title))
    return true
  }

  async sendStats(mode, explicitUid = null, showAll = false) {
    const stored = await this.getStoredData(explicitUid)
    if (!stored) return true
    const stats = buildStatistics(stored.data, mode)
    stats.face = this.getPlayerFace(stored.account.uid)
    if (!stats.totalFiveStars || !stats.versionData.length) {
      await this.e.reply('当前没有可统计的五星记录。')
      return true
    }

    const maxVersion = Math.max(0, Number(getConfig().statMaxVersion ?? 10))
    const allVersions = stats.versionData
    // 与老版 Gacha.stat 一样先取图片消息段，再统一决定直接发送或合并转发。
    const renderPage = (versionData, pageInfo = null, shownNum = null, hiddenNum = null) => this.renderImg('srgacha-plugin', 'html/statistics', {
      uid: stats.uid,
      face: stats.face,
      ...getCopyrightOptions(),
      game: stats.game,
      poolName: mode === 'character' ? '角色' : mode === 'lightcone' ? '光锥' : mode === 'normal' ? '常驻' : mode === 'beginner' ? '始发' : '全部',
      pageInfo,
      gacha: {
        totalStat: stats.totalStat,
        versionData,
        itemMap: stats.itemMap,
        isMix: stats.isMix,
        unknownUpCount: stats.unknownUpCount,
        shownNum,
        hiddenNum,
        // 只有存在独立“全部统计”指令的分类才显示查看全部提示。
        allStatsCommand: {
          character: '*wx角色全部统计',
          lightcone: '*wx光锥全部统计',
          normal: '*wx常驻全部统计'
        }[mode] || ''
      }
    }, { scale: 1.4, retType: 'base64' })

    if (showAll && maxVersion > 0 && allVersions.length > maxVersion) {
      const total = Math.ceil(allVersions.length / maxVersion)
      const images = []
      for (let index = 0; index < total; index++) {
        const from = index * maxVersion
        const to = Math.min((index + 1) * maxVersion, allVersions.length)
        images.push(await renderPage(allVersions.slice(from, to), {
          page: index + 1,
          total,
          from: from + 1,
          to,
          count: allVersions.length
        }))
      }
      await this.e.reply(await common.makeForwardMsg(this.e, images, `UID:${stored.account.uid} ${mode === 'character' ? '角色' : mode === 'lightcone' ? '光锥' : '常驻'}统计，共${allVersions.length}期卡池，分${total}张图`))
      return true
    }

    let versionData = allVersions
    let shownNum = null
    let hiddenNum = null
    if (!showAll && maxVersion > 0 && allVersions.length > maxVersion) {
      shownNum = maxVersion
      hiddenNum = allVersions.length - maxVersion
      versionData = allVersions.slice(0, maxVersion)
    }
    const image = await renderPage(versionData, null, shownNum, hiddenNum)
    await this.e.reply(image)
    return true
  }

  async roleRecords() { return this.sendRecords('character', matchCommand(this.e.raw_message || this.e.msg)?.uid) }
  async roleAllRecords() { return this.sendRecords('character', matchCommand(this.e.raw_message || this.e.msg)?.uid, true) }
  async lightconeRecords() { return this.sendRecords('lightcone', matchCommand(this.e.raw_message || this.e.msg)?.uid) }
  async lightconeAllRecords() { return this.sendRecords('lightcone', matchCommand(this.e.raw_message || this.e.msg)?.uid, true) }
  async normalRecords() { return this.sendRecords('normal', matchCommand(this.e.raw_message || this.e.msg)?.uid) }
  async normalAllRecords() { return this.sendRecords('normal', matchCommand(this.e.raw_message || this.e.msg)?.uid, true) }
  async allRecords() { return this.sendRecords('all', matchCommand(this.e.raw_message || this.e.msg)?.uid, true) }
  async roleStats() { return this.sendStats('character', matchCommand(this.e.raw_message || this.e.msg)?.uid) }
  async roleAllStats() { return this.sendStats('character', matchCommand(this.e.raw_message || this.e.msg)?.uid, true) }
  async lightconeStats() { return this.sendStats('lightcone', matchCommand(this.e.raw_message || this.e.msg)?.uid) }
  async lightconeAllStats() { return this.sendStats('lightcone', matchCommand(this.e.raw_message || this.e.msg)?.uid, true) }
  async normalStats() { return this.sendStats('normal', matchCommand(this.e.raw_message || this.e.msg)?.uid) }
  async normalAllStats() { return this.sendStats('normal', matchCommand(this.e.raw_message || this.e.msg)?.uid, true) }
  async allStats() { return this.sendStats('all', matchCommand(this.e.raw_message || this.e.msg)?.uid) }
}
