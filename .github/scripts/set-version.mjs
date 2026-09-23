/**
 * 把 tag 上的版本号写进三处版本声明。
 *
 * 为什么需要它：版本号散在三个文件里（前端包、Tauri 配置、Rust 包），
 * 而产物名（`闪记_<版本>_x64-setup.exe`）与 exe 的版本资源都取自它们。
 * 靠人记得打 tag 前手工改三处，早晚会不一致；这里让 CI 在读 tag 时统一写入。
 *
 * 用法：
 *   node .github/scripts/set-version.mjs v1.2.3 [--root <dir>] [--dry-run]
 *
 * 只改「找到且唯一」的那一处；找不到或有多处会直接失败（宁可红，也不要静默改错文件）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const rawTag = argv.find((arg) => !arg.startsWith("--"));
if (rawTag === undefined) {
  console.error("用法：node .github/scripts/set-version.mjs v1.2.3 [--root <dir>] [--dry-run]");
  process.exit(2);
}

const version = rawTag.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`版本号不像 semver：${rawTag}`);
  process.exit(2);
}

const rootIndex = argv.indexOf("--root");
const root = rootIndex >= 0 ? argv[rootIndex + 1] : ".";
const dryRun = argv.includes("--dry-run");

/**
 * 每个文件一份「怎么找版本声明」的工厂。
 * 每次都新建正则：带 g 标志的正则有 lastIndex 状态，复用同一个对象会踩坑。
 */
const jsonVersion = () => /"version"\s*:\s*"([^"]+)"/g;
/** Cargo.toml 里 [package] 段的 `version = "x.y.z"`（取第一个，依赖项的 version 在后面） */
const tomlVersion = () => /^version\s*=\s*"([^"]+)"/gm;

const targets = [
  { file: "package.json", pattern: jsonVersion },
  { file: "src-tauri/tauri.conf.json", pattern: jsonVersion },
  { file: "src-tauri/Cargo.toml", pattern: tomlVersion },
];

let failed = false;
for (const target of targets) {
  const path = join(root, target.file);
  const text = readFileSync(path, "utf8");
  const matches = [...text.matchAll(target.pattern())];
  if (matches.length !== 1) {
    console.error(`${target.file}: 期望恰好一处版本声明，实际找到 ${matches.length} 处`);
    failed = true;
    continue;
  }
  const current = matches[0][1];
  if (current === version) {
    console.log(`${target.file}: 已经是 ${version}`);
    continue;
  }
  const start = matches[0].index + matches[0][0].lastIndexOf(current);
  const updated = text.slice(0, start) + version + text.slice(start + current.length);
  console.log(`${target.file}: ${current} -> ${version}${dryRun ? "（dry-run，未写入）" : ""}`);
  if (!dryRun) writeFileSync(path, updated, "utf8");
}

if (failed) process.exit(1);
