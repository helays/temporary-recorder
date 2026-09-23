import { create } from "zustand";
import type { LanguageId } from "../types/models";

export type StatusMessageKind = "error" | "info";

export interface StatusMessage {
  kind: StatusMessageKind;
  text: string;
  /** 1 基行号，仅错误定位时有值 */
  line?: number;
  /** 1 基列号，仅错误定位时有值 */
  column?: number;
}

interface StatusState {
  cursorLine: number;
  cursorColumn: number;
  selectionLength: number;
  docLength: number;
  /** 当前标签的语法高亮语言（状态栏显示） */
  language: LanguageId;
  largeFile: boolean;
  message: StatusMessage | null;
  /** 设置面板是否打开（纯 UI 状态） */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** 「关于」弹窗是否打开（原生 About 菜单项随原生菜单栏一起没了，改为自绘） */
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
  setCursor: (
    line: number,
    column: number,
    selectionLength: number,
    docLength: number,
  ) => void;
  setLanguage: (language: LanguageId) => void;
  setLargeFile: (large: boolean) => void;
  setMessage: (message: StatusMessage | null) => void;
  /** 数据库错误统一走这里：显示在状态栏，不弹窗、不崩溃 */
  setDbError: (text: string) => void;
}

/**
 * 纯 UI 临时状态。编辑器内容不在这里（由 CodeMirror 自身管理）。
 */
export const useStatusStore = create<StatusState>((set) => ({
  cursorLine: 1,
  cursorColumn: 1,
  selectionLength: 0,
  docLength: 0,
  language: "text",
  largeFile: false,
  message: null,
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  aboutOpen: false,
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setCursor: (cursorLine, cursorColumn, selectionLength, docLength) =>
    set({ cursorLine, cursorColumn, selectionLength, docLength }),
  setLanguage: (language) => set({ language }),
  setLargeFile: (largeFile) => set({ largeFile }),
  setMessage: (message) => set({ message }),
  setDbError: (text) => set({ message: { kind: "error", text } }),
}));
