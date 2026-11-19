import fs from 'node:fs'

const readPackage = (url) => {
  try {
    return JSON.parse(fs.readFileSync(url, 'utf8'))
  } catch {
    return {}
  }
}

const hostNames = {
  'miao-yunzai': 'Miao-Yunzai',
  'trss-yunzai': 'TRSS-Yunzai',
  'MangoCat-Yunzai': 'MangoCat-Yunzai',
  'a-yunzai': 'A-Yunzai'
}

/**
 * Build the same copyright line as miao-plugin's Render component, but use
 * this plugin's own name/version in the second half.
 * Package paths are relative to this file so they do not depend on process.cwd().
 */
export function buildCopyright(hostPackage = {}, pluginPackage = {}) {
  const hostName = hostNames[hostPackage.name] || 'Yunzai-Bot'
  const hostVersion = hostPackage.version || ''
  const pluginVersion = pluginPackage.version || '1.0.0'
  return `Created By ${hostName}<span class="version">${hostVersion}</span> & srgacha-plugin<span class="version">${pluginVersion}</span>`
}

const hostPackage = readPackage(new URL('../../../package.json', import.meta.url))
const pluginPackage = readPackage(new URL('../package.json', import.meta.url))

export function getCopyrightOptions() {
  // Miao-Yunzai Render.js 会根据这两个参数重新生成 copyright，
  // 若不显式传入，默认插件名会回退为 Miao-Plugin。
  return {
    pluginName: 'srgacha-plugin',
    pluginVersion: pluginPackage.version || '1.0.0'
  }
}

export function getCopyright() {
  return buildCopyright(hostPackage, pluginPackage)
}
