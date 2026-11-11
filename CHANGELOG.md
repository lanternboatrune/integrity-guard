# Changelog

## 0.2.0 — 2026-11-11

### Added

- 设置页「完整性守护」：启用/停用守护、扫描深度、用户文件夹勾选、额外扫描根与允许保留 Low 的根增删、立即扫描、最近一次扫描摘要与最近记录。
- 插件图标 `icon.svg`，与中英文名称、描述 `locale/zh.json`、`locale/en.json`。
- `package.json` 暴露 `./client`、`./locale/*.json`、`./icon`，并声明 `dsh.client` 的 settings 注入。

## 0.1.0 — 2026-11-10

### Added

- 启动后扫描、会话全部结束时扫描，用 `icacls /setintegritylevel` 把不该带 Low 的目录擦回 Medium。
- 回环地址上的 `POST /integrity-guard/bridge`，支持 `get` / `scan` / `inspect` / `set`。
