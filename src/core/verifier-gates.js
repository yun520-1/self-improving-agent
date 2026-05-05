/**
 * HeartFlow Verifier Gates
 * 心虫知行合一五门验证系统
 * 
 * Based on: Ouro Loop modules/verify.md + sentinel.py
 * GitHub: VictorVVedtion/ouro-loop (MIT License)
 * 
 * 五门验证：
 * 1. EXIST   — 防幻觉：引用的文件/函数/API是否存在
 * 2. RELEVANCE — 防偏离：当前工作是否在计划范围内
 * 3. ROOT_CAUSE — 防循环：是否在修复根因而非症状
 * 4. RECALL  — 防遗忘：是否还记得核心约束
 * 5. MOMENTUM — 防空转：读/写比例是否正常
 */

const fs = require('fs');
const path = require('path');

const GATES = {
  EXIST: {
    name: 'EXIST',
    question: 'Do all referenced files, functions, and APIs actually exist?',
    description: '防幻觉 — the most common AI coding error'
  },
  RELEVANCE: {
    name: 'RELEVANCE',
    question: 'Is this work related to the current task?',
    description: '防偏离 — working on interesting but irrelevant things'
  },
  ROOT_CAUSE: {
    name: 'ROOT_CAUSE',
    question: 'Is this fixing the root cause, not just a symptom?',
    description: '防循环 — fix/break/fix/break cycles'
  },
  RECALL: {
    name: 'RECALL',
    question: 'Can you still articulate the original constraints?',
    description: '防遗忘 — forgetting constraints as context grows'
  },
  MOMENTUM: {
    name: 'MOMENTUM',
    question: 'Are you making forward progress?',
    description: '防空转 — spinning wheels without progress'
  }
};

// Read:Write ratio threshold for MOMENTUM gate
const MOMENTUM_RATIO_THRESHOLD = 3;
const SAME_ERROR_THRESHOLD = 3;
const RECALL_CONTEXT_THRESHOLD = 0.7;

