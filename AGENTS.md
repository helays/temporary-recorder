## 项目名称
Temporary Recorder（临时记录器）

## 项目目标
开发一个轻量级 Windows 桌面应用，用于临时记录、编辑、格式化文本内容。核心定位是"快速打开、随手记录、随时关闭"，不是完整的 IDE 或笔记软件。

## 技术栈（已确定，不得擅自更改）

| 层级 | 选型 | 说明 |
|------|------|------|
| 桌面外壳 | **Tauri v2** | 复用系统 WebView，不打包 Chromium |
| 前端框架 | **React + TypeScript + Vite** | 开发效率优先 |
| 编辑器内核 | **CodeMirror 6** | 提供多光标、语法高亮、搜索替换 |
| 状态管理 | **Zustand** | 轻量，避免 Redux 样板代码 |
| 本地存储 | **SQLite（通过 `tauri-plugin-sql`）** | 统一存储标签内容、会话状态、设置 |
| 样式 | **Tailwind CSS** | 快速布局，避免手写大量 CSS |

**禁止事项：**
- 禁止使用 Electron
- 禁止引入任何需要打包完整浏览器内核的方案
- 禁止使用重型 UI 组件库（如 Ant Design、MUI），如需组件自行用 Tailwind 实现

## 开发环境

- 本项目是 **Windows 桌面软件**，开发和调试在 **Windows 侧** 进行
- 项目代码位于：`C:\coder\rust\Temporary-recorder`
- 临时文件统一放在项目根目录下的 **`runtime/`** 目录
- **`runtime/` 必须加入 `.gitignore`，禁止提交到 git**

**环境准备：**
- Rust：`rustup` 安装，使用 `stable-x86_64-pc-windows-msvc` 工具链
- Node：建议使用 `pnpm`，版本 ≥ 18
- 构建命令在 PowerShell 或 CMD 中执行，工作目录为 `C:\coder\rust\Temporary-recorder`

`.gitignore` 至少包含：
```
runtime/
node_modules/
dist/
target/
src-tauri/target/
*.db
*.db-journal
```

## 核心功能需求

### 1. 多标签（Multi-tab）
- 支持同时打开多个文档标签
- 标签可新建、关闭、切换、重命名、拖拽排序
- 关闭标签时，从 `tabs` 表删除对应记录（无需提示，内容已实时存储）
- 标签顺序变更时，更新 `tabs` 表的 `sort_order`
- 会话恢复逻辑见「存储与会话恢复」章节

### 2. 存储与会话恢复（SQLite）

**数据库位置：**
- 使用 `tauri-plugin-sql` 的 SQLite 驱动
- 数据库文件位于 Tauri 的 `appDataDir` 下：`appDataDir/recorder.db`
- 应用启动时自动创建表结构（`CREATE TABLE IF NOT EXISTS`）

**表结构：**

