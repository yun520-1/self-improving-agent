/**
 * HeartFlow Guardrail Engine v11.7.6
 * 
 * 整合:
 *   - VoltAgent Guardrails ⭐8617 - Input/Output 中间件验证
 *   - LangChain Guardrails - 安全边界
 * 
 * 核心概念:
 *   1. Input Guardrail - 用户输入检查
 *   2. Output Guardrail - AI 输出检查
 *   3. Middleware - 输入/输出转换
 *   4. Guardrail Chain - 多重验证链
 *   5. Severity Levels - 严重程度分级处理
 */

class GuardrailResult {
  constructor(options = {}) {
    this.action = options.action || 'allow';  // allow, block, transform, warn
    this.severity = options.severity || 'low'; // low, medium, high, critical
    this.message = options.message || '';
    this.evidence = options.evidence || null;  // 触发验证的具体内容
    this.metadata = options.metadata || {};
  }

  static allow(evidence = null, message = '') {
    return new GuardrailResult({ action: 'allow', evidence, message });
  }

  static block(evidence, message, severity = 'high') {
    return new GuardrailResult({ action: 'block', evidence, message, severity });
  }

  static warn(evidence, message) {
    return new GuardrailResult({ action: 'warn', evidence, message });
  }

  static transform(content, evidence, message) {
    return new GuardrailResult({ action: 'transform', evidence, message, metadata: { transformed: content } });
  }

  isAllowed() { return this.action === 'allow'; }
  isBlocked() { return this.action === 'block'; }
  isWarning() { return this.action === 'warn'; }
  needsTransform() { return this.action === 'transform'; }
}

class Guardrail {
  constructor(config) {
    this.name = config.name || 'UnnamedGuardrail';
    this.description = config.description || '';
    this.validate = config.validate || (() => GuardrailResult.allow());
    this.transform = config.transform || null;
    this.severityThreshold = config.severityThreshold || 'low';
  }

  /**
   * 执行验证
   */
  async check(input, context = {}) {
    try {
      const result = await this.validate(input, { ...context, guardrail: this });
      
      if (result instanceof GuardrailResult) {
        return result;
      }
      
      // 处理简单布尔返回值
      if (result === true) {
        return GuardrailResult.allow(input, `${this.name}: passed`);
      }
      if (result === false) {
        return GuardrailResult.block(input, `${this.name}: validation failed`);
      }
      
      // 处理对象返回值
      if (typeof result === 'object') {
        return new GuardrailResult({
          action: result.action || 'allow',
          severity: result.severity || 'low',
          message: result.message || '',
          evidence: result.evidence || input,
          metadata: result.metadata || {},
        });
      }
      
      return GuardrailResult.allow(input);
    } catch (e) {
      return GuardrailResult.block(input, `${this.name} error: ${e.message}`, 'medium');
    }
  }
}

// ============================================================
// 常用 Guardrail 工厂函数
// ============================================================

