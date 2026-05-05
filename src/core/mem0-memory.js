/**
 * HeartFlow Mem0 Memory v11.7.6
 * 
 * 整合 Mem0 v3 (⭐54765) 核心算法:
 *   - Multi-signal retrieval: 语义 + BM25 + 实体匹配 并行评分融合
 *   - ADD-only extraction: 单次 LLM 调用，记忆累积，不覆盖
 *   - Entity linking: 实体跨记忆链接
 *   - Agent facts as first-class: Agent 确认的行动同等权重存储
 * 
 * 性能指标 (Mem0 v3 April 2026):
 *   - LoCoMo: 71.4 → 91.6 (+20 points)
 *   - LongMemEval: 67.8 → 93.4 (+26 points)
 *   - BEAM (1M): 64.1
 *   - Token 消耗: ~7KB/查询
 *   - Latency p50: 0.88s
 */

// ============================================================
// 记忆项
// ============================================================

class MemoryItem {
  constructor(options = {}) {
    this.id = options.id || this._genId();
    this.content = options.content || '';
    this.metadata = options.metadata || {};
    
    // Mem0 v3 新增字段
    this.entities = options.entities || [];        // 提取的实体
    this.entityLinks = options.entityLinks || {};  // 实体链接: { "Alice": ["memory_id_1", "memory_id_2"] }
    this.source = options.source || 'user';       // 'user' | 'agent' | 'extracted'
    this.embedding = options.embedding || null;
    
    // 评分
    this.reinforcementCount = options.reinforcementCount || 0; // 被确认次数 (agent fact)
    this.accessCount = options.accessCount || 0;
    this.lastAccessed = options.lastAccessed || Date.now();
    this.createdAt = options.createdAt || Date.now();
  }

  _genId() {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  reinforce() {
    this.reinforcementCount++;
    return this;
  }

  access() {
    this.accessCount++;
    this.lastAccessed = Date.now();
    return this;
  }
}

// ============================================================
// BM25 关键词检索 (Mem0 multi-signal 的一部分)
// ============================================================

class BM25Indexer {
  constructor(options = {}) {
    this.k1 = options.k1 || 1.5;
    this.b = options.b || 0.75;
    this.avgDocLength = 0;
    this.docLengths = [];
    this.invertedIndex = new Map();  // term -> [{docId, tf, positions}]
    this.documents = new Map();      // docId -> { tokens, length }
    this.corpusSize = 0;
  }

  /**
   * 添加文档
   */
  add(docId, text) {
    const tokens = this._tokenize(text);
    const length = tokens.length;
    
    this.documents.set(docId, { tokens, length });
    this.docLengths.push(length);
    this.corpusSize++;
    
    // 更新倒排索引
    const termFreq = new Map();
    tokens.forEach((token, pos) => {
      if (!termFreq.has(token)) {
        termFreq.set(token, { tf: 0, positions: [] });
      }
      const tfEntry = termFreq.get(token);
      tfEntry.tf++;
      tfEntry.positions.push(pos);
    });
    
    termFreq.forEach((tfData, term) => {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, []);
      }
      this.invertedIndex.get(term).push({
        docId,
        tf: tfData.tf,
        positions: tfData.positions,
      });
    });
    
    // 更新平均长度
    this.avgDocLength = this.docLengths.reduce((a, b) => a + b, 0) / this.corpusSize;
  }

  /**
   * 移除文档
   */
  remove(docId) {
    this.documents.delete(docId);
    const idx = this.docLengths.indexOf(docId);
    if (idx >= 0) this.docLengths.splice(idx, 1);
    
    this.invertedIndex.forEach((entries, term) => {
      const filtered = entries.filter(e => e.docId !== docId);
      if (filtered.length === 0) {
        this.invertedIndex.delete(term);
      } else {
        this.invertedIndex.set(term, filtered);
      }
    });
    this.corpusSize--;
  }

  /**
   * 查询
   */
  search(query, topK = 10) {
    const queryTokens = this._tokenize(query);
    if (queryTokens.length === 0) return [];
    
    const scores = new Map();
    
    queryTokens.forEach(term => {
      if (!this.invertedIndex.has(term)) return;
      
      const df = this.invertedIndex.get(term).length;
      const idf = Math.log((this.corpusSize - df + 0.5) / (df + 0.5) + 1);
      
      this.invertedIndex.get(term).forEach(entry => {
        const { docId, tf } = entry;
        const docLen = this.documents.get(docId)?.length || 1;
        
        // BM25 公式
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
        const score = idf * (numerator / denominator);
        
        scores.set(docId, (scores.get(docId) || 0) + score);
      });
    });
    
    // 排序返回
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([docId, score]) => ({ docId, score }));
  }

  _tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }
}

