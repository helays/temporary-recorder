# Temporary Recorder（临时记录器）

轻量级 Windows 桌面应用，用于临时记录、编辑、格式化文本内容。
定位是「快速打开、随手记录、随时关闭」——不是 IDE，也不是笔记软件。

多标签、自动保存、重启后完整恢复上次的标签与窗口状态；内置 JSON / YAML 格式化。

## 技术栈

| 层级 | 选型 |
|------|------|
| 桌面外壳 | Tauri v2（复用系统 WebView2，不打包 Chromium） |
| 前端 | React 19 + TypeScript + Vite 8 |
| 编辑器 | CodeMirror 6 |
| 状态管理 | Zustand 5 |
| 本地存储 | SQLite（`tauri-plugin-sql`） |
| 样式 | Tailwind CSS v4 |

## 环境要求

- Node ≥ 20.19，pnpm ≥ 10
- Rust `stable-x86_64-pc-windows-msvc`
- Visual Studio Build Tools（含 MSVC 与 Windows SDK）
- WebView2 Runtime（Windows 10/11 通常已自带）

> **注意：`cargo` 可能不在 `PATH` 中。**
> 本机 Rust 安装在 `%USERPROFILE%\.cargo\bin`，但该目录未必在 `PATH` 里。
> 如果 `pnpm tauri dev` 报找不到 `cargo`，先执行：
>
> ```powershell
> $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
> ```

## 常用命令

```powershell
pnpm install          # 安装前端依赖
pnpm tauri dev        # 开发模式（自动启动 Vite dev server）
pnpm type-check       # TypeScript 类型检查（tsc --noEmit）
pnpm build            # 仅构建前端产物到 dist/
pnpm tauri build      # 打包 release 安装包
```

首次 `pnpm tauri dev` 需要编译约 420 个 crate，冷启动耗时较长（数分钟）属正常现象。

## 数据库

应用启动时自动创建表结构，无需手动初始化。

**实际位置**（由 `tauri-plugin-sql` 按 bundle identifier 解析）：

```
%APPDATA%\com.temporary.recorder\recorder.db
```

本机实测完整路径：

```
C:\Users\helei\AppData\Roaming\com.temporary.recorder\recorder.db
```

三张表：`tabs`（标签元数据 + 内容）、`session`（单行，激活标签与窗口几何）、
`settings`（键值对）。schema 版本记录在 `PRAGMA user_version = 1`。

