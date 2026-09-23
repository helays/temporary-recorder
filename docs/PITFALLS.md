# 踩坑记录

开发这个项目时踩到并修掉的问题，逐条记录。每条都写清了**现象 → 原因 → 修法**，
它们的共同特点是「不看日志很难定位」，下次遇到同类问题可以直接对照。

返回 [README](../README.md) ｜ 开发与验收见 [DEVELOPMENT.md](DEVELOPMENT.md)

## 1. Tauri v2 权限：默认不给写入能力

两个坑都只在运行时暴露，不看日志很难定位：

- **`sql:default` 只授予 `allow-close` / `allow-load` / `allow-select`**，
  **不含 `allow-execute`**。不显式加上 `sql:allow-execute`，所有写入（自动保存、
  新建/关闭标签）都会失败。已写入 `src-tauri/capabilities/default.json`。
- **`core:window:default` 只授予只读 getter**，不含 `show` / `set-size` /
  `set-position` / `center` / `destroy`。缺了它们，窗口会一直不可见
  （因为配置里是 `visible: false`，靠前端调用 `show()` 才显示），
  窗口几何也无法恢复。已在 capability 中显式补齐。

## 2. SQLite 占位符是 `$1` 而不是 `?`

`tauri-plugin-sql` 经 sqlx 执行，SQLite/Postgres 用 `$1, $2, ...`，只有 MySQL 用 `?`。
用 `?` 会直接报错。另外该插件只暴露 `execute` / `select`，**没有事务 API**，
所以标签排序用单条 `CASE` 语句一次写完，而不是多次往返。

## 3. 窗口几何：inner 与 outer 必须配对

Tauri 的 `setSize()` 设置的是**客户区**尺寸，而 `outerSize()` 读的是含标题栏与边框的
外框尺寸（实测相差 16×39）。两者混用会导致**每次重启窗口都按边框尺寸长大一圈**。
现在统一为 `innerSize()` 采集 + `setSize()` 恢复，位置则用
`outerPosition()` + `setPosition()` 配对，并存逻辑像素以免 DPI 变化后错位。

## 4. 自动保存：防抖器必须按标签隔离

内容保存、光标/滚动、窗口几何分别有 800ms / 1s / 500ms 的防抖。
关键点是：**每个标签各自持有一个防抖器，闭包捕获自己的 `tabId`，落库时再从该标签的
`EditorState` 读取内容**。若全局共用一个防抖器，用户「在 A 输入后立刻切到 B」时，
A 的待保存内容会被 B 的内容覆盖。

## 5. CodeMirror 不允许在 updateListener 里 dispatch

大文件降级要动态卸载语言扩展，但 `updateListener` 内不能再次 `dispatch`
（CodeMirror 会抛「update in progress」），因此把重新配置推迟到本次更新之后。

## 6. 新版 V8 不再给 JSON 错误位置

对 `Unexpected token` 这类最常见错误，V8 现在只输出出错片段
（`Unexpected token ',', ..."片段"... is not valid JSON`），不再提供
`position` / `line` / `column`。为了满足「显示错误位置」的要求，
`src/utils/jsonError.ts` 实现了一个只做结构校验的轻量定位器，
仅在 `JSON.parse` 失败后运行。它已与 V8 自身的报错做过交叉验证
（见 `runtime/check-json-error.mjs`）。

## 7. `runtime/` 下的 `.ps1` 必须只用 ASCII

PowerShell 读取无 BOM 的脚本文件时按系统代码页解码，UTF-8 中文会变乱码，
且可能产生破坏字符串结束符的字节（本项目实际踩到过）。
因此 `runtime/*.ps1` 刻意只写英文；`.mjs` 由 Node 按 UTF-8 读取，可正常使用中文。

**这个坑至今踩了 4 次**，症状每次都不同，值得把清单记下来：