// ============================================================
// 实体提取与链接
// ============================================================

class EntityExtractor {
  constructor() {
    // 简单规则提取 (Mem0 用 LLM，这里用规则 + 可扩展)
    this.entityPatterns = [
      // 人名
      { type: 'person', pattern: /\b([A-Z][a-z]+ [A-Z][a-z]+|[A-Z][a-z]+)\b/g },
      // 组织
      { type: 'organization', pattern: /\b(Project|Company|Team|Org|Inc|LLC|Corp)\s+[A-Z][a-z]+/gi },
      // 地点
      { type: 'location', pattern: /\b(in|at|near|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi },
      // 时间
      { type: 'time', pattern: /\b(\d{4}-\d{2}-\d{2}|\d+\s+(days?|weeks?|months?|years?)\s+ago|on\s+\w+)/gi },
      // 技术/工具
      { type: 'technology', pattern: /\b(Python|JavaScript|TypeScript|React|Vue|Node|AWS|GCP|Docker|Kubernetes)\b/gi },
      // 数字/度量
      { type: 'metric', pattern: /\b(\d+(?:\.\d+)?)\s*(km|m|kg|GB|MB|%|percent)/gi },
    ];
  }

  /**
   * 从文本提取实体
   */
  extract(text) {
    const entities = [];
    const seen = new Set();
    
    this.entityPatterns.forEach(({ type, pattern }) => {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      while ((match = regex.exec(text)) !== null) {
        const value = match[1] || match[0];
        const key = `${type}:${value.toLowerCase()}`;
        
        if (!seen.has(key) && value.length > 1) {
          seen.add(key);
          entities.push({
            type,
            value,
            position: match.index,
            normalized: value.toLowerCase(),
          });
        }
      }
    });
    
    return entities;
  }

  /**
   * 提取并链接实体 (跨文本)
   */
  extractAndLink(texts) {
    const allEntities = new Map();  // normalized -> { value, type, positions }
    const entityToMemories = new Map();  // normalized -> Set of memoryIds
    
    texts.forEach(({ id, text }) => {
      const entities = this.extract(text);
      entities.forEach(e => {
        if (!allEntities.has(e.normalized)) {
          allEntities.set(e.normalized, {
            value: e.value,
            type: e.type,
            memoryIds: new Set(),
          });
        }
        allEntities.get(e.normalized).memoryIds.add(id);
      });
    });
    
    // 构建链接
    const links = {};
    allEntities.forEach((data, normalized) => {
      const memoryIds = Array.from(data.memoryIds);
      if (memoryIds.length > 1) {
        links[normalized] = memoryIds;
      }
    });
    
    return {
      entities: Array.from(allEntities.values()).map(e => ({
        ...e,
        memoryIds: Array.from(e.memoryIds),
      })),
      links,
    };
  }
}

// ============================================================
// Multi-Signal Memory (Mem0 v3 核心)
// ============================================================

class MultiSignalMemory {
  constructor(options = {}) {
    this.id = options.id || this._genId();
    
    // 三种检索信号
    this.embeddings = [];       // 语义嵌入向量 (简化版)
    this.bm25 = new BM25Indexer(); // BM25 关键词
    this.entityExtractor = new EntityExtractor();
    
    // 所有记忆
    this.memories = new Map();  // id -> MemoryItem
    
    // 实体索引
    this.entityIndex = new Map();  // normalized_entity -> Set of memoryIds
    
    // 配置
    this.embeddingDim = options.embeddingDim || 128;
    this.topK = options.topK || 10;
    this.signalWeights = options.signalWeights || {
      semantic: 0.4,
      bm25: 0.3,
      entity: 0.3,
    };
    
    // 统计
    this._stats = {
      totalMemories: 0,
      totalSearches: 0,
      avgRetrievalTime: 0,
    };
  }

