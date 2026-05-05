# HeartFlow Upgrade Claims

## Version: v11.16.1

## Claims (before upgrade)

### Claim 1: 知行合一自检系统
- Type: both
- Evidence: scripts/knowledge-action-check.sh — 7项核心指令逐一对照检查
- Status: pending

### Claim 2: pre-upgrade-verify.sh 保留
- Type: both
- Evidence: scripts/pre-upgrade-verify.sh 已有并正常工作
- Status: pending

### Claim 3: .bak 文件从 src/core/archive 移至 archive/src-core-backup/
- Type: code
- Evidence: 45 个 .bak 文件通过 git mv 移动
- Status: pending

### Claim 4: README 自测示例修复
- Type: docs
- Evidence: stateful-agent.js 路径修正，promise 链改为同步
- Status: pending

## Verification Log
| Claim | Evidence Found | Pass/Fail | Notes |
|-------|---------------|-----------|-------|
| 1: 知行合一系统 | knowledge-action-check.sh 运行通过 | Pass | 7/7 通过 |
| 2: pre-upgrade-verify | scripts/pre-upgrade-verify.sh 存在 | Pass | |
| 3: .bak 移动 | git mv tracked, archive/src-core-backup/ | Pass | 45 files |
| 4: README fix | README.md 两处路径修正 | Pass | stateful-agent.js |
