import { create } from "zustand";
import type { DocFormat } from "../types/models";

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
  format: DocFormat;
  largeFile: boolean;
  message: StatusMessage | null;
  /** 设置面板是否打开（纯 UI 状态） */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  setCursor: (
    line: number,
    column: number,
    selectionLength: number,
    docLength: number,
  ) => void;
  setFormat: (format: DocFormat) => void;
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
  format: "text",
  largeFile: false,
  message: null,
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setCursor: (cursorLine, cursorColumn, selectionLength, docLength) =>
    set({ cursorLine, cursorColumn, selectionLength, docLength }),
  setFormat: (format) => set({ format }),
  setLargeFile: (largeFile) => set({ largeFile }),
  setMessage: (message) => set({ message }),
  setDbError: (text) => set({ message: { kind: "error", text } }),
}));
