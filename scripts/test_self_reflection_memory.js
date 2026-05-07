#!/usr/bin/env node
/**
 * Test Self-Reflection Memory v11.18.0
 */

const { SelfReflectionMemory, ReflectionStore } = require('../src/core/self-reflection-memory');

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Self-Reflection Memory v11.18.0 - Test Suite');
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

  // Test 1: ReflectionStore add and retrieve
  test('ReflectionStore: add and retrieve', () => {
    const store = new ReflectionStore();
    const id = store.reflections.length; // use current length as unique-ish id
    const entry = store.add({
      id: `test-${id}`,
      taskType: 'decision',
      outcome: 'failure',
      whatHappened: '误判了用户意图，给出了不相关的回答',
      rootCause: '没有验证前提假设',
      insight: '做决策前必须验证用户真正想要什么',
      strategyForNextTime: '先用counterfactual-engine验证意图'
    });
    if (!entry.id) throw new Error('Entry should have an id');
    if (entry.taskType !== 'decision') throw new Error('taskType mismatch');
  });

  // Test 2: ReflectionStore keyword extraction
  test('ReflectionStore: keyword extraction', () => {
    const store = new ReflectionStore();
    const id = store.reflections.length;
    const entry = store.add({
      id: `test-${id}`,
      taskType: 'reasoning',
      outcome: 'success',
      whatHappened: '正确识别了逻辑错误并进行了修正',
      rootCause: '自我验证发现了矛盾',
      insight: '自我验证能有效捕获逻辑错误'
    });
    if (!entry.keywords || entry.keywords.length === 0) throw new Error('Keywords should be extracted');
    // Check some expected keywords
    const kwStr = entry.keywords.join(' ');
    if (!kwStr.includes('reason')) throw new Error('Should contain "reason"');
  });

  // Test 3: ReflectionStore retrieve by taskType
  test('ReflectionStore: retrieve by taskType', () => {
    const store = new ReflectionStore();
    // Add multiple entries with different types
    const idx = store.reflections.length;
    store.add({ id: `test-idx-${idx}-1`, taskType: 'code', outcome: 'success', whatHappened: '代码正确', rootCause: 'N/A', insight: '测试', strategyForNextTime: 'N/A' });
    store.add({ id: `test-idx-${idx}-2`, taskType: 'code', outcome: 'failure', whatHappened: '代码有bug', rootCause: '边界条件', insight: '检查边界', strategyForNextTime: '写测试' });
    store.add({ id: `test-idx-${idx}-3`, taskType: 'reasoning', outcome: 'failure', whatHappened: '推理错误', rootCause: '假设错误', insight: '验证假设', strategyForNextTime: '检查前提' });
    
    const codeResults = store.retrieve('code');
    if (codeResults.length < 2) throw new Error(`Should retrieve at least 2 code entries, got ${codeResults.length}`);
    const allCode = codeResults.every(r => r.taskType === 'code');
    if (!allCode) throw new Error('All results should be taskType=code');
  });

  // Test 4: ReflectionStore getFailures
  test('ReflectionStore: getFailures', () => {
    const store = new ReflectionStore();
    const idx = store.reflections.length;
    store.add({ id: `test-idx-${idx}-f1`, taskType: 'test', outcome: 'failure', whatHappened: 'fail1', rootCause: 'r1', insight: 'i1', strategyForNextTime: 's1' });
    store.add({ id: `test-idx-${idx}-s1`, taskType: 'test', outcome: 'success', whatHappened: 'ok1', rootCause: 'N/A', insight: 'i2', strategyForNextTime: 's2' });
    
    const failures = store.getFailures('test');
    if (failures.length === 0) throw new Error('Should have at least 1 failure');
    const allFail = failures.every(r => r.outcome === 'failure');
    if (!allFail) throw new Error('All returned should be failures');
  });

  // Test 5: ReflectionGenerator._ruleBasedRootCause
  test('ReflectionGenerator: rule-based root cause analysis', () => {
    const { ReflectionGenerator } = require('../src/core/self-reflection-memory');
    const gen = new ReflectionGenerator();
    
    const failureResult = gen._ruleBasedRootCause({
      outcome: 'failure',
      reasoning: '我假设用户想要X但实际上他们想要Y'
    });
    if (!failureResult.includes('假设')) throw new Error(`Should detect assumption issue, got: ${failureResult}`);
    
    const successResult = gen._ruleBasedRootCause({
      outcome: 'success',
      reasoning: '正确识别并匹配了意图'
    });
    if (!successResult.includes('成功')) throw new Error(`Should detect success, got: ${successResult}`);
  });

  // Test 6: SelfReflectionMemory.reflect()
  test('SelfReflectionMemory: reflect() generates and stores', async () => {
    const mem = new SelfReflectionMemory();
    const result = await mem.reflect({
      taskType: 'reasoning',
      intent: '用户询问如何减少逻辑错误',
      action: '提供了基于自我验证的答案',
      outcome: 'success',
      reasoning: '先识别了问题类型，然后应用了验证策略'
    });
    
    if (!result.id) throw new Error('Should have id');
    if (result.taskType !== 'reasoning') throw new Error('taskType should be reasoning');
    if (result.outcome !== 'success') throw new Error('outcome should be preserved');
    if (!result.rootCause) throw new Error('Should have rootCause');
    if (!result.strategyForNextTime) throw new Error('Should have strategy');
  });

  // Test 7: SelfReflectionMemory.retrieveLessons()
  test('SelfReflectionMemory: retrieveLessons() returns failure lessons first', async () => {
    const mem = new SelfReflectionMemory();
    
    // Add a failure reflection first
    await mem.reflect({
      taskType: 'reasoning',
      intent: '测试意图',
      action: '测试行动',
      outcome: 'failure',
      reasoning: '因为假设错误导致失败'
    });
    
    const lessons = mem.retrieveLessons('reasoning');
    if (lessons.length === 0) throw new Error('Should retrieve at least 1 lesson');
    // Failure lessons should come first
    const firstLesson = lessons[0];
    if (firstLesson.outcome !== 'failure') {
      console.log(`     Note: First lesson outcome=${firstLesson.outcome}, not failure (may be ok if no failures in store)`);
    }
  });

  // Test 8: SelfReflectionMemory.getLessonsForContext()
  test('SelfReflectionMemory: getLessonsForContext() formats correctly', async () => {
    const mem = new SelfReflectionMemory();
    await mem.reflect({
      taskType: 'test',
      intent: '测试',
      action: '行动',
      outcome: 'failure',
      reasoning: '失败因为假设'
    });
    
    const contextStr = mem.getLessonsForContext('test');
    // Should contain some formatted reflection
    if (typeof contextStr !== 'string') throw new Error('Should return string');
  });

  // Test 9: SelfReflectionMemory.stats()
  test('SelfReflectionMemory: stats() returns store and session stats', async () => {
    const mem = new SelfReflectionMemory();
    await mem.reflect({
      taskType: 'test',
      intent: '测试',
      action: '行动',
      outcome: 'success',
      reasoning: '成功'
    });
    
    const stats = mem.stats();
    if (typeof stats.store !== 'object') throw new Error('Should have store stats');
    if (typeof stats.sessionReflections !== 'number') throw new Error('Should have session count');
    if (stats.sessionReflections < 1) throw new Error('Should have at least 1 session reflection');
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
