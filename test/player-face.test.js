import test from 'node:test'
import assert from 'node:assert/strict'
import { getMiaoPlayerFace } from '../model/playerFace.js'

test('玩家头像数据与老版 Gacha.getFace 一致，读取玩家昵称和展示角色', () => {
  const calls = []
  const Player = {
    create(uid, game) {
      calls.push(['player', uid, game])
      return { name: 'Destiny', face: 1222, sign: 'hello', level: 70 }
    }
  }
  const Character = {
    get(id, game) {
      calls.push(['character', id, game])
      return { imgs: {
        banner: '/meta-sr/character/common/imgs/banner.webp',
        face: '/meta-sr/character/某角色/imgs/face.webp',
        qFace: '/meta-sr/character/某角色/imgs/face-q.webp'
      } }
    }
  }
  const face = getMiaoPlayerFace('100820596', { Player, Character })
  assert.equal(face.name, 'Destiny')
  assert.equal(face.face, '../../miao-plugin/resources/meta-sr/character/某角色/imgs/face.webp')
  assert.equal(face.qFace, '../../miao-plugin/resources/meta-sr/character/某角色/imgs/face-q.webp')
  assert.equal(face.banner, '../../miao-plugin/resources/meta-sr/character/common/imgs/banner.webp')
  assert.deepEqual(calls, [['player', '100820596', 'sr'], ['character', 1222, 'sr']])
})

test('玩家资料缺失时使用老版相同的开拓者头像回退', () => {
  const face = getMiaoPlayerFace('100820596', {
    Player: { create: () => ({ name: '' }) },
    Character: { get: () => false }
  })
  assert.equal(face.name, '旅行者')
  assert.equal(face.face, 'html/old-theme/imgs/no-avatar.webp')
})
