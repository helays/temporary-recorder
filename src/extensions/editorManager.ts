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
  rectangularSelection,
} from "@codemirror/view";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";
import { history } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { detectFormat } from "../services/format";
import type { DocFormat } from "../types/models";
import { LARGE_CONTENT_THRESHOLD } from "../utils/text";
import { debounce, type Debounced } from "../utils/debounce";
import { appKeymap, type AppKeymapHandlers } from "./keymap";
import { editorTheme } from "./theme";

/** 用户停止输入 800ms 后把当前标签内容落库 */
export const CONTENT_SAVE_DELAY = 800;
/** 光标 / 滚动位置 1 秒防抖落库 */
export const CARET_SAVE_DELAY = 1000;

/** 从数据库载入某标签所需的初始状态 */
export interface TabContent {
  content: string;
  /** 0 基行号 */
  cursorLine: number;
  /** 0 基列偏移 */
  cursorCh: number;
  scrollTop: number;
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
  /** 内容格式（JSON / YAML / 纯文本）发生变化时上报 */
  onFormat: (tabId: string, format: DocFormat) => void;
  keymapHandlers: AppKeymapHandlers;
}

interface TabEntry {
  /** 该标签最新的 EditorState；每次 update 同步，保证防抖回调读到最新内容 */
  state: EditorState;
  saveContent: Debounced<[]>;
  saveCaret: Debounced<[]>;
  /** 是否因体积过大而关闭了语法高亮 */
  degraded: boolean;
  /** 当前探测到的内容格式 */
  format: DocFormat;
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
  private scrollTops = new Map<string, number>();
  private activeTabId: string | null = null;
  private languageCompartment = new Compartment();
  private removeScrollListener: (() => void) | null = null;
  /** 串行化激活，避免快速切换标签时后发先至 */
  private activation: Promise<void> = Promise.resolve();

  configure(hooks: EditorManagerHooks): void {
    this.hooks = hooks;
  }

  /** 挂载 EditorView；重复调用会先销毁旧实例（React StrictMode 下会发生） */
  attach(container: HTMLElement): void {
    if (this.view !== null) this.detach();
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [lineNumbers(), oneDark, editorTheme],
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
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorView.lineWrapping,
      // 语言扩展通过 Compartment 装载，便于大文件时热插拔
      this.languageCompartment.of(language),
      oneDark,
      editorTheme,
      appKeymap(hooks.keymapHandlers),
      keymap.of(searchKeymap),
      EditorView.updateListener.of((update) => {
        const entry = this.entries.get(tabId);
        if (entry !== undefined) entry.state = update.state;

        if (update.docChanged) {
          this.entries.get(tabId)?.saveContent();
          this.updateLargeFileState(tabId, update.state.doc.length);
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
   */
  private createEntry(tabId: string, initial: TabContent): TabEntry {
    const hooks = this.hooks;
    if (hooks === null) throw new Error("editorManager 未调用 configure()");

    const selection = selectionFromCursor(
      initial.content,
      initial.cursorLine,
      initial.cursorCh,
    );
    const large = initial.content.length > LARGE_CONTENT_THRESHOLD;
    const format: DocFormat = large ? "text" : detectFormat(initial.content);
    const state = EditorState.create({
      doc: initial.content,
      selection,
      extensions: this.buildExtensions(
        tabId,
        hooks,
        large ? [] : this.languageExtensionFor(format),
      ),
    });

    const entry: TabEntry = {
      state,
      degraded: large,
      format,
      saveContent: debounce(() => {
        const current = this.entries.get(tabId)?.state;
        if (current === undefined) return;
        const content = current.doc.toString();
        hooks.saveContent(tabId, content);
        this.refreshFormat(tabId, content);
      }, CONTENT_SAVE_DELAY),
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
  preload(tabId: string, initial: TabContent): void {
    if (this.entries.has(tabId)) return;
    this.createEntry(tabId, initial);
  }

  private async ensureEntry(tabId: string): Promise<TabEntry | null> {
    const existing = this.entries.get(tabId);
    if (existing !== undefined) return existing;
    const hooks = this.hooks;
    if (hooks === null) return null;

    const loaded = await hooks.loadTab(tabId);
    // 读取期间可能已被别的路径建立，先复查
    const raced = this.entries.get(tabId);
    if (raced !== undefined) return raced;
    if (loaded === null) return null;
    return this.createEntry(tabId, loaded);
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
    this.hooks?.onFormat(tabId, entry.format);
  }

  /** 大文件降级：超过阈值时卸载语法高亮，避免输入延迟 */
  private updateLargeFileState(tabId: string, docLength: number): void {
    const entry = this.entries.get(tabId);
    if (entry === undefined) return;
    const large = docLength > LARGE_CONTENT_THRESHOLD;
    if (large === entry.degraded) return;
    entry.degraded = large;

    const view = this.view;
    if (tabId === this.activeTabId && view !== null) {
      // 只有回到阈值以内时才需要重新探测格式（此时文档已小于 5MB，取样可接受）
      const format = large ? entry.format : detectFormat(entry.state.doc.toString());
      if (!large) entry.format = format;
      // CodeMirror 不允许在一次 update 进行中再次 dispatch，
      // 因此把重新配置推迟到本次更新结束之后。
      setTimeout(() => {
        if (this.view !== view || this.activeTabId !== tabId) return;
        view.dispatch({
          effects: this.languageCompartment.reconfigure(
            large ? [] : this.languageExtensionFor(format),
          ),
        });
      }, 0);
      if (!large) this.hooks?.onFormat(tabId, format);
    }
    this.hooks?.onLargeFile(tabId, large);
  }

  /** 依格式挑选语言扩展；纯文本返回空数组 */
  private languageExtensionFor(format: DocFormat): Extension {
    switch (format) {
      case "json":
        return json();
      case "yaml":
        return yaml();
      default:
        return [];
    }
  }

  /**
   * 重新探测格式并热更新语法高亮。
   * 在内容防抖落库时调用——此时已脱离 CodeMirror 的 update，可以直接 dispatch。
   */
  private refreshFormat(tabId: string, content: string): void {
    const entry = this.entries.get(tabId);
    if (entry === undefined || entry.degraded) return;
    const format = detectFormat(content);
    if (format === entry.format) return;
    entry.format = format;

    const view = this.view;
    if (tabId === this.activeTabId && view !== null) {
      view.dispatch({
        effects: this.languageCompartment.reconfigure(this.languageExtensionFor(format)),
      });
    }
    this.hooks?.onFormat(tabId, format);
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
    this.entries.delete(tabId);
    this.scrollTops.delete(tabId);
    if (this.activeTabId === tabId) this.activeTabId = null;
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
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

  focus(): void {
    this.view?.focus();
  }
}

export const editorManager = new EditorManager();
