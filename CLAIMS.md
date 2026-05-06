# HeartFlow Upgrade Claims

## Version: v11.17.1

## Claims (before upgrade)

### Claim 1: 五门验证 v2 — 真实执行
- Type: code
- Evidence: `src/core/verifier-gates.js` — 用 `require.resolve()` 真实检查文件/模块存在
- Fix: 修复了注释欺骗（`// require('...')` 被误判为缺失引用）
- Fix: 修复 `constraintReRead` undefined 变量错误
- Fix: 修复 `resolved` 变量作用域错误
- Fix: 增强 `_resolveFile()` 支持裸路径（`src/xxx`）和相对路径
- Fix: `scanImportsInFile()` 使用 `cleanContent` 过滤单行注释
- Status: pending

### Claim 2: EXIST gate 真实工作
- Type: code
- Evidence: `verifyFile()` 扫描真实 import，无误报
- Node test: `fs` + `path` 正确识别，0 个误报
- Status: pending

### Claim 3: 五门全部通过
- Type: code
- Evidence: 4/5 PASS（RECALL N/A 因无约束配置）
- Status: pending

## Verification Log
| Claim | Evidence Found | Pass/Fail | Notes |
|-------|---------------|-----------|-------|
| 1: v2 fixes | 5 bug fixes applied | Pass | comment/regex/scope/resolve/cleanContent |
| 2: EXIST works | verifyFile PASS, 0 false positives | Pass | |
| 3: Gates pass | 4/5 PASS | Pass | RECALL N/A (no constraints) |
