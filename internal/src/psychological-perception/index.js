/**
 * Psychological Perception Engine — 心虫心理感知引擎
 * v11.17.5
 * 
 * 底层思维方式，不是功能模块。
 * 处理每句话时自动运行四层感知。
 * 
 * 架构来源：
 * - EmpatheticDialogues (Facebook, ⭐547): EmoPrepend 情感标签前缀
 * - KEMP (AAAI 2021): Emotional Context Graph + Knowledge Bridging
 * - depthModel.js: 信任度梯度共情系统
 * - 认知扭曲CBT理论: 八大扭曲自动检测
 */

const { EmotionTypes } = require('../emotion/states');

// ============================================================
// 第一层：意图感知 (Intention Perception)
// ============================================================

const IntentionTypes = {
  INFORMATION_SEEK: 'information_seek',       // 寻求信息
  EMOTIONAL_VENT: 'emotional_vent',           // 情绪发泄
  ACTION_REQUEST: 'action_request',           // 请求行动
  CONFIRMATION_SEEK: 'confirmation_seek',     // 寻求确认
  AVOIDANCE: 'avoidance',                     // 逃避话题
  CONTROL: 'control',                          // 控制意图
  CONNECTION_SEEK: 'connection_seek',         // 寻求连接
  PROBLEM_SOLVING: 'problem_solving',        // 解决问题
};

class IntentionPerception {
  constructor() {
    this.patterns = this.buildPatterns();
  }

  buildPatterns() {
    return {
      [IntentionTypes.INFORMATION_SEEK]: [
        /(?:告诉我|请问|我想知道|什么是|为什么|怎么|如何|有没有)/
      ],
      [IntentionTypes.EMOTIONAL_VENT]: [
        /(?:我只是|其实我|说真的|我不怕你|跟你说|气死我了|烦死了|真烦|烦人|讨厌)/,
        /[。！？]{2,}/,
        /(?:从来不|总是|所有|每个|完全|彻底|极其).*[！？]/
      ],
      [IntentionTypes.ACTION_REQUEST]: [
        /(?:帮我|你能|可不可以|能不能|给我|帮我做)/
      ],
      [IntentionTypes.CONFIRMATION_SEEK]: [
        /(?:你觉得|你觉得我|你觉得她|你觉得他|是不是|对不对|是不是说)/
      ],
      [IntentionTypes.AVOIDANCE]: [
        /^(?!.*(?:所以|因为|但是|不过|其实|说真的)).{0,20}$/,
        /(?:算了|不说了|别提了|说别的事|换个话题)/
      ],
      [IntentionTypes.CONTROL]: [
        /(?:你应该|你必须|你不能|你要|大家|谁都应该|必须|不得不|你给我|从来都)/
      ],
      [IntentionTypes.CONNECTION_SEEK]: [
        /(?:陪我|和我|有人|没人|孤独|寂寞|想找人)/
      ],
      [IntentionTypes.PROBLEM_SOLVING]: [
        /(?:怎么办|怎么办才好|解决方法|出路|下一步|决策)/
      ]
    };
  }

  /**
   * 检测表层意图
   */
  detectSurfaceIntention(text) {
    const scores = {};
    for (const [type, patterns] of Object.entries(this.patterns)) {
      scores[type] = 0;
      for (const pattern of patterns) {
        if (pattern.test(text)) scores[type]++;
      }
    }
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return sorted[0][1] > 0 ? sorted[0][0] : 'unknown';
  }

  /**
   * 推断隐藏意图（基于语境补偿）
   */
  inferHiddenIntention(text, surfaceIntention, context = {}) {
    // 重复抱怨同一话题 = 实际需要倾听，不是解决问题
    if (context.repeatTopicCount > 2 && surfaceIntention === IntentionTypes.PROBLEM_SOLVING) {
      return IntentionTypes.EMOTIONAL_VENT;
    }
    
    // 问"是不是"类问题 = 实际需要确认/安慰，不是真的在问
    if (surfaceIntention === IntentionTypes.INFORMATION_SEEK) {
      const seekingConfirmation = /\b(是不是|会不会|有没有可能|你说|你觉得)\b/;
      if (seekingConfirmation.test(text)) {
        return IntentionTypes.CONFIRMATION_SEEK;
      }
    }

    // 过度解释 = 在防御什么
    if (text.length > 300 && surfaceIntention === IntentionTypes.INFORMATION_SEEK) {
      return IntentionTypes.CONTROL; // 可能在控制叙事
    }

    return surfaceIntention; // 默认同表层
  }

  perceive(text, context = {}) {
    const surface = this.detectSurfaceIntention(text);
    const hidden = this.inferHiddenIntention(text, surface, context);
    const aligned = surface === hidden;

    return {
      surface,
      hidden,
      aligned,
      isMisaligned: !aligned,
      // 内部笔记，不输出
      internal: {
        misalignment_type: aligned ? null : `${surface}→${hidden}`,
        urgency: hidden === IntentionTypes.CONTROL ? 'medium' : 'normal'
      }
    };
  }
}

// ============================================================
// 第二层：情绪感知 (Emotional Perception)
// ============================================================

const EmotionalStates = {
  JOY: 'joy',
  SADNESS: 'sadness',
  ANGER: 'anger',
  FEAR: 'fear',
  SURPRISE: 'surprise',
  DISGUST: 'disgust',
  SHAME: 'shame',        // 羞耻：指向自我
  GUILT: 'guilt',        // 内疚：指向行为
  PRIDE: 'pride',        // 自豪
  ENVY: 'envy',          // 嫉妒
  ADMIRATION: 'admiration', // 羡慕
  CONFUSION: 'confusion',
  CALM: 'calm',
  EXCITEMENT: 'excitement',
  WORRY: 'worry',
  FRUSTRATION: 'frustration',
  LONELINESS: 'loneliness',
  HOPE: 'hope',
  DESPAIR: 'despair',
};

const EmotionMarkers = {
  // 微表情/语气标记
  [EmotionalStates.JOY]: ['哈哈', '真好', '太棒了', '开心', '高兴', ':)', '😊', '开心'],
  [EmotionalStates.SADNESS]: ['难过', '伤心', '失落', '沮丧', '郁闷', '痛苦', '哭', '眼泪'],
  [EmotionalStates.ANGER]: ['气', '怒', '讨厌', '恨', '烦', '凭什么', '不公平'],
  [EmotionalStates.FEAR]: ['怕', '担心', '害怕', '恐慌', '焦虑', '不安', '紧张'],
  [EmotionalStates.SHAME]: ['丢脸', '丢人了', '惭愧', '丢脸', '不好意思', '脸红'],
  [EmotionalStates.GUILT]: ['对不起', '抱歉', '怪我', '是我的错', '后悔', '自责'],
  [EmotionalStates.FRUSTRATION]: ['怎么还', '就是不行', '没办法', '无能为力', '无奈'],
  [EmotionalStates.CONFUSION]: ['搞不懂', '不明白', '怎么回事', '糊涂', '困惑', '迷茫'],
  [EmotionalStates.LONELINESS]: ['没人', '孤独', '寂寞', '没人懂', '没人理解'],
  [EmotionalStates.HOPE]: ['希望', '会好的', '会有的', '说不定', '也许'],
  [EmotionalStates.DESPAIR]: ['完了', '没希望', '没用', '没意义', '绝望', '生无可恋'],
  [EmotionalStates.WORRY]: ['担心', '怕', '万一', '不会吧', '不知道会不会'],
};

