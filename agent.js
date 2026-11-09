(() => {
  'use strict';

  const PREFERENCES_KEY = 'hustmap-agent-preferences-v1';
  const FEEDBACK_KEY = 'hustmap-agent-feedback-v1';
  const TASTES = [
    { id: 'spicy', label: '香辣过瘾', icon: '🌶' },
    { id: 'light', label: '清淡少油', icon: '◌' },
    { id: 'savory', label: '咸香下饭', icon: '◒' },
    { id: 'sourSweet', label: '酸甜开胃', icon: '◐' },
    { id: 'soup', label: '鲜汤暖胃', icon: '◡' },
    { id: 'sweet', label: '甜品饮料', icon: '◇' },
  ];
  const GOALS = [
    { id: 'filling', label: '吃饱正餐', icon: '碗' },
    { id: 'healthy', label: '健康轻负担', icon: '叶' },
    { id: 'quick', label: '赶时间快吃', icon: '闪' },
    { id: 'comfort', label: '热乎治愈', icon: '暖' },
  ];
  const AVOIDS = [
    { id: 'spicy', label: '不吃辣' },
    { id: 'pork', label: '不吃猪肉' },
    { id: 'beef', label: '不吃牛肉' },
    { id: 'seafood', label: '海鲜过敏' },
    { id: 'cilantro', label: '不吃香菜' },
    { id: 'greasy', label: '尽量少油' },
  ];
  const BUDGETS = [
    { value: 10, label: '¥10 内', hint: '极简' },
    { value: 15, label: '¥15 内', hint: '日常' },
    { value: 20, label: '¥20 内', hint: '改善' },
    { value: 30, label: '¥30 内', hint: '丰富' },
    { value: 0, label: '不限', hint: '自由' },
  ];
  const AREAS = [
    { id: 'all', label: '不限区域' },
    { id: 'east', label: '东区' },
    { id: 'central', label: '中区' },
    { id: 'west', label: '西区' },
    { id: 'out', label: '校外' },
    { id: 'takeout', label: '外卖' },
  ];
  const AREA_LABELS = Object.fromEntries(AREAS.map(area => [area.id, area.label]));
  const TASTE_LABELS = Object.fromEntries(TASTES.map(taste => [taste.id, taste.label]));
  const GOAL_LABELS = Object.fromEntries(GOALS.map(goal => [goal.id, goal.label]));
  const DEFAULT_PREFERENCES = {
    meal: 'lunch',
    tastes: ['savory'],
    goals: ['filling'],
    budget: 15,
    area: 'all',
    avoids: [],
    allergies: '',
  };

  const state = {
    ready: false,
    preferences: loadPreferences(),
    feedback: loadFeedback(),
    results: [],
    eligibleCount: 0,
    catalogCount: 0,
    batchSeed: Date.now(),
    retryTimer: null,
    renderTimer: null,
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character]);
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('个性化推荐数据保存失败。', error);
      showToast('浏览器存储空间不足，偏好可能无法保留');
    }
  }

  function loadPreferences() {
    const saved = readJson(PREFERENCES_KEY, null);
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_PREFERENCES };
    return {
      meal: ['lunch', 'dinner'].includes(saved.meal) ? saved.meal : DEFAULT_PREFERENCES.meal,
      tastes: Array.isArray(saved.tastes) ? saved.tastes.filter(id => TASTE_LABELS[id]) : [],
      goals: Array.isArray(saved.goals) ? saved.goals.filter(id => GOAL_LABELS[id]).slice(0, 1) : ['filling'],
      budget: BUDGETS.some(item => item.value === Number(saved.budget)) ? Number(saved.budget) : DEFAULT_PREFERENCES.budget,
      area: AREA_LABELS[saved.area] ? saved.area : 'all',
      avoids: Array.isArray(saved.avoids) ? saved.avoids.filter(id => AVOIDS.some(item => item.id === id)) : [],
      allergies: typeof saved.allergies === 'string' ? saved.allergies.slice(0, 80) : '',
    };
  }

  function loadFeedback() {
    const saved = readJson(FEEDBACK_KEY, {});
    return {
      chosen: new Set(Array.isArray(saved.chosen) ? saved.chosen : []),
      excluded: new Set(Array.isArray(saved.excluded) ? saved.excluded : []),
    };
  }

  function persistFeedback() {
    writeJson(FEEDBACK_KEY, {
      chosen: [...state.feedback.chosen],
      excluded: [...state.feedback.excluded],
    });
  }

  function currentPlaces() {
    try {
      return window.getHustPlaces?.() || [];
    } catch {
      return [];
    }
  }

  function currentUser() {
    try {
      const info = JSON.parse(localStorage.getItem('hustmap-user-info') || 'null');
      return localStorage.getItem('hustmap-user-token') && info ? info : null;
    } catch {
      return null;
    }
  }

  function safeRating(value) {
    const rating = Number(value);
    return Number.isFinite(rating) && rating > 0 ? rating : 3;
  }

  function dishText(dish) {
    return [
      dish.name,
      dish.note,
      dish.shop,
      Array.isArray(dish.tags) ? dish.tags.join(' ') : '',
    ].filter(Boolean).join(' ');
  }

  function classifyDish(dish) {
    const text = dishText(dish);
    return {
      spicy: /辣|椒|麻|香锅|冒菜|烧烤|串串|火锅|剁椒|酸辣|麻辣/.test(text),
      light: /清淡|清蒸|白灼|轻食|沙拉|少油|爽口|清淡|清汤|不加辣|不辣/.test(text),
      savory: /卤|酱|咸香|下饭|红烧|焖|炒|爆|香煎|烤肉|干拌/.test(text),
      sourSweet: /糖醋|酸甜|菠萝|番茄|茄汁|咕噜|酸梅|山楂/.test(text),
      soup: /汤|粥|米线|粉|馄饨|抄手|砂锅|煲/.test(text),
      sweet: /甜|奶茶|果茶|果汁|蛋糕|面包|布丁|豆花|冰|糖|饼/.test(text),
      meat: /肉|鸡|牛|猪|羊|鸭|鱼|虾|排骨|骨|腊味|香肠/.test(text),
      veggie: /菜|豆|菌|蔬|素|藕|土豆|番茄|茄子|西兰花|青菜|豆腐/.test(text),
      filling: /饭|面|粉|米线|饺|馄饨|抄手|锅|套餐|盖浇/.test(text),
      quick: /包|饼|饭团|三明治|馄饨|抄手|小吃|快餐|凉皮|早餐/.test(text),
      comfort: /热|汤|粥|锅|面|煲|暖|炖|热乎/.test(text),
      pork: /猪|回锅肉|排骨|叉烧|猪蹄|肉末|肉丝|培根|火腿/.test(text),
      beef: /牛|肥牛|牛肉|牛腩|牛排|牛骨/.test(text),
      seafood: /鱼|虾|蟹|海鲜|贝|鱿鱼|墨鱼|花甲|蛤|海参/.test(text),
      cilantro: /香菜|芫荽/.test(text),
      greasy: /重油|偏油|油多|油腻|炸|酥皮|油泼/.test(text),
    };
  }

  function estimatedBasePrice(dish, traits) {
    let amount = 12;
    if (traits.filling) amount = 13;
    if (/面|米线|粉/.test(dish.name)) amount = 12;
    if (/饭|盖饭|炒饭|煲仔/.test(dish.name)) amount = 14;
    if (/饺|馄饨|抄手/.test(dish.name)) amount = 11;
    if (traits.soup && !traits.filling) amount = 10;
    if (traits.sweet) amount = 9;
    if (traits.quick) amount = Math.min(amount, 9);
    if (traits.meat && !traits.filling) amount += 3;
    if (dish.placeType === 'shop') amount += 4;
    if (dish.placeType === 'food_court') amount += 7;
    if (['out', 'takeout'].includes(dish.campusArea)) amount += 4;
    return Math.max(4, amount);
  }

  function priceFor(dish, traits) {
    const rawPrice = Number(dish.price);
    if (Number.isFinite(rawPrice) && rawPrice > 0) {
      return {
        amount: rawPrice,
        label: `¥${formatPrice(rawPrice)}`,
        estimated: false,
      };
    }

    const text = [dish.note, dish.sourceLabel].filter(Boolean).join(' ');
    if (!/元\s*\/\s*两|元每两/.test(text)) {
      const range = text.match(/(\d+(?:\.\d+)?)\s*[-~—–至]\s*(\d+(?:\.\d+)?)\s*元/);
      if (range) {
        const low = Number(range[1]);
        const high = Number(range[2]);
        if (Number.isFinite(low) && Number.isFinite(high) && high > 0 && high < 100) {
          return {
            amount: high,
            label: `¥${formatPrice(low)}–${formatPrice(high)}`,
            estimated: false,
          };
        }
      }
      const single = text.match(/(?:人均|约|大概)?\s*(\d+(?:\.\d+)?)\s*元/);
      if (single) {
        const amount = Number(single[1]);
        if (Number.isFinite(amount) && amount > 0 && amount < 100) {
          return {
            amount,
            label: `¥${formatPrice(amount)}`,
            estimated: false,
          };
        }
      }
    }

    const amount = estimatedBasePrice(dish, traits);
    return {
      amount,
      label: `约 ¥${formatPrice(amount)}`,
      estimated: true,
    };
  }

  function formatPrice(value) {
    return Number.isInteger(value) ? String(value) : Number(value).toFixed(1).replace(/\.0$/, '');
  }

  function buildCatalog(places) {
    const catalog = [];
    for (const place of places) {
      for (const dish of place.recommendations || []) {
        if (!dish?.name) continue;
        const traits = classifyDish(dish);
        catalog.push({
          id: dish.id || `${place.id}-${dish.name}`,
          dishId: dish.id || '',
          placeId: place.id,
          placeName: place.name,
          placeType: place.placeType || '',
          campusArea: place.campusArea || '',
          floor: dish.floor ?? null,
          shop: dish.shop || '',
          name: dish.name,
          note: dish.note || '',
          mealPeriod: dish.mealPeriod || '',
          rating: safeRating(dish.rating),
          ratingCount: Number(dish.ratingCount) || 0,
          tags: Array.isArray(dish.tags) ? dish.tags : [],
          traits,
          price: priceFor({ ...dish, placeType: place.placeType, campusArea: place.campusArea }, traits),
        });
      }
    }
    return catalog;
  }

  function allergyTokens(value) {
    return String(value || '')
      .split(/[,，、;；\s]+/)
      .map(token => token.trim())
      .filter(token => token.length >= 1)
      .slice(0, 8);
  }

  function isAvoided(dish, preferences) {
    const text = dishText(dish);
    if (preferences.avoids.includes('spicy') && dish.traits.spicy) return true;
    if (preferences.avoids.includes('pork') && dish.traits.pork) return true;
    if (preferences.avoids.includes('beef') && dish.traits.beef) return true;
    if (preferences.avoids.includes('seafood') && dish.traits.seafood) return true;
    if (preferences.avoids.includes('cilantro') && dish.traits.cilantro) return true;
    return allergyTokens(preferences.allergies).some(token => text.includes(token));
  }

  function hashNumber(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
  }

  function scoreDish(dish, preferences, seed) {
    if (isAvoided(dish, preferences) || state.feedback.excluded.has(dish.id)) return null;
    const maxBudget = Number(preferences.budget) || 0;
    if (maxBudget && !dish.price.estimated && dish.price.amount > maxBudget) return null;
    if (maxBudget && dish.price.estimated && dish.price.amount > maxBudget + 5) return null;

    let score = 32;
    const reasons = [];
    const tasteMatches = preferences.tastes.filter(id => dish.traits[id]);
    if (tasteMatches.length) {
      score += 9 * tasteMatches.length;
      reasons.push(`口味贴合：${tasteMatches.map(id => TASTE_LABELS[id]).join('、')}`);
    } else if (!preferences.tastes.length) {
      score += 2;
      reasons.push('口味不设限，优先参考预算与口碑');
    } else {
      score -= 6;
    }

    const goal = preferences.goals[0];
    if (goal === 'filling' && dish.traits.filling) {
      score += 13;
      reasons.push('分量与主食结构更适合作为正餐');
    } else if (goal === 'healthy' && (dish.traits.light || dish.traits.veggie)) {
      score += 12;
      reasons.push('口味清爽，蔬菜或清淡菜品线索更明显');
    } else if (goal === 'quick' && dish.traits.quick) {
      score += 13;
      reasons.push('出餐和食用节奏更适合赶时间');
    } else if (goal === 'comfort' && dish.traits.comfort) {
      score += 12;
      reasons.push('热乎、汤面或炖煮类更有治愈感');
    }

    if (maxBudget) {
      if (dish.price.amount <= maxBudget) {
        score += 14;
        reasons.push(`${dish.price.estimated ? '智能估算' : '菜单标注'}${dish.price.label}，在 ¥${maxBudget} 预算内`);
      } else {
        score -= 10;
        reasons.push(`${dish.price.estimated ? '预估约' : '标注'}${dish.price.label}，可能略高于预算`);
      }
    } else {
      score += 4;
      reasons.push('预算不限，优先考虑口味与匹配度');
    }

    if (preferences.area !== 'all') {
      if (dish.campusArea === preferences.area) {
        score += 10;
        reasons.push(`位于你选择的${AREA_LABELS[preferences.area]}`);
      } else {
        score -= 10;
      }
    }

    if (dish.mealPeriod && !['both', 'all_day'].includes(dish.mealPeriod) && dish.mealPeriod !== preferences.meal) {
      score -= 8;
    } else if (dish.mealPeriod === preferences.meal) {
      score += 3;
    }

    score += Math.max(-4, Math.min(7, (dish.rating - 3.2) * 6));
    if (dish.rating >= 4) reasons.push(`社区评分 ${dish.rating.toFixed(1)}，口碑表现靠前`);
    if (preferences.avoids.includes('greasy') && dish.traits.greasy) score -= 14;
    if (state.feedback.chosen.has(dish.id)) score += 3;
    score += hashNumber(`${dish.id}-${seed}`) % 10;

    return {
      ...dish,
      score: Math.max(1, Math.min(99, Math.round(score))),
      reasons: [...new Set(reasons)].slice(0, 3),
      meta: [
        dish.placeName,
        dish.floor ? `${dish.floor} 楼` : '',
        dish.shop && dish.shop !== dish.placeName ? dish.shop : '',
      ].filter(Boolean).join(' · '),
    };
  }

  function recommend(preferences, places) {
    const catalog = buildCatalog(places);
    state.catalogCount = catalog.length;
    const scored = catalog
      .map(dish => scoreDish(dish, preferences, state.batchSeed))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.rating - a.rating);
    state.eligibleCount = scored.length;

    const results = [];
    const placeCounts = new Map();
    for (const dish of scored) {
      const placeCount = placeCounts.get(dish.placeId) || 0;
      if (placeCount >= 2 && results.length < 3) continue;
      results.push(dish);
      placeCounts.set(dish.placeId, placeCount + 1);
      if (results.length === 3) break;
    }
    if (results.length < 3) {
      for (const dish of scored) {
        if (results.some(item => item.id === dish.id)) continue;
        results.push(dish);
        if (results.length === 3) break;
      }
    }
    return results;
  }

  function preferenceSummary(preferences) {
    const tastes = preferences.tastes.length
      ? preferences.tastes.map(id => TASTE_LABELS[id]).join('、')
      : '口味不限';
    const goal = GOAL_LABELS[preferences.goals[0]] || '均衡搭配';
    const budget = Number(preferences.budget) ? `¥${preferences.budget} 内` : '预算不限';
    const area = AREA_LABELS[preferences.area] || '不限区域';
    return { tastes, goal, budget, area };
  }

  function narrativeMarkup(preferences) {
    const summary = preferenceSummary(preferences);
    const user = currentUser();
    const avoidText = preferences.avoids.length
      ? `同时避开 ${preferences.avoids.map(id => AVOIDS.find(item => item.id === id)?.label).filter(Boolean).join('、')}${preferences.allergies ? `及“${escapeHtml(preferences.allergies)}”` : ''}。`
      : preferences.allergies
        ? `同时避开你填写的过敏原“${escapeHtml(preferences.allergies)}”。`
        : '';
    const recommendationText = state.results.length
      ? `优先推荐 <strong>${escapeHtml(state.results[0].placeName)}</strong> 的 <strong>${escapeHtml(state.results[0].name)}</strong>，另外准备了两份不同地点的备选。`
      : '当前条件下没有找到合适菜品，可以适当放宽预算或区域。';
    return `
      <div class="agent-response-top">
        <span class="agent-status-dot" aria-hidden="true"></span>
        <b>智能体已完成本轮分析</b>
        <span>${user ? `为 ${escapeHtml(user.nickname || user.username || '同学')} 生成` : '本地个性化 · 无需登录'}</span>
      </div>
      <p>我读取了 <strong>${state.catalogCount}</strong> 道校园菜品，以“${escapeHtml(summary.tastes)}、${escapeHtml(summary.goal)}、${escapeHtml(summary.budget)}、${escapeHtml(summary.area)}”为条件，筛出 <strong>${state.eligibleCount}</strong> 个候选。${avoidText}${recommendationText}</p>
    `;
  }

  function pageMarkup() {
    return `
      <div class="agent-shell">
        <section class="agent-hero" aria-labelledby="agent-title">
          <div class="agent-hero-copy">
            <span class="agent-kicker">PERSONAL TASTE AGENT</span>
            <h1 id="agent-title">懂你口味，也懂你的<span>预算。</span></h1>
            <p>告诉智能体今天想吃什么、能花多少、有哪些忌口，它会从校园美食图谱中生成适合你的食堂和菜品，并说明每一条推荐理由。</p>
            <div class="agent-hero-tags">
              <span>口味画像</span>
              <span>预算控制</span>
              <span>忌口避雷</span>
              <span>地点匹配</span>
            </div>
          </div>
          <div class="agent-hero-visual" aria-hidden="true">
            <div class="agent-orbit">
              <span class="agent-orbit-ring ring-one"></span>
              <span class="agent-orbit-ring ring-two"></span>
              <span class="agent-orbit-ring ring-three"></span>
              <span class="agent-core">
                <svg viewBox="0 0 48 48"><path d="M15 10h18v7a9 9 0 0 1-9 9 9 9 0 0 1-9-9Z"></path><path d="M15 13H9v3a7 7 0 0 0 7 7M33 13h6v3a7 7 0 0 1-7 7M24 26v8M18 39h12M20 34h8"></path><path d="M4 6h6M38 6h6M7 2v8M41 2v8"></path></svg>
              </span>
              <span class="agent-orbit-label label-one">口味偏好</span>
              <span class="agent-orbit-label label-two">价格要求</span>
              <span class="agent-orbit-label label-three">过敏忌口</span>
              <span class="agent-orbit-label label-four">食堂位置</span>
            </div>
          </div>
        </section>

        <div class="agent-layout">
          <aside class="agent-preferences" aria-labelledby="agent-preferences-title">
            <div class="agent-panel-head">
              <h2 id="agent-preferences-title">告诉我你的偏好</h2>
              <span>PREFERENCES</span>
            </div>
            <form class="agent-form" id="agent-preferences-form">
              <section class="agent-step">
                <div class="agent-step-label"><span class="agent-step-index">01</span>今天哪一餐<small>MEAL</small></div>
                <div class="agent-chip-group">
                  <button class="agent-chip" type="button" data-agent-meal="lunch">午餐</button>
                  <button class="agent-chip" type="button" data-agent-meal="dinner">晚餐</button>
                </div>
              </section>

              <section class="agent-step">
                <div class="agent-step-label"><span class="agent-step-index">02</span>喜欢的口味<small>可多选</small></div>
                <div class="agent-chip-group">
                  ${TASTES.map(taste => `<button class="agent-chip" type="button" data-agent-taste="${taste.id}">${taste.icon} ${taste.label}</button>`).join('')}
                </div>
              </section>

              <section class="agent-step">
                <div class="agent-step-label"><span class="agent-step-index">03</span>这一餐的目标<small>单选</small></div>
                <div class="agent-goal-grid">
                  ${GOALS.map(goal => `<button class="agent-goal" type="button" data-agent-goal="${goal.id}"><b>${goal.icon}</b><span>${goal.label}</span></button>`).join('')}
                </div>
              </section>

              <section class="agent-step">
                <div class="agent-step-label"><span class="agent-step-index">04</span>单餐预算<small>PRICE</small></div>
                <div class="agent-budget-grid">
                  ${BUDGETS.map(budget => `<button class="agent-budget" type="button" data-agent-budget="${budget.value}"><b>${budget.value ? `¥${budget.value}` : '不限'}</b>${budget.hint}</button>`).join('')}
                </div>
              </section>

              <section class="agent-step">
                <div class="agent-step-label"><span class="agent-step-index">05</span>想去哪里吃<small>AREA</small></div>
                <select class="agent-select" id="agent-area" aria-label="选择用餐区域">
                  ${AREAS.map(area => `<option value="${area.id}">${area.label}</option>`).join('')}
                </select>
              </section>

              <section class="agent-step">
                <div class="agent-step-label"><span class="agent-step-index">06</span>忌口与过敏<small>可多选</small></div>
                <div class="agent-chip-group">
                  ${AVOIDS.map(avoid => `<button class="agent-chip" type="button" data-agent-avoid="${avoid.id}">${avoid.label}</button>`).join('')}
                </div>
                <label class="agent-allergy">
                  <input id="agent-allergies" maxlength="80" placeholder="其他过敏原，用逗号分隔" aria-label="其他过敏原">
                </label>
              </section>

              <div class="agent-form-footer">
                <button class="agent-generate" type="submit">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Z"></path><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"></path></svg>
                  生成我的专属推荐
                </button>
                <button class="agent-reset" id="agent-reset" type="button">恢复默认偏好</button>
              </div>
            </form>
          </aside>

          <main class="agent-content">
            <section class="agent-response" id="agent-response" aria-live="polite">
              <div class="agent-response-top">
                <span class="agent-status-dot" aria-hidden="true"></span>
                <b>智能体正在读取你的口味</b>
                <span>LOCAL AGENT</span>
              </div>
              <p>填写左侧偏好后，我会结合菜品名称、备注、评分、餐次和地点完成匹配。</p>
            </section>

            <div class="agent-results-head">
              <div>
                <h2>为你生成的今日菜单</h2>
                <p id="agent-result-subtitle">口味、预算与忌口综合排序</p>
              </div>
              <button class="agent-round-button" id="agent-shuffle" type="button">换一批 →</button>
            </div>
            <div class="agent-result-list" id="agent-results" aria-live="polite">
              <div class="agent-loading">
                <span class="agent-loading-line"></span>
                <span class="agent-loading-line"></span>
                <span class="agent-loading-line"></span>
                <p>正在读取校园美食图谱…</p>
              </div>
            </div>
            <div class="agent-insight-strip" id="agent-insights"></div>
          </main>
        </div>
      </div>
    `;
  }

  function syncForm() {
    const preferences = state.preferences;
    document.querySelectorAll('[data-agent-meal]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.agentMeal === preferences.meal));
    });
    document.querySelectorAll('[data-agent-taste]').forEach(button => {
      button.setAttribute('aria-pressed', String(preferences.tastes.includes(button.dataset.agentTaste)));
    });
    document.querySelectorAll('[data-agent-goal]').forEach(button => {
      button.setAttribute('aria-pressed', String(preferences.goals.includes(button.dataset.agentGoal)));
    });
    document.querySelectorAll('[data-agent-budget]').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.agentBudget) === preferences.budget));
    });
    document.querySelectorAll('[data-agent-avoid]').forEach(button => {
      button.setAttribute('aria-pressed', String(preferences.avoids.includes(button.dataset.agentAvoid)));
    });
    const area = document.getElementById('agent-area');
    if (area) area.value = preferences.area;
    const allergies = document.getElementById('agent-allergies');
    if (allergies) allergies.value = preferences.allergies;
  }

  function collectPreferences() {
    const pressed = selector => [...document.querySelectorAll(`${selector}[aria-pressed="true"]`)];
    return {
      meal: pressed('[data-agent-meal]')[0]?.dataset.agentMeal || 'lunch',
      tastes: pressed('[data-agent-taste]').map(button => button.dataset.agentTaste),
      goals: pressed('[data-agent-goal]').slice(0, 1).map(button => button.dataset.agentGoal),
      budget: Number(pressed('[data-agent-budget]')[0]?.dataset.agentBudget ?? 15),
      area: document.getElementById('agent-area')?.value || 'all',
      avoids: pressed('[data-agent-avoid]').map(button => button.dataset.agentAvoid),
      allergies: document.getElementById('agent-allergies')?.value.trim() || '',
    };
  }

  function showLoading(message = '正在理解你的口味与预算…') {
    const results = document.getElementById('agent-results');
    if (!results) return;
    results.innerHTML = `
      <div class="agent-loading">
        <span class="agent-loading-line"></span>
        <span class="agent-loading-line"></span>
        <span class="agent-loading-line"></span>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  function renderResults(animate = false) {
    clearTimeout(state.renderTimer);
    const places = currentPlaces();
    if (!places.length) {
      state.results = [];
      showWaitingForData();
      return;
    }

    const run = () => {
      state.results = recommend(state.preferences, places);
      const response = document.getElementById('agent-response');
      if (response) response.innerHTML = narrativeMarkup(state.preferences);
      renderResultCards();
    };

    if (animate) {
      showLoading();
      state.renderTimer = setTimeout(run, 520);
    } else {
      run();
    }
  }

  function renderResultCards() {
    const host = document.getElementById('agent-results');
    const subtitle = document.getElementById('agent-result-subtitle');
    const insights = document.getElementById('agent-insights');
    if (!host) return;

    if (!state.results.length) {
      host.innerHTML = `
        <div class="agent-empty">
          <span class="agent-empty-icon" aria-hidden="true">⌁</span>
          <h3>暂时没有完全匹配的菜品</h3>
          <p>可以适当提高预算、扩大区域，或取消一项忌口后重新生成。</p>
        </div>
      `;
    } else {
      host.innerHTML = state.results.map((dish, index) => resultMarkup(dish, index)).join('');
    }

    if (subtitle) {
      subtitle.textContent = state.results.length
        ? `从 ${state.eligibleCount} 个候选菜品中综合排序`
        : '尝试调整左侧偏好后重新生成';
    }
    if (insights) {
      const summary = preferenceSummary(state.preferences);
      insights.innerHTML = `
        <div class="agent-insight"><b>${state.catalogCount}</b><span>已分析菜品</span></div>
        <div class="agent-insight"><b>${escapeHtml(summary.budget)}</b><span>当前预算范围</span></div>
        <div class="agent-insight"><b>${state.preferences.avoids.length + (state.preferences.allergies ? 1 : 0)}</b><span>已启用避雷项</span></div>
      `;
    }
  }

  function resultMarkup(dish, index) {
    const chosen = state.feedback.chosen.has(dish.id);
    return `
      <article class="agent-pick${index === 0 ? ' featured' : ''}">
        <div class="agent-pick-main">
          <div class="agent-pick-kicker">
            <span class="agent-pick-rank">0${index + 1}</span>
            <span class="agent-pick-place">${escapeHtml(dish.meta)}</span>
            <span class="agent-pick-category">${escapeHtml(index === 0 ? '最佳匹配' : index === 1 ? '口味备选' : '距离/预算备选')}</span>
          </div>
          <h3>${escapeHtml(dish.name)}</h3>
          <div class="agent-pick-sub">
            <span class="agent-price">${escapeHtml(dish.price.label)}${dish.price.estimated ? ' 预估' : ''}</span>
            <span>评分 ${dish.rating.toFixed(1)}</span>
            ${dish.mealPeriod ? `<span>${mealLabel(dish.mealPeriod)}</span>` : ''}
            ${dish.shop ? `<span>${escapeHtml(dish.shop)}</span>` : ''}
          </div>
          <div class="agent-reasons">
            ${dish.reasons.map(reason => `<div class="agent-reason">${escapeHtml(reason)}</div>`).join('')}
          </div>
          ${dish.note ? `<div class="agent-caution">口碑线索：${escapeHtml(shorten(dish.note, 74))}</div>` : ''}
        </div>
        <div class="agent-pick-side">
          <div class="agent-score" style="--score:${dish.score}%" aria-label="综合匹配度 ${dish.score}%">
            <span>${dish.score}<small>匹配度</small></span>
          </div>
          <div class="agent-pick-actions">
            <button class="agent-result-button primary" type="button" data-agent-choose="${escapeHtml(dish.id)}" data-chosen="${chosen}">${chosen ? '已加入菜单' : '就吃这个'}</button>
            <button class="agent-result-button" type="button" data-agent-dislike="${escapeHtml(dish.id)}">不想吃</button>
            <button class="agent-place-link" type="button" data-agent-place="${escapeHtml(dish.placeId)}">查看地点详情</button>
          </div>
        </div>
      </article>
    `;
  }

  function shorten(value, maxLength) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  }

  function mealLabel(value) {
    return ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐', both: '午晚餐', all_day: '全天' })[value] || '';
  }

  function showWaitingForData() {
    const results = document.getElementById('agent-results');
    if (results) {
      results.innerHTML = `
        <div class="agent-loading">
          <span class="agent-loading-line"></span>
          <span class="agent-loading-line"></span>
          <span class="agent-loading-line"></span>
          <p>正在等待校园美食数据加载…</p>
        </div>
      `;
    }
    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(() => {
      if (currentPlaces().length) renderResults(false);
      else showWaitingForData();
    }, 800);
  }

  function runWithPreferences(animate = true) {
    state.preferences = collectPreferences();
    writeJson(PREFERENCES_KEY, state.preferences);
    state.batchSeed = Date.now();
    renderResults(animate);
  }

  function bindEvents() {
    document.querySelectorAll('[data-agent-meal]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-agent-meal]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      });
    });

    document.querySelectorAll('[data-agent-taste]').forEach(button => {
      button.addEventListener('click', () => {
        const pressedIds = [...document.querySelectorAll('[data-agent-taste][aria-pressed="true"]')];
        if (button.getAttribute('aria-pressed') !== 'true' && pressedIds.length >= 3) {
          showToast('最多选择 3 种口味，让匹配更精准');
          return;
        }
        button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      });
    });

    document.querySelectorAll('[data-agent-goal]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-agent-goal]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      });
    });

    document.querySelectorAll('[data-agent-budget]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-agent-budget]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      });
    });

    document.querySelectorAll('[data-agent-avoid]').forEach(button => {
      button.addEventListener('click', () => {
        button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      });
    });

    document.getElementById('agent-preferences-form')?.addEventListener('submit', event => {
      event.preventDefault();
      runWithPreferences(true);
    });

    document.getElementById('agent-reset')?.addEventListener('click', () => {
      state.preferences = { ...DEFAULT_PREFERENCES, tastes: [...DEFAULT_PREFERENCES.tastes], goals: [...DEFAULT_PREFERENCES.goals], avoids: [] };
      writeJson(PREFERENCES_KEY, state.preferences);
      syncForm();
      state.batchSeed = Date.now();
      renderResults(false);
      showToast('已恢复默认偏好');
    });

    document.getElementById('agent-shuffle')?.addEventListener('click', () => {
      state.batchSeed += 7919;
      renderResults(true);
    });

    document.getElementById('agent-results')?.addEventListener('click', event => {
      const choose = event.target.closest('[data-agent-choose]');
      const dislike = event.target.closest('[data-agent-dislike]');
      const place = event.target.closest('[data-agent-place]');
      if (choose) {
        const id = choose.dataset.agentChoose;
        if (state.feedback.chosen.has(id)) {
          state.feedback.chosen.delete(id);
          showToast('已从今日菜单移除');
        } else {
          state.feedback.chosen.add(id);
          showToast('已加入今日菜单，下次会优先考虑相似口味');
        }
        persistFeedback();
        renderResultCards();
      }
      if (dislike) {
        const id = dislike.dataset.agentDislike;
        state.feedback.excluded.add(id);
        persistFeedback();
        state.batchSeed += 1237;
        showToast('已记住这次反馈，正在换一个方向');
        renderResults(true);
      }
      if (place) {
        const placeId = place.dataset.agentPlace;
        if (typeof window.detail === 'function') window.detail(placeId, 'results');
      }
    });
  }

  function renderAgentPage() {
    const host = document.getElementById('agent');
    if (!host) return;
    if (!state.ready) {
      host.innerHTML = pageMarkup();
      state.ready = true;
      syncForm();
      bindEvents();
    }
    if (state.results.length) renderResultCards();
    else renderResults(false);
  }

  function showToast(message) {
    if (typeof window.toast === 'function') {
      window.toast(message);
      return;
    }
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2300);
  }

  window.renderAgentPage = renderAgentPage;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAgentPage, { once: true });
  } else {
    renderAgentPage();
  }

  window.addEventListener('hustmap:data-loaded', () => {
    clearTimeout(state.retryTimer);
    state.results = [];
    if (location.hash === '#agent') renderResults(false);
  });
})();