```sql
-- 标签表：同时承载标签元数据和内容
CREATE TABLE IF NOT EXISTS tabs (
  id          TEXT PRIMARY KEY,        -- UUID
  title       TEXT NOT NULL,           -- 标签名
  content     TEXT NOT NULL DEFAULT '',-- 标签内容（UTF-8，LF 换行）
  sort_order  INTEGER NOT NULL,        -- 标签顺序
  cursor_line INTEGER NOT NULL DEFAULT 0,
  cursor_ch   INTEGER NOT NULL DEFAULT 0,
  scroll_top  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,        -- Unix 时间戳（毫秒）
  updated_at  INTEGER NOT NULL
);

-- 会话表：只存一条记录（id 固定为 1）
CREATE TABLE IF NOT EXISTS session (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  active_tab_id TEXT,
  window_width  INTEGER,
  window_height INTEGER,
  window_x      INTEGER,
  window_y      INTEGER,
  updated_at    INTEGER NOT NULL
);

-- 设置表：键值对
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**自动存储规则：**
- 用户停止输入 **800ms** 后，将当前标签内容 `UPDATE` 到 `tabs` 表
- 标签新建、关闭、重命名、切换顺序时，立即写入 `tabs` 表
- 光标位置、滚动位置通过防抖（1 秒）更新到 `tabs` 表
- 窗口大小/位置在窗口 resize/move 时防抖（500ms）更新到 `session` 表
- 应用退出前（`onCloseRequested`）强制写入一次

**会话恢复规则：**
- 应用启动时，从 `tabs` 表读取所有标签（按 `sort_order` 排序）
- 从 `session` 表读取 `active_tab_id`，设为激活标签
- 从 `session` 表恢复窗口大小和位置
- 恢复每个标签的光标位置和滚动位置
- 恢复过程静默完成，不弹窗询问
- 如果 `tabs` 表为空（首次启动），自动创建一个空白标签
- 如果 `active_tab_id` 指向的标签不存在，回退到第一个标签

### 3. 格式解析与格式化
- 支持 **JSON** 和 **YAML** 两种格式
- 提供"格式化"按钮/快捷键，对当前标签内容进行格式化
- 提供"压缩"功能（仅 JSON）
- 格式错误时在编辑器底部显示错误位置和原因，不弹窗打断
- JSON 使用 `JSON.parse` + `JSON.stringify(value, null, 2)`
- YAML 使用 `js-yaml` 库

### 4. 搜索与替换
- 使用 CodeMirror 6 的 `@codemirror/search` 扩展
- 必须支持：正则表达式、大小写敏感、全词匹配
- 快捷键：`Ctrl+F` 搜索，`Ctrl+H` 替换

### 5. 编码与换行
- 所有文件读写统一使用 **UTF-8**
- 换行符统一为 **`\n`**（LF），不随系统变化
- 读取外部文件时，若检测到 CRLF 需转换为 LF 后再载入

### 6. 多行选择
- 依赖 CodeMirror 6 原生能力，无需额外开发
- 确保 `Alt+Click` 多光标、`Ctrl+D` 选下一个相同词等快捷键可用

## 性能约束

| 指标 | 目标值 |
|------|--------|
| 空闲内存占用 | < 80 MB |
| 冷启动时间 | < 1.5 秒 |
| 打包体积 | < 15 MB |
| 输入延迟 | 无可感知延迟（< 16ms） |

**性能红线：**
- 单文件内容超过 **5 MB** 时，需降级处理（关闭语法高亮或提示用户）
- 标签数量超过 **20 个** 时，需考虑懒加载非激活标签的编辑器实例

## 代码规范

### 目录结构
```
src/
├── components/       # React 组件
│   ├── TabBar/
│   ├── Editor/
│   └── StatusBar/
├── stores/           # Zustand 状态
├── services/         # 数据库调用封装、格式化逻辑
├── extensions/       # CodeMirror 6 自定义扩展
├── utils/            # 纯函数工具
└── types/            # TypeScript 类型定义

src-tauri/
├── src/
│   ├── main.rs
│   └── commands/     # Tauri command 定义（如需要）
└── Cargo.toml