- 注释里的中文让 `param(...)` 块报 `Missing expression after ','`（语法直接挂）；
- 输出字符串里的中文变成乱码打印出来；
- 最近一次最阴：一行中文注释把**紧跟着的那条赋值语句吞掉**了，
  于是 `$thumbR` 是 `$null`，后面 `[Math]::Abs($c.R - $thumbR) -le 2` 恒为假，
  脚本不报错、只是安静地输出 `0 像素` —— 我差点把它当成"滚动条没画出来"。

所以：写完 `.ps1` 一定要跑一遍非 ASCII 检查（`runtime/` 里现在也留着一段一次性检查代码），
别只看"脚本没报错"。

## 8. 安装程序会把上次的安装路径「钉住」

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

## 9. WebView2 会抢走 Ctrl+F（此前一直是失效的）

wry 默认把 WebView2 的 `AreBrowserAcceleratorKeysEnabled` 保持为默认值 `true`，
于是 **Ctrl+F / F3 打开的是 WebView2 自带的「页内查找」**，CodeMirror 的搜索面板根本打不开
——自带查找条没有正则 / 大小写 / 全词，也没有替换。
（当时只有 `Ctrl+N` 与 `Ctrl+H` 不在被抢的列表里；`Ctrl+P` / `Ctrl+R` / `F12` / 缩放会被抢。
后来应用的「替换」从 `Ctrl+H` 改成了 `Ctrl+R`，能用就是因为下面这个开关已被关掉——
详见第 27 条。）

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

## 10. `lang-yaml` 的缩进在「从零写 YAML」时不生效

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

## 11. React StrictMode 会把启动流程跑两遍

开发模式下 `useEffect` 执行两次。启动流程里凡是不幂等的副作用都要留意。
本例对产品代码是安全的（内容迁移与建文件都幂等，带副作用的监听器都在 `cancelled`
检查之后才注册），但如果把一次性自检脚本写成固定文件名，两遍并发就会互相删掉
对方刚写的文件，从而报出**看起来像产品缺陷、实则是脚手架问题**的假故障。
排查这类「现象自相矛盾」的问题，最快的办法是在 Rust 侧加一行日志，
确认到底哪条分支真的执行了（本次就是靠它定位的）。

## 12. `dragDropEnabled` 默认是 `true`，且会关掉网页自己的拖放

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

## 13. 自绘菜单取代原生菜单栏后，快捷键必须自己补一层

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

## 14. 无边框窗口：`decorations: false` 不等于「裸窗」

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

## 15. 剪贴板插件的默认权限集是**空的**

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

## 16. `data-tauri-drag-region` 的三个细节

自绘标题栏的拖动靠 Tauri 注入的脚本（`src/window/scripts/drag.js`），有三点不查源码就容易踩：

- 属性值有**语义差别**：裸写 / `"true"` = 只有点到该元素本身才拖；
  **`"deep"` = 子树内任意位置都能拖**；`"false"` = 这里禁止拖（并向上屏蔽）。
  标题栏整行用 `deep` 最省事。
- **`<button>` / `<a>` / `role="menuitem"` 等可点元素会自动阻断拖动**，
  所以菜单按钮和窗口按钮不用额外处理；但反过来说，**菜单下拉面板必须显式写
  `data-tauri-drag-region="false"`**，否则点面板的空白处会把窗口拖走。
- **双击拖动区切换最大化是脚本自带的**（`e.detail === 2` 时发
  `internal_toggle_maximize`），不需要自己写 `onDoubleClick`。

## 17. `LanguageDescription.matchFilename` 比扩展名时大小写敏感

`@codemirror/language` 的 `matchFilename(descs, filename)` 先比每条语言的 `filename`
正则，再取**最后一个点之后**的部分与 `extensions` 数组比对，而且：

- `extensions` 里写的是**不带点**的扩展名（`["json"]`，不是 `[".json"]`）；
- 那个比对是 `indexOf`，**大小写敏感**（源码里是 `d.extensions.indexOf(ext[1])`）。

于是 `MAIN.PY` 这种全大写扩展名匹配不上。`languageIdFromPath` 的做法是原文与小写
文件名各试一次：小写那份保证扩展名命中，原文那份保证 `filename` 正则（如
`/^Dockerfile$/i`，靠正则自己的 `i` 标志）命中——先把文件名整体小写会反而漏掉后者。