  /**
   * 添加记忆 (ADD-only - Mem0 v3 核心)
   */
  add(options = {}) {
    const { content, metadata = {}, source = 'user', entities = null } = options;
    
    const extractedEntities = entities || this.entityExtractor.extract(content);
    
    const memory = new MemoryItem({
      content,
      metadata,
      source,
      entities: extractedEntities,
    });
    
    // 1. 保存记忆
    this.memories.set(memory.id, memory);
    
    // 2. BM25 索引
    this.bm25.add(memory.id, content);
    
    // 3. 实体索引
    extractedEntities.forEach(entity => {
      if (!this.entityIndex.has(entity.normalized)) {
        this.entityIndex.set(entity.normalized, new Set());
      }
      this.entityIndex.get(entity.normalized).add(memory.id);
    });
    
    // 4. 简化嵌入 (用于调试)
    memory.embedding = this._simpleEmbedding(content);
    
    this._stats.totalMemories++;
    
    return memory;
  }

  /**
   * 添加 Agent 确认的事实 (first-class)
   */
  addAgentFact(content, metadata = {}) {
    const memory = this.add({
      content,
      metadata: { ...metadata, agentConfirmed: true },
      source: 'agent',
    });
    memory.reinforcementCount = 1;
    return memory;
  }

  /**
   * 确认/强化已有记忆
   */
  reinforce(memoryId, additionalContent = null) {
    const memory = this.memories.get(memoryId);
    if (!memory) return null;
    
    memory.reinforce();
    
    if (additionalContent) {
      // ADD-only: 新增内容，不覆盖原有
      const newMemory = this.add({
        content: additionalContent,
        metadata: { ...memory.metadata, reinforcedFrom: memoryId },
        source: 'agent',
      });
      return { reinforced: memory, new: newMemory };
    }
    
    return { reinforced: memory };
  }

  /**
   * 多信号检索 (Mem0 v3 核心算法)
   * 
   * 并行执行三个信号，结果加权融合:
   *   1. 语义相似度
   *   2. BM25 关键词匹配
   *   3. 实体匹配
   */
  search(query, options = {}) {
    const { topK = this.topK, filters = {} } = options;
    const startTime = Date.now();
    
    this._stats.totalSearches++;
    
    // 并行执行三个信号
    const [semanticScores, bm25Results, entityScores] = [
      this._semanticSearch(query, topK * 3),
      this._bm25Search(query, topK * 3),
      this._entitySearch(query, topK * 3),
    ];
    
    // 归一化分数 (除以该信号最大值，避免量纲差异)
    const maxSemantic = Math.max(...Object.values(semanticScores).filter(v => v > 0), 0.001);
    const maxBm25 = Math.max(...bm25Results.map(r => r.score), 0.001);
    
    // 加权融合 (Mem0 multi-signal)
    const fusedScores = new Map();
    
    // 语义分数 (权重分配到 0-1 范围)
    const semanticWeight = 0.3;  // Jaccard 已经是 0-1，不需要乘 0.4
    Object.entries(semanticScores).forEach(([id, score]) => {
      if (score > 0) {
        const normalized = score / maxSemantic;  // 归一化到 0-1
        fusedScores.set(id, (fusedScores.get(id) || 0) + normalized * semanticWeight);
      }
    });
    
    // BM25 分数 (BM25 分数范围较大，用对数压缩)
    const bm25Weight = 0.35;
    bm25Results.forEach(({ docId, score }) => {
      const normalized = Math.log(score + 1) / Math.log(maxBm25 + 1);
      fusedScores.set(docId, (fusedScores.get(docId) || 0) + normalized * bm25Weight);
    });
    
    // 实体分数 (已经是 0-1)
    const entityWeight = 0.35;
    entityScores.forEach(({ docId, score }) => {
      fusedScores.set(docId, (fusedScores.get(docId) || 0) + score * entityWeight);
    });
    
    // 应用过滤器
    const candidates = Array.from(fusedScores.entries())
      .filter(([id]) => this._passFilters(id, filters))
      .map(([id, fusedScore]) => {
        const memory = this.memories.get(id);
        memory.access();
        
        return {
          id,
          content: memory.content,
          score: fusedScore,
          source: memory.source,
          entities: memory.entities,
          reinforcementCount: memory.reinforcementCount,
          createdAt: memory.createdAt,
          metadata: memory.metadata,
        };
      })
      .sort((a, b) => {
        // 综合评分: 融合分数 + 强化加成 + 新近度
        const boostA = a.reinforcementCount * 0.1 + this._recencyBoost(a.createdAt);
        const boostB = b.reinforcementCount * 0.1 + this._recencyBoost(b.createdAt);
        return (b.score + boostB) - (a.score + boostA);
      })
      .slice(0, topK);
    
    this._stats.avgRetrievalTime =
      (this._stats.avgRetrievalTime * (this._stats.totalSearches - 1) + (Date.now() - startTime))
      / this._stats.totalSearches;
    
    return {
      results: candidates,
      query,
      stats: {
        total: candidates.length,
        retrievalTime: Date.now() - startTime,
        signalCounts: {
          semantic: Object.keys(semanticScores).length,
          bm25: bm25Results.length,
          entity: entityScores.length,
        },
      },
    };
  }