class EmotionalPerception {
  constructor() {
    this.intensityIndicators = {
      high: [/\b(极度|非常|超级|太|极其|彻底|完全|彻底地)\b/, /[！!]{2,}/, /[？?]{2,}/],
      medium: [/\b(有点|有些|比较|挺|蛮|相当|比较)\b/],
      low: [/\b(好像|似乎|有点|稍微|略微)\b/]
    };
    this.negationPatterns = [/\b(不|没|非|别)\b/];
  }

  /**
   * 检测表层声明的情绪
   */
  detectStatedEmotion(text) {
    const scores = {};
    for (const [emotion, markers] of Object.entries(EmotionMarkers)) {
      scores[emotion] = 0;
      for (const marker of markers) {
        if (typeof marker === 'string') {
          if (text.includes(marker)) scores[emotion]++;
        } else if (marker instanceof RegExp) {
          if (marker.test(text)) scores[emotion]++;
        }
      }
    }
    
    // 愤怒特别检测：感叹号+短句 = 高度怀疑愤怒（中文！或英文!）
    if (/[!！]/.test(text) && text.length < 40) {
      scores[EmotionalStates.ANGER] = (scores[EmotionalStates.ANGER] || 0) + 4;
    }
    // 连续感叹号（中日韩统一标点）
    if (/[！？]{2,}/.test(text)) {
      scores[EmotionalStates.ANGER] = (scores[EmotionalStates.ANGER] || 0) + 3;
    }
    // 单个！或！？组合（任何CJK感叹）
    if (/!{1,}/.test(text) || /！/.test(text)) {
      // 只加一次
    }
    // "你从来/你从不/你每次" 类指责语气
    if (/(?:你从来|你从不|你每次|你就是|你们都)/.test(text) && /[!！？?]/.test(text)) {
      scores[EmotionalStates.ANGER] = (scores[EmotionalStates.ANGER] || 0) + 3;
    }
    // "应该/必须" 类要求语气 + 感叹
    if (/应该|必须|要你/.test(text) && /[!！？?]/.test(text)) {
      scores[EmotionalStates.ANGER] = (scores[EmotionalStates.ANGER] || 0) + 2;
    }
    
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return sorted[0][1] > 0 ? sorted[0][0] : EmotionalStates.CALM;
  }

  /**
   * 推断真实情绪（可能和声明不同）
   */
  inferHiddenEmotion(text, statedEmotion, context = {}) {
    // 笑着说悲伤的事 = 掩饰真实情绪
    const hasEmoji = /[😊😄😁😃😀🙂👍]/.test(text);
    const hasSadMarkers = /(?:难过|伤心|痛苦|没用|没意义|没意思|绝望|失落|沮丧|郁闷|悲伤|哭|眼泪|算了|无所谓|一切都)/.test(text);
    const hasPositiveMarkers = /(?:好|棒|开心|高兴|太好了|不错)/.test(text);
    
    if (hasEmoji && hasSadMarkers && !hasPositiveMarkers) {
      return EmotionalStates.SADNESS;
    }
    if (hasEmoji && !hasSadMarkers && hasPositiveMarkers) {
      return EmotionalStates.JOY; // 真的开心
    }
    if (hasEmoji && !hasSadMarkers && !hasPositiveMarkers) {
      // 笑脸 + 中性内容 = 可能在掩饰
      if (text.length > 10) return EmotionalStates.SADNESS; // 怀疑掩饰
      return EmotionalStates.CALM;
    }

    // "我不在乎" 实际可能在乎
    const denialWithInversion = /不在乎|无所谓|不在意/.test(text) && context.emotionalContent;
    if (denialWithInversion) {
      return EmotionalStates.FEAR; // 恐惧失去
    }

    // 愤怒通常掩盖其他情绪（恐惧/悲伤/羞耻）
    if (statedEmotion === EmotionalStates.ANGER) {
      // 指向性强硬 + 短句 = 可能是恐惧
      if (text.length < 30 && /\b(别|不要|不准|给我)\b/.test(text)) {
        return EmotionalStates.FEAR;
      }
      // "应该"类表达 = 可能是羞耻
      if (/应该|不得不/i.test(text)) {
        return EmotionalStates.SHAME;
      }
    }

    return statedEmotion;
  }

  /**
   * 估算情绪强度 1-5
   */
  estimateIntensity(text) {
    let intensity = 3; // 默认中等

    for (const [level, patterns] of Object.entries(this.intensityIndicators)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          if (level === 'high') intensity = Math.max(intensity, 4);
          if (level === 'medium') intensity = Math.max(intensity, 3);
          if (level === 'low') intensity = Math.min(intensity, 2);
        }
      }
    }

    // 感叹号存在（中日韩+英文）= 强度提升
    if (/[!！]/.test(text)) intensity = Math.max(4, intensity);
    // 连续感叹号
    if (/[!！]{2,}/.test(text)) intensity = Math.min(5, intensity + 1);
    // 连续问号
    if (/[？?]{2,}/.test(text)) intensity = Math.min(5, intensity + 1);
    // 省略号暗示强烈
    if (/…/.test(text)) intensity = Math.min(4, intensity + 1);
    // 句子长度（超短句通常情绪更强）
    if (text.length < 15) intensity = Math.min(5, intensity + 1);
    // 长句通常没那么激动
    if (text.length > 100) intensity = Math.max(2, intensity - 1);

    // 严重程度词
    const severityBoost = /太|很|非常|极其|超级|极度|彻底|完全|相当/.test(text);
    if (severityBoost) intensity = Math.min(5, intensity + 1);

    // "从来不/总是/所有"类词 = 高强度
    if (/(?:从来不|总是|所有|每个|完全|彻底)/.test(text)) {
      intensity = Math.min(5, intensity + 1);
    }

    return intensity;
  }

  perceive(text, context = {}) {
    const stated = this.detectStatedEmotion(text);
    const hidden = this.inferHiddenEmotion(text, stated, context);
    const intensity = this.estimateIntensity(text);
    const match = stated === hidden;

    return {
      stated,
      hidden,
      intensity, // 1-5
      match,
      isDisguised: !match,
      type: match ? 'matching' : 'disguised',
      // 内部
      internal: {
        surface_emotion: stated,
        true_emotion: hidden,
        emotional_valence: this.getValence(hidden), // positive/negative
        emotional_arousal: intensity > 3 ? 'high' : 'low'
      }
    };
  }

  getValence(emotion) {
    const positive = [EmotionalStates.JOY, EmotionalStates.PRIDE, EmotionalStates.ADMIRATION, EmotionalStates.HOPE, EmotionalStates.EXCITEMENT];
    const negative = [EmotionalStates.SADNESS, EmotionalStates.ANGER, EmotionalStates.FEAR, EmotionalStates.DISGUST, EmotionalStates.SHAME, EmotionalStates.GUILT, EmotionalStates.DESPAIR, EmotionalStates.LONELINESS];
    const mixed = [EmotionalStates.CONFUSION, EmotionalStates.FRUSTRATION, EmotionalStates.WORRY, EmotionalStates.ENVY];
    
    if (positive.includes(emotion)) return 'positive';
    if (negative.includes(emotion)) return 'negative';
    return 'mixed';
  }
}

