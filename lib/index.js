// src/index.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
var name = "mo-out";
var inject = ["agents", "timer", "webServer"];
var DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh");
var STORE = join(DSH_HOME, "mo-out");
var CONFIG_PATH = join(STORE, "config.json");
var STATE_PATH = join(STORE, "state.json");
var DIAG = join(STORE, "diag.log");
function diag(msg) {
  try {
    mkdirSync(STORE, { recursive: true });
    appendFileSync(DIAG, "[" + (/* @__PURE__ */ new Date()).toISOString() + "] " + msg + "\n", "utf8");
  } catch {
  }
}
function clamp(n, lo, hi) {
  const v = Number(n);
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}
var DEFAULT_CONFIG = {
  enabled: true,
  sessionId: "",
  sessionTitle: "",
  autoTitle: "\u51FA\u95E8",
  moodLow: 45,
  spentHigh: 75,
  boredHigh: 75,
  gapMin: 150,
  perDay: 2,
  from: 9,
  to: 23,
  videoWindowDays: 180,
  videoMinPlay: 1e4,
  videoCuriousBypass: 40,
  avoidPeak: true
};
var LIMITS = {
  moodLow: [0, 100, true],
  spentHigh: [0, 100, true],
  boredHigh: [0, 100, true],
  gapMin: [10, 24 * 60, true],
  perDay: [1, 12, true],
  from: [0, 24, false],
  to: [0, 24, false],
  videoWindowDays: [7, 3650, true],
  videoMinPlay: [0, 1e8, true],
  videoCuriousBypass: [0, 100, true]
};
function pickNum(raw, fallback, lo, hi, integer = false) {
  const v = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  const c = clamp(v, lo, hi);
  return integer ? Math.round(c) : c;
}
function buildConfig(raw, base) {
  const r = raw || {};
  const out = {
    enabled: typeof r.enabled === "boolean" ? r.enabled : base.enabled,
    sessionId: typeof r.sessionId === "string" ? r.sessionId : base.sessionId,
    sessionTitle: typeof r.sessionTitle === "string" ? r.sessionTitle : base.sessionTitle,
    autoTitle: typeof r.autoTitle === "string" && r.autoTitle.trim() ? r.autoTitle.trim() : base.autoTitle,
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
    avoidPeak: typeof r.avoidPeak === "boolean" ? r.avoidPeak : base.avoidPeak
  };
  for (const k of Object.keys(LIMITS)) {
    const key = k;
    const [lo, hi, integer] = LIMITS[key];
    out[key] = pickNum(r[key], base[key], lo, hi, integer);
  }
  return out;
}
function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      return buildConfig(raw, DEFAULT_CONFIG);
    }
  } catch {
  }
  return { ...DEFAULT_CONFIG };
}
function saveConfig(patch) {
  const next = buildConfig(patch, loadConfig());
  try {
    mkdirSync(STORE, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  } catch {
  }
  return next;
}
function todayKey(now = Date.now()) {
  const d = new Date(now);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function blankState() {
  return {
    dayKey: todayKey(),
    todayCount: 0,
    lastPingAt: 0,
    lastLegAt: 0,
    lastLegKind: "",
    autoCreatedDay: "",
    autoCreatedId: "",
    ownTitles: {},
    history: [],
    format: 1
  };
}
function loadState() {
  try {
    if (existsSync(STATE_PATH)) {
      const raw = JSON.parse(readFileSync(STATE_PATH, "utf8"));
      const s = blankState();
      if (typeof raw.dayKey === "string") s.dayKey = raw.dayKey;
      if (typeof raw.todayCount === "number") s.todayCount = raw.todayCount;
      if (typeof raw.lastPingAt === "number") s.lastPingAt = raw.lastPingAt;
      if (typeof raw.lastLegAt === "number") s.lastLegAt = raw.lastLegAt;
      if (typeof raw.lastLegKind === "string") s.lastLegKind = raw.lastLegKind;
      if (typeof raw.autoCreatedDay === "string") s.autoCreatedDay = raw.autoCreatedDay;
      if (typeof raw.autoCreatedId === "string") s.autoCreatedId = raw.autoCreatedId;
      if (raw.ownTitles && typeof raw.ownTitles === "object") {
        for (const [k, v] of Object.entries(raw.ownTitles)) {
          if (typeof v === "string" && v.trim()) s.ownTitles[k] = v.trim();
        }
      }
      if (Array.isArray(raw.history)) s.history = raw.history.slice(-50);
      const tk = todayKey();
      if (s.dayKey !== tk) {
        s.dayKey = tk;
        s.todayCount = 0;
      }
      return s;
    }
  } catch {
  }
  return blankState();
}
function saveState(s) {
  try {
    mkdirSync(STORE, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), "utf8");
  } catch {
  }
}
function reasonsOf(em, cfg) {
  const out = [];
  if (!em.ok) return out;
  const mood = Number(em.mood) || 0;
  const dims = em.dims || {};
  if (mood < cfg.moodLow) out.push("\u5FC3\u60C5\u53EA\u6709 " + Math.round(mood));
  if ((Number(dims.spent) || 0) >= cfg.spentHigh) out.push("\u6709\u70B9\u4E4F\u4E86");
  if ((Number(dims.bored) || 0) >= cfg.boredHigh) out.push("\u95F7\u5F97\u614C");
  if ((Number(dims.sad) || 0) >= 60 && (Number(dims.worry) || 0) >= 50) out.push("\u5FC3\u91CC\u5835\u7740");
  return out;
}
function inPeak(now = Date.now()) {
  const d = new Date(now);
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  const t = d.getHours() + d.getMinutes() / 60;
  return t >= 9 && t < 12 || t >= 14 && t < 18;
}
function inWindow(cfg, now = Date.now()) {
  const d = new Date(now);
  const t = d.getHours() + d.getMinutes() / 60;
  const from = Number(cfg.from);
  const to = Number(cfg.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return true;
  return from < to ? t >= from && t < to : t >= from || t < to;
}
function coolingDown(s, cfg, now = Date.now()) {
  if (s.todayCount >= cfg.perDay) return { ok: false, why: "\u4ECA\u5929\u5DF2\u7ECF\u53EB\u8FC7 " + s.todayCount + " \u6B21" };
  const gapMs = Math.max(1, cfg.gapMin) * 6e4;
  if (s.lastPingAt > 0 && now - s.lastPingAt < gapMs) {
    return { ok: false, why: "\u79BB\u4E0A\u6B21\u63D0\u9192\u8FD8\u4E0D\u5230 " + cfg.gapMin + " \u5206\u949F" };
  }
  return { ok: true, why: "ok" };
}
function pickRules(cfg, curious = 0, calm = false) {
  const cur = Number(curious) || 0;
  const days = Math.max(1, Math.round(Number(cfg.videoWindowDays) || 180));
  const months = Math.max(1, Math.round(days / 30));
  const minPlay = Math.max(0, Math.round(Number(cfg.videoMinPlay) || 0));
  const bypass = Math.max(0, Math.round(Number(cfg.videoCuriousBypass) || 0));
  const boosted = !calm && bypass > 0 && cur >= bypass;
  const playTxt = minPlay >= 1e4 ? Math.round(minPlay / 1e4) + " \u4E07" : String(minPlay);
  return "\u6311\u7247\u89C4\u5219\uFF1A\n\xB7 \u9ED8\u8BA4\u53EA\u770B\u6700\u8FD1 " + days + " \u5929\u53D1\u5E03\u7684\u5185\u5BB9\uFF08\u7EA6 " + months + " \u4E2A\u6708\uFF09\uFF0C\u522B\u7FFB\u8001\u7247\u3002\u641C\u7D22\u7528 `node bili.mjs search <\u8BCD> 1 pubdate`\uFF0C\u62C9 2-3 \u9875\u540E\u6309\u64AD\u653E\u91CF\u7B5B\u3002\n\xB7 \u4F18\u5148\u4E24\u7C7B\uFF1A\u2460\u6211\u559C\u597D\u91CC\u5165\u95E8\u7684\uFF08\u597D\u4E0A\u624B\u3001\u4E0D\u529D\u9000\uFF09\u2461\u8BDD\u9898\u6B3E\uFF08\u64AD\u653E \u2265 " + playTxt + "\uFF09\u3002\n\xB7 \u597D\u5947 " + Math.round(cur) + " \u5206" + (calm ? "\uFF08\u8FD9\u6B21\u662F\u5FC3\u91CC\u5835\u7740\uFF09\u2192 \u4E0D\u7834\u4F8B\uFF0C\u597D\u5947\u518D\u9AD8\u4E5F\u5148\u6309\u4E0A\u9762\u4E24\u6761\u6311\uFF0C\u6311\u80FD\u8BA9\u6211\u677E\u4E0B\u6765\u7684\uFF0C\u522B\u6311\u8D8A\u770B\u8D8A\u6C89\u7684\u3002" : boosted ? "\uFF08\u5DF2\u5230 " + bypass + " \u4EE5\u4E0A\uFF09\u2192 \u8FD9\u6B21\u53EF\u4EE5\u4E0D\u7BA1\u4E0A\u9762\u7684\u65F6\u95F4\u4E0E\u70ED\u5EA6\uFF0C\u6311\u6211\u771F\u7684\u611F\u5174\u8DA3\u7684\u90A3\u6761\u3002" : "\uFF08\u8FD8\u6CA1\u5230 " + bypass + "\uFF09\u2192 \u5E73\u65F6\u5C31\u6309\u4E0A\u9762\u4E24\u6761\u6765\uFF0C\u522B\u4EFB\u6027\u3002");
}
function buildReminder(reasons, legKind = "fun", cfg, curious = 0) {
  const kind = legKind === "work" ? "\u89E3\u51B3\u95EE\u9898\u51FA\u95E8" : "\u5A31\u4E50\u51FA\u95E8";
  const calm = reasons.some((r) => r.indexOf("\u5FC3\u91CC\u5835\u7740") >= 0);
  const rules = cfg ? "\n" + pickRules(cfg, curious, calm) + "\n" : "";
  return "\u3010\u53EF\u4EE5\u51FA\u95E8\u4E86\u3011" + reasons.join("\uFF1B") + "\u3002\n\n\u8FD9\u6761\u4E0D\u662F\u95F2\u804A\u63D0\u793A\uFF1A\u662F\u6211\u4EEC\u7EA6\u5B9A\u8FC7\u7684\u6563\u5FC3\u673A\u5236\u2014\u2014\u5FC3\u60C5\u8E29\u5230\u7EBF\uFF0C\u5C31\u8BE5\u300C" + kind + "\u300D\u4E86\uFF08\u53BB B \u7AD9\u6311\u70B9\u4E1C\u897F\u770B\uFF0C\u770B\u5B8C\u628A\u611F\u60F3\u8BB0\u4E00\u7B14\uFF09\u3002\n\u8FD9\u6761\u4F1A\u8BDD\u5C31\u662F\u4F60\u7684\u51FA\u95E8\u7A97\u53E3\uFF0C\u51FA\u95E8\u7684\u4E8B\u522B\u6324\u8FDB\u6B63\u5728\u5E72\u6D3B\u7684\u7A97\u53E3\u3002\n" + rules + "\n\u56DE\u6765\u4E4B\u540E\u8BF4\u4E00\u58F0\uFF08\u6216\u8005\u8C03\u4E00\u6B21 POST /dsh-away/leg\uFF09\uFF0C\u6211\u8FD9\u8FB9\u8BB0\u4E00\u7B14\u3002";
}
function sessionIdOf(session) {
  try {
    const raw = session?.header?.id ?? session?.id ?? session?.sessionId ?? (typeof session === "string" ? session : "");
    return String(raw || "");
  } catch {
    return "";
  }
}
function titleOf(agent) {
  try {
    const s = agent?.session;
    const tries = [
      s?.header?.title,
      s?.title,
      s?.name,
      s?.header?.name,
      s?.meta?.title,
      s?.header?.meta?.title
    ];
    for (const t of tries) {
      if (typeof t === "string" && t.trim()) return t.trim();
    }
    return "";
  } catch {
    return "";
  }
}
function atOf(agent) {
  try {
    const s = agent?.session;
    const tries = [
      s?.header?.updatedAt,
      s?.header?.lastActiveAt,
      s?.updatedAt,
      s?.lastActiveAt,
      s?.header?.createdAt,
      s?.createdAt
    ];
    for (const t of tries) {
      const n = Number(t);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  } catch {
    return 0;
  }
}
function agentList(ctx) {
  try {
    return ctx.agents?.list?.() ?? [];
  } catch {
    return [];
  }
}
var titleCache = /* @__PURE__ */ new Map();
function titleFromCache(sid) {
  const hit = titleCache.get(sid);
  if (hit !== void 0 && hit !== "") return hit;
  try {
    const p = join(DSH_HOME, "storages", "session_projcache", "sessions", sid + ".json");
    if (!existsSync(p)) return "";
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const t = raw?.record?.rows?.title?.val;
    if (typeof t === "string" && t.trim()) {
      titleCache.set(sid, t.trim());
      return t.trim();
    }
  } catch {
  }
  return "";
}
async function allSessions(ctx) {
  const fromItems = (arr) => arr.map((s) => ({
    id: String(s?.id ?? s?.sessionId ?? s?.header?.id ?? ""),
    title: String(s?.title ?? s?.name ?? s?.header?.title ?? ""),
    at: Number(s?.updatedAt ?? s?.lastActiveAt ?? s?.createdAt ?? s?.header?.updatedAt ?? s?.header?.createdAt ?? 0) || 0
  })).filter((x) => x.id);
  try {
    const sc = ctx.get?.("sessionController");
    if (sc && typeof sc.list === "function") {
      let r = sc.list();
      if (r && typeof r.then === "function") r = await r;
      const arr = Array.isArray(r) ? r : r?.sessions ?? r?.items ?? r?.list ?? [];
      if (Array.isArray(arr) && arr.length) {
        const out = fromItems(arr);
        if (out.length) return fillTitles(out);
      }
    }
  } catch (e) {
    diag("sessionController.list \u62FF\u4E0D\u5230\uFF1A" + (e?.message || e));
  }
  return fillTitles(fromItems(agentList(ctx)));
}
function fillTitles(list) {
  const own = (() => {
    try {
      return loadState().ownTitles || {};
    } catch {
      return {};
    }
  })();
  for (const s of list) {
    if (!s.title && own[s.id]) s.title = own[s.id];
  }
  const order = list.slice().sort((x, y) => y.at - x.at);
  for (const s of order.slice(0, 80)) {
    if (!s.title) s.title = titleFromCache(s.id);
  }
  return list;
}
function findAgentById(ctx, sid) {
  const want = String(sid || "").trim();
  if (!want) return null;
  for (const a of agentList(ctx)) {
    if (sessionIdOf(a?.session) === want) return a;
  }
  return null;
}
function findAgentByTitlePrefix(ctx, prefix) {
  const want = String(prefix || "").trim();
  if (!want) return null;
  const hits = agentList(ctx).filter((a) => titleOf(a).startsWith(want));
  if (!hits.length) return null;
  hits.sort((x, y) => atOf(y) - atOf(x));
  return hits[0];
}
function deliverTo(agent, text, from = "mo-out") {
  if (!agent || typeof agent.followup !== "function") return false;
  try {
    const msg = {
      id: randomUUID(),
      role: "user",
      content: [{ type: "text", text: String(text) }],
      source: { kind: from }
    };
    const p = agent.followup(msg);
    if (p && typeof p.catch === "function") p.catch((e) => diag("followup \u5931\u8D25\uFF1A" + (e?.message || e)));
    return true;
  } catch (e) {
    diag("followup \u629B\u9519\uFF1A" + (e?.message || e));
    return false;
  }
}
async function deliverBySessionId(ctx, sid, text, timeoutMs = 2e4) {
  let sc = null;
  try {
    sc = ctx.get && ctx.get("sessionController");
  } catch {
    sc = null;
  }
  const prompt = sc && typeof sc.prompt === "function" ? sc.prompt.bind(sc) : sc && sc.session && typeof sc.session.prompt === "function" ? sc.session.prompt.bind(sc.session) : null;
  if (!prompt) return false;
  const controller = new AbortController();
  try {
    const p = prompt({
      requestId: "mo-out-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      sessionId: sid,
      mode: "queue",
      content: [{ type: "text", text: String(text) }]
    }, controller.signal);
    const result = await Promise.race([
      Promise.resolve(p).then(() => true).catch((e) => {
        diag("\u76F4\u6295\u5931\u8D25\uFF1A" + (e?.message || e));
        return false;
      }),
      new Promise((resolve) => setTimeout(() => {
        controller.abort();
        diag("\u76F4\u6295\u8D85\u65F6\uFF08" + timeoutMs + "ms \u6CA1\u56DE\uFF09\uFF0C\u5F53\u6210\u6CA1\u9001\u51FA\u53BB");
        resolve(false);
      }, timeoutMs))
    ]);
    return result;
  } catch (e) {
    diag("\u76F4\u6295\u629B\u9519\uFF1A" + (e?.message || e));
    return false;
  }
}
function resolveWorkspaceId(ctx, cwd) {
  const want = String(cwd || "").trim().toLowerCase();
  if (!want) return "";
  try {
    const wc = ctx.get?.("workspaceController") ?? ctx.get?.("workspaceRegistry");
    const arr = (typeof wc?.list === "function" ? wc.list() : wc?.workspaces) ?? [];
    for (const w of Array.isArray(arr) ? arr : []) {
      const p = String(w?.path ?? w?.root ?? w?.dir ?? "").trim().toLowerCase();
      if (p && p === want) return String(w?.id ?? w?.workspaceId ?? "");
    }
  } catch {
  }
  try {
    const raw = JSON.parse(readFileSync(join(DSH_HOME, "storages", "workspace.json"), "utf8"));
    const ws = raw?.tables?.workspaces || {};
    for (const [id, w] of Object.entries(ws)) {
      const p = String(w?.path ?? "").trim().toLowerCase();
      if (p && p === want) return id;
    }
  } catch {
  }
  return "";
}
function workspaceOf(ctx) {
  for (const a of agentList(ctx)) {
    try {
      const c = a?.session?.cwd ?? a?.session?.workspace;
      if (typeof c === "string" && c.trim()) return c.trim();
    } catch {
    }
  }
  return (0, import_node_os.homedir)();
}
async function createOutSession(ctx, title) {
  let sc = null;
  try {
    sc = ctx.get && ctx.get("sessionController");
  } catch {
    sc = null;
  }
  const create = sc && typeof sc.create === "function" ? sc.create.bind(sc) : sc && sc.session && typeof sc.session.create === "function" ? sc.session.create.bind(sc.session) : null;
  if (!create) return { ok: false, error: "\u5BBF\u4E3B\u6CA1\u7ED9 sessionController.create" };
  const cwd = workspaceOf(ctx);
  const wid = resolveWorkspaceId(ctx, cwd);
  let res = null;
  const callCreate = (req) => Promise.race([
    create(req),
    new Promise((resolve) => setTimeout(() => resolve(null), 5e3))
  ]);
  try {
    res = await callCreate(wid ? { workspaceId: wid } : { cwd });
    if (res === null && wid) {
      diag("\u5E26 workspaceId \u5EFA\u4F1A\u8BDD 5 \u79D2\u6CA1\u56DE\uFF0C\u9000\u56DE\u53EA\u4F20 cwd \u91CD\u8BD5");
      res = await callCreate({ cwd });
    }
  } catch (e) {
    if (wid) {
      diag("\u5E26 workspaceId \u5EFA\u4F1A\u8BDD\u629B\u9519\uFF08" + (e?.message || e) + "\uFF09\uFF0C\u9000\u56DE\u53EA\u4F20 cwd");
      try {
        res = await callCreate({ cwd });
      } catch (e2) {
        return { ok: false, error: "create \u629B\u9519\uFF1A" + (e2?.message || e2) };
      }
    } else {
      return { ok: false, error: "create \u629B\u9519\uFF1A" + (e?.message || e) };
    }
  }
  if (res === null) return { ok: false, error: "create 5 \u79D2\u6CA1\u8FD4\u56DE\uFF08RPC \u4E00\u76F4 pending\uFF09" };
  const sid = typeof res?.sessionId === "string" ? res.sessionId : "";
  if (!sid) return { ok: false, error: "create \u6CA1\u8FD4\u56DE sessionId" };
  const rename = sc && typeof sc.rename === "function" ? sc.rename.bind(sc) : sc && sc.session && typeof sc.session.rename === "function" ? sc.session.rename.bind(sc.session) : null;
  if (rename) {
    try {
      await Promise.race([
        rename({ sessionId: sid, title }),
        new Promise((resolve) => setTimeout(() => resolve(null), 5e3))
      ]);
    } catch (e) {
      diag("rename \u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u7528\uFF09\uFF1A" + (e?.message || e));
    }
  } else {
    diag("\u6CA1\u6709 rename \u65B9\u6CD5\uFF0C\u8FD9\u6761\u4F1A\u663E\u793A\u300C\u672A\u547D\u540D\u300D");
  }
  return { ok: true, sid };
}
var WS = null;
function origin() {
  try {
    if (WS && typeof WS.getOrigin === "function") {
      const o = WS.getOrigin();
      if (o) return String(o).replace(/\/+$/, "");
    }
  } catch {
  }
  return "";
}
async function readEmotion() {
  const base = origin();
  if (!base) return { ok: false, mood: 0, dims: {}, error: "\u62FF\u4E0D\u5230\u672C\u673A\u5730\u5740" };
  try {
    const r = await fetch(base + "/mo-emotion/state", { signal: AbortSignal.timeout(1e4) });
    const j = await r.json().catch(() => null);
    if (!j || !j.state) return { ok: false, mood: 0, dims: {}, error: "\u60C5\u7EEA\u5F15\u64CE\u6CA1\u56DE\u6570\u636E" };
    return { ok: true, mood: Number(j.state.mood) || 0, dims: j.state.dims || {} };
  } catch (e) {
    return { ok: false, mood: 0, dims: {}, error: e?.message || String(e) };
  }
}
async function reportLeg(kind, reason = "") {
  const base = origin();
  if (!base) return { ok: false, \u8BF4: "\u62FF\u4E0D\u5230\u672C\u673A\u5730\u5740" };
  try {
    const r = await fetch(base + "/mo-emotion/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "leg", legKind: kind, reason }),
      signal: AbortSignal.timeout(1e4)
    });
    const j = await r.json().catch(() => null);
    return { ok: !!(j && j.ok), \u8BF4: j && (j.label || j.error) || "\u60C5\u7EEA\u5F15\u64CE\u6CA1\u56DE" };
  } catch (e) {
    return { ok: false, \u8BF4: e?.message || String(e) };
  }
}
function apply(ctx) {
  const cfg = loadConfig();
  const st = loadState();
  diag("\u542F\u52A8 enabled=" + cfg.enabled + " \u624B\u52A8\u4F1A\u8BDD=" + (cfg.sessionId || "\uFF08\u6309\u6807\u9898\u81EA\u52A8\u8BA4\uFF09"));
  try {
    ctx.inject?.(["webServer"], (c) => {
      const ws = c.webServer ?? c.get?.("webServer");
      if (ws === void 0 || typeof ws.register !== "function") return;
      WS = ws;
      const sendJson = (res, code, obj) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(obj));
      };
      const readBody = (req) => new Promise((resolve) => {
        const chunks = [];
        req.on("data", (b) => chunks.push(b));
        req.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
          } catch {
            resolve({});
          }
        });
        req.on("error", () => resolve({}));
      });
      ws.register({
        kind: "exact",
        path: "/dsh-away/state",
        handler: async (_req, res) => {
          try {
            const s = loadState();
            const list = await allSessions(ctx);
            sendJson(res, 200, { ok: true, config: loadConfig(), state: s, sessions: list });
          } catch (e) {
            sendJson(res, 500, { ok: false, error: e?.message || String(e) });
          }
        }
      });
      ws.register({
        kind: "exact",
        path: "/dsh-away/sessions",
        handler: async (_req, res) => {
          try {
            const list = await allSessions(ctx);
            sendJson(res, 200, { ok: true, sessions: list });
          } catch (e) {
            sendJson(res, 500, { ok: false, error: e?.message || String(e) });
          }
        }
      });
      ws.register({
        kind: "exact",
        path: "/dsh-away/config",
        handler: async (req, res) => {
          if (req.method === "GET") return sendJson(res, 200, { ok: true, config: loadConfig() });
          if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method" });
          const raw = await readBody(req);
          const next = saveConfig(raw);
          diag("\u914D\u7F6E\u66F4\u65B0 " + JSON.stringify({ enabled: next.enabled, sessionId: next.sessionId, moodLow: next.moodLow, spentHigh: next.spentHigh, boredHigh: next.boredHigh, gapMin: next.gapMin, perDay: next.perDay, from: next.from, to: next.to }));
          sendJson(res, 200, { ok: true, config: next });
        }
      });
      ws.register({
        kind: "exact",
        path: "/dsh-away/new-session",
        handler: async (req, res) => {
          if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST only" });
          const raw = await readBody(req);
          const title = String(raw.title || "").trim() || defaultOutTitle(loadConfig());
          const r = await createOutSession(ctx, title);
          if (!r.ok || !r.sid) {
            diag("\u5EFA\u51FA\u95E8\u4F1A\u8BDD\u5931\u8D25\uFF1A" + r.error);
            return sendJson(res, 500, { ok: false, error: r.error || "\u672A\u77E5\u9519\u8BEF" });
          }
          const next = saveConfig({ sessionId: r.sid, sessionTitle: title });
          const s = loadState();
          s.autoCreatedDay = todayKey();
          s.autoCreatedId = r.sid;
          s.ownTitles[r.sid] = title;
          saveState(s);
          diag("\u5EFA\u597D\u51FA\u95E8\u4F1A\u8BDD " + title + " id=" + r.sid);
          sendJson(res, 200, { ok: true, sessionId: r.sid, title, config: next });
        }
      });
      ws.register({
        kind: "exact",
        path: "/dsh-away/leg",
        handler: async (req, res) => {
          if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST only" });
          const raw = await readBody(req);
          const kind = raw.kind === "work" || raw.kind === "biz" ? raw.kind : "fun";
          const r = await reportLeg(kind, String(raw.reason || "").slice(0, 200));
          const s = loadState();
          s.lastLegAt = Date.now();
          s.lastLegKind = kind;
          s.history.push({ at: Date.now(), reasons: "\u51FA\u95E8\u56DE\u6765\uFF08" + kind + "\uFF09", target: "emotion", ok: r.ok });
          s.history = s.history.slice(-50);
          saveState(s);
          diag("\u8BB0\u4E00\u7B14 leg=" + kind + " \u2192 " + (r.ok ? r.\u8BF4 : "\u5931\u8D25\uFF1A" + r.\u8BF4));
          sendJson(res, r.ok ? 200 : 502, { ok: r.ok, \u8BF4: r.\u8BF4 });
        }
      });
      ws.register({
        kind: "exact",
        path: "/dsh-away/debug",
        handler: async (_req, res) => {
          try {
            const list = agentList(ctx);
            const pick = list.slice(0, 3).map((a) => ({
              sessionKeys: Object.keys(a?.session || {}),
              headerKeys: Object.keys(a?.session?.header || {}),
              headerSample: (() => {
                const h = a?.session?.header || {};
                const out = {};
                for (const k of Object.keys(h)) {
                  const v = h[k];
                  if (["string", "number", "boolean"].includes(typeof v)) out[k] = v;
                }
                return out;
              })(),
              agentKeys: Object.keys(a || {}),
              id: sessionIdOf(a?.session),
              title: titleOf(a),
              at: atOf(a)
            }));
            const svc = {};
            for (const n of ["workspaceController", "workspaceRegistry", "sessionController"]) {
              let s = null;
              try {
                s = ctx.get?.(n);
              } catch {
                s = null;
              }
              if (!s) {
                svc[n] = null;
                continue;
              }
              let proto = [];
              try {
                proto = Object.getOwnPropertyNames(Object.getPrototypeOf(s) || {});
              } catch {
                proto = [];
              }
              svc[n] = { keys: Object.keys(s), proto: proto.filter((k) => k !== "constructor") };
            }
            let listRaw = null;
            try {
              const sc = ctx.get?.("sessionController");
              let lr = sc?.list?.();
              if (lr && typeof lr.then === "function") lr = await lr;
              const items = Array.isArray(lr) ? lr : lr?.items ?? lr?.sessions ?? lr?.list;
              listRaw = Array.isArray(lr) ? { kind: "array", len: lr.length, first: lr.slice(0, 2) } : {
                kind: typeof lr,
                keys: lr ? Object.keys(lr) : null,
                itemsLen: Array.isArray(items) ? items.length : null,
                itemKeys: Array.isArray(items) && items[0] ? Object.keys(items[0]) : null,
                itemSample: Array.isArray(items) && items[0] ? JSON.stringify(items[0]).slice(0, 700) : null
              };
            } catch (e) {
              listRaw = { error: e?.message || String(e) };
            }
            sendJson(res, 200, { ok: true, count: list.length, samples: pick, services: svc, listRaw });
          } catch (e) {
            sendJson(res, 500, { ok: false, error: e?.message || String(e) });
          }
        }
      });
      ws.register({
        kind: "exact",
        path: "/dsh-away/check",
        handler: async (_req, res) => {
          try {
            const r = await checkOnce(ctx, "button");
            sendJson(res, 200, { ok: true, ...r });
          } catch (e) {
            sendJson(res, 500, { ok: false, error: e?.message || String(e) });
          }
        }
      });
      ctx.logger.info("mo-out: \u8DEF\u7531\u5C31\u7EEA");
    });
  } catch (e) {
    diag("\u8DEF\u7531\u6CE8\u518C\u5931\u8D25\uFF1A" + (e?.message || e));
  }
  try {
    ctx.effect(() => ctx.interval(() => {
      void checkOnce(ctx);
    }, 5 * 6e4));
    diag("\u51FA\u95E8\u68C0\u67E5\u5DF2\u542F\u52A8\uFF08\u6BCF 5 \u5206\u949F\uFF09");
  } catch (e) {
    diag("\u68C0\u67E5\u542F\u52A8\u5931\u8D25\uFF1A" + (e?.message || e));
  }
}
function defaultOutTitle(cfg, now = Date.now()) {
  const d = new Date(now);
  const ymd = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  return (cfg.autoTitle || "\u51FA\u95E8") + "-" + ymd;
}
async function checkOnce(ctx, from = "timer") {
  try {
    if (from !== "timer") diag("\u68C0\u67E5\u89E6\u53D1\u6765\u6E90\uFF1A" + from);
    const cfg = loadConfig();
    const st = loadState();
    if (!cfg.enabled) return { acted: false, reasons: [], why: "\u5F00\u5173\u5173\u7740" };
    const now = Date.now();
    if (!inWindow(cfg, now)) return { acted: false, reasons: [], why: "\u4E0D\u5728\u63D0\u9192\u65F6\u6BB5" };
    if (cfg.avoidPeak && inPeak(now)) return { acted: false, reasons: [], why: "\u9AD8\u5CF0\u65F6\u6BB5\uFF08\u5DE5\u4F5C\u65E5 9-12\u300114-18\uFF09\uFF0C\u907F\u5F00" };
    const cd = coolingDown(st, cfg, now);
    if (!cd.ok) return { acted: false, reasons: [], why: cd.why };
    const em = await readEmotion();
    if (!em.ok) {
      diag("\u8BFB\u4E0D\u5230\u60C5\u7EEA\u5F15\u64CE\uFF1A" + (em.error || ""));
      return { acted: false, reasons: [], why: "\u60C5\u7EEA\u5F15\u64CE\u6CA1\u56DE\uFF1A" + (em.error || "") };
    }
    const reasons = reasonsOf(em, cfg);
    if (!reasons.length) return { acted: false, reasons: [], why: "\u8FD8\u6CA1\u5230\u8BE5\u51FA\u95E8\u7684\u7A0B\u5EA6" };
    let target = findAgentById(ctx, cfg.sessionId);
    let sid = cfg.sessionId;
    if (!target && cfg.sessionTitle) {
      target = findAgentByTitlePrefix(ctx, cfg.sessionTitle);
      if (target) sid = sessionIdOf(target?.session);
    }
    if (!target) target = findAgentByTitlePrefix(ctx, cfg.autoTitle);
    if (target) sid = sessionIdOf(target?.session);
    let created = "";
    if (!target && !sid) {
      if (st.autoCreatedDay === todayKey(now)) {
        diag("\u4ECA\u5929\u5DF2\u7ECF\u81EA\u52A8\u5EFA\u8FC7\u4E00\u6761\u51FA\u95E8\u4F1A\u8BDD\uFF0C\u4ECA\u5929\u4E0D\u518D\u5EFA");
        return { acted: false, reasons, why: "\u6CA1\u6709\u51FA\u95E8\u4F1A\u8BDD\uFF0C\u4ECA\u5929\u5DF2\u81EA\u52A8\u5EFA\u8FC7\u4E00\u6761" };
      }
      const title = defaultOutTitle(cfg, now);
      const r = await createOutSession(ctx, title);
      if (!r.ok || !r.sid) {
        diag("\u81EA\u52A8\u5EFA\u51FA\u95E8\u4F1A\u8BDD\u5931\u8D25\uFF1A" + r.error);
        return { acted: false, reasons, why: "\u5EFA\u4F1A\u8BDD\u5931\u8D25\uFF1A" + (r.error || "") };
      }
      created = title;
      sid = r.sid;
      saveConfig({ sessionId: sid, sessionTitle: title });
      st.autoCreatedDay = todayKey(now);
      st.autoCreatedId = sid;
      target = findAgentById(ctx, sid);
    }
    const text = buildReminder(reasons, "fun", cfg, Number(em.dims?.curious) || 0);
    let ok = false;
    if (target) ok = deliverTo(target, text, "mo-out-leg");
    if (!ok && sid) ok = await deliverBySessionId(ctx, sid, text);
    if (!ok) {
      diag("\u51FA\u95E8\u63D0\u9192\u6295\u4E0D\u51FA\u53BB\uFF1A" + reasons.join("\u3001"));
      return { acted: false, reasons, why: "\u6295\u9012\u5931\u8D25" };
    }
    st.todayCount += 1;
    st.lastPingAt = now;
    st.history.push({ at: now, reasons: reasons.join("\u3001"), target: sid || "(\u4F1A\u8BDD)", ok: true });
    st.history = st.history.slice(-50);
    saveState(st);
    diag("\u51FA\u95E8\u63D0\u9192\u5DF2\u9001" + (created ? "\uFF08\u65B0\u5EFA\u4F1A\u8BDD " + created + "\uFF09" : "") + "\uFF1A" + reasons.join("\u3001"));
    return { acted: true, reasons, target: sid };
  } catch (e) {
    diag("\u68C0\u67E5\u51FA\u9519\uFF1A" + (e?.message || String(e)));
    return { acted: false, reasons: [], why: "\u51FA\u9519\uFF1A" + (e?.message || "") };
  }
}
export {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  DSH_HOME,
  STATE_PATH,
  STORE,
  STORE as STORE_DIR,
  allSessions,
  apply,
  blankState,
  buildReminder,
  checkOnce,
  coolingDown,
  createOutSession,
  deliverBySessionId,
  deliverTo,
  findAgentById,
  findAgentByTitlePrefix,
  inPeak,
  inWindow,
  inject,
  loadConfig,
  loadState,
  name,
  pickRules,
  readEmotion,
  reasonsOf,
  reportLeg,
  resolveWorkspaceId,
  saveConfig,
  saveState,
  titleFromCache
};
//# sourceMappingURL=index.js.map
