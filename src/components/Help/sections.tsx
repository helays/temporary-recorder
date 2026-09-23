import type { ReactNode } from "react";

/**
 * 「使用说明」正文。
 *
 * 手写 TSX 而不是渲染 Markdown：渲染 markdown 要引一个解析器，和这个项目的
 * 「轻」定位不符。代价是这份内容要和 README 手工同步（README 的快捷键表、
 * 菜单表、语法高亮与跳转三节是同一份事实）。
 *
 * 每节带一个 id，供左侧目录做锚点跳转。
 */

export interface HelpSection {
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
}

/** 快捷键表：与 README 的表格保持一致 */
const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ["拖入文件", "打开文件（可一次拖多个）"],
  ["Ctrl+N / Ctrl+T", "新建标签（在临时目录建文件）"],
  ["Ctrl+O", "打开文件（已在某标签打开则直接切过去）"],
  ["Ctrl+S", "保存（临时标签会转为「另存为」；真实文件强制写盘）"],
  ["Ctrl+Shift+S", "另存为"],
  ["Ctrl+,", "设置"],
  ["Ctrl+W", "关闭当前标签"],
  ["Ctrl+Tab / Ctrl+Shift+Tab", "下一个 / 上一个标签"],
  ["Ctrl+PageDown / Ctrl+PageUp", "同上（备用，部分环境会拦截 Ctrl+Tab）"],
  ["Ctrl+1 … Ctrl+9", "切到第 N 个标签"],
  ["Ctrl+F", "搜索"],
  ["Ctrl+R", "替换（同一个面板，面板里带替换输入框）"],
  ["Ctrl+G", "转到行（可写「行」或「行:列」；Ctrl+Alt+G 同样可用）"],
  ["F3 / Shift+F3", "下一个 / 上一个匹配"],
  ["Shift+Alt+F", "格式化（按内容自动识别 JSON / YAML）"],
  ["Shift+Alt+M", "压缩（仅 JSON）"],
  ["Ctrl+D", "选下一个相同词"],
  ["Alt+Click", "多光标"],
  ["F12 / Ctrl+Click", "跳转到名字的定义（同一文件内）"],
  ["Alt+←", "回到上一次跳转前的位置"],
  ["F1", "本使用说明"],
];