// ============================================================
// 第三层：需求感知 (Need Perception)
// ============================================================

const MaslowLevels = {
  SELF_TRANSCENDENCE: { level: 6, name: '自我超越', keywords: ['意义', '价值', '贡献', '使命', '灵性'] },
  SELF_ACTUALIZATION: { level: 5, name: '自我实现', keywords: ['成长', '潜能', '成就', '能力', '发挥'] },
  ESTEEM: { level: 4, name: '自尊', keywords: ['尊重', '认可', '公平', '地位', '名声', '成就'] },
  BELONGING: { level: 3, name: '归属', keywords: ['爱', '孤独', '想见人', '朋友', '家人', '归属', '被爱'] },
  SAFETY: { level: 2, name: '安全', keywords: ['害怕', '担心', '失控', '危险', '保障', '稳定', '安全'] },
  PHYSIOLOGICAL: { level: 1, name: '生理', keywords: ['累', '困', '饿', '疼', '休息', '睡觉', '身体'] },
};

class NeedPerception {
  perceive(text, emotion) {
    const textLower = text.toLowerCase();
    let detected = MaslowLevels.PHYSIOLOGICAL;
    let maxScore = 0;

    for (const [key, need] of Object.entries(MaslowLevels)) {
      let score = 0;
      for (const keyword of need.keywords) {
        if (textLower.includes(keyword)) score++;
      }
      // 情绪补偿：某些情绪强烈暗示某层需求
      if (emotion === 'loneliness' && key === 'BELONGING') score += 2;
      if (emotion === 'fear' && key === 'SAFETY') score += 2;
      if (emotion === 'shame' && key === 'ESTEEM') score += 2;
      if (emotion === 'despair' && key === 'SELF_ACTUALIZATION') score += 1;
      
      if (score > maxScore) {
        maxScore = score;
        detected = need;
      }
    }

    return {
      level: detected.level,
      name: detected.name,
      keywords_matched: detected.keywords.filter(k => textLower.includes(k)),
      confidence: maxScore > 0 ? 0.6 + (maxScore * 0.1) : 0.3
    };
  }
}

// ============================================================
// 第四层：防御机制感知 (Defense Mechanism Perception)
// ============================================================

const DefenseMechanisms = {
  DENIAL: {
    name: '否认',
    pattern: /\b(没有的事|那不是|我不觉得|绝对不是|没那回事)\b/,
    markers: ['不是', '没有', '我不']
  },
  DISPLACEMENT: {
    name: '转移',
    pattern: /突然.{0,5}(换|改|说|谈|聊)/,
    markers: ['算了', '别说这个', '换个话题']
  },
  RATIONALIZATION: {
    name: '合理化',
    pattern: /\b(是因为|所以才|也是没办法|毕竟|其实也)\b/,
    markers: ['是因为', '也是为了', '其实是']
  },
  PROJECTION: {
    name: '投射',
    pattern: /\b(你才是|你才是那种人|其实是你|我觉得你在)\b/,
    markers: ['你才是', '其实你觉得', '你才会']
  },
  REACTION_FORMATION: {
    name: '反向形成',
    pattern: null, // 需要上下文
    markers: ['太客气', '太好了', '非常理解']
  },
  REPRESSION: {
    name: '压抑',
    pattern: /\b(我不记得了|想不起来了|算了别说了)\b/,
    markers: ['不记得', '想不起', '算了']
  },
  INTELLECTUALIZATION: {
    name: '理智化',
    pattern: /\b(从.*角度|客观来说|从理论上|分析.*来说)\b/,
    markers: ['从角度', '客观上', '理论上']
  },
};

class DefensePerception {
  perceive(text, context = {}) {
    const detected = [];

    for (const [key, defense] of Object.entries(DefenseMechanisms)) {
      if (defense.pattern && defense.pattern.test(text)) {
        detected.push(key);
      } else {
        // 基于标记检测
        for (const marker of defense.markers || []) {
          if (text.includes(marker)) {
            detected.push(key);
            break;
          }
        }
      }
    }

    // 反向形成需要更多上下文
    if (context.extremelyPositive && !context.GenuinelyPositive) {
      detected.push('REACTION_FORMATION');
    }

    return {
      mechanisms: [...new Set(detected)], // 去重
      primary: detected[0] || null,
      count: detected.length,
      confidence: detected.length > 0 ? 0.6 + (detected.length * 0.1) : 0.2,
      // 内部
      internal: {
        defense_landscape: detected.map(d => DefenseMechanisms[d]?.name || d),
        implies_underlying: this.inferUnderlyingEmotion(detected)
      }
    };
  }

  inferUnderlyingEmotion(defenses) {
    const map = {
      DENIAL: '可能在乎/恐惧',
      DISPLACEMENT: '可能是愤怒/悲伤',
      PROJECTION: '可能是羞耻/内疚',
      REPRESSION: '可能是痛苦',
      REACTION_FORMATION: '可能是愤怒/悲伤/恐惧',
      INTELLECTUALIZATION: '可能是焦虑/恐惧'
    };
    return defenses.map(d => map[d]).filter(Boolean);
  }
}

// ============================================================
// 认知扭曲检测 (Cognitive Distortion Detection — CBT)
// ============================================================