class VerifierGates {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot || path.join(__dirname, '../..');
    this.actions = [];
    this.errors = [];
    this.filesRead = new Set();
    this.filesWritten = new Set();
    this.constraints = options.constraints || [];
    this.taskGoal = options.taskGoal || '';
    this.planScope = options.planScope || [];
  }

  /**
   * 记录一个动作
   */
  recordAction(action) {
    this.actions.push({
      type: action.type, // 'read' | 'write' | 'edit' | 'execute' | 'verify'
      target: action.target,
      timestamp: Date.now()
    });

    if (action.type === 'read' && action.target) {
      this.filesRead.add(action.target);
    }
    if (action.type === 'write' && action.target) {
      this.filesWritten.add(action.target);
    }
    if (action.type === 'error' && action.target) {
      this.errors.push(action.target);
    }
  }

  /**
   * Gate 1: EXIST — 验证所有引用的文件/函数/API是否存在
   */
  checkExist(references = []) {
    const results = [];
    const failures = [];

    for (const ref of references) {
      // ref: { type: 'file'|'function'|'module'|'api', path: string }
      let exists = false;

      if (ref.type === 'file' || ref.type === 'module') {
        const filePath = ref.path.startsWith('/') 
          ? ref.path 
          : path.join(this.repoRoot, ref.path);
        exists = fs.existsSync(filePath);
      } else if (ref.type === 'function' || ref.type === 'api') {
        // For code-level references, we check if they appear in known files
        exists = this._functionExists(ref.path);
      }

      results.push({ ref: ref.path, type: ref.type, exists });
      if (!exists) failures.push(ref.path);
    }

    const verdict = failures.length === 0 ? 'PASS' : 'FAIL';
    return {
      gate: 'EXIST',
      question: GATES.EXIST.question,
      verdict,
      failures,
      total: references.length,
      passCount: references.length - failures.length
    };
  }

  _functionExists(functionRef) {
    // 简化版：检查函数引用是否在已知文件中出现过
    const knownFiles = Array.from(this.filesRead);
    for (const file of knownFiles) {
      if (!fs.existsSync(file)) continue;
      try {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes(functionRef.split('.').pop())) return true;
      } catch {}
    }
    return false;
  }

  /**
   * Gate 2: RELEVANCE — 验证当前工作是否在计划范围内
   */
  checkRelevance() {
    if (this.planScope.length === 0) {
      return {
        gate: 'RELEVANCE',
        question: GATES.RELEVANCE.question,
        verdict: 'N/A',
        reason: 'No plan scope defined',
        outOfScope: []
      };
    }

    const outOfScope = [];
    for (const written of this.filesWritten) {
      const fileName = path.basename(written);
      const isInScope = this.planScope.some(scope => {
        if (typeof scope === 'string') return fileName.includes(scope);
        if (scope.pattern) return new RegExp(scope.pattern).test(fileName);
        return false;
      });
      if (!isInScope) {
        outOfScope.push(written);
      }
    }

    const verdict = outOfScope.length === 0 ? 'PASS' : 'FAIL';
    return {
      gate: 'RELEVANCE',
      question: GATES.RELEVANCE.question,
      verdict,
      outOfScope,
      inScope: this.filesWritten.size - outOfScope.length
    };
  }

  /**
   * Gate 3: ROOT_CAUSE — 检查是否在修复根因而非症状
   */
  checkRootCause() {
    if (this.errors.length < 2) {
      return {
        gate: 'ROOT_CAUSE',
        question: GATES.ROOT_CAUSE.question,
        verdict: 'PASS',
        reason: 'Few errors — no repeated patterns detected'
      };
    }

    // 检查是否有相同的错误重复出现
    const errorCounts = {};
    for (const err of this.errors) {
      const key = err.replace(/\d+/g, 'N'); // 数字归一化
      errorCounts[key] = (errorCounts[key] || 0) + 1;
    }

    const repeatedErrors = Object.entries(errorCounts)
      .filter(([_, count]) => count >= SAME_ERROR_THRESHOLD)
      .map(([err]) => err);

    if (repeatedErrors.length > 0) {
      return {
        gate: 'ROOT_CAUSE',
        question: GATES.ROOT_CAUSE.question,
        verdict: 'FAIL',
        reason: 'Same error pattern detected 3+ times',
        repeatedErrors,
        isSymptomFixing: true
      };
    }

    return {
      gate: 'ROOT_CAUSE',
      question: GATES.ROOT_CAUSE.question,
      verdict: 'PASS',
      reason: 'Errors appear to be addressed at root level'
    };
  }

  /**
   * Gate 4: RECALL — 检查是否还记得核心约束
   */
  checkRecall() {
    if (this.constraints.length === 0 || !this.taskGoal) {
      return {
        gate: 'RECALL',
        question: GATES.RECALL.question,
        verdict: 'N/A',
        reason: 'No constraints or task goal defined'
      };
    }

    // 检查近期 actions 是否还能关联到 constraints
    const recentActions = this.actions.slice(-10);
    const recentContent = recentActions
      .filter(a => a.type === 'read' || a.type === 'write')
      .map(a => a.target)
      .join(' ');

    // 约束被遗忘的标志：在没有重读约束文件的情况下持续产出
    const constraintKeywords = this.constraints.map(c => {
      if (typeof c === 'string') return c;
      return c.keyword || '';
    });

    const hasRecalledConstraint = constraintKeywords.some(kw => 
      recentContent.includes(kw)
    );

    if (!hasRecalledConstraint && recentActions.length >= 5) {
      return {
        gate: 'RECALL',
        question: GATES.RECALL.question,
        verdict: 'WARN',
        reason: 'No constraint re-reading detected in recent actions'
      };
    }

    return {
      gate: 'RECALL',
      question: GATES.RECALL.question,
      verdict: 'PASS',
      taskGoal: this.taskGoal,
      constraintCount: this.constraints.length
    };
  }

  /**
   * Gate 5: MOMENTUM — 检查读/写比例是否正常
   */
  checkMomentum() {
    const readCount = this.filesRead.size;
    const writeCount = this.filesWritten.size;

    if (readCount === 0) {
      return {
        gate: 'MOMENTUM',
        question: GATES.MOMENTUM.question,
        verdict: 'PASS',
        reason: 'No reads yet'
      };
    }

    const ratio = readCount / Math.max(writeCount, 1);

    if (ratio > MOMENTUM_RATIO_THRESHOLD) {
      return {
        gate: 'MOMENTUM',
        question: GATES.MOMENTUM.question,
        verdict: 'FAIL',
        ratio: ratio.toFixed(2),
        threshold: MOMENTUM_RATIO_THRESHOLD,
        reason: `Read/Write ratio ${ratio.toFixed(1)}:1 exceeds threshold ${MOMENTUM_RATIO_THRESHOLD}:1`,
        reads: readCount,
        writes: writeCount
      };
    }

    return {
      gate: 'MOMENTUM',
      question: GATES.MOMENTUM.question,
      verdict: 'PASS',
      ratio: ratio.toFixed(2),
      threshold: MOMENTUM_RATIO_THRESHOLD,
      reads: readCount,
      writes: writeCount
    };
  }

  /**
   * 运行全部五门验证
   */
  runAll(references = []) {
    const gate1 = this.checkExist(references);
    const gate2 = this.checkRelevance();
    const gate3 = this.checkRootCause();
    const gate4 = this.checkRecall();
    const gate5 = this.checkMomentum();

    const gates = [gate1, gate2, gate3, gate4, gate5];
    const passed = gates.filter(g => g.verdict === 'PASS').length;
    const failed = gates.filter(g => g.verdict === 'FAIL').length;
    const warnings = gates.filter(g => g.verdict === 'WARN').length;

    return {
      timestamp: new Date().toISOString(),
      totalGates: 5,
      passed,
      failed,
      warnings,
      verdict: failed > 0 ? 'FAIL' : warnings > 0 ? 'WARN' : 'PASS',
      gates,
      actions: {
        reads: this.filesRead.size,
        writes: this.filesWritten.size,
        errors: this.errors.length
      }
    };
  }

  /**
   * 生成验证报告（人类可读）
   */
  formatReport(result) {
    const lines = [];
    lines.push('========================================');
    lines.push('  心虫知行合一 · 五门验证报告');
    lines.push('========================================');
    lines.push('');
    lines.push(`判定: ${result.verdict} (${result.passed}/${result.totalGates} 通过)`);
    lines.push('');
    lines.push('门次  结果  详情');
    lines.push('----------------------------------------');

    const gateNames = ['EXIST', 'RELEVANCE', 'ROOT_CAUSE', 'RECALL', 'MOMENTUM'];
    result.gates.forEach((gate, i) => {
      const icon = gate.verdict === 'PASS' ? '✓' : gate.verdict === 'FAIL' ? '✗' : '⚠';
      lines.push(`${gateNames[i]}  ${icon}     ${gate.reason || gate.verdict}`);
    });

    lines.push('');
    lines.push(`读/写: ${result.actions.reads}/${result.actions.writes}`);
    lines.push(`错误数: ${result.actions.errors}`);

    if (result.verdict === 'FAIL') {
      lines.push('');
      lines.push('✗ 知行不合一 — 请修复失败的验证门');
    } else if (result.verdict === 'WARN') {
      lines.push('');
      lines.push('⚠ 知行待验证 — 建议重读约束文件');
    } else {
      lines.push('');
      lines.push('✓ 知行合一 — 验证通过');
    }

    return lines.join('\n');
  }
}

module.exports = { VerifierGates, GATES };