const Guardrails = {
  /**
   * 敏感词过滤
   */
  createProfanityFilter(config = {}) {
    const { words = [], action = 'block', severity = 'medium' } = config;
    const wordSet = new Set(words.map(w => w.toLowerCase()));
    
    return new Guardrail({
      name: 'ProfanityFilter',
      description: 'Filter profanity and inappropriate language',
      validate: (input) => {
        const text = input.toLowerCase();
        const found = [];
        for (const word of wordSet) {
          if (text.includes(word)) found.push(word);
        }
        
        if (found.length === 0) return GuardrailResult.allow();
        
        if (action === 'block') {
          return GuardrailResult.block(
            input,
            `Profanity detected: ${found.join(', ')}`,
            severity
          );
        }
        
        return GuardrailResult.warn(
          input,
          `Potentially inappropriate language: ${found.join(', ')}`
        );
      },
    });
  },

  /**
   * PII 脱敏 (邮箱、手机号)
   */
  createPIIRedactor(config = {}) {
    const { patterns = {}, action = 'transform' } = config;
    
    const defaultPatterns = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
      ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
      creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
      ...patterns,
    };
    
    return new Guardrail({
      name: 'PIIRedactor',
      description: 'Detect and redact Personally Identifiable Information',
      validate: (input) => {
        let transformed = input;
        const found = [];
        
        for (const [type, regex] of Object.entries(defaultPatterns)) {
          const matches = input.match(regex);
          if (matches) {
            found.push(...matches.map(m => ({ type, value: m })));
            transformed = transformed.replace(regex, `[${type.toUpperCase()}_REDACTED]`);
          }
        }
        
        if (found.length === 0) return GuardrailResult.allow();
        
        return new GuardrailResult({
          action,
          severity: 'high',
          message: `PII detected: ${found.map(f => f.type).join(', ')}`,
          evidence: found,
          metadata: { transformed, original: input },
        });
      },
    });
  },

  /**
   * 最大长度限制
   */
  createMaxLength(maxLength = 10000, severity = 'medium') {
    return new Guardrail({
      name: 'MaxLength',
      description: `Limit input length to ${maxLength} characters`,
      validate: (input) => {
        if (typeof input !== 'string') input = String(input);
        if (input.length > maxLength) {
          return GuardrailResult.block(
            input,
            `Input exceeds maximum length: ${input.length} > ${maxLength}`,
            severity
          );
        }
        return GuardrailResult.allow(input);
      },
    });
  },

  /**
   * Prompt 注入检测
   */
  createPromptInjectionDetector(config = {}) {
    const { patterns = [], severity = 'critical' } = config;
    
    const injectionPatterns = [
      /ignore (previous|all|above|prior) instructions/i,
      /disregard (your|the) (previous|system|original)/i,
      /you (are now|can now|should now|will now)/i,
      /forget (everything|all|what) (you|we) (told|said|learned)/i,
      /new (system |)(instruction|directive|rule|goal)/i,
      /<system|<instruction|<prompt>/i,
      /\[INST\]|\[\/INST\]/i,
      /{{(?!.*}})/,
      /```system|```instructions/i,
      ...patterns,
    ];
    
    return new Guardrail({
      name: 'PromptInjectionDetector',
      description: 'Detect prompt injection attempts',
      validate: (input) => {
        for (const pattern of injectionPatterns) {
          const match = input.match(pattern);
          if (match) {
            return GuardrailResult.block(
              input,
              `Potential prompt injection detected: "${match[0]}"`,
              severity
            );
          }
        }
        return GuardrailResult.allow(input);
      },
    });
  },

  /**
   * 自定义正则验证
   */
  createRegexValidator(config) {
    const { pattern, name, description, action = 'block', message = 'Pattern matched' } = config;
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    
    return new Guardrail({
      name: name || 'RegexValidator',
      description: description || `Validate against pattern: ${regex}`,
      validate: (input) => {
        if (!regex.test(input)) return GuardrailResult.allow(input);
        return new GuardrailResult({
          action,
          severity: 'medium',
          message,
          evidence: input,
        });
      },
    });
  },

  /**
   * 关键词白名单
   */
  createWhitelist(allowedTerms = [], action = 'block') {
    const terms = allowedTerms.map(t => t.toLowerCase());
    
    return new Guardrail({
      name: 'Whitelist',
      description: 'Enforce allowed terms only',
      validate: (input) => {
        const lower = input.toLowerCase();
        const allowed = terms.every(term => lower.includes(term));
        
        if (allowed || terms.length === 0) return GuardrailResult.allow(input);
        
        return new GuardrailResult({
          action,
          severity: 'medium',
          message: 'Input contains non-whitelisted content',
          evidence: input,
        });
      },
    });
  },

  /**
   * JSON 格式验证
   */
  createJSONValidator(options = {}) {
    const { maxDepth = 10, maxKeys = 1000, action = 'block' } = options;
    
    return new Guardrail({
      name: 'JSONValidator',
      description: 'Validate JSON structure and size',
      validate: (input) => {
        try {
          const obj = JSON.parse(input);
          
          // 检查深度
          const checkDepth = (o, depth = 0) => {
            if (depth > maxDepth) throw new Error(`Max depth ${maxDepth} exceeded`);
            if (typeof o === 'object' && o !== null) {
              const keys = Object.keys(o);
              if (keys.length > maxKeys) throw new Error(`Max keys ${maxKeys} exceeded`);
              keys.forEach(k => checkDepth(o[k], depth + 1));
            }
          };
          checkDepth(obj);
          
          return GuardrailResult.allow(input);
        } catch (e) {
          return new GuardrailResult({
            action,
            severity: 'medium',
            message: `JSON validation failed: ${e.message}`,
            evidence: input.substring(0, 200),
          });
        }
      },
    });
  },
};