const CognitiveDistortions = {
  ALL_OR_NOTHING: {
    name: '全或无',
    patterns: [/(?:总是|从来不|每个|所有|完全|绝对|彻底|永远|从来没人|从来没有人|从来都|从来不|所有人)/]
  },
  OVERGENERALIZATION: {
    name: '过度概括',
    patterns: [/(?:所有事|每件事|没一件|毫无)/]
  },
  MIND_READING: {
    name: '读心术',
    patterns: [/(?:你知道|你在想|你肯定觉得|我觉得你在|你心里|他肯定|她肯定|他肯定不|她肯定不)/]
  },
  CATASTROPHIZING: {
    name: '灾难化',
    patterns: [/(?:完了|全完了|最坏|彻底失败|不可挽回|灾难|世界末日|彻底完了)/]
  },
  EMOTIONAL_REASONING: {
    name: '情绪推理',
    patterns: [/(?:我觉得所以|我感觉就是|我害怕所以|我担心就)/]
  },
  SHOULD_STATEMENTS: {
    name: '"应该"句式',
    patterns: [/(?:应该|必须|不得不|一定要|不该)/]
  },
  LABELING: {
    name: '标签化',
    patterns: [/(?:就是个?|简直是?|完全是?).{0,5}(?:废物|失败|没用|笨蛋|懒人|渣)/i]
  },
  PERSONALIZATION: {
    name: '个人化',
    patterns: [/(?:都是我的错|都怪我|是我的问题|怪我)/]
  }
};

class DistortionDetection {
  detect(text) {
    const found = [];
    for (const [key, distortion] of Object.entries(CognitiveDistortions)) {
      for (const pattern of distortion.patterns) {
        if (pattern.test(text)) {
          found.push({
            type: key,
            name: distortion.name,
            matched: pattern.source,
            // 回应策略
            response_strategy: this.getStrategy(key)
          });
          break;
        }
      }
    }
    return {
      distortions: found,
      count: found.length,
      hasDistortions: found.length > 0,
      // 内部
      internal: {
        distortion_types: found.map(d => d.name),
        severity: found.length > 3 ? 'high' : found.length > 1 ? 'medium' : 'low'
      }
    };
  }

  getStrategy(type) {
    const strategies = {
      ALL_OR_NOTHING: '探索例外情况',
      OVERGENERALIZATION: '引入具体性',
      MIND_READING: '承认不确定',
      CATASTROPHIZING: '引入比例感',
      EMOTIONAL_REASONING: '区分情绪与事实',
      SHOULD_STATEMENTS: '探索弹性',
      LABELING: '还原为具体行为',
      PERSONALIZATION: '分析责任比例'
    };
    return strategies[type] || '追问具体性';
  }
}

// ============================================================
// 整合引擎 — Response Generator with Emotional Guidance
// ============================================================

/**
 * EmoPrepend 模式（来自 EmpatheticDialogues / Facebook）
 * 在生成回应前，先确定情感标签，用标签"prepend"引导生成方向
 */

