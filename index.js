/**
 * integrity-guard —— 只让 DSH 的默认工作区带 Low 完整性标签
 *
 * 背景：DSH 的沙箱会把会话工作区标成 Low Mandatory Level，标签会继承给整个
 * 目录树。从这些目录里跑出来的 exe 一律是低完整性进程，写不了自己的
 * %TEMP% / %AppData%，于是 7-Zip、NSIS、JetBrains 这类安装器全部报
 * 「写临时文件失败」。桌面、下载这类地方一旦被打上 Low，用户装什么都炸。
 *
 * 这个插件做的事很朴素：启动时扫一遍、会话全部结束后再扫一遍，把不该带
 * Low 的目录改回 Medium。它不阻拦沙箱打标——打标发生在 runner 里，插件
 * 看不到也拦不住；它只负责事后擦干净，并且绝不动正在使用的目录。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect, readLevel, resetToMedium } from './lib/acl.js'
import { expand, unique } from './lib/scan-paths.js'

export const name = 'integrity-guard'
export const inject = ['webServer']

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = path.join(PLUGIN_DIR, 'state.json')
const BRIDGE_PATH = '/integrity-guard/bridge'

/** 启动后等多久做第一次扫描：太早的话 DSH 自己还在建目录。 */
const STARTUP_DELAY_MS = 15_000
/** 检查「会话是不是都结束了」的节拍。 */
const IDLE_TICK_MS = 20_000
/** 每轮最多检查多少个目录，防止第一次跑太久。 */
const ENUM_BUDGET = 400
/** 同时跑多少个 icacls。 */
const CONCURRENCY = 4
/** 保留最近多少条日志。 */
const LOG_LIMIT = 200

// ── 状态 ────────────────────────────────────────────────────

const log = []
let scanning = false
let lastScan = null

function remember(entry) {
  log.push({ at: Date.now(), ...entry })
  if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT)
}

function defaultState() {
  return {
    version: 1,
    enabled: true,
    /** 允许保留 Low 的目录：默认工作区。 */
    allowedRoots: [path.join(os.homedir(), 'Documents', 'deepseek-harness', 'default-workspace')],
    /** 除了用户库以外，额外要扫的根。 */
    extraRoots: [],
    /** 用户库里要扫的子目录名。 */
    homeFolders: ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music'],
    /** 从每个根往下展开几层。 */
    depth: 2,
  }
}

function normalize(p) {
  if (typeof p !== 'string' || !p) return ''
  let out = path.resolve(p)
  if (out.length > 3 && out.endsWith(path.sep)) out = out.slice(0, -1)
  return out.toLowerCase()
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return { ...defaultState(), ...raw }
  } catch {
    return defaultState()
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    remember({ kind: 'error', message: `state.json 写入失败：${error.message}` })
  }
}

// ── 扫描 ────────────────────────────────────────────────────

/** 当前所有会话正开着的目录，这些一律不碰。 */
function activeDirectories(ctx) {
  const out = []
  try {
    const sessions = ctx.get('sessions')
    const list = sessions && sessions.list ? sessions.list() : []
    const wd = ctx.get('workingDirectory')
    for (const session of Array.isArray(list) ? list : []) {
      try {
        const dir = wd && wd.get ? wd.get(session) : ''
        if (typeof dir === 'string' && dir) out.push(normalize(dir))
      } catch {
        // 目录被删之类的情况，跳过这一条。
      }
    }
  } catch {
    // sessions 服务暂时拿不到就当没有活动会话。
  }
  return out
}

