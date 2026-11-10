(() => {
  'use strict';

  const STORAGE_KEY = 'hustmap-food-wheel-v1';
  const COLORS = [
    ['#c95841', '#fff8ef'],
    ['#e39a4b', '#fffaf2'],
    ['#5f8073', '#ffffff'],
    ['#d67f65', '#fffaf5'],
    ['#8c9b78', '#ffffff'],
    ['#c69757', '#fffdf7'],
    ['#476f76', '#ffffff'],
    ['#b76558', '#fffaf6'],
    ['#79956d', '#ffffff'],
    ['#d49a59', '#fffaf2'],
    ['#6c827f', '#ffffff'],
    ['#c86f4f', '#fffaf2'],
  ];
  const SIZES = [2, 4, 6, 8, 12];
  const MAX_ITEMS = 12;

  const state = {
    ready: false,
    mode: 'random',
    size: 6,
    canteens: new Set(),
    items: [],
    catalog: [],
    canteenList: [],
    query: '',
    rotation: 0,
    spinning: false,
    winner: null,
    retryTimer: null,
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

  function safeConfig() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function loadConfig() {
    const config = safeConfig();
    if (!config || typeof config !== 'object') return;
    if (['random', 'custom'].includes(config.mode)) state.mode = config.mode;
    if (SIZES.includes(Number(config.size))) state.size = Number(config.size);
    if (Array.isArray(config.canteens)) state.canteens = new Set(config.canteens.map(String));
    if (Array.isArray(config.items)) {
      state.items = config.items
        .filter(item => item && typeof item.name === 'string')
        .slice(0, MAX_ITEMS)
        .map(item => normalizeItem(item));
    }
  }

  function saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: state.mode,
        size: state.size,
        canteens: [...state.canteens],
        items: state.items,
      }));
    } catch {
      // The wheel still works if browser storage is unavailable.
    }
  }

  function currentPlaces() {
    try {
      return window.getHustPlaces?.() || [];
    } catch {
      return [];
    }
  }

  function normalizeItem(item) {
    return {
      key: String(item.key || item.id || `${item.placeId || 'custom'}:${item.name}`),
      id: item.id || '',
      name: String(item.name || '').trim(),
      placeId: item.placeId || '',
      placeName: item.placeName || '自定义食堂',
      shop: item.shop || '',
      floor: item.floor ?? null,
      note: item.note || '',
      rating: Number(item.rating) || 0,
      custom: Boolean(item.custom),
    };
  }

  function buildCatalog(places) {
    const catalog = [];
    const seen = new Set();
    for (const place of places.filter(item => item.placeType === 'canteen')) {
      for (const dish of place.recommendations || []) {
        if (!dish?.name) continue;
        const key = `${place.id}:${dish.id || dish.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        catalog.push(normalizeItem({
          key,
          id: dish.id || '',
          name: dish.name,
          placeId: place.id,
          placeName: place.name,
          shop: dish.shop || '',
          floor: dish.floor ?? null,
          note: dish.note || '',
          rating: dish.rating,
        }));
      }
    }
    return catalog;
  }

  function syncData() {
    const places = currentPlaces();
    state.canteenList = places
      .filter(place => place.placeType === 'canteen')
      .map(place => ({ id: place.id, name: place.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    state.catalog = buildCatalog(places);

    const validCanteenIds = new Set(state.canteenList.map(place => place.id));
    state.canteens = new Set([...state.canteens].filter(id => validCanteenIds.has(id)));
    if (state.items.some(item => item.placeId && !validCanteenIds.has(item.placeId))) {
      state.items = [];
    }
    if (!state.items.length && state.catalog.length) generateRandom({ silent: true });
    return places.length > 0;
  }

  function pageMarkup() {
    return `
      <div class="wheel-shell">
        <section class="wheel-hero" aria-labelledby="wheel-title">
          <div class="wheel-hero-copy">
            <span class="wheel-kicker">LUNCH DECISION ROULETTE</span>
            <h1 id="wheel-title">今天不纠结，<span>交给转盘。</span></h1>
            <p>自己挑选想吃的菜，或者把选择交给系统随机。还可以限定一个或多个食堂，让转盘只在你的目标范围内转动。</p>
            <div class="wheel-hero-tags">
              <span>自选菜单</span><span>系统随机</span><span>多食堂限定</span><span>2–12 个选项</span>
            </div>
          </div>
          <div class="wheel-hero-art" aria-hidden="true">
            <div class="wheel-hero-illustration"><span class="wheel-hero-pin"></span></div>
          </div>
        </section>

        <div class="wheel-layout">
          <aside class="wheel-config" aria-labelledby="wheel-config-title">
            <div class="wheel-panel-head"><h2 id="wheel-config-title">设置你的转盘</h2><span>WHEEL SETUP</span></div>
            <div class="wheel-config-body">
              <div class="wheel-mode-tabs" role="tablist" aria-label="转盘生成模式">
                <button type="button" role="tab" data-wheel-mode="random">系统随机</button>
                <button type="button" role="tab" data-wheel-mode="custom">自己挑选</button>
              </div>

              <section class="wheel-step">
                <div class="wheel-step-title"><i>1</i>限定食堂<small>可多选</small></div>
                <div class="wheel-canteens" id="wheel-canteens"></div>
              </section>

              <div class="wheel-random-pane" id="wheel-random-pane">
                <section class="wheel-step">
                  <div class="wheel-step-title"><i>2</i>转盘选项数量<small>2–12 项</small></div>
                  <div class="wheel-size-grid">
                    ${SIZES.map(size => `<button class="wheel-size" type="button" data-wheel-size="${size}">${size} 项</button>`).join('')}
                  </div>
                </section>
                <p class="wheel-random-copy" id="wheel-random-copy">系统会从当前食堂范围中随机抽取不重复菜品。</p>
                <button class="wheel-generate" id="wheel-generate" type="button">按条件生成随机转盘</button>
              </div>

              <div class="wheel-custom-pane" id="wheel-custom-pane" hidden>
                <section class="wheel-step">
                  <div class="wheel-step-title"><i>2</i>搜索想吃的菜<small>点击加入</small></div>
                  <input class="wheel-search" id="wheel-search" type="search" autocomplete="off" placeholder="搜索菜品、食堂或店铺">
                  <div class="wheel-search-results" id="wheel-search-results"></div>
                </section>
                <div class="wheel-custom-add">
                  <input class="wheel-custom-input" id="wheel-custom-name" maxlength="30" placeholder="没搜到？输入自定义美食">
                  <button type="button" id="wheel-custom-add">加入</button>
                </div>
              </div>

              <section class="wheel-step">
                <div class="wheel-selected-head">
                  <span>当前转盘 <b id="wheel-selected-count">0</b>/12</span>
                  <button type="button" id="wheel-clear-items">清空</button>
                </div>
                <div class="wheel-selected-list" id="wheel-selected-list"></div>
              </section>
            </div>
          </aside>

          <main class="wheel-stage-card">
            <div class="wheel-stage-head">
              <div><h2>命运转盘</h2><p id="wheel-stage-subtitle">系统随机 · 不限食堂</p></div>
              <span class="wheel-stage-badge" id="wheel-stage-badge">准备中</span>
            </div>
            <div class="wheel-stage">
              <div class="wheel-holder">
                <span class="wheel-pointer" aria-hidden="true"></span>
                <div class="wheel-rotor" id="wheel-rotor">
                  <svg class="wheel-svg" id="wheel-svg" viewBox="0 0 560 560" role="img" aria-label="美食转盘"></svg>
                </div>
                <button class="wheel-center-button" id="wheel-center-spin" type="button" aria-label="开始转动转盘">
                  <span><b>GO</b><span>开始转动</span></span>
                </button>
              </div>
              <div class="wheel-actions">
                <button class="wheel-spin" id="wheel-spin" type="button">开始转动，帮我决定</button>
                <button class="wheel-regenerate" id="wheel-regenerate" type="button">随机换一批</button>
              </div>
              <div class="wheel-result" id="wheel-result" aria-live="polite">
                <span class="wheel-empty-result">添加至少 2 道美食后，点击开始转动。</span>
              </div>
            </div>
            <div class="wheel-ticket">每一次选择都可以重来，今天先好好吃饭</div>
          </main>
        </div>
      </div>
    `;
  }

  function renderPage() {
    const host = document.getElementById('wheel');
    if (!host) return;
    if (!state.ready) {
      loadConfig();
      host.innerHTML = pageMarkup();
      state.ready = true;
      bindEvents();
      renderMode();
      renderCanteens();
      renderSearchResults();
      renderSelectedItems();
      drawWheel();
    }
    if (!syncData()) {
      scheduleDataRetry();
      return;
    }
    renderCanteens();
    renderMode();
    renderSearchResults();
    renderSelectedItems();
    drawWheel();
    saveConfig();
  }

  function scheduleDataRetry() {
    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(() => {
      if (location.hash !== '#wheel') return;
      if (syncData()) renderPage();
      else scheduleDataRetry();
    }, 700);
  }

  function selectedCanteenNames() {
    return state.canteenList
      .filter(place => state.canteens.has(place.id))
      .map(place => place.name);
  }

  function renderCanteens() {
    const host = document.getElementById('wheel-canteens');
    if (!host) return;
    host.innerHTML = `
      <button class="wheel-canteen" type="button" data-wheel-canteen="all" aria-pressed="${state.canteens.size === 0}">全部食堂</button>
      ${state.canteenList.map(place => `
        <button class="wheel-canteen" type="button" data-wheel-canteen="${escapeHtml(place.id)}" aria-pressed="${state.canteens.has(place.id)}">${escapeHtml(place.name)}</button>
      `).join('')}
    `;
    const copy = document.getElementById('wheel-random-copy');
    if (copy) {
      const names = selectedCanteenNames();
      copy.textContent = names.length
        ? `只会从 ${names.join('、')} 中抽取不重复菜品。`
        : '系统会从全部食堂中随机抽取不重复菜品。';
    }
  }

  function renderMode() {
    document.querySelectorAll('[data-wheel-mode]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.wheelMode === state.mode));
    });
    const randomPane = document.getElementById('wheel-random-pane');
    const customPane = document.getElementById('wheel-custom-pane');
    if (randomPane) randomPane.hidden = state.mode !== 'random';
    if (customPane) customPane.hidden = state.mode !== 'custom';
    document.querySelectorAll('[data-wheel-size]').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.wheelSize) === state.size));
    });
    const regenerate = document.getElementById('wheel-regenerate');
    if (regenerate) regenerate.textContent = state.mode === 'random' ? '随机换一批' : '随机补满';
  }

  function candidateItems() {
    const canteens = state.canteens;
    return state.catalog.filter(item => !canteens.size || canteens.has(item.placeId));
  }

  function shuffle(values) {
    const copy = [...values];
    for (let index = copy.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
  }

  function generateRandom({ silent = false } = {}) {
    if (state.spinning) return;
    const candidates = candidateItems();
    if (candidates.length < 2) {
      state.items = [];
      state.winner = null;
      drawWheel();
      renderSelectedItems();
      renderResult();
      if (!silent) showToast('当前食堂范围内至少需要 2 道菜');
      return;
    }
    const count = Math.min(state.size, candidates.length, MAX_ITEMS);
    state.items = shuffle(candidates).slice(0, count);
    state.winner = null;
    state.rotation = 0;
    const rotor = document.getElementById('wheel-rotor');
    if (rotor) {
      rotor.classList.remove('spinning');
      rotor.style.transform = 'rotate(0deg)';
    }
    renderSelectedItems();
    drawWheel();
    renderResult();
    saveConfig();
    if (!silent && count < state.size) showToast(`候选菜品不足，已生成 ${count} 项转盘`);
  }

  function fillCustomRandom() {
    if (state.spinning) return;
    const currentKeys = new Set(state.items.map(item => item.key));
    const candidates = candidateItems().filter(item => !currentKeys.has(item.key));
    const needed = Math.min(MAX_ITEMS, state.size) - state.items.length;
    if (!candidates.length) {
      showToast('当前食堂范围已经没有更多菜品');
      return;
    }
    state.items.push(...shuffle(candidates).slice(0, Math.max(0, needed)));
    state.winner = null;
    renderSelectedItems();
    drawWheel();
    renderResult();
    saveConfig();
    showToast('已随机补满转盘');
  }

  function renderSearchResults() {
    const host = document.getElementById('wheel-search-results');
    if (!host) return;
    const query = state.query.trim().toLowerCase();
    const selected = new Set(state.items.map(item => item.key));
    const pool = candidateItems()
      .filter(item => !selected.has(item.key))
      .filter(item => {
        if (!query) return true;
        return [item.name, item.placeName, item.shop].join(' ').toLowerCase().includes(query);
      })
      .sort((a, b) => {
        if (query) return b.rating - a.rating;
        return b.rating - a.rating;
      })
      .slice(0, 8);
    host.innerHTML = pool.length ? pool.map(item => `
      <div class="wheel-search-result">
        <div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.placeName)}${item.floor ? ` · ${item.floor}F` : ''}${item.shop ? ` · ${escapeHtml(item.shop)}` : ''}</small></div>
        <button class="wheel-chip-button" type="button" data-wheel-add="${escapeHtml(item.key)}">加入</button>
      </div>
    `).join('') : '<div class="wheel-random-copy">没有更多符合条件的菜品，可以直接添加自定义美食。</div>';
  }

  function renderSelectedItems() {
    const host = document.getElementById('wheel-selected-list');
    const count = document.getElementById('wheel-selected-count');
    if (!host) return;
    if (count) count.textContent = state.items.length;
    host.innerHTML = state.items.length ? state.items.map(item => `
      <span class="wheel-selected-item" data-wheel-item-place="${escapeHtml(item.placeId || '')}" data-wheel-item-key="${escapeHtml(item.key)}">
        <span>${escapeHtml(item.name)}</span>
        <button type="button" data-wheel-remove="${escapeHtml(item.key)}" aria-label="从转盘移除 ${escapeHtml(item.name)}">×</button>
      </span>
    `).join('') : '<span class="small">还没有选择美食</span>';
  }

  function shorten(value, maxLength) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  }

  function polar(cx, cy, radius, angle) {
    const radians = angle * Math.PI / 180;
    return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
  }

  function sectorPath(cx, cy, radius, start, end) {
    const first = polar(cx, cy, radius, start);
    const second = polar(cx, cy, radius, end);
    const largeArc = end - start > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${first.x.toFixed(3)} ${first.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${second.x.toFixed(3)} ${second.y.toFixed(3)} Z`;
  }

  function drawWheel() {
    const svg = document.getElementById('wheel-svg');
    if (!svg) return;
    const items = state.items;
    if (items.length < 2) {
      svg.innerHTML = `
        <circle cx="280" cy="280" r="263" fill="#f6eee4"></circle>
        <circle cx="280" cy="280" r="230" fill="none" stroke="#dfcabd" stroke-dasharray="12 10"></circle>
        <text x="280" y="435" text-anchor="middle" fill="#a99183" font-size="18" font-family="PingFang SC, Microsoft YaHei">至少添加 2 道美食</text>
      `;
      updateStageState();
      return;
    }
    const radius = 274;
    const angle = 360 / items.length;
    let sectors = '';
    items.forEach((item, index) => {
      const start = -90 + index * angle;
      const end = start + angle;
      const center = start + angle / 2;
      const color = COLORS[index % COLORS.length];
      const labelRadius = items.length <= 2 ? 158 : (angle < 35 ? 190 : 174);
      const point = polar(280, 280, labelRadius, center);
      const label = shorten(item.name, angle < 32 ? 6 : (angle < 50 ? 9 : 13));
      const place = shorten(item.placeName, angle < 35 ? 5 : 10);
      sectors += `
        <path class="wheel-sector" d="${sectorPath(280, 280, radius, start, end)}" fill="${color[0]}"></path>
        <text class="wheel-sector-label" x="${point.x.toFixed(2)}" y="${point.y.toFixed(2)}" fill="${color[1]}" font-size="${angle < 30 ? 13 : angle < 45 ? 15 : 17}" transform="rotate(${center + 90} ${point.x.toFixed(2)} ${point.y.toFixed(2)})">
          <tspan x="${point.x.toFixed(2)}" dy="${angle < 35 ? 4 : 0}">${escapeHtml(label)}</tspan>
          ${angle >= 35 ? `<tspan class="wheel-sector-place" x="${point.x.toFixed(2)}" dy="16">${escapeHtml(place)}</tspan>` : ''}
        </text>
      `;
    });
    svg.innerHTML = sectors;
    updateStageState();
  }

  function updateStageState() {
    const subtitle = document.getElementById('wheel-stage-subtitle');
    const badge = document.getElementById('wheel-stage-badge');
    const spin = document.getElementById('wheel-spin');
    const center = document.getElementById('wheel-center-spin');
    const names = selectedCanteenNames();
    if (subtitle) {
      subtitle.textContent = `${state.mode === 'random' ? '系统随机' : '自选菜单'} · ${names.length ? names.join('、') : '不限食堂'}`;
    }
    if (badge) badge.textContent = `${state.items.length} 个选项`;
    if (spin) {
      spin.disabled = state.spinning || state.items.length < 2;
      spin.textContent = state.spinning ? '转盘正在旋转…' : '开始转动，帮我决定';
    }
    if (center) center.disabled = state.spinning || state.items.length < 2;
  }

  function renderResult() {
    const host = document.getElementById('wheel-result');
    if (!host) return;
    if (state.spinning) {
      host.innerHTML = '<span class="wheel-spinning-note">转盘正在旋转，看看今天会停在哪里…</span>';
      return;
    }
    if (!state.winner) {
      host.innerHTML = state.items.length >= 2
        ? '<span class="wheel-empty-result">转盘已准备好，点击开始转动。</span>'
        : '<span class="wheel-empty-result">添加至少 2 道美食后，点击开始转动。</span>';
      return;
    }
    const winner = state.winner;
    host.classList.remove('wheel-toast-fade');
    void host.offsetWidth;
    host.classList.add('wheel-toast-fade');
    host.innerHTML = `
      <div>
        <span class="wheel-result-label">TODAY'S PICK · 命运选中</span>
        <h3>${escapeHtml(winner.name)}</h3>
        <p>${escapeHtml([winner.placeName, winner.floor ? `${winner.floor} 楼` : '', winner.shop].filter(Boolean).join(' · '))}</p>
      </div>
      <div class="wheel-result-place">${winner.placeId ? `<button class="wheel-chip-button" type="button" data-wheel-detail="${escapeHtml(winner.placeId)}">查看地点</button>` : '自定义美食'}</div>
    `;
  }

  function spinWheel() {
    if (state.spinning || state.items.length < 2) return;
    state.spinning = true;
    state.winner = null;
    const targetIndex = Math.floor(Math.random() * state.items.length);
    const angle = 360 / state.items.length;
    const centerAngle = -90 + (targetIndex + 0.5) * angle;
    const normalized = ((state.rotation % 360) + 360) % 360;
    const desired = (((-90 - centerAngle) % 360) + 360) % 360;
    const alignment = ((desired - normalized) % 360 + 360) % 360;
    const turns = 5 + Math.floor(Math.random() * 3);
    state.rotation += turns * 360 + alignment;
    const rotor = document.getElementById('wheel-rotor');
    rotor.classList.add('spinning');
    rotor.style.transform = `rotate(${state.rotation}deg)`;
    updateStageState();
    renderResult();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      state.spinning = false;
      state.winner = state.items[targetIndex];
      updateStageState();
      renderResult();
      showToast(`今天就吃：${state.winner.name}`);
    }, reducedMotion ? 180 : 4950);
  }

  function addCatalogItem(key) {
    if (state.spinning) return;
    if (state.items.length >= MAX_ITEMS) return showToast('转盘最多放 12 道美食');
    const item = state.catalog.find(candidate => candidate.key === key);
    if (!item) return;
    if (state.items.some(candidate => candidate.key === item.key)) return showToast('这道菜已经在转盘里了');
    state.items.push({ ...item });
    state.winner = null;
    renderSelectedItems();
    renderSearchResults();
    drawWheel();
    renderResult();
    saveConfig();
  }

  function addCustomItem() {
    if (state.spinning) return;
    if (state.items.length >= MAX_ITEMS) return showToast('转盘最多放 12 道美食');
    const input = document.getElementById('wheel-custom-name');
    const name = input.value.trim();
    if (!name) return;
    const canteens = selectedCanteenNames();
    state.items.push(normalizeItem({
      key: `custom:${Date.now()}:${name}`,
      name,
      placeName: canteens.length === 1 ? canteens[0] : '自定义美食',
      custom: true,
    }));
    input.value = '';
    state.winner = null;
    renderSelectedItems();
    drawWheel();
    renderResult();
    saveConfig();
  }

  function bindEvents() {
    document.querySelectorAll('[data-wheel-mode]').forEach(button => {
      button.addEventListener('click', () => {
        if (state.spinning) return;
        state.mode = button.dataset.wheelMode;
        renderMode();
        renderSearchResults();
        updateStageState();
        saveConfig();
      });
    });

    document.getElementById('wheel-canteens')?.addEventListener('click', event => {
      const button = event.target.closest('[data-wheel-canteen]');
      if (!button || state.spinning) return;
      const id = button.dataset.wheelCanteen;
      if (id === 'all') state.canteens.clear();
      else if (state.canteens.has(id)) state.canteens.delete(id);
      else state.canteens.add(id);
      renderCanteens();
      renderSearchResults();
      updateStageState();
      saveConfig();
    });

    document.querySelectorAll('[data-wheel-size]').forEach(button => {
      button.addEventListener('click', () => {
        if (state.spinning) return;
        state.size = Number(button.dataset.wheelSize);
        renderMode();
        saveConfig();
      });
    });

    document.getElementById('wheel-generate')?.addEventListener('click', () => generateRandom());
    document.getElementById('wheel-spin')?.addEventListener('click', spinWheel);
    document.getElementById('wheel-center-spin')?.addEventListener('click', spinWheel);
    document.getElementById('wheel-regenerate')?.addEventListener('click', () => {
      if (state.mode === 'random') generateRandom();
      else fillCustomRandom();
    });
    document.getElementById('wheel-clear-items')?.addEventListener('click', () => {
      if (state.spinning) return;
      state.items = [];
      state.winner = null;
      renderSelectedItems();
      renderSearchResults();
      drawWheel();
      renderResult();
      saveConfig();
    });
    document.getElementById('wheel-search')?.addEventListener('input', event => {
      state.query = event.target.value;
      renderSearchResults();
    });
    document.getElementById('wheel-search-results')?.addEventListener('click', event => {
      const add = event.target.closest('[data-wheel-add]');
      if (add) addCatalogItem(add.dataset.wheelAdd);
    });
    document.getElementById('wheel-selected-list')?.addEventListener('click', event => {
      const remove = event.target.closest('[data-wheel-remove]');
      if (!remove || state.spinning) return;
      state.items = state.items.filter(item => item.key !== remove.dataset.wheelRemove);
      state.winner = null;
      renderSelectedItems();
      renderSearchResults();
      drawWheel();
      renderResult();
      saveConfig();
    });
    document.getElementById('wheel-custom-add')?.addEventListener('click', addCustomItem);
    document.getElementById('wheel-custom-name')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') addCustomItem();
    });
    document.getElementById('wheel-result')?.addEventListener('click', event => {
      const detail = event.target.closest('[data-wheel-detail]');
      if (detail && typeof window.detail === 'function') window.detail(detail.dataset.wheelDetail, 'results');
    });
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

  window.renderWheelPage = renderPage;
  window.addEventListener('hustmap:data-loaded', () => {
    if (location.hash === '#wheel') renderPage();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPage, { once: true });
  } else {
    renderPage();
  }
})();