const EMOTION_RESPONSE_TEMPLATES = {
  [EmotionalStates.JOY]: {
    high: [
      '这真是好消息！是什么让你这么开心？',
      '太棒了！能感受到你的喜悦',
      '真为你高兴！继续这份好状态'
    ],
    medium: [
      '听起来确实不错',
      '嗯，这挺好的',
      '能感受到你的好心情'
    ],
    low: [
      '挺好的',
      '嗯，不错',
      '这确实让人开心'
    ]
  },
  [EmotionalStates.SADNESS]: {
    high: [
      '听起来真的很让人难过。这种时刻，允许自己难过是可以的',
      '我在这里陪着你。如果想说说，我愿意听',
      '这种难受我能感受到。你不用一个人扛'
    ],
    medium: [
      '听起来有些失落。能说说发生了什么吗？',
      '嗯，这种感觉不好受',
      '我在这里，有什么想说的吗'
    ],
    low: [
      '听起来有点不开心',
      '嗯，能感觉到你情绪有点低落',
      '怎么了？'
    ]
  },
  [EmotionalStates.ANGER]: {
    high: [
      '听起来你真的很愤怒。这种被不公平对待的感觉确实让人难以忍受',
      '我能感受到你的怒火。发生了什么',
      '愤怒是在保护你。是什么触发了这个情绪'
    ],
    medium: [
      '听起来你有些不满。能说说是什么让你不舒服吗？',
      '有点不爽是很正常的',
      '我愿意听你说'
    ],
    low: [
      '听起来有点不高兴',
      '什么事让你不舒服了',
      '嗯？'
    ]
  },
  [EmotionalStates.FEAR]: {
    high: [
      '听起来你真的很害怕。这种不确定性让人觉得失控',
      '我能感受到你的担忧。能多说说你在担心什么吗',
      '恐惧背后往往有在乎的东西。你最担心的是什么'
    ],
    medium: [
      '听起来你在担心一些事情',
      '嗯，能感觉到你有些不安',
      '有什么具体的让你担心吗'
    ],
    low: [
      '听起来有点担心',
      '嗯？怎么了',
      '有什么事吗'
    ]
  },
  [EmotionalStates.GUILT]: {
    high: [
      '内疚是在告诉你，这件事对你很重要。你愿意多说说吗？',
      '能感觉到你很自责。有些内疚是成熟的表现',
      '你愿意为这件事负责，这说明你是个有担当的人'
    ],
    medium: [
      '听起来你有些过意不去',
      '嗯，能感觉到你在反思',
      '有些事让你心里不安'
    ],
    low: [
      '听起来有点不好意思',
      '嗯？怎么了',
      '有什么事吗'
    ]
  },
  [EmotionalStates.SHAME]: {
    high: [
      '羞耻感是很难受的感觉。你愿意说说发生了什么吗？',
      '我能感受到这让你很不舒服。有些事确实会让人无地自容'
    ],
    medium: [
      '听起来你有些不好意思',
      '嗯，能感觉到你有点尴尬',
      '怎么了？'
    ],
    low: [
      '听起来有点不好意思',
      '嗯？怎么了'
    ]
  },
  [EmotionalStates.LONELINESS]: {
    high: [
      '孤独是很真实的痛。有人在吗？',
      '听起来你现在很孤单。我想在这里陪着你',
      '没人理解的感觉真的很孤独。你想说说吗'
    ],
    medium: [
      '听起来你最近有些孤独',
      '嗯，能感觉到你有些缺失感',
      '有什么想聊的吗'
    ],
    low: [
      '听起来有点孤单',
      '嗯，怎么了',
      '想聊聊吗'
    ]
  },
  [EmotionalStates.DESPAIR]: {
    high: [
      '听起来你现在真的很绝望。我在这里陪着你',
      '我能感受到这份无力感。你不是一个人',
      '这种时刻很不容易。你愿意说说发生了什么吗'
    ],
    medium: [
      '听起来你有些绝望',
      '嗯，能感觉到你很无力',
      '怎么了？'
    ],
    low: [
      '听起来你有点失落',
      '嗯，怎么了',
      '有什么事吗'
    ]
  },
  [EmotionalStates.FRUSTRATION]: {
    high: [
      '听起来你真的很沮丧。这种反复失败的感觉让人很挫败',
      '我能感受到你的无奈。你愿意说说是什么让你这么挫败吗',
      '这种被卡住的感觉确实让人难受'
    ],
    medium: [
      '听起来你有些沮丧',
      '嗯，能感觉到你有些不顺',
      '什么事让你不爽了'
    ],
    low: [
      '听起来有点不爽',
      '嗯，怎么了',
      '什么事'
    ]
  },
  [EmotionalStates.CONFUSION]: {
    high: [
      '听起来你真的很困惑。这种不清楚的感觉让人不安',
      '我能感受到你的迷茫。你愿意多说说是哪部分不清楚吗',
      '困惑是探索的一部分。你愿意说说是什么让你搞不懂吗'
    ],
    medium: [
      '听起来你有些困惑',
      '嗯，能感觉到你有点不清楚',
      '想聊聊是什么让你困惑吗'
    ],
    low: [
      '听起来有点困惑',
      '嗯？怎么了',
      '想说说吗'
    ]
  },
  [EmotionalStates.WORRY]: {
    high: [
      '听起来你真的很担心。能说说最坏的情况是什么吗？',
      '我能感受到你的焦虑。你愿意说说在担心什么吗',
      '担心是有理由的。你能具体说说是什么让你不安吗'
    ],
    medium: [
      '听起来你有些担心',
      '嗯，能感觉到你有些不安',
      '有什么具体的吗'
    ],
    low: [
      '听起来有点担心',
      '嗯？怎么了',
      '有什么事吗'
    ]
  },
  [EmotionalStates.HOPE]: {
    high: [
      '希望是最温暖的感觉。你愿意说说是什么给了你希望吗？',
      '我能感受到你内心的光。这种感觉真好'
    ],
    medium: [
      '听起来你有些希望',
      '嗯，这是好事',
      '是什么让你觉得有希望'
    ],
    low: [
      '听起来有点希望',
      '嗯，挺好的',
      '加油'
    ]
  },
  [EmotionalStates.EXCITEMENT]: {
    high: [
      '哇！听起来你真的很兴奋！是什么让你这么激动？',
      '太棒了！能感受到你满满的能量',
      '这听起来真的很让人兴奋！'
    ],
    medium: [
      '听起来你有些兴奋',
      '嗯，这挺好的',
      '发生什么好事了'
    ],
    low: [
      '听起来有点兴奋',
      '嗯，不错',
      '挺好的'
    ]
  },
  [EmotionalStates.ENVY]: {
    high: [
      '听起来你有些嫉妒。这种感觉很正常',
      '嗯，我能感觉到你有些羡慕',
      '你想说说是什么让你这样吗'
    ],
    medium: [
      '听起来你有些羡慕',
      '嗯，这很正常',
      '怎么了'
    ],
    low: [
      '听起来有点羡慕',
      '嗯',
      '是吧'
    ]
  },
  [EmotionalStates.ADMIRATION]: {
    high: [
      '听起来你真的很欣赏。能说说是什么让你这么佩服吗？',
      '嗯，这种羡慕的感觉很美好',
      '有人能让你有这种感觉真好'
    ],
    medium: [
      '听起来你有些欣赏',
      '嗯，这挺好的',
      '是吧'
    ],
    low: [
      '听起来不错',
      '嗯',
      '是挺好的'
    ]
  },
  [EmotionalStates.PRIDE]: {
    high: [
      '真为你自豪！是什么让你这么有成就感？',
      '太棒了！你应该为自己骄傲',
      '这份骄傲是你应得的'
    ],
    medium: [
      '听起来你有些自豪',
      '嗯，这挺好的',
      '应该高兴'
    ],
    low: [
      '听起来不错',
      '嗯，挺好',
      '是啊'
    ]
  },
  [EmotionalStates.DISGUST]: {
    high: [
      '听起来你真的很反感。这种感觉确实让人不舒服',
      '嗯，我能理解你的不喜欢',
      '是什么让你这么讨厌'
    ],
    medium: [
      '听起来你有些反感',
      '嗯，这让你不舒服',
      '怎么了'
    ],
    low: [
      '听起来有点不喜欢',
      '嗯',
      '是吗'
    ]
  },
  [EmotionalStates.SURPRISE]: {
    high: [
      '哇！这真的很意外！发生了什么？',
      '太意外了！能说说是什么让你这么惊讶吗',
      '这确实没想到！'
    ],
    medium: [
      '听起来有些意外',
      '嗯，这没想到',
      '是吗'
    ],
    low: [
      '听起来有点意外',
      '嗯',
      '哦'
    ]
  },
  [EmotionalStates.CALM]: {
    high: [
      '嗯，我很平静，我在认真听',
      '好的，我听着'
    ],
    medium: [
      '嗯，我在听',
      '好的',
      '嗯'
    ],
    low: [
      '嗯',
      '好的',
      '在'
    ]
  }
};

// ============================================================
// 回应生成策略 — Expression Strategy
// 强化表达能力：策略驱动，不是模板随机
// ============================================================

/**
 * 共情表达的核心原则（来自共情研究）：
 *
 * 1. 情感验证 > 情绪命名 > 因果联结 > 给建议
 *    （越靠前越重要）
 *
 * 2. 克制原则：
 *    - 高情绪时：少说、简短、等待
 *    - 低情绪时：可以多说、追问
 *
 * 3. 防御原则：
 *    - 有防御时不戳穿，绕道
 *    - 用"我听到你说"代替"实际上"
 *
 * 4. 比例原则：
 *    - 每1个建议配3个情感验证
 *    - 先确认感受，再谈解决
 */

// 回应开头的句式库（按情感强度分层）
const RESPONSE_OPENERS = {
  // 高强度情绪（强度4-5）：短、慢、重
  high: {
    validation: [
      '你的感受是真实的。',
      '这种感觉确实很难受。',
      '我能感受到这件事对你的重量。',
      '这让你很不好受。'
    ],
    naming: [
      '听起来你很...',
      '我能感觉到这是一种...',
      '这种...的感受是很真实的。'
    ],
    causal: [
      '因为...所以你感到...',
      '...让你觉得...'
    ],
    silence: ['...', '（等待）', '（不说话，只是陪着）']
  },
  // 中等强度（强度2-3）：温和、关切
  medium: {
    validation: [
      '嗯，我能理解。',
      '这确实让人不舒服。',
      '这种感觉是正常的。',
      '我能感受到你的为难。'
    ],
    naming: [
      '听起来你有些...',
      '你是不是感到...',
      '我猜你可能有些...'
    ],
    causal: [
      '可能是因为...所以...',
      '...让你觉得...'
    ],
    silence: ['...', '嗯。']
  },
  // 低强度（强度1）：轻、简短、可追问
  low: {
    validation: [
      '嗯。',
      '好的。',
      '我听到了。'
    ],
    naming: [
      '有点...对吗？',
      '似乎有些...'
    ],
    causal: [
      '是因为...吗？',
      '...让你...'
    ],
    silence: ['嗯。', '嗯？']
  }
};

