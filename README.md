# 闪记

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-000000?style=flat-square&logo=rust&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)
![TypeScript 6](https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript&logoColor=white)
![CodeMirror 6](https://img.shields.io/badge/CodeMirror-6-B483F3?style=flat-square&logo=codemirror&logoColor=white)

轻量级 Windows 桌面文本记录器：**快速打开、随手记录、随时关闭**。不是 IDE，也不是笔记软件。

| 能力 | 说明 |
|---|---|
| 多标签 | 自动保存；重启后连标签顺序、光标位置、窗口大小一起恢复 |
| 语法高亮 | 25 种语言；打开文件按扩展名定，随手记的内容按内容猜 |
| 跳转到定义 | `F12` / `Ctrl+Click` 跳到同一文件内的定义，`Alt+←` 回退 |
| 格式化 | `Shift+Alt+F` 格式化 JSON / YAML，`Shift+Alt+M` 压缩 JSON |
| 两种用法 | 直接编辑真实文件；或随手新建标签，内容先落在临时目录，随时另存为 |
| 外观 | 主题跟随系统；无边框单行标题栏（图标 + 菜单 + 窗口按钮） |

## 快速上手

| 想做什么 | 怎么做 |
|---|---|
| 打开文件 | 把文件**拖进窗口**（可一次多个）、`Ctrl+O`，或 文件 ▸ 打开… |
| 随手记 | `Ctrl+N` 新建标签，内容立刻落在临时目录；`Ctrl+S` 可另存到正式位置 |
| 找内容 | `Ctrl+F` 搜索 · `Ctrl+R` 替换 · `Ctrl+G` 转到行 · `F3` 下一个匹配 |
| 看定义 | `F12` 或 `Ctrl+Click`；`Alt+←` 回到跳转前的位置 |
| 改标签名 / 排序 | 双击标签名重命名（只改显示名，不改文件名）；拖动标签排序 |
| 动窗口 | 拖标题栏空白处移动；拖四条边缩放；双击标题栏空白处最大化 / 还原 |
| 用键盘走菜单 | `←` `→` 换顶级菜单，`↑` `↓` 移动高亮，`Enter` 执行，`Esc` 关闭 |
| 不知道按哪个键 | 按 `F1` 打开「使用说明」（应用内的完整功能文档，左侧带目录） |

## 快捷键

菜单里能看到大部分按键。**焦点不在编辑器里时同样生效**（焦点在标签栏、状态栏或按钮上也行）。

| 分类 | 快捷键 | 功能 |
|---|---|---|
| 文件 | `Ctrl+N` / `Ctrl+T` | 新建标签（在临时目录建文件） |
| | `Ctrl+O` | 打开文件（已打开则直接切过去） |
| | `Ctrl+S` / `Ctrl+Shift+S` | 保存（临时标签转为另存为） / 另存为 |
| | `Ctrl+W` | 关闭当前标签 |
| 标签 | `Ctrl+Tab` / `Ctrl+Shift+Tab` | 下一个 / 上一个标签 |
| | `Ctrl+PageDown` / `Ctrl+PageUp` | 同上（备用，部分环境会拦截 `Ctrl+Tab`） |
| | `Ctrl+1` … `Ctrl+9` | 切到第 N 个标签 |
| 编辑 | `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做 |
| | `Shift+Alt+F` / `Shift+Alt+M` | 格式化 / 压缩 JSON |
| 查找 | `Ctrl+F` / `Ctrl+R` | 搜索 / 替换（同一个面板） |
| | `Ctrl+G` | 转到行（`行` 或 `行:列`；`Ctrl+Alt+G` 同样可用） |
| | `F3` / `Shift+F3` | 下一个 / 上一个匹配 |
| 跳转 | `F12` / `Ctrl+Click` | 跳到名字的定义（同一文件内） |
| | `Alt+←` | 回到跳转前的位置 |
| 其它 | `Ctrl+D` | 选下一个相同词 |
| | `Alt+Click` | 多光标（`Ctrl+Click` 已让给跳转，故改用 `Alt`） |
| | `Ctrl+,` | 设置 |
| | `F1` | 使用说明 |

## 语法高亮与跳转

**语言怎么定的**：打开文件时按**文件名**（所以 `.py` 不会被内容误判成 YAML）；
新建的临时标签没有文件名可依，就**按内容猜**——先认代码特征，再认 JSON / YAML，
都不像就是纯文本。**认错了或认不出来时，点状态栏左侧的语言名**手动指定，
下拉里有「自动识别」可以还原；选择记在数据库里，重启后仍然有效。
优先级：**手动选择 > 文件名 > 内容**。

| 分组 | 语言（扩展名举例） |
|---|---|
| 脚本 / 编译型 | JavaScript `.js` `.mjs`、TypeScript `.ts` `.mts`、JSX / TSX `.jsx` `.tsx`、Python `.py`、C / C++ `.c` `.h` `.cpp`、Rust `.rs`、Go `.go`、Java `.java` |
| 配置 / 数据 | JSON `.json` `.jsonc`、YAML `.yaml` `.yml`、TOML `.toml`、INI `.ini` `.properties` `.env` |
| 标记 / 查询 | HTML `.html`、CSS `.css` `.scss`、XML `.xml` `.svg`、Markdown `.md`、SQL `.sql` |
| 脚本 / 其它 | Shell `.sh`、PowerShell `.ps1`、Dockerfile（按文件名）、Lua `.lua`、Ruby `.rb`、Perl `.pl`、R `.r` |

**跳转到定义**（只在当前文件内查找，不解析 `import`）：

- 支持 JavaScript / TypeScript / JSX / TSX、Python、Rust、Go、Java、C / C++，
  以及 YAML 的锚点与别名
- 光标下的名字有定义时会显示虚线下划线与手型光标；找不到时只在状态栏提示，不弹窗
- 定义在视口之外也能跳到（搜索前会把语法树补解析到文末，上限 0.5 秒）

> 内容超过 **5 MB** 会自动关闭语法高亮（状态栏会说明），缩回阈值内自动恢复。
> 语法包按需加载：没打开过的语言不占内存，也不进首屏。详见
> [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)（含内存与体积实测）。

## 设置

`Ctrl+,` 或 设置 ▸ 打开设置…

- **主题**：跟随系统 / 浅色 / 深色
- **临时目录**：查看生效目录、选择新目录、恢复默认、在资源管理器中打开
- **打开的文件自动保存**：开关（临时文件不受此开关约束，总是保存）
- **临时文件**：显示总数与未被引用的数量，可手动清理（删除前二次确认）

## 数据与文件

**内容以文件为准**，数据库只存标签元数据与会话：

| 标签来自 | 内容落在哪 |
|---|---|
| 新建标签 `Ctrl+N` | 临时目录，文件名形如 `未命名 1-3f9a2c8e.txt` |
| 打开的文件 `Ctrl+O` | 原文件本身 |
| 另存为 `Ctrl+Shift+S` | 你选定的新路径，并删除原来的临时文件 |

- **数据库**（只存标签元数据与会话）：`%APPDATA%\com.temporary.recorder\recorder.db`
- **临时目录**：`%LOCALAPPDATA%\com.temporary.recorder\temp`，可在设置里改

几个刻意的行为：

- **卸载不会删除你的记录**：`recorder.db` 与临时目录都会保留。
- **关闭临时标签不会删除它的文件**，内容之后仍能在临时目录里找回；
  「设置」里的清理**只清理没有被任何标签引用的文件**。
- **自动保存**：停止输入约 0.8 秒后写回文件。写之前会比对文件修改时间，
  若已被别的程序改过就**不覆盖**，只在状态栏提示（此时 `Ctrl+S` 可强制覆盖）。
  单纯打开不会改动文件。
- **编码与写入**：统一写 **UTF-8 无 BOM + LF**（读入时去掉 BOM、CRLF/CR 归一为 LF；
  非 UTF-8 如 GBK 会明确报错，不会产生乱码）。写入是原子的：先写同目录临时文件再改名覆盖，
  写一半失败不会截断原文件。

## 开发

需要 Node ≥ 20.19、pnpm ≥ 10、Rust `stable-x86_64-pc-windows-msvc` 与 VS Build Tools：

```powershell
pnpm install       # 安装前端依赖
pnpm tauri dev     # 开发模式
pnpm tauri build   # 打包 release 安装包
```

更深入的内容在 `docs/` 下：

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) —— 目录结构、架构与设计取舍、存储、
  安装包、验收脚本、性能与内存实测
- [docs/PITFALLS.md](docs/PITFALLS.md) —— 踩坑记录（Tauri v2 权限、SQLite 占位符、
  无边框窗口、WebView2 抢快捷键、滚动条、内容嗅探……）

技术栈：Tauri v2（复用系统 WebView2）+ React 19 + TypeScript + Vite + CodeMirror 6 +
Zustand + SQLite（`tauri-plugin-sql`）+ Tailwind CSS。

## 许可证

[MIT](LICENSE) © 2026 helay
