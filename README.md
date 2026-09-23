# Temporary Recorder（临时记录器）

轻量级 Windows 桌面应用，用于临时记录、编辑、格式化文本内容。
定位是「快速打开、随手记录、随时关闭」——不是 IDE，也不是笔记软件。

多标签、自动保存、重启后完整恢复上次的标签与窗口状态；内置 JSON / YAML 格式化；
可以直接打开真实的 `.json` / `.yaml` / `.txt` 文件就地编辑，也可以纯随手记——
新建标签会立刻在临时目录里落一个文件，随时能「另存为」到正式位置。
主题跟随系统（也可手动指定浅色 / 深色）。

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

三张表：`tabs`（标签元数据，含内容所在的文件路径）、`session`（单行，激活标签与窗口几何）、
`settings`（键值对）。schema 版本记录在 `PRAGMA user_version = 2`。

**关于 WAL：** `tauri-plugin-sql` 底层的 sqlx 默认开启 WAL 日志模式，
因此目录下会同时出现 `recorder.db-wal` 与 `recorder.db-shm`。
这是插件的默认行为（并非本项目显式启用），WAL 对写入可靠性与性能都更有利；
读取时用普通 SQLite 客户端即可，会自动合并 WAL。
`.gitignore` 已包含 `*.db-wal` / `*.db-shm`。

## 内容、文件与临时目录

**内容以文件为准，数据库只存元数据。** 每个标签都绑定一个文件（`tabs.file_path`）：

| 标签来源 | 内容落在哪 | `is_temp` |
|---|---|---|
| 新建标签（`Ctrl+N` / `Ctrl+T`） | 临时目录，文件名形如 `未命名 1-3f9a2c8e.txt` | 1 |
| 打开的文件（`Ctrl+O`） | 原文件本身 | 0 |
| 另存为（`Ctrl+Shift+S`） | 用户选定的新路径，并**删除原来的临时文件** | 0 |

- **临时目录**默认是 `%LOCALAPPDATA%\com.temporary.recorder\temp`，
  刻意不用系统 `%TEMP%`——那里会被系统清理工具清掉，草稿就没了。
  可在「设置」里改（改动只影响之后新建的标签，已有标签保持原文件）。
- **关闭临时标签时不会删除它的文件**（这是刻意的：关掉之后内容仍能在临时目录里找回）。
  因此「设置」里提供手动清理，且**只清理没有被任何标签引用的文件**。
- **自动保存**：停止输入约 0.8 秒后写回该标签的文件。
  临时文件总是写；真实文件受「设置 → 打开的文件自动保存」开关约束，
  并且写之前会比对 mtime——若文件已被别的程序改过，就**不覆盖**，改为在状态栏提示，
  此时 `Ctrl+S` 可以强制覆盖。只在真正发生编辑时才触发，单纯打开不会改动文件。
- **换行与编码**：一律写成 **UTF-8 无 BOM + LF**。读入时会去掉 BOM 并把 CRLF/CR 归一为 LF，
  因此用本应用保存过的 CRLF 文件会被转成 LF。非 UTF-8（如 GBK）文件会明确报错，不会产生乱码。
- **写入是原子的**：先写同目录临时文件再改名覆盖，写到一半失败不会把原文件截断。

## 设置（`Ctrl+,` 或状态栏「设置」）

- **主题**：跟随系统 / 浅色 / 深色
- **临时目录**：查看当前生效目录、选择新目录、恢复默认、在资源管理器中打开
- **打开的文件自动保存**：开关
- **临时文件**：显示总数与未被引用的数量，手动清理（删除前二次确认）

## 安装与卸载

当前配置为**全机器安装**（`bundle.windows.nsis.installMode: "perMachine"`）：

- 安装到 `C:\Program Files\Temporary Recorder`
- 开始菜单快捷方式建在 **All Users**
- 注册表登记在 **HKLM**（`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Temporary Recorder`）
- 安装与卸载都**需要管理员权限**，会弹 UAC

静默安装 / 卸载（不带向导页，推荐用这个方式避免误改安装路径）：

```powershell
# 安装（会弹 UAC）
& "src-tauri\target\release\bundle\nsis\Temporary Recorder_0.1.0_x64-setup.exe" /S

# 卸载（会弹 UAC）
& "C:\Program Files\Temporary Recorder\uninstall.exe" /S
```