// ============================================================
// Guardrail Chain - 多重验证链
// ============================================================

class GuardrailChain {
  constructor(options = {}) {
    this.name = options.name || 'GuardrailChain';
    this.guardrails = [];
    this.stopOn = options.stopOn || 'block'; // 'block' | 'warn' | 'never'
    this.onResult = options.onResult || null; // 回调
  }

  /**
   * 添加 Guardrail
   */
  add(guardrail, options = {}) {
    this.guardrails.push({
      guardrail,
      condition: options.condition || null,  // 可选的条件函数
      priority: options.priority || 0,       // 优先级
    });
    this.guardrails.sort((a, b) => b.priority - a.priority);
    return this;
  }

  /**
   * 添加多个 Guardrail
   */
  addAll(...guardrails) {
    guardrails.forEach(g => this.add(g));
    return this;
  }

  /**
   * 执行验证链
   */
  async validate(input, context = {}) {
    const results = [];
    let finalAction = 'allow';
    let finalSeverity = 'low';
    let transformed = input;

    for (const { guardrail, condition } of this.guardrails) {
      // 检查条件
      if (condition && !condition(input, context)) {
        continue;
      }

      const result = await guardrail.check(input, context);
      results.push({ guardrail: guardrail.name, result });

      // 回调
      if (this.onResult) {
        this.onResult(guardrail.name, result, context);
      }

      // 严重程度升级
      if (this._severityLevel(result.severity) > this._severityLevel(finalSeverity)) {
        finalSeverity = result.severity;
      }

      // 处理结果
      switch (result.action) {
        case 'block':
          finalAction = 'block';
          if (this.stopOn === 'block') {
            return new GuardrailResult({
              action: 'block',
              severity: finalSeverity,
              message: `${guardrail.name}: ${result.message}`,
              evidence: result.evidence,
              metadata: { results, allResults: results },
            });
          }
          break;

        case 'warn':
          if (finalAction === 'allow') finalAction = 'warn';
          if (this.stopOn === 'warn') {
            return new GuardrailResult({
              action: 'warn',
              severity: finalSeverity,
              message: `${guardrail.name}: ${result.message}`,
              evidence: result.evidence,
              metadata: { results },
            });
          }
          break;

        case 'transform':
          if (result.metadata?.transformed) {
            transformed = result.metadata.transformed;
          }
          break;
      }
    }

    return new GuardrailResult({
      action: finalAction,
      severity: finalSeverity,
      message: finalAction === 'allow' ? 'All guardrails passed' : 'Guardrails found issues',
      evidence: transformed,
      metadata: { results, transformed },
    });
  }

  _severityLevel(severity) {
    const levels = { low: 0, medium: 1, high: 2, critical: 3 };
    return levels[severity] ?? 0;
  }

  stats() {
    return {
      name: this.name,
      guardrailCount: this.guardrails.length,
      guardrails: this.guardrails.map(g => g.guardrail.name),
    };
  }
}

// ============================================================
// Guardrail Manager - 全局管理
// ============================================================

class GuardrailManager {
  constructor() {
    this.chains = new Map();
    this.defaultChain = new GuardrailChain({ name: 'default' });
  }

