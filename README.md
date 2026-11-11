# integrity-guard

让 Low 完整性标签只停留在 DSH 的默认工作区里，别的地方一旦沾上就自动擦回 Medium。

## 为什么需要它

DSH 的 Windows 沙箱会把会话工作区标成 `Mandatory Label\Low Mandatory Level`。Windows 的规则是
**进程完整性 = min(令牌级别, 映像文件级别)**，所以从带标签的目录里启动的 exe 会变成低完整性进程，
写不了自己的 `%TEMP%` 和 `%AppData%`。表现就是一串莫名其妙的错误：

- 7-Zip 自解压包：`Can not create temp folder archive`
- NSIS 安装器：`Error writing temporary file. Make sure your temp folder is valid.`
- JetBrains 系：`java.nio.file.AccessDeniedException: C:\Users\<你>\AppData\Roaming\...`

标签还会随目录继承。所以只要桌面或下载被当成工作区开过一次，那里下载的所有安装包都会中招，
哪怕后来换到别的目录去装也一样。

## 它做什么

1. 插件启动 15 秒后扫一遍；
2. 所有会话都结束（活动会话数从 >0 掉到 0）时再扫一遍；
3. 扫到不该带 Low 的目录，就 `icacls <dir> /setintegritylevel (OI)(CI)M` 改回 Medium。

它**不阻拦**打标——打标发生在沙箱 runner 里，插件拿不到那个时机；它只负责事后擦干净。

## 它不做什么

- 不动默认工作区（否则 agent 自己就写不进去了）；
- 不动任何**正在被会话使用**的目录，包括它们的子目录和父目录；
- 不跟符号链接 / junction，不扫 `AppData`、`Windows`、`Program Files`、`node_modules` 这类地方。

## 设置页

插件在设置页注册一页「完整性守护」：

- **守护**：总开关。关掉后自动扫描停止，手动扫描也跳过。
- **扫描深度**：0–4，每个根往下展开几层。
- **用户文件夹**：桌面、文档、下载、图片、视频、音乐，勾选即纳入扫描。
- **额外扫描的目录**：除用户文件夹与已登记工作区之外还想检查的根目录。
- **允许保留 Low 的目录**：默认工作区在列表里；加进来的目录一律不动。
- **状态**：活动会话数、最近一次扫描的检查数/修复数/失败数与耗时，以及「立即扫描」。

改动即时写回 `state.json`，不需要重启。这几个字段和下面的配置文件一一对应。

## 配置

首次运行会在插件目录生成 `state.json`：

```json
{
  "version": 1,
  "enabled": true,
  "allowedRoots": ["C:\\Users\\<你>\\Documents\\deepseek-harness\\default-workspace"],
  "extraRoots": [],
  "homeFolders": ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"],
  "depth": 2
}
```

- `allowedRoots`：允许保留 Low 的目录，默认就是默认工作区；
- `extraRoots`：想额外保护/扫描的根目录，比如 `D:\\Projects`；
- `homeFolders`：从用户目录下展开哪些子目录；
- `depth`：每个根往下展开几层，0–4。

## HTTP 桥接

回环地址上的 `POST /integrity-guard/bridge`，JSON body：

| body | 作用 |
|---|---|
| `{"action":"get"}` | 读配置、最近一次扫描结果、活动会话数、最近 50 条日志 |
| `{"action":"scan"}` | 立刻扫一次 |
| `{"action":"inspect","path":"..."}` | 单查一个路径：`icacls` 的原始输出、判定结果、错误 |
| `{"action":"set","patch":{...}}` | 改配置，字段同 `state.json` |

只接受 `127.0.0.1` / `::1` 的请求。

## 局限

- 扫描是「事后修复」，不是预防。如果某个目录正被会话用着，这轮不会动它，等会话结束才擦。
- `icacls` 一次只能处理一个路径，单次约 80 ms，所以默认把每轮候选目录限制在 400 个以内。
- 只支持 Windows；其他平台上 `icacls` 不存在，`readLevel` 会返回 `unknown`，插件等于空转。
