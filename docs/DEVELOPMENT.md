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
│                        # 窗口级快捷键（shortcuts.ts）、临时文件清理（tempCleanup.ts）、
│                        # 语言表与按需加载（languages.ts）
├── extensions/          # CodeMirror 集成（editorManager、主题、快捷键、跳转 jump.ts、
│                        # YAML 缩进）
├── utils/               # 纯函数（防抖、换行归一、JSON 错误定位、id、
│                        # 定义定位 definition.ts）
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

### 快捷键与应用内帮助

- 三个与编辑定位有关的键：`Ctrl+F` 搜索（CodeMirror 的 `searchKeymap` 自带）、
  `Ctrl+R` 替换（同一面板，本应用补的绑定）、`Ctrl+G` 转到行（`@codemirror/search`
  的 `gotoLine`，自带对话框，支持「行」与「行:列」）。
  `Ctrl+H` 已被**移除**（不留别名）。`Ctrl+Alt+G` 是 CodeMirror 原生的转到行，同样可用。
- 编辑器内的键位写在 `extensions/keymap.ts`。`Mod-g` 用 `Prec.highest(keymap.of([...]))`
  单独包一层：`searchKeymap` 里也有一条 `Mod-g`（面板内的「下一个匹配」），
  靠扩展顺序决定谁赢是运气，显式提高优先级才稳。`runtime/check-shortcuts.mjs` 直接断言
  「我们的绑定排在 CodeMirror 那条之前」——即 facet 扁平化后的下标大小。
- 焦点不在编辑器时由 `services/shortcuts.ts` 的窗口级兜底负责（`f` / `r` / `g` / `F1`），
  这是 README 一直承诺的行为；同一个脚本用 `window` 桩喂假事件验证这几个分支真的被走到。
- 应用内帮助 = `components/Help/`（`sections.tsx` 是正文，`index.tsx` 是弹窗外壳，
  与设置弹窗同一套交互），入口是 `F1` 与 帮助 ▸ 使用说明。正文是手写 TSX，
  **不引入 markdown 渲染依赖**；因此这份内容与 README 手工同步——
  改功能时两处一起改（README 的快捷键表 / 菜单表 / 语法高亮与跳转三节是同一份事实）。
- 「关于」与「使用说明」刻意分开：关于讲版本、数据目录与简介，帮助讲怎么用。

### 滚动条

- `index.css` 里一组**全局细滚动条**（8px、透明轨道、圆角拇指、隐藏两端箭头）。
  拇指**常显但克制**（`rgba(100,100,100,.25)`，白底上约 `#D8D8D8`），
  只在 `::-webkit-scrollbar-thumb:hover` / `:active` 时加深——即 VS Code 的行为。
  只用 `::-webkit-scrollbar`：WebView2 就是 Chromium，
  而 `scrollbar-width` / `scrollbar-color` 与它同时写会互相干扰，宽度会变得不可预期。
  `.tabstrip` 是例外——标签栏**完全隐藏**滚动条（原来的设计，保持不变）。
- 编辑器那根在 `extensions/theme.ts` 的 `sharedChrome` 里按 VS Code 口径定义：
  总宽 14px、轨道透明、拇指用 `border: 3px solid transparent` + `background-clip: content-box`
  收成可见约 8px（14 − 3×2）的圆角条、无箭头。颜色取 `index.css` 的 CSS 变量，
  所以浅色 / 深色共用一份定义。
- CodeMirror **不提供任何滚动条样式**（`@codemirror/view` 的 baseTheme 里只有
  `overflow-x: auto`，竖轴靠 CSS 规则推导成 auto），真正的滚动元素是 `.cm-scroller`
  （`view.scrollDOM`），所以要改就得自己写这个选择器。
- **刻意没有**做「不悬停就完全透明」，也没有「宿主 hover 浮现」：
  前者在 Chromium 上不可靠（要等一次点击才重绘），后者会因为 `*:hover` 命中 `body`
  而变成「鼠标在窗口里就一直显着」。两个坑都踩过一次，细节与结论见
  [PITFALLS.md 第 26 条](PITFALLS.md)。
