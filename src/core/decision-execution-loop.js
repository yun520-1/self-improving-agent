/**
 * HeartFlow Decision-Execution Loop v11.19.5
 * 
 * 打通决策↔执行闭环：
 * 
 * 原始问题：
 *   decision-verifier.js → 决策验证 → 决策记录
 *   execution-verifier.js → 执行验证 → 结果
 *   两个模块独立工作，不知道对方存在
 * 
 * 闭环架构：
 *   决策阶段: DecisionVerifier.verify(record) → { valid, score, issues }
 *            → DecisionVerifier.selfVerify(record) → { selfVerified }
 *   执行阶段: ExecutionVerifier.verify(result, context) → { passed, issues }
 *   决策-执行环: DecisionExecutionLoop
 *       · plan 时: verifyDecision(decisionRecord) → 决策不通过则拒绝执行
 *       · execute 后: verifyExecution(result, context) → 执行不通过则触发 critic-healing-bridge
 *       · 决策执行对齐: 决策承诺的 == 执行实际交付的
 * 
 * Paper:
 *   - Process Supervision (DeepMind, 2023): process-based verification
 *   - Verifier First (OpenAI, 2024): verify before trust
 *   - Constitutional AI (Anthropic, 2022): constraint checking
 */

const { DecisionVerifier } = require('./decision-verifier.js');
const { ExecutionVerifier } = require('./execution-verifier.js');

class DecisionExecutionLoop {
  constructor(options = {}) {
    this.decisionVerifier = new DecisionVerifier(options.decisionOptions || {});
    this.executionVerifier = new ExecutionVerifier(options.executionOptions || {});
    
    this.threshold = {
      decision: options.decisionThreshold ?? 0.6,    // decision score < this → 拒绝
      execution: options.executionThreshold ?? 0.5,    // execution score < this → 触发修复
      alignment: options.alignmentThreshold ?? 0.7,   // decision vs execution alignment
    };
    
    // 历史追踪
    this.history = [];  // { decision, execution, alignmentScore, timestamp }
    this.maxHistory = options.maxHistory ?? 100;
    
    // 统计
    this.stats = {
      decisionsVerified: 0,
      decisionsRejected: 0,
      executionsVerified: 0,
      executionsFailed: 0,
      alignmentFailures: 0,
    };
  }

  // ============================================================
  // 阶段1: 决策验证 (plan 前)
  // ============================================================

  /**
   * 验证决策记录，返回是否允许执行
   * 
   * @param {Object} decisionRecord - { decision, reason, evidence, risks, expectedOutcome, userGoal }
   * @returns {Object} { allowed, verdict, details }
   */
  verifyDecision(decisionRecord = {}) {
    this.stats.decisionsVerified++;
    
    // 基础验证
    const dv = this.decisionVerifier.verify(decisionRecord);
    
    // 自我验证
    const sv = this.decisionVerifier.selfVerify(decisionRecord);
    
    const combinedScore = (dv.score + sv.score) / 2;
    const highSeverityIssues = dv.issues.filter(i => i.severity === 'high');
    const allowed = dv.valid && sv.selfVerified && highSeverityIssues.length === 0;
    
    if (!allowed) {
      this.stats.decisionsRejected++;
    }
    
    return {
      allowed,                                                   // 决策是否通过
      decisionScore: dv.score,                                    // 0-1
      selfVerified: sv.selfVerified,                             // 是否自我验证通过
      selfVerifyScore: sv.score,                                 // 自我验证分
      combinedScore,                                             // 综合分
      issues: dv.issues,                                        // 问题列表
      selfVerifyChecks: sv.checks,                               // 自我验证详情
      repairHints: dv.repairHints,                              // 修复提示
      verdict: allowed ? 'approved' 
        : highSeverityIssues.length > 0 ? 'rejected_high_severity'
        : !sv.selfVerified ? 'rejected_self_verify_failed'
        : 'rejected_low_score',
      summary: this._summarizeDecisionVerdict(dv, sv, allowed),
    };
  }

