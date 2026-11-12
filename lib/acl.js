/**
 * Windows 完整性级别（Mandatory Label）读写工具
 *
 * DSH 的沙箱会把「可写目录」标成 Low Mandatory Level，从这些目录里启动的
 * 程序会被 Windows 降为低完整性进程，写不了自己的 %TEMP% / %AppData%。
 * 这里只做两件事：读某个目录当前的标签、把它改回 Medium。
 *
 * 读标签用 icacls：普通用户读不了 SACL，但 icacls 打印标签不需要特权。
 * 标签是本地化的，所以英文名和中文名都要认；认不出来就当未知，不当作 Low。
 */
import { execFile } from 'node:child_process'

const LOW_PATTERNS = [/Low Mandatory Level/i, /低强制级别/, /低完整性级别/, /低完整性/]
const MEDIUM_PATTERNS = [/Medium Mandatory Level/i, /中强制级别/, /中完整性级别/, /中完整性/]

/** icacls 单次调用超时，避免某个被锁住的重解析点把整轮扫描拖死。 */
const ICACLS_TIMEOUT_MS = 8000

function run(args) {
  return new Promise((resolve) => {
    execFile('icacls', args, { windowsHide: true, timeout: ICACLS_TIMEOUT_MS }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === 'number' ? error.code : 0,
        text: String(stdout || '') + String(stderr || ''),
        error: error ? String(error.message || error) : '',
      })
    })
  })
}

/**
 * 排查用：把 icacls 的原始输出和错误一起抛出来。
 * @returns {Promise<{level: string, text: string, error: string}>}
 */
export async function inspect(path) {
  const result = await run([path])
  return { level: classify(result.text), text: result.text, error: result.error }
}

function classify(text) {
  if (!text) return 'unknown'
  if (LOW_PATTERNS.some((re) => re.test(text))) return 'low'
  if (MEDIUM_PATTERNS.some((re) => re.test(text))) return 'medium'
  if (/High Mandatory Level|高强制级别/i.test(text)) return 'high'
  return 'unknown'
}

/**
 * 读一个路径的完整性级别。
 * @returns {Promise<'low'|'medium'|'high'|'unknown'>}
 */
export async function readLevel(path) {
  const { text } = await run([path])
  return classify(text)
}

/**
 * 把路径改回 Medium。子对象一并继承，所以对一个已被标 Low 的目录树来说，
 * 只改根就够；这里仍然给 (OI)(CI) 让它往下传。
 *
 * 普通权限下 icacls 会先打印「Successfully processed 0 files; Failed processing 1 files」，
 * 真正的拒绝原因在下一行。取包含 denied 的那一行，避免日志里只有计数。
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export async function resetToMedium(path) {
  const { ok, code, text } = await run([path, '/setintegritylevel', '(OI)(CI)M'])
  return { ok, detail: ok ? 'ok' : `exit ${code}: ${reasonOf(text)}` }
}

function reasonOf(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const denied = lines.find((line) => /access is denied|拒绝访问|denied/i.test(line))
  return denied || lines[0] || 'unknown error'
}