- 那个「概览标尺 / 代码缩略图」没有做：CodeMirror 没有现成 API，自绘或引依赖
  都和这个项目的「轻」定位不符。

### 三处刻意的实现选择

- **撤销 / 重做 / 全选调 CodeMirror 自己的命令**，而不是浏览器的原生行为——
  原生 Undo 不认 CodeMirror 的历史栈，会变成空操作。
- **剪切 / 复制 / 粘贴走官方剪贴板插件**，而不是 `navigator.clipboard`：
  WebView2 对 `clipboard-read` 的默认处理不可靠，会直接拒绝。
- **退出走 `getCurrentWindow().close()`**：`close()` 会触发 `onCloseRequested`，
  退出前的强制落盘（`flushAll` + 写激活标签 + 写窗口几何）才不会被跳过。

### 语法高亮：25 种语言，全部按需加载

`src/services/languages.ts` 是唯一的语言表：每个语言一条 `LanguageDescription`
（名称、别名、扩展名、`filename` 正则、`load: () => import(...)`）。
`load` 只在真正打开该语言的文件时执行，因此：

- **首屏不含任何语法包**。Vite 把每个 `import()` 拆成独立 chunk，实测 23 个语言 chunk
  合计约 600 KB，全部不在首屏（见「性能实测」）。
- 语法包只在首次用到时解析，之后按语言缓存（`Map<LanguageId, Extension>`）。
- 打开过的每种语言才会占内存：小的（JSON 2 KB、XML 12 KB 的产物）到大的
  （C++ 104 KB、JavaScript 84 KB 的产物）不等。

几处容易踩的点（细节见 [PITFALLS.md](PITFALLS.md)）：

- `LanguageDescription.matchFilename` 比扩展名时**大小写敏感**，所以原文与小写文件名各试一次；
- `legacy-modes` 的**文件名与导出名不一致**（`mode/dockerfile` 导出 `dockerFile`），写错不会报错，
  只会静默没有高亮 —— 因此有 `runtime/check-languages.mjs` 逐个真加载一遍；
- **语言由文件名决定时永不按内容复探**（`TabEntry.preferred`），
  否则 `.py` 文件会被内容嗅探成 YAML；
- 语言是异步加载的，`createEntry` 会**先加载完语法包再创建 EditorState**，
  避免「先无色后上色」的闪烁。

### 内容嗅探：先认代码特征，再认 JSON / YAML

新建标签的临时文件固定叫 `未命名 1-xxxxxxxx.txt`（`services/tempFiles.ts`），扩展名给不出任何
信息，只能按内容猜。`services/sniff.ts` 是这张特征表，`services/languages.ts:sniffLanguageId`
的**顺序**是：

1. `sniffBySignature(head)` —— 每个语言要求**两条互相独立的证据**，且尽量锚在行首
   （Go 要 `package x` 且 `func`/`import (`；Python 要 `def ...:` 且缩进体；
   PowerShell 要 `$x =`/`param(`/`function Xxx` 且出现 cmdlet）。认不出来返回 null；
2. 回落到 `detectFormat(整篇)` —— JSON / YAML 语义**保持不变**，格式化功能不受影响。

代码特征排在前面是必须的：`def f():\n  return 1` 是**合法的 YAML 映射**，
`detectFormat` 会把它判成 YAML（PITFALLS 第 21 条），对「粘贴一段代码」的场景是错的。

只读前 64 KB（`SNIFF_HEAD_LIMIT`）：特征都是行内正则，长文档没必要整篇扫。
特征表本身是**纯函数**，`runtime/check-sniff.mjs` 里有 31 条正向、11 条负向（中文随笔、
纯文本、散文里提到 `const`/`SELECT` 关键词）与 14 条冲突样本 —— 负向样本和正向一样重要，
嗅探最烦人的错法是把随笔染成代码。

