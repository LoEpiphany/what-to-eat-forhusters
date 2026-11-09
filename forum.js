(() => {
  'use strict';

  const STORAGE_KEY = 'hustmap-forum-posts-v1';
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

  const state = {
    category: 'all',
    query: '',
    sort: 'latest',
    posts: [],
    activePostId: null,
    composerCategory: 'review',
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

  function hoursAgo(hours) {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  }

  function seedPosts() {
    return [
      {
        id: 'forum-seed-east-1',
        category: 'review',
        title: '东一二楼的糖醋里脊，最近是不是偷偷升级了？',
        content: '今天中午特意错峰去试了一下，外皮比之前更脆，糖醋汁也没有原来那么甜了。配一份青菜刚刚好，12 元左右能吃得很满足。\n\n窗口阿姨说最近换了一个师傅，大家如果也吃过，来交流一下口感有没有变化。个人建议 12:20 之后去，排队会短很多。',
        author: { name: '小满不吃香菜', level: '校园食客' },
        createdAt: hoursAgo(2),
        location: '东一食堂 · 2F',
        tags: ['东一食堂', '糖醋里脊', '实测'],
        likes: 42,
        liked: false,
        bookmarked: false,
        pinned: true,
        comments: [
          { id: 'c-east-1', author: '梧桐树下', content: '昨天也吃了，确实比上学期好！不过米饭稍微有点硬。', createdAt: hoursAgo(1.5) },
          { id: 'c-east-2', author: '今天吃什么', content: '请问是几号窗口呀？明天想去试试。', createdAt: hoursAgo(.7) },
        ],
      },
      {
        id: 'forum-seed-partner-1',
        category: 'partner',
        title: '周三晚课拼个火锅，还差两位',
        content: '周三 18:00 下课，想去光谷世界城吃火锅。目前两个女生，口味都能吃辣，预计人均 70 左右，吃完可以一起坐地铁回学校。\n\n希望是不鸽、好沟通的同学，有兴趣可以在评论里说一下校区和下课时间。',
        author: { name: '晚风汽水', level: '活跃搭子' },
        createdAt: hoursAgo(4),
        location: '光谷世界城',
        tags: ['拼饭', '火锅', '周三'],
        likes: 18,
        liked: false,
        bookmarked: false,
        pinned: false,
        comments: [
          { id: 'c-partner-1', author: '我要吃饱', content: '西十二下课，18:10 左右可以到，还缺人吗？', createdAt: hoursAgo(2.8) },
        ],
      },
      {
        id: 'forum-seed-ask-1',
        category: 'ask',
        title: '求推荐：适合四人安静聊天的校内餐厅',
        content: '小组讨论完想一起吃顿饭，最好人均 40 以内、不用排太久，环境安静一点。东边和中间区域都可以，求大家最近的真实体验，广告菜名也欢迎！',
        author: { name: '图书馆常驻民', level: '新同学' },
        createdAt: hoursAgo(7),
        location: '校本部',
        tags: ['求推荐', '四人聚餐', '安静'],
        likes: 27,
        liked: false,
        bookmarked: false,
        pinned: false,
        comments: [
          { id: 'c-ask-1', author: '百景园侦察员', content: '百景园三楼角落那几家可以，晚一点去人少，人均差不多 30-40。', createdAt: hoursAgo(5.4) },
          { id: 'c-ask-2', author: '饭搭子一号', content: '推荐东边 CBD 的简餐店，桌子间距比食堂大。', createdAt: hoursAgo(3.2) },
          { id: 'c-ask-3', author: '小满不吃香菜', content: '如果接受校门口，泛悦城可选的更多，也不吵。', createdAt: hoursAgo(1.1) },
        ],
      },
      {
        id: 'forum-seed-campus-1',
        category: 'campus',
        title: '收集一份「错峰吃饭时间表」，大家来补全',
        content: '最近在整理各食堂相对不排队的时间，先分享自己的体感：\n\n东一 11:10 前、12:25 后；西一 12:15 后人明显少；百景园三楼 12:00 左右反而比一楼快。\n\n欢迎大家补充，我会把评论整理成一份共享版。',
        author: { name: '饭点观察员', level: '生活委员' },
        createdAt: hoursAgo(11),
        location: '全校',
        tags: ['错峰', '食堂攻略', '共享'],
        likes: 76,
        liked: false,
        bookmarked: false,
        pinned: false,
        comments: [
          { id: 'c-campus-1', author: '西边干饭人', content: '西二 17:35 前几乎不排队，18:00 之后人会突然变多。', createdAt: hoursAgo(8.5) },
          { id: 'c-campus-2', author: '小绿', content: '韵苑食堂二楼 11:25 左右最挤，可以避开。', createdAt: hoursAgo(6) },
        ],
      },
      {
        id: 'forum-seed-market-1',
        category: 'market',
        title: '出一张闲置校园餐券，今晚到期',
        content: '多买了一张学校餐厅的餐券，20 元出，今天 21:00 前可以在东区当面交易。不是食品，只是一张餐券，介意勿拍。',
        author: { name: '橙子同学', level: '普通用户' },
        createdAt: hoursAgo(1),
        location: '东区',
        tags: ['闲置', '东区', '面交'],
        likes: 6,
        liked: false,
        bookmarked: false,
        pinned: false,
        comments: [],
      },
      {
        id: 'forum-seed-review-2',
        category: 'review',
        title: '避雷提醒：这家新开的麻辣香锅酱料偏咸',
        content: '新店尝鲜记录。香味很足，但默认酱料比较咸，建议点单时让师傅少放酱。加份土豆和藕片比较划算，荤菜量一般。\n\n仅代表这次体验，欢迎吃过其他菜的同学补充。',
        author: { name: '干饭不排队', level: '校园食客' },
        createdAt: hoursAgo(17),
        location: '东边 CBD · 2F',
        tags: ['麻辣香锅', '口味提醒', '东边'],
        likes: 31,
        liked: false,
        bookmarked: false,
        pinned: false,
        comments: [
          { id: 'c-review-1', author: '微辣选手', content: '同感，微辣也很咸。下次准备备注酱料减半。', createdAt: hoursAgo(13) },
        ],
      },
    ];
  }

  function loadPosts() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) return saved;
    } catch (error) {
      console.warn('论坛本地数据读取失败，将使用初始内容。', error);
    }
    const seeded = seedPosts();
    persistPosts(seeded);
    return seeded;
  }

  function persistPosts(posts = state.posts) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
    } catch (error) {
      console.warn('论坛本地数据保存失败。', error);
      showToast('浏览器存储空间不足，本次修改可能无法保留');
    }
  }

  function currentUser() {
    try {
      const info = JSON.parse(localStorage.getItem('hustmap-user-info') || 'null');
      const token = localStorage.getItem('hustmap-user-token');
      if (!token || !info) return null;
      return {
        name: info.nickname || info.username || '校园用户',
        username: info.username || '',
      };
    } catch {
      return null;
    }
  }

  function avatarColor(name) {
    const total = [...String(name)].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return AVATAR_COLORS[total % AVATAR_COLORS.length];
  }

  function initials(name) {
    const cleaned = String(name || '同学').replace(/\s+/g, '');
    return [...cleaned].slice(-2).join('') || '同学';
  }

  function timeLabel(value) {
    const timestamp = new Date(value).getTime();
    const delta = Math.max(0, Date.now() - timestamp);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (delta < minute) return '刚刚';
    if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
    if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
    if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
    return new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  function categoryLabel(id) {
    return CATEGORY_MAP.get(id)?.label || '校园讨论';
  }

  function categoryShortLabel(id) {
    return CATEGORY_MAP.get(id)?.short || '讨论';
  }

  function totalComments() {
    return state.posts.reduce((sum, post) => sum + (post.comments?.length || 0), 0);
  }

  function contributorCount() {
    const names = new Set();
    state.posts.forEach(post => {
      if (post.author?.name) names.add(post.author.name);
      (post.comments || []).forEach(comment => names.add(comment.author));
    });
    return names.size;
  }

  function filteredPosts() {
    const query = state.query.trim().toLowerCase();
    const posts = state.posts.filter(post => {
      if (state.category !== 'all' && post.category !== state.category) return false;
      if (!query) return true;
      return [post.title, post.content, post.author?.name, post.location, ...(post.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    return posts.sort((a, b) => {
      if (state.sort === 'hot') {
        const scoreA = (a.likes || 0) * 2 + (a.comments?.length || 0) * 4;
        const scoreB = (b.likes || 0) * 2 + (b.comments?.length || 0) * 4;
        if (scoreA !== scoreB) return scoreB - scoreA;
      }
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  function renderPage() {
    const host = document.getElementById('forum');
    if (!host || host.dataset.ready === 'true') {
      renderForum();
      return;
    }

    host.dataset.ready = 'true';
    host.innerHTML = `
      <div class="forum-shell">
        <section class="forum-hero" aria-labelledby="forum-title">
          <div class="forum-hero-copy">
            <span class="forum-kicker">HUST CAMPUS COMMONS</span>
            <h1 id="forum-title">一起聊聊，<span>今天吃什么。</span></h1>
            <p>真实测评、拼饭邀约、校园生活互助。把踩过的坑和挖到的宝留在这里，让每一次选择都有同学的经验作参考。</p>
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
            <p class="forum-live-note"><span class="forum-live-dot" aria-hidden="true"></span> 社区正在交流，分享你的第一手体验</p>
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
                <p id="forum-feed-subtitle">来自同学们的即时分享</p>
              </div>
              <span class="forum-feed-count" id="forum-feed-count"></span>
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
                <li><b>3</b><span>线下交易注意安全，建议校内公共区域面交。</span></li>
              </ol>
            </section>
          </aside>
        </div>
      </div>
    `;

    bindPageEvents();
    renderForum();
  }

  function renderForum() {
    if (!document.getElementById('forum-feed')) return;
    renderStats();
    renderChannels();
    renderProfile();
    renderTrending();
    renderFeed();
  }

  function renderStats() {
    const setText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };
    setText('forum-stat-topics', state.posts.length);
    setText('forum-stat-replies', totalComments());
    setText('forum-stat-members', contributorCount());
  }

  function renderChannels() {
    const host = document.getElementById('forum-channels');
    if (!host) return;
    host.innerHTML = CATEGORIES.map(category => {
      const count = category.id === 'all'
        ? state.posts.length
        : state.posts.filter(post => post.category === category.id).length;
      return `
        <button
          class="forum-channel"
          type="button"
          role="tab"
          data-forum-category="${category.id}"
          aria-selected="${state.category === category.id}"
        >${category.label}<span class="forum-channel-count">${count}</span></button>
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
          <div><strong>${escapeHtml(user.name)}</strong><span>华科校园社区成员</span></div>
        </div>
        <p>有新的食堂发现，或者想找同学一起吃饭？把想法分享给社区吧。</p>
        <button class="forum-button" type="button" data-forum-compose>写一条新帖子</button>
      `;
    } else {
      host.innerHTML = `
        <div class="forum-profile-row">
          <span class="forum-avatar" style="--avatar-bg:#c85b42">访</span>
          <div><strong>欢迎来到校园论坛</strong><span>登录后参与发帖和评论</span></div>
        </div>
        <p>加入同学之间的真实交流，收藏喜欢的帖子，也可以留下自己的食堂体验。</p>
        <button class="forum-button" type="button" data-forum-login>登录 / 注册</button>
      `;
    }
  }

  function renderTrending() {
    const host = document.getElementById('forum-trending');
    if (!host) return;
    const trending = [...state.posts]
      .sort((a, b) => ((b.likes || 0) * 2 + (b.comments?.length || 0) * 4) - ((a.likes || 0) * 2 + (a.comments?.length || 0) * 4))
      .slice(0, 4);
    host.innerHTML = trending.map((post, index) => `
      <button class="forum-topic" type="button" data-forum-topic="${escapeHtml(post.title)}">
        <span class="forum-topic-index">0${index + 1}</span>
        <b>${escapeHtml(post.title)}</b>
        <small>${post.comments?.length || 0} 回复</small>
      </button>
    `).join('');
  }

  function postMarkup(post) {
    return `
      <article
        class="forum-post"
        tabindex="0"
        data-post-id="${escapeHtml(post.id)}"
        data-pinned="${Boolean(post.pinned)}"
        aria-label="查看帖子：${escapeHtml(post.title)}"
      >
        <div class="forum-post-top">
          <span class="forum-avatar" style="--avatar-bg:${avatarColor(post.author?.name)}">${escapeHtml(initials(post.author?.name))}</span>
          <div class="forum-post-author">
            <strong>${escapeHtml(post.author?.name || '校园同学')}<span class="forum-author-badge">${escapeHtml(post.author?.level || '校园食客')}</span></strong>
            <span>${post.pinned ? '置顶 · ' : ''}${timeLabel(post.createdAt)}</span>
          </div>
          <span class="forum-category">${escapeHtml(categoryShortLabel(post.category))}</span>
        </div>
        <h3>${escapeHtml(post.title)}</h3>
        <p class="forum-post-text">${escapeHtml(post.content)}</p>
        <div class="forum-post-tags">${(post.tags || []).map(tag => `<span># ${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="forum-post-actions">
          <button class="forum-post-action" type="button" data-forum-action="like" aria-pressed="${Boolean(post.liked)}" aria-label="点赞，当前 ${post.likes || 0} 个赞">
            <svg data-heart-icon viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z"></path></svg>
            ${post.likes || 0}
          </button>
          <button class="forum-post-action" type="button" data-forum-action="comment" aria-label="查看 ${post.comments?.length || 0} 条评论">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"></path></svg>
            ${post.comments?.length || 0}
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

    const posts = filteredPosts();
    if (title) title.textContent = state.category === 'all' ? '校园新鲜事' : categoryLabel(state.category);
    if (subtitle) subtitle.textContent = state.query ? `正在搜索“${state.query}”` : '来自同学们的即时分享';
    if (count) count.textContent = `共 ${posts.length} 条讨论`;

    if (!posts.length) {
      feed.innerHTML = `
        <div class="forum-empty">
          <span class="forum-empty-icon" aria-hidden="true">⌕</span>
          <h3>还没有找到相关讨论</h3>
          <p>换个关键词，或者成为第一个分享的人。</p>
          <button class="forum-button forum-button-primary" type="button" data-forum-compose>发布第一帖</button>
        </div>
      `;
      return;
    }
    feed.innerHTML = posts.map(postMarkup).join('');
  }

  function bindPageEvents() {
    document.getElementById('forum-channels')?.addEventListener('click', event => {
      const button = event.target.closest('[data-forum-category]');
      if (!button) return;
      state.category = button.dataset.forumCategory;
      renderForum();
    });

    document.getElementById('forum-search')?.addEventListener('input', event => {
      state.query = event.target.value;
      renderFeed();
    });

    document.querySelector('.forum-sort')?.addEventListener('click', event => {
      const button = event.target.closest('[data-forum-sort]');
      if (!button) return;
      state.sort = button.dataset.forumSort;
      document.querySelectorAll('[data-forum-sort]').forEach(item => {
        item.setAttribute('aria-selected', String(item === button));
      });
      renderFeed();
    });

    document.getElementById('forum-feed')?.addEventListener('click', event => {
      const compose = event.target.closest('[data-forum-compose]');
      if (compose) {
        event.stopPropagation();
        openComposer();
        return;
      }
      const action = event.target.closest('[data-forum-action]');
      const post = event.target.closest('[data-post-id]');
      if (!post) return;
      const id = post.dataset.postId;
      if (action) {
        event.stopPropagation();
        handlePostAction(id, action.dataset.forumAction);
        return;
      }
      openThread(id);
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
      renderForum();
      const search = document.getElementById('forum-search');
      if (search) search.value = '';
      document.querySelectorAll('[data-forum-sort]').forEach(button => {
        button.setAttribute('aria-selected', String(button.dataset.forumSort === 'hot'));
      });
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
      renderForum();
      const search = document.getElementById('forum-search');
      if (search) search.value = state.query;
      document.querySelectorAll('[data-forum-sort]').forEach(item => {
        item.setAttribute('aria-selected', String(item.dataset.forumSort === 'hot'));
      });
      document.querySelector('.forum-feed-head')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function handlePostAction(id, action) {
    const post = state.posts.find(item => item.id === id);
    if (!post) return;
    if (action === 'like') {
      post.liked = !post.liked;
      post.likes = Math.max(0, (post.likes || 0) + (post.liked ? 1 : -1));
      persistPosts();
      renderForum();
      if (state.activePostId === id) renderThread(post);
      return;
    }
    if (action === 'bookmark') {
      post.bookmarked = !post.bookmarked;
      persistPosts();
      renderForum();
      showToast(post.bookmarked ? '已收藏这篇帖子' : '已取消收藏');
      if (state.activePostId === id) renderThread(post);
      return;
    }
    if (action === 'comment') openThread(id, true);
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
              <p>真实、具体、友善的内容，更容易得到同学们回应。</p>
            </div>
            <button class="forum-icon-button" type="button" data-forum-close-compose aria-label="关闭发帖窗口">×</button>
          </header>
          <form class="forum-compose-form" id="forum-compose-form">
            <div class="forum-form-row">
              <label class="forum-form-field">
                <span>发布到频道</span>
                <select name="category">
                  ${CATEGORIES.filter(category => category.id !== 'all').map(category => `<option value="${category.id}">${category.label}</option>`).join('')}
                </select>
              </label>
              <label class="forum-form-field">
                <span>地点 <small>选填</small></span>
                <input name="location" maxlength="30" placeholder="例如：东一食堂 · 2F">
              </label>
            </div>
            <label class="forum-form-field">
              <span>帖子标题 <small><b data-forum-title-count>0</b>/50</small></span>
              <input name="title" required minlength="4" maxlength="50" placeholder="一句话说清楚你想聊什么">
            </label>
            <label class="forum-form-field">
              <span>正文内容 <small><b data-forum-content-count>0</b>/800</small></span>
              <textarea name="content" required minlength="10" maxlength="800" placeholder="补充具体时间、价格、口味或你的真实感受…"></textarea>
            </label>
            <label class="forum-form-field">
              <span>话题标签 <small>用中英文逗号分隔，最多 4 个</small></span>
              <input name="tags" maxlength="80" placeholder="例如：东一食堂, 人均15, 求搭子">
            </label>
            <p class="forum-form-note">帖子会先保存在当前浏览器中。后端论坛接口接入后，可将本页存储层替换为服务端请求。</p>
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
    form.elements.category.value = state.composerCategory;
    form.elements.title.addEventListener('input', event => {
      form.querySelector('[data-forum-title-count]').textContent = event.target.value.length;
    });
    form.elements.content.addEventListener('input', event => {
      form.querySelector('[data-forum-content-count]').textContent = event.target.value.length;
    });
    form.addEventListener('submit', submitPost);
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop || event.target.closest('[data-forum-close-compose]')) closeComposer();
    });
    return backdrop;
  }

  function openComposer(category = state.category) {
    if (!currentUser()) {
      requestLogin('登录后即可发布帖子');
      return;
    }
    state.composerCategory = category !== 'all' ? category : 'review';
    const backdrop = ensureComposer();
    const form = document.getElementById('forum-compose-form');
    form.reset();
    form.elements.category.value = state.composerCategory;
    form.querySelector('[data-forum-title-count]').textContent = '0';
    form.querySelector('[data-forum-content-count]').textContent = '0';
    backdrop.hidden = false;
    document.body.classList.add('forum-modal-open');
    setTimeout(() => form.elements.title.focus(), 30);
  }

  function closeComposer() {
    const backdrop = document.getElementById('forum-compose-backdrop');
    if (!backdrop) return;
    backdrop.hidden = true;
    if (document.getElementById('forum-thread-backdrop')?.hidden !== false) {
      document.body.classList.remove('forum-modal-open');
    }
  }

  function submitPost(event) {
    event.preventDefault();
    const user = currentUser();
    if (!user) {
      closeComposer();
      requestLogin('登录状态已失效，请重新登录');
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title') || '').trim();
    const content = String(data.get('content') || '').trim();
    if (title.length < 4 || content.length < 10) {
      showToast('标题至少 4 个字，正文至少 10 个字');
      return;
    }
    const tags = String(data.get('tags') || '')
      .split(/[,，]/)
      .map(tag => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 4);
    const category = CATEGORY_MAP.has(data.get('category')) ? data.get('category') : 'campus';
    const post = {
      id: `forum-local-${Date.now()}`,
      category,
      title,
      content,
      location: String(data.get('location') || '').trim() || '校园',
      tags,
      author: { name: user.name, level: '校园社区成员' },
      createdAt: new Date().toISOString(),
      likes: 0,
      liked: false,
      bookmarked: false,
      pinned: false,
      comments: [],
      local: true,
    };
    state.posts.unshift(post);
    persistPosts();
    closeComposer();
    state.category = category;
    state.query = '';
    state.sort = 'latest';
    const search = document.getElementById('forum-search');
    if (search) search.value = '';
    document.querySelectorAll('[data-forum-sort]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.forumSort === 'latest'));
    });
    renderForum();
    showToast('帖子发布成功');
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

  function openThread(id, focusComment = false) {
    const post = state.posts.find(item => item.id === id);
    if (!post) return;
    const backdrop = ensureThreadDrawer();
    state.activePostId = id;
    renderThread(post);
    backdrop.hidden = false;
    document.body.classList.add('forum-modal-open');
    setTimeout(() => {
      if (focusComment) {
        document.getElementById('forum-comment-input')?.focus();
      } else {
        backdrop.querySelector('[data-forum-close-thread]')?.focus();
      }
    }, 30);
  }

  function closeThread() {
    const backdrop = document.getElementById('forum-thread-backdrop');
    if (!backdrop) return;
    backdrop.hidden = true;
    state.activePostId = null;
    if (document.getElementById('forum-compose-backdrop')?.hidden !== false) {
      document.body.classList.remove('forum-modal-open');
    }
  }

  function renderThread(post) {
    const host = document.getElementById('forum-thread-body');
    if (!host) return;
    const comments = post.comments || [];
    host.innerHTML = `
      <article class="forum-thread">
        <div class="forum-post-top">
          <span class="forum-avatar" style="--avatar-bg:${avatarColor(post.author?.name)}">${escapeHtml(initials(post.author?.name))}</span>
          <div class="forum-post-author">
            <strong>${escapeHtml(post.author?.name || '校园同学')}<span class="forum-author-badge">${escapeHtml(post.author?.level || '校园食客')}</span></strong>
            <span>${timeLabel(post.createdAt)} · ${escapeHtml(post.location || '校园')}</span>
          </div>
          <span class="forum-category">${escapeHtml(categoryLabel(post.category))}</span>
        </div>
        <h2 id="forum-thread-title">${escapeHtml(post.title)}</h2>
        <div class="forum-thread-content">${escapeHtml(post.content)}</div>
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
        <div class="forum-comments-head">
          <h3>同学回应</h3>
          <span>${comments.length} 条评论</span>
        </div>
        <div class="forum-comment-list">
          ${comments.length ? comments.map(commentMarkup).join('') : '<div class="forum-comment-empty">还没有同学回应，来说说你的看法吧。</div>'}
        </div>
        <form class="forum-comment-form" id="forum-comment-form">
          <textarea id="forum-comment-input" name="comment" required maxlength="300" placeholder="友善交流，分享你的真实体验…" aria-label="写下评论"></textarea>
          <button class="forum-button forum-button-primary" type="submit">发送</button>
        </form>
      </article>
    `;
  }

  function commentMarkup(comment) {
    return `
      <div class="forum-comment">
        <span class="forum-avatar" style="--avatar-bg:${avatarColor(comment.author)}">${escapeHtml(initials(comment.author))}</span>
        <div>
          <div class="forum-comment-head"><b>${escapeHtml(comment.author)}</b><span>${timeLabel(comment.createdAt)}</span></div>
          <p>${escapeHtml(comment.content)}</p>
        </div>
      </div>
    `;
  }

  function handleThreadClick(event) {
    const action = event.target.closest('[data-thread-action]');
    if (!action || !state.activePostId) return;
    const post = state.posts.find(item => item.id === state.activePostId);
    if (!post) return;
    if (action.dataset.threadAction === 'like') {
      post.liked = !post.liked;
      post.likes = Math.max(0, (post.likes || 0) + (post.liked ? 1 : -1));
      persistPosts();
      renderForum();
      renderThread(post);
    }
    if (action.dataset.threadAction === 'bookmark') {
      post.bookmarked = !post.bookmarked;
      persistPosts();
      renderForum();
      renderThread(post);
      showToast(post.bookmarked ? '已收藏这篇帖子' : '已取消收藏');
    }
    if (action.dataset.threadAction === 'share') sharePost(post);
  }

  function handleThreadSubmit(event) {
    if (event.target.id !== 'forum-comment-form') return;
    event.preventDefault();
    const user = currentUser();
    if (!user) {
      requestLogin('登录后即可参与评论');
      return;
    }
    const post = state.posts.find(item => item.id === state.activePostId);
    if (!post) return;
    const textarea = event.target.elements.comment;
    const content = textarea.value.trim();
    if (!content) return;
    post.comments = post.comments || [];
    post.comments.push({
      id: `forum-comment-${Date.now()}`,
      author: user.name,
      content,
      createdAt: new Date().toISOString(),
    });
    persistPosts();
    renderForum();
    renderThread(post);
    setTimeout(() => document.getElementById('forum-comment-input')?.focus(), 20);
    showToast('评论已发送');
  }

  async function sharePost(post) {
    const shareData = {
      title: post.title,
      text: `华科校园论坛：${post.title}`,
      url: `${location.origin}${location.pathname}#forum`,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareData.text);
        showToast('帖子信息已复制');
      } else {
        showToast('可从浏览器地址栏分享论坛');
      }
    } catch (error) {
      if (error.name !== 'AbortError') showToast('分享未完成');
    }
  }

  function requestLogin(message) {
    showToast(message || '登录后即可参与论坛互动');
    if (typeof window.openUserModal === 'function') {
      window.openUserModal();
    } else {
      showToast('请先在页面右上角登录');
    }
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

  function handleEscape(event) {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('forum-thread-backdrop')?.hidden) {
      closeThread();
      return;
    }
    if (!document.getElementById('forum-compose-backdrop')?.hidden) closeComposer();
  }

  state.posts = loadPosts();
  window.renderForumPage = renderPage;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPage, { once: true });
  } else {
    renderPage();
  }
  document.addEventListener('keydown', handleEscape);
  window.addEventListener('hustmap:user-changed', () => {
    renderProfile();
    if (location.hash === '#forum') renderForum();
  });
})();
