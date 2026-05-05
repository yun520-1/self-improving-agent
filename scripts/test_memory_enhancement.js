#!/usr/bin/env node
/**
 * HeartFlow Memory Enhancement Test v11.15.1
 * Tests: ImportanceScorer + AssociativeGraph + MemoryConsolidator
 */

const {
  ImportanceScorer,
  AssociativeGraph,
  MemoryConsolidator,
  Mem0Memory,
  MemoryItem,
} = require('../src/core/mem0-memory.js');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

function assertTrue(value, msg) {
  if (!value) throw new Error(`${msg}: expected truthy, got ${value}`);
}

console.log('\n=== ImportanceScorer ===');
{
  const scorer = new ImportanceScorer({ halflifeDays: 7 });

  test('新记忆基础分 > 0', () => {
    const mem = { createdAt: Date.now(), reinforcementCount: 0, accessCount: 0, metadata: {}, source: 'user' };
    const s = scorer.score(mem);
    assertTrue(s > 0 && s <= 1, `score=${s}`);
  });

  test('强化次数多的分数更高', () => {
    const now = Date.now();
    const low = scorer.score({ createdAt: now, reinforcementCount: 0, accessCount: 0, metadata: {}, source: 'user' });
    const high = scorer.score({ createdAt: now, reinforcementCount: 5, accessCount: 0, metadata: {}, source: 'agent' });
    assertTrue(high > low, `high=${high} should > low=${low}`);
  });

  test('agent来源分数高于user', () => {
    const now = Date.now();
    const agent = scorer.score({ createdAt: now, reinforcementCount: 0, accessCount: 0, metadata: {}, source: 'agent' });
    const user = scorer.score({ createdAt: now, reinforcementCount: 0, accessCount: 0, metadata: {}, source: 'user' });
    assertTrue(agent > user, `agent=${agent} should > user=${user}`);
  });

  test('batch scoreAll 计算平均', () => {
    const now = Date.now();
    const memories = new Map([
      ['a', { createdAt: now, reinforcementCount: 0, accessCount: 0, metadata: {}, source: 'user' }],
      ['b', { createdAt: now, reinforcementCount: 5, accessCount: 10, metadata: {}, source: 'agent' }],
    ]);
    const result = scorer.scoreAll(memories);
    assertTrue(result.scores.has('a') && result.scores.has('b'), 'scores map should have both keys');
    assertTrue(result.average > 0, `average=${result.average}`);
  });
}

console.log('\n=== AssociativeGraph ===');
{
  const graph = new AssociativeGraph({ threshold: 0.1 });

  test('添加两条有共同实体的记忆', () => {
    const mem1 = new MemoryItem({ content: 'Alice loves coffee', entities: [{ value: 'Alice', normalized: 'alice' }] });
    const mem2 = new MemoryItem({ content: 'Alice works at Google', entities: [{ value: 'Alice', normalized: 'alice' }] });
    const all = new Map([[mem1.id, mem1], [mem2.id, mem2]]);
    graph.addMemory(mem1, all);
    graph.addMemory(mem2, all);
    const links = graph.edges.get(mem1.id) || [];
    assertTrue(links.some(l => l.targetId === mem2.id), `mem1 should link to mem2`);
  });

  test('getAssociated 返回关联记忆', () => {
    const mem1 = new MemoryItem({ content: 'Bob likes tea', entities: [{ value: 'Bob', normalized: 'bob' }] });
    const mem2 = new MemoryItem({ content: 'Bob lives in Tokyo', entities: [{ value: 'Bob', normalized: 'bob' }] });
    const all = new Map([[mem1.id, mem1], [mem2.id, mem2]]);
    const g2 = new AssociativeGraph({ threshold: 0.05 });
    g2.addMemory(mem1, all);
    g2.addMemory(mem2, all);
    const associated = g2.getAssociated(mem1.id, 1);
    assertTrue(associated.has(mem2.id), `should find mem2 from mem1`);
  });

  test('stats 返回图谱统计', () => {
    const stats = graph.stats();
    assertTrue(typeof stats.nodes === 'number', `nodes=${stats.nodes}`);
    assertTrue(typeof stats.totalLinks === 'number', `totalLinks=${stats.totalLinks}`);
  });
}

console.log('\n=== MemoryConsolidator ===');
{
  test('高重要性 LEARNED 晋升到 CORE', () => {
    const mm = { core: {}, learned: {} };
    const scorer = new ImportanceScorer();
    const graph = new AssociativeGraph();
    const consolidator = new MemoryConsolidator({ promotionThreshold: 0.5 });

    // 添加一个高重要性记忆到 LEARNED
    mm.learned['test1'] = {
      timestamp: Date.now(),
      selfVerifyScore: 0.9,
      accessCount: 10,
      metadata: { emotion: 8 },
      source: 'agent',
      entities: [],
    };

    const report = consolidator.consolidate(mm, scorer, graph);
    assertTrue(mm.core['test1'] !== undefined, 'test1 should be promoted to core');
    assertTrue(mm.learned['test1'] === undefined, 'test1 should be removed from learned');
    assertTrue(report.promoted.includes('test1'), 'report should track promotion');
  });

  test('CORE 超载时删除低重要性', () => {
    const mm = { core: {}, learned: {} };
    const scorer = new ImportanceScorer();
    const graph = new AssociativeGraph();
    const consolidator = new MemoryConsolidator({ promotionThreshold: 0.9, maxCoreSize: 2 });

    // 填充 CORE 到超载
    mm.core['low1'] = { timestamp: Date.now() - 86400000 * 30, selfVerifyScore: 0.3, accessCount: 0, metadata: {}, source: 'extracted', entities: [] };
    mm.core['low2'] = { timestamp: Date.now() - 86400000 * 20, selfVerifyScore: 0.3, accessCount: 0, metadata: {}, source: 'extracted', entities: [] };
    mm.core['high1'] = { timestamp: Date.now(), selfVerifyScore: 0.95, accessCount: 10, metadata: { emotion: 9 }, source: 'agent', entities: [] };

    const report = consolidator.consolidate(mm, scorer, graph);
    assertTrue(Object.keys(mm.core).length <= 2, `core should be pruned to <=2, got ${Object.keys(mm.core).length}`);
    assertTrue(mm.core['high1'] !== undefined, 'high1 should survive');
  });
}

console.log('\n=== Integration: Mem0Memory with new modules ===');
{
  test('Mem0Memory exports new classes', () => {
    const mem = new Mem0Memory();
    assertTrue(typeof mem.memories !== 'undefined', 'memories should exist');
    assertTrue(typeof mem.memories.search === 'function', 'search should be function');
  });

  test('Mem0Memory search returns results', () => {
    const mem = new Mem0Memory();
    mem.add('Alice works at Google', { user_id: 'alice' });
    mem.add('Alice loves coffee', { user_id: 'alice' });
    mem.add('Bob lives in Tokyo', { user_id: 'bob' });
    const results = mem.search('Alice', {}, 5);
    assertTrue(results.results.length >= 2, `should find >=2 Alice memories, got ${results.results.length}`);
  });
}

// Summary
console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ✅ ${passed}  ❌ ${failed}`);
if (failed === 0) {
  console.log('✅ 所有测试通过 — 记忆增强 v11.15.1');
} else {
  console.log(`❌ ${failed} 个测试失败`);
  process.exit(1);
}
