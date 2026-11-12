# Changelog

## 0.2.1 — 2026-11-12

### Fixed

- 失败日志改为「路径 + 原因」两行，原因从 icacls 输出里挑含 `Access is denied` 的行，不再只显示 `Successfully processed 0 files` 这类计数行。
- 最近一次扫描有失败时，状态区显示提示：改回 Medium 需要管理员权限，普通权限下会被系统拒绝访问。

## 0.2.0 — 2026-11-11

### Added

- 设置页「完整性守护」：启用/停用守护、扫描深度、用户文件夹勾选、额外扫描根与允许保留 Low 的根增删、立即扫描、最近一次扫描摘要与最近记录。
- 插件图标 `icon.svg`，与中英文名称、描述 `locale/zh.json`、`locale/en.json`。
- `package.json` 暴露 `./client`、`./locale/*.json`、`./icon`，并声明 `dsh.client` 的 settings 注入。

## 0.1.0 — 2026-11-10

### Added

- 启动后扫描、会话全部结束时扫描，用 `icacls /setintegritylevel` 把不该带 Low 的目录擦回 Medium。
- 回环地址上的 `POST /integrity-guard/bridge`，支持 `get` / `scan` / `inspect` / `set`。
