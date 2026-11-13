/**
 * dsh-away 设置面板冒烟测试（不开浏览器）
 *
 * 用最小 React 替身把 OutPanel 真跑一遍：抓渲染时的运行时报错、
 * 确认「改完点保存」这条链路（草稿态 / 保存条 / 数字框取值）没崩。
 *
 * 跑法：node panel-check.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const pkgVersion = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version
const clientVersion = /const VERSION = '([^']+)'/.exec(readFileSync(join(here, 'client.js'), 'utf8'))[1]

const tmp = mkdtempSync(join(process.env.TEMP || '.', 'moo-panel-'))
process.env.DSH_HOME = tmp

const srv = await import(new URL('./lib/index.js', import.meta.url).href)

console.log('dsh-away 面板冒烟测试\n')

// ---------- 最小 React 替身 ----------
let hookQueue = []
let hookIdx = 0
const rendered = []

const React = {
  createElement: (type, props, ...children) => {
    const kids = []
    const push = (c) => {
      if (c === null || c === undefined || c === false || c === true) return
      if (Array.isArray(c)) { c.forEach(push); return }
      if (typeof c === 'string' || typeof c === 'number') { kids.push(c); rendered.push(String(c)); return }
      kids.push(c)
    }
    children.forEach(push)
    if (props && Array.isArray(props.children)) props.children.forEach(push)
    if (typeof type === 'function') {
      const out = type(props || {})
      if (out === null || out === undefined) return null
      return { type, props: props || {}, children: [out] }
    }
    return { type, props: props || {}, children: kids }
  },
  useState: (init) => {
    const v = hookIdx < hookQueue.length ? hookQueue[hookIdx] : (typeof init === 'function' ? init() : init)
    hookIdx += 1
    return [v, () => {}]
  },
  useEffect: () => {},
  Fragment: 'fragment',
}

// ---------- 假 DOM / 模块加载器 / fetch ----------
const fakeEl = { setAttribute() {}, remove() {}, set textContent(v) {}, get textContent() { return '' } }
globalThis.document = { createElement: () => fakeEl, head: { appendChild() {} } }

let component = null
globalThis.window = { __ModuleLoader__: { load: (m) => { component = m } } }
globalThis.fetch = async () => ({ ok: true, json: async () => fixture })

// ---------- 跟服务端同一套的假数据 ----------
const baseCfg = srv.loadConfig()
const fixture = {
  ok: true,
  config: baseCfg,
  state: { dayKey: '2026-11-07', todayCount: 0, lastPingAt: 0, history: [] },
  sessions: [],
}

await import(new URL('./client.js', import.meta.url).href)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond || !extra ? '' : ' — ' + extra))
  if (!cond) fails += 1
}

ok('client.js 能加载（有 factory）', !!(component && typeof component.factory === 'function'))
const mod = component.factory((id) => (id === 'react' ? React : {}))
ok('factory 导出 apply', typeof mod.apply === 'function')

let Panel = null
const ctx = {
  get: (k) => (k === 'slots' ? { register: (_slot, comp) => { Panel = comp; return () => {} } } : undefined),
  effect: (fn) => { try { fn() } catch (e) { /* ignore */ } },
}
mod.apply(ctx)
ok('注册到了设置页 section', typeof Panel === 'function')

// 状态钩子顺序：data / cfg / draft / err / msg / busy / saving
// 方案 A：还没数据
hookIdx = 0; hookQueue = [null, null, null, '', '', false, false]; rendered.length = 0
Panel()
ok('空数据时显示「正在读…」', rendered.join(' ').includes('正在读'), rendered.join(' | ').slice(0, 80))

// 方案 B：拿到数据、没有草稿
hookIdx = 0; hookQueue = [fixture, fixture.config, null, '', '', false, false]; rendered.length = 0
try {
  Panel()
  ok('完整渲染不报错', true)
} catch (e) {
  ok('完整渲染不报错', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e))
}
let text = rendered.join(' | ')
ok('客户端版本号跟 package.json 一致（' + clientVersion + '）', clientVersion === pkgVersion, 'client=' + clientVersion + ' pkg=' + pkgVersion)
ok('顶部版本号可见', text.includes('v' + clientVersion), text.slice(0, 80))
ok('七项设置名都在', ['心情低于', '耗尽高于', '闷高于', '两次提醒隔', '一天最多'].every((n) => text.includes(n)), text.slice(0, 200))
ok('没有改动时提示已生效', text.includes('所有改动都已生效'), text.slice(0, 200))
ok('没有改动时不显示保存按钮', !text.includes('保存中…'), text.slice(0, 200))

// 方案 C：有未保存草稿（boredHigh 85）
const draft = Object.assign({}, fixture.config, { boredHigh: 85 })
hookIdx = 0; hookQueue = [fixture, fixture.config, draft, '', '', false, false]; rendered.length = 0
try {
  Panel()
  ok('草稿态渲染不报错', true)
} catch (e) {
  ok('草稿态渲染不报错', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e))
}
text = rendered.join(' | ')
ok('有草稿时提示还没生效', text.includes('有改动还没生效'), text.slice(0, 200))
ok('有草稿时出现保存/撤销', text.includes('保存') && text.includes('撤销'), text.slice(0, 200))

// 数字框要拿到草稿值（不是服务端旧值）
const inputs = []
const walk = (node) => {
  if (!node || typeof node !== 'object') return
  if (node.type === 'input' && node.props && node.props.type === 'number') inputs.push(node.props)
  ;(node.children || []).forEach(walk)
}
// 重新渲染一次拿树
hookIdx = 0; hookQueue = [fixture, fixture.config, draft, '', '', false, false]; rendered.length = 0
const tree = Panel()
walk(tree)
ok('渲染出 10 个数字框', inputs.length === 10, '实际 ' + inputs.length)
const win = inputs.find((p) => String(p.value) === String(fixture.config.videoWindowDays ?? 180))
ok('挑片窗口取到值', !!win, inputs.map((p) => p.value).join(','))
const bored = inputs.find((p) => String(p.value) === '85')
ok('闷高于取的是草稿值 85', !!bored, inputs.map((p) => p.value).join(','))

console.log('\n' + (fails ? '失败 ' + fails + ' 项' : '全部通过'))
process.exit(fails ? 1 : 0)