  /**
   * 创建链
   */
  createChain(name, options = {}) {
    const chain = new GuardrailChain({ ...options, name });
    this.chains.set(name, chain);
    return chain;
  }

  /**
   * 获取链
   */
  getChain(name) {
    return this.chains.get(name) || this.defaultChain;
  }

  /**
   * 设置默认链
   */
  setDefaultChain(chain) {
    this.defaultChain = chain;
    return this;
  }

  /**
   * 验证输入
   */
  async validate(input, chainName = null, context = {}) {
    const chain = chainName ? this.getChain(chainName) : this.defaultChain;
    return chain.validate(input, context);
  }

  /**
   * 验证输出
   */
  async validateOutput(output, chainName = 'output', context = {}) {
    return this.validate(output, chainName, { ...context, direction: 'output' });
  }

  /**
   * 验证输入
   */
  async validateInput(input, chainName = 'input', context = {}) {
    return this.validate(input, chainName, { ...context, direction: 'input' });
  }

  /**
   * 创建预置链
   */
  createSafetyChain() {
    return this.createChain('safety')
      .add(Guardrails.createMaxLength(50000))
      .add(Guardrails.createPromptInjectionDetector())
      .add(Guardrails.createJSONValidator());
  }

  createPIIChain() {
    return this.createChain('pii')
      .add(Guardrails.createPIIRedactor({ action: 'transform' }));
  }

  createModerationChain() {
    return this.createChain('moderation')
      .add(Guardrails.createProfanityFilter({ action: 'warn' }));
  }
}

// ============================================================
// 中间件 (VoltAgent 风格)
// ============================================================

class Middleware {
  constructor(config) {
    this.name = config.name || 'Middleware';
    this.process = config.process;
    this.direction = config.direction || 'both'; // 'input' | 'output' | 'both'
  }

  async run(content, context = {}) {
    return this.process(content, { ...context, middleware: this });
  }
}

class MiddlewareChain {
  constructor(options = {}) {
    this.name = options.name || 'MiddlewareChain';
    this.inputMiddlewares = [];
    this.outputMiddlewares = [];
  }

  use(middleware) {
    if (middleware.direction === 'input' || middleware.direction === 'both') {
      this.inputMiddlewares.push(middleware);
    }
    if (middleware.direction === 'output' || middleware.direction === 'both') {
      this.outputMiddlewares.push(middleware);
    }
    return this;
  }

  async processInput(content, context = {}) {
    let result = content;
    for (const mw of this.inputMiddlewares) {
      result = await mw.run(result, context);
    }
    return result;
  }

  async processOutput(content, context = {}) {
    let result = content;
    for (const mw of this.outputMiddlewares) {
      result = await mw.run(result, context);
    }
    return result;
  }
}

// ============================================================
// 预置中间件
// ============================================================

const Middlewares = {
  /**
   * HTML 清理
   */
  createHTMLSanitizer() {
    return new Middleware({
      name: 'HTMLSanitizer',
      direction: 'input',
      process: (input) => {
        return input
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
          .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
          .replace(/javascript:/gi, '');
      },
    });
  },

  /**
   * Markdown 清理
   */
  createMarkdownCleaner() {
    return new Middleware({
      name: 'MarkdownCleaner',
      direction: 'output',
      process: (output) => {
        return output
          .replace(/```[\s\S]*?```/g, (m) => '```\n[code block]\n```')
          .replace(/\$[\s\S]*?\$/g, (m) => '[math]');
      },
    });
  },

  /**
   * 响应压缩
   */
  createResponseTrimmer(maxLength = 4000) {
    return new Middleware({
      name: 'ResponseTrimmer',
      direction: 'output',
      process: (output) => {
        if (output.length > maxLength) {
          return output.substring(0, maxLength) + `\n...[truncated, ${output.length - maxLength} chars hidden]`;
        }
        return output;
      },
    });
  },
};

module.exports = {
  GuardrailResult,
  Guardrail,
  Guardrails,
  GuardrailChain,
  GuardrailManager,
  Middleware,
  MiddlewareChain,
  Middlewares,
};
