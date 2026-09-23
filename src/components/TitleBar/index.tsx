import logo from "../../../src-tauri/icons/128x128.png";
import { MenuBar } from "./MenuBar";
import { WindowControls } from "./WindowControls";

/**
 * 顶部单行标题栏：图标 + 菜单 + 窗口按钮同行（VS Code 那种形态）。
 *
 * 窗口是无边框的（tauri.conf 里 decorations: false），整行由应用自绘。
 *
 * data-tauri-drag-region="deep" 让整行都能拖动窗口：Tauri 注入的脚本会把
 * <button> 这类可点元素判定为「阻断拖动」，所以菜单与窗口按钮不会误触发拖动；
 * 双击空白处切换最大化也由它处理（见 tauri 的 src/window/scripts/drag.js）。
 *
 * relative z-30 是为了让菜单下拉能盖住下面的标签栏与编辑器。
 */
export function TitleBar() {
  return (
    <div
      data-tauri-drag-region="deep"
      className="relative z-30 flex h-8 shrink-0 items-stretch border-b border-app-border bg-app-panel select-none"
    >
      <div className="my-auto mr-1 ml-2 flex shrink-0 items-center" title="闪记">
        <img src={logo} alt="闪记" className="h-4 w-4" draggable={false} />
      </div>

      <MenuBar />

      {/* 空白处即拖动区 */}
      <div className="min-w-0 flex-1" />

      <WindowControls />
    </div>
  );
}
