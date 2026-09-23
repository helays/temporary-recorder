import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
  type Command,
} from "@codemirror/view";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";
import { history, redo, selectAll, undo } from "@codemirror/commands";
import {
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from "@codemirror/search";
import { loadLanguageExtension, sniffLanguageId } from "../services/languages";
import type { LanguageId, ResolvedTheme } from "../types/models";
import { LARGE_CONTENT_THRESHOLD } from "../utils/text";
import { debounce, type Debounced } from "../utils/debounce";
import { jumpExtension, type JumpMessageKind } from "./jump";
import { appKeymap, type AppKeymapHandlers } from "./keymap";
import { editorThemeExtension } from "./theme";

/** 用户停止输入 800ms 后把当前标签内容落库 */
export const CONTENT_SAVE_DELAY = 800;
/** 光标 / 滚动位置 1 秒防抖落库 */
export const CARET_SAVE_DELAY = 1000;
/**
 * 语言探测防抖。刻意比落库（800ms）短：
 * 语言一旦装载，换行缩进才生效，所以要尽早识别出 JSON / YAML。
 */
export const LANGUAGE_DETECT_DELAY = 250;
/** 内容不超过此长度且以 { 或 [ 开头时立刻按 JSON 处理（覆盖「敲 { 后马上回车」） */
const IMMEDIATE_DETECT_MAX = 4096;

/**
 * 空标签时显示在编辑器里的灰色提示。
 * 「怎么打开文件」此前只能靠记快捷键，这条提示让入口在界面上可见。
 */
export const EMPTY_PLACEHOLDER = "输入内容，或把文件拖进窗口打开（Ctrl+O）";

/** 从数据库载入某标签所需的初始状态 */
export interface TabContent {
  content: string;
  /** 0 基行号 */
  cursorLine: number;
  /** 0 基列偏移 */
  cursorCh: number;
  scrollTop: number;
  /**
   * 语言提示。给了就以此为准、不再按内容嗅探——
   * 打开文件时按文件名判定（.py 不该被内容嗅探成 YAML），
   * 也因此省掉一次内容探测、语言在首次渲染时就已就绪。
   */
  languageId?: LanguageId;
}

export interface CursorInfo {
  /** 1 基行号 */
  line: number;
  /** 1 基列号 */
  column: number;
  selectionLength: number;
  docLength: number;
}

export interface EditorManagerHooks {
  /** 从数据库读取标签内容（懒加载：标签首次激活时才读） */
  loadTab: (tabId: string) => Promise<TabContent | null>;
  saveContent: (tabId: string, content: string) => void;
  saveCaret: (
    tabId: string,
    cursorLine: number,
    cursorCh: number,
    scrollTop: number,
  ) => void;
  onCursor: (info: CursorInfo) => void;
  onLargeFile: (tabId: string, large: boolean) => void;
  /** 内容语言发生变化时上报（决定状态栏显示哪种语言） */
  onLanguage: (tabId: string, language: LanguageId) => void;
  /** 一次性提示（跳转成功 / 失败等），显示在状态栏 */
  onStatusMessage: (kind: JumpMessageKind, text: string) => void;
  keymapHandlers: AppKeymapHandlers;
}

interface TabEntry {
  /** 该标签最新的 EditorState；每次 update 同步，保证防抖回调读到最新内容 */
  state: EditorState;
  saveContent: Debounced<[]>;
  saveCaret: Debounced<[]>;
  /** 独立的语言探测防抖器（比落库更早触发） */
  detectLanguage: Debounced<[]>;
  /** 是否因体积过大而关闭了语法高亮 */
  degraded: boolean;
  /** 当前语言（大文件降级期间是 text） */
  language: LanguageId;
  /**
   * 由文件名决定的语言；临时标签为 null（只能按内容嗅探）。
   * 非 null 时永不按内容复探，避免 .py 被改判成 YAML；
   * 大文件从降级恢复时也靠它把原语言装回来 —— 降级期间 language 已被改成 text，
   * 只看 language 会把 5 MB 以上的 .json 永久留在纯文本。
   */
  preferred: LanguageId | null;
}

/**
 * 取语言扩展。语法包加载失败（安装包缺文件等）时降级为纯文本，
 * 不让一次加载失败毁掉整个标签。
 */
async function loadLanguageSafely(id: LanguageId): Promise<Extension> {
  try {
    return await loadLanguageExtension(id);
  } catch {
    return [];
  }
}

/** 依据 0 基行/列还原光标；行列越界时返回 undefined 回退到文档开头 */
function selectionFromCursor(
  doc: string,
  line: number,
  ch: number,
): EditorSelection | undefined {
  if (line < 0 || ch < 0) return undefined;
  const lines = doc.split("\n");
  if (line >= lines.length) return undefined;
  let offset = 0;
  for (let i = 0; i < line; i += 1) {
    offset += lines[i].length + 1;
  }
  const target = Math.min(offset + ch, offset + lines[line].length);
  return EditorSelection.single(target);
}

class EditorManager {
  private view: EditorView | null = null;
  private hooks: EditorManagerHooks | null = null;
  private entries = new Map<string, TabEntry>();
  /** 正在建立 EditorState 的标签：异步建立期间合并重复请求，避免建出两份状态 */
  private inflight = new Map<string, Promise<TabEntry | null>>();
  private scrollTops = new Map<string, number>();
  private activeTabId: string | null = null;
  private languageCompartment = new Compartment();
  private themeCompartment = new Compartment();
  /** 当前主题；切换时通过 Compartment 热替换，不重建 EditorState */
  private theme: ResolvedTheme = "light";
  private removeScrollListener: (() => void) | null = null;
  /** 串行化激活，避免快速切换标签时后发先至 */
  private activation: Promise<void> = Promise.resolve();

  configure(hooks: EditorManagerHooks): void {
    this.hooks = hooks;
  }

  /**
   * 切换编辑器主题。
   * 由 React 效果调用（不在 CodeMirror 的 update 过程中），因此可以直接 dispatch。
   */
  setTheme(theme: ResolvedTheme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.view?.dispatch({
      effects: this.themeCompartment.reconfigure(editorThemeExtension(theme)),
    });
  }

  /** 挂载 EditorView；重复调用会先销毁旧实例（React StrictMode 下会发生） */
  attach(container: HTMLElement): void {
    if (this.view !== null) this.detach();
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [lineNumbers(), editorThemeExtension(this.theme)],
      }),
      parent: container,
    });
    this.view = view;

    const onScroll = (): void => {
      const tabId = this.activeTabId;
      if (tabId === null) return;
      this.scrollTops.set(tabId, view.scrollDOM.scrollTop);
      this.entries.get(tabId)?.saveCaret();
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    this.removeScrollListener = () => {
      view.scrollDOM.removeEventListener("scroll", onScroll);
    };
  }

  /** 卸载 EditorView；保留各标签的 EditorState（撤销历史不丢） */
  detach(): void {
    this.removeScrollListener?.();
    this.removeScrollListener = null;
    this.view?.destroy();
    this.view = null;
    this.activeTabId = null;
  }

  private buildExtensions(
    tabId: string,
    hooks: EditorManagerHooks,
    language: Extension,
  ): Extension[] {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      // 显式固定为 2 空格：JSON / YAML 的换行缩进都按它走
      indentUnit.of("  "),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorView.lineWrapping,
      placeholder(EMPTY_PLACEHOLDER),
      // 语言扩展通过 Compartment 装载，便于大文件时热插拔
      this.languageCompartment.of(language),
      this.themeCompartment.of(editorThemeExtension(this.theme)),
      appKeymap(hooks.keymapHandlers),
      keymap.of(searchKeymap),
      // 跳转用当前激活标签的语言（语言是动态加载的，拿不到固定值，只能现取）
      jumpExtension(
        () => this.activeLanguage(),
        (kind, text) => hooks.onStatusMessage(kind, text),
      ),
      EditorView.updateListener.of((update) => {
        const entry = this.entries.get(tabId);
        if (entry !== undefined) entry.state = update.state;

        if (update.docChanged) {
          this.entries.get(tabId)?.saveContent();
          this.updateLargeFileState(tabId, update.state.doc.length);
          this.scheduleLanguageRefresh(tabId, update.state);
        }
        if (update.selectionSet || update.docChanged) {
          this.reportCursor(tabId, update.state);
          this.entries.get(tabId)?.saveCaret();
        }
      }),
    ];
  }

  /**
   * 建立某标签的 EditorState 与防抖器。
   * 防抖回调只捕获 tabId，落库时再从 entries 里读该标签的最新内容——
   * 这样即使用户在防抖窗口内切走标签，也不会把别的标签内容写进来。
   *
   * 语言扩展先加载完再建 EditorState：语法包是异步取的，
   * 若先建状态再热替换，会看到一次「先无高亮后有色」的闪烁。
   */
  private async createEntry(tabId: string, initial: TabContent): Promise<TabEntry> {
    const hooks = this.hooks;
    if (hooks === null) throw new Error("editorManager 未调用 configure()");

    const selection = selectionFromCursor(
      initial.content,
      initial.cursorLine,
      initial.cursorCh,
    );
    const large = initial.content.length > LARGE_CONTENT_THRESHOLD;
    // 调用方给了语言（打开文件时按文件名判定）就以此为准，否则按内容嗅探
    const preferred = initial.languageId ?? null;
    const language: LanguageId = large ? "text" : (preferred ?? sniffLanguageId(initial.content));
    const support = large ? [] : await loadLanguageSafely(language);

    const state = EditorState.create({
      doc: initial.content,
      selection,
      extensions: this.buildExtensions(tabId, hooks, support),
    });

    const entry: TabEntry = {
      state,
      degraded: large,
      language,
      preferred,
      saveContent: debounce(() => {
        const current = this.entries.get(tabId)?.state;
        if (current === undefined) return;
        hooks.saveContent(tabId, current.doc.toString());
      }, CONTENT_SAVE_DELAY),
      detectLanguage: debounce(() => {
        const current = this.entries.get(tabId)?.state;
        if (current === undefined) return;
        this.refreshLanguage(tabId, current.doc.toString());
      }, LANGUAGE_DETECT_DELAY),
      saveCaret: debounce(() => {
        const current = this.entries.get(tabId)?.state;
        if (current === undefined) return;
        const head = current.selection.main.head;
        const line = current.doc.lineAt(head);
        hooks.saveCaret(
          tabId,
          line.number - 1,
          head - line.from,
          this.scrollTops.get(tabId) ?? 0,
        );
      }, CARET_SAVE_DELAY),
    };

    this.entries.set(tabId, entry);
    this.scrollTops.set(tabId, initial.scrollTop);
    return entry;
  }

  /** 用已知内容直接建立状态，省掉一次数据库往返（新建标签时用） */
  preload(tabId: string, initial: TabContent): Promise<void> {
    return this.ensureEntry(tabId, initial).then(() => undefined);
  }

  /**
   * 确保某标签的 EditorState 已建立，返回它。
   * 建立过程是异步的（可能读盘、可能动态导入语法包），所以用 inflight 表把
   * 「preload 与 activate 同时到达」合并成同一次建立，避免建出两份状态。
   */
  private ensureEntry(tabId: string, initial?: TabContent): Promise<TabEntry | null> {
    const existing = this.entries.get(tabId);
    if (existing !== undefined) return Promise.resolve(existing);
    const running = this.inflight.get(tabId);
    if (running !== undefined) return running;

    const task = this.buildEntry(tabId, initial);
    this.inflight.set(tabId, task);
    return task.finally(() => {
      this.inflight.delete(tabId);
    });
  }

  private async buildEntry(tabId: string, initial?: TabContent): Promise<TabEntry | null> {
    const hooks = this.hooks;
    if (hooks === null) return null;

    const source = initial ?? (await hooks.loadTab(tabId));
    if (source === null) return null;

    // 读取 / 加载期间可能已被别的路径建立，先复查
    const raced = this.entries.get(tabId);
    if (raced !== undefined) return raced;
    return this.createEntry(tabId, source);
  }

  /** 激活标签：复用同一个 EditorView，仅 setState */
  activate(tabId: string): Promise<void> {
    this.activation = this.activation.then(() => this.doActivate(tabId));
    return this.activation;
  }

  private async doActivate(tabId: string): Promise<void> {
    const view = this.view;
    if (view === null) return;
    if (this.activeTabId === tabId && this.entries.has(tabId)) {
      view.focus();
      return;
    }

    // 离开当前标签前，先把它的滚动位置与光标位置确定下来
    const outgoing = this.activeTabId;
    if (outgoing !== null && outgoing !== tabId) {
      this.scrollTops.set(outgoing, view.scrollDOM.scrollTop);
      this.entries.get(outgoing)?.saveCaret.flush();
    }

    const entry = await this.ensureEntry(tabId);
    // 等待期间视图可能已卸载，或已有更新的激活请求
    if (entry === null || this.view !== view) return;

    this.activeTabId = tabId;
    view.setState(entry.state);

    const scrollTop = this.scrollTops.get(tabId) ?? 0;
    if (scrollTop > 0) {
      // 等新文档完成布局后再恢复滚动，否则会被钳制到 0
      requestAnimationFrame(() => {
        if (this.view === view) view.scrollDOM.scrollTop = scrollTop;
      });
    }
    view.focus();
    this.reportCursor(tabId, entry.state);
    this.hooks?.onLargeFile(tabId, entry.degraded);
    this.hooks?.onLanguage(tabId, entry.language);
  }

  /** 大文件降级：超过阈值时卸载语法高亮，避免输入延迟；回到阈值以内再装回来 */
  private updateLargeFileState(tabId: string, docLength: number): void {
    const entry = this.entries.get(tabId);
    if (entry === undefined) return;
    const large = docLength > LARGE_CONTENT_THRESHOLD;
    if (large === entry.degraded) return;
    entry.degraded = large;

    if (tabId === this.activeTabId && this.view !== null) {
      if (large) {
        // CodeMirror 不允许在一次 update 进行中再次 dispatch，
        // 因此把重新配置推迟到本次更新结束之后。
        const view = this.view;
        setTimeout(() => {
          if (this.view !== view || this.activeTabId !== tabId) return;
          view.dispatch({ effects: this.languageCompartment.reconfigure([]) });
        }, 0);
      } else {
        // 回到阈值以内：文档已小于 5MB，可以重新确定语言并装回高亮。
        // 文件名定过的语言要装回**原来那个**（降级期间 language 已被置为 text），
        // 临时标签才按内容复探。
        const language = entry.preferred ?? sniffLanguageId(entry.state.doc.toString());
        void this.applyLanguage(tabId, language);
      }
    }
    this.hooks?.onLargeFile(tabId, large);
  }

  /**
   * 决定何时重新探测语言。
   * 常规情况交给 250ms 防抖；但「尚未识别出语言 + 内容很小 + 以 { 或 [ 开头」
   * 立刻判定为 JSON —— 这正是「敲一个 { 紧接着按回车」的常见起手，
   * 若等防抖，那一次回车就不会缩进。
   */
  private scheduleLanguageRefresh(tabId: string, state: EditorState): void {
    const entry = this.entries.get(tabId);
    if (entry === undefined || entry.preferred !== null) return;
    if (entry.language === "text" && state.doc.length <= IMMEDIATE_DETECT_MAX) {
      const head = state.doc.sliceString(0, 64).trimStart().charAt(0);
      if (head === "{" || head === "[") {
        this.refreshLanguage(tabId, state.doc.toString());
        return;
      }
    }
    entry.detectLanguage();
  }

  /**
   * 按内容复探语言并热更新语法高亮。
   * 只对「语言不是由文件名决定」的标签生效——临时标签属于这类。
   */
  private refreshLanguage(tabId: string, content: string): void {
    const entry = this.entries.get(tabId);
    if (entry === undefined || entry.degraded || entry.preferred !== null) return;
    const language = sniffLanguageId(content);
    if (language === entry.language) return;
    void this.applyLanguage(tabId, language);
  }

  /**
   * 装载语言并热替换语法高亮。
   * 语法包是异步加载的，加载期间标签可能已被关闭或重建，所以每步都重新取表。
   *
   * dispatch 发生在 await 之后（微任务），而 CodeMirror 禁止的只是「在一次 update
   * 尚未结束时就再 dispatch」——那是同步重入，微任务一定在整条同步调用栈退干净之后才跑，
   * 所以这里不需要再套一层 setTimeout。
   */
  private async applyLanguage(tabId: string, language: LanguageId): Promise<void> {
    const entry = this.entries.get(tabId);
    if (entry === undefined) return;
    if (language === entry.language) return;

    const support = await loadLanguageSafely(language);
    const current = this.entries.get(tabId);
    if (current !== entry) return;

    entry.language = language;
    const view = this.view;
    if (view !== null && tabId === this.activeTabId && !entry.degraded) {
      view.dispatch({ effects: this.languageCompartment.reconfigure(support) });
    }
    this.hooks?.onLanguage(tabId, language);
  }

  private reportCursor(tabId: string, state: EditorState): void {
    if (this.activeTabId !== null && tabId !== this.activeTabId) return;
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    let selectionLength = 0;
    for (const r of state.selection.ranges) {
      selectionLength += r.to - r.from;
    }
    this.hooks?.onCursor({
      line: line.number,
      column: range.head - line.from + 1,
      selectionLength,
      docLength: state.doc.length,
    });
  }

  /** 立即把某标签待写入的内容与光标位置落库 */
  flushTab(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (entry === undefined) return;
    const view = this.view;
    if (view !== null && tabId === this.activeTabId) {
      this.scrollTops.set(tabId, view.scrollDOM.scrollTop);
    }
    entry.saveCaret.flush();
    entry.saveContent.flush();
  }

  /** 退出前强制写入所有待保存内容 */
  flushAll(): void {
    for (const tabId of [...this.entries.keys()]) {
      this.flushTab(tabId);
    }
  }

  /** 关闭标签：先落库，再丢弃状态 */
  disposeTab(tabId: string): void {
    this.flushTab(tabId);
    const entry = this.entries.get(tabId);
    entry?.saveContent.cancel();
    entry?.saveCaret.cancel();
    entry?.detectLanguage.cancel();
    this.entries.delete(tabId);
    this.scrollTops.delete(tabId);
    if (this.activeTabId === tabId) this.activeTabId = null;

    // 语言包还在加载、EditorState 尚未建好时就被关掉：
    // 等建立结束后把它丢掉，否则已关闭的标签会留在内存里、还可能往已删除的记录写内容
    const pending = this.inflight.get(tabId);
    if (pending !== undefined) {
      void pending.then(() => {
        if (this.entries.delete(tabId)) this.scrollTops.delete(tabId);
      });
    }
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /** 当前激活标签的语言；跳转扩展用它挑规则 */
  private activeLanguage(): LanguageId {
    const tabId = this.activeTabId;
    if (tabId === null) return "text";
    return this.entries.get(tabId)?.language ?? "text";
  }

  /**
   * 用户手动指定当前标签的语言；传 null 表示恢复「按内容自动识别」。
   *
   * 手动选择写进 TabEntry.preferred：它同时也是「语言已确定、不再按内容复探」的标记，
   * 所以一个字段同时承担了「文件名决定」和「用户指定」两种情况。
   * 大文件降级期间只记住选择、不装语法树（applyLanguage 里会跳过 dispatch），
   * 体积回落时由 updateLargeFileState 自动装回来。
   */
  setActiveLanguage(language: LanguageId | null): void {
    const tabId = this.activeTabId;
    if (tabId === null) return;
    const entry = this.entries.get(tabId);
    if (entry === undefined) return;

    entry.preferred = language;
    if (language === null) {
      // 恢复自动识别：立刻按当前内容重算一次（degraded 时不做事，与自动路径一致）
      this.refreshLanguage(tabId, entry.state.doc.toString());
      return;
    }
    void this.applyLanguage(tabId, language);
  }

  /** 取当前激活标签的最新内容 */
  getActiveContent(): string | null {
    if (this.activeTabId === null) return null;
    const entry = this.entries.get(this.activeTabId);
    return entry === undefined ? null : entry.state.doc.toString();
  }

  /** 整体替换当前激活标签内容（格式化 / 压缩用），保留撤销历史 */
  replaceActiveContent(content: string): void {
    const view = this.view;
    if (view === null) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
    view.focus();
  }

  /**
   * 执行一条 CodeMirror 命令。
   * 供原生菜单调用：菜单项点击时焦点已经从编辑器移开，所以执行后要抢回焦点。
   */
  private runCommand(command: Command): boolean {
    const view = this.view;
    if (view === null) return false;
    const handled = command(view);
    view.focus();
    return handled;
  }

  /** 撤销。走 CodeMirror 自己的历史栈，而不是原生 Undo —— 原生撤销不认它的历史 */
  undo(): boolean {
    return this.runCommand(undo);
  }

  /** 重做 */
  redo(): boolean {
    return this.runCommand(redo);
  }

  /** 全选 */
  selectAll(): boolean {
    return this.runCommand(selectAll);
  }

  /** 当前选中的文本（多选区用换行拼接）；无选区时返回空串 */
  getSelectionText(): string {
    const view = this.view;
    if (view === null) return "";
    const parts: string[] = [];
    for (const range of view.state.selection.ranges) {
      if (range.empty) continue;
      parts.push(view.state.sliceDoc(range.from, range.to));
    }
    return parts.join("\n");
  }

  /**
   * 用给定文本替换当前选区。
   * 剪切传空串、粘贴传剪贴板内容，两者共用这一条路径。
   */
  replaceSelection(text: string): void {
    const view = this.view;
    if (view === null) return;
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  }

  /** 打开搜索/替换面板 */
  openSearch(): boolean {
    return this.runCommand(openSearchPanel);
  }

  /** 打开「转到行」对话框（行号，或 `行:列`） */
  goToLine(): boolean {
    return this.runCommand(gotoLine);
  }

  focus(): void {
    this.view?.focus();
  }
}

export const editorManager = new EditorManager();