  // ============================================================
  // 阶段2: 执行验证 (execute 后)
  // ============================================================

  /**
   * 验证执行结果，返回是否成功 + 对齐评分
   * 
   * @param {Object} result - 执行结果
   * @param {Object} context - { plan, decision, expectedOutcome, task }
   * @returns {Object} { passed, alignmentScore, details }
   */
  verifyExecution(result = {}, context = {}) {
    this.stats.executionsVerified++;
    
    const { plan = {}, decision = {}, expectedOutcome = '', task = '' } = context;
    
    // 基础执行验证
    const ev = this.executionVerifier.verify(result, {
      plan,
      expectedOutcome: expectedOutcome || decision.expectedOutcome || plan.expectedOutcome || '',
    });
    
    // 决策-执行对齐验证
    const alignment = this._verifyAlignment(decision, result, expectedOutcome);
    
    const passed = ev.passed && alignment.aligned;
    
    if (!passed) {
      this.stats.executionsFailed++;
    }
    if (!alignment.aligned) {
      this.stats.alignmentFailures++;
    }
    
    return {
      passed,                                                    // 执行是否通过
      executionScore: ev.score,                                   // 0-1
      alignmentScore: alignment.score,                            // 决策vs执行对齐分
      alignment,                                                  // 对齐详情
      issues: ev.issues,                                         // 执行问题
      retryRecommended: ev.retryRecommended,                      // 是否建议重试
      suggestedNextStep: ev.suggestedNextStep,                   // 下一步建议
      verdict: passed ? 'passed' 
        : !alignment.aligned ? 'alignment_failed'
        : ev.retryRecommended ? 'retry_recommended'
        : 'failed',
      summary: `${ev.passed ? '✅' : '❌'} exec=${ev.score} align=${alignment.score.toFixed(2)}`,
    };
  }

  // ============================================================
  // 阶段3: 完整闭环 (plan → execute → verify)
  // ============================================================

  /**
   * 完整闭环验证
   * 
   * @param {Object} decisionRecord - 决策记录
   * @param {Object} executionResult - 执行结果
   * @param {Object} context - { task, plan }
   * @returns {Object} { phase, verdict, details }
   */
  runLoop(decisionRecord = {}, executionResult = {}, context = {}) {
    const phase1 = this.verifyDecision(decisionRecord);
    const phase2 = this.verifyExecution(executionResult, {
      ...context,
      decision: decisionRecord,
    });
    
    // 记录历史
    const entry = {
      decision: phase1,
      execution: phase2,
      timestamp: Date.now(),
      combinedScore: (phase1.combinedScore + phase2.alignmentScore) / 2,
    };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    
    // 整体判定
    const overallPassed = phase1.allowed && phase2.passed;
    
    return {
      overallPassed,
      phase1,   // 决策验证
      phase2,   // 执行验证
      verdict: overallPassed ? 'loop_passed' : 'loop_failed',
      improvementHints: this._generateImprovementHints(phase1, phase2),
    };
  }

  // ============================================================
  // 决策-执行对齐验证
  // ============================================================