function workspaceDirectories(ctx) {
  try {
    const registry = ctx.get('workspaceRegistry')
    const list = registry && registry.list ? registry.list() : []
    return (Array.isArray(list) ? list : [])
      .map((item) => (item && typeof item.path === 'string' ? item.path : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

/** 候选路径：用户库 + 登记过的工作区 + 额外配置的根，展开 depth 层。 */
function candidates(ctx, state) {
  const roots = []
  const home = os.homedir()
  for (const folder of state.homeFolders) roots.push(path.join(home, folder))
  for (const ws of workspaceDirectories(ctx)) roots.push(ws)
  for (const extra of state.extraRoots) roots.push(extra)

  const collected = []
  for (const root of roots) {
    if (collected.length >= ENUM_BUDGET) break
    try {
      if (!fs.statSync(root).isDirectory()) continue
    } catch {
      continue
    }
    collected.push(root)
    collected.push(...expand(root, state.depth, ENUM_BUDGET - collected.length))
  }
  return unique(collected).slice(0, ENUM_BUDGET)
}

/** 这个路径是否属于「不许动」的范围：默认工作区、活动会话目录、插件自己。 */
function protectedPath(target, state, active) {
  const key = normalize(target)
  if (!key) return true
  for (const allowed of [...state.allowedRoots, PLUGIN_DIR]) {
    const base = normalize(allowed)
    if (base && (key === base || key.startsWith(base + path.sep))) return true
  }
  for (const dir of active) {
    if (key === dir || key.startsWith(dir + path.sep) || dir.startsWith(key + path.sep)) return true
  }
  return false
}

async function runPool(items, worker, concurrency = CONCURRENCY) {
  // 别省这个默认值：调用方漏传时 Math.min(undefined, ...) 会得到 NaN，
  // 循环一次都不进，整轮扫描静默跑空。
  const runners = []
  let cursor = 0
  const width = Math.max(1, Math.min(concurrency, items.length))
  for (let i = 0; i < width; i += 1) {
    runners.push((async () => {
      while (cursor < items.length) {
        const current = items[cursor]
        cursor += 1
        await worker(current)
      }
    })())
  }
  await Promise.all(runners)
}

async function scanOnce(ctx, reason) {
  if (scanning) return { skipped: 'busy' }
  const state = loadState()
  if (!state.enabled) return { skipped: 'disabled' }

  scanning = true
  const startedAt = Date.now()
  const active = activeDirectories(ctx)
  const targets = candidates(ctx, state).filter((item) => !protectedPath(item, state, active))
  const fixed = []
  const errors = []
  const levels = { low: 0, medium: 0, high: 0, unknown: 0 }
  const unknownSample = []
  let executed = 0
  let firstError = ''

  try {
    await runPool(targets, async (target) => {
      executed += 1
      const level = await readLevel(target)
      levels[level] = (levels[level] || 0) + 1
      if (level === 'unknown' && unknownSample.length < 5) unknownSample.push(target)
      if (level !== 'low') return
      const result = await resetToMedium(target)
      if (result.ok) {
        fixed.push(target)
        remember({ kind: 'fixed', path: target, reason })
      } else {
        errors.push({ path: target, detail: result.detail })
        remember({ kind: 'error', path: target, message: result.detail })
      }
    })
  } catch (error) {
    firstError = String((error && error.message) || error)
  } finally {
    scanning = false
  }

  lastScan = {
    reason,
    at: Date.now(),
    tookMs: Date.now() - startedAt,
    checked: targets.length,
    executed,
    firstError,
    fixed: fixed.length,
    errors: errors.length,
    levels,
    unknownSample,
  }
  remember({ kind: 'scan', ...lastScan })
  return lastScan
}

// ── 会话计数 ────────────────────────────────────────────────

function activeSessionCount(ctx) {
  try {
    const agents = ctx.get('agents')
    const list = agents && agents.list ? agents.list() : []
    return Array.isArray(list) ? list.length : 0
  } catch {
    return 0
  }
}

// ── HTTP 桥接（给设置页和排查用）────────────────────────────

function isLocal(req) {
  const address = req.socket && req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function snapshot(ctx) {
  const state = loadState()
  return {
    state,
    scanning,
    lastScan,
    activeSessions: activeSessionCount(ctx),
    log: log.slice(-50),
  }
}

function registerBridge(ctx) {
  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => sctx.webServer.register({
      kind: 'exact',
      path: BRIDGE_PATH,
      handler: async (req, res) => {
        if (!isLocal(req)) {
          writeJson(res, 403, { ok: false, error: 'local requests only' })
          return
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: 'POST only' })
          return
        }
        const body = await readJsonBody(req)
        if (!body || typeof body !== 'object') {
          writeJson(res, 400, { ok: false, error: 'malformed JSON body' })
          return
        }
        const action = body.action === undefined ? 'get' : body.action

        if (action === 'get') {
          writeJson(res, 200, { ok: true, ...snapshot(ctx) })
          return
        }
        if (action === 'scan') {
          const result = await scanOnce(ctx, 'manual')
          writeJson(res, 200, { ok: true, result, ...snapshot(ctx) })
          return
        }
        if (action === 'inspect') {
          const target = typeof body.path === 'string' ? body.path : ''
          if (!target) {
            writeJson(res, 400, { ok: false, error: 'path is required' })
            return
          }
          writeJson(res, 200, { ok: true, detail: await inspect(target) })
          return
        }
        if (action === 'set') {
          const state = loadState()
          const patch = body.patch && typeof body.patch === 'object' ? body.patch : {}
          const next = { ...state }
          if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
          if (Array.isArray(patch.allowedRoots)) next.allowedRoots = patch.allowedRoots.filter((x) => typeof x === 'string')
          if (Array.isArray(patch.extraRoots)) next.extraRoots = patch.extraRoots.filter((x) => typeof x === 'string')
          if (Array.isArray(patch.homeFolders)) next.homeFolders = patch.homeFolders.filter((x) => typeof x === 'string')
          if (typeof patch.depth === 'number' && patch.depth >= 0 && patch.depth <= 4) next.depth = Math.floor(patch.depth)
          saveState(next)
          writeJson(res, 200, { ok: true, ...snapshot(ctx) })
          return
        }
        writeJson(res, 400, { ok: false, error: `unknown action "${String(action)}"` })
      },
    }), 'integrity-guard.bridge()')
  })
}