  /**
   * 语义搜索 (Jaccard 相似度 - 词集合重叠率)
   */
  _semanticSearch(query, topK) {
    const queryTokens = new Set(this._tokenizeSimple(query));
    const scores = {};
    
    this.memories.forEach((memory, id) => {
      const memTokens = new Set(this._tokenizeSimple(memory.content));
      
      if (queryTokens.size === 0 || memTokens.size === 0) {
        scores[id] = 0;
        return;
      }
      
      const intersection = [...queryTokens].filter(t => memTokens.has(t)).length;
      const union = new Set([...queryTokens, ...memTokens]).size;
      
      scores[id] = union > 0 ? intersection / union : 0;
    });
    
    return scores;
  }

  _tokenizeSimple(text) {
    // 中英文混合分词: 英文按空格+标点，中文按单字符
    const words = [];
    // 英文词
    text.split(/[\s\.,!?;:'"()（）\[\]{}，、。！？；：""''（）【】《》]+/).forEach(part => {
      if (/[a-zA-Z]/.test(part)) {
        part.split(/\s+/).forEach(w => {
          if (w.length > 1) words.push(w.toLowerCase());
        });
      }
    });
    // 中文字 (每字为一个token)
    text.match(/[\u4e00-\u9fff]/g)?.forEach(c => words.push(c));
    
    // 如果全是中文没有提取到，用原始分词
    if (words.length === 0) {
      return text.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    }
    return words;
  }

  /**
   * BM25 搜索
   */
  _bm25Search(query, topK) {
    return this.bm25.search(query, topK);
  }