  _verifyAlignment(decision = {}, result = {}, expectedOutcome = '') {
    // 检查决策承诺的 vs 执行交付的
    
    // 1. 期望结果对齐
    let outcomeAlignment = 1.0;
    if (expectedOutcome || decision.expectedOutcome) {
      const target = expectedOutcome || decision.expectedOutcome;
      const resultText = typeof result === 'object' ? JSON.stringify(result) : String(result);
      const targetKeywords = this._extractKeywords(target);
      const resultKeywords = this._extractKeywords(resultText);
      
      const covered = targetKeywords.filter(k => 
        resultKeywords.some(rk => rk.includes(k) || k.includes(rk))
      );
      outcomeAlignment = targetKeywords.length > 0 
        ? covered.length / targetKeywords.length 
        : 1.0;
    }
    
    // 2. 行动对齐（决策说了做什么，执行真的做了吗）
    let actionAlignment = 1.0;
    const decisionAction = decision.decision || '';
    const resultText = typeof result === 'object' ? JSON.stringify(result) : String(result);
    
    if (decisionAction) {
      const actionKeywords = this._extractKeywords(decisionAction);
      const resultHasAction = actionKeywords.some(k => 
        resultText.toLowerCase().includes(k.toLowerCase())
      );
      actionAlignment = resultHasAction ? 1.0 : 0.0;
    }
    
    // 3. 约束对齐（决策说的限制，执行遵守了吗）
    let constraintAlignment = 1.0;
    const constraints = decision.constraints || [];
    if (constraints.length > 0) {
      const violatedConstraints = constraints.filter(c => {
        const constraintText = String(c).toLowerCase();
        return !resultText.toLowerCase().includes(constraintText);
      });
      constraintAlignment = constraints.length > 0
        ? (constraints.length - violatedConstraints.length) / constraints.length
        : 1.0;
    }
    
    const score = (outcomeAlignment + actionAlignment + constraintAlignment) / 3;
    const aligned = score >= this.threshold.alignment;
    
    return {
      score: Number(score.toFixed(3)),
      aligned,
      outcomeAlignment: Number(outcomeAlignment.toFixed(3)),
      actionAlignment: Number(actionAlignment.toFixed(3)),
      constraintAlignment: Number(constraintAlignment.toFixed(3)),
      details: {
        outcomeCoverage: outcomeAlignment < 1.0 ? `${(outcomeAlignment*100).toFixed(0)}% 期望结果覆盖` : '100%',
        actionCoverage: actionAlignment < 1.0 ? '执行动作与决策不符' : '动作对齐',
        constraintCheck: constraintAlignment < 1.0 ? '违反约束' : '约束遵守',
      },
    };
  }

  _extractKeywords(text) {
    if (!text) return [];
    const stopWords = new Set(['的', '了', '是', '在', '和', '与', '对', '为', '以', '于', 'the', 'a', 'an', 'is', 'are', 'and', 'or']);
    return String(text)
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  // ============================================================
  // 辅助
  // ============================================================

  _summarizeDecisionVerdict(dv, sv, allowed) {
    if (allowed) return '✅ 决策通过';
    const issues = [];
    if (!dv.valid) issues.push('基础验证失败');
    if (!sv.selfVerified) issues.push('自我验证失败');
    return `❌ ${issues.join(' + ')}`;
  }

  _generateImprovementHints(phase1, phase2) {
    const hints = [];
    
    if (!phase1.allowed) {
      if (phase1.repairHints) hints.push(...phase1.repairHints);
      if (!phase1.selfVerified) hints.push('决策自我验证失败，需重新审视决策逻辑链');
    }
    
    if (!phase2.passed) {
      if (phase2.issues?.length) {
        hints.push(...phase2.issues.map(i => `执行问题: ${i.message}`));
      }
      if (!phase2.alignment?.aligned) {
        hints.push(`决策-执行不对齐: ${phase2.alignment.details?.outcomeCoverage || ''}`);
      }
    }
    
    return [...new Set(hints)].slice(0, 5);
  }

  // ============================================================
  // 历史与统计
  // ============================================================

  getHistory(limit = 10) {
    return this.history.slice(-limit);
  }

  getStats() {
    const total = this.stats.decisionsVerified;
    return {
      ...this.stats,
      decisionRejectRate: total > 0 
        ? (this.stats.decisionsRejected / total).toFixed(3) 
        : 'N/A',
      executionFailRate: this.stats.executionsVerified > 0
        ? (this.stats.executionsFailed / this.stats.executionsVerified).toFixed(3)
        : 'N/A',
      alignmentFailRate: this.stats.executionsVerified > 0
        ? (this.stats.alignmentFailures / this.stats.executionsVerified).toFixed(3)
        : 'N/A',
    };
  }

  getStatus() {
    return {
      loops: this.history.length,
      thresholds: this.threshold,
      recentScore: this.history.length > 0 
        ? this.history[this.history.length - 1].combinedScore.toFixed(3)
        : 'N/A',
    };
  }
}

module.exports = { DecisionExecutionLoop };
