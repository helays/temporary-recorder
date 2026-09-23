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