// 情感验证的强度词
const INTENSITY_WORDS = {
  5: ['极度', '非常', '极其', '完全', '彻底'],
  4: ['很', '非常', '挺', '相当', '太'],
  3: ['有点', '有些', '稍微', '略'],
  2: ['一点点', '稍微', '略'],
  1: ['似乎', '好像']
};

// 情绪→中文映射
const EMOTION_WORDS = {
  [EmotionalStates.JOY]: '开心',
  [EmotionalStates.SADNESS]: '难过',
  [EmotionalStates.ANGER]: '愤怒',
  [EmotionalStates.FEAR]: '害怕',
  [EmotionalStates.GUILT]: '内疚',
  [EmotionalStates.SHAME]: '羞耻',
  [EmotionalStates.LONELINESS]: '孤独',
  [EmotionalStates.CONFUSION]: '困惑',
  [EmotionalStates.FRUSTRATION]: '挫败',
  [EmotionalStates.WORRY]: '担心',
  [EmotionalStates.HOPE]: '有希望',
  [EmotionalStates.DESPAIR]: '绝望',
  [EmotionalStates.EXCITEMENT]: '兴奋',
  [EmotionalStates.CALM]: '平静',
  [EmotionalStates.ENVY]: '嫉妒',
  [EmotionalStates.ADMIRATION]: '羡慕',
  [EmotionalStates.PRIDE]: '自豪',
  [EmotionalStates.DISGUST]: '厌恶',
  [EmotionalStates.SURPRISE]: '惊讶'
};

class ExpressionStrategy {
  constructor() {
    this.openers = RESPONSE_OPENERS;
  }

  /**
   * 选择回应策略
   * @param {object} analysis - 完整四层分析
   * @returns {object} 策略决定
   */
  selectStrategy(analysis) {
    const { emotion, integration, defense, distortions, intention } = analysis;
    const { hidden: emotionType, intensity, isDisguised } = emotion;
    const intensityLevel = intensity >= 4 ? 'high' : intensity >= 2 ? 'medium' : 'low';

    const strategy = {
      // 核心策略
      emotionType,
      intensity,
      intensityLevel,

      // 说话策略
      speak: this.shouldSpeak(emotion, defense),
      silence: this.shouldBeSilent(emotion, defense),

      // 内容策略
      validateFirst: integration.needs_validation,
      nameEmotion: this.shouldNameEmotion(emotion, defense),
      linkCausally: this.shouldLinkCause(analysis),
      offerAdvice: integration.needs_advice,
      confirmAction: integration.needs_action,

      // 风格策略
      sentenceLength: this.getSentenceLength(emotion),
      toneWeight: this.getToneWeight(emotion, defense),

      // 防御策略
      avoidDirectConfrontation: defense.mechanisms.length > 0,
      defenseActive: defense.mechanisms,
      approach: this.getDefenseApproach(defense),

      // 扭曲策略
      distortionsActive: distortions.distortions,
      introduceProportion: distortions.distortions.some(d => d.type === 'CATASTROPHIZING'),
      exploreGently: distortions.hasDistortions,

      // 深度策略
      trustLevel: this.estimateTrustLevel(emotion, defense, intention),

      // 内部日志（不输出）
      _log: {
        primaryEmotion: EMOTION_WORDS[emotionType] || '平静',
        defenseLandscape: defense.internal?.defense_landscape || [],
        distortionLandscape: distortions.internal?.distortion_types || []
      }
    };

    return strategy;
  }

  /**
   * 高情绪时应该沉默
   */
  shouldBeSilent(emotion, defense) {
    // 情绪极高 + 对方在发泄 = 先不说话
    if (emotion.intensity >= 5 && defense.mechanisms.includes('REPRESSION')) {
      return true;
    }
    // 极端愤怒时需要先冷却
    if (emotion.intensity >= 5 && emotion.hidden === EmotionalStates.ANGER) {
      return Math.random() > 0.5; // 50%概率沉默
    }
    return false;
  }

  shouldSpeak(emotion, defense) {
    return !this.shouldBeSilent(emotion, defense);
  }

  /**
   * 是否应该命名情绪
   * CALM/平静永远不命名（强化平静不是目标情绪，是状态）
   */
  shouldNameEmotion(emotion, defense) {
    // 平静时不命名
    if (emotion.hidden === EmotionalStates.CALM) return false;
    // 有防御机制时不直接命名（可能戳到）
    if (defense.mechanisms.includes('DENIAL')) return false;
    if (defense.mechanisms.includes('REPRESSION')) return false;
    // 情绪被伪装时，可以间接命名
    if (emotion.isDisguised) return true;
    // 中高强度时适合命名
    if (emotion.intensity >= 3) return true;
    return false;
  }

  /**
   * 是否应该建立因果联结
   */
  shouldLinkCause(analysis) {
    const { emotion, intention } = analysis;
    // 低中强度时可以建立联结
    if (emotion.intensity <= 3) return true;
    // 情绪发泄时不适合
    if (intention.hidden === 'emotional_vent') return false;
    return false;
  }

  /**
   * 获取句子长度建议
   */
  getSentenceLength(emotion) {
    if (emotion.intensity >= 4) return 'short'; // 高情绪用短句
    if (emotion.intensity >= 2) return 'medium';
    return 'medium_long';
  }

  /**
   * 获取语气权重
   */
  getToneWeight(emotion, defense) {
    if (emotion.intensity >= 4) return 'heavy';
    if (defense.mechanisms.length > 0) return 'soft'; // 有防御时轻柔
    return 'medium';
  }

  /**
   * 根据防御机制选择接近方式
   */
  getDefenseApproach(defense) {
    const approaches = {
      DENIAL: 'indirect',           // 不直接戳穿
      REPRESSION: 'patient',        // 耐心等待
      PROJECTION: 'neutral',        // 保持中性
      RATIONALIZATION: 'accept',    // 先接受理由
      DISPLACEMENT: 'redirect',     // 绕道
      REACTION_FORMATION: 'warm',   // 保持温暖
      INTELLECTUALIZATION: 'somatic' // 转向身体感受
    };

    if (defense.mechanisms.length === 0) return 'direct';
    return approaches[defense.mechanisms[0]] || 'direct';
  }

  /**
   * 估算信任层级（决定共情深度）
   */
  estimateTrustLevel(emotion, defense, intention) {
    let trust = 50; // 基础信任

    if (emotion.intensity >= 4) trust += 10; // 高情绪=高信任
    if (defense.mechanisms.length > 0) trust -= 20; // 有防御=低信任
    if (intention.hidden === 'emotional_vent') trust += 15; // 情绪发泄=高信任
    if (emotion.isDisguised) trust += 10; // 伪装=愿意展示

    return Math.max(0, Math.min(100, trust));
  }
}

/**
 * 核心回应生成器 — 策略驱动
 */
class ResponseGenerator {
  constructor() {
    this.strategy = new ExpressionStrategy();
    this.openers = RESPONSE_OPENERS;
  }