function Table({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  return (
    <table className="w-full border-collapse text-xs">
      <tbody>
        {rows.map(([keys, what]) => (
          <tr key={keys} className="border-b border-app-border/60 last:border-0">
            <td className="w-[42%] py-1 pr-3 align-top font-mono whitespace-nowrap text-app-fg">
              {keys}
            </td>
            <td className="py-1 align-top text-app-muted">{what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function List({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="ml-4 list-disc space-y-1 text-xs leading-relaxed text-app-muted">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** 行内代码/键名 */
function K({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-app-hover px-1 font-mono text-[11px] text-app-fg">
      {children}
    </code>
  );
}

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "open-save",
    title: "打开与保存",
    body: (
      <>
        <List
          items={[
            <>
              打开文件：把文件<strong>拖进窗口</strong>（可一次多个）、
              <K>Ctrl+O</K>，或 文件 ▸ 打开…
            </>,
            <>
              保存：<K>Ctrl+S</K>；另存为：<K>Ctrl+Shift+S</K>。
              新建标签的内容先落在临时目录，<K>Ctrl+S</K> 会直接问你要另存到哪。
            </>,
            <>
              自动保存：停止输入约 0.8 秒后写回文件。临时文件总是写；
              真实文件的自动保存受「设置 → 打开的文件自动保存」控制。
            </>,
            <>
              写入是<strong>原子</strong>的：先写同目录临时文件再改名覆盖，写一半失败不会截断原文件。
            </>,
            <>
              编码与换行统一为 <strong>UTF-8 无 BOM + LF</strong>；读入时会去掉 BOM 并把 CRLF 归一为 LF。
              非 UTF-8（如 GBK）会明确报错，不会产生乱码。
            </>,
            <>
              文件被别的程序改过时<strong>不会覆盖</strong>，只在状态栏提示，此时 <K>Ctrl+S</K> 可强制覆盖。
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "tabs",
    title: "标签",
    body: (
      <List
        items={[
          <>
            新建 <K>Ctrl+N</K> 或 <K>Ctrl+T</K>；关闭 <K>Ctrl+W</K>（内容已实时落盘，不会丢）。
          </>,
          <>
            切换：<K>Ctrl+Tab</K> / <K>Ctrl+Shift+Tab</K>、<K>Ctrl+PageDown</K> / <K>Ctrl+PageUp</K>、
            <K>Ctrl+1</K> … <K>Ctrl+9</K>；鼠标直接点也行。
          </>,
          <>双击标签名可以重命名（只改显示名，不改文件名）；拖动标签可以排序。</>,
          <>
            <strong>关闭临时标签不会删除它的文件</strong>——内容仍能在临时目录里找回。
            清理交给 设置 ▸ 清理未使用的临时文件（只清理没有被任何标签引用的文件）。
          </>,
        ]}
      />
    ),
  },
  {
    id: "edit-format",
    title: "编辑与格式化",
    body: (
      <>
        <List
          items={[
            <>
              撤销 <K>Ctrl+Z</K>、重做 <K>Ctrl+Shift+Z</K>、全选 <K>Ctrl+A</K>；
              剪切 / 复制 / 粘贴在 编辑 菜单里，走系统剪贴板。
            </>,
            <>
              格式化 <K>Shift+Alt+F</K>：按内容自动识别 JSON / YAML，输出 2 空格缩进；
              压缩 <K>Shift+Alt+M</K>：仅 JSON，去掉所有非必要空白。
            </>,
            <>
              格式错误不会弹窗打断，而是在状态栏给出<strong>第几行第几列</strong>与原因。
            </>,
            <>YAML 从零手写时按回车也会缩进（内置一条缩进兜底规则）。</>,
          ]}
        />
      </>
    ),
  },
  {
    id: "search-jump",
    title: "查找与跳转",
    body: (
      <>
        <List
          items={[
            <>
              搜索 <K>Ctrl+F</K>、替换 <K>Ctrl+R</K>（同一个面板，面板里带替换输入框）；
              <K>Ctrl+G</K> 转到行，可写 <K>行</K> 或 <K>行:列</K>。
            </>,
            <>搜索面板支持正则表达式、大小写敏感、全词匹配三个开关；<K>F3</K> / <K>Shift+F3</K> 上下一个匹配。</>,
            <>
              跳转到定义：<K>F12</K> 或 <K>Ctrl+Click</K>。支持 JavaScript / TypeScript / JSX / TSX、
              Python、Rust、Go、Java、C / C++，以及 YAML 的锚点与别名；只在当前文件内查找。
            </>,
            <>
              <K>Alt+←</K> 回到跳转前的位置（每个标签各记 50 层）。
              光标下的名字有定义时会显示虚线下划线。
            </>,
            <>
              多光标用 <K>Alt+Click</K>（<K>Ctrl+Click</K> 已让给跳转）；<K>Ctrl+D</K> 依次选中下一个相同词。
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "highlight",
    title: "语法高亮",
    body: (
      <>
        <List
          items={[
            <>
              内置 25 种语言：JavaScript / TypeScript / JSX / TSX、Python、C / C++、Rust、Go、Java、
              JSON、YAML、TOML、INI、HTML、CSS、XML、Markdown、SQL、Shell、PowerShell、
              Dockerfile、Lua、Ruby、Perl、R。
            </>,
            <>
              打开文件时按<strong>文件名</strong>确定语言；新建的临时标签没有文件名可依，就
              <strong>按内容猜</strong>（先认代码特征，再认 JSON / YAML，都不像就是纯文本）。
            </>,
            <>
              认错了或认不出来：点状态栏左侧的语言名手动指定，下拉里还有「自动识别」可以还原。
              <strong>选择会记住</strong>，重启后仍然有效。优先级：手动选择 &gt; 文件名 &gt; 内容。
            </>,
            <>内容超过 5 MB 时会自动关闭语法高亮（状态栏会说明），保证输入不卡；缩回阈值内会自动恢复。</>,
            <>语法包是按需加载的：没打开过的语言不占内存，也不会进首屏。</>,
          ]}
        />
      </>
    ),
  },
  {
    id: "appearance",
    title: "外观与窗口",
    body: (
      <List
        items={[
          <>主题在 查看 ▸ 主题 里切换：跟随系统 / 浅色 / 深色。</>,
          <>窗口是无边框的，顶部一行是「图标 + 菜单 + 窗口按钮」；拖动这行空白处移动窗口。</>,
          <>拖四条边或四个角缩放窗口；双击标题栏空白处最大化 / 还原。</>,
          <>
            菜单可用键盘操作：<K>←</K> / <K>→</K> 换顶级菜单，<K>↑</K> / <K>↓</K> 移动高亮，
            <K>Enter</K> 执行，<K>Esc</K> 关闭。
          </>,
        ]}
      />
    ),
  },
  {
    id: "settings",
    title: "设置",
    body: (
      <List
        items={[
          <>打开方式：<K>Ctrl+,</K> 或 设置 ▸ 打开设置…</>,
          <>主题：跟随系统 / 浅色 / 深色。</>,
          <>临时目录：查看当前生效目录、选择新目录、恢复默认、在资源管理器中打开。改动只影响之后新建的标签。</>,
          <>打开的文件自动保存：开关。</>,
          <>临时文件：显示总数与未被引用的数量，手动清理（删除前二次确认）。</>,
        ]}
      />
    ),
  },
  {
    id: "data",
    title: "数据与文件位置",
    body: (
      <>
        <List
          items={[
            <>
              数据库（只存标签元数据与会话）：<K>%APPDATA%\com.temporary.recorder\recorder.db</K>
            </>,
            <>
              临时目录默认在 <K>%LOCALAPPDATA%\com.temporary.recorder\temp</K>，
              刻意不用系统 <K>%TEMP%</K>（那里会被系统清理工具清掉）。
            </>,
            <>
              <strong>内容以文件为准</strong>：每个标签都绑定一个文件，数据库只记它在哪里。
            </>,
            <>卸载默认<strong>不会</strong>删除你的记录（卸载向导上的「Delete app data」默认不勾选）。</>,
          ]}
        />
      </>
    ),
  },
  {
    id: "shortcuts",
    title: "快捷键总表",
    body: <Table rows={SHORTCUTS} />,
  },
];
