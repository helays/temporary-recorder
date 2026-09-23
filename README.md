# 闪记

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-000000?style=flat-square&logo=rust&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)
![TypeScript 6](https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript&logoColor=white)
![CodeMirror 6](https://img.shields.io/badge/CodeMirror-6-B483F3?style=flat-square&logo=codemirror&logoColor=white)


轻量级 Windows 桌面应用，用于临时记录、编辑、格式化文本内容。
定位是「快速打开、随手记录、随时关闭」——不是 IDE，也不是笔记软件。

多标签、自动保存、重启后完整恢复上次的标签与窗口状态；内置 JSON / YAML 格式化；
可以直接打开真实的 `.json` / `.yaml` / `.txt` 文件就地编辑，也可以纯随手记——
新建标签会立刻在临时目录里落一个文件，随时能「另存为」到正式位置。
内置 **25 种语言的语法高亮**与**同一文件内的「跳转到定义」**（`F12` / `Ctrl+Click`，`Alt+←` 回退）。
主题跟随系统（也可手动指定浅色 / 深色）。
窗口是无边框的，顶部只有一行「图标 + 菜单 + 窗口按钮」（VS Code 那种形态），
标签栏是矮胶囊样式、标签之间没有分割线。

**打开文件的方式**（三条入口等价，都汇总到同一个 `openPathIntoNewTab`）：

1. 顶部标题栏 **文件 ▸ 打开…**
2. **把文件拖进窗口**（支持一次拖多个；拖拽时窗口中央会出现「松开即可打开 N 个文件」）
3. 快捷键 `Ctrl+O`

## 安装与卸载

下载 `闪记_0.1.0_x64-setup.exe` 双击安装。全机器安装：装到 `C:\Program Files\闪记`，
开始菜单快捷方式建在 All Users，需要管理员权限（会弹一次 UAC）。

```powershell
# 静默安装（会弹 UAC）
& "闪记_0.1.0_x64-setup.exe" /S

# 静默卸载（会弹 UAC）
& "C:\Program Files\闪记\uninstall.exe" /S
```

**卸载默认不会删除你的记录。** 卸载向导上的「Delete app data」默认不勾选，
静默卸载 `/S` 也不会勾选，因此 `recorder.db` 与临时目录一律保留。

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
| 编辑 | 撤销 `Ctrl+Z`、重做 `Ctrl+Shift+Z`、剪切 / 复制 / 粘贴、全选 `Ctrl+A`、查找 `Ctrl+F`、替换 `Ctrl+R`、转到行… `Ctrl+G` |
| 查看 | 格式化 `Shift+Alt+F`、压缩 JSON `Shift+Alt+M`、主题 ▸ 跟随系统 / 浅色 / 深色（带勾选） |
| 帮助 | 使用说明 `F1`、关于 闪记、在资源管理器中打开数据目录 |

「使用说明」是应用内的完整功能文档（打开保存 / 标签 / 编辑格式化 / 查找跳转 /
语法高亮 / 外观窗口 / 设置 / 数据位置 / 快捷键总表），左侧有目录可以直接跳小节。
它与本文件的功能说明手工同步。

## 快捷键

下面这些大多同时出现在顶部菜单里（菜单项右侧会显示对应按键）。
**焦点不在编辑器里时同样生效**——焦点在标签栏、状态栏或按钮上也能用。

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
| `Ctrl+F` | 搜索 |
| `Ctrl+R` | 替换（与搜索同一个面板，面板里带替换输入框） |
| `Ctrl+G` | 转到行（可写「行」或「行:列」）；`Ctrl+Alt+G` 同样可用 |
| `F3` / `Shift+F3` | 下一个 / 上一个匹配 |
| `Shift+Alt+F` | 格式化（按内容自动识别 JSON / YAML） |
| `Shift+Alt+M` | 压缩（仅 JSON） |
| `Ctrl+D` | 选下一个相同词（CodeMirror 默认行为） |
| `Alt+Click` | 多光标（`Ctrl+Click` 已让位给「跳转到定义」，故多光标改用 `Alt`） |
| `F12` / `Ctrl+Click` | 跳转到光标处 / 点击处名字的定义（同一文件内） |
| `Alt+←` | 回到上一次跳转前的位置（每个标签各记 50 层） |
| `F1` | 使用说明（应用内的功能文档） |

其它界面操作：

- 标签重命名：双击标签名（只改标签显示名，不改文件名）
- 移动窗口：拖动标题栏空白处；**双击标题栏空白处**最大化 / 还原
- 缩放窗口：拖四条边或四个角（无边框但保留了缩放边框，见 [PITFALLS.md 第 14 条](docs/PITFALLS.md)）
- 菜单键盘操作：`←` / `→` 换顶级菜单，`↑` / `↓` 移动高亮，`Enter` 执行，`Esc` 关闭

## 语法高亮与跳转

打开文件时按**文件名**立刻确定语言（所以 `.py` 不会被内容误判成 YAML）；
新建的临时标签没有文件名可依，就**按内容猜**——先认代码特征（Go / Python / Rust /
JS 系列 / Java / C / C++ / SQL / Shell / PowerShell / Markdown / TOML / INI / Lua / Ruby /
Perl / R / HTML / XML / Dockerfile），认不出来再认 JSON / YAML，都不像就是纯文本。

**认错了或认不出来？点状态栏左侧的语言名**（如「纯文本」「Go」）就能手动指定，
下拉里含「自动识别」一项可以还原。手动选择记在数据库里，**重启后仍然有效**，
优先级是：手动选择 > 文件名 > 内容嗅探。

| 分组 | 语言（扩展名举例） |
|---|---|
| 脚本 / 编译型 | JavaScript `.js` `.mjs` `.cjs`、TypeScript `.ts` `.mts`、JSX / TSX `.jsx` `.tsx`、Python `.py`、C / C++ `.c` `.h` `.cpp` `.hpp`、Rust `.rs`、Go `.go`、Java `.java` |
| 配置 / 数据 | JSON `.json` `.jsonc`、YAML `.yaml` `.yml`、TOML `.toml`、INI `.ini` `.properties` `.env` |
| 标记 / 查询 | HTML `.html`、CSS `.css` `.scss` `.less`、XML `.xml` `.svg`、Markdown `.md`、SQL `.sql` |
| 脚本 / 其它 | Shell `.sh` `.bash`、PowerShell `.ps1`、Dockerfile（按文件名）、Lua `.lua`、Ruby `.rb`、Perl `.pl`、R `.r` |

**跳转到定义**（只在当前文件内查找，不解析 `import`）：

- 支持 JavaScript / TypeScript / JSX / TSX、Python、Rust、Go、Java、C / C++，以及 YAML 的锚点与别名；
- 光标下的名字有定义时会有虚线下划线与手型光标；
- 找不到定义时**只在状态栏提示，不弹窗**；
- 长文件里定义在视口之外也能跳到（搜索前会把语法树补解析到文末，上限 0.5 秒）。

语法包是**按需加载**的：没打开过的语言不占内存，首屏产物里也不含任何语法包
（引入语言功能时首屏 JS 反而小了 1.2 KB；之后加的嗅探、语言下拉、快捷键与帮助合计约 8 KB，
其中一万多字的「使用说明」是独立 chunk，不按 `F1` 就不会加载）。
内存代价实测：25 种语言全部加载约 **+4.6 MB**；每个打开的文档约再占**源码体积的 1.5–2.7 倍**
（含语法树），应用自身进程的内存没有可测量的变化。详见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 设置（`Ctrl+,` 或顶部菜单 设置 ▸ 打开设置…）

- **主题**：跟随系统 / 浅色 / 深色
- **临时目录**：查看当前生效目录、选择新目录、恢复默认、在资源管理器中打开
- **打开的文件自动保存**：开关
- **临时文件**：显示总数与未被引用的数量，手动清理（删除前二次确认）

## 数据与文件位置

**数据库**（只存标签元数据与会话，由 `tauri-plugin-sql` 按 bundle identifier 解析）：

```
%APPDATA%\com.temporary.recorder\recorder.db
```

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

## 技术栈

| 层级 | 选型 |
|------|------|
| 桌面外壳 | Tauri v2（复用系统 WebView2，不打包 Chromium） |
| 前端 | React 19 + TypeScript + Vite 8 |
| 编辑器 | CodeMirror 6 |
| 状态管理 | Zustand 5 |
| 本地存储 | SQLite（`tauri-plugin-sql`） |
| 样式 | Tailwind CSS v4 |

## 开发

开发需要 Node ≥ 20.19、pnpm ≥ 10、Rust `stable-x86_64-pc-windows-msvc` 与
VS Build Tools（含 MSVC 与 Windows SDK）。常用命令：

```powershell
pnpm install       # 安装前端依赖
pnpm tauri dev     # 开发模式（自动启动 Vite dev server）
pnpm tauri build   # 打包 release 安装包（含 NSIS 安装程序）
```

首次 `pnpm tauri dev` 需要编译约 420 个 crate，数分钟属正常现象。

更深入的内容都在 `docs/` 下：

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) —— 目录结构、架构与设计取舍、存储与数据库、
  安装包、验收辅助脚本、性能实测、测试现状
- [docs/PITFALLS.md](docs/PITFALLS.md) —— 踩坑记录（Tauri v2 权限、SQLite 占位符、
  无边框窗口、WebView2 抢快捷键、网页拖放被关掉、剪贴板插件默认权限为空……）

## 许可证

[MIT](LICENSE) © 2026 helay
