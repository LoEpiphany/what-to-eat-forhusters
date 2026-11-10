(() => {
  'use strict';

  const CATEGORIES = [
    { id: 'all', label: '全部讨论', short: '全部' },
    { id: 'review', label: '食堂测评', short: '测评' },
    { id: 'partner', label: '拼饭搭子', short: '拼饭' },
    { id: 'ask', label: '求推荐', short: '求助' },
    { id: 'campus', label: '校园生活', short: '生活' },
    { id: 'market', label: '闲置交换', short: '闲置' },
  ];
  const CATEGORY_MAP = new Map(CATEGORIES.map(category => [category.id, category]));
  const AVATAR_COLORS = ['#c85b42', '#5d7d72', '#ba8746', '#8b6c8e', '#47728a', '#82645a'];
  const REPORT_REASONS = [
    ['spam', '垃圾广告或刷屏'],
    ['harassment', '攻击、辱骂或骚扰'],
    ['misinformation', '明显不实信息'],
    ['privacy', '泄露个人隐私'],
    ['other', '其他问题'],
  ];

  const state = {
    category: 'all',
    query: '',
    sort: 'latest',
    posts: [],
    stats: { topics: 0, replies: 0, members: 0, categories: {} },
    pagination: { page: 1, pages: 1, total: 0, limit: 20 },
    loading: false,
    activePost: null,
    comments: [],
    composerCategory: 'review',
    editingPost: null,
    composerImages: [],
    imageProcessing: false,
    reportTarget: null,
    adminReportFilter: 'pending',
    searchTimer: null,
    refreshTimer: null,
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

  function currentUser() {
    try {
      const info = JSON.parse(localStorage.getItem('hustmap-user-info') || 'null');
      const token = localStorage.getItem('hustmap-user-token');
      if (!token || !info) return null;
      return {
        name: info.nickname || info.username || '校园用户',
        username: info.username || '',
        token,
      };
    } catch {
      return null;
    }
  }

  async function apiRequest(path, { method = 'GET', body = null, auth = false, admin = false, signal = null } = {}) {
    const user = currentUser();
    if (auth && !user) {
      const error = new Error('请先登录后再参与论坛互动');
      error.code = 'login_required';
      throw error;
    }
    const headers = {};
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (admin) {
      const adminToken = localStorage.getItem('hustmap-admin-token');
      if (!adminToken) {
        const error = new Error('请先登录管理员后台');
        error.code = 'admin_login_required';
        throw error;
      }
      headers.Authorization = `Bearer ${adminToken}`;
    } else if (user?.token) {
      headers.Authorization = `Bearer ${user.token}`;
    }
    let response;
    try {
      response = await fetch(new URL(path, document.baseURI), {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: signal || undefined,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      const unavailable = new Error('论坛服务暂时不可用，请确认后端服务已经启动');
      unavailable.code = 'forum_unavailable';
      throw unavailable;
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      throw new Error('论坛服务返回了无法识别的数据');
    }
    if (!response.ok) {
      const error = new Error(data.message || data.error || '论坛请求失败');
      error.status = response.status;
      error.code = data.error;
      if (response.status === 401) error.code = 'login_required';
      throw error;
    }
    return data;
  }

  function avatarColor(name) {
    const total = [...String(name)].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return AVATAR_COLORS[total % AVATAR_COLORS.length];
  }

  function initials(name) {
    const cleaned = String(name || '同学').replace(/\s+/g, '');
    return [...cleaned].slice(-2).join('') || '同学';
  }

  function parseServerDate(value) {
    if (!value) return new Date();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)) {
      return new Date(`${value.replace(' ', 'T')}Z`);
    }
    return new Date(value);
  }

  function timeLabel(value) {
    const timestamp = parseServerDate(value).getTime();
    const delta = Math.max(0, Date.now() - timestamp);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (delta < minute) return '刚刚';
    if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
    if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
    if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
    return parseServerDate(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  function categoryLabel(id) {
    return CATEGORY_MAP.get(id)?.label || '校园讨论';
  }

  function categoryShortLabel(id) {
    return CATEGORY_MAP.get(id)?.short || '讨论';
  }

  function commentCount(post) {
    return Number(post.commentCount) || 0;
  }

  function forumImagesMarkup(images, className = '') {
    if (!Array.isArray(images) || !images.length) return '';
    return `
      <div class="forum-image-grid ${className} forum-image-count-${Math.min(images.length, 3)}">
        ${images.map((image, index) => `
          <button class="forum-image-button" type="button" data-forum-image-preview aria-label="查看第 ${index + 1} 张图片">
            <img src="${escapeHtml(image.dataUrl)}" alt="${escapeHtml(image.alt || `帖子图片 ${index + 1}`)}" loading="lazy">
          </button>
        `).join('')}
      </div>
    `;
  }

  function ensureImagePreview() {
    let backdrop = document.getElementById('forum-image-backdrop');
    if (backdrop) return backdrop;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="forum-image-preview" id="forum-image-backdrop" hidden role="dialog" aria-modal="true" aria-label="图片预览">
        <button class="forum-image-preview-close" type="button" data-forum-close-image aria-label="关闭图片预览">×</button>
        <img id="forum-image-preview-img" alt="">
      </div>
    `);
    backdrop = document.getElementById('forum-image-backdrop');
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop || event.target.closest('[data-forum-close-image]')) closeImagePreview();
    });
    return backdrop;
  }

  function openImagePreview(image) {
    if (!image?.src) return;
    const backdrop = ensureImagePreview();
    const preview = document.getElementById('forum-image-preview-img');
    preview.src = image.src;
    preview.alt = image.alt || '帖子图片';
    backdrop.hidden = false;
    document.body.classList.add('forum-modal-open');
    backdrop.querySelector('[data-forum-close-image]')?.focus();
  }

  function closeImagePreview() {
    const backdrop = document.getElementById('forum-image-backdrop');
    if (!backdrop) return;
    backdrop.hidden = true;
    const preview = document.getElementById('forum-image-preview-img');
    if (preview) preview.removeAttribute('src');
    if (
      document.getElementById('forum-thread-backdrop')?.hidden !== false
      && document.getElementById('forum-compose-backdrop')?.hidden !== false
      && document.getElementById('forum-report-backdrop')?.hidden !== false
    ) document.body.classList.remove('forum-modal-open');
  }

  function renderComposerImages() {
    const host = document.getElementById('forum-composer-images');
    const count = document.getElementById('forum-image-count');
    if (!host) return;
    if (count) count.textContent = `${state.composerImages.length}/3`;
    host.innerHTML = state.composerImages.map((image, index) => `
      <div class="forum-composer-image">
        <img src="${escapeHtml(image.dataUrl)}" alt="${escapeHtml(image.alt || `待发布图片 ${index + 1}`)}">
        <button type="button" data-forum-remove-image="${index}" aria-label="移除第 ${index + 1} 张图片">×</button>
      </div>
    `).join('');
  }

  async function compressForumImage(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('仅支持 JPG、PNG 或 WebP 图片');
    }
    if (file.size > 10 * 1024 * 1024) throw new Error('原始图片不能超过 10MB');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error('浏览器无法读取这张图片');
    }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close?.();
      throw new Error('图片压缩失败，请更换浏览器重试');
    }
    let maxDimension = 1600;
    let quality = 0.84;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/webp', quality);
        if (dataUrl.length <= 780_000) {
          return { dataUrl, alt: file.name.replace(/\.[^.]+$/, '').slice(0, 80) };
        }
        maxDimension = Math.round(maxDimension * 0.82);
        quality = Math.max(0.5, quality - 0.07);
      }
    } finally {
      bitmap.close?.();
    }
    throw new Error('图片压缩后仍然过大，请选择更小的图片');
  }

  async function handleImageSelection(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length || state.imageProcessing) return;
    const remaining = 3 - state.composerImages.length;
    if (remaining <= 0) return showToast('每个帖子最多上传 3 张图片');
    state.imageProcessing = true;
    const uploadLabel = document.getElementById('forum-upload-label');
    if (uploadLabel) uploadLabel.textContent = '正在压缩图片…';
    try {
      for (const file of files.slice(0, remaining)) {
        state.composerImages.push(await compressForumImage(file));
        renderComposerImages();
      }
      if (files.length > remaining) showToast('已达到 3 张图片上限');
    } catch (error) {
      showToast(error.message);
    } finally {
      state.imageProcessing = false;
      if (uploadLabel) uploadLabel.textContent = '选择图片';
    }
  }

  function renderPage() {
    const host = document.getElementById('forum');
    if (!host) return;
    if (!host.dataset.ready) {
      host.dataset.ready = 'true';
      host.innerHTML = `
        <div class="forum-shell">
          <section class="forum-hero" aria-labelledby="forum-title">
            <div class="forum-hero-copy">
              <span class="forum-kicker">HUST CAMPUS COMMONS</span>
              <h1 id="forum-title">一起聊聊，<span>今天吃什么。</span></h1>
              <p>真实测评、拼饭邀约、校园生活互助。帖子、评论、点赞和收藏都会同步到服务端，和同学们共享同一份校园讨论。</p>
              <div class="forum-hero-actions">
                <button class="forum-button forum-button-primary" id="forum-new-post" type="button">
                  <span aria-hidden="true">＋</span> 发布新帖子
                </button>
                <button class="forum-button forum-button-soft" id="forum-browse-hot" type="button">看看今日热议 →</button>
              </div>
            </div>
            <div class="forum-hero-side">
              <div class="forum-live-card" aria-label="论坛社区数据">
                <div><b id="forum-stat-topics">0</b><span>讨论中</span></div>
                <div><b id="forum-stat-replies">0</b><span>条回应</span></div>
                <div><b id="forum-stat-members">0</b><span>位同学</span></div>
              </div>
              <p class="forum-live-note"><span class="forum-live-dot" aria-hidden="true"></span> 服务端实时数据 · 每 30 秒自动刷新</p>
            </div>
          </section>

          <div class="forum-layout">
            <main class="forum-main">
              <section class="forum-toolbar" aria-label="帖子筛选与搜索">
                <div class="forum-channels" id="forum-channels" role="tablist" aria-label="论坛频道"></div>
                <div class="forum-query-row">
                  <label class="forum-search">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4.5 4.5"></path></svg>
                    <input id="forum-search" type="search" placeholder="搜索帖子、食堂、菜品或话题" autocomplete="off" aria-label="搜索论坛帖子">
                  </label>
                  <div class="forum-sort" role="tablist" aria-label="帖子排序">
                    <button type="button" role="tab" data-forum-sort="latest" aria-selected="true">最新</button>
                    <button type="button" role="tab" data-forum-sort="hot" aria-selected="false">热议</button>
                  </div>
                </div>
              </section>

              <div class="forum-feed-head">
                <div>
                  <h2 id="forum-feed-title">校园新鲜事</h2>
                  <p id="forum-feed-subtitle">来自同学们的服务端实时分享</p>
                </div>
                <span class="forum-feed-count" id="forum-feed-count">正在连接论坛…</span>
              </div>
              <div class="forum-feed" id="forum-feed" aria-live="polite"></div>
            </main>

            <aside class="forum-sidebar" aria-label="论坛辅助信息">
              <section class="forum-side-card forum-profile-card" id="forum-profile-card"></section>
              <section class="forum-side-card">
                <div class="forum-side-title"><h2>今日热议</h2><span>HOT NOW</span></div>
                <div class="forum-topic-list" id="forum-trending"></div>
              </section>
              <section class="forum-side-card">
                <div class="forum-side-title"><h2>友好交流小贴士</h2><span>COMMUNITY</span></div>
                <ol class="forum-guideline-list">
                  <li><b>1</b><span>真实分享，尽量写明食堂、时间和价格。</span></li>
                  <li><b>2</b><span>观点可以不同，尊重每一位同学。</span></li>
                  <li><b>3</b><span>遇到广告、骚扰或隐私内容可以举报。</span></li>
                </ol>
              </section>
            </aside>
          </div>
        </div>
      `;
      bindPageEvents();
    }
    renderProfile();
    loadFeed();
  }

  function renderStats() {
    const setText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };
    setText('forum-stat-topics', state.stats.topics || 0);
    setText('forum-stat-replies', state.stats.replies || 0);
    setText('forum-stat-members', state.stats.members || 0);
  }

  function renderChannels() {
    const host = document.getElementById('forum-channels');
    if (!host) return;
    host.innerHTML = CATEGORIES.map(category => {
      const count = Number(state.stats.categories?.[category.id]) || 0;
      return `
        <button class="forum-channel" type="button" role="tab" data-forum-category="${category.id}" aria-selected="${state.category === category.id}">
          ${category.label}<span class="forum-channel-count">${count}</span>
        </button>
      `;
    }).join('');
  }

  function renderProfile() {
    const host = document.getElementById('forum-profile-card');
    if (!host) return;
    const user = currentUser();
    if (user) {
      host.innerHTML = `
        <div class="forum-profile-row">
          <span class="forum-avatar" style="--avatar-bg:${avatarColor(user.name)}">${escapeHtml(initials(user.name))}</span>
          <div><strong>${escapeHtml(user.name)}</strong><span>已登录 · 内容同步到服务端</span></div>
        </div>
        <p>发布真实体验、参与评论，或者发起一次拼饭邀约。你的内容会出现在所有同学的论坛中。</p>
        <button class="forum-button" type="button" data-forum-compose>写一条新帖子</button>
      `;
    } else {
      host.innerHTML = `
        <div class="forum-profile-row">
          <span class="forum-avatar" style="--avatar-bg:#c85b42">访</span>
          <div><strong>欢迎来到校园论坛</strong><span>登录后可以发帖、评论和收藏</span></div>
        </div>
        <p>浏览无需登录。参与互动请先登录，服务端会校验你的真实账号身份。</p>
        <button class="forum-button" type="button" data-forum-login>登录 / 注册</button>
      `;
    }
  }

  function renderTrending() {
    const host = document.getElementById('forum-trending');
    if (!host) return;
    const trending = [...state.posts]
      .sort((a, b) => (b.likes * 2 + commentCount(b) * 4) - (a.likes * 2 + commentCount(a) * 4))
      .slice(0, 4);
    host.innerHTML = trending.length ? trending.map((post, index) => `
      <button class="forum-topic" type="button" data-forum-topic="${escapeHtml(post.title)}">
        <span class="forum-topic-index">0${index + 1}</span>
        <b>${escapeHtml(post.title)}</b>
        <small>${commentCount(post)} 回复</small>
      </button>
    `).join('') : '<p class="small">暂无热门讨论</p>';
  }

  function postMarkup(post) {
    return `
      <article class="forum-post" tabindex="0" data-post-id="${escapeHtml(post.id)}" data-pinned="${Boolean(post.pinned)}" aria-label="查看帖子：${escapeHtml(post.title)}">
        <div class="forum-post-top">
          <span class="forum-avatar" style="--avatar-bg:${avatarColor(post.author?.name)}">${escapeHtml(initials(post.author?.name))}</span>
          <div class="forum-post-author">
            <strong>${escapeHtml(post.author?.name || '校园同学')}<span class="forum-author-badge">${escapeHtml(post.author?.level || '校园社区成员')}</span></strong>
            <span>${post.pinned ? '置顶 · ' : ''}${timeLabel(post.createdAt)}</span>
          </div>
          <span class="forum-category">${escapeHtml(categoryShortLabel(post.category))}</span>
        </div>
        <h3>${escapeHtml(post.title)}</h3>
        <p class="forum-post-text">${escapeHtml(post.content)}</p>
        ${forumImagesMarkup(post.images, 'forum-post-images')}
        <div class="forum-post-tags">${(post.tags || []).map(tag => `<span># ${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="forum-post-actions">
          <button class="forum-post-action" type="button" data-forum-action="like" aria-pressed="${Boolean(post.liked)}" aria-label="点赞，当前 ${post.likes || 0} 个赞">
            <svg data-heart-icon viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z"></path></svg>
            ${post.likes || 0}
          </button>
          <button class="forum-post-action" type="button" data-forum-action="comment" aria-label="查看 ${commentCount(post)} 条评论">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"></path></svg>
            ${commentCount(post)}
          </button>
          <button class="forum-post-action" type="button" data-forum-action="bookmark" aria-pressed="${Boolean(post.bookmarked)}" aria-label="${post.bookmarked ? '取消收藏' : '收藏帖子'}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"></path></svg>
            ${post.bookmarked ? '已收藏' : '收藏'}
          </button>
          <span class="forum-post-place">⌖ ${escapeHtml(post.location || '校园')}</span>
        </div>
      </article>
    `;
  }

  function renderFeed() {
    const feed = document.getElementById('forum-feed');
    const count = document.getElementById('forum-feed-count');
    const title = document.getElementById('forum-feed-title');
    const subtitle = document.getElementById('forum-feed-subtitle');
    if (!feed) return;
    if (title) title.textContent = state.category === 'all' ? '校园新鲜事' : categoryLabel(state.category);
    if (subtitle) subtitle.textContent = state.query ? `正在搜索“${state.query}”` : '来自同学们的服务端实时分享';
    if (count) count.textContent = `共 ${state.pagination.total || 0} 条讨论`;

    if (!state.posts.length) {
      feed.innerHTML = `
        <div class="forum-empty">
          <span class="forum-empty-icon" aria-hidden="true">⌕</span>
          <h3>${state.query ? '还没有找到相关讨论' : '这个频道还没有帖子'}</h3>
          <p>${state.query ? '换个关键词，或者成为第一个分享的人。' : '发布第一条帖子，让同学们看到你的真实分享。'}</p>
          <button class="forum-button forum-button-primary" type="button" data-forum-compose>发布第一帖</button>
        </div>
      `;
      return;
    }
    feed.innerHTML = `${state.posts.map(postMarkup).join('')}
      ${state.pagination.page < state.pagination.pages ? '<button class="forum-load-more" type="button" data-forum-load-more>加载更多讨论</button>' : ''}`;
  }

  async function loadFeed({ append = false, silent = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    const feed = document.getElementById('forum-feed');
    if (!append && !silent && feed) {
      feed.innerHTML = '<div class="forum-loading"><span></span><span></span><span></span><p>正在读取论坛内容…</p></div>';
    }
    const page = append ? state.pagination.page + 1 : 1;
    const params = new URLSearchParams({
      category: state.category,
      sort: state.sort,
      page: String(page),
      limit: '20',
    });
    if (state.query) params.set('search', state.query);
    try {
      const data = await apiRequest(`./api/forum/posts?${params}`);
      state.posts = append ? [...state.posts, ...data.posts] : data.posts;
      state.stats = data.stats || state.stats;
      state.pagination = data.pagination || state.pagination;
      renderStats();
      renderChannels();
      renderTrending();
      renderFeed();
    } catch (error) {
      if (silent) return;
      if (feed) {
        feed.innerHTML = `
          <div class="forum-empty">
            <span class="forum-empty-icon" aria-hidden="true">!</span>
            <h3>论坛服务暂时不可用</h3>
            <p>${escapeHtml(error.message)}</p>
            <button class="forum-button forum-button-primary" type="button" data-forum-retry>重新连接</button>
          </div>
        `;
      }
      const count = document.getElementById('forum-feed-count');
      if (count) count.textContent = '连接失败';
    } finally {
      state.loading = false;
    }
  }

  function resetFeed() {
    state.pagination.page = 1;
    loadFeed();
  }

  function bindPageEvents() {
    document.getElementById('forum-channels')?.addEventListener('click', event => {
      const button = event.target.closest('[data-forum-category]');
      if (!button || state.loading) return;
      state.category = button.dataset.forumCategory;
      renderChannels();
      resetFeed();
    });

    document.getElementById('forum-search')?.addEventListener('input', event => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        state.query = event.target.value.trim();
        resetFeed();
      }, 300);
    });

    document.querySelector('.forum-sort')?.addEventListener('click', event => {
      const button = event.target.closest('[data-forum-sort]');
      if (!button || state.loading) return;
      state.sort = button.dataset.forumSort;
      document.querySelectorAll('[data-forum-sort]').forEach(item => item.setAttribute('aria-selected', String(item === button)));
      resetFeed();
    });

    document.getElementById('forum-feed')?.addEventListener('click', event => {
      if (event.target.closest('[data-forum-compose]')) return openComposer();
      if (event.target.closest('[data-forum-retry]')) return loadFeed();
      if (event.target.closest('[data-forum-load-more]')) return loadFeed({ append: true });
      const imageButton = event.target.closest('[data-forum-image-preview]');
      if (imageButton) {
        event.stopPropagation();
        const image = imageButton.querySelector('img');
        return openImagePreview({ src: image?.src, alt: image?.alt });
      }
      const action = event.target.closest('[data-forum-action]');
      const postElement = event.target.closest('[data-post-id]');
      if (!postElement) return;
      if (action) {
        event.stopPropagation();
        handlePostAction(postElement.dataset.postId, action.dataset.forumAction);
        return;
      }
      openThread(postElement.dataset.postId);
    });

    document.getElementById('forum-feed')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button, a, input, textarea')) return;
      const post = event.target.closest('[data-post-id]');
      if (!post) return;
      event.preventDefault();
      openThread(post.dataset.postId);
    });

    document.getElementById('forum-new-post')?.addEventListener('click', () => openComposer());
    document.getElementById('forum-browse-hot')?.addEventListener('click', () => {
      state.category = 'all';
      state.query = '';
      state.sort = 'hot';
      const search = document.getElementById('forum-search');
      if (search) search.value = '';
      document.querySelectorAll('[data-forum-sort]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.forumSort === 'hot')));
      resetFeed();
      document.querySelector('.forum-feed-head')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.getElementById('forum-profile-card')?.addEventListener('click', event => {
      if (event.target.closest('[data-forum-compose]')) openComposer();
      if (event.target.closest('[data-forum-login]')) requestLogin();
    });

    document.getElementById('forum-trending')?.addEventListener('click', event => {
      const button = event.target.closest('[data-forum-topic]');
      if (!button) return;
      state.category = 'all';
      state.query = button.dataset.forumTopic;
      state.sort = 'hot';
      const search = document.getElementById('forum-search');
      if (search) search.value = state.query;
      document.querySelectorAll('[data-forum-sort]').forEach(item => item.setAttribute('aria-selected', String(item.dataset.forumSort === 'hot')));
      resetFeed();
    });
  }

  async function handlePostAction(id, action) {
    if (action === 'comment') return openThread(id, true);
    const post = state.posts.find(item => item.id === id);
    if (!post) return;
    if (!currentUser()) return requestLogin('登录后即可点赞和收藏帖子');
    try {
      if (action === 'like') {
        const data = await apiRequest(`./api/forum/posts/${encodeURIComponent(id)}/like`, { method: 'POST', auth: true });
        updatePostState(id, { liked: data.liked, likes: data.likes });
      } else if (action === 'bookmark') {
        const data = await apiRequest(`./api/forum/posts/${encodeURIComponent(id)}/bookmark`, { method: 'POST', auth: true });
        updatePostState(id, { bookmarked: data.bookmarked, bookmarkCount: data.bookmarks });
        showToast(data.bookmarked ? '已收藏这篇帖子' : '已取消收藏');
      }
    } catch (error) {
      handleActionError(error);
    }
  }

  function updatePostState(id, patch) {
    const post = state.posts.find(item => item.id === id);
    if (post) Object.assign(post, patch);
    if (state.activePost?.id === id) Object.assign(state.activePost, patch);
    renderFeed();
    renderTrending();
    if (state.activePost?.id === id) renderThread();
  }

  function ensureComposer() {
    let backdrop = document.getElementById('forum-compose-backdrop');
    if (backdrop) return backdrop;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="forum-modal-backdrop" id="forum-compose-backdrop" hidden>
        <section class="forum-compose-dialog" role="dialog" aria-modal="true" aria-labelledby="forum-compose-title">
          <header class="forum-dialog-head">
            <div>
              <h2 id="forum-compose-title">分享一件校园新鲜事</h2>
              <p>内容会同步到服务端，发布后所有同学都可以看到。</p>
            </div>
            <button class="forum-icon-button" type="button" data-forum-close-compose aria-label="关闭发帖窗口">×</button>
          </header>
          <form class="forum-compose-form" id="forum-compose-form">
            <div class="forum-form-row">
              <label class="forum-form-field">
                <span>发布到频道</span>
                <select name="category">${CATEGORIES.filter(category => category.id !== 'all').map(category => `<option value="${category.id}">${category.label}</option>`).join('')}</select>
              </label>
              <label class="forum-form-field">
                <span>地点 <small>选填</small></span>
                <input name="location" maxlength="80" placeholder="例如：东一食堂 · 2F">
              </label>
            </div>
            <label class="forum-form-field">
              <span>帖子标题 <small><b data-forum-title-count>0</b>/80</small></span>
              <input name="title" required minlength="4" maxlength="80" placeholder="一句话说清楚你想聊什么">
            </label>
            <label class="forum-form-field">
              <span>正文内容 <small><b data-forum-content-count>0</b>/3000</small></span>
              <textarea name="content" required minlength="10" maxlength="3000" placeholder="补充具体时间、价格、口味或你的真实感受…"></textarea>
            </label>
            <div class="forum-form-field forum-image-field">
              <span>帖子图片 <small id="forum-image-count">0/3</small></span>
              <div class="forum-upload-zone">
                <label class="forum-upload-button" for="forum-image-input" id="forum-upload-label">选择图片</label>
                <span>最多 3 张，支持 JPG、PNG、WebP，上传前会自动压缩</span>
                <input id="forum-image-input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
              </div>
              <div class="forum-composer-images" id="forum-composer-images"></div>
            </div>
            <label class="forum-form-field">
              <span>话题标签 <small>用中英文逗号分隔，最多 5 个</small></span>
              <input name="tags" maxlength="120" placeholder="例如：东一食堂, 人均15, 求搭子">
            </label>
            <p class="forum-form-note">发帖需要登录。内容会经过服务端身份校验并写入论坛数据库，请勿发布隐私信息。</p>
            <div class="forum-form-actions">
              <button class="forum-button" type="button" data-forum-close-compose>取消</button>
              <button class="forum-button forum-button-primary" type="submit">发布帖子</button>
            </div>
          </form>
        </section>
      </div>
    `);
    backdrop = document.getElementById('forum-compose-backdrop');
    const form = document.getElementById('forum-compose-form');
    form.elements.title.addEventListener('input', event => {
      form.querySelector('[data-forum-title-count]').textContent = event.target.value.length;
    });
    form.elements.content.addEventListener('input', event => {
      form.querySelector('[data-forum-content-count]').textContent = event.target.value.length;
    });
    form.querySelector('#forum-image-input').addEventListener('change', handleImageSelection);
    form.querySelector('#forum-composer-images').addEventListener('click', event => {
      const remove = event.target.closest('[data-forum-remove-image]');
      if (!remove) return;
      state.composerImages.splice(Number(remove.dataset.forumRemoveImage), 1);
      renderComposerImages();
    });
    form.addEventListener('submit', submitPost);
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop || event.target.closest('[data-forum-close-compose]')) closeComposer();
    });
    return backdrop;
  }

  function openComposer(post = null, category = state.category) {
    if (!currentUser()) return requestLogin('登录后即可发布帖子');
    state.editingPost = post;
    state.composerCategory = post?.category || (category !== 'all' ? category : 'review');
    const backdrop = ensureComposer();
    const form = document.getElementById('forum-compose-form');
    form.reset();
    form.elements.category.value = state.composerCategory;
    form.elements.title.value = post?.title || '';
    form.elements.content.value = post?.content || '';
    form.elements.location.value = post?.location || '';
    form.elements.tags.value = (post?.tags || []).join(', ');
    state.composerImages = (post?.images || []).map(image => ({
      id: image.id,
      dataUrl: image.dataUrl,
      alt: image.alt || '',
      dataMissing: !image.dataUrl,
    })).filter(image => image.dataUrl);
    renderComposerImages();
    form.querySelector('[data-forum-title-count]').textContent = String(post?.title?.length || 0);
    form.querySelector('[data-forum-content-count]').textContent = String(post?.content?.length || 0);
    document.getElementById('forum-compose-title').textContent = post ? '编辑帖子' : '分享一件校园新鲜事';
    form.querySelector('button[type="submit"]').textContent = post ? '保存修改' : '发布帖子';
    backdrop.hidden = false;
    document.body.classList.add('forum-modal-open');
    setTimeout(() => form.elements.title.focus(), 30);
  }

  function closeComposer() {
    document.getElementById('forum-compose-backdrop').hidden = true;
    state.editingPost = null;
    state.composerImages = [];
    if (document.getElementById('forum-thread-backdrop')?.hidden !== false) document.body.classList.remove('forum-modal-open');
  }

  async function submitPost(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const data = new FormData(form);
    const payload = {
      category: String(data.get('category') || ''),
      title: String(data.get('title') || '').trim(),
      content: String(data.get('content') || '').trim(),
      location: String(data.get('location') || '').trim(),
      tags: String(data.get('tags') || '').split(/[,，]/).map(tag => tag.trim()).filter(Boolean).slice(0, 5),
      images: state.composerImages.map(image => ({ dataUrl: image.dataUrl, alt: image.alt || '' })),
    };
    if (payload.title.length < 4 || payload.content.length < 10) {
      showToast('标题至少 4 个字，正文至少 10 个字');
      return;
    }
    button.disabled = true;
    button.textContent = state.editingPost ? '保存中…' : '发布中…';
    try {
      const editingId = state.editingPost?.id;
      if (editingId) {
        await apiRequest(`./api/forum/posts/${encodeURIComponent(editingId)}`, { method: 'PATCH', body: payload, auth: true });
      } else {
        await apiRequest('./api/forum/posts', { method: 'POST', body: payload, auth: true });
      }
      closeComposer();
      state.category = payload.category;
      state.query = '';
      state.sort = 'latest';
      const search = document.getElementById('forum-search');
      if (search) search.value = '';
      document.querySelectorAll('[data-forum-sort]').forEach(item => item.setAttribute('aria-selected', String(item.dataset.forumSort === 'latest')));
      await loadFeed();
      if (editingId && state.activePost?.id === editingId) await openThread(editingId);
      showToast(editingId ? '帖子已更新' : '帖子发布成功');
    } catch (error) {
      handleActionError(error);
    } finally {
      button.disabled = false;
      button.textContent = state.editingPost ? '保存修改' : '发布帖子';
    }
  }

  function ensureThreadDrawer() {
    let backdrop = document.getElementById('forum-thread-backdrop');
    if (backdrop) return backdrop;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="forum-drawer-backdrop" id="forum-thread-backdrop" hidden>
        <aside class="forum-drawer" role="dialog" aria-modal="true" aria-labelledby="forum-thread-title">
          <header class="forum-drawer-head">
            <span>帖子详情</span>
            <button class="forum-icon-button" type="button" data-forum-close-thread aria-label="关闭帖子详情">×</button>
          </header>
          <div id="forum-thread-body"></div>
        </aside>
      </div>
    `);
    backdrop = document.getElementById('forum-thread-backdrop');
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop || event.target.closest('[data-forum-close-thread]')) closeThread();
    });
    backdrop.addEventListener('click', handleThreadClick);
    backdrop.addEventListener('submit', handleThreadSubmit);
    return backdrop;
  }

  async function openThread(id, focusComment = false) {
    const backdrop = ensureThreadDrawer();
    backdrop.hidden = false;
    document.body.classList.add('forum-modal-open');
    const body = document.getElementById('forum-thread-body');
    body.innerHTML = '<div class="forum-loading"><span></span><span></span><span></span><p>正在读取帖子和评论…</p></div>';
    try {
      const data = await apiRequest(`./api/forum/posts/${encodeURIComponent(id)}`);
      state.activePost = data.post;
      state.comments = data.comments;
      renderThread();
      if (focusComment) setTimeout(() => document.getElementById('forum-comment-input')?.focus(), 30);
      else setTimeout(() => backdrop.querySelector('[data-forum-close-thread]')?.focus(), 30);
    } catch (error) {
      body.innerHTML = `<div class="forum-empty"><span class="forum-empty-icon">!</span><h3>无法打开帖子</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  function closeThread() {
    document.getElementById('forum-thread-backdrop').hidden = true;
    state.activePost = null;
    state.comments = [];
    if (document.getElementById('forum-compose-backdrop')?.hidden !== false) document.body.classList.remove('forum-modal-open');
  }

  function renderThread() {
    const host = document.getElementById('forum-thread-body');
    const post = state.activePost;
    if (!host || !post) return;
    const user = currentUser();
    host.innerHTML = `
      <article class="forum-thread">
        <div class="forum-post-top">
          <span class="forum-avatar" style="--avatar-bg:${avatarColor(post.author?.name)}">${escapeHtml(initials(post.author?.name))}</span>
          <div class="forum-post-author">
            <strong>${escapeHtml(post.author?.name || '校园同学')}<span class="forum-author-badge">${escapeHtml(post.author?.level || '校园社区成员')}</span></strong>
            <span>${timeLabel(post.createdAt)} · ${escapeHtml(post.location || '校园')}</span>
          </div>
          <span class="forum-category">${escapeHtml(categoryLabel(post.category))}</span>
        </div>
        <h2 id="forum-thread-title">${escapeHtml(post.title)}</h2>
        <div class="forum-thread-content">${escapeHtml(post.content)}</div>
        ${forumImagesMarkup(post.images, 'forum-thread-images')}
        <div class="forum-post-tags">${(post.tags || []).map(tag => `<span># ${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="forum-thread-actions">
          <button class="forum-post-action" type="button" data-thread-action="like" aria-pressed="${Boolean(post.liked)}">
            <svg data-heart-icon viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z"></path></svg>
            ${post.likes || 0} 个赞
          </button>
          <button class="forum-post-action" type="button" data-thread-action="bookmark" aria-pressed="${Boolean(post.bookmarked)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"></path></svg>
            ${post.bookmarked ? '已收藏' : '收藏'}
          </button>
          <button class="forum-post-action" type="button" data-thread-action="share">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"></path></svg>
            分享
          </button>
        </div>
        <div class="forum-thread-management">
          ${post.isOwner || post.canModerate ? '<button type="button" data-thread-action="edit">编辑帖子</button><button type="button" class="danger" data-thread-action="delete-post">删除帖子</button>' : ''}
          ${!post.isOwner ? '<button type="button" data-thread-action="report-post">举报帖子</button>' : ''}
        </div>
        <div class="forum-comments-head">
          <h3>同学回应</h3>
          <span>${state.comments.length} 条评论</span>
        </div>
        <div class="forum-comment-list">
          ${state.comments.length ? state.comments.map(commentMarkup).join('') : '<div class="forum-comment-empty">还没有同学回应，来说说你的看法吧。</div>'}
        </div>
        ${user ? `
          <form class="forum-comment-form" id="forum-comment-form">
            <textarea id="forum-comment-input" name="comment" required maxlength="1000" placeholder="友善交流，分享你的真实体验…" aria-label="写下评论"></textarea>
            <button class="forum-button forum-button-primary" type="submit">发送</button>
          </form>
        ` : '<button class="forum-login-inline" type="button" data-thread-action="login">登录后参与评论</button>'}
      </article>
    `;
  }

  function commentMarkup(comment) {
    return `
      <div class="forum-comment" data-comment-id="${escapeHtml(comment.id)}">
        <span class="forum-avatar" style="--avatar-bg:${avatarColor(comment.author?.name)}">${escapeHtml(initials(comment.author?.name))}</span>
        <div>
          <div class="forum-comment-head">
            <b>${escapeHtml(comment.author?.name)}</b><span>${timeLabel(comment.createdAt)}</span>
            <div class="forum-comment-actions">
              <button type="button" data-comment-action="like" aria-pressed="${Boolean(comment.liked)}">赞 ${comment.likes || 0}</button>
              ${comment.isOwner || comment.canModerate ? '<button type="button" data-comment-action="delete">删除</button>' : ''}
              ${!comment.isOwner ? '<button type="button" data-comment-action="report">举报</button>' : ''}
            </div>
          </div>
          <p>${escapeHtml(comment.content)}</p>
        </div>
      </div>
    `;
  }

  async function handleThreadClick(event) {
    const action = event.target.closest('[data-thread-action]');
    const commentAction = event.target.closest('[data-comment-action]');
    const post = state.activePost;
    if (!post) return;
    const imageButton = event.target.closest('[data-forum-image-preview]');
    if (imageButton) {
      event.stopPropagation();
      const image = imageButton.querySelector('img');
      return openImagePreview({ src: image?.src, alt: image?.alt });
    }
    if (action) {
      const type = action.dataset.threadAction;
      if (type === 'login') return requestLogin();
      if (type === 'edit') return openComposer(post);
      if (type === 'share') return sharePost(post);
      if (type === 'report-post') return openReportModal('post', post.id, post.title);
      if (type === 'delete-post') return deleteActivePost();
      if (!currentUser()) return requestLogin('登录后即可点赞和收藏帖子');
      try {
        if (type === 'like') {
          const data = await apiRequest(`./api/forum/posts/${encodeURIComponent(post.id)}/like`, { method: 'POST', auth: true });
          updatePostState(post.id, { liked: data.liked, likes: data.likes });
        }
        if (type === 'bookmark') {
          const data = await apiRequest(`./api/forum/posts/${encodeURIComponent(post.id)}/bookmark`, { method: 'POST', auth: true });
          updatePostState(post.id, { bookmarked: data.bookmarked, bookmarkCount: data.bookmarks });
          showToast(data.bookmarked ? '已收藏这篇帖子' : '已取消收藏');
        }
      } catch (error) {
        handleActionError(error);
      }
    }
    if (commentAction) {
      const commentElement = commentAction.closest('[data-comment-id]');
      const comment = state.comments.find(item => item.id === commentElement?.dataset.commentId);
      if (!comment) return;
      const type = commentAction.dataset.commentAction;
      if (type === 'report') return openReportModal('comment', comment.id, comment.content);
      if (!currentUser()) return requestLogin();
      try {
        if (type === 'like') {
          const data = await apiRequest(`./api/forum/comments/${encodeURIComponent(comment.id)}/like`, { method: 'POST', auth: true });
          comment.liked = data.liked;
          comment.likes = data.likes;
          renderThread();
        }
        if (type === 'delete') {
          if (!confirm('确定删除这条评论吗？')) return;
          await apiRequest(`./api/forum/comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE', auth: true });
          state.comments = state.comments.filter(item => item.id !== comment.id);
          post.commentCount = Math.max(0, commentCount(post) - 1);
          state.stats.replies = Math.max(0, Number(state.stats.replies || 0) - 1);
          renderStats();
          renderFeed();
          renderThread();
          showToast('评论已删除');
        }
      } catch (error) {
        handleActionError(error);
      }
    }
  }

  async function handleThreadSubmit(event) {
    if (event.target.id !== 'forum-comment-form') return;
    event.preventDefault();
    const post = state.activePost;
    if (!post) return;
    const form = event.target;
    const textarea = form.elements.comment;
    const content = textarea.value.trim();
    if (!content) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '发送中…';
    try {
      const data = await apiRequest(`./api/forum/posts/${encodeURIComponent(post.id)}/comments`, {
        method: 'POST',
        body: { content },
        auth: true,
      });
      state.comments.push(data.comment);
      post.commentCount = commentCount(post) + 1;
      state.stats.replies = Number(state.stats.replies || 0) + 1;
      renderStats();
      renderFeed();
      renderThread();
      showToast('评论已同步到论坛');
      setTimeout(() => document.getElementById('forum-comment-input')?.focus(), 20);
    } catch (error) {
      handleActionError(error);
    } finally {
      button.disabled = false;
      button.textContent = '发送';
    }
  }

  async function deleteActivePost() {
    const post = state.activePost;
    if (!post || !confirm('确定删除这篇帖子吗？删除后将从论坛下架。')) return;
    try {
      await apiRequest(`./api/forum/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE', auth: true });
      closeThread();
      await loadFeed();
      showToast('帖子已删除');
    } catch (error) {
      handleActionError(error);
    }
  }

  function ensureReportModal() {
    let backdrop = document.getElementById('forum-report-backdrop');
    if (backdrop) return backdrop;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="forum-modal-backdrop" id="forum-report-backdrop" hidden>
        <section class="forum-compose-dialog" role="dialog" aria-modal="true" aria-labelledby="forum-report-title">
          <header class="forum-dialog-head">
            <div><h2 id="forum-report-title">举报不当内容</h2><p>管理员会结合举报原因和内容进行审核。</p></div>
            <button class="forum-icon-button" type="button" data-forum-close-report aria-label="关闭举报窗口">×</button>
          </header>
          <form class="forum-compose-form" id="forum-report-form">
            <label class="forum-form-field"><span>举报原因</span><select name="reason">${REPORT_REASONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
            <label class="forum-form-field"><span>补充说明 <small>选填</small></span><textarea name="details" maxlength="500" placeholder="请说明具体问题，帮助管理员判断…"></textarea></label>
            <div class="forum-form-actions"><button class="forum-button" type="button" data-forum-close-report>取消</button><button class="forum-button forum-button-primary" type="submit">提交举报</button></div>
          </form>
        </section>
      </div>
    `);
    backdrop = document.getElementById('forum-report-backdrop');
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop || event.target.closest('[data-forum-close-report]')) closeReportModal();
    });
    document.getElementById('forum-report-form').addEventListener('submit', submitReport);
    return backdrop;
  }

  function openReportModal(targetType, targetId, preview) {
    if (!currentUser()) return requestLogin('登录后即可举报内容');
    state.reportTarget = { targetType, targetId, preview };
    const backdrop = ensureReportModal();
    document.getElementById('forum-report-form').reset();
    backdrop.hidden = false;
    document.body.classList.add('forum-modal-open');
    document.querySelector('#forum-report-form select')?.focus();
  }

  function closeReportModal() {
    document.getElementById('forum-report-backdrop').hidden = true;
    state.reportTarget = null;
    if (document.getElementById('forum-thread-backdrop')?.hidden !== false) document.body.classList.remove('forum-modal-open');
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!state.reportTarget) return;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const data = new FormData(form);
    button.disabled = true;
    button.textContent = '提交中…';
    try {
      await apiRequest('./api/forum/reports', {
        method: 'POST',
        auth: true,
        body: {
          targetType: state.reportTarget.targetType,
          targetId: state.reportTarget.targetId,
          reason: data.get('reason'),
          details: data.get('details'),
        },
      });
      closeReportModal();
      showToast('举报已提交，管理员会进行审核');
    } catch (error) {
      handleActionError(error);
    } finally {
      button.disabled = false;
      button.textContent = '提交举报';
    }
  }

  async function sharePost(post) {
    const shareData = {
      title: post.title,
      text: `华科校园论坛：${post.title}`,
      url: `${location.origin}${location.pathname}#forum`,
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareData.text);
        showToast('帖子信息已复制');
      } else showToast('可从浏览器地址栏分享论坛');
    } catch (error) {
      if (error.name !== 'AbortError') showToast('分享未完成');
    }
  }

  function requestLogin(message = '登录后即可参与论坛互动') {
    showToast(message);
    if (typeof window.openUserModal === 'function') window.openUserModal();
  }

  function handleActionError(error) {
    if (error.code === 'login_required' || error.status === 401 || error.status === 403) {
      requestLogin(error.message || '请先登录');
      return;
    }
    showToast(error.message || '操作失败，请稍后重试');
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

  async function loadForumAdminReports() {
    const host = document.getElementById('forum-admin-reports');
    if (!host) return;
    if (!localStorage.getItem('hustmap-admin-token')) {
      host.innerHTML = '<div class="empty">请先登录管理员后台，再处理论坛举报。</div>';
      return;
    }
    host.innerHTML = '<div class="forum-loading"><span></span><span></span><span></span><p>正在读取论坛举报…</p></div>';
    try {
      const data = await apiRequest(`./api/admin/forum/reports?status=${state.adminReportFilter}`, { admin: true });
      renderForumAdminReports(data.reports || []);
    } catch (error) {
      host.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderForumAdminReports(reports) {
    const host = document.getElementById('forum-admin-reports');
    if (!host) return;
    if (!reports.length) {
      host.innerHTML = `<div class="empty">${state.adminReportFilter === 'pending' ? '当前没有待处理的论坛举报。' : '暂无论坛举报记录。'}</div>`;
      return;
    }
    host.innerHTML = reports.map(report => {
      const reason = REPORT_REASONS.find(([value]) => value === report.reason)?.[1] || report.reason;
      const targetType = report.target?.type === 'post' ? '帖子' : '评论';
      return `
        <article class="forum-report-card">
          <div class="forum-report-card-head">
            <span class="forum-report-reason">${escapeHtml(reason)}</span>
            <span class="forum-report-status">${escapeHtml(report.status === 'pending' ? '待处理' : report.status === 'reviewed' ? '已处理' : '已忽略')}</span>
            <time>${timeLabel(report.createdAt)}</time>
          </div>
          <h3>${escapeHtml(targetType)}：${escapeHtml(report.target?.title || '')}</h3>
          <p>${escapeHtml(report.target?.content || '')}</p>
          ${report.details ? `<div class="forum-report-details">举报说明：${escapeHtml(report.details)}</div>` : ''}
          <div class="forum-report-meta">举报人：${escapeHtml(report.reporter?.name || '校园同学')}</div>
          ${report.status === 'pending' ? `
            <div class="forum-report-actions">
              <button class="secondary" type="button" data-forum-report-review="${escapeHtml(report.id)}" data-forum-report-action="dismiss">忽略举报</button>
              <button class="primary" type="button" data-forum-report-review="${escapeHtml(report.id)}" data-forum-report-action="hide_target">下架内容</button>
            </div>
          ` : ''}
        </article>
      `;
    }).join('');
  }

  async function handleForumAdminAction(button) {
    const reportId = button.dataset.forumReportReview;
    const action = button.dataset.forumReportAction;
    if (!reportId || !action) return;
    if (action === 'hide_target' && !confirm('确定下架这条论坛内容吗？')) return;
    button.disabled = true;
    try {
      await apiRequest(`./api/admin/forum/reports/${encodeURIComponent(reportId)}`, {
        method: 'PATCH',
        admin: true,
        body: { action },
      });
      showToast(action === 'hide_target' ? '内容已下架' : '举报已忽略');
      await loadForumAdminReports();
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
  }

  function bindForumAdminEvents() {
    document.addEventListener('click', event => {
      if (event.target.closest('[data-admin-tab="forum"]')) {
        setTimeout(loadForumAdminReports, 0);
      }
      const filter = event.target.closest('[data-forum-admin-filter]');
      if (filter) {
        state.adminReportFilter = filter.dataset.forumAdminFilter;
        document.querySelectorAll('[data-forum-admin-filter]').forEach(button => {
          button.setAttribute('aria-pressed', String(button === filter));
        });
        loadForumAdminReports();
      }
      if (event.target.closest('#forum-admin-refresh')) loadForumAdminReports();
      const action = event.target.closest('[data-forum-report-review]');
      if (action) handleForumAdminAction(action);
    });
  }

  function startAutoRefresh() {
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => {
      if (
        document.querySelector('.view.active')?.id === 'forum'
        && document.visibilityState === 'visible'
        && !state.loading
        && document.getElementById('forum-compose-backdrop')?.hidden !== false
        && document.getElementById('forum-thread-backdrop')?.hidden !== false
        && document.getElementById('forum-report-backdrop')?.hidden !== false
      ) {
        loadFeed({ silent: true });
      }
    }, 30000);
  }

  function handleEscape(event) {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('forum-image-backdrop')?.hidden) return closeImagePreview();
    if (!document.getElementById('forum-report-backdrop')?.hidden) return closeReportModal();
    if (!document.getElementById('forum-thread-backdrop')?.hidden) return closeThread();
    if (!document.getElementById('forum-compose-backdrop')?.hidden) closeComposer();
  }

  window.renderForumPage = renderPage;
  window.loadForumAdminReports = loadForumAdminReports;
  document.addEventListener('keydown', handleEscape);
  bindForumAdminEvents();
  window.addEventListener('hustmap:user-changed', () => {
    renderProfile();
    if (location.hash === '#forum') loadFeed({ silent: true });
  });
  document.addEventListener('DOMContentLoaded', startAutoRefresh, { once: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPage, { once: true });
  } else {
    renderPage();
  }
})();