### 手动指定语言（兜底）

嗅探不可能覆盖所有片段，所以状态栏的语言名是个**可点的下拉**
（`components/StatusBar/LanguagePicker.tsx`）：`自动识别` + 纯文本 + 25 种语言，
选中的打勾。选择落到三处：

- 编辑器：`editorManager.setActiveLanguage(id | null)`，写进 `TabEntry.preferred`
  （与「文件名决定」共用同一个字段：语义都是「已确定，不再按内容复探」）；
  大文件降级期间只记选择、不装语法树，体积回落时自动装回来；
- 数据库：`settings` 表的 `lang:<tabId>` 键。**刻意不加 tabs 列**，免得动
  AGENTS.md 里记录的表结构、也不需要 v3 迁移；代价是关标签时删键
  （`tabsStore.closeTab`）+ 启动时清一次孤儿键（`languageActions.pruneLanguageOverrides`）；
- 状态栏：一条「已把当前标签设为 …」的提示。

恢复时的优先级写在 `services/session.ts:resolveLanguageId`：手动选择 > 文件名 > 内容嗅探。
`settingsStore.hydrate` 里解析 `lang:` 前缀时会用 `isKnownLanguageId` 校验，
values 认不出的键直接丢掉（避免历史数据把状态带坏）。

### 跳转到定义：规则来自实测转储，不靠记忆

`Ctrl+Click` 与 `F12` 跳到同一文件内名字的定义，`Alt+←` 回退。分工刻意分成两层：

- `src/utils/definition.ts`：**纯函数**。吃 `Tree` + `Text` + 位置 + 语言，返回结论，
  不碰 DOM。规则表按语言写「哪些节点名是标识符 / 哪些节点名本身就是定义 /
  哪些要连父节点一起看」，另有一条「分隔符」规则（Python `a, b = 1, 2` 里只有 `=` 左边的是定义）。
- `src/extensions/jump.ts`：只做接线 —— 键位、`Ctrl+Click`、悬停虚线下划线装饰、
  回退历史（`StateField`，每个标签各一份）、状态栏提示。

各语言的节点名是**实测出来的**，不是查文档猜的：`runtime/probe-defs*.mjs` 把
8 种语言的真实语法树按缩进打印成文本（`runtime/probe-defs*.txt`），规则表照着写。
只做同文件查找，不解析 `import`，也不做跨文件索引。

补 JSX/TSX 用例时正是靠这套断言发现漏了一类节点：组件标签 `<Item />` 的 `Item` 是
`JSXIdentifier`（内置标签是 `JSXBuiltin > JSXIdentifier`），不在最初那份标识符名单里，
于是「点组件名跳过去」这个最常用的动作静默失效。规则表补上之后，
`check-jump.mjs` 里 jsx / tsx 两组用例（组件标签、JSX 属性值、解构参数、类型注解）全绿。

超过 5 MB 的文档会被降级、不装语言，此时按定义查不到任何东西（`empty`）——
这是刻意的：降级的前提就是不再为它建语法树。

`Ctrl+Click` 在 Windows 上本来是 CodeMirror 的「加光标」，所以跳转要显式把
`EditorView.clickAddsSelectionRange` 改成 `Alt`（多光标随之变成 `Alt+Click`，
矩形选择用的 `Alt+拖动` 不受影响）。

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

## GitHub 自动构建与发布

两条 workflow（都在 `.github/workflows/`），跑在 **`windows-latest`**：

| workflow | 触发 | 做什么 | 耗时 |
|---|---|---|---|
| `ci.yml` | push 到 `main`（纯文档改动跳过）、PR、手动 | `pnpm install --frozen-lockfile` → `pnpm type-check` → `pnpm build` | 1 分钟内（首次实测 36 秒，不含排队） |
| `release.yml` | push tag `v*`、手动 | 装 Rust + 缓存 → 对齐版本号 → `tauri-action` 构建 NSIS 安装包 → 上传工作流产物；tag 上再生成 **草稿** Release | 冷跑 12~18 分钟，缓存命中 5~8 分钟 |

