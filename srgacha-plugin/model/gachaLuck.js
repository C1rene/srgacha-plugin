const LUCK_CONFIG = {
  enable: true,
  minSample: 3,
  levels: [
    { min: 99, title: '天运所归', desc: '天选之人，建议去买彩票', color: '#ff7a1f' },
    { min: 95, title: '终极欧皇', desc: '金光常伴左右', color: '#ff9f1f' },
    { min: 85, title: '大欧皇', desc: '运气远超常人', color: '#f5b72a' },
    { min: 70, title: '小欧皇', desc: '运气明显好于平均', color: '#e4c46a' },
    { min: 55, title: '小有运气', desc: '运气略好于平均', color: '#c9cf8a' },
    { min: 45, title: '平民', desc: '和理论期望相当', color: '#a8c1d8' },
    { min: 25, title: '小非酋', desc: '运气略差于平均', color: '#8f9bd6' },
    { min: 8, title: '大非酋', desc: '保底常客', color: '#9a76d8' },
    { min: 0, title: '终极非酋', desc: '抱抱，下次一定出金', color: '#b0526a' }
  ],
  model: {
    '11': { base: 0.006, soft: 74, step: 0.06, hard: 90, upRate: 0.5 },
    '21': { base: 0.006, soft: 74, step: 0.06, hard: 90, upRate: 0.5 },
    '12': { base: 0.008, soft: 66, step: 0.07, hard: 80, upRate: 0.75 },
    '22': { base: 0.008, soft: 66, step: 0.07, hard: 80, upRate: 0.75 },
    '1': { base: 0.006, soft: 74, step: 0.06, hard: 90 }
  }
}

const distCache = new Map()

function convolution(a, b, limit) {
  const result = new Array(Math.min(a.length + b.length - 1, limit + 1)).fill(0)
  for (let i = 0; i < a.length && i <= limit; i++) {
    if (!a[i]) continue
    for (let j = 0; j < b.length && i + j <= limit; j++) result[i + j] += a[i] * b[j]
  }
  return result
}

function getFiveDistribution(model) {
  const key = `five:${model.base},${model.soft},${model.step},${model.hard}`
  if (!distCache.has(key)) {
    const distribution = [0]
    let survive = 1
    for (let i = 1; i <= model.hard; i++) {
      const probability = i >= model.hard ? 1 : Math.min(1, model.base + Math.max(0, i - model.soft + 1) * model.step)
      distribution[i] = survive * probability
      survive *= 1 - probability
    }
    distCache.set(key, distribution)
  }
  return distCache.get(key)
}

function getUpDistribution(model) {
  const key = `up:${model.base},${model.soft},${model.step},${model.hard},${model.upRate}`
  if (!distCache.has(key)) {
    const five = getFiveDistribution(model)
    const twoFive = convolution(five, five, model.hard * 2)
    distCache.set(key, twoFive.map((value, index) => (five[index] || 0) * model.upRate + value * (1 - model.upRate)))
  }
  return distCache.get(key)
}

function expectedValue(distribution) {
  return distribution.reduce((sum, probability, index) => sum + probability * index, 0)
}

function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp(-z * z / 2)
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z > 0 ? 1 - p : p
}

function getPercent(distribution, count, used) {
  if (!(count > 0) || !(used > 0)) return false
  if (count > 50) {
    const mean = expectedValue(distribution)
    const variance = distribution.reduce((sum, probability, index) => sum + probability * (index - mean) ** 2, 0)
    const z = (used - count * mean) / Math.sqrt(count * variance)
    return Math.min(100, Math.max(0, (1 - normalCdf(z)) * 100))
  }
  let total = [1]
  for (let i = 0; i < count; i++) total = convolution(total, distribution, used)
  let below = 0
  for (let i = 0; i < used && i < total.length; i++) below += total[i]
  const equal = total[used] || 0
  return Math.min(100, Math.max(0, (1 - below - equal / 2) * 100))
}

function getWinPercent(count, wins, rate) {
  if (!(count > 0)) return false
  let below = 0
  let equal = 0
  let combination = 1
  for (let k = 0; k <= count; k++) {
    if (k > 0) combination = combination * (count - k + 1) / k
    const probability = combination * rate ** k * (1 - rate) ** (count - k)
    if (k < wins) below += probability
    else if (k === wins) equal = probability
  }
  return Math.min(100, Math.max(0, (below + equal / 2) * 100))
}

export function calculateGachaLuck({ poolId, isUpPool, upNum, upUsed, fiveNum, fiveUsed, smallNum, smallWin }) {
  if (!LUCK_CONFIG.enable) return null
  const model = LUCK_CONFIG.model[String(poolId)]
  if (!model || !(fiveNum > 0) || !(fiveUsed > 0)) return null
  isUpPool = Boolean(isUpPool && model.upRate > 0)
  const fiveDistribution = getFiveDistribution(model)
  const fiveExpect = expectedValue(fiveDistribution)
  const fivePercent = getPercent(fiveDistribution, fiveNum, fiveUsed)
  if (fivePercent === false) return null

  const result = {
    isUpPool,
    fiveAvg: (fiveUsed / fiveNum).toFixed(1),
    fiveExpect: fiveExpect.toFixed(1),
    fivePercent: fivePercent.toFixed(1)
  }
  let percent = fivePercent
  let sample = fiveNum
  if (isUpPool) {
    const upDistribution = getUpDistribution(model)
    const upPercent = getPercent(upDistribution, upNum, upUsed)
    if (upPercent === false) {
      isUpPool = result.isUpPool = false
    } else {
      percent = upPercent
      sample = upNum
      const winPercent = getWinPercent(smallNum, smallWin, model.upRate)
      Object.assign(result, {
        upAvg: (upUsed / upNum).toFixed(1),
        upExpect: expectedValue(upDistribution).toFixed(1),
        upRate: Math.round(model.upRate * 100),
        winPercent: winPercent === false ? false : winPercent.toFixed(1)
      })
    }
  }
  const level = LUCK_CONFIG.levels.find(item => percent >= item.min) || LUCK_CONFIG.levels.at(-1)
  return {
    ...level,
    ...result,
    percent: percent.toFixed(1),
    fewSample: sample < LUCK_CONFIG.minSample
  }
}

export default calculateGachaLuck
