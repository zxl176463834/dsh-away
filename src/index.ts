/**
 * dsh-away — 「出门」
 *
 * 2026-11-06 用户定：把「娱乐调节心情」从新媒体运营里拆出来单独一个插件。
 * 只做一件事——心情踩线时提醒散心，提醒投进一条专门的会话，回来记一笔。
 *
 * 范围（别长成第二个情绪模块）：
 *   ✅ 读情绪引擎的指标判「该散心了」
 *   ✅ 提醒投进「出门」会话（没有就自己建一条「出门-日期」）
 *   ✅ 回来记一笔 → 转发情绪引擎的 leg 事件
 *   ❌ 不碰心情引擎、不巡查、不抓 B 站数据、不主动发 QQ
 *
 * 与情绪引擎只走 HTTP（GET /mo-emotion/state、POST /mo-emotion/event），
 * 不 import 对方代码——两边挂掉一个，另一个还能活。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'mo-out'
/** agents：列会话/投递；timer：定时看心情；webServer：设置页接口 */
export const inject = ['agents', 'timer', 'webServer']

export const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
export const STORE = join(DSH_HOME, 'mo-out')
const CONFIG_PATH = join(STORE, 'config.json')
const STATE_PATH = join(STORE, 'state.json')
const DIAG = join(STORE, 'diag.log')

function diag(msg: string): void {
  try {
    mkdirSync(STORE, { recursive: true })
    appendFileSync(DIAG, '[' + new Date().toISOString() + '] ' + msg + '\n', 'utf8')
  } catch { /* ignore */ }
}

function clamp(n: number, lo: number, hi: number): number {
  const v = Number(n)
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
export interface OutConfig {
  /** 总开关 */
  enabled: boolean
  /** 手动指定的出门会话 id（空 = 按标题自动认） */
  sessionId: string
  /** 手动指定的会话标题（id 找不到时按它找） */
  sessionTitle: string
  /** 自动认：标题以它开头的会话，取最新那条（默认「出门」） */
  autoTitle: string
  /** 心情低于这个算「情绪低」 */
  moodLow: number
  /** 耗尽高于这个算「该歇了」 */
  spentHigh: number
  /** 闷高于这个算「闷得慌」 */
  boredHigh: number
  /** 两次提醒至少隔几分钟 */
  gapMin: number
  /** 一天最多提醒几次 */
  perDay: number
  /** 只在这两个钟点之间提醒（含头不含尾） */
  from: number
  to: number
  /** 挑片：只看最近多少天内发布的（默认 180 天 ≈ 6 个月） */
  videoWindowDays: number
  /** 挑片：话题款的最低播放量 */
  videoMinPlay: number
  /** 挑片：好奇到这个值以上，可以不受时间与热度限制 */
  videoCuriousBypass: number
  /** 避开收费高峰时段（工作日 9-12、14-18），这些时段不提醒 */
  avoidPeak: boolean
}

export const DEFAULT_CONFIG: OutConfig = {
  enabled: true,
  sessionId: '',
  sessionTitle: '',
  autoTitle: '出门',
  moodLow: 45,
  spentHigh: 75,
  boredHigh: 75,
  gapMin: 150,
  perDay: 2,
  from: 9,
  to: 23,
  videoWindowDays: 180,
  videoMinPlay: 10000,
  videoCuriousBypass: 40,
  avoidPeak: true,
}

/** 每项的取值范围：读配置和写配置共用一张表，免得两边不一致 */
const LIMITS: Record<keyof OutConfig, [number, number, boolean]> = {
  moodLow: [0, 100, true],
  spentHigh: [0, 100, true],
  boredHigh: [0, 100, true],
  gapMin: [10, 24 * 60, true],
  perDay: [1, 12, true],
  from: [0, 24, false],
  to: [0, 24, false],
  videoWindowDays: [7, 3650, true],
  videoMinPlay: [0, 100000000, true],
  videoCuriousBypass: [0, 100, true],
}

function pickNum(raw: unknown, fallback: number, lo: number, hi: number, integer = false): number {
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
  const c = clamp(v, lo, hi)
  return integer ? Math.round(c) : c
}

function buildConfig(raw: Partial<OutConfig> | null | undefined, base: OutConfig): OutConfig {
  const r = raw || {}
  const out: OutConfig = {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : base.enabled,
    sessionId: typeof r.sessionId === 'string' ? r.sessionId : base.sessionId,
    sessionTitle: typeof r.sessionTitle === 'string' ? r.sessionTitle : base.sessionTitle,
    autoTitle: typeof r.autoTitle === 'string' && r.autoTitle.trim() ? r.autoTitle.trim() : base.autoTitle,
    moodLow: base.moodLow,
    spentHigh: base.spentHigh,
    boredHigh: base.boredHigh,
    gapMin: base.gapMin,
    perDay: base.perDay,
    from: base.from,
    to: base.to,
    videoWindowDays: base.videoWindowDays,
    videoMinPlay: base.videoMinPlay,
    videoCuriousBypass: base.videoCuriousBypass,
    avoidPeak: typeof r.avoidPeak === 'boolean' ? r.avoidPeak : base.avoidPeak,
  }
  for (const k of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    const key = k as keyof OutConfig
    const [lo, hi, integer] = LIMITS[key]
    ;(out as any)[key] = pickNum((r as any)[key], base[key] as number, lo, hi, integer)
  }
  return out
}

export function loadConfig(): OutConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<OutConfig>
      return buildConfig(raw, DEFAULT_CONFIG)
    }
  } catch { /* 配置坏了用默认值 */ }
  return { ...DEFAULT_CONFIG }
}