**为什么用 Windows runner 而不是 ubuntu**：锁文件是在 Windows 上生成的，
`@rollup/rollup-*`、`esbuild` 这类 optional 依赖按平台分发，换平台容易踩
「找不到 linux-x64-gnu」的坑；而本项目本来就只面向 Windows。

**发版流程**（版本号不用手工改，CI 按 tag 写入三处）：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

跑完之后：Releases 页面会出现一份 **草稿**，里面是 `闪记_0.1.0_x64-setup.exe`；
点 Publish 才对外可见。草稿状态下重跑同一个 tag 会更新那份草稿，不会重复创建
（但如果已经点过 Publish，`tauri-action@v1` 会因为「要求草稿而 Release 已发布」直接失败，
这是它的刻意设计）。
手动触发 `release.yml` 只会构建 + 上传工作流产物（`tagName` 为空时 tauri-action 不碰 Releases），
可以拿来验证「CI 上能不能构建成功」而不发版。

几个刻意的地方：

- **版本号由 `.github/scripts/set-version.mjs` 统一写入** `package.json`、`src-tauri/tauri.conf.json`、
  `src-tauri/Cargo.toml`。产物名与 exe 的版本资源都取自它们，靠人记得手工改三处早晚不一致；
  脚本对每个文件要求「恰好一处版本声明」，找不到或多处都会直接失败。
- **`uploadUpdaterJson: false`**：本项目没有 updater 插件，不要往 Release 里塞 `latest.json`。
  这个输入在 `tauri-action@v1` 之前叫 `includeUpdaterJson`，写旧名不会报错、只会被静默忽略。
- **action 版本钉在已迁到 node24 的主版本上**：`checkout` / `setup-node` v7、
  `pnpm/action-setup` v6、`upload-artifact` v7、`tauri-action` v1。
  停在 `@v4` 会触发「Node.js 20 is deprecated」警告并被强制改跑 node24，
  所以别往下退——`runtime/check-workflows.mjs` 会拦。
- **`tauriScript: pnpm tauri`**：pnpm 必须显式指定，否则 action 会去跑 npm/yarn。
- **不签名**：未签名构建不需要任何密钥（`GITHUB_TOKEN` 自动注入），代价是 SmartScreen 会提示
  「未知发布者」。