runtime/              # 临时文件，禁止提交
```

### 命名约定
- React 组件文件：`PascalCase.tsx`
- 工具函数文件：`camelCase.ts`
- 类型文件：`camelCase.ts`，类型名用 `PascalCase`
- Rust command：`snake_case`

### 状态管理原则
- 编辑器内容 **不放入 Zustand**，由 CodeMirror 自身管理，避免频繁 setState 导致性能问题
- Zustand 只管理：标签列表（元数据）、激活标签 ID、全局设置
- 自动存储通过 CodeMirror 的 `updateListener` 触发防抖保存

### CodeMirror 6 集成要点
- 使用 `@codemirror/state`、`@codemirror/view`、`@codemirror/language`
- 语言包：`@codemirror/lang-json`、`@codemirror/lang-yaml`
- 搜索：`@codemirror/search`
- 主题：使用 `@codemirror/theme-one-dark` 或自定义轻量主题
- 每个标签独立维护一个 `EditorState`，切换标签时复用 `EditorView` 实例并 `setState`

### SQLite 使用要点
- SQLite 操作全部通过 `tauri-plugin-sql` 在前端 TypeScript 侧调用，Rust 侧不写业务查询逻辑
- 所有写操作使用参数化查询（`?` 占位符），禁止字符串拼接 SQL
- 内容字段 `content` 可能很大，查询标签列表时只 `SELECT` 元数据字段，不要 `SELECT *`，避免把全部内容读进内存
- 如果后续需要全文搜索，再考虑引入 FTS5，当前不引入
- 数据库迁移用 `PRAGMA user_version` 管理，当前版本为 1

## 文件编码与文本操作规范（重要）

**背景：** Windows 侧 PowerShell 的默认编码行为会按 ANSI/系统代码页处理文本，对含中文的 UTF-8 文件做「读→改→写」会造成不可逆乱码。

**禁止事项：**

- 禁止用 PowerShell / shell 对含中文的文件做隐式编码的批量读取改写，尤其包括：
  - `Get-Content -Raw` + `Set-Content`（默认可能按 ANSI/系统代码页读写）
  - `Out-File` / `>` 重定向
  - `$c -replace` 后整文件写回
  - 任何会对整文件做「读→改→写」且未显式指定 UTF-8（无 BOM）编码的命令
- 不要把 shell 的 `Set-Content` / `cls` 当作等价手段

**正确做法：**

- 对含中文的源文件一律使用无编码风险的文本编辑工具（`read` 读取、`edit` / `write` 按 UTF-8 精确替换）
- 每次只替换可唯一确认的文本块
- 写后抽查中文完好
- 需要整体重写文件时，用 `write`（UTF-8）一次性写入完整正确内容，不要叠加多道隐式编码的 shell 替换

## Git 操作规范（重要）

- **禁止用 `git checkout -- <file>` / `git reset --hard` / `git stash` 去"重置再重做"一个含未提交改动的文件**——这会永久丢失已加载到工作区但尚未 commit 的功能改动
- 确需恢复历史版本前，先保留当前文件内容副本（复制到 `runtime/` 或另存）
- 批量改字段名/全局替换时：
  1. 先在 `grep` 全量盘点命中
  2. 然后用编辑工具对每个文件逐一精确替换
  3. 不要用一次 shell 管道覆盖多文件
- 涉及大量改名的重活，优先让能精确落盘的子代理用 `edit` / `write` 完成
- 交付前自检 `type-check` / `build` 且确认源码中文无乱码

## 开发流程要求

1. **每一步都要可运行**：不要一次性写完所有功能，按功能模块逐个提交，每个提交保证 `pnpm tauri dev` 能正常启动
2. **优先实现核心链路**：先做"新建标签 → 输入 → 自动保存 → 重启恢复"，再补格式化和搜索
3. **不引入不必要的依赖**：每新增一个 npm 包或 crate 前，先说明理由
4. **Rust 侧保持极简**：Tauri command 只做必要的桥接，业务逻辑全部放前端 TypeScript
5. **错误处理**：数据库读写失败时，在状态栏显示错误信息，不崩溃、不弹窗

## 验收标准

- [ ] 应用启动后 1.5 秒内可输入
- [ ] 新建标签、输入内容、关闭应用、重新打开，内容完整恢复
- [ ] 打开 3 个标签，分别输入内容，切换标签顺序，关闭应用，重新打开后：标签数量、顺序、激活标签、每个标签内容全部一致
- [ ] 手动删除 `recorder.db` 后重启，应用正常启动并创建一个空白标签
- [ ] 手动删除 `tabs` 表中某条记录后重启，应用正常启动，不崩溃
- [ ] 粘贴一段 JSON，点击格式化，输出标准 2 空格缩进 JSON
- [ ] 粘贴一段 YAML，点击格式化，输出标准缩进 YAML
- [ ] `Ctrl+F` 可用正则搜索，`Ctrl+H` 可替换
- [ ] `Alt+Click` 可多光标编辑
- [ ] 保存的内容为 UTF-8 编码、LF 换行（可直接用 `sqlite3` 查询 `content` 字段验证）
- [ ] 空闲时内存占用低于 80 MB
- [ ] `runtime/` 目录未被 git 跟踪

## 给 Agent 的额外说明

- 会话恢复是核心功能，不是可选项。实现顺序上，应该在"自动保存"之后立即做，不要留到最后
- 如果遇到 CodeMirror 6 的 API 不熟悉，优先查阅官方文档和 `@codemirror/*` 包的 README，不要凭记忆写
- 如果 Tauri v2 的 plugin 用法不确定，查阅 Tauri v2 官方文档（注意 v1 和 v2 的 API 差异很大）
- 遇到不确定的产品决策，先按本文档的约束做最简实现，不要自行扩展功能
- 保持代码简洁，这个项目的价值在于"轻"，任何让代码变重的改动都需要重新评估
- **任何涉及中文文本的文件操作，严格遵守上面的「文件编码与文本操作规范」**
- **任何涉及未提交改动的回滚操作，严格遵守上面的「Git 操作规范」**