## 18. `legacy-modes` 的文件名与导出名不一致，写错是静默失效

`@codemirror/legacy-modes/mode/dockerfile` 导出的是 `dockerFile`（大写 F），
`mode/powershell` 导出的是 `powerShell`。TypeScript 会拦住写错的导出名，
但**动态 `import()` 里取错属性名不会崩**——只是这个语言永远没有高亮。

所以有一条针对性检查：`runtime/check-languages.mjs` 把 25 种语言**逐个真加载**并用样例
建 `EditorState` 数语法树节点数，加载失败或取到 `undefined` 立刻暴露。

## 19. 没有 `EditorView` 时 `syntaxTree()` 只返回已解析的前缀

CodeMirror 的解析是**惰性**的：视口内的部分先解析，其余在后台推进。没有挂载
`EditorView`（例如纯 node 断言里）时后台解析不会推进，`syntaxTree(state)` 对一篇 23 KB 的文档
只给出开头一小段——在文末按位置查定义会得到「找不到」，看起来像跳转有 bug。

修法是显式补解析：应用里用 `ensureSyntaxTree(state, state.doc.length, 500)`
（带毫秒上限），node 断言里同样。

## 20. Windows 上 `Ctrl+Click` 本来是「加光标」

`@codemirror/view` 里 `clickAddsSelectionRange` 的默认值是
`browser.mac ? metaKey : ctrlKey`（见 `dist/index.js` 的 facet 定义），
也就是说 **Windows 上 Ctrl+Click = 多光标**。要让位给「跳转到定义」，必须显式
`EditorView.clickAddsSelectionRange.of((e) => e.altKey)`，否则两种行为会同时触发：
既跳转又加一个光标。

副作用是**多光标从此变成 `Alt+Click`**（与 VS Code 一致）。矩形选择用的是
`Alt+拖动`（`rectangularSelection` 的默认 filter 是 `e.altKey && e.button == 0`），
`crosshairCursor` 默认也是 Alt，两者都不受影响。

## 21. 内容嗅探把 `def f():` 当成 YAML

按内容嗅探语言时复用的是格式化那套 `detectFormat`：它只在
「js-yaml 解析出的顶层值是对象 / 数组」时认 YAML。而 `def f():\n    return x`
恰好是一个合法的 YAML 映射（键 `def f()`，值 `return x`），于是会被判成 YAML。

**这一条后来被彻底改掉了**：`services/sniff.ts` 的代码特征现在排在 `detectFormat` 之前，
Python 片段按 Python 走（JSON / YAML 的判定语义没变，只是让出了代码这一块）。
真正暴露它的场景是「新建标签里粘贴一段代码」——临时文件固定叫 `未命名 1-xxxx.txt`，
扩展名给不出任何信息，只能靠内容猜，于是这个错误判断直接变成了用户可见的「没高亮 / 颜色不对」。

留在这里的教训是：**宽松的嗅探必须配负向样本**。现在的
`runtime/check-sniff.mjs` 里，负向（中文随笔、散文里出现 `const`/`SELECT` 关键词）
与正向样本是同等重要的——嗅探最烦人的错法是把随笔染成代码。

## 22. pnpm 的严格目录布局：`@lezer/common` 不在根 `node_modules`

类型里需要 `Tree` / `SyntaxNode` 时，`import type { Tree } from "@lezer/common"` 会直接
解析失败——`@lezer/common` 只是 `@codemirror/language` 的传递依赖，pnpm 不会把它平铺到根。

两条路：把它显式写进 `dependencies`，或者从已有 API 反推类型。这里选了后者：

```ts
type SyntaxTree = ReturnType<typeof syntaxTree>;
type TreeNode = SyntaxTree["topNode"];
```

不新增依赖，也不影响运行时（`Tree` 本来就来自 CodeMirror）。