- **本地 cargo 镜像不参与 CI**：`.cargo/config.toml`（USTC 镜像）已 gitignore，CI 直连 crates.io。
- **CI 跑不了 `runtime/` 里的验收脚本**：那套脚本按 AGENTS 规定不提交仓库。
  也就是说 CI 只保证「类型能过、前端能构建、安装包能出」，界面的像素级断言仍只在本地跑
  （`runtime/check-*.ps1`、`check-*.mjs`）。若以后想让 CI 也跑它们，需要把它们挪到可提交的
  目录（如 `tools/`）并相应修改 AGENTS。

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
| `ts-resolve.mjs` | 让 node 直接跑 `src/` 下的 TS：给无扩展名的相对导入补 `.ts`（用 `--import` 加载） |
| `check-languages.mjs` | 25 种语言的名字映射、内容嗅探、**逐个真加载并解析出语法树**、缓存与 `text` 语义、语言下拉的 id 清单、`lang:` 键的解析 |
| `check-sniff.mjs` | 内容嗅探：31 条正向（每个语言一段真实片段）+ 11 条负向（中文随笔、散文里提到关键词）+ 14 条冲突样本 + 64 KB 上限 |
| `probe-defs.mjs` / `probe-defs2.mjs` / `probe-defs3.mjs` | 把各语言真实语法树按缩进转储成 `probe-defs*.txt`，跳转规则照此编写 |
| `check-jump.mjs` | 9 套跳转规则共 60+ 条断言（引用→定义、self / missing / empty / unsupported、大文件索引耗时） |
| `measure-lang-memory.mjs` | 语法包与语法树的堆占用（`--expose-gc` + 保留 N 份文档再除以 N） |
| `measure-langs.ps1` / `measure-langs.mjs` | 四种内容各跑一遍，量应用与 WebView2 的内存、编辑器配色数、状态栏语言胶囊宽度；`.mjs` 负责备份 / 还原数据库与种入单标签会话 |
| `check-highlight.ps1` | 数编辑器里**精确命中** `defaultHighlightStyle` 各 token 颜色的像素数，并量状态栏语言胶囊宽度；纯文本应为 0 个 token 像素。`-Override <lang>` 可同时验证手动指定语言优先于嗅探 |
| `check-shortcuts.mjs` | 快捷键：keymap facet 里 `Mod-f`/`Mod-r`/`Mod-g`/`F1`/`F3` 的存在与优先级（`Mod-g` 指向 `gotoLine`、且排在 CodeMirror 那条之前）、`Mod-h` 已移除、菜单加速键、窗口级兜底的真实按键行为（用 `window` 桩喂假事件） |
| `check-scrollbar.mjs` | 滚动条规则是否进入产物：全局 8px 细滚动条（透明轨道、悬停浮现、无箭头、不与 `scrollbar-width` 混用）、编辑器 `.cm-scroller` 的 14px / `background-clip` 拇指 |
| `check-scrollbar.ps1` | 像素级：种入长文档后量编辑器右缘 14px——默认 Chromium 轨道/拇指颜色像素必须为 0，且正文不得侵入该条（应用在跑时拒绝执行，需 `-Force`） |

> A/B 构建用 `git worktree add runtime/baseline HEAD` 检出上一个提交来对比产物：
> 注意**不要**把它的 `node_modules` 用 junction 指回工作区，清理时 `rmdir /s` 会删穿
> junction 把真 `node_modules` 删掉（见 [PITFALLS.md 第 23 条](PITFALLS.md)）。
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
node --import ./runtime/ts-resolve.mjs runtime/check-languages.mjs
node --import ./runtime/ts-resolve.mjs runtime/check-jump.mjs
node --expose-gc --import ./runtime/ts-resolve.mjs runtime/measure-lang-memory.mjs