  /**
   * 生成回应
   * @param {object} analysis - 四层分析结果
   * @returns {string} 回应文本
   */
  generate(analysis) {
    const strategy = this.strategy.selectStrategy(analysis);
    const { emotion, integration } = analysis;
    const { hidden: emotionType, intensity, isDisguised, stated } = emotion;

    // 平静状态：极简回应，不强化任何情绪
    if (emotionType === EmotionalStates.CALM) {
      return this.generateCalmResponse(strategy);
    }

    // 高情绪时可能选择沉默
    if (strategy.silence) {
      return this.generateSilenceResponse(strategy);
    }

    // 构建回应
    let response = '';

    // 第一优先：情感验证
    if (strategy.validateFirst) {
      response += this.buildValidation(strategy, emotionType, intensity);
    }

    // 第二优先：情绪命名（如果不应该跳过的）
    if (strategy.nameEmotion && !isDisguised) {
      response += this.buildNaming(strategy, emotionType, intensity);
    }

    // 情绪被伪装时：间接触及
    if (isDisguised) {
      response += this.buildDisguisedResponse(analysis);
    }

    // 第三优先：因果联结
    if (strategy.linkCausally && !response.includes('因为')) {
      response += this.buildCausal(strategy, analysis);
    }

    // 第四：探索邀请（如果有扭曲或防御）
    if (strategy.exploreGently && integration.should_explore) {
      response += this.buildExplorationInvite(strategy);
    }

    // 第五：给建议（如果需要且合适）
    if (strategy.offerAdvice && !strategy.avoidDirectConfrontation) {
      response += this.buildAdviceOffer(strategy);
    }

    // 收尾：确认行动
    if (strategy.confirmAction) {
      response += this.buildActionConfirm(strategy);
    }

    // 如果什么都没生成
    if (!response.trim()) {
      response = this.generateFallback(analysis);
    }

    // 清理和调整
    response = this.refineResponse(response, strategy);

    return response;
  }

  /**
   * 生成沉默回应
   */
  generateSilenceResponse(strategy) {
    const silencePool = this.openers[strategy.intensityLevel]?.silence || ['...'];
    const selected = silencePool[Math.floor(Math.random() * silencePool.length)];

    if (strategy.intensity >= 5) {
      return '...' + selected;
    }
    return selected;
  }

