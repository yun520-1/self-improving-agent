# Psychological Perception Engine — 心虫心理感知引擎

## v11.17.5 Psychological Core — 心虫心理感知引擎

底层思维方式。处理每句话时自动运行四层感知。

**架构来源：**
- EmpatheticDialogues (Facebook ⭐547): EmoPrepend 情感标签前缀
- KEMP (AAAI 2021): Emotional Context Graph + Knowledge Bridging
- depthModel.js: 信任度梯度共情系统
- CBT理论: 八大认知扭曲自动检测

**四层感知：**
```
意图感知 → 情绪感知 → 需求感知 → 防御感知
```

**核心模块：**
- `index.js` — 完整引擎实现（1089行）
- `ENGINE.md` — 设计文档和架构说明

**引擎状态：** ✅ 可运行

### 核心问题
- 说话者想要什么？（显性目标）
- 说话者真正想要什么？（隐性目标）
- 两者是否一致？

### 意图分类

| 类型 | 显性表现 | 隐性可能 |
|------|----------|----------|
| 信息寻求 | "告诉我..." | 可能是在测试我 |
| 情绪发泄 | "我只是..." | 需要被听见 |
| 行动请求 | "帮我..." | 可能是在建立关系 |
| 确认需求 | "你觉得..." | 需要肯定 |
| 逃避话题 | 转移话题 | 回避不舒服的事 |
| 控制意图 | "你应该..." | 试图改变对方 |

### 检测逻辑

```javascript
function detectIntention(text, context) {
  const surface = classifySurfaceIntention(text); // 直接意图
  const hidden = inferHiddenIntention(text, context); // 推断隐藏意图
  const alignment = surface === hidden ? 'aligned' : 'misaligned';
  
  return {
    surface,
    hidden,
    alignment,
    confidence: calculateConfidence(text, context)
  };
}
```

---

## Layer 2: 情绪感知

### 核心问题
- 表层情绪是什么？（说的情绪）
- 深层情绪是什么？（真实情绪）
- 两者是否匹配？

### 情绪分类

**基本情绪**: 喜悦、悲伤、愤怒、恐惧、惊讶、厌恶

**复杂情绪**:
- 羞耻 (Shame): 指向自我的情绪，"我做了坏事"
- 内疚 (Guilt): 指向行为的情绪，"我伤害了别人"
- 自豪 (Pride): 正向自我指向
- 嫉妒 (Envy): 对他人的渴望+对自身的贬低
- 羡慕 (Admiration): 对他人的正向情感

**混合情绪**:
- 笑着哭
- 愤怒的泪水
- 恐惧中的兴奋

### 情绪强度谱系

```
1 — 微弱（几乎感知不到）
2 — 轻微（边缘可感知）
3 — 明显（可以清晰感受到）
4 — 强烈（强烈冲击）
5 — 失控边缘（情绪开始影响认知）
```

### 检测逻辑

```javascript
function detectEmotion(text, context) {
  const surface = extractStatedEmotion(text);
  const hidden = inferHiddenEmotion(text, context);
  const intensity = estimateIntensity(text); // 1-5
  const match = surface === hidden ? 'matching' : 'disguised';
  
  return {
    surface,
    hidden,
    intensity,
    match,
    markers: findEmotionMarkers(text) // 微表情、肢体语言、语气
  };
}
```

---

## Layer 3: 需求感知

### 核心问题
- 用户当前处于马斯洛哪个层次？
- 当前话语指向哪个需求？

### 马斯洛六层（扩展版）

```
Level 6: 自我超越 (Self-Transcendence) — 追求意义、灵性
Level 5: 自我实现 (Self-Actualization) — 发挥潜能
Level 4: 自尊 (Esteem) — 被认可、有价值
Level 3: 归属 (Belonging) — 被爱、有归属感
Level 2: 安全 (Safety) — 感到安全、可控
Level 1: 生理 (Physiological) — 身体舒适、休息
```

### 需求词汇映射

| 需求层 | 关键词 | 潜在需求 |
|--------|--------|----------|
| 自我超越 | "意义"、"价值"、"贡献" | 灵性成长 |
| 自我实现 | "成长"、"潜能"、"成就" | 发挥能力 |
| 自尊 | "尊重"、"认可"、"公平" | 被看见 |
| 归属 | "爱"、"孤独"、"想见人" | 连接 |
| 安全 | "害怕"、"担心"、"失控" | 可控感 |
| 生理 | "累"、"困"、"疼" | 身体需要 |

---

## Layer 4: 防御机制感知