## 23. `rmdir /s` 会穿透 junction 删掉真实目标

做 A/B 构建时用 `git worktree add runtime/baseline` 建了一份旧提交的检出，并把
`runtime/baseline/node_modules` 做成指向项目 `node_modules` 的 **junction**。
清理时用 `cmd /c "rmdir /s /q runtime\baseline"` —— 结果**删穿了 junction**，
把项目真正的 `node_modules` 删掉了一部分（`node_modules/.bin` 被清空，
`pnpm type-check` 直接报 `'tsc' is not recognized`）。

三个要点：

- Windows 上 `rmdir /s` / `Remove-Item -Recurse` 会**跟随目录 junction**；
  `del`/`rmdir`（不带 `/s`）对 junction 本身只删链接，安全得多。
- 恢复成本很低但**不要用 `pnpm install`**：`.modules.yaml` 记着"已装"，
  它只会补几个包，缺的链接照旧缺（实测 `Packages: +4` 就结束了，type-check 依旧失败）。
  正确做法是 `pnpm install --force`（重新解析并重建全部链接，从本地 store 走，6 秒）。
- `git worktree remove` 在这些文件存在时也会失败（"Directory not empty"），
  先手动清空目录再 `git worktree prune`。

教训：临时检出**不要**把 `node_modules` 以 junction 指回工作区；要么在 worktree 里
单独装一次，要么清理由 `git worktree remove --force` 完成。

## 24. WAL 数据库不能按文件复制备份；也不要在用户正用着应用时做种子实验

做语言内存对照需要往 `tabs` 表种数据，做法是先备份 `recorder.db`。第一版备份是
**直接复制 `recorder.db` + `-wal` + `-shm` 三个文件**，恢复时再一起复制回去——看起来
万无一失，实际上恢复出来的库**少了一行标签**：主文件与 WAL 是两套状态，
三个文件分别复制得到的快照不保证能拼回同一个时刻（`-shm` 里还有一份索引）。

正确做法是用 SQLite 自己导出一份干净快照，不碰原库：

```js
db.exec(`VACUUM INTO '${snapshotPath}'`);   // 单文件、无 WAL、一致
```

恢复时同时删掉旧的 `-wal` / `-shm`（只换主文件会把旧 WAL 嫁接到新库上）。

还有一条更重要的教训：这些脚本会**改写用户真实的标签表**，而用户可能正开着应用在记东西。
本轮就赶上了：用户在实验期间往一个标签里粘了一大段 Go 代码（自动保存写进临时文件），
而恢复备份把那一行顶掉了 —— 文件还在，但已变成"无人引用的孤儿"，
用「清理未引用的临时文件」就会把它删掉。

所以 `measure-langs.mjs` 现在有两道保护：改写前先 `tasklist` 查一遍
`temporary-recorder.exe`，在跑就拒绝执行（要强行执行得显式加 `--force`）；
`check` 子命令则用来在不改动任何东西的前提下看一眼现状（应用是否在跑、有几个标签、哪个是激活的）。

## 25. 「多个可选证据」被写成了「全部成立」

写特征表时给辅助函数定了两种语义：

```js
const allAny = (required, any) => (head) =>
  required.every((p) => p.test(head)) && any.some((p) => p.test(head));
```

PowerShell 那条规则我本意是「（`$x =` 或 `param(` 或 `function Xxx`）**且**出现 cmdlet」，
却把三个可选证据一起塞进了 `required` —— 于是变成「三个都要出现」，
`$total = 1\nWrite-Output $total` 反而不命中，嗅探结果是纯文本。

阳性样本断言当场把它抓出来了（`check-sniff.mjs`），修法是另加一个语义明确的
`someAndAny(primary, secondary)`。教训：**同一个 helper 不要同时承担「任一」和「全部」
两种直觉**，名字里就把语义写清楚，并且第一批断言必须包含「只满足其中一个条件」的样本。

## 26. 面板里的滚动条很粗；CodeMirror 根本不提供滚动条样式