**关于 WAL：** `tauri-plugin-sql` 底层的 sqlx 默认开启 WAL 日志模式，
因此目录下会同时出现 `recorder.db-wal` 与 `recorder.db-shm`。
这是插件的默认行为（并非本项目显式启用），WAL 对写入可靠性与性能都更有利；
读取时用普通 SQLite 客户端即可，会自动合并 WAL。
`.gitignore` 已包含 `*.db-wal` / `*.db-shm`。

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+T` | 新建标签 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 下一个 / 上一个标签 |
| `Ctrl+PageDown` / `Ctrl+PageUp` | 同上（备用，部分环境会拦截 Ctrl+Tab） |
| `Ctrl+1` … `Ctrl+9` | 切到第 N 个标签 |
| `Ctrl+F` | 搜索（面板含正则、大小写、全词三个开关） |
| `Ctrl+H` | 替换（与搜索同一个面板，面板本身带替换输入框） |
| `Shift+Alt+F` | 格式化（按内容自动识别 JSON / YAML） |
| `Shift+Alt+M` | 压缩（仅 JSON） |
| `Ctrl+S` | 立即落库（把待写入的内容强制写盘） |
| `Ctrl+D` | 选下一个相同词（CodeMirror 默认行为） |
| `Alt+Click` | 多光标（CodeMirror 默认行为） |

标签重命名：双击标签名。

## 目录结构

```
src/
├── components/          # TabBar / Editor / StatusBar
├── stores/              # Zustand：标签元数据、激活标签、设置、状态栏
├── services/            # 数据库封装、格式化、会话恢复、窗口几何
├── extensions/          # CodeMirror 集成（editorManager、主题、快捷键、语言）
├── utils/               # 纯函数（防抖、换行归一、JSON 错误定位、id）
└── types/               # TypeScript 类型
src-tauri/               # Tauri 外壳（Rust 侧仅注册插件，无业务逻辑）
runtime/                 # 临时文件与验收脚本，禁止提交
```

## 实现要点（踩过的坑）

### 1. Tauri v2 权限：默认不给写入能力

两个坑都只在运行时暴露，不看日志很难定位：

- **`sql:default` 只授予 `allow-close` / `allow-load` / `allow-select`**，
  **不含 `allow-execute`**。不显式加上 `sql:allow-execute`，所有写入（自动保存、
  新建/关闭标签）都会失败。已写入 `src-tauri/capabilities/default.json`。
- **`core:window:default` 只授予只读 getter**，不含 `show` / `set-size` /
  `set-position` / `center` / `destroy`。缺了它们，窗口会一直不可见
  （因为配置里是 `visible: false`，靠前端调用 `show()` 才显示），
  窗口几何也无法恢复。已在 capability 中显式补齐。

### 2. SQLite 占位符是 `$1` 而不是 `?`

`tauri-plugin-sql` 经 sqlx 执行，SQLite/Postgres 用 `$1, $2, ...`，只有 MySQL 用 `?`。
用 `?` 会直接报错。另外该插件只暴露 `execute` / `select`，**没有事务 API**，
所以标签排序用单条 `CASE` 语句一次写完，而不是多次往返。

### 3. 窗口几何：inner 与 outer 必须配对

Tauri 的 `setSize()` 设置的是**客户区**尺寸，而 `outerSize()` 读的是含标题栏与边框的
外框尺寸（本机实测相差 16×39）。两者混用会导致**每次重启窗口都按边框尺寸长大一圈**。
现在统一为 `innerSize()` 采集 + `setSize()` 恢复，位置则用
`outerPosition()` + `setPosition()` 配对，并存逻辑像素以免 DPI 变化后错位。

### 4. 自动保存：防抖器必须按标签隔离

内容保存、光标/滚动、窗口几何分别有 800ms / 1s / 500ms 的防抖。
关键点是：**每个标签各自持有一个防抖器，闭包捕获自己的 `tabId`，落库时再从该标签的
`EditorState` 读取内容**。若全局共用一个防抖器，用户「在 A 输入后立刻切到 B」时，
A 的待保存内容会被 B 的内容覆盖。

### 5. CodeMirror 不允许在 updateListener 里 dispatch

大文件降级要动态卸载语言扩展，但 `updateListener` 内不能再次 `dispatch`
（CodeMirror 会抛「update in progress」），因此把重新配置推迟到本次更新之后。

### 6. 新版 V8 不再给 JSON 错误位置

对 `Unexpected token` 这类最常见错误，V8 现在只输出出错片段
（`Unexpected token ',', ..."片段"... is not valid JSON`），不再提供
`position` / `line` / `column`。为了满足「显示错误位置」的要求，
`src/utils/jsonError.ts` 实现了一个只做结构校验的轻量定位器，
仅在 `JSON.parse` 失败后运行。它已与 V8 自身的报错做过交叉验证
（见 `runtime/check-json-error.mjs`）。

### 7. `runtime/` 下的 `.ps1` 必须只用 ASCII

PowerShell 读取无 BOM 的脚本文件时按系统代码页解码，UTF-8 中文会变乱码，
且可能产生破坏字符串结束符的字节（本项目实际踩到过）。
因此 `runtime/*.ps1` 刻意只写英文；`.mjs` 由 Node 按 UTF-8 读取，可正常使用中文。

## 验收辅助脚本（`runtime/`，不提交）

| 脚本 | 作用 |
|------|------|
| `verify-db.mjs` | 检查表结构、`user_version`、标签顺序、内容无 CR、窗口几何 |
| `check-json-error.mjs` | JSON 错误定位与 V8 报错交叉验证 |
| `check-utils.mjs` | 防抖语义（含按标签隔离）、换行归一、大文件阈值、UUID |
| `check-libs.mjs` | js-yaml v5 的 `loadAll` / `dump` 行为核对 |
| `check-perms.mjs` | 列出 `core:window:default` 实际授予的权限 |
| `check-window.ps1` | 枚举应用窗口，输出实际尺寸/位置/可见性 |
| `close-app.ps1` | 向真实窗口发送 `WM_CLOSE`，走一遍正常退出流程 |
| `seed-tabs.mjs` | 写入 3 个标签与指定窗口几何，用于测试会话恢复 |

示例：

```powershell
node runtime/verify-db.mjs
node runtime/check-utils.mjs
node runtime/check-json-error.mjs
```

## 测试现状

已通过自动化手段验证（无需人工点界面）：

- 启动建库、表结构、`PRAGMA user_version = 1`、session 单行
- 首次启动自动创建空白标签；`active_tab_id` 正确回写
- 3 个标签重启后数量/顺序/激活标签/内容完全一致
- 窗口几何从数据库恢复（1000×700 @ 120,90），且多次重启不再漂移
- 正常退出路径（`onCloseRequested` → 强制落库 → `destroy()`）干净退出
- 存库内容为 UTF-8 且无 CR；中文标题与内容完好
- 格式化逻辑所依赖的第三方库行为、JSON 错误定位、防抖与换行归一语义

需要人工在界面上确认（无法脚本化）：

- 实际键盘输入后的 800ms 自动保存与光标/滚动恢复
- 标签新建/关闭/重命名/拖拽排序的交互手感
- 格式化与压缩按钮、`Ctrl+F` / `Ctrl+H` 搜索面板、`Alt+Click` 多光标
- release 构建下的空闲内存与冷启动耗时

## 本机专用配置

`.cargo/config.toml` 配置了 crates.io 镜像（USTC），原因与说明见该文件内注释。
该文件已加入 `.gitignore`，**不会提交**；换到可直接访问 crates.io 的网络时可删除。
