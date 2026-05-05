#!/usr/bin/env node
/**
 * HeartFlow Memory Breakthrough Test v11.15.2
 * Tests: Retrieval-Triggered Reinforcement, CORE Consolidation,
 *        Ephemeral Working Set, Spaced Repetition (SM-2)
 */

const { MeaningfulMemory } = require('../src/core/meaningful-memory.js');

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

function assertTrue(value, msg) {
  if (!value) throw new Error(`${msg}: got ${value}`);
}
function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}

console.log('\n=== Retrieval-Triggered Reinforcement ===');
{
  const mm = new MeaningfulMemory();
  mm.core = {}; mm.learned = {}; mm.ephemeral = {};
  mm.vectors.core = new Map(); mm.vectors.learned = new Map(); mm.vectors.ephemeral = new Map();

  // 手动构造 learned 记忆用于测试
  mm.learned.test_recall = {
    key: 'test_recall', value: 'frequently accessed memory',
    level: 'learned', accessCount: 0, stabilityMultiplier: 1.0,
    timestamp: Date.now(), source: 'test'
  };

  test('第一次访问：accessCount=1, stabilityMultiplier=1', () => {
    const r = mm.accessAndReinforce('test_recall');
    assertTrue(r.found, 'found');
    assertEq(r.accessCount, 1, 'accessCount');
    assertEq(r.stabilityMultiplier, 1.0, 'multiplier');
  });

  test('第3次访问：触发 stability multiplier', () => {
    mm.learned.test_recall.accessCount = 0; // reset
    mm.learned.test_recall.stabilityMultiplier = 1.0;
    for (let i = 0; i < 3; i++) mm.accessAndReinforce('test_recall');
    const r = mm.learned.test_recall;
    assertTrue(r.stabilityMultiplier > 1.0, `should increase, got ${r.stabilityMultiplier}`);
    assertEq(r.accessCount, 3, 'accessCount');
  });

  test('不存在返回 found:false', () => {
    const r = mm.accessAndReinforce('nonexistent_key');
    assertTrue(r.found === false, 'found should be false');
  });
}

console.log('\n=== CORE Consolidation ===');
{
  const mm = new MeaningfulMemory();
  mm.core = {}; mm.learned = {}; mm.ephemeral = {};
  mm.vectors.core = new Map(); mm.vectors.learned = new Map(); mm.vectors.ephemeral = new Map();

  // 两条高度相似的 CORE
  mm.core.key_a = {
    key: 'key_a', value: 'Alice loves coffee', level: 'core',
    accessCount: 5, timestamp: Date.now(), source: 'test'
  };
  mm.core.key_b = {
    key: 'key_b', value: 'Alice drinks coffee daily', level: 'core',
    accessCount: 1, timestamp: Date.now(), source: 'test'
  };
  mm.vectors.core.set('key_a', [0.9, 0.1, 0.0]); // 高相似度向量
  mm.vectors.core.set('key_b', [0.85, 0.15, 0.0]);

  const report = mm.consolidateCore(0.5);

  test('相似 CORE 被整合', () => {
    assertTrue(report.promoted >= 1, `should merge, got ${report.promoted}`);
  });

  test('被合并的记忆被删除', () => {
    const remainingKeys = Object.keys(mm.core);
    assertTrue(remainingKeys.length < 2, `should have < 2 keys, got ${remainingKeys.length}`);
  });
}

console.log('\n=== Ephemeral Working Set ===');
{
  const mm = new MeaningfulMemory();
  mm.ephemeral = {}; mm.vectors.ephemeral = new Map();

  test('rememberEphemeral 添加记忆', () => {
    const r = mm.rememberEphemeral({ key: 'session_1', value: 'temp data', type: 'ephemeral', importance: 0.8 });
    assertTrue(r.level === 'ephemeral', `level=${r.level}`);
    assertTrue(mm.ephemeral.session_1 !== undefined, 'should exist');
  });

  test('容量超200时触发驱逐', () => {
    for (let i = 0; i < 210; i++) {
      mm.rememberEphemeral({ key: `temp_${i}`, value: `data ${i}`, type: 'ephemeral', importance: 0.1 });
    }
    const count = Object.keys(mm.ephemeral).length;
    assertTrue(count <= 200, `should evict, got ${count}`);
  });

  test('高优先级 ephemeral 存活，低优先级被驱逐', () => {
    mm.ephemeral = {}; mm.vectors.ephemeral = new Map();
    mm.rememberEphemeral({ key: 'low', value: 'low', type: 'ephemeral', importance: 0.1 });
    mm.rememberEphemeral({ key: 'high', value: 'high', type: 'ephemeral', importance: 0.9 });
    mm._evictEphemeral(1);
    assertTrue(mm.ephemeral.high !== undefined, 'high should survive');
    assertTrue(mm.ephemeral.low === undefined, 'low should be evicted');
  });
}

console.log('\n=== Spaced Repetition (SM-2) ===');
{
  const mm = new MeaningfulMemory();

  test('getMemoriesForReview 返回已到期的记忆', () => {
    mm.learned.review_test = {
      key: 'review_test', level: 'learned',
      timestamp: Date.now(), nextReview: Date.now() - 1000,
      interval: 1, easeFactor: 2.5, reviewCount: 0
    };
    const candidates = mm.getMemoriesForReview(5);
    assertTrue(candidates.length >= 1, `should have candidates, got ${candidates.length}`);
  });

  test('SM-2 quality=5：间隔增长', () => {
    const r = mm.reviewMemory('review_test', 5);
    assertTrue(r.interval > 1, `interval should grow, got ${r.interval}`);
    assertTrue(r.easeFactor >= 1.3, `easeFactor=${r.easeFactor}`);
  });

  test('SM-2 quality=0：忘记重置间隔', () => {
    mm.learned.review_test.interval = 24;
    const r = mm.reviewMemory('review_test', 0);
    assertEq(r.interval, 1, 'interval should reset to 1');
  });

  test('SM-2 quality=3：6h * EF ≈ 15h', () => {
    mm.learned.review_test.interval = 6;
    mm.learned.review_test.easeFactor = 2.5;
    const r = mm.reviewMemory('review_test', 3);
    assertTrue(r.interval >= 14 && r.interval <= 16, `interval should be ~15, got ${r.interval}`);
  });
}

console.log('\n=== Enhanced getRetention ===');
{
  const mm = new MeaningfulMemory();
  const reinforced = { level: 'learned', timestamp: Date.now() - 3600000, stabilityMultiplier: 2.0 };
  const normal = { level: 'learned', timestamp: Date.now() - 3600000, stabilityMultiplier: undefined };

  test('强化记忆 retention >= 正常记忆', () => {
    const r1 = mm.getRetention(reinforced);
    const r2 = mm.getRetention(normal);
    assertTrue(r1 >= r2, `reinforced=${r1.toFixed(3)} should >= normal=${r2.toFixed(3)}`);
  });
}

// Summary
console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ✅ ${passed}  ❌ ${failed}`);
if (failed === 0) {
  console.log('✅ 所有测试通过 — 记忆突破 v11.15.2');
} else {
  console.log(`❌ ${failed} 个测试失败`);
  process.exit(1);
}
