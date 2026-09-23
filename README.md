# 闪记

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-000000?style=flat-square&logo=rust&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)
![TypeScript 6](https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript&logoColor=white)
![CodeMirror 6](https://img.shields.io/badge/CodeMirror-6-B483F3?style=flat-square&logo=codemirror&logoColor=white)

> 仓库目录名与 Cargo 包名仍是 `Temporary-recorder` / `temporary-recorder`（见下方
> 「关于名称」）。用户可见的产品名是**闪记**。

轻量级 Windows 桌面应用，用于临时记录、编辑、格式化文本内容。
定位是「快速打开、随手记录、随时关闭」——不是 IDE，也不是笔记软件。

多标签、自动保存、重启后完整恢复上次的标签与窗口状态；内置 JSON / YAML 格式化；
可以直接打开真实的 `.json` / `.yaml` / `.txt` 文件就地编辑，也可以纯随手记——
新建标签会立刻在临时目录里落一个文件，随时能「另存为」到正式位置。
主题跟随系统（也可手动指定浅色 / 深色）。
窗口是无边框的，顶部只有一行「图标 + 菜单 + 窗口按钮」（VS Code 那种形态），
标签栏是矮胶囊样式、标签之间没有分割线。

**打开文件的方式**（三条入口等价，都汇总到同一个 `openPathIntoNewTab`）：

1. 顶部标题栏 **文件 ▸ 打开…**
2. **把文件拖进窗口**（支持一次拖多个；拖拽时窗口中央会出现「松开即可打开 N 个文件」）
3. 快捷键 `Ctrl+O`

### 关于名称

| 名字 | 值 | 说明 |
|---|---|---|
| 产品名 `productName` | **闪记** | 窗口标题、安装目录、开始菜单、应用和功能里显示的名字 |
| bundle identifier | `com.temporary.recorder` | **刻意不改**：数据库与临时目录的路径由它决定，改了已有笔记会看起来丢失 |
| Cargo 包名 / 可执行文件名 | `temporary-recorder` | 保持 ASCII：中文出现在构建工具链的输出路径里风险更大，且不影响任何可见处 |
| npm 包名 | `temporary-recorder` | npm 不允许非 ASCII 包名；它本来也不面向用户 |

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
> Rust 通常安装在 `%USERPROFILE%\.cargo\bin`，但该目录未必在 `PATH` 里。
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

## 设置（`Ctrl+,` 或顶部菜单 设置 ▸ 打开设置…）

- **主题**：跟随系统 / 浅色 / 深色
- **临时目录**：查看当前生效目录、选择新目录、恢复默认、在资源管理器中打开
- **打开的文件自动保存**：开关
- **临时文件**：显示总数与未被引用的数量，手动清理（删除前二次确认）

## 窗口与菜单栏

窗口是**无边框**的（`tauri.conf.json` 里 `decorations: false`），顶部只有**一行**自绘标题栏，
形态与 VS Code 一致：

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚡  文件 设置 编辑 查看 帮助                        ─    □    ✕       │ 32px 标题行
├──────────────────────────────────────────────────────────────────────┤
│  标签甲 ×  未命名 2 ×  +                                            │ 28px 标签栏
├──────────────────────────────────────────────────────────────────────┤
│  1  {                                                                │ 编辑器
├──────────────────────────────────────────────────────────────────────┤
│ 行 3, 列 1 · JSON · 27 字符              格式化  压缩                │ 状态栏
└──────────────────────────────────────────────────────────────────────┘
```

| 菜单 | 内容 |
|---|---|
| 文件 | 新建标签 `Ctrl+N`、打开… `Ctrl+O`、保存 `Ctrl+S`、另存为… `Ctrl+Shift+S`、关闭当前标签 `Ctrl+W`、退出 |
| 设置 | 打开设置… `Ctrl+,`、在资源管理器中打开临时目录、清理未使用的临时文件 |
| 编辑 | 撤销 `Ctrl+Z`、重做 `Ctrl+Shift+Z`、剪切 / 复制 / 粘贴、全选 `Ctrl+A`、查找 `Ctrl+F`、替换 `Ctrl+H` |
| 查看 | 格式化 `Shift+Alt+F`、压缩 JSON `Shift+Alt+M`、主题 ▸ 跟随系统 / 浅色 / 深色（带勾选） |
| 帮助 | 关于 闪记、在资源管理器中打开数据目录 |

### 为什么菜单不是「原生菜单栏」了

**因为原生菜单栏做不到「图标 + 菜单 + 窗口按钮同一行」。** 实测过：Windows 的原生菜单栏
是系统画在标题栏下沿的一条独立横条（19px 高，占满整宽），它无法与图标、最小化/最大化/关闭
共处一行。VS Code 的菜单同样是自绘的。所以这里把菜单换成了自绘实现
（`src/services/menu.ts` 只产出菜单数据，`src/components/TitleBar/` 负责渲染与交互）。

代价与收益：

- **失去 Win11「贴靠布局」**（鼠标悬停在最大化按钮上弹出布局选择）。
  `Win+Z`、`Win+←/→` 仍然可用。
- **保留阴影、Win11 圆角、四条边拖拽缩放、双击标题栏最大化**——这些都由 tao 提供，
  不需要第三方插件。原理见「踩坑 #14」。
- 工具栏少了一行：原先 = 标题栏 31px + 菜单栏 19px，现在 = 一行 32px。

### 三处刻意的实现选择

- **撤销 / 重做 / 全选调 CodeMirror 自己的命令**，而不是浏览器的原生行为——
  原生 Undo 不认 CodeMirror 的历史栈，会变成空操作。
- **剪切 / 复制 / 粘贴走官方剪贴板插件**，而不是 `navigator.clipboard`：
  WebView2 对 `clipboard-read` 的默认处理不可靠，会直接拒绝。
- **退出走 `getCurrentWindow().close()`**：`close()` 会触发 `onCloseRequested`，
  退出前的强制落盘（`flushAll` + 写激活标签 + 写窗口几何）才不会被跳过。

## 安装与卸载

当前配置为**全机器安装**（`bundle.windows.nsis.installMode: "perMachine"`）：

- 安装到 `C:\Program Files\闪记`
- 开始菜单快捷方式建在 **All Users**
- 注册表登记在 **HKLM**（`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\闪记`）
- 安装与卸载都**需要管理员权限**，会弹 UAC

静默安装 / 卸载（不带向导页，推荐用这个方式避免误改安装路径）：

```powershell
# 安装（会弹 UAC）
& "src-tauri\target\release\bundle\nsis\闪记_0.1.0_x64-setup.exe" /S

# 卸载（会弹 UAC）
& "C:\Program Files\闪记\uninstall.exe" /S
```

> 从旧名（`Temporary Recorder`）升上来时，**必须先卸载旧版**：
> 两者是不同的产品名，安装程序不会互相覆盖，否则「应用和功能」里会同时出现两条、
> `Program Files` 下留两份。

`bundle.targets` 设为 `["nsis"]` 而非 `"all"`：**MSI 与 NSIS 共用同一个状态键**
`…\Software\temporary\闪记`，但两者默认安装位置不同
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

下面这些大多同时出现在顶部菜单里（菜单项右侧会显示对应按键）。

按键有**两条**处理路径，按设计互为兜底：

1. **CodeMirror 的 keymap**（`src/extensions/keymap.ts`）——焦点在编辑器里时走这条。
2. **窗口级监听**（`src/services/shortcuts.ts`）——焦点在标签栏 / 状态栏 / 按钮上时走这条。

两者不会重复触发：CodeMirror 处理过的按键会 `preventDefault()`，窗口级监听看到
`event.defaultPrevented` 就直接跳过。这也是自绘菜单取代原生菜单栏后必须补的一层——
原生菜单栏的加速键是窗口级的，自绘菜单没有这个能力。

| 快捷键 | 功能 |
|--------|------|
| 拖入文件 | 打开文件（可一次拖多个；拖拽时窗口中央出现提示） |
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

其它界面操作：

- 标签重命名：双击标签名（只改标签显示名，不改文件名）
- 移动窗口：拖动标题栏空白处；**双击标题栏空白处**最大化 / 还原
- 缩放窗口：拖四条边或四个角（无边框但保留了缩放边框，见踩坑 #14）
- 菜单键盘操作：`←` / `→` 换顶级菜单，`↑` / `↓` 移动高亮，`Enter` 执行，`Esc` 关闭

## 目录结构

```
src/
├── components/          # TitleBar（标题行 + 菜单 + 窗口按钮）/ TabBar / Editor
│                        # StatusBar / Settings / About / DropOverlay
├── stores/              # Zustand：标签元数据、激活标签、设置、状态栏
├── services/            # 数据库、文件 I/O、格式化、会话恢复、窗口几何、
│                        # 菜单数据（menu.ts）、剪贴板（clipboard.ts）、
│                        # 窗口级快捷键（shortcuts.ts）、临时文件清理（tempCleanup.ts）
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
外框尺寸（实测相差 16×39）。两者混用会导致**每次重启窗口都按边框尺寸长大一圈**。
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
`…\Software\temporary\<产品名>`（当前即 `…\Software\temporary\闪记`）的默认值，
**直接覆盖 `$INSTDIR`**，其优先级高于安装模式本身的默认位置。

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

**改产品名时这个键会跟着变**：从 `Temporary Recorder` 改名为 `闪记` 之后，
旧键 `…\temporary\Temporary Recorder` 不会自动消失，新安装写的是 `…\temporary\闪记`。
两者不相干，所以重命名必须**先卸载旧版**、再装新版，并顺手删掉旧键
（`runtime/reinstall-elevated.ps1` 把这些串成一次提权完成，只弹一次 UAC）。

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

### 12. `dragDropEnabled` 默认是 `true`，且会关掉网页自己的拖放

`tauri.conf.json` 里没写 `dragDropEnabled`，而它的默认值就是 **`true`**：
Windows 上的文件拖放由 Tauri/wry 接管，前端只需监听
`getCurrentWebview().onDragDropEvent()`。两个直接后果：

- **WebView 里的 HTML5 拖放（DOM `drop` 事件）会被禁用**。所以标签拖拽排序
  必须用指针事件实现——本项目用的 dnd-kit `PointerSensor` 正好不受影响，
  但要是当初用了 `HTML5Backend`，加「拖放打开文件」就会把标签排序一起搞坏。
- **ACL 里根本没有拖放相关的权限项**，capability 不需要改（拖放事件属于核心能力，
  不是插件命令）。

另外 `over` 事件只带坐标、且拖拽期间持续高频触发，所以遮罩只在
`enter` / `leave` / `drop` 时更新状态，`over` 一次 `setState` 都不做。

### 13. 自绘菜单取代原生菜单栏后，快捷键必须自己补一层

早期版本用的是 Windows 原生菜单栏。原生菜单的加速键由系统在**窗口层**处理，
所以焦点在哪都能用。换成自绘菜单后这个能力没有了：`Ctrl+N` / `Ctrl+O` / `Ctrl+S` 等
只剩 CodeMirror 的 keymap 一条路径，焦点一旦离开编辑器（点了标签栏、状态栏按钮）就失效。

补法是**两层**而不是替换：保留 CodeMirror keymap（编辑器内优先），再加一个窗口级
`keydown` 监听，并且用 `event.defaultPrevented` 判断——CodeMirror 处理过的按键会
`preventDefault()`，窗口级监听看到就直接跳过，不会执行两次。

另外两条经验：

- 撤销 / 重做 / 全选必须调 `@codemirror/commands` 的 `undo` / `redo` / `selectAll`。
  用浏览器的原生行为会与 CodeMirror 的历史栈脱节，撤销会变成空操作。
- 剪切 / 复制 / 粘贴**不能**用 `navigator.clipboard`：WebView2 对 `clipboard-read`
  的默认处理不可靠（会直接拒绝）。见 #15。

排查菜单问题还有个实用手段：WebView 的 `console.*` **不会**出现在终端里，
所以「菜单到底建出来没有」不能靠日志确认——直接问 Windows 要窗口的 `HMENU`
（`runtime/check-menu.ps1`），或者把窗口渲染成字符画看布局（`runtime/check-layout.ps1`）。

### 14. 无边框窗口：`decorations: false` 不等于「裸窗」

要「图标 + 菜单 + 窗口按钮同一行」，就必须去掉 Windows 标题栏。这时常见的担心是
「无边框会不会连阴影、圆角和拖边缩放都一起没了」。**在 Tauri v2 / tao 0.35 上不会**，
但原因不明显，值得记下来——它决定了两件事能不能省：

- tao 处理无边框的方式不是抹掉窗口样式，而是**保留 `WS_CAPTION` / `WS_THICKFRAME`，
  只在 `WM_NCCALCSIZE` 里返回一个内缩的客户区**，内缩量 =
  `SM_CXSIZEFRAME + SM_CXPADDEDBORDER`（96 DPI 下 8px），顶部在 Win11 上是
  `round(dpi/96)`（96 DPI 下 1px，注释里写明「顶边留 0 会让最上面 1-2 行像素被遮住」）。
  于是 DWM 依然画阴影与圆角，左右下三边依然能被 `DefWindowProc` 命中为缩放边框。
- **顶边**因为只有 1px，tao 自己在 `WM_NCHITTEST` 里补了一个 `HTTOP`。
  也就是说四条边都能拖拽缩放，不需要社区插件。

实测（`runtime/check-chrome.ps1`，与 tao 源码推出的数字一致）：

```
window rect  916x659      （改之前 916x709，少的 50px = 标题栏 31 + 原生菜单 19）
client rect  900x650      （完全没变 —— 内容区尺寸不受影响，不会重排）
frame insets left=8 top=1 right=8 bottom=8
WS_THICKFRAME  True       GetMenu  NULL
```

代价只有一个：**失去 Win11「贴靠布局」**（悬停最大化按钮弹出的布局选择），
因为那个按钮现在是自绘的。`Win+Z` 与 `Win+←/→` 仍然可用。

### 15. 剪贴板插件的默认权限集是**空的**

`tauri-plugin-clipboard-manager` 的 `permissions/default.toml` 里
`permissions = []`，注释说明理由是「剪贴板本身有风险，读写应当由应用显式决定」。
所以 `capabilities/default.json` 里的 `clipboard-manager:default` 等于什么都没给，
必须显式写：

```
clipboard-manager:allow-read-text
clipboard-manager:allow-write-text
```

写错或漏写的后果是运行期才暴露（调用被 ACL 拒绝）。好消息是**权限标识符写错会在构建期
就被 tauri-build 拦下**（它会拿插件清单校验 capability），所以这类错误不会悄悄溜到运行时。

### 16. `data-tauri-drag-region` 的三个细节

自绘标题栏的拖动靠 Tauri 注入的脚本（`src/window/scripts/drag.js`），有三点不查源码就容易踩：

- 属性值有**语义差别**：裸写 / `"true"` = 只有点到该元素本身才拖；
  **`"deep"` = 子树内任意位置都能拖**；`"false"` = 这里禁止拖（并向上屏蔽）。
  标题栏整行用 `deep` 最省事。
- **`<button>` / `<a>` / `role="menuitem"` 等可点元素会自动阻断拖动**，
  所以菜单按钮和窗口按钮不用额外处理；但反过来说，**菜单下拉面板必须显式写
  `data-tauri-drag-region="false"`**，否则点面板的空白处会把窗口拖走。
- **双击拖动区切换最大化是脚本自带的**（`e.detail === 2` 时发
  `internal_toggle_maximize`），不需要自己写 `onDoubleClick`。

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
| `check-menu.ps1` | 从窗口的 `HMENU` 读回原生菜单栏结构与每一项文字（验证原生菜单已移除 / 是否还在） |
| `check-chrome.ps1` | 量窗口外壳：标题栏是否还在、原生菜单是否存在、非客户区 insets、`WS_THICKFRAME` 是否仍可缩放 |
| `check-layout.ps1` | 把窗口渲染成字符画（`PrintWindow` + 降采样），用于在看不到画面的情况下核对布局 |
| `check-tabbar.ps1` | 标签栏高度、全高分割线数量、任一行内最长竖直线段、胶囊轮廓包围盒 |
| `make-icon.ps1` | 生成 `icon-source.png`（1024 圆角蓝底 + 白色闪电），供 `pnpm tauri icon` 使用 |
| `reinstall-elevated.ps1` | 提权执行：静默卸载旧名安装 → 清理残留（目录/快捷方式/注册表）→ 静默安装新版 |
| `run-elevated.ps1` | 上面那个脚本的包装器：提权进程有自己的控制台，输出要靠它重定向进 `reinstall.log` |
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

# 界面与窗口（会短暂启动一次应用，看完自己关掉）
& .\runtime\check-chrome.ps1      # 标题栏 / 原生菜单 / 缩放边框
& .\runtime\check-tabbar.ps1      # 标签栏高度与分割线
& .\runtime\check-layout.ps1      # 把窗口渲染成字符画看布局
```

## 性能实测

在 release 构建（`pnpm tauri build`，LTO 开启）下实测，测试环境：96 DPI：

| 指标 | 目标 | 实测 | 结论 |
|------|------|------|------|
| 主程序体积 | < 15 MB | **6.65 MB** | ✅ |
| NSIS 安装包 | — | 2.48 MB | — |
| 冷启动到窗口可见 | < 1.5 s | **0.50 s** | ✅ |
| 空闲内存（应用自身进程） | < 80 MB | **25.9 MB** | ✅ |
| 空闲内存（含 WebView2 辅助进程） | < 80 MB | **约 364 MB** | ❌ 超出 |

体积比上一版略增（6.34 → 6.65 MB，安装包 2.36 → 2.48 MB），来自为自绘菜单引入的
剪贴板插件；标题行与标签栏改成自绘后前端产物只增加约 1 KB。

**关于内存指标的说明（重要）：**

Tauri 复用系统 WebView2，运行时除应用自身进程外还会拉起 6 个
`msedgewebview2.exe` 辅助进程（浏览器、渲染、GPU、网络、崩溃上报等）。
启动 8 秒后实测：

```
temporary-recorder      25.9 MB 工作集
6 x msedgewebview2     338.0 MB 工作集
合计                   363.9 MB 工作集
```

也就是说：

- 若「空闲内存」指**应用自身进程**，目标达成且余量很大（27 MB）。
- 若指**含 WebView2 全部辅助进程的总和**，则约 359 MB，**超出 80 MB 的目标**。

这部分开销来自 WebView2 运行时本身，不是本项目代码造成的：前端产物仅
772 KB（JS 752 KB + CSS 15 KB + 图标 5 KB），CodeMirror 与 React 都常驻内存但占比很小。
在「Tauri v2 + 系统 WebView2」这一技术选型下（本项目技术栈已定，不得更改），
把含 WebView2 辅助进程的总内存压到 80 MB 以下并不现实。
选择 Tauri 而非 Electron 的收益主要体现在**体积**（6 MB vs 通常 80 MB+）上。

> 说明：工作集（Working Set）会把各进程共享的 DLL 页面重复计入，因此
> 「工作集求和」会明显高估；「私有工作集」是更公平的口径。
> 更早一次按 PID 分口径的测量（`measure-memory.ps1`）为：应用自身
> 25.6 MB 工作集 / 3.9 MB 私有，WebView2 六进程合计 344.0 MB 工作集 /
> 96.1 MB 私有。

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
- ~~原生菜单栏真的建出来了~~ → **已改为自绘菜单**。当初那轮验证的方法是
  「从窗口取 `HMENU` 再把菜单项读回来」（`runtime/check-menu.ps1`），因为 WebView 的
  `console.*` 不会出现在终端里、菜单建没建出来无法靠日志确认。现在同一脚本用来反向确认
  **原生菜单栏确实已经移除**（`GetMenu` 返回 `NULL`）。
- 更名生效：窗口标题为 `闪记`；release 目录下产出 `闪记_0.1.0_x64-setup.exe`
- 启动一次 release 版后正常退出，库与临时文件均无变化（identifier 未改，数据路径不变）
- **标签栏改版**（`runtime/check-tabbar.ps1`，改前 / 改后对照，全是硬数字）：
  - 栏内容高 `35px → 27px`（容器 `h-9 → h-7`）
  - 栏内**全高竖向分割线 `2 → 0` 条**（原来是每个标签的 `border-r` 与 `+` 的 `border-l`）；
    产物层面可证：整份 CSS 里已不存在 `.border-r` / `.border-l`
  - 选中态从「白底 + 描边」改成**纯背景色填充**（`.ring-1` / `.shadow-sm` 同样已不在产物里）：
    描边像素 `152 → 0`，最长竖向边框线段 `4px → 0px`；
    胶囊高度 `24px → 20px`（24 是 22px 胶囊 + 上下各 1px 描边），上下空隙 `2/1px → 4/3px`
  - 选中填充实测 `#DFE3E8`：1333 个像素、最长实心横段 83px
    （这条断言专门用来排除「文字抗锯齿恰好也是这个灰」的误判）
  - **为什么填充色必须换一档**：白底与栏底 `#f6f7f9` 只差 4%，描边一旦去掉，
    浅色主题下胶囊几乎看不见——选中态既然不用描边，就得让背景色自己承担区分。
    深色主题同理（栏底 `#21252b` → 选中 `#16191e`）。
- **无边框窗口**（`runtime/check-chrome.ps1`）：窗口 `916x709 → 916x659`
  （少的 50px = 标题栏 31 + 原生菜单 19），客户区 `900x650` 分毫未变；
  非客户区 insets `left=8 top=1 right=8 bottom=8`，与 tao 源码的
  `SM_CXSIZEFRAME+SM_CXPADDEDBORDER` / Win11 顶边 1px 一致；
  `WS_THICKFRAME` 仍为 True（仍可拖边缩放）；`GetMenu` 为 `NULL`（原生菜单栏已彻底移除）。
- **布局分带**（`runtime/check-tabbar.ps1` 全高扫描）：`y=1..32` 标题行（32px，唯一一行
  图标 + 5 菜单 + 3 窗口按钮）→ `y=33..60` 标签栏（28px）→ 编辑器 → `y=628..650` 状态栏（23px）。
  字符画（`runtime/check-layout.ps1`）可直接读出这四带。
- 无边框改造后**几何零漂移**：启动-关闭连续 3 轮，均为 `900x650 @ (502,175)`
- 剪贴板插件的权限标识符写错会**在构建期**被 tauri-build 拦下（本轮借此确认了
  `clipboard-manager:allow-read-text` / `allow-write-text` 正确）

需要人工在界面上确认（无法脚本化）：

- **把文件拖进窗口能否打开**（OS 级拖放无法程序化合成）：多文件、目录、超大文件、
  已打开过的文件各试一次
- **自绘菜单的交互**：点击展开 / 再点关闭、悬停切换顶级菜单、点外部关闭、`Esc` 关闭、
  `←` `→` `↑` `↓` `Enter`、`主题` 子菜单与勾选、`关于 闪记` 弹窗
- **菜单各项是否都能生效**，尤其是 `编辑 ▸ 剪切 / 复制 / 粘贴`
  （它们现在走剪贴板插件，而不是原生预定义项）
- **窗口操作**：拖标题栏空白处移动、拖四条边缩放、双击标题栏最大化 / 还原、
  最小化 / 最大化 / 关闭三个按钮
- **深色主题下标题行与窗口边缘的观感**——无边框后窗口保留 8px 非客户区边框带
  （tao 用它换阴影、圆角与缩放边框），浅色主题下它是 1px 白边；若在深色主题下显得突兀，
  退路是改用 `transparent: true` + 自绘圆角与阴影（复杂度明显上升），或退回带标题栏
- 焦点不在编辑器时快捷键是否也生效（窗口级兜底的那一层）
- 实际键盘输入后的自动保存（0.8s）与光标/滚动恢复
- 打开 / 保存 / 另存为的对话框流程（其依赖的文件 I/O 与权限已单独验证）
- 标签新建/关闭/重命名/拖拽排序的交互手感、标签栏滚轮横向滚动
- `Ctrl+F` 是否确实弹出 CodeMirror 搜索面板——底层开关已确认关闭，
  但未做按键注入（向活动桌面注入按键会干扰你正在使用的窗口，故未采用）
- 主题跟随系统的观感、设置面板与菜单里的主题勾选是否双向同步
- 新图标在任务栏 / 开始菜单 / 文件资源管理器里的实际观感
- 输入延迟（< 16ms）的主观体感

## 本地构建配置（不提交）

如果访问 crates.io 较慢，可以在项目根目录放一份 `.cargo/config.toml` 指向一个镜像；
该文件已加入 `.gitignore`，**不会提交**，换到网络通畅的环境时删掉即可。

## 许可证

[MIT](LICENSE) © 2026 helay