# 界面与窗口（会短暂启动一次应用，看完自己关掉）
& .\runtime\check-chrome.ps1      # 标题栏 / 原生菜单 / 缩放边框
& .\runtime\check-tabbar.ps1      # 标签栏高度与分割线
& .\runtime\check-layout.ps1      # 把窗口渲染成字符画看布局
& .\runtime\check-highlight.ps1   # 语法高亮是否真的画出来了（数精确 token 颜色）
& .\runtime\measure-langs.ps1     # 四种内容的内存对照（会备份 / 还原数据库）
```

`measure-langs.ps1` 会**改写数据库**（种入单标签会话）来做对照，跑完记得：

```powershell
node runtime/measure-langs.mjs check     # 先看一眼现状（不改任何东西）
node runtime/measure-langs.mjs restore   # 还原实验前的快照（VACUUM INTO 导出）
```

它已经带了两道保护：**应用在运行时会拒绝改写**（加 `--force` 才继续），
备份走 `VACUUM INTO` 单文件快照而不是复制 `db/-wal/-shm`（见
[PITFALLS.md 第 24 条](PITFALLS.md)）。

后两个脚本要用 `--import ./runtime/ts-resolve.mjs`：node 24 能直接执行 `.ts`（类型擦除），
但源码里的相对导入是 bundler 风格的无扩展名写法，ESM 解析不了，那个钩子负责补 `.ts`。

## 性能实测

在 release 构建（`pnpm tauri build`，LTO 开启）下实测，测试环境：96 DPI：

| 指标 | 目标 | 实测 | 结论 |
|------|------|------|------|
| 主程序体积 | < 15 MB | **6.85 MB** | ✅ |
| NSIS 安装包 | — | 2.68 MB | — |
| 冷启动到窗口可见 | < 1.5 s | **0.55 s** | ✅ |
| 空闲内存（应用自身进程） | < 80 MB | **25.9 MB** | ✅ |
| 空闲内存（含 WebView2 辅助进程） | < 80 MB | **约 367 MB** | ❌ 超出 |

体积比上一版略增（6.65 → 6.85 MB，安装包 2.48 → 2.68 MB）：其中约 0.2 MB 来自
本轮加入的 25 种语言语法包（前端 23 个按需 chunk 合计约 600 KB，压缩进安装包后约 200 KB）
与跳转到定义、内容嗅探、语言下拉的逻辑；此前那 0.31 MB 增量为自绘菜单引入的剪贴板插件。

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
**约 797 KB**（首屏 JS 775 KB + CSS 17 KB + 图标 5 KB；另有 23 个按需加载的语言 chunk，
合计约 600 KB，只有打开对应语言的文件时才会下载与解析）。
CodeMirror 与 React 都常驻内存但占比很小。
在「Tauri v2 + 系统 WebView2」这一技术选型下（本项目技术栈已定，不得更改），
把含 WebView2 辅助进程的总内存压到 80 MB 以下并不现实。
选择 Tauri 而非 Electron 的收益主要体现在**体积**（6 MB vs 通常 80 MB+）上。

**语言高亮没有让首屏变大。** 用同一套工具链对三个版本各构建一次做 A/B
（M19 用 `git worktree` 检出上一个提交来量，其余两次是同一工作区）：

| 产物 | M19（无语言功能） | M20/M21（语言 + 跳转） | 现在（+ 嗅探 / 语言下拉 / 快捷键 / 帮助 / 滚动条） |
|---|---|---|---|
| 首屏 JS | 769.77 KB | **768.59 KB** | 776.86 KB |
| 首屏 JS（gzip） | 244.41 KB | 242.67 KB | 245.76 KB |
| 首屏 CSS | 15.75 KB | 15.80 KB | 18.81 KB |
| 按需 chunk | — | 23 个语言 chunk，约 600 KB | 同左 + 「使用说明」12.15 KB |

M20/M21 反而小了 1.2 KB：原先 `@codemirror/lang-json` / `lang-yaml` 是静态导入、
必然进首屏（其中 YAML 语法表本身就有 30 KB），现在被拆到按需 chunk 里。
之后加的内容嗅探（一张正则表）、状态栏语言下拉、快捷键、帮助与滚动条共 +8.3 KB ——
相对「把 25 个语法包塞进首屏」（约 600 KB）仍是小两个数量级。
帮助正文一万多字，用 `React.lazy` 拆成独立 chunk（12.15 KB），**不按 F1 就不会加载**。
语法包各自只占内存，实测首次加载 25 种语言合计约 90–100 ms（都是一次性的，之后走缓存）。

### 语言高亮到底吃多少内存（实测）

分三个口径量（脚本见「验收辅助脚本」）：

| 口径 | 实测 | 说明 |
|---|---|---|
| 首次用到某语言时的一次性开销 | 25 种全加载 **+4.6 MB 堆** | `measure-lang-memory.mjs`（node 堆增量，全部保留不回收）。中位数每种约 50 KB，最大是 Markdown 约 1.7 MB（它带一整套 CommonMark 与内嵌语言） |
| 每打开一个文档 | 源码字节的 **1.5–2.7 倍** | 同一份内容建 40 / 10 份并保留，总增量除以份数（含文档文本 + 语法树 + 语言状态）。Python 171 KB → 0.46 MB；3.4 MB → 8.5 MB。JavaScript 更省（1.5 倍） |
| 应用自身进程内存 | **没有可测量的变化** | `measure-langs.ps1` 对四种内容（纯文本 / Python / C++ / 720 KB Python）各启动一次，应用进程都是 25.9–28.1 MB |

WebView2 渲染进程的读数在 100–107 MB 之间来回摆（六进程私有工作集合计），
**与加载了哪种语言无关**：最大的那份语法包（C++，104 KB chunk）反而测到最低值，
2.4 MB 的 Python 文档也没有让它抬高。也就是说单语言的增量低于这套测法的噪声下限（约 ±7 MB），
而「25 种全开」这个上限是 4.6 MB。结论：**按需加载 + 只开了两种语言的实际场景下，
高亮的内存代价可以忽略**；真正会累积的是「同时打开很多大文件」（每份约为源码体积的 2 倍）。

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
- **内存对照**：四种内容各启动一次，应用进程 25.9 / 26.1 / 26.0 / 26.0 MB；
  WebView2 六进程私有工作集 100.4–107.3 MB，与语言无关（见「性能实测」）
- **状态栏显示的是语言表里的名字**：量到的语言胶囊宽度为
  `.txt` 41px、`.py` 42px、`.cpp` 47px，与「纯文本 / Python / C / C++」的字符串宽度一致
  （旧实现只有 JSON / YAML / 纯文本三个值，`.cpp` 会显示成「纯文本」= 41px）
- **25 种语言真的能加载**（`runtime/check-languages.mjs`）：逐个 `await import` 语法包，
  用一段该语言的样例建 `EditorState` 并数语法树的命名节点（全部 > 1），
  顺带核对 24 条「文件名 → 语言」映射（含 `.PY` 大写扩展名、`Dockerfile`、`.env`、认不出的返回 null）
  与 8 条内容嗅探；`text` 返回空扩展、同一语言只加载一次（返回同一扩展对象）
- **跳转规则**（`runtime/check-jump.mjs`）：9 套规则共 60+ 条断言，全部按真实语法树跑
  （引用→定义、`self` / `missing` / `empty` / `unsupported` 四种结论、Python `for ... in`
  的分隔符规则、Rust `impl` 里的类型名只算引用、JSX/TSX 的组件标签与解构参数）；
  1500 行 Python 实测解析 20ms / 首次建索引 3ms / 缓存后 0.01ms
  （索引按 `Tree` 对象缓存，文档一变自动失效）
- **首屏 JS 没有变大**（A/B 构建，见「性能实测」）：769.77 KB → 768.59 KB → 776.86 KB
- **内容嗅探**（`runtime/check-sniff.mjs`）：31 条正向、11 条负向、14 条冲突样本全过；
  负向里有「中文随笔」和「散文里出现 `const`/`SELECT`/`package` 关键词」，
  也有 64 KB 上限（特征在限制之外不算命中）
- **临时标签里的代码真的会高亮**（`runtime/check-highlight.ps1`，新安装产物上实测）：
  - 纯文本负载：token 颜色像素 **0**，状态栏胶囊 **41px**（纯文本）
  - 同样的 `.txt` 临时文件里放 Go：token 颜色像素 **224**
    （keyword `#770088` 58、string `#aa1111` 95、definition `#0000ff` 60、number `#116644` 11），
    状态栏胶囊 **22px**（Go）
  - 同一份 Go 内容，另在 `settings` 里写一行 `lang:<tabId>=python` 再启动：
    状态栏胶囊变成 **48px**（Python + 手动选择的圆点标记），token 组成也随之改变
    —— 一条断言同时证明了「内容嗅探」与「手动选择优先于嗅探且能跨重启」两条链路
