# HeartFlow Upgrade Claims

## Version: v11.17.2

## Claims (before upgrade)

### Claim 1: LanguageHonesty 接入主循环
- Type: code
- Evidence: `processInput()` 返回值 `stages.languageHonesty`
- 测试: `passed: false, certaintyLevel: over` — 绝对判断词被检测
- Status: pending

## Verification Log
| Claim | Evidence Found | Pass/Fail | Notes |
|-------|---------------|-----------|-------|
| 1: LanguageHonesty integrated | validateOutput called in processInput, result captured | Pass | |