`bundle.targets` 设为 `["nsis"]` 而非 `"all"`：**MSI 与 NSIS 共用同一个状态键**
`…\Software\temporary\Temporary Recorder`，但两者默认安装位置不同
（MSI 默认 Program Files，NSIS 默认 `%LOCALAPPDATA%`）。同时产出两种安装包时，
先跑 MSI 会把路径记进该键，再跑 NSIS 就会继承 Program Files 却以普通用户权限写入而失败。
只出 NSIS 可以从根上避免这个不一致。

**卸载默认不会删除你的记录。** 卸载向导上的「Delete app data」勾选框默认**不勾**，
只有显式勾选才会删除 `%APPDATA%\com.temporary.recorder`（也就是 `recorder.db`）；
静默卸载 `/S` 不会勾选，因此数据一律保留。

已知的小残留：不勾选「Delete app data」时，`HKLM\Software\temporary` 这个键会留下。
它只记录安装位置与语言，不影响使用，重装时会被复用。
（它同时也是安装程序"记住上次装在哪"的机制 —— 见下方踩坑记录。）

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` / `Ctrl+T` | 新建标签（在临时目录建文件） |
| `Ctrl+O` | 打开文件（已在某标签打开则直接切过去） |
| `Ctrl+S` | 保存（临时标签会转为「另存为」；真实文件强制写盘） |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+,` | 设置 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 下一个 / 上一个标签 |
| `Ctrl+PageDown` / `Ctrl+PageUp` | 同上（备用，部分环境会拦截 Ctrl+Tab） |
| `Ctrl+1` … `Ctrl+9` | 切到第 N 个标签 |
| `Ctrl+F` | 搜索（面板含正则、大小写、全词三个开关） |
| `Ctrl+H` | 替换（与搜索同一个面板，面板本身带替换输入框） |
| `Shift+Alt+F` | 格式化（按内容自动识别 JSON / YAML） |
| `Shift+Alt+M` | 压缩（仅 JSON） |
| `Ctrl+D` | 选下一个相同词（CodeMirror 默认行为） |
| `Alt+Click` | 多光标（CodeMirror 默认行为） |

标签重命名：双击标签名（只改标签显示名，不改文件名）。

## 目录结构