- **手动选择的键解析**：`lang:` 前缀、认不出的值丢弃、空 tabId 丢弃、不影响其它设置
- **快捷键**（`runtime/check-shortcuts.mjs`）：keymap facet 里 `Mod-f` / `Mod-r` / `Mod-g` /
  `F1` / `F3` 都在，`Mod-h` 已无绑定；`Mod-r` 的 `run` **就是** `openSearchPanel`、
  `Mod-g` 的是 `gotoLine`（函数同一性）；`Mod-g` 在扁平化后的绑定表里排在
  CodeMirror 那条 findNext 之前（`Prec.highest` 真的生效）；菜单里 查找/替换/转到行
  的加速键分别是 `Ctrl+F`/`Ctrl+R`/`Ctrl+G`、编辑菜单里不再出现 `Ctrl+H`、
  帮助第一项是「使用说明」且加速键为 `F1`；窗口级兜底用 `window` 桩喂假事件，
  验证 `Ctrl+F`/`Ctrl+R`/`Ctrl+G`/`F1` 真的走到对应动作、`Ctrl+H` 什么都不做、
  已 `preventDefault` 的事件被跳过、`dispose` 后监听器被摘掉
- **滚动条**：
  - 规则层（`runtime/check-scrollbar.mjs`，读产物并归一化压缩写法）：全局
    `::-webkit-scrollbar` 宽 8px、轨道与角落透明、拇指常显（token 色，不是 transparent）、
    拇指 hover/active 加深、箭头隐藏、没有混用 `scrollbar-width`、标签栏仍完全隐藏，
    并且**断言两条回归**——产物里不能出现 `*:hover::-webkit-scrollbar-thumb`
    （会因 `body:hover` 一直显着）、也不能出现透明的空闲拇指（Chromium 不保证宿主 hover 重绘）；
    编辑器的 `.cm-scroller` 是 14px、轨道透明、拇指 `var(--app-scroll-thumb)` +
    `border:3px solid transparent` + `background-clip:content-box`（可见 14−3×2 = 8px）、
    没有 `.cm-scroller:hover` 那条宿主规则
  - 像素层（`runtime/check-scrollbar.ps1`，种入长文档后量编辑器右缘 14px）：
    默认 Chromium 轨道色 `#f1f1f1` **0 像素**、默认拇指色 `#c1c1c1` **0 像素**、
    正文侵入该条 **0 像素**；拇指**画出来了**：颜色 = 空闲 token 叠白底的 `#D8D8D8`，
    可见宽度 **8px**、左右各内缩 **3px**（14 − 3×2 的几何）。
    在真实运行的应用上（`runtime/inspect-window.ps1`，不种数据不杀进程）同一处
    读数为 **2400 像素 = 8px × 300 行**，默认轨道 0 像素