现象：语言下拉（`overflow-y-auto`）与设置弹窗的滚动条是 Windows 默认那根——约 17px、
浅灰实色轨道、两端各一个箭头按钮，在自绘的窄面板里非常抢眼；编辑器右侧那根同样是默认样式。

两件事值得记下来：

- **CodeMirror 6 完全不管滚动条**。查 `@codemirror/view` 的 baseTheme：`.cm-scroller`
  只声明了 `overflow-x: auto`（竖轴会被 CSS 规则推导成 auto），没有任何 `::-webkit-scrollbar`
  规则。真正的滚动元素是 `.cm-scroller`（也就是 `view.scrollDOM`），要改必须自己写这个选择器；
  写 `.cm-editor` 或 `.cm-content` 都没用。
- **`::-webkit-scrollbar` 与 `scrollbar-width` / `scrollbar-color` 不要混用**。
  WebView2 就是 Chromium，两套机制同时出现时后者会走标准滚动条路径，
  宽度就变得不可预期（`scrollbar-width: thin` 会覆盖掉你写的 `width: 8px`）。
  这里只用 `::-webkit-scrollbar`，宽度精确可控——8px 给面板，14px 给编辑器（VS Code 口径）。
  唯一例外是标签栏：`.tabstrip` 用 `scrollbar-width: none` + `display: none` **完全隐藏**
  （两个内核都照顾到，且它本来就不需要滚动条）。

### 追加：别做「不悬停就完全透明」

第一版做成了「空闲全透明、鼠标进入容器才浮现」，结果被用户当场抓出两个 bug：

- **鼠标放上去不出现，得点一下才出来**：Chromium 不保证在宿主元素 `:hover` 时重绘滚动条
  伪元素，一次点击/拖动才会触发重绘刷新；而 `::-webkit-scrollbar-thumb:active`
  （拇指自身的状态）是规范里的常规用法，反而稳。
- **鼠标移进内容区也不隐藏**：`*:hover::-webkit-scrollbar-thumb` 里的 `*:hover` 会命中
  `body` 这类**祖先**——只要指针在窗口里 `body:hover` 就成立，于是滚动条一直显着。
  而且 `.cm-scroller:hover` 这种「宿主 hover」的语义本来也不是「指到滚动条上」。

改成 VS Code 的做法后两个问题都消失：**拇指常显但克制**（`rgba(100,100,100,.25)`，
白底上约 `#D8D8D8`），只在 `::-webkit-scrollbar-thumb:hover`（指针真的在拇指上）
与 `:active`（拖动）时加深。附带的好处是常显状态可以被截屏量到，
于是 `check-scrollbar.ps1` 现在能直接断言「拇指可见宽度约 8px、左右各内缩 3px、
轨道无实色、无箭头」——而「悬停才出现」这种行为**根本没法用 PrintWindow 验证**
（截屏时鼠标不在窗口里，拇指是透明的）。

## 27. `Ctrl+R` 能用，是因为浏览器加速键被关掉了

`Ctrl+R` 在浏览器里是「重新加载」。本项目能把它当「替换」用，是因为启动时在 Rust 侧调了
`SetAreBrowserAcceleratorKeysEnabled(false)`（见 `src-tauri/src/lib.rs`，注释里点名了
Ctrl+F / Ctrl+P / Ctrl+R / F12）。**如果哪天这个开关被去掉或调用失败**，
`Ctrl+F` 会变回 WebView2 自带的查找条、`Ctrl+R` 会重新加载页面、`F12` 会打开开发者工具。
日志里有一行「已关闭浏览器加速键」可以确认；失败时也会打印原因。

同时记一下 `Ctrl+G`：CodeMirror 的 `searchKeymap` 里本来就有 `Mod-g`（面板内的「下一个匹配」，
带 `scope`）。要让应用级的「转到行」稳定赢，不能靠扩展顺序，得显式
`Prec.highest(keymap.of([...]))`；`check-shortcuts.mjs` 断言的是 facet 扁平化后的下标
（我们的排前面），而不是「键名对得上」。