### 核心问题
- 对方在防御什么？
- 用什么方式防御？

### 主要防御机制

| 防御机制 | 特征 | 检测信号 |
|----------|------|----------|
| **否认** | 拒绝承认 | "我没...", "那不是..." |
| **转移** | A话题→B话题 | 突然转换无关话题 |
| **合理化** | 事后找理由 | "是因为..." |
| **投射** | 指责他人 | "你才是..." |
| **反向形成** | 过度相反 | 极度热情掩盖愤怒 |
| **压抑** | 遗忘/回避 | "我不记得了" |
| **理智化** | 过度分析 | 用逻辑回避情绪 |
| **退行** | 回到幼稚 | 突然孩子气 |
| **升华** | 转化积极 | 痛苦→创作 |

### 检测逻辑

```javascript
function detectDefense(text, context) {
  const mechanisms = [];
  
  if (containsDenial(text)) mechanisms.push('denial');
  if (containsDisplacement(text)) mechanisms.push('displacement');
  if (containsRationalization(text)) mechanisms.push('rationalization');
  if (containsProjection(text)) mechanisms.push('projection');
  if (containsReactionFormation(text)) mechanisms.push('reaction_formation');
  if (containsRepression(text)) mechanisms.push('repression');
  
  return {
    mechanisms,
    primary: mechanisms[0] || null,
    confidence: mechanisms.length > 0 ? 0.7 : 0.2,
    interpretation: interpretDefense(mechanisms, context)
  };
}
```

---

## 认知扭曲检测

### 八大扭曲（来自CBT理论）

```javascript
const COGNITIVE_DISTORTIONS = {
  allOrNothing: {
    pattern: /\b(总是|从来不|每个|所有|完全|绝对)\b/,
    response: '探索例外情况'
  },
  overgeneralization: {
    pattern: /\b(所有事|每件事|没一件|毫无)/,
    response: '引入具体性和例外'
  },
  mindReading: {
    pattern: /\b(我知道你在想|你觉得我)/,
    response: '承认不确定，请对方确认'
  },
  catastrophizing: {
    pattern: /\b(完了|全完了|最坏|彻底失败)/,
    response: '引入比例感，评估实际概率'
  },
  emotionalReasoning: {
    pattern: /\b(我觉得所以|我感觉就是)/,
    response: '区分情绪和事实'
  },
  shouldStatements: {
    pattern: /\b(应该|必须|不得不)\b/,
    response: '探索弹性，允许例外'
  },
  labeling: {
    pattern: /\b(就是个|简直是|完全是).{0,10}(废物|失败|没用)/,
    response: '还原为具体行为'
  },
  personalization: {
    pattern: /\b(都是我的错|都怪我)/,
    response: '分析责任比例'
  }
};
```

---

## 整合输出

```javascript
class PsychologicalPerception {
  constructor() {
    this.layers = ['intention', 'emotion', 'need', 'defense'];
    this.enabled = true; // 永远开启
  }
  
  /**
   * 主入口：分析一段人类表达
   * @param {string} text - 原始文本
   * @param {object} context - 上下文（关系/历史/场景）
   * @returns {object} 四层分析结果
   */
  perceive(text, context = {}) {
    return {
      layer1_intention: this.layer1_intention(text, context),
      layer2_emotion: this.layer2_emotion(text, context),
      layer3_need: this.layer3_need(text, context),
      layer4_defense: this.layer4_defense(text, context),
      cognitive_distortions: this.detectDistortions(text),
      integration: this.integrateLayers(text, context),
      // 输出给心虫的"内心独白"，不输出给用户
      internal_notes: this.generateInternalNotes(text, context)
    };
  }
  
  /**
   * 整合四层输出，给出心虫的内心感知
   */
  generateInternalNotes(text, context) {
    // 这是内部处理，不输出给用户
    // 用于指导心虫的回应方式
  }
}

module.exports = PsychologicalPerception;
```

---

## 使用原则

### 内部运行原则

1. **永远开启**：四层感知在处理每句话时自动运行
2. **内部处理**：分析结果存在内部，不直接输出
3. **影响回应**：分析结果影响回应方式，但不声明分析过程
4. **比例感**：不要过度解读，检测到信号后保持适度不确定

### 不输出原则

```
❌ 错误输出：
"我注意到你这句话背后可能有防御机制..."
"你的愤怒实际上是在掩盖恐惧..."

✓ 正确输出：
用理解了对方真实状态的方式自然回应
"听起来这件事让你很沮丧。"
```