// ── 插件入口 ────────────────────────────────────────────────

export function apply(ctx) {
  registerBridge(ctx)

  // 会话结束是最该擦的时间点：标签是 host 侧 grantWrite 打的，随会话结束不再需要。
  // 事件可能连着来（一个会话会先 disposed agent 再 disposed session），所以合并成一次。
  let debounce = null
  const scheduleIdleScan = (reason) => {
    if (debounce) return
    debounce = setTimeout(() => {
      debounce = null
      scanOnce(ctx, reason).catch((error) => {
        remember({ kind: 'error', message: `${reason} 扫描失败：${error.message}` })
      })
    }, 10_000)
    if (typeof debounce.unref === 'function') debounce.unref()
  }

  for (const event of ['agent/disposed', 'session/disposed']) {
    try {
      ctx.effect(() => ctx.on(event, () => scheduleIdleScan(event)), `integrity-guard.on(${event})`)
    } catch {
      // 这个 DSH 版本没有该事件，回落到下面的轮询。
    }
  }

  const startup = setTimeout(() => {
    scanOnce(ctx, 'startup').catch((error) => {
      remember({ kind: 'error', message: `启动扫描失败：${error.message}` })
    })
  }, STARTUP_DELAY_MS)
  if (typeof startup.unref === 'function') startup.unref()

  let previousCount = null
  const ticker = setInterval(() => {
    const count = activeSessionCount(ctx)
    if (previousCount !== null && previousCount > 0 && count === 0) {
      scanOnce(ctx, 'sessions-idle').catch((error) => {
        remember({ kind: 'error', message: `空闲扫描失败：${error.message}` })
      })
    }
    previousCount = count
  }, IDLE_TICK_MS)
  if (typeof ticker.unref === 'function') ticker.unref()

  ctx.effect(() => () => {
    clearTimeout(startup)
    clearInterval(ticker)
  }, 'integrity-guard.timers()')
}
