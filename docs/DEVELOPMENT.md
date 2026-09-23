# 开发与验收

面向改这个项目的人（也包括 AI 助手）。用户向的说明在 [README](../README.md)，
踩坑记录在 [PITFALLS.md](PITFALLS.md)。

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

### 关于名称

| 名字 | 值 | 说明 |
|---|---|---|
| 产品名 `productName` | **闪记** | 窗口标题、安装目录、开始菜单、应用和功能里显示的名字 |
| bundle identifier | `com.temporary.recorder` | **刻意不改**：数据库与临时目录的路径由它决定，改了已有笔记会看起来丢失 |
| Cargo 包名 / 可执行文件名 | `temporary-recorder` | 保持 ASCII：中文出现在构建工具链的输出路径里风险更大，且不影响任何可见处 |
| npm 包名 | `temporary-recorder` | npm 不允许非 ASCII 包名；它本来也不面向用户 |

## 架构与设计取舍

### 为什么菜单不是「原生菜单栏」了

**因为原生菜单栏做不到「图标 + 菜单 + 窗口按钮同一行」。** 实测过：Windows 的原生菜单栏
是系统画在标题栏下沿的一条独立横条（19px 高，占满整宽），它无法与图标、最小化/最大化/关闭
共处一行。VS Code 的菜单同样是自绘的。所以这里把菜单换成了自绘实现
（`src/services/menu.ts` 只产出菜单数据，`src/components/TitleBar/` 负责渲染与交互）。

代价与收益：

- **失去 Win11「贴靠布局」**（鼠标悬停在最大化按钮上弹出布局选择）。
  `Win+Z`、`Win+←/→` 仍然可用。
- **保留阴影、Win11 圆角、四条边拖拽缩放、双击标题栏最大化**——这些都由 tao 提供，
  不需要第三方插件。原理见 [PITFALLS.md 第 14 条](PITFALLS.md)。
- 工具栏少了一行：原先 = 标题栏 31px + 菜单栏 19px，现在 = 一行 32px。

### 三处刻意的实现选择

- **撤销 / 重做 / 全选调 CodeMirror 自己的命令**，而不是浏览器的原生行为——
  原生 Undo 不认 CodeMirror 的历史栈，会变成空操作。
- **剪切 / 复制 / 粘贴走官方剪贴板插件**，而不是 `navigator.clipboard`：
  WebView2 对 `clipboard-read` 的默认处理不可靠，会直接拒绝。
- **退出走 `getCurrentWindow().close()`**：`close()` 会触发 `onCloseRequested`，
  退出前的强制落盘（`flushAll` + 写激活标签 + 写窗口几何）才不会被跳过。

## 存储与数据库

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

## 安装包

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
（它同时也是安装程序"记住上次装在哪"的机制 —— 见 [PITFALLS.md 第 8 条](PITFALLS.md)。）

## 验收辅助脚本

> 这些脚本按项目约定放在本地的 `runtime/` 目录里，**不随仓库发布**（见 `.gitignore`），
> 因此克隆仓库后看不到它们。这里记录它们各自验证什么，方便重建同一套检查；
> 文中提到「用 `runtime/xxx` 验证」时，指的就是这份清单里的脚本。

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
| `check-tabbar.ps1` | 标签栏高度、全高分割线数量、选中胶囊的填充包围盒与上下空隙、描边像素数 |
| `check-statusbar.ps1` | 状态栏右半区「文字块」数量（右对齐按钮组增减按钮时最右边像素不变，只能这样数） |
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