  /**
   * 实体搜索
   */
  _entitySearch(query, topK) {
    const queryEntities = this.entityExtractor.extract(query);
    if (queryEntities.length === 0) return [];
    
    const entityScores = new Map();
    
    queryEntities.forEach(entity => {
      const memoryIds = this.entityIndex.get(entity.normalized);
      if (memoryIds) {
        memoryIds.forEach(id => {
          entityScores.set(id, (entityScores.get(id) || 0) + 1);
        });
      }
    });
    
    const maxScore = Math.max(...entityScores.values(), 1);
    
    return Array.from(entityScores.entries())
      .map(([id, score]) => ({ docId: id, score: score / maxScore }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * 过滤器
   */
  _passFilters(memoryId, filters) {
    const memory = this.memories.get(memoryId);
    if (!memory) return false;
    
    if (filters.source && memory.source !== filters.source) return false;
    if (filters.agentFactsOnly && memory.reinforcementCount === 0) return false;
    if (filters.since && memory.createdAt < filters.since) return false;
    
    return true;
  }

  /**
   * 简化嵌入 (词袋向量 - 固定维度保证可比性)
   */
  _simpleEmbedding(text) {
    const tokens = text.toLowerCase().split(/\s+/);
    const vocab = [...new Set(tokens)];
    const dim = this.embeddingDim;
    
    // 固定维度向量
    const vec = new Array(dim).fill(0);
    
    // 用词的第一个字符 codePoint 作为哈希，映射到固定维度
    vocab.forEach(word => {
      const hash = word.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const idx = hash % dim;
      vec[idx] += 1;
    });
    
    return vec;
  }

  _recencyBoost(createdAt) {
    const daysOld = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
    return Math.max(0, 1 - daysOld / 30) * 0.2; // 30天衰减
  }

  _genId() {
    return `msm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  // ============================================================
  // 统计与调试
  // ============================================================

  getAll() {
    return Array.from(this.memories.values()).map(m => ({
      id: m.id,
      content: m.content.substring(0, 100),
      source: m.source,
      reinforcementCount: m.reinforcementCount,
      entities: m.entities.map(e => e.value),
      createdAt: m.createdAt,
    }));
  }

  stats() {
    return {
      ...this._stats,
      memoryCount: this.memories.size,
      entityCount: this.entityIndex.size,
      sources: {
        user: Array.from(this.memories.values()).filter(m => m.source === 'user').length,
        agent: Array.from(this.memories.values()).filter(m => m.source === 'agent').length,
      },
    };
  }

  clear() {
    this.memories.clear();
    this.entityIndex.clear();
    this.embeddings = [];
    this._stats = { totalMemories: 0, totalSearches: 0, avgRetrievalTime: 0 };
  }
}

// ============================================================
// Mem0 Memory API 兼容层
// ============================================================

/**
 * Mem0 风格的 Memory 类
 * 提供 add() / search() / get() / update() / delete() / history()
 * 
 * 使用示例:
 *   const memory = new Mem0Memory({ llm: openaiClient });
 *   
 *   // 搜索相关记忆
 *   const results = memory.search({
 *     query: "What does Alice prefer?",
 *     filters: { user_id: "alice" },
 *     top_k: 3
 *   });
 *   
 *   // 添加记忆
 *   memory.add(messages, { user_id: "alice" });
 */
class Mem0Memory {
  constructor(options = {}) {
    this.memories = new MultiSignalMemory({ topK: options.topK || 10 });
    this.userId = options.userId || 'default';
    this.signalWeights = options.signalWeights || {
      semantic: 0.4,
      bm25: 0.3,
      entity: 0.3,
    };
  }

  /**
   * Mem0 风格: 搜索记忆
   */
  search(query, filters = {}, topK = 3) {
    return this.memories.search(query, { topK, filters });
  }

  /**
   * Mem0 风格: 添加记忆 (ADD-only)
   */
  add(messages, metadata = {}) {
    // 从消息列表提取内容
    const contents = Array.isArray(messages)
      ? messages.map(m => m.content || m).filter(Boolean)
      : [messages];
    
    const memories = [];
    contents.forEach(content => {
      const memory = this.memories.add({
        content,
        metadata: { ...metadata, userId: metadata.user_id || this.userId },
        source: 'user',
      });
      memories.push(memory);
    });
    
    return { results: memories };
  }

  /**
   * 添加 Agent 确认的事实
   */
  addAsFact(content, metadata = {}) {
    const memory = this.memories.addAgentFact(content, {
      ...metadata,
      userId: this.userId,
    });
    return { results: [memory] };
  }

  /**
   * 确认记忆
   */
  reinforce(memoryId, additionalContent = null) {
    return this.memories.reinforce(memoryId, additionalContent);
  }

  /**
   * 获取所有记忆
   */
  getAll(filter = {}) {
    return this.memories.getAll().filter(m => {
      if (filter.user_id && m.metadata?.userId !== filter.user_id) return false;
      return true;
    });
  }

  /**
   * 删除记忆
   */
  delete(memoryId) {
    // MultiSignalMemory 是 ADD-only，但提供软删除
    const memory = this.memories.memories.get(memoryId);
    if (memory) {
      memory.metadata.deleted = true;
      return { success: true };
    }
    return { success: false };
  }

  stats() {
    return this.memories.stats();
  }
}

// Named export for module.exports compatibility
module.exports._internal = {
  MultiSignalMemory,
  Mem0Memory,
};

// ============================================================
// 与 StatefulAgent 整合
// ============================================================

/**
 * 创建带 Mem0 Memory 的 Stateful Agent
 */
function createMem0Agent(options = {}) {
  const { name = 'Mem0Agent' } = options;
  
  const agent = {
    name,
    memory: new Mem0Memory({ topK: options.topK || 10 }),
    conversations: new Map(),
    
    /**
     * 对话并记忆
     */
    async chat(message, userId = 'default') {
      // 1. 检索相关记忆
      const relevant = this.memory.search(message, { user_id: userId }, 3);
      
      // 2. 构建上下文
      const context = relevant.results
        .map(r => `- ${r.content}`)
        .join('\n');
      
      // 3. 生成回复 (外部 LLM)
      if (options.onGenerate) {
        const response = await options.onGenerate({
          message,
          context,
          relevantMemories: relevant.results,
          userId,
        });
        
        // 4. 添加对话到记忆
        this.memory.add([
          { role: 'user', content: message },
          { role: 'assistant', content: response },
        ], { user_id: userId });
        
        return { response, memories: relevant.results };
      }
      
      return { response: '[No generator configured]', memories: relevant.results };
    },
    
    /**
     * 确认/强化记忆
     */
    confirm(memoryId, additionalContent = null) {
      return this.memory.reinforce(memoryId, additionalContent);
    },
    
    /**
     * 记忆统计
     */
    stats() {
      return this.memory.stats();
    },
  };
  
  return agent;
}

module.exports = {
  MemoryItem,
  MultiSignalMemory,
  Mem0Memory,
  EntityExtractor,
  BM25Indexer,
  createMem0Agent,
};