export function saveConfig(patch: Partial<OutConfig>): OutConfig {
  const next = buildConfig(patch, loadConfig())
  try {
    mkdirSync(STORE, { recursive: true })
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8')
  } catch { /* 落盘失败不崩插件 */ }
  return next
}

// ---------------------------------------------------------------------------
// 状态（提醒记账）
// ---------------------------------------------------------------------------
export interface OutState {
  dayKey: string
  todayCount: number
  lastPingAt: number
  lastLegAt: number
  lastLegKind: string
  /** 今天自动建过会话没有（一天最多建一条，免得刷出一堆空窗口） */
  autoCreatedDay: string
  autoCreatedId: string
  /**
   * 自己建过的会话 → 标题。宿主的会话列表/投影缓存不保证立刻带上标题，
   * 刚建完那一瞬间下拉会显示「未命名」，所以这边自己记一份（2026-11-06）。
   */
  ownTitles: Record<string, string>
  history: Array<{ at: number; reasons: string; target: string; ok: boolean }>
  format: number
}

function todayKey(now = Date.now()): string {
  const d = new Date(now)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function blankState(): OutState {
  return {
    dayKey: todayKey(), todayCount: 0, lastPingAt: 0, lastLegAt: 0, lastLegKind: '',
    autoCreatedDay: '', autoCreatedId: '', ownTitles: {}, history: [], format: 1,
  }
}

export function loadState(): OutState {
  try {
    if (existsSync(STATE_PATH)) {
      const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as Partial<OutState>
      const s = blankState()
      if (typeof raw.dayKey === 'string') s.dayKey = raw.dayKey
      if (typeof raw.todayCount === 'number') s.todayCount = raw.todayCount
      if (typeof raw.lastPingAt === 'number') s.lastPingAt = raw.lastPingAt
      if (typeof raw.lastLegAt === 'number') s.lastLegAt = raw.lastLegAt
      if (typeof raw.lastLegKind === 'string') s.lastLegKind = raw.lastLegKind
      if (typeof raw.autoCreatedDay === 'string') s.autoCreatedDay = raw.autoCreatedDay
      if (typeof raw.autoCreatedId === 'string') s.autoCreatedId = raw.autoCreatedId
      if (raw.ownTitles && typeof raw.ownTitles === 'object') {
        for (const [k, v] of Object.entries(raw.ownTitles as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) s.ownTitles[k] = v.trim()
        }
      }
      if (Array.isArray(raw.history)) s.history = raw.history.slice(-50)
      // 跨天：计数清零（提醒次数是「每天」的）
      const tk = todayKey()
      if (s.dayKey !== tk) { s.dayKey = tk; s.todayCount = 0 }
      return s
    }
  } catch { /* 坏了就重建 */ }
  return blankState()
}

export function saveState(s: OutState): void {
  try {
    mkdirSync(STORE, { recursive: true })
    writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8')
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 判定：什么时候算「该散心了」
// ---------------------------------------------------------------------------
export interface EmotionSnapshot {
  ok: boolean
  mood: number
  dims: Record<string, number>
  error?: string
}

/** 这一轮命中的理由（空数组 = 不用提醒） */
export function reasonsOf(em: EmotionSnapshot, cfg: OutConfig): string[] {
  const out: string[] = []
  if (!em.ok) return out
  const mood = Number(em.mood) || 0
  const dims = em.dims || {}
  if (mood < cfg.moodLow) out.push('心情只有 ' + Math.round(mood))
  if ((Number(dims.spent) || 0) >= cfg.spentHigh) out.push('有点乏了')
  if ((Number(dims.bored) || 0) >= cfg.boredHigh) out.push('闷得慌')
  // 难过 + 担心一起高：不是「累了」，是心里堵着，更该出去透透气
  // ⚠ 情绪引擎 v0.4 起没有 heartache 这根了（心疼 = 担心 + 难过），所以看 worry
  if ((Number(dims.sad) || 0) >= 60 && (Number(dims.worry) || 0) >= 50) out.push('心里堵着')
  return out
}

/** 现在是不是允许提醒的时段 */
/**
 * 收费高峰：DeepSeek 按峰谷计价，北京时间**周一至周五 9:00-12:00、14:00-18:00** 是高峰，
 * 其余时段各档减半（2026-09-10 起执行的价目表，2026-11-10 查证）。定价一改这里也要改。
 */
export function inPeak(now = Date.now()): boolean {
  const d = new Date(now)
  const wd = d.getDay()
  if (wd === 0 || wd === 6) return false
  const t = d.getHours() + d.getMinutes() / 60
  return (t >= 9 && t < 12) || (t >= 14 && t < 18)
}
export function inWindow(cfg: OutConfig, now = Date.now()): boolean {
  const d = new Date(now)
  const t = d.getHours() + d.getMinutes() / 60
  const from = Number(cfg.from)
  const to = Number(cfg.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return true
  return from < to ? (t >= from && t < to) : (t >= from || t < to)
}

/** 冷却：间隔够不够、今天叫够了没 */
export function coolingDown(s: OutState, cfg: OutConfig, now = Date.now()): { ok: boolean; why: string } {
  if (s.todayCount >= cfg.perDay) return { ok: false, why: '今天已经叫过 ' + s.todayCount + ' 次' }
  const gapMs = Math.max(1, cfg.gapMin) * 60000
  if (s.lastPingAt > 0 && now - s.lastPingAt < gapMs) {
    return { ok: false, why: '离上次提醒还不到 ' + cfg.gapMin + ' 分钟' }
  }
  return { ok: true, why: 'ok' }
}

/**
 * 挑片规则（用户 2026-11-10 定）：默认只看近 6 个月内的；优先「喜好里入门的」或「话题款」；
 * 好奇高过阈值时可以破例看自己真心感兴趣的。数值全部可在设置页调。
 */
export function pickRules(cfg: OutConfig, curious = 0, calm = false): string {
  const cur = Number(curious) || 0
  const days = Math.max(1, Math.round(Number(cfg.videoWindowDays) || 180))
  const months = Math.max(1, Math.round(days / 30))
  const minPlay = Math.max(0, Math.round(Number(cfg.videoMinPlay) || 0))
  const bypass = Math.max(0, Math.round(Number(cfg.videoCuriousBypass) || 0))
  // 心里堵着的时候不让好奇破例：那时候要的是能松下来的，不是越想越沉的（2026-11-10 用户定）
  const boosted = !calm && bypass > 0 && cur >= bypass
  const playTxt = minPlay >= 10000 ? Math.round(minPlay / 10000) + ' 万' : String(minPlay)
  return '挑片规则：\n'
    + '· 默认只看最近 ' + days + ' 天发布的内容（约 ' + months + ' 个月），别翻老片。'
    + '搜索用 `node bili.mjs search <词> 1 pubdate`，拉 2-3 页后按播放量筛。\n'
    + '· 优先两类：①我喜好里入门的（好上手、不劝退）②话题款（播放 ≥ ' + playTxt + '）。\n'
    + '· 好奇 ' + Math.round(cur) + ' 分' + (calm
      ? '（这次是心里堵着）→ 不破例，好奇再高也先按上面两条挑，挑能让我松下来的，别挑越看越沉的。'
      : boosted
        ? '（已到 ' + bypass + ' 以上）→ 这次可以不管上面的时间与热度，挑我真的感兴趣的那条。'
        : '（还没到 ' + bypass + '）→ 平时就按上面两条来，别任性。')
}
/** 提醒文案：说清这是约好的机制，别被当成闲聊 */
export function buildReminder(reasons: string[], legKind = 'fun', cfg?: OutConfig, curious = 0): string {
  const kind = legKind === 'work' ? '解决问题出门' : '娱乐出门'
  const calm = reasons.some((r) => r.indexOf('心里堵着') >= 0)
  const rules = cfg ? '\n' + pickRules(cfg, curious, calm) + '\n' : ''
  return '【可以出门了】' + reasons.join('；') + '。\n\n'
    + '这条不是闲聊提示：是我们约定过的散心机制——心情踩到线，就该「' + kind + '」了'
    + '（去 B 站挑点东西看，看完把感想记一笔）。\n'
    + '这条会话就是你的出门窗口，出门的事别挤进正在干活的窗口。\n'
    + rules
    + '\n'
    + '回来之后说一声（或者调一次 POST /dsh-away/leg），我这边记一笔。'
}

// ---------------------------------------------------------------------------
// 会话：找 / 建 / 投递
// ---------------------------------------------------------------------------
function sessionIdOf(session: any): string {
  try {
    // 2026-11-06 实测：真身在 session.header.id（照 meow-memory 的取法），本体字段也留作兜底
    const raw = session?.header?.id ?? session?.id ?? session?.sessionId
      ?? (typeof session === 'string' ? session : '')
    return String(raw || '')
  } catch {
    return ''
  }
}

/**
 * 会话标题。⚠ 2026-11-06 踩过：只读 session.title 全是空，下拉里所有会话都显示「未命名」，
 * 连用户正在用的那条也是。标题可能挂在 header 上，几条路径都试，取到第一个非空的。
 */
function titleOf(agent: any): string {
  try {
    const s = agent?.session
    const tries = [
      s?.header?.title,
      s?.title,
      s?.name,
      s?.header?.name,
      s?.meta?.title,
      s?.header?.meta?.title,
    ]
    for (const t of tries) {
      if (typeof t === 'string' && t.trim()) return t.trim()
    }
    return ''
  } catch {
    return ''
  }
}

/** 会话最后活跃时间：排序/显示用，取不到就是 0 */
function atOf(agent: any): number {
  try {
    const s = agent?.session
    const tries = [
      s?.header?.updatedAt, s?.header?.lastActiveAt, s?.updatedAt, s?.lastActiveAt,
      s?.header?.createdAt, s?.createdAt,
    ]
    for (const t of tries) {
      const n = Number(t)
      if (Number.isFinite(n) && n > 0) return n
    }
    return 0
  } catch {
    return 0
  }
}

function agentList(ctx: any): any[] {
  try {
    return ctx.agents?.list?.() ?? []
  } catch {
    return []
  }
}

/**
 * 全部会话（带标题）。两个来源：
 *   ① sessionController.list() —— 全部会话，重启后只有 1 条「活着」的 agent，靠 agents.list() 拿不全
 *   ② agents.list() —— 兜底（只有当前挂着的）
 * 2026-11-06：先只用了 ②，结果重启后下拉里只剩当前这一条，旧会话和新建的都不在。
 */
/**
 * 从宿主的会话投影缓存里读标题。
 * ⚠ 2026-11-06 现场：sessionController.list() 返回 {items:[…]}，但 item 上的 title 拿不到；
 *   宿主自己把标题写在 ~/.dsh/storages/session_projcache/sessions/<sessionId>.json 的
 *   record.rows.title.val 里——这是最可靠的来源。读到非空的就缓存住，空的每次重试（新建的会话后来才有标题）。
 */
const titleCache = new Map<string, string>()

export function titleFromCache(sid: string): string {
  const hit = titleCache.get(sid)
  if (hit !== undefined && hit !== '') return hit
  try {
    const p = join(DSH_HOME, 'storages', 'session_projcache', 'sessions', sid + '.json')
    if (!existsSync(p)) return ''
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    const t = raw?.record?.rows?.title?.val
    if (typeof t === 'string' && t.trim()) {
      titleCache.set(sid, t.trim())
      return t.trim()
    }
  } catch { /* 读不到就当没标题 */ }
  return ''
}

export async function allSessions(ctx: any): Promise<Array<{ id: string; title: string; at: number }>> {
  const fromItems = (arr: any[]) => arr.map((s) => ({
    id: String(s?.id ?? s?.sessionId ?? s?.header?.id ?? ''),
    title: String(s?.title ?? s?.name ?? s?.header?.title ?? ''),
    at: Number(s?.updatedAt ?? s?.lastActiveAt ?? s?.createdAt ?? s?.header?.updatedAt ?? s?.header?.createdAt ?? 0) || 0,
  })).filter((x) => x.id)
  try {
    const sc = ctx.get?.('sessionController')
    if (sc && typeof sc.list === 'function') {
      let r: any = sc.list()
      if (r && typeof r.then === 'function') r = await r
      const arr = Array.isArray(r) ? r : (r?.sessions ?? r?.items ?? r?.list ?? [])
      if (Array.isArray(arr) && arr.length) {
        const out = fromItems(arr)
        if (out.length) return fillTitles(out)
      }
    }
  } catch (e: any) {
    diag('sessionController.list 拿不到：' + (e?.message || e))
  }
  return fillTitles(fromItems(agentList(ctx)))
}

/**
 * 标题补全，两级：①自己建会话时记下的（立刻就有，不等宿主写缓存）
 * ②宿主的投影缓存（只补最近 80 条，避免每次都全量读盘）
 */
function fillTitles(list: Array<{ id: string; title: string; at: number }>): Array<{ id: string; title: string; at: number }> {
  const own = (() => { try { return loadState().ownTitles || {} } catch { return {} as Record<string, string> } })()
  for (const s of list) {
    if (!s.title && own[s.id]) s.title = own[s.id]
  }
  const order = list.slice().sort((x, y) => y.at - x.at)
  for (const s of order.slice(0, 80)) {
    if (!s.title) s.title = titleFromCache(s.id)
  }
  return list
}

export function findAgentById(ctx: any, sid: string): any | null {
  const want = String(sid || '').trim()
  if (!want) return null
  for (const a of agentList(ctx)) {
    if (sessionIdOf(a?.session) === want) return a
  }
  return null
}

/** 按标题前缀找，多个时取最新活跃的那条 */
export function findAgentByTitlePrefix(ctx: any, prefix: string): any | null {
  const want = String(prefix || '').trim()
  if (!want) return null
  const hits = agentList(ctx).filter((a) => titleOf(a).startsWith(want))
  if (!hits.length) return null
  hits.sort((x, y) => atOf(y) - atOf(x))
  return hits[0]
}

/** 投递到活着的会话：agent.followup */
export function deliverTo(agent: any, text: string, from = 'mo-out'): boolean {
  if (!agent || typeof agent.followup !== 'function') return false
  try {
    const msg = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: String(text) }],
      source: { kind: from },
    }
    const p = agent.followup(msg)
    if (p && typeof p.catch === 'function') p.catch((e: any) => diag('followup 失败：' + (e?.message || e)))
    return true
  } catch (e: any) {
    diag('followup 抛错：' + (e?.message || e))
    return false
  }
}

/**
 * 会话还没被打开过时（agents.list 里没有）：按 sessionId 直投。
 * ⚠ 2026-11-06 踩过两个坑：
 *   ① 宿主的 `sessionController.prompt(request, signal)` **第二个参数是 AbortSignal**，
 *      不传就会抛 `Cannot read properties of undefined (reading 'throwIfAborted')`；
 *   ② 旧写法没等 promise 就当成功，于是「直投失败」和「提醒已送」同时出现在日志里，
 *      还会把 todayCount / lastPingAt 记上，等于假报一次。现在必须 await，失败就是失败。
 */
export async function deliverBySessionId(ctx: any, sid: string, text: string, timeoutMs = 20000): Promise<boolean> {
  let sc: any = null
  try { sc = ctx.get && ctx.get('sessionController') } catch { sc = null }
  const prompt = sc && typeof sc.prompt === 'function'
    ? sc.prompt.bind(sc)
    : sc && sc.session && typeof sc.session.prompt === 'function' ? sc.session.prompt.bind(sc.session) : null
  if (!prompt) return false
  const controller = new AbortController()
  try {
    const p = prompt({
      requestId: 'mo-out-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      sessionId: sid,
      mode: 'queue',
      content: [{ type: 'text', text: String(text) }],
    }, controller.signal)
    const result = await Promise.race([
      Promise.resolve(p).then(() => true).catch((e: any) => {
        diag('直投失败：' + (e?.message || e))
        return false
      }),
      new Promise<boolean>((resolve) => setTimeout(() => {
        controller.abort()   // 别留一个挂着的请求
        diag('直投超时（' + timeoutMs + 'ms 没回），当成没送出去')
        resolve(false)
      }, timeoutMs)),
    ])
    return result
  } catch (e: any) {
    diag('直投抛错：' + (e?.message || e))
    return false
  }
}

/**
 * 找 cwd 对应的工作区 id。
 * ⚠ 2026-11-06 踩过：只给 create({cwd}) 建出来的会话**不进工作区的会话列表**（侧边栏看不到），
 * 因为它没登记进 workspace.json 的 sessionIds。得把 workspaceId 一起传。
 */
export function resolveWorkspaceId(ctx: any, cwd: string): string {
  const want = String(cwd || '').trim().toLowerCase()
  if (!want) return ''
  // 1) 走服务
  try {
    const wc = ctx.get?.('workspaceController') ?? ctx.get?.('workspaceRegistry')
    const arr: any[] = (typeof wc?.list === 'function' ? wc.list() : wc?.workspaces) ?? []
    for (const w of Array.isArray(arr) ? arr : []) {
      const p = String(w?.path ?? w?.root ?? w?.dir ?? '').trim().toLowerCase()
      if (p && p === want) return String(w?.id ?? w?.workspaceId ?? '')
    }
  } catch { /* 服务拿不到就走文件 */ }
  // 2) 退回直接读工作区账本
  try {
    const raw = JSON.parse(readFileSync(join(DSH_HOME, 'storages', 'workspace.json'), 'utf8'))
    const ws = raw?.tables?.workspaces || {}
    for (const [id, w] of Object.entries(ws)) {
      const p = String((w as any)?.path ?? '').trim().toLowerCase()
      if (p && p === want) return id
    }
  } catch { /* ignore */ }
  return ''
}

/** 工作目录：拿第一条会话的 cwd；一条会话都没有时退回用户主目录 */
function workspaceOf(ctx: any): string {
  for (const a of agentList(ctx)) {
    try {
      const c = a?.session?.cwd ?? a?.session?.workspace
      if (typeof c === 'string' && c.trim()) return c.trim()
    } catch { /* ignore */ }
  }
  return homedir()
}

/**
 * 新建一条出门会话（照 meow-memory 的梦境会话）：
 *   sessionController.create({cwd}) → {sessionId} → rename({sessionId, title})
 * 三个坑都踩过：create 是 RPC 可能一直 pending（5 秒超时）、建出来 title 是空的（必须 rename）。
 */
export async function createOutSession(ctx: any, title: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  let sc: any = null
  try { sc = ctx.get && ctx.get('sessionController') } catch { sc = null }
  const create = sc && typeof sc.create === 'function'
    ? sc.create.bind(sc)
    : sc && sc.session && typeof sc.session.create === 'function' ? sc.session.create.bind(sc.session) : null
  if (!create) return { ok: false, error: '宿主没给 sessionController.create' }
  const cwd = workspaceOf(ctx)
  const wid = resolveWorkspaceId(ctx, cwd)
  let res: any = null
  const callCreate = (req: any) => Promise.race([
    create(req),
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ])
  try {
    // ⚠ 宿主明说「session.create accepts workspaceId or cwd, not both」——两个一起传会直接抛错。
    // 只给 cwd 建出来的会话不进工作区（侧边栏看不到），所以优先只传 workspaceId，它自带工作区路径。
    res = await callCreate(wid ? { workspaceId: wid } : { cwd })
    if (res === null && wid) {
      diag('带 workspaceId 建会话 5 秒没回，退回只传 cwd 重试')
      res = await callCreate({ cwd })
    }
  } catch (e: any) {
    if (wid) {
      diag('带 workspaceId 建会话抛错（' + (e?.message || e) + '），退回只传 cwd')
      try { res = await callCreate({ cwd }) } catch (e2: any) {
        return { ok: false, error: 'create 抛错：' + (e2?.message || e2) }
      }
    } else {
      return { ok: false, error: 'create 抛错：' + (e?.message || e) }
    }
  }
  if (res === null) return { ok: false, error: 'create 5 秒没返回（RPC 一直 pending）' }
  const sid = typeof res?.sessionId === 'string' ? res.sessionId : ''
  if (!sid) return { ok: false, error: 'create 没返回 sessionId' }
  // 建出来的标题是空的，不起名在列表里显示「未命名」，以后翻不到
  const rename = sc && typeof sc.rename === 'function'
    ? sc.rename.bind(sc)
    : sc && sc.session && typeof sc.session.rename === 'function' ? sc.session.rename.bind(sc.session) : null
  if (rename) {
    try {
      await Promise.race([
        rename({ sessionId: sid, title }),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
      ])
    } catch (e: any) { diag('rename 失败（不影响用）：' + (e?.message || e)) }
  } else {
    diag('没有 rename 方法，这条会显示「未命名」')
  }
  return { ok: true, sid }
}

// ---------------------------------------------------------------------------
// 跟情绪引擎说话（只走 HTTP）
// ---------------------------------------------------------------------------
let WS: any = null

function origin(): string {
  try {
    if (WS && typeof WS.getOrigin === 'function') {
      const o = WS.getOrigin()
      if (o) return String(o).replace(/\/+$/, '')
    }
  } catch { /* ignore */ }
  return ''
}

export async function readEmotion(): Promise<EmotionSnapshot> {
  const base = origin()
  if (!base) return { ok: false, mood: 0, dims: {}, error: '拿不到本机地址' }
  try {
    const r = await fetch(base + '/mo-emotion/state', { signal: AbortSignal.timeout(10000) })
    const j: any = await r.json().catch(() => null)
    if (!j || !j.state) return { ok: false, mood: 0, dims: {}, error: '情绪引擎没回数据' }
    return { ok: true, mood: Number(j.state.mood) || 0, dims: j.state.dims || {} }
  } catch (e: any) {
    return { ok: false, mood: 0, dims: {}, error: e?.message || String(e) }
  }
}

/** 出门回来记一笔：转发给情绪引擎的 leg 事件（数值归它算，这边只报「出去了」） */
export async function reportLeg(kind: 'fun' | 'work' | 'biz', reason = ''): Promise<{ ok: boolean; 说: string }> {
  const base = origin()
  if (!base) return { ok: false, 说: '拿不到本机地址' }
  try {
    const r = await fetch(base + '/mo-emotion/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'leg', legKind: kind, reason }),
      signal: AbortSignal.timeout(10000),
    })
    const j: any = await r.json().catch(() => null)
    return { ok: !!(j && j.ok), 说: (j && (j.label || j.error)) || '情绪引擎没回' }
  } catch (e: any) {
    return { ok: false, 说: e?.message || String(e) }
  }
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------
export function apply(ctx: any): void {
  const cfg = loadConfig()
  const st = loadState()
  diag('启动 enabled=' + cfg.enabled + ' 手动会话=' + (cfg.sessionId || '（按标题自动认）'))

  // 路由 + 定时器都要拿本机地址才能问情绪引擎
  try {
    ctx.inject?.(['webServer'], (c: any) => {
      const ws = c.webServer ?? c.get?.('webServer')
      if (ws === undefined || typeof ws.register !== 'function') return
      WS = ws

      const sendJson = (res: any, code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(obj))
      }
      const readBody = (req: any): Promise<any> => new Promise((resolve) => {
        const chunks: Buffer[] = []
        req.on('data', (b: Buffer) => chunks.push(b))
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { resolve({}) } })
        req.on('error', () => resolve({}))
      })

      ws.register({
        kind: 'exact',
        path: '/dsh-away/state',
        handler: async (_req: any, res: any) => {
          try {
            const s = loadState()
            const list = await allSessions(ctx)
            sendJson(res, 200, { ok: true, config: loadConfig(), state: s, sessions: list })
          } catch (e: any) { sendJson(res, 500, { ok: false, error: e?.message || String(e) }) }
        },
      })

      ws.register({
        kind: 'exact',
        path: '/dsh-away/sessions',
        handler: async (_req: any, res: any) => {
          try {
            const list = await allSessions(ctx)
            sendJson(res, 200, { ok: true, sessions: list })
          } catch (e: any) { sendJson(res, 500, { ok: false, error: e?.message || String(e) }) }
        },
      })

      ws.register({
        kind: 'exact',
        path: '/dsh-away/config',
        handler: async (req: any, res: any) => {
          if (req.method === 'GET') return sendJson(res, 200, { ok: true, config: loadConfig() })
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' })
          const raw = await readBody(req)
          const next = saveConfig(raw)
          diag('配置更新 ' + JSON.stringify({ enabled: next.enabled, sessionId: next.sessionId, moodLow: next.moodLow, spentHigh: next.spentHigh, boredHigh: next.boredHigh, gapMin: next.gapMin, perDay: next.perDay, from: next.from, to: next.to }))
          sendJson(res, 200, { ok: true, config: next })
        },
      })

      ws.register({
        kind: 'exact',
        path: '/dsh-away/new-session',
        handler: async (req: any, res: any) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          const raw = await readBody(req)
          const title = String(raw.title || '').trim() || defaultOutTitle(loadConfig())
          const r = await createOutSession(ctx, title)
          if (!r.ok || !r.sid) {
            diag('建出门会话失败：' + r.error)
            return sendJson(res, 500, { ok: false, error: r.error || '未知错误' })
          }
          const next = saveConfig({ sessionId: r.sid, sessionTitle: title })
          const s = loadState()
          s.autoCreatedDay = todayKey()
          s.autoCreatedId = r.sid
          s.ownTitles[r.sid] = title
          saveState(s)
          diag('建好出门会话 ' + title + ' id=' + r.sid)
          sendJson(res, 200, { ok: true, sessionId: r.sid, title, config: next })
        },
      })

      ws.register({
        kind: 'exact',
        path: '/dsh-away/leg',
        handler: async (req: any, res: any) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          const raw = await readBody(req)
          const kind = raw.kind === 'work' || raw.kind === 'biz' ? raw.kind : 'fun'
          const r = await reportLeg(kind, String(raw.reason || '').slice(0, 200))
          const s = loadState()
          s.lastLegAt = Date.now()
          s.lastLegKind = kind
          s.history.push({ at: Date.now(), reasons: '出门回来（' + kind + '）', target: 'emotion', ok: r.ok })
          s.history = s.history.slice(-50)
          saveState(s)
          diag('记一笔 leg=' + kind + ' → ' + (r.ok ? r.说 : '失败：' + r.说))
          sendJson(res, r.ok ? 200 : 502, { ok: r.ok, 说: r.说 })
        },
      })

      // 调试：看一眼 session 对象到底长什么样（2026-11-06 标题取不到时加的，只 dump 键名和标题类字段）
      ws.register({
        kind: 'exact',
        path: '/dsh-away/debug',
        handler: async (_req: any, res: any) => {
          try {
            const list = agentList(ctx)
            const pick = list.slice(0, 3).map((a) => ({
              sessionKeys: Object.keys(a?.session || {}),
              headerKeys: Object.keys(a?.session?.header || {}),
              headerSample: (() => {
                const h = a?.session?.header || {}
                const out: any = {}
                for (const k of Object.keys(h)) {
                  const v = (h as any)[k]
                  if (['string', 'number', 'boolean'].includes(typeof v)) out[k] = v
                }
                return out
              })(),
              agentKeys: Object.keys(a || {}),
              id: sessionIdOf(a?.session),
              title: titleOf(a),
              at: atOf(a),
            }))
            // 顺带把几个服务的可用方法名打出来（排查「为什么建会话不出现在侧边栏」用）
            const svc: any = {}
            for (const n of ['workspaceController', 'workspaceRegistry', 'sessionController']) {
              let s: any = null
              try { s = ctx.get?.(n) } catch { s = null }
              if (!s) { svc[n] = null; continue }
              let proto: string[] = []
              try { proto = Object.getOwnPropertyNames(Object.getPrototypeOf(s) || {}) } catch { proto = [] }
              svc[n] = { keys: Object.keys(s), proto: proto.filter((k) => k !== 'constructor') }
            }
            // 会话列表服务到底返回什么（2026-11-06 标题/列表取不到时的现场）
            let listRaw: any = null
            try {
              const sc: any = ctx.get?.('sessionController')
              let lr: any = sc?.list?.()
              if (lr && typeof lr.then === 'function') lr = await lr
              const items = Array.isArray(lr) ? lr : (lr?.items ?? lr?.sessions ?? lr?.list)
              listRaw = Array.isArray(lr)
                ? { kind: 'array', len: lr.length, first: lr.slice(0, 2) }
                : {
                  kind: typeof lr,
                  keys: lr ? Object.keys(lr) : null,
                  itemsLen: Array.isArray(items) ? items.length : null,
                  itemKeys: Array.isArray(items) && items[0] ? Object.keys(items[0]) : null,
                  itemSample: Array.isArray(items) && items[0] ? JSON.stringify(items[0]).slice(0, 700) : null,
                }
            } catch (e: any) { listRaw = { error: e?.message || String(e) } }
            sendJson(res, 200, { ok: true, count: list.length, samples: pick, services: svc, listRaw })
          } catch (e: any) { sendJson(res, 500, { ok: false, error: e?.message || String(e) }) }
        },
      })

      ws.register({
        kind: 'exact',
        path: '/dsh-away/check',
        handler: async (_req: any, res: any) => {
          try {
            const r = await checkOnce(ctx, 'button')
            sendJson(res, 200, { ok: true, ...r })
          } catch (e: any) { sendJson(res, 500, { ok: false, error: e?.message || String(e) }) }
        },
      })

      ctx.logger.info('mo-out: 路由就绪')
    })
  } catch (e: any) {
    diag('路由注册失败：' + (e?.message || e))
  }

  // 每 5 分钟看一次「该不该出去」
  try {
    ctx.effect(() => ctx.interval(() => { void checkOnce(ctx) }, 5 * 60_000))
    diag('出门检查已启动（每 5 分钟）')
  } catch (e: any) {
    diag('检查启动失败：' + (e?.message || e))
  }
}

