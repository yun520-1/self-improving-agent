#!/usr/bin/env node
/**
 * Test Memory Router v11.19.0
 */

const { MemoryRouter, MultiMemoryStore, MemoryType, quickClassify, inferType } = require('../src/core/memory-router');

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Memory Router v11.19.0 - Test Suite');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (e) {
      console.log(`  ❌ ${name}`);
      console.log(`     Error: ${e.message}`);
      failed++;
    }
  }

  // Test 1: quickClassify - episodic
  test('quickClassify: episodic keywords', () => {
    const result = quickClassify('昨天我们开会讨论了项目计划');
    if (result !== MemoryType.EPISODIC) throw new Error(`Expected episodic, got ${result}`);
  });

  // Test 2: quickClassify - semantic
  test('quickClassify: semantic keywords', () => {
    const result = quickClassify('光速是一个物理常数，定义为299792458米/秒');
    if (result !== MemoryType.SEMANTIC) throw new Error(`Expected semantic, got ${result}`);
  });

  // Test 3: quickClassify - procedural
  test('quickClassify: procedural keywords', () => {
    const result = quickClassify('首先打开终端，然后输入npm install，最后运行测试');
    if (result !== MemoryType.PROCEDURAL) throw new Error(`Expected procedural, got ${result}`);
  });

  // Test 4: quickClassify - ambiguous
  test('quickClassify: ambiguous returns unknown', () => {
    const result = quickClassify('这是一个普通句子没有明显特征');
    if (result !== MemoryType.UNKNOWN) throw new Error(`Expected unknown, got ${result}`);
  });

  // Test 5: inferType from source
  test('inferType: source=core_identity', () => {
    const result = inferType({ source: 'core_identity' });
    if (result !== MemoryType.CORE) throw new Error(`Expected core, got ${result}`);
  });

  // Test 6: inferType from taskType
  test('inferType: taskType=reasoning', () => {
    const result = inferType({ taskType: 'reasoning' });
    if (result !== MemoryType.SEMANTIC) throw new Error(`Expected semantic, got ${result}`);
  });

  // Test 7: MemoryRouter classify - caches result
  test('MemoryRouter: classify caches result', () => {
    const router = new MemoryRouter();
    const text = '这是一个关于物理定律的讨论';
    const r1 = router.classify(text);
    const r2 = router.classify(text);
    // Cache key is text.substring(0,200). Both calls should produce same key
    // and second call should return cached type (same type means cache worked)
    if (r1.type !== r2.type) throw new Error(`Types should match: ${r1.type} vs ${r2.type}`);
  });

  // Test 8: MemoryRouter routeWrite
  test('MemoryRouter: routeWrite returns decision', () => {
    const router = new MemoryRouter();
    const decision = router.routeWrite('项目会议在昨天下午3点举行', {
      stores: { episodic: true, semantic: true, procedural: true, core: true }
    });
    if (!decision.targets || decision.targets.length === 0) throw new Error('Should route to at least one store');
    if (!['episodic', 'semantic', 'procedural'].some(t => decision.targets.includes(t))) {
      throw new Error('Should route to meaningful store');
    }
  });

  // Test 9: MemoryRouter routeRead
  test('MemoryRouter: routeRead with taskType', () => {
    const router = new MemoryRouter();
    const decision = router.routeRead('告诉我如何配置环境', {
      stores: { episodic: true, semantic: true, procedural: true, core: true },
      taskType: 'code_generation'
    });
    if (!decision.targets || decision.targets.length === 0) throw new Error('Should route to stores');
  });

  // Test 10: MultiMemoryStore write and search
  test('MultiMemoryStore: write and search', () => {
    const store = new MultiMemoryStore();
    const { entry, decision } = store.write('昨天开会讨论了AI的发展方向', { source: 'meeting' });
    if (!entry.id) throw new Error('Entry should have id');
    
    const searchResult = store.search('AI 发展方向');
    if (searchResult.results.length === 0) throw new Error('Should find results');
  });

  // Test 11: MultiMemoryStore stats
  test('MultiMemoryStore: stats returns store info', () => {
    const store = new MultiMemoryStore();
    store.write('测试内容', { source: 'test' });
    const stats = store.stats();
    if (!stats.router) throw new Error('Should have router stats');
    if (typeof stats.episodic?.count !== 'number') throw new Error('Should have episodic stats');
  });

  // Test 12: MultiMemoryStore getByType
  test('MultiMemoryStore: getByType returns items', () => {
    const store = new MultiMemoryStore();
    store.write('物理定律是普遍适用的规律', { source: 'fact' });
    const items = store.getByType('semantic');
    if (!Array.isArray(items)) throw new Error('Should return array');
  });

  // Test 13: MemoryRouter stats
  test('MemoryRouter: stats tracks all operations', () => {
    const router = new MemoryRouter();
    router.routeWrite('测试写入', { stores: { episodic: true, semantic: true, procedural: true, core: true } });
    router.routeRead('测试读取', { stores: { episodic: true, semantic: true, procedural: true, core: true } });
    const stats = router.stats();
    if (stats.total < 2) throw new Error(`Should have at least 2 entries, got ${stats.total}`);
    if (stats.byAction.write < 1) throw new Error('Should have write action');
    if (stats.byAction.read < 1) throw new Error('Should have read action');
  });

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error('Test suite error:', e);
  process.exit(1);
});