## 28. 第一次配 GitHub Actions：几个只在 CI 上才会暴露的点

本项目仓库是公开的（Actions 分钟数免费），未签名构建也不需要任何密钥，配起来本来很简单，
但下面几条是踩过才知道的：

- **runner 要用 `windows-latest`，不要图快用 ubuntu**。pnpm 的锁文件是在 Windows 上生成的，
  `@rollup/rollup-*`、`esbuild` 这些 optional 依赖按平台分发，换平台经常报
  「Cannot find module @rollup/rollup-linux-x64-gnu」。本项目的构建本来就只面向 Windows，
  让 CI 与开发平台一致最省事。
- **本地 `.cargo/config.toml` 不能提交**。它是 USTC 镜像（本机 crates.io 拉不动才加的），
  已 gitignore；CI 直连 crates.io 没问题。要是把它提交上去，GitHub runner 反而会去访问 USTC。
- **版本号散在三个文件里**：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`。
  产物名（`闪记_<版本>_x64-setup.exe`）与 exe 版本资源都取自它们。手工改三处早晚不一致，
  所以由 CI 在读 tag 时用 `.github/scripts/set-version.mjs` 统一写；脚本要求每个文件
  「恰好一处版本声明」，找不到或多处就失败（宁可红，也不要静默改错文件）。
- **`tauri-action` 需要显式 `tauriScript: pnpm tauri`**，否则它按 npm 跑。
- **`uploadUpdaterJson`（旧名 `includeUpdaterJson`）默认是 `true`**（会往 Release 上传
  `latest.json`）。本项目没有 updater 插件，要显式关掉，免得 Release 里多一个没人用的资源。
- **`includeUpdaterJson` 在 `tauri-action@v1` 里改名叫 `uploadUpdaterJson`**，默认值仍然是
  `true`。这类改名最阴的地方是：**写旧名不会报错**，GitHub 只对「未知输入」发一条警告，
  构建照跑，于是 Release 里悄悄多出 `latest.json`。升级 action 主版本后要对着
  `action.yml` 的 `inputs:` 逐个核一遍参数名，别只信记忆。
- **`tauri-action@v1` 的另一个破坏性变更**：`releaseDraft: true` 时，如果该 tag 对应的
  Release 已经不是草稿（比如已经点过 Publish），action 会**直接失败**而不是把草稿状态改回去。
  发版后重跑同一个 tag 的 workflow 会红，这是有意设计，不是构建出错。
- **action 的运行时版本要跟着升**。首次配置时 `actions/checkout`、`actions/setup-node`、
  `pnpm/action-setup` 钉的还是 `v4`，这版跑在 **node20** 上——而 node20 运行时已被 GitHub
  弃用，CI 日志里会出现一条
  「Node.js 20 is deprecated … but are being forced to run on Node.js 24」的警告，
  GitHub 直接把它们改跑 node24。迁到 node24 的版本分别是：`checkout` / `setup-node` **v5+**、
  `pnpm/action-setup` **v5+**、`actions/upload-artifact` **v5+**
  （`Swatinem/rust-cache@v2` 与 `tauri-apps/tauri-action@v0` 当时已经是 node24，
  `dtolnay/rust-toolchain` 是 composite，不涉及 node 运行时）。
  注意 `upload-artifact@v4` 这条坑只有 `release.yml` 跑起来才会暴露——`ci.yml` 里没有它，
  日常校验全是绿的也可能带着一个 node20 的 action。
  `runtime/check-workflows.mjs` 里有一张「最低主版本」表，任何 action 低于它就判失败。
- **`tagName` 留空 = 不创建 Release**，正好用来支持「手动触发只构建不发版」。
- **未签名安装包**：下载时 SmartScreen 会提示「未知发布者」——这是没有代码签名证书的必然结果，
  不是构建出错。
- **CI 跑不了 `runtime/` 的验收脚本**（AGENTS 规定该目录不提交）。CI 只能保证类型检查、
  前端构建与安装包产出；像素级/纯函数断言仍然只在本地跑。