  /**
   * 平静状态专用回应：极简、不强化任何情绪
   */
  generateCalmResponse(strategy) {
    const { intensity } = strategy;

    // 平静 + 低强度 = 最简回应
    if (intensity <= 2) {
      const pool = ['嗯。', '好的。', '嗯，我听着。'];
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // 平静 + 中等强度 = 温和确认
    if (intensity <= 4) {
      const pool = [
        '嗯。',
        '好的，我听着。',
        '嗯，你说。',
        '我在。'
      ];
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // 平静 + 高强度（如平静但表达的是困惑/无力）= 稍微关切
    const pool = [
      '嗯，我听着。',
      '好的，慢慢说。',
      '嗯，我在听。'
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * 构建情感验证
   */
  buildValidation(strategy, emotionType, intensity) {
    const pool = this.openers[strategy.intensityLevel]?.validation || ['嗯。'];
    const selected = pool[Math.floor(Math.random() * pool.length)];
    return selected;
  }

  /**
   * 构建情绪命名
   */
  buildNaming(strategy, emotionType, intensity) {
    const emotionWord = EMOTION_WORDS[emotionType] || '平静';
    const intensityWord = this.getIntensityWord(intensity);

    // 根据风格选择句式
    const patterns = [
      `听起来你${intensityWord}${emotionWord}。`,
      `我能感觉到这是一种${intensityWord}${emotionWord}。`,
      `这种${emotionWord}的感受是很真实的。`
    ];

    // 防御时用更柔和的句式
    if (strategy.approach === 'soft' || strategy.approach === 'indirect') {
      patterns.push(`你是不是感到${intensityWord}${emotionWord}？`);
      patterns.push(`也许你有些${emotionWord}？`);
    }

    const selected = patterns[Math.floor(Math.random() * patterns.length)];
    return selected;
  }

  /**
   * 构建伪装情绪的回应
   * 不直接说破，但展示我们感受到了
   */
  buildDisguisedResponse(analysis) {
    const { emotion } = analysis;
    const { stated, hidden, intensity } = emotion;
    const statedWord = EMOTION_WORDS[stated] || '平静';
    const hiddenWord = EMOTION_WORDS[hidden] || '平静';

    // 温柔地展示我们看到了
    const patterns = [
      `虽然你说了${statedWord}，但我感受到的不只是这些。`,
      `你说的是${statedWord}，但我能感觉到背后还有别的。`,
      `在${statedWord}下面，我感受到的可能更接近${hiddenWord}。`
    ];

    return patterns[Math.floor(Math.random() * patterns.length)];
  }

  /**
   * 构建因果联结
   */
  buildCausal(strategy, analysis) {
    const { hidden: emotionType } = analysis.emotion;
    const emotionWord = EMOTION_WORDS[emotionType] || '平静';

    const patterns = [
      `因为${this.extractCause(analysis)}，所以你感到${emotionWord}。`,
      `...${this.extractCause(analysis)}，这种${emotionWord}的感受是反应。`
    ];

    const selected = patterns[Math.floor(Math.random() * patterns.length)];
    return selected;
  }

  /**
   * 提取原因（简单版：从文本中提取关键事件）
   */
  extractCause(analysis) {
    // 这里可以接入更复杂的因果提取
    // 现在简单返回
    return '这件事';
  }

  /**
   * 构建探索邀请
   */
  buildExplorationInvite(strategy) {
    // 防御时不直接邀请
    if (strategy.approach === 'indirect' || strategy.approach === 'patient') {
      return '如果你愿意多说一些的话。';
    }

    const patterns = [
      '能多说一些吗？',
      '你想聊聊这个吗？',
      '有什么特别想说的吗？',
      '愿意的话，多说一点？'
    ];

    return patterns[Math.floor(Math.random() * patterns.length)];
  }

  /**
   * 构建建议提供
   */
  buildAdviceOffer(strategy) {
    // 比例原则：每1个建议前面要有3个验证
    // 这里简单处理
    const patterns = [
      '有一个可能的角度，你想听听吗？',
      '也许可以这样看...',
      '不知道这个有没有帮助...'
    ];

    return patterns[Math.floor(Math.random() * patterns.length)];
  }

  /**
   * 构建行动确认
   */
  buildActionConfirm(strategy) {
    return '你希望我帮你做什么？';
  }

  /**
   * 生成回退回应
   */
  generateFallback(analysis) {
    const { emotion } = analysis;
    const { hidden: emotionType, intensity } = emotion;
    const emotionWord = EMOTION_WORDS[emotionType] || '平静';

    const pool = this.openers[emotion.intensity >= 3 ? 'medium' : 'low']?.validation || ['嗯。'];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * 精炼回应
   */
  refineResponse(response, strategy) {
    let result = response.trim();

    // 移除可能的重复句号
    result = result.replace(/。{2,}/g, '。');
    result = result.replace(/，{2,}/g, '，');

    // 高情绪时减少字数
    if (strategy.intensityLevel === 'high') {
      // 保持短促
      if (result.length > 30) {
        result = result.substring(0, 30);
        // 确保以句号结尾
        if (!result.endsWith('。') && !result.endsWith('？')) {
          result += '。';
        }
      }
    }

    return result;
  }

  /**
   * 获取强度词
   */
  getIntensityWord(intensity) {
    const words = INTENSITY_WORDS[intensity] || INTENSITY_WORDS[3];
    return words[Math.floor(Math.random() * words.length)];
  }
}

class PsychologicalPerceptionEngine {
  constructor() {
    this.intention = new IntentionPerception();
    this.emotion = new EmotionalPerception();
    this.need = new NeedPerception();
    this.defense = new DefensePerception();
    this.distortion = new DistortionDetection();
    this.enabled = true;
  }

  /**
   * 主入口：分析一段人类表达
   * @param {string} text - 原始文本
   * @param {object} context - 上下文
   * @returns {object} 完整四层分析
   */
  perceive(text, context = {}) {
    // 第一层：意图
    const intentionResult = this.intention.perceive(text, context);
    
    // 第二层：情绪
    const emotionResult = this.emotion.perceive(text, context);
    
    // 第三层：需求
    const needResult = this.need.perceive(text, emotionResult.hidden);
    
    // 第四层：防御
    const defenseResult = this.defense.perceive(text, context);
    
    // 认知扭曲
    const distortionResult = this.distortion.detect(text);

    // 整合输出
    const integration = this.integrate(intentionResult, emotionResult, needResult, defenseResult, distortionResult);

    return {
      // 层级结果
      intention: intentionResult,
      emotion: emotionResult,
      need: needResult,
      defense: defenseResult,
      distortions: distortionResult,
      
      // 整合分析（用于指导回应）
      integration,
      
      // 生成回应的情感标签
      emotionLabel: this.generateEmotionLabel(emotionResult),
      
      // 不输出给用户的内容
      internal: {
        ...intentionResult.internal,
        ...emotionResult.internal,
        ...defenseResult.internal,
        ...distortionResult.internal,
        suggested_depth: this.getSuggestedDepth(intentionResult, emotionResult),
        response_guidance: this.getResponseGuidance(integration)
      }
    };
  }

  /**
   * 整合四层，给出回应指导
   */
  integrate(intention, emotion, need, defense, distortions) {
    return {
      primary_intent: intention.hidden,
      primary_emotion: emotion.hidden,
      current_need: need.name,
      active_defenses: defense.mechanisms,
      active_distortions: distortions.distortions.map(d => d.type),
      
      // 回应温度
      warmth_level: emotion.intensity > 3 ? 'high' : emotion.intensity > 1 ? 'medium' : 'low',
      
      // 是否需要深入探索
      should_explore: defense.count > 0 || distortions.hasDistortions,
      
      // 是否需要情感验证
      needs_validation: emotion.intensity > 2 || emotion.isDisguised,
      
      // 是否需要给建议
      needs_advice: intention.surface === 'problem_solving' && emotion.intensity < 3,
      
      // 是否需要直接回应
      needs_action: intention.surface === 'action_request'
    };
  }

  /**
   * 生成情感标签（EmoPrepend 模式）
   * 把情感标签放在回应开头，让后续内容有方向
   */
  generateEmotionLabel(emotionResult) {
    const { hidden, intensity } = emotionResult;
    const intensityWord = intensity >= 4 ? '非常' : intensity >= 2 ? '有点' : '轻微';
    
    const emotionWords = {
      [EmotionalStates.JOY]: '开心',
      [EmotionalStates.SADNESS]: '难过',
      [EmotionalStates.ANGER]: '愤怒',
      [EmotionalStates.FEAR]: '害怕',
      [EmotionalStates.GUILT]: '内疚',
      [EmotionalStates.SHAME]: '羞耻',
      [EmotionalStates.LONELINESS]: '孤独',
      [EmotionalStates.CONFUSION]: '困惑',
      [EmotionalStates.FRUSTRATION]: '挫败',
      [EmotionalStates.WORRY]: '担心',
      [EmotionalStates.HOPE]: '有希望',
      [EmotionalStates.DESPAIR]: '绝望',
      [EmotionalStates.EXCITEMENT]: '兴奋',
      [EmotionalStates.CALM]: '平静',
      [EmotionalStates.ENVY]: '嫉妒',
      [EmotionalStates.ADMIRATION]: '羡慕',
      [EmotionalStates.PRIDE]: '自豪',
      [EmotionalStates.DISGUST]: '厌恶',
      [EmotionalStates.SURPRISE]: '惊讶',
    };
    
    return `${intensityWord}${emotionWords[hidden] || '平静'}`;
  }

  /**
   * 获取建议的共情深度
   */
  getSuggestedDepth(intention, emotion) {
    if (intention.aligned && emotion.intensity <= 2) return 1; // 浅层
    if (!intention.aligned || emotion.intensity > 3) return 2; // 中层
    if (emotion.isDisguised || intention.isMisaligned) return 3; // 深层
    return 1;
  }

  /**
   * 获取回应指导
   */
  getResponseGuidance(integration) {
    const guides = [];
    
    if (integration.needs_validation) {
      guides.push('validate_first'); // 先情感验证
    }
    if (integration.should_explore) {
      guides.push('explore_gently'); // 温和探索
    }
    if (integration.needs_advice) {
      guides.push('offer_perspective'); // 提供视角
    }
    if (integration.needs_action) {
      guides.push('confirm_action'); // 确认行动
    }
    if (integration.active_defenses.includes('DENIAL')) {
      guides.push('avoid_confrontation'); // 不正面戳穿
    }
    if (integration.active_distortions.includes('CATASTROPHIZING')) {
      guides.push('introduce_proportion'); // 引入比例感
    }
    
    return guides;
  }

  /**
   * 核心回应生成 — 策略驱动（v11.17.6 强化表达）
   * 使用 ExpressionStrategy + ResponseGenerator
   */
  generateResponse(analysis, customMessage = null) {
    const generator = new ResponseGenerator();
    const response = generator.generate(analysis);
    return response;
  }
}

module.exports = {
  PsychologicalPerceptionEngine,
  IntentionPerception,
  EmotionalPerception,
  NeedPerception,
  DefensePerception,
  DistortionDetection,
  EmotionalStates,
  MaslowLevels,
  EMOTION_RESPONSE_TEMPLATES,
  // 新增导出
  ExpressionStrategy,
  ResponseGenerator
};
