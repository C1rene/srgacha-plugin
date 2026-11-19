import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildCopyright, getCopyrightOptions } from '../model/copyright.js'

const templateRoot = new URL('../resources/html/', import.meta.url)

test('copyright follows the Miao-Yunzai layout and uses srgacha-plugin version', () => {
  assert.equal(
    buildCopyright(
      { name: 'miao-yunzai', version: '3.1.3' },
      { name: 'srgacha-plugin', version: '1.0.0' }
    ),
    'Created By Miao-Yunzai<span class="version">3.1.3</span> & srgacha-plugin<span class="version">1.0.0</span>'
  )
})

test('both record and statistics templates render the dynamic copyright as HTML', async () => {
  for (const name of ['records.html', 'statistics.html']) {
    const source = await readFile(new URL(name, templateRoot), 'utf8')
    assert.match(source, /<div class="copyright">\{\{@copyright\}\}<\/div>/)
    assert.doesNotMatch(source, /<div class="copyright">srgacha-plugin<\/div>/)
  }
})

test('copyright uses the Yunzai fork display names like miao-plugin', () => {
  assert.match(buildCopyright({ name: 'trss-yunzai', version: '4.0.0' }, { version: '1.0.0' }), /^Created By TRSS-Yunzai/)
  assert.match(buildCopyright({ name: 'unknown-yunzai', version: '3.0.0' }, { version: '1.0.0' }), /^Created By Yunzai-Bot/)
})

test('render params override Miao-Yunzai default Miao-Plugin attribution', () => {
  const options = getCopyrightOptions()
  assert.equal(options.pluginName, 'srgacha-plugin')
  assert.equal(options.pluginVersion, '1.0.0')
})

test('both image render calls pass pluginName and pluginVersion to Miao-Yunzai renderer', async () => {
  const app = await readFile(new URL('../apps/srgacha.js', import.meta.url), 'utf8')
  assert.equal((app.match(/\.\.\.getCopyrightOptions\(\)/g) || []).length, 2)
  assert.doesNotMatch(app, /copyright:\s*getCopyright\(\)/)
})
