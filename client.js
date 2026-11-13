/**
 * dsh-away — 设置页「出门」板块（Client 半边）
 *
 * 数据从 /dsh-away/state 拉（10 秒一次）；改配置立刻 POST，没有保存键。
 * 能做的事：开关、选/新建出门会话、调判定门槛、立刻检查一次、看最近的提醒记录。
 */
window.__ModuleLoader__.load({
  id: 'dsh-away',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    /** 跟 package.json 的 version 手动对齐 */
    const VERSION = '0.1.2'

    const CSS = [
      '.moo-wrap{display:flex;flex-direction:column;gap:18px;padding:2px 0 10px;font-size:13px;color:var(--dsw-alias-label-primary);max-width:760px}',
      '.moo-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
      '.moo-title{font-size:20px;font-weight:600;line-height:1.2}',
      '.moo-sub{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.moo-sec{display:flex;flex-direction:column;gap:8px}',
      '.moo-sec-title{font-size:11.5px;font-weight:600;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}',
      '.moo-card{padding:12px 14px;border-radius:10px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:10px}',
      '.moo-row{display:flex;align-items:center;justify-content:space-between;gap:14px}',
      '.moo-label{display:flex;flex-direction:column;gap:2px}',
      '.moo-name{font-size:12.5px;font-weight:600}',
      '.moo-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.moo-input input,.moo-input select{padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.22);color:inherit;font:inherit;font-size:12.5px;min-width:120px}',
      '.moo-input input{width:64px;text-align:right;font-variant-numeric:tabular-nums}',
      '.moo-btn{padding:6px 12px;border-radius:7px;border:1px solid rgba(99,215,208,.45);background:rgba(99,215,208,.14);color:#63d7d0;font:inherit;font-size:12.5px;cursor:pointer}',
      '.moo-btn:hover{background:rgba(99,215,208,.24)}',
      '.moo-btn.ghost{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:inherit}',
      '.moo-btn:disabled{opacity:.5;cursor:default}',
      '.moo-tag{font-size:11.5px;padding:4px 9px;border-radius:999px;background:rgba(99,215,208,.13);border:1px solid rgba(99,215,208,.3);color:#63d7d0}',
      '.moo-empty{font-size:12px;color:var(--dsw-alias-label-secondary);font-style:italic}',
      '.moo-log{display:flex;flex-direction:column;gap:4px}',
      '.moo-log-row{display:grid;grid-template-columns:64px 1fr;gap:10px;font-size:12px;padding:4px 8px;border-radius:6px}',
      '.moo-log-row:nth-child(odd){background:rgba(255,255,255,.025)}',
      '.moo-log-t{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.moo-msg{font-size:12px;padding:8px 11px;border-radius:8px;background:rgba(99,215,208,.1);border:1px solid rgba(99,215,208,.25)}',
      '.moo-savebar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:9px;background:rgba(240,180,60,.10);border:1px solid rgba(240,180,60,.35)}',
      '.moo-savebar.idle{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.08)}',
      '.moo-savehint{font-size:12px;color:var(--dsw-alias-label-secondary);margin-right:auto}',
      '.moo-btn.warn{border-color:rgba(240,180,60,.5);background:rgba(240,180,60,.16);color:#f0b43c}',
      '.moo-err{font-size:12px;color:#e0705f}',
    ]

    function createOwnedStyle(css) {
      const el = document.createElement('style')
      el.setAttribute('data-moo', 'out')
      el.textContent = Array.isArray(css) ? css.join('\n') : String(css)
      document.head.appendChild(el)
      return el
    }

    function fmtTime(ms) {
      try {
        const d = new Date(ms)
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
      } catch (e) { return '--:--' }
    }
    function fmtDay(ms) {
      try {
        const d = new Date(ms)
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + fmtTime(ms)
      } catch (e) { return '--' }
    }

    /**
     * 数字输入框（2026-11-07 用户定：改完点「保存」才生效）
     * ⚠ 输入过程中只改本地文本、不往外提交。早先每敲一个字符就存一次配置，
     *   把 75 改成 85 的途中会依次经过「空 = 0」「8」——这些中间值会被当成正式值落盘，
     *   而「耗尽高于 = 0」等于「累只要大于 0 就该歇」，条件立刻成立。
     */
    function NumRow(props) {
      const { name, hint, value, unit, onChange, step, min, max } = props
      const [text, setText] = React.useState(String(value))
      const [focus, setFocus] = React.useState(false)
      // 外部值变了（保存成功 / 别处改了）就同步；正在输入时不抢
      React.useEffect(() => { if (!focus) setText(String(value)) }, [value, focus])
      const lo = min === undefined ? 0 : min
      const hi = max === undefined ? 100 : max
      const commit = (raw) => {
        const n = Number(raw)
        if (String(raw).trim() === '' || !Number.isFinite(n)) return null
        const v = step && step < 1 ? Math.round(n * 10) / 10 : Math.round(n)
        return Math.min(hi, Math.max(lo, v))
      }
      const blur = () => {
        setFocus(false)
        const v = commit(text)
        if (v === null) { setText(String(value)); return }
        setText(String(v))
        onChange(v)
      }
      return h('div', { className: 'moo-row' },
        h('div', { className: 'moo-label' }, h('div', { className: 'moo-name' }, name), h('div', { className: 'moo-hint' }, hint)),
        h('div', { className: 'moo-input' },
          h('input', {
            type: 'number', step: step || 1, min: lo, max: hi,
            value: text,
            onFocus: () => setFocus(true),
            onChange: (e) => setText(e.target.value),
            onBlur: blur,
            onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
          }),
          h('span', { className: 'moo-hint' }, unit),
        ),
      )
    }

    function OutPanel() {
      const [data, setData] = React.useState(null)
      const [cfg, setCfg] = React.useState(null)
      /** 还没保存的改动：null = 没有改动，界面直接跟服务端走 */
      const [draft, setDraft] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [saving, setSaving] = React.useState(false)

      const load = async () => {
        try {
          const r = await fetch('/dsh-away/state', { cache: 'no-store' })
          if (!r.ok) throw new Error('HTTP ' + r.status)
          const j = await r.json()
          setData(j)
          // 每次都以服务端为准：新建会话后下拉要能立刻跟上（只在第一次设会一直停在旧值）
          if (j.config) setCfg(j.config)
          setErr('')
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }

      React.useEffect(() => {
        let alive = true
        const tick = () => { if (alive) load() }
        tick()
        const t = setInterval(tick, 10000)
        return () => { alive = false; clearInterval(t) }
      }, [])

      // 改一项先进草稿，不碰服务端（2026-11-07 用户定：改完点「保存」才生效）
      const edit = (patch) => setDraft((prev) => Object.assign({}, prev || cfg || {}, patch))
      const dirty = !!draft
      const discard = () => { setDraft(null); setMsg('已撤销，回到保存前的值') }

      const save = async () => {
        if (!draft) return true
        setSaving(true)
        setMsg('')
        try {
          const r = await fetch('/dsh-away/config', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft),
          })
          const j = await r.json()
          if (j && j.ok) {
            setCfg(j.config)
            setDraft(null)
            setMsg('保存好了')
            return true
          }
          setMsg('保存失败：' + ((j && j.error) || '未知错误'))
        } catch (e) {
          setMsg('保存失败：' + String(e))
        } finally {
          setSaving(false)
        }
        return false
      }

      const newSession = () => {
        setBusy(true); setMsg('')
        fetch('/dsh-away/new-session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) {
              setMsg('建好了：' + j.title + '（已自动选中，重启 DSH 后出现在左侧）')
              if (j.config) {
                setCfg(j.config)
                // 后端刚把新会话写进配置：草稿里的会话也跟着换，否则一保存又把旧的盖回去
                setDraft((d) => (d ? Object.assign({}, d, { sessionId: j.config.sessionId, sessionTitle: j.config.sessionTitle }) : d))
              }
              load()
            } else setMsg('没建成：' + ((j && j.error) || '未知错误'))
          })
          .catch((e) => setMsg('没建成：' + String(e)))
          .then(() => setBusy(false))
      }

      const checkNow = async () => {
        setBusy(true); setMsg('')
        // 检查读的是服务端配置：先把草稿存了，不然按旧值判
        if (dirty) {
          const okSave = await save()
          if (!okSave) { setBusy(false); return }
        }
        try {
          const r = await fetch('/dsh-away/check', { method: 'POST' })
          const j = await r.json()
          if (!j || !j.ok) setMsg('检查失败：' + ((j && j.error) || '未知'))
          else if (j.acted) setMsg('发出去了：' + (j.reasons || []).join('、'))
          else setMsg('这次没发：' + (j.why || '没到线'))
          load()
        } catch (e) {
          setMsg('检查失败：' + String(e))
        } finally {
          setBusy(false)
        }
      }

      if (err) return h('div', { className: 'moo-wrap' }, h('div', { className: 'moo-err' }, '读不到出门状态：' + err))
      if (!data || !data.config) return h('div', { className: 'moo-wrap' }, h('div', { className: 'moo-empty' }, '正在读…'))

      // 显示用「草稿优先」：改了没保存时看得到新值，但服务端还是旧的
      const c = draft || cfg || data.config
      const st = data.state || {}
      const sessions = data.sessions || []
      const history = (st.history || []).slice(-8).reverse()
      const cur = sessions.find((s) => s.id === c.sessionId)
      const autoHit = sessions.find((s) => String(s.title || '').startsWith(c.autoTitle || '出门'))

      return h('div', { className: 'moo-wrap' },
        h('div', { className: 'moo-head' },
          h('div', null,
            h('div', { className: 'moo-title' }, '出门'),
            h('div', { className: 'moo-sub' }, '心情踩线时提醒散心 · 提醒投进下面这条会话'),
          ),
          h('div', { className: 'moo-sub', style: { marginLeft: 'auto' } }, 'v' + VERSION),
          h('label', { className: 'moo-row', style: { gap: 8, cursor: 'pointer' } },
            h('span', { className: 'moo-hint' }, c.enabled ? '开着' : '关着'),
            h('input', { type: 'checkbox', checked: !!c.enabled, onChange: (e) => edit({ enabled: e.target.checked }) }),
          ),
        ),

        // 改完点保存才生效（2026-11-07 用户定）
        h('div', { className: dirty ? 'moo-savebar' : 'moo-savebar idle' },
          h('div', { className: 'moo-savehint' }, dirty ? '有改动还没生效，点右边保存' : '所有改动都已生效'),
          dirty ? h('button', { className: 'moo-btn ghost', onClick: discard, disabled: saving }, '撤销') : null,
          dirty ? h('button', { className: 'moo-btn', onClick: save, disabled: saving }, saving ? '保存中…' : '保存') : null,
        ),

        // 会话
        h('div', { className: 'moo-sec' },
          h('div', { className: 'moo-sec-title' }, '提醒投到哪条会话'),
          h('div', { className: 'moo-card' },
            h('div', { className: 'moo-row' },
              h('div', { className: 'moo-label' },
                h('div', { className: 'moo-name' }, cur ? cur.title || '（这条会话还没有标题）' : '按标题自动认：' + (c.autoTitle || '出门') + ' 开头'),
                h('div', { className: 'moo-hint' }, cur ? ('手动指定 · ' + cur.id) : (autoHit ? ('现在会认到：' + (autoHit.title || '未命名')) : '现在没有符合的会话，踩线时会自己建一条')),
              ),
              h('div', { className: 'moo-input' },
                h('select', {
                  value: c.sessionId || '',
                  onChange: (e) => {
                    const sid = e.target.value
                    const s = sessions.find((x) => x.id === sid)
                    edit({ sessionId: sid, sessionTitle: s ? (s.title || '') : '' })
                  },
                },
                  h('option', { value: '' }, '自动（按标题认）'),
                  ...sessions.map((s) => h('option', { key: s.id, value: s.id }, (s.title || '未命名') + '  ·  ' + fmtDay(s.at))),
                ),
              ),
            ),
            h('div', { className: 'moo-row' },
              h('div', { className: 'moo-hint' }, '会话攒多了、想单独隔一条时点这个；建好会自动选中，标题是「' + (c.autoTitle || '出门') + '-日期」。'),
              h('button', { className: 'moo-btn', disabled: busy, onClick: newSession }, busy ? '建中…' : '新建一条出门会话'),
            ),
            h('div', { className: 'moo-row' },
              h('div', { className: 'moo-hint' }, '标题以「' + (c.autoTitle || '出门') + '」开头的会话会被自动认上（取最新那条）。'),
              h('div', { className: 'moo-input' },
                h('input', {
                  style: { width: 110, textAlign: 'left' },
                  value: c.autoTitle || '出门',
                  onChange: (e) => edit({ autoTitle: e.target.value }),
                }),
              ),
            ),
          ),
        ),

        // 判定
        h('div', { className: 'moo-sec' },
          h('div', { className: 'moo-sec-title' }, '什么时候算该出门'),
          h('div', { className: 'moo-card' },
            h(NumRow, { key: 'moodLow', name: '心情低于', hint: '心情值掉到这个数以下，就提示散心', value: c.moodLow, unit: '分', onChange: (v) => edit({ moodLow: v }), step: 1, min: 0, max: 100 }),
            h(NumRow, { key: 'spentHigh', name: '耗尽高于', hint: '累了也算该歇一歇', value: c.spentHigh, unit: '分', onChange: (v) => edit({ spentHigh: v }), step: 1, min: 0, max: 100 }),
            h(NumRow, { key: 'boredHigh', name: '闷高于', hint: '没人搭话闷到线，也算该出去透透气', value: c.boredHigh, unit: '分', onChange: (v) => edit({ boredHigh: v }), step: 1, min: 0, max: 100 }),
          ),
          h('div', { className: 'moo-hint' }, '另外「难过≥60 且 心疼≥50」也会提示一次——那是心里堵着，跟累了不是一回事。'),
        ),

        // 挑片
        h('div', { className: 'moo-sec' },
          h('div', { className: 'moo-sec-title' }, '看什么片子'),
          h('div', { className: 'moo-card' },
            h(NumRow, { key: 'videoWindowDays', name: '只看最近', hint: '默认 180 天（约 6 个月），比这老的不挑', value: c.videoWindowDays, unit: '天', onChange: (v) => edit({ videoWindowDays: v }), step: 30, min: 7, max: 3650 }),
            h(NumRow, { key: 'videoMinPlay', name: '话题款门槛', hint: '播放量到这个数以上才算「话题度高的」', value: c.videoMinPlay, unit: '播放', onChange: (v) => edit({ videoMinPlay: v }), step: 5000, min: 0, max: 100000000 }),
            h(NumRow, { key: 'videoCuriousBypass', name: '好奇破例线', hint: '好奇到这个分以上，可以不管上面的时间和热度', value: c.videoCuriousBypass, unit: '分', onChange: (v) => edit({ videoCuriousBypass: v }), step: 5, min: 0, max: 100 }),
          ),
            h('label', { className: 'moo-row', style: { gap: 8, cursor: 'pointer' } },
              h('span', { className: 'moo-hint' }, '避开收费高峰 · ' + (c.avoidPeak ? '开着' : '关着')),
              h('input', { type: 'checkbox', checked: !!c.avoidPeak, onChange: (e) => edit({ avoidPeak: e.target.checked }) }),
            ),
          h('div', { className: 'moo-hint' }, '出门提示会带上这三条：默认只挑近 N 天的，优先「你好上手的」或「话题款」，好奇过线就破例。心里堵着那次不破例。'),
        ),
        // 节奏
        h('div', { className: 'moo-sec' },
          h('div', { className: 'moo-sec-title' }, '别烦人'),
          h('div', { className: 'moo-card' },
            h(NumRow, { key: 'gapMin', name: '两次提醒隔', hint: '刚叫过就别再叫', value: c.gapMin, unit: '分钟', onChange: (v) => edit({ gapMin: v }), step: 1, min: 10, max: 1440 }),
            h(NumRow, { key: 'perDay', name: '一天最多', hint: '叫够了今天就不再提醒', value: c.perDay, unit: '次', onChange: (v) => edit({ perDay: v }), step: 1, min: 1, max: 12 }),
            h(NumRow, { key: 'from', name: '从', hint: '只在这个钟点之后提醒', value: c.from, unit: '点', onChange: (v) => edit({ from: v }), step: 0.5, min: 0, max: 24 }),
            h(NumRow, { key: 'to', name: '到', hint: '到这个点之后就不提醒了；要「7:30」就填 7.5', value: c.to, unit: '点', onChange: (v) => edit({ to: v }), step: 0.5, min: 0, max: 24 }),
          ),
        ),

        // 今天的状态
        h('div', { className: 'moo-sec' },
          h('div', { className: 'moo-sec-title' }, '今天'),
          h('div', { className: 'moo-card' },
            h('div', { className: 'moo-row' },
              h('div', { className: 'moo-hint' }, '今天叫过 ' + (st.todayCount || 0) + ' / ' + c.perDay + ' 次' + (st.lastPingAt ? '，上次 ' + fmtDay(st.lastPingAt) : '')),
              h('button', { className: 'moo-btn ghost', disabled: busy, onClick: checkNow }, busy ? '检查中…' : '立刻检查一次'),
            ),
            msg ? h('div', { className: 'moo-msg' }, msg) : null,
          ),
        ),

        // 记录
        h('div', { className: 'moo-sec' },
          h('div', { className: 'moo-sec-title' }, '最近的提醒与出门'),
          history.length
            ? h('div', { className: 'moo-log' }, ...history.map((r, i) => h('div', { className: 'moo-log-row', key: i },
                h('div', { className: 'moo-log-t' }, fmtDay(r.at)),
                h('div', null, (r.ok ? '' : '✗ ') + (r.reasons || '')),
              )))
            : h('div', { className: 'moo-empty' }, '还没有记录'),
        ),
      )
    }

    function apply(ctx) {
      const styleEl = createOwnedStyle(CSS)
      ctx.effect(() => () => { try { styleEl.remove() } catch (e) { /* ignore */ } }, 'mo-out: styles')

      // settings.section 要等官方设置外壳激活后才上 ledger，插件客户端比外壳先激活 —— 轮询重试
      const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
      if (!slots || typeof slots.register !== 'function') return

      let disposed = false
      let disposeEntry = null
      let timer = null
      const SLOT = { name: 'settings.section', id: 'mo-out', order: 27, label: '出门', inject: () => ({}) }

      const tryRegister = () => {
        if (disposed) return
        try { if (disposeEntry) { disposeEntry(); disposeEntry = null } } catch (e) { /* ignore */ }
        try {
          disposeEntry = slots.register(SLOT, OutPanel)
        } catch (e) {
          disposeEntry = null
          timer = setTimeout(tryRegister, 400)
        }
      }
      tryRegister()

      ctx.effect(() => () => {
        disposed = true
        if (timer) { try { clearTimeout(timer) } catch (e) { /* ignore */ } }
        try { if (disposeEntry) disposeEntry() } catch (e) { /* ignore */ }
      }, 'mo-out: settings section')
    }

    exports.apply = apply
    exports.inject = {}
    return exports
  },
})