```
src/
├── components/          # TabBar / Editor / StatusBar / Settings
├── stores/              # Zustand：标签元数据、激活标签、设置、状态栏
├── services/            # 数据库、文件 I/O、格式化、会话恢复、窗口几何
├── extensions/          # CodeMirror 集成（editorManager、主题、快捷键、语言、YAML 缩进）
├── utils/               # 纯函数（防抖、换行归一、JSON 错误定位、id）
└── types/               # TypeScript 类型
src-tauri/               # Tauri 外壳（Rust 侧仅插件注册 + 纯 I/O 桥接命令）
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

### 8. 安装程序会把上次的安装路径「钉住」

NSIS 模板里的 `RestorePreviousInstallLocation`（生成的 `installer.nsi`）会读取
`…\Software\temporary\Temporary Recorder` 的默认值，**直接覆盖 `$INSTDIR`**，
其优先级高于安装模式本身的默认位置。

后果：只要该键里存的是 `C:\Program Files\Temporary Recorder`，
那么即使安装包是 `currentUser` 模式（`RequestExecutionLevel user`，不提权），
安装也会被重定向到 Program Files，进而因无写权限报
`Error opening file for writing`。

更麻烦的是这个错误对话框有 Abort / Retry / **Ignore** 三个选项：
点 Ignore 会跳过文件复制、**继续跑完剩余步骤**，于是写入了卸载注册表键与开始菜单快捷方式，
但程序文件一个都没落盘。结果就是「应用和功能」里能看到它，却打不开、也卸载不掉
——因为 `UninstallString` 指向的 `uninstall.exe` 从未被写入。

修复方式：删掉那个残留键值（否则每次安装都会被重新钉住），并把 `installMode`
显式设为 `perMachine`，让安装路径与权限要求一致。
排查这类问题时，要点是分清「注册表里声称装了什么」与「磁盘上实际有什么」。

### 9. WebView2 会抢走 Ctrl+F（此前一直是失效的）

wry 默认把 WebView2 的 `AreBrowserAcceleratorKeysEnabled` 保持为默认值 `true`，
于是 **Ctrl+F / F3 打开的是 WebView2 自带的「页内查找」**，CodeMirror 的搜索面板根本打不开
——自带查找条没有正则 / 大小写 / 全词，也没有替换。
（`Ctrl+N`、`Ctrl+H` 不在被抢的列表里；`Ctrl+P` / `Ctrl+R` / `F12` / 缩放同样会被抢。）

Tauri 的配置项里没有这个开关，只能取底层 COM 接口自行设置：

```rust
// src-tauri/src/lib.rs —— 在 setup 里对主窗口调用
window.with_webview(|webview| unsafe {
    let settings = webview.controller().CoreWebView2()?.Settings()?;
    settings.cast::<ICoreWebView2Settings3>()?
        .SetAreBrowserAcceleratorKeysEnabled(false)?;
})?;
```

注意 `webview2-com` / `windows-core` 的版本必须与 Tauri 依赖树内一致，
否则 `ICoreWebView2*` 类型对不上。因此 `tauri` 固定在次版本 `2.11`——
官方文档也提示 webview2-com 会随 tauri 的次版本变化。

### 10. `lang-yaml` 的缩进在「从零写 YAML」时不生效

JSON 的换行缩进语言包已经提供；YAML 则只在块结构**已经成形**时才给得出缩进。
实测（`runtime/explore-yaml-indent.mjs`）：

```
"key:"                  → 0        回车后是 "key:\n" → null（新行顶格）
"key: value"            → 0        正确，兄弟级
"outer:\n  inner:\n"    → 2        其实应该是 4（inner 的子级）
```

所以补了 `extensions/yamlIndent.ts`：上一行以 `:` 结尾时多缩进一级。

**关键细节**：兜底服务在「不表态」时必须返回 `undefined`，不能返回 `null`——
`getIndentation` 的判断是 `result !== undefined` 才继续问下一个服务，
返回 `null` 会被当成「有意见」而直接返回，把语言自己本来正确的规则一起挡掉。
`runtime/check-indent.mjs` 里有专门守这条的回归用例。

### 11. React StrictMode 会把启动流程跑两遍

开发模式下 `useEffect` 执行两次。启动流程里凡是不幂等的副作用都要留意。
本例对产品代码是安全的（内容迁移与建文件都幂等，带副作用的监听器都在 `cancelled`
检查之后才注册），但如果把一次性自检脚本写成固定文件名，两遍并发就会互相删掉
对方刚写的文件，从而报出**看起来像产品缺陷、实则是脚手架问题**的假故障。
排查这类「现象自相矛盾」的问题，最快的办法是在 Rust 侧加一行日志，
确认到底哪条分支真的执行了（本次就是靠它定位的）。

## 验收辅助脚本（`runtime/`，不提交）

| 脚本 | 作用 |
|------|------|
| `verify-db.mjs` | 表结构、`user_version`、标签顺序、v2 文件落盘、无 CR/BOM、临时目录与孤儿 |
| `check-indent.mjs` | JSON / YAML 换行缩进断言（含「不干扰语言自身规则」的回归用例） |
| `explore-yaml-indent.mjs` | 打印 YAML 在各种上下文下的真实缩进值（定位缺口用） |
| `check-utils.mjs` | 防抖语义（含按标签隔离）、换行归一、大文件阈值、UUID |
| `check-json-error.mjs` | JSON 错误定位与 V8 报错交叉验证 |
| `check-libs.mjs` | js-yaml v5 的 `loadAll` / `dump` 行为核对 |
| `check-perms.mjs` | 列出 `core:window:default` 实际授予的权限 |
| `check-window.ps1` | 枚举应用窗口，输出实际尺寸/位置/可见性 |
| `close-app.ps1` | 向真实窗口发送 `WM_CLOSE`，走一遍正常退出流程 |
| `seed-tabs.mjs` | 写入 3 个标签与指定窗口几何，用于测试会话恢复 |
| `snapshot-tabs.mjs` | 导出 tabs 内容快照，用于迁移前后逐字节比对 |
| `read-setting.mjs` | 读取（或 `--delete` 删除）settings 表里的某一项 |
| `measure-release.ps1` | 量体积、冷启动到窗口可见的耗时、工作集内存 |
| `measure-memory.ps1` | 空闲 30 秒后按 PID 量工作集与私有工作集 |

示例：

```powershell
node runtime/verify-db.mjs
node runtime/check-utils.mjs
node runtime/check-json-error.mjs
```

## 性能实测

在 release 构建（`pnpm tauri build`，LTO 开启）下实测，机器为 96 DPI：

| 指标 | 目标 | 实测 | 结论 |
|------|------|------|------|
| 主程序体积 | < 15 MB | **6.36 MB** | ✅ |
| NSIS 安装包 | — | 2.37 MB | — |
| 冷启动到窗口可见 | < 1.5 s | **0.60 s** | ✅ |
| 空闲内存（应用自身进程） | < 80 MB | **25.6 MB**（私有 3.9 MB） | ✅ |
| 空闲内存（含 WebView2 辅助进程） | < 80 MB | **约 370 MB**（私有约 100 MB） | ❌ 超出 |

**关于内存指标的说明（重要）：**

Tauri 复用系统 WebView2，运行时除应用自身进程外还会拉起 6 个
`msedgewebview2.exe` 辅助进程（浏览器、渲染、GPU、网络、崩溃上报等）。
空闲 30 秒后实测：

```
temporary-recorder      25.6 MB 工作集   3.9 MB 私有
6 x msedgewebview2     344.0 MB 工作集  96.1 MB 私有
合计                   369.6 MB 工作集 100.0 MB 私有
```

也就是说：

- 若「空闲内存」指**应用自身进程**，目标达成且余量很大（25.6 MB）。
- 若指**含 WebView2 全部辅助进程的总和**，则约 100 MB（私有）/ 370 MB（工作集），
  **超出 80 MB 的目标**。

这部分开销来自 WebView2 运行时本身，不是本项目代码造成的：前端产物仅
749 KB（gzip 239 KB），CodeMirror 与 React 都常驻内存但占比很小。
在「Tauri v2 + 系统 WebView2」这一技术选型下（本项目技术栈已定，不得更改），
把含 WebView2 辅助进程的总内存压到 80 MB 以下并不现实。
选择 Tauri 而非 Electron 的收益主要体现在**体积**（6 MB vs 通常 80 MB+）上。

> 说明：工作集（Working Set）会把各进程共享的 DLL 页面重复计入，因此
> 「工作集求和」会明显高估；「私有工作集」是更公平的口径。上表两个口径都已列出。

## 测试现状

已通过自动化手段验证（无需人工点界面）：

- 启动建库、表结构、`PRAGMA user_version = 2`、session 单行
- 首次启动自动创建空白标签；`active_tab_id` 正确回写
- 标签重启后数量/顺序/激活标签/内容完全一致
- **v1 → v2 内容迁移**：迁移前后逐字节比对一致（`snapshot-tabs.mjs`），
  内容确实落到临时目录的文件里、库内内容被清空、孤儿文件为 0
- 窗口几何从数据库恢复，且多次重启不再漂移（inner/outer 配对之后）
- 正常退出路径（`onCloseRequested` → 强制落库 → `destroy()`）干净退出
- 落盘文件为 UTF-8 无 BOM、无 CR；中文标题与内容完好
- **Rust 文件 I/O 命令**真实调用通过：CRLF 归一、BOM 剥离、原子替换写、
  `path_status` / `list_dir` / `delete_file`
  （此项用一次性自检脚本验证，**验证完已删除，从未提交**）
- **应用自定义的 Rust 命令不需要 capability 声明**（Tauri 的 ACL 只管插件命令）
- WebView2 浏览器加速键确实被关闭（启动日志确认整条 COM 调用链成功）
- 格式化所依赖的第三方库行为、JSON 错误定位、防抖与换行归一语义
- JSON / YAML 换行缩进（含 YAML 兜底与「不干扰语言自身规则」的回归用例）

需要人工在界面上确认（无法脚本化）：

- 实际键盘输入后的自动保存（0.8s）与光标/滚动恢复
- 打开 / 保存 / 另存为的对话框流程（其依赖的文件 I/O 与权限已单独验证）
- 标签新建/关闭/重命名/拖拽排序的交互手感、标签栏滚轮横向滚动
- `Ctrl+F` 是否确实弹出 CodeMirror 搜索面板——底层开关已确认关闭，
  但未做按键注入（向活动桌面注入按键会干扰你正在使用的窗口，故未采用）
- 主题跟随系统的观感、设置面板交互
- 输入延迟（< 16ms）的主观体感

## 本机专用配置

`.cargo/config.toml` 配置了 crates.io 镜像（USTC），原因与说明见该文件内注释。
该文件已加入 `.gitignore`，**不会提交**；换到可直接访问 crates.io 的网络时可删除。