- **首屏 JS**：776.86 KB（「使用说明」12.15 KB 走 `React.lazy` 独立 chunk，
  不按 F1 不加载；M19 是 769.77 KB，语言功能那次反而小了 1.2 KB）

需要人工在界面上确认（无法脚本化）：

- **三个快捷键真的打开对应面板**：`Ctrl+F` / `Ctrl+R`（同一个搜索面板，焦点在搜索框）/
  `Ctrl+G`（转到行对话框，可写「行:列」）；`Ctrl+H` 无反应
- **`F1` / 帮助 ▸ 使用说明**：弹窗渲染、左侧目录跳转、`Esc` 与点外部关闭
- **滚动条的悬停加深**：指针真的落在拇指上时变深、拖动时最深（照 VS Code 的行为；
  不做「不悬停就透明」，原因见上面的滚动条一节）
- **语言下拉的交互**：点胶囊展开 / 再点关闭 / 点外部关闭 / `Esc` 关闭并回到编辑器 /
  `↑↓` 移动 / `Enter` 选中；选完后面板上的勾与状态栏的圆点标记
- **`Ctrl+Click` / `F12` 跳转、`Alt+←` 回退、悬停虚线下划线**：
  合成鼠标事件会被 WebView 当成不可信事件，且本机前台窗口是远程桌面会话，
  无法注入输入，只能人工点一次
- **`Alt+Click` 多光标**（本轮把它从 `Ctrl+Click` 换了过来，同样是 CodeMirror 原生能力）

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
