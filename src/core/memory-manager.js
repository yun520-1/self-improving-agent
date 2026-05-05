/**
 * HeartFlow Memory Manager v11.7.2
 * 
 * 整合:
 *   - lang-memgpt (LangChain) ⭐156 - Core + Recall 双层记忆
 *   - Self-Instruct (yizhongw) ⭐4594 - 自生成指令 + 过滤验证
 *   - Generative Agents - 记忆优先级 + 重要性评分
 * 
 * 核心架构:
 *   1. Core Memory (核心记忆) - 始终可用的关键信息
 *   2. Recall Memory (召回记忆) - 基于语义相似度检索
 *   3. Working Memory (工作记忆) - 当前上下文中活跃的记忆
 *   4. Archive Memory (归档记忆) - 低频但可追溯的历史
 * 
 * Self-Instruct 逻辑:
 *   Bootstrap → Generate → Filter → Validate → Integrate
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '../../data/memory-manager');
const CORE_FILE = path.join(MEMORY_DIR, 'core-memories.json');
const RECALL_FILE = path.join(MEMORY_DIR, 'recall-memories.json');
const WORKING_FILE = path.join(MEMORY_DIR, 'working-memories.json');
const ARCHIVE_FILE = path.join(MEMORY_DIR, 'archive-memories.json');

class MemoryManager {
  constructor(options = {}) {
    this.maxCoreMemories = options.maxCoreMemories || 20;
    this.maxRecallMemories = options.maxRecallMemories || 100;
    this.maxWorkingMemories = options.maxWorkingMemories || 10;
    this.recallTopK = options.recallTopK || 5;
    this.importanceThreshold = options.importanceThreshold || 0.5;
    this.decayRate = options.decayRate || 0.95;
    
    // 四层记忆
    this.coreMemories = [];    // 核心记忆：身份、目标、核心价值观
    this.recallMemories = [];  // 召回记忆：基于相似度检索
    this.workingMemories = []; // 工作记忆：当前活跃
    this.archiveMemories = [];  // 归档记忆：历史回顾
    
    // Self-Instruct 状态
    this.bootstrapInstructions = [];  // 种子指令
    this.generatedInstructions = []; // 生成的指令
    this.instructionStats = {
      total: 0,
      valid: 0,
      filtered: 0,
    };
    
    this._loadMemory();
  }

  // ============================================================
  // 记忆操作: Core Memory (lang-memgpt 架构)
  // ============================================================

  /**
   * 保存核心记忆 (lang-memgpt: save_core_memory)
   * 核心记忆 = 始终可用的关键信息
   */
  saveCoreMemory(content, metadata = {}) {
    const memory = {
      id: this._generateId(),
      content: this._truncate(content, 500),
      importance: metadata.importance || this._calculateImportance(content),
      accessCount: 0,
      lastAccess: Date.now(),
      createdAt: Date.now(),
      tags: metadata.tags || [],
      source: metadata.source || 'user',
    };
    
    // 重要性排序
    this.coreMemories.push(memory);
    this.coreMemories.sort((a, b) => b.importance - a.importance);
    
    // 限制数量
    if (this.coreMemories.length > this.maxCoreMemories) {
      const toArchive = this.coreMemories.splice(this.maxCoreMemories);
      this._archiveMemories(toArchive);
    }
    
    this._saveMemory();
    return memory;
  }

  /**
   * 获取所有核心记忆
   */
  getCoreMemories() {
    // 更新访问时间
    this.coreMemories.forEach(m => {
      m.lastAccess = Date.now();
      m.accessCount++;
    });
    return this.coreMemories;
  }

  // ============================================================
  // 记忆操作: Recall Memory (语义检索)
  // ============================================================

  /**
   * 保存召回记忆 (lang-memgpt: save_recall_memory)
   * 使用语义相似度存储，支持向量检索
   */
  saveRecallMemory(content, metadata = {}) {
    const memory = {
      id: this._generateId(),
      content: this._truncate(content, 300),
      embedding: this._simpleEmbedding(content), // 简化的嵌入
      importance: metadata.importance || 0.5,
      accessCount: 0,
      lastAccess: Date.now(),
      createdAt: Date.now(),
      tags: metadata.tags || [],
      source: metadata.source || 'session',
      eventId: metadata.eventId || null,
    };
    
    this.recallMemories.push(memory);
    
    // 限制数量
    if (this.recallMemories.length > this.maxRecallMemories) {
      // 删除最不重要的记忆
      this.recallMemories.sort((a, b) => b.importance - a.importance);
      this.recallMemories = this.recallMemories.slice(0, this.maxRecallMemories);
    }
    
    this._saveMemory();
    return memory;
  }

  /**
   * 语义检索记忆 (lang-memgpt: search_memory)
   * 基于向量相似度搜索
   */
  searchRecallMemories(query, topK = null) {
    const queryEmbedding = this._simpleEmbedding(query);
    const k = topK || this.recallTopK;
    
    // 计算相似度
    const scored = this.recallMemories.map(memory => {
      const similarity = this._cosineSimilarity(queryEmbedding, memory.embedding);
      return {
        ...memory,
        similarity,
        score: similarity * memory.importance,
      };
    });
    
    // 排序并返回 Top K
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, k);
    
    // 更新访问
    results.forEach(r => {
      r.lastAccess = Date.now();
      r.accessCount++;
    });
    
    return results;
  }

  /**
   * 上下文感知的记忆召回 (lang-memgpt 架构)
   * 结合当前上下文和语义相似度
   */
  recallForContext(query, context = {}, topK = null) {
    const {
      type,      // 任务类型
      tags,      // 相关标签
      timeRange, // 时间范围
    } = context;
    
    // 1. 语义搜索
    const semanticResults = this.searchRecallMemories(query, topK || this.recallTopK);
    
    // 2. 标签过滤
    let filtered = semanticResults;
    if (tags && tags.length > 0) {
      filtered = filtered.filter(m => 
        m.tags.some(t => tags.includes(t))
      );
    }
    
    // 3. 时间衰减
    filtered = filtered.map(m => ({
      ...m,
      timeDecay: this._timeDecay(m.lastAccess),
      finalScore: m.score * this._timeDecay(m.lastAccess),
    }));
    filtered.sort((a, b) => b.finalScore - a.finalScore);
    
    // 4. 结合 Core Memory
    const relevantCore = this.coreMemories
      .filter(c => this._isRelated(query, c.content))
      .slice(0, 3);
    
    return {
      recall: filtered.slice(0, topK || this.recallTopK),
      core: relevantCore,
      query,
      context,
    };
  }

  // ============================================================
  // 工作记忆: Working Memory
  // ============================================================

  /**
   * 添加到工作记忆
   */
  addToWorkingMemory(content, metadata = {}) {
    const memory = {
      id: this._generateId(),
      content,
      priority: metadata.priority || 0.5,
      expiresAt: metadata.expiresAt || (Date.now() + 30 * 60 * 1000), // 30分钟过期
      createdAt: Date.now(),
    };
    
    this.workingMemories.push(memory);
    
    // 限制
    if (this.workingMemories.length > this.maxWorkingMemories) {
      this.workingMemories.shift();
    }
    
    return memory;
  }

  /**
   * 获取工作记忆 (自动过期)
   */
  getWorkingMemories() {
    const now = Date.now();
    this.workingMemories = this.workingMemories.filter(m => m.expiresAt > now);
    return this.workingMemories;
  }

  /**
   * 消费工作记忆 (取出后删除)
   */
  consumeWorkingMemory(id) {
    const idx = this.workingMemories.findIndex(m => m.id === id);
    if (idx >= 0) {
      return this.workingMemories.splice(idx, 1)[0];
    }
    return null;
  }

  // ============================================================
  // Self-Instruct: 自生成记忆指令
  // ============================================================

  /**
   * 初始化种子指令 (Self-Instruct: bootstrap_instructions)
   */
  initBootstrapInstructions(seedTasks = []) {
    // 默认种子任务类型
    const defaultSeeds = [
      { instruction: '总结今天对话的核心内容', type: 'summary' },
      { instruction: '分析用户的表达模式', type: 'analysis' },
      { instruction: '提取关键决策点', type: 'extraction' },
      { instruction: '识别用户的情绪变化', type: 'emotion' },
      { instruction: '归纳问题类型', type: 'categorization' },
      { instruction: '生成下一步建议', type: 'suggestion' },
    ];
    
    const seeds = seedTasks.length > 0 ? seedTasks : defaultSeeds;
    
    this.bootstrapInstructions = seeds.map((seed, idx) => ({
      id: `seed_${idx}`,
      instruction: seed.instruction,
      type: seed.type || 'general',
      usageCount: 0,
      successCount: 0,
    }));
    
    this._saveMemory();
    return this.bootstrapInstructions;
  }

  /**
   * 生成新指令 (Self-Instruct: generate_instructions)
   * 基于现有指令生成新的变体
   */
  generateNewInstructions(count = 5, category = null) {
    if (this.bootstrapInstructions.length === 0) {
      this.initBootstrapInstructions();
    }
    
    // 采样种子指令
    const seeds = this._sampleInstructions(category, 3);
    
    // 生成新指令的模板 (在实际使用中，这里会调用 LLM)
    const generated = [];
    
    for (let i = 0; i < count; i++) {
      const seed = seeds[i % seeds.length];
      const newInstruction = this._mutateInstruction(seed);
      
      // Self-Instruct 过滤器
      if (this._filterInstruction(newInstruction)) {
        generated.push({
          id: this._generateId(),
          instruction: newInstruction,
          parentId: seed.id,
          parentType: seed.type,
          quality: seed.successCount / Math.max(1, seed.usageCount),
          generatedAt: Date.now(),
        });
      }
    }
    
    this.generatedInstructions.push(...generated);
    this.instructionStats.total += generated.length;
    
    return generated;
  }

  /**
   * 验证指令有效性 (Self-Instruct: post_process)
   */
  validateInstruction(instruction, result) {
    const idx = this.generatedInstructions.findIndex(
      g => g.instruction === instruction
    );
    
    if (idx >= 0) {
      const gen = this.generatedInstructions[idx];
      gen.usageCount++;
      
      if (result.success) {
        gen.quality = Math.min(1, gen.quality + 0.1);
        this.instructionStats.valid++;
        
        // 高质量指令 → 转为正式记忆
        if (gen.quality >= 0.8) {
          this.saveRecallMemory(instruction, {
            source: 'self-instruct',
            importance: gen.quality,
            tags: ['generated', gen.parentType],
          });
        }
      } else {
        gen.quality = Math.max(0, gen.quality - 0.2);
        this.instructionStats.filtered++;
      }
      
      // 更新种子统计
      if (gen.parentId) {
        const seed = this.bootstrapInstructions.find(s => s.id === gen.parentId);
        if (seed) {
          seed.usageCount++;
          if (result.success) seed.successCount++;
        }
      }
      
      this._saveMemory();
    }
  }

  // ============================================================
  // 重要性评估 (Generative Agents 架构)
  // ============================================================

  /**
   * 计算记忆重要性 (Generative Agents: importance score)
   */
  _calculateImportance(content) {
    let score = 0.5;
    
    // 关键词加权
    const importantKeywords = [
      '目标', '决定', '选择', '重要', '核心',
      'goal', 'decide', 'important', 'core',
    ];
    
    for (const kw of importantKeywords) {
      if (content.includes(kw)) score += 0.1;
    }
    
    // 长度加权
    if (content.length > 100) score += 0.1;
    if (content.length > 300) score += 0.1;
    
    return Math.min(1, score);
  }

  /**
   * 时间衰减
   */
  _timeDecay(timestamp) {
    const age = Date.now() - timestamp;
    const hours = age / (1000 * 60 * 60);
    return Math.pow(this.decayRate, hours);
  }

  /**
   * 判断内容是否相关
   */
  _isRelated(query, content) {
    const queryWords = new Set(query.toLowerCase().split(/\s+/));
    const contentWords = new Set(content.toLowerCase().split(/\s+/));
    const intersection = [...queryWords].filter(w => contentWords.has(w));
    return intersection.length > 0;
  }

  // ============================================================
  // 向量嵌入 (简化版)
  // ============================================================

  /**
   * 简单嵌入: 基于词频的向量
   */
  _simpleEmbedding(text) {
    const words = text.toLowerCase().split(/\s+/);
    const vocab = [...new Set(words)];
    const vector = new Array(Math.min(vocab.length, 50)).fill(0);
    
    vocab.slice(0, 50).forEach((word, i) => {
      vector[i] = words.filter(w => w === word).length / words.length;
    });
    
    return vector;
  }

  /**
   * 余弦相似度
   */
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  // ============================================================
  // Self-Instruct 辅助
  // ============================================================

  _sampleInstructions(category, n) {
    let pool = this.bootstrapInstructions;
    
    if (category) {
      pool = pool.filter(i => i.type === category);
    }
    
    // 加权采样: 质量高的指令更容易被选中
    const weighted = pool.map(i => ({
      ...i,
      weight: i.quality || 0.5,
    }));
    
    weighted.sort((a, b) => b.weight - a.weight);
    return weighted.slice(0, n);
  }

  _mutateInstruction(seed) {
    // 简化版: 基于种子生成变体
    const mutations = [
      `分析: ${seed.instruction}`,
      `总结并建议: ${seed.instruction}`,
      seed.instruction.replace('用户', '对方'),
      `基于最近对话: ${seed.instruction}`,
    ];
    
    return mutations[Math.floor(Math.random() * mutations.length)];
  }

  _filterInstruction(instruction) {
    const words = instruction.split(/\s+/);
    
    // 过滤太短
    if (words.length < 3) return false;
    
    // 过滤太长
    if (words.length > 50) return false;
    
    // 过滤重复
    if (instruction.includes('同样的') || instruction.includes('重复')) {
      if (this.generatedInstructions.some(g => g.instruction === instruction)) {
        return false;
      }
    }
    
    return true;
  }

  // ============================================================
  // 归档
  // ============================================================

  _archiveMemories(memories) {
    this.archiveMemories.push(...memories.map(m => ({
      ...m,
      archivedAt: Date.now(),
    })));
    
    // 限制归档数量
    if (this.archiveMemories.length > 500) {
      this.archiveMemories = this.archiveMemories.slice(-500);
    }
  }

  // ============================================================
  // 持久化
  // ============================================================

  _loadMemory() {
    try {
      if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
        return;
      }

      const files = {
        core: CORE_FILE,
        recall: RECALL_FILE,
        working: WORKING_FILE,
        archive: ARCHIVE_FILE,
      };

      for (const [key, filepath] of Object.entries(files)) {
        if (fs.existsSync(filepath)) {
          const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
          switch (key) {
            case 'core':
              this.coreMemories = data.memories || [];
              break;
            case 'recall':
              this.recallMemories = data.memories || [];
              break;
            case 'working':
              this.workingMemories = data.memories || [];
              break;
            case 'archive':
              this.archiveMemories = data.memories || [];
              break;
          }
        }
      }
    } catch (e) {
      console.log('[MemoryManager] Load failed:', e.message);
    }
  }

  _saveMemory() {
    try {
      if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
      }

      const files = {
        core: { memories: this.coreMemories },
        recall: { memories: this.recallMemories },
        working: { memories: this.workingMemories },
        archive: { memories: this.archiveMemories },
      };

      for (const [key, data] of Object.entries(files)) {
        const filepath = path.join(MEMORY_DIR, `${key}-memories.json`);
        fs.writeFileSync(filepath, JSON.stringify({
          ...data,
          updated: Date.now(),
        }, null, 2));
      }
    } catch (e) {
      console.log('[MemoryManager] Save failed:', e.message);
    }
  }

  // ============================================================
  // 统计
  // ============================================================

  stats() {
    return {
      version: '11.7.2',
      coreMemories: this.coreMemories.length,
      recallMemories: this.recallMemories.length,
      workingMemories: this.workingMemories.length,
      archiveMemories: this.archiveMemories.length,
      bootstrapInstructions: this.bootstrapInstructions.length,
      generatedInstructions: this.generatedInstructions.length,
      instructionStats: this.instructionStats,
    };
  }

  reset() {
    this.coreMemories = [];
    this.recallMemories = [];
    this.workingMemories = [];
    this.archiveMemories = [];
    this.generatedInstructions = [];
    this._saveMemory();
  }
}

module.exports = MemoryManager;