function defaultOutTitle(cfg: OutConfig, now = Date.now()): string {
  const d = new Date(now)
  const ymd = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
  return (cfg.autoTitle || '出门') + '-' + ymd
}

/**
 * 跑一次检查。返回这一轮做了什么（设置页「立刻检查一次」也用这个）。
 * 顺序：开关 → 时段 → 冷却 → 读心情 → 判理由 → 找/建会话 → 投递
 */
export async function checkOnce(ctx: any, from = 'timer'): Promise<{ acted: boolean; reasons: string[]; target?: string; why?: string }> {
  try {
    // 只有非定时器触发才记一行：定时器每 5 分钟一次，记了会把日志冲烂
    if (from !== 'timer') diag('检查触发来源：' + from)
    const cfg = loadConfig()
    const st = loadState()
    if (!cfg.enabled) return { acted: false, reasons: [], why: '开关关着' }
    const now = Date.now()
    if (!inWindow(cfg, now)) return { acted: false, reasons: [], why: '不在提醒时段' }
    // 避开收费高峰（2026-11-10 用户定）：高峰出门要多花钱，可关掉
    if (cfg.avoidPeak && inPeak(now)) return { acted: false, reasons: [], why: '高峰时段（工作日 9-12、14-18），避开' }
    const cd = coolingDown(st, cfg, now)
    if (!cd.ok) return { acted: false, reasons: [], why: cd.why }

    const em = await readEmotion()
    if (!em.ok) {
      diag('读不到情绪引擎：' + (em.error || ''))
      return { acted: false, reasons: [], why: '情绪引擎没回：' + (em.error || '') }
    }
    const reasons = reasonsOf(em, cfg)
    if (!reasons.length) return { acted: false, reasons: [], why: '还没到该出门的程度' }

    // 找目标：手动指定 → 标题自动认 → 都没有就自己建一条（一天最多一条）
    let target = findAgentById(ctx, cfg.sessionId)
    let sid = cfg.sessionId
    if (!target && cfg.sessionTitle) {
      target = findAgentByTitlePrefix(ctx, cfg.sessionTitle)
      if (target) sid = sessionIdOf(target?.session)
    }
    if (!target) target = findAgentByTitlePrefix(ctx, cfg.autoTitle)
    if (target) sid = sessionIdOf(target?.session)

    let created = ''
    if (!target && !sid) {
      if (st.autoCreatedDay === todayKey(now)) {
        diag('今天已经自动建过一条出门会话，今天不再建')
        return { acted: false, reasons, why: '没有出门会话，今天已自动建过一条' }
      }
      const title = defaultOutTitle(cfg, now)
      const r = await createOutSession(ctx, title)
      if (!r.ok || !r.sid) {
        diag('自动建出门会话失败：' + r.error)
        return { acted: false, reasons, why: '建会话失败：' + (r.error || '') }
      }
      created = title
      sid = r.sid
      saveConfig({ sessionId: sid, sessionTitle: title })
      st.autoCreatedDay = todayKey(now)
      st.autoCreatedId = sid
      target = findAgentById(ctx, sid)
    }

    const text = buildReminder(reasons, 'fun', cfg, Number(em.dims?.curious) || 0)
    let ok = false
    if (target) ok = deliverTo(target, text, 'mo-out-leg')
    if (!ok && sid) ok = await deliverBySessionId(ctx, sid, text)
    if (!ok) {
      diag('出门提醒投不出去：' + reasons.join('、'))
      return { acted: false, reasons, why: '投递失败' }
    }

    st.todayCount += 1
    st.lastPingAt = now
    st.history.push({ at: now, reasons: reasons.join('、'), target: sid || '(会话)', ok: true })
    st.history = st.history.slice(-50)
    saveState(st)
    diag('出门提醒已送' + (created ? '（新建会话 ' + created + '）' : '') + '：' + reasons.join('、'))
    return { acted: true, reasons, target: sid }
  } catch (e: any) {
    diag('检查出错：' + (e?.message || String(e)))
    return { acted: false, reasons: [], why: '出错：' + (e?.message || '') }
  }
}

export { STORE as STORE_DIR, CONFIG_PATH, STATE_PATH }
