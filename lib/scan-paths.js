/**
 * 候选目录枚举
 *
 * 目的不是「扫遍整块盘」，而是覆盖 DSH 有可能打上 Low 标签的地方：
 *   1. DSH 自己登记过的工作区（workspaceRegistry）——把桌面设成工作区就是这么来的；
 *   2. 用户库里常见的输出位置（桌面、文档、下载……）；
 *   3. 每个盘符的第一层目录，慢慢扩到可配置的深度。
 *
 * 一旦某个目录已经是 Low，就整棵子树都受影响了（标签会继承），
 * 所以命中后不再往下走，省掉大量 icacls 调用。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 这些目录要么太大、要么是系统自己的，扫了没有意义。 */
const SKIP_NAMES = new Set([
  'AppData', '.dsh', 'node_modules', '.git', '.cache', '$RECYCLE.BIN',
  'System Volume Information', 'Windows', 'Program Files', 'Program Files (x86)',
  'ProgramData', '$WinREAgent', 'Recovery', 'Config.Msi', 'Documents and Settings',
])

/**
 * 展开一个根目录下的候选子目录。
 * @param {string} root
 * @param {number} depth 还要往下走几层；0 表示只看 root 自己
 * @param {number} budget 剩余可返回数量上限
 * @returns {string[]}
 */
export function expand(root, depth, budget) {
  const out = []
  if (!root || budget <= 0) return out
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (out.length >= budget) break
    if (!entry.isDirectory()) continue
    if (SKIP_NAMES.has(entry.name)) continue
    const full = path.join(root, entry.name)
    let stat
    try {
      stat = fs.lstatSync(full)
    } catch {
      continue
    }
    // 重解析点（符号链接、junction）不跟，避免跑出预期范围或绕圈。
    if (stat.isSymbolicLink()) continue
    out.push(full)
    if (depth > 1 && out.length < budget) out.push(...expand(full, depth - 1, budget - out.length))
  }
  return out
}

/** 把候选路径去重并归一化，顺序保持不变。 */
export function unique(paths) {
  const seen = new Set()
  const out = []
  for (const item of paths) {
    if (typeof item !== 'string' || !item) continue
    const key = path.resolve(item).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path.resolve(item))
  }
  return out
}
