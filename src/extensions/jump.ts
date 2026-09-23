import { EditorSelection, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type Command,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { LanguageId } from "../types/models";
import { findDefinition } from "../utils/definition";

/**
 * 「跳转到定义」的编辑器接线：Ctrl+Click / F12 前进，Alt+← 回退，悬停给提示。
 *
 * 定位逻辑全在 utils/definition.ts（纯函数、可在 node 里断言）；
 * 这里只负责键位、装饰、状态与提示。
 * 只做同一文件内的跳转，不做跨文件索引。
 */

export type JumpMessageKind = "info" | "error";
export type JumpReport = (kind: JumpMessageKind, text: string) => void;

/** Alt+← 最多回退多少层 */
const HISTORY_LIMIT = 50;
/** 跳转前最多花多少毫秒把语法树补解析到文末（长文件里定义可能在视口之外） */
const JUMP_PARSE_BUDGET = 500;
/** 超过这个体积就不做悬停提示：鼠标移动太频繁，不值得为它解析整篇 */
const HOVER_LIMIT = 1024 * 1024;

interface JumpSite {
  readonly from: number;
  readonly to: number;
}

const pushJump = StateEffect.define<JumpSite>();
const popJump = StateEffect.define<null>();

/**
 * 回退历史。放在 StateField 里而不是模块变量里：每个标签各有一份 EditorState，
 * 历史自然跟着标签走，切换标签不会串。
 */
const jumpHistory = StateField.define<readonly JumpSite[]>({
  create: () => [],
  update(sites, tr) {
    let next = sites;
    if (tr.docChanged) {
      // 文档改过之后旧位置要跟着位移，否则回退会落到别处
      next = next.map((site) => ({
        from: tr.changes.mapPos(site.from),
        to: tr.changes.mapPos(site.to),
      }));
    }
    for (const effect of tr.effects) {
      if (effect.is(pushJump)) next = [...next, effect.value].slice(-HISTORY_LIMIT);
      else if (effect.is(popJump)) next = next.slice(0, -1);
    }
    return next;
  },
});

/** 跳到光标处标识符的定义。pos 给定时用它（鼠标点击位置），否则用光标位置 */
export function jumpToDefinition(
  view: EditorView,
  language: LanguageId,
  report: JumpReport,
  pos?: number,
): boolean {
  const state = view.state;
  const head = pos ?? state.selection.main.head;
  // 视口之外的部分可能还没解析，这里补一次（有毫秒上限，超时就用手上已有的树）
  const tree = ensureSyntaxTree(state, state.doc.length, JUMP_PARSE_BUDGET) ?? syntaxTree(state);
  const lookup = findDefinition(tree, state.doc, head, language);

  switch (lookup.kind) {
    case "found": {
      const { target } = lookup;
      const line = state.doc.lineAt(target.from).number;
      view.dispatch({
        selection: EditorSelection.single(target.from, target.to),
        effects: [
          pushJump.of({ from: state.selection.main.anchor, to: state.selection.main.head }),
          EditorView.scrollIntoView(target.from, { y: "center" }),
        ],
      });
      report("info", `已跳转到「${target.name}」的定义（第 ${line} 行）`);
      return true;
    }
    case "self":
      report("info", `这里就是「${lookup.name}」的定义`);
      return false;
    case "missing":
      report("error", `在本文件里找不到「${lookup.name}」的定义`);
      return false;
    case "unsupported":
      report("error", "这种语言没有可跳转的定义");
      return false;
    default:
      report("info", "这里没有可跳转的名字");
      return false;
  }
}

/** 回到上一次跳转前的位置 */
export function jumpBack(view: EditorView, report: JumpReport): boolean {
  const history = view.state.field(jumpHistory, false) ?? [];
  const site = history[history.length - 1];
  if (site === undefined) {
    report("info", "没有可返回的位置");
    return false;
  }
  view.dispatch({
    selection: EditorSelection.single(site.from, site.to),
    effects: [popJump.of(null), EditorView.scrollIntoView(site.from, { y: "center" })],
  });
  return true;
}

/** 悬停提示：光标下的名字有定义时加虚线下划线并显示手型 */
function hintExtension(getLanguage: () => LanguageId): Extension {
  const mark = Decoration.mark({ class: "cm-jumpHint" });

  class HintPlugin implements PluginValue {
    decorations: DecorationSet = Decoration.none;
    /** 当前提示的范围，用来避免鼠标每动一下都重建装饰 */
    private key = "";

    update(update: ViewUpdate): void {
      if (update.docChanged) this.set(null);
    }

    /** 由事件处理器调用，因此是公开的 */
    set(range: { from: number; to: number } | null): void {
      const key = range === null ? "" : `${range.from}:${range.to}`;
      if (key === this.key) return;
      this.key = key;
      this.decorations = range === null ? Decoration.none : Decoration.set([mark.range(range.from, range.to)]);
    }

    hint(event: MouseEvent, view: EditorView): void {
      if (view.state.doc.length > HOVER_LIMIT) {
        this.set(null);
        return;
      }
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) {
        this.set(null);
        return;
      }
      const lookup = findDefinition(syntaxTree(view.state), view.state.doc, pos, getLanguage());
      this.set(lookup.kind === "found" ? lookup.target.at : null);
    }
  }

  return ViewPlugin.fromClass(HintPlugin, {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousemove(event, view) {
        this.hint(event, view);
      },
      mouseleave() {
        this.set(null);
      },
    },
  });
}

/**
 * 跳转扩展。language 由 editorManager 现取（语言是动态加载的，扩展本身拿不到固定值）。
 */
export function jumpExtension(getLanguage: () => LanguageId, report: JumpReport): Extension {
  const jump: Command = (view) => jumpToDefinition(view, getLanguage(), report);
  const back: Command = (view) => jumpBack(view, report);

  return [
    jumpHistory,
    hintExtension(getLanguage),
    // Ctrl+Click 让位给「跳转到定义」，多光标改成 Alt+Click
    // （CodeMirror 默认在 Windows 上就是 Ctrl+Click 加光标，这里显式换掉；
    //   矩形选择用的是 Alt+拖动，不受影响）
    EditorView.clickAddsSelectionRange.of((event: MouseEvent) => event.altKey),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
          return false;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        // 命中定义时吃掉这次点击（不自选、不移动光标）；没命中就交回默认行为
        return jumpToDefinition(view, getLanguage(), report, pos);
      },
    }),
    keymap.of([
      { key: "F12", run: jump },
      { key: "Alt-ArrowLeft", run: back },
    ]),
    EditorView.baseTheme({
      ".cm-jumpHint": {
        textDecoration: "underline dotted",
        textUnderlineOffset: "2px",
        cursor: "pointer",
      },
    }),
  ];
}
