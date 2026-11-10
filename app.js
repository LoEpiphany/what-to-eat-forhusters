
// 首页优先读取本地 API；GitHub Pages 没有 Node 服务时读取仓库内的公开种子数据。
const state = {
  places: [],
  meal: new Date().getHours() >= 10 && new Date().getHours() < 15 ? 'lunch' : 'dinner',
  types: new Set(),
  area: 'all',
  placeType: 'all',
  results: [],
  source: '',
  quickMode: false,
  homeRecommendationActive: false,
  mapType: 'all',
  mapSearchQuery: '',
  selectedMapPlaceId: null,
  calibrationMode: false,
  calibrationTargetId: null,
  calibrations: [],
  dishArea: 'all', 
  dishSearchQuery: '', // <--- 加上这行
  selectedDishes: new Set(),
};

window.getHustPlaces = () => state.places;

const calibrationStorageKey = 'hustmap-calibration-draft-v2';
const feedbackStorageKey = 'hustmap-feedback-v1';

// ===== 坐标系转换（WGS84 ↔ GCJ-02）=====
// 数据坐标是 WGS84，高德/百度等国内底图用 GCJ-02（火星坐标系）
// 算法来自公开的 GCJ-02 加密算法实现
const PI = Math.PI;
const a = 6378245.0;           // 长半轴
const ee = 0.00669342162296594323; // 偏心率平方

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

/** WGS84 转 GCJ-02 */
function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return { lng, lat };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  return { lng: lng + dLng, lat: lat + dLat };
}

/** GCJ-02 转 WGS84（近似迭代法） */
function gcj02ToWgs84(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  // 迭代法：先算 WGS→GCJ 的偏移，再减去
  let dLng = 0, dLat = 0;
  let tmpLng = lng, tmpLat = lat;
  for (let i = 0; i < 5; i++) {
    const tmp = wgs84ToGcj02(tmpLng, tmpLat);
    dLng = tmp.lng - lng;
    dLat = tmp.lat - lat;
    tmpLng = lng - dLng;
    tmpLat = lat - dLat;
  }
  return [tmpLng, tmpLat];
}

/** 当前底图使用的坐标系（gcj02 或 wgs84） */
let currentCoordSystem = 'gcj02'; // 默认高德是 GCJ-02

/**
 * 将数据的 WGS84 坐标转换为当前底图的坐标系
 */
function toMapCoords(lng, lat) {
  if (lng === null || lat === null) return { lng: null, lat: null };
  if (currentCoordSystem === 'gcj02') {
    return wgs84ToGcj02(lng, lat);
  }
  return { lng, lat };
}

const typePatterns = {
  米饭: /饭|粥|煲|锅|拌饭|盖饭|炒饭|米线|米粉/,
  面食: /面|饺|馄饨|抄手|饼|馍|包|烧麦|拉面|刀削面/,
  肉类: /肉|鸡|鸭|排骨|牛|羊|猪|排|烤肉|炸鸡/,
  海鲜: /鱼|虾|海鲜|花甲|鱿鱼|蟹|蛙|水产|螺/,
  汤粥: /汤|粥|羹|糊|煲/,
  小吃: /串|炸|烤|麻薯|地瓜|土豆条|鸡柳|豆腐|烧饼|肉夹馍/,
  辣: /麻辣|酸汤|冒菜|水煮|油泼|辣|干锅|香锅|剁椒|藤椒|椒麻/,
  清淡: /轻食|沙拉|蒸|白灼|素|青菜|蔬菜|燕麦|粗粮/,
  甜品: /糕点|桃胶|驴打滚|甜|糖|冰|芋|布丁|糍粑|蛋糕|面包/,
  饮品: /奶茶|果汁|果茶|咖啡|茶|奶昔|汽水|可乐|雪碧|豆浆|酸奶|鲜榨/,
  快餐: /汉堡|鸡排|饭团|披萨|卷|三明治|薯条|炸鸡/,
  下饭: /炒|红烧|回锅|宫保|鱼香|卤|炖/
};

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const escapeAttr = escapeHtml;

function mealLabel() {
  return state.meal === 'lunch' ? '午餐' : '晚餐';
}

function areaLabel(area = state.area) {
  return ({ 
    east: '东区', central: '中区', west: '西区', 
    out: '校外', takeout: '外卖' 
  }[area] || '不限区域');
}

function placeTypeLabel(type = state.placeType) {
  return type === 'canteen' ? '食堂／窗口' : type === 'shop' ? '校内店铺' : '不限类型';
}

function placeLabel(place) {
  return getZoneLabel(place);
}

function dishLabel(item) {
  // 如果菜名里带有“整体”，直接去掉，让展示更干净
  let title = item.name;
  if (title.includes('整体')) {
    title = title.replace('整体', '');
  }
  return `${item.floor ? `${item.floor} 楼 · ` : ''}${title}${item.mealPeriod ? `（${periodLabel(item.mealPeriod)}）` : ''}`;
}

function periodLabel(period) {
  return ({breakfast:'早餐', lunch:'午餐', dinner:'晚餐', both:'午餐／晚餐', all_day:'全天'})[period] || '待确认';
}

function placePeriodLabel(place, featured) {
  if (featured?.mealPeriod) return periodLabel(featured.mealPeriod);
  const periods = new Set(place.recommendations.map(item => item.mealPeriod).filter(Boolean));
  if (!periods.size) return '午餐／晚餐';
  return [...periods].map(periodLabel).join('、');
}

function foodCourtChildren(place) {
  if (!place || place.placeType !== 'food_court') return [];
  return state.places.filter(p => p.parentId === place.id);
}

function isFoodCourtChild(place) {
  if (!place?.parentId) return false;
  const parent = state.places.find(p => p.id === place.parentId);
  return parent?.placeType === 'food_court';
}

function dedupeRecommendations(list) {
  const seen = new Set();
  return list.filter(item => {
    const key = `${item.id}|${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recommendationsForPlace(place) {
  if (!place) return [];
  const children = foodCourtChildren(place);
  if (!children.length) return place.recommendations || [];

  const own = (place.recommendations || []).map(r => ({
    ...r,
    shop: r.shop || place.name,
  }));

  const childRecs = children.flatMap(child =>
    (child.recommendations || []).map(r => ({
      ...r,
      placeId: place.id,
      shop: child.name,
      _sourcePlaceId: child.id,
    }))
  );

  return dedupeRecommendations([...own, ...childRecs]);
}
function dishesOf(place) {
  const recs = recommendationsForPlace(place);
  const children = foodCourtChildren(place);

  // 光谷步行街这类 food_court：父卡片直接显示“店铺名：菜名”
  if (children.length) {
    return children.map(child => {
      const names = (child.recommendations || [])
        .map(item => escapeHtml(item.name))
        .join('、');
      return `<span style="color:var(--muted); font-size:12px;">${escapeHtml(child.name)}：</span>${names || '暂无菜品'}`;
    }).join('<br>');
  }

  if (!recs.length) return '';

    // 1. 光谷世界城（商场内，分楼层 -> 分店铺 -> 菜名）
  if (place.name.includes('光谷世界城')) {
    const floorGroups = new Map();
    for (const item of recs) {
      const key = item.floor ? `${item.floor}` : 'none';
      if (!floorGroups.has(key)) floorGroups.set(key, []);
      floorGroups.get(key).push(item);
    }
    const sortedKeys = [...floorGroups.keys()].sort((a, b) => {
      if (a === 'none') return 1;
      if (b === 'none') return -1;
      return Number(a) - Number(b);
    });
    const lines = [];
    for (const key of sortedKeys) {
      const items = floorGroups.get(key);

      // 再按店铺分组
      const shopGroups = new Map();
      for (const item of items) {
        const shopName = item.shop || '其他';
        if (!shopGroups.has(shopName)) shopGroups.set(shopName, []);
        shopGroups.get(shopName).push(item);
      }

      const shopLines = [...shopGroups.entries()].map(([shopName, shopItems]) => {
        const dishNames = shopItems.map(i => escapeHtml(i.name)).join('、');
        return `<span style="color:var(--muted); font-size:12px;">${escapeHtml(shopName)}：</span>${dishNames}`;
      }).join('<br>');

      let prefix = '';
      if (key === '-1') prefix = '<b>B1 楼</b><br>';
      else if (key !== 'none') prefix = `<b>${key} 楼</b><br>`;
      lines.push(`${prefix}${shopLines}`);
    }
    return lines.join('<br>');
  }
      // 1.5 商场综合体（如东边CBD、崧邻里），按店铺分行展示菜品
  if (place.name.includes('东边CBD') || place.name.includes('菘邻里') || place.name.includes('崧邻里')) {
    const shopGroups = new Map();
    for (const item of recs) {
      let shopName = (item.shop || '').trim();
      // 防止“氧气层·饮品”这种残留，只取第一段
      shopName = shopName.split('·')[0].trim();
      // 没有 shop 时，用 place 自己的名字兜底，不要归到“其他”
      if (!shopName) shopName = place.name;
      if (!shopGroups.has(shopName)) shopGroups.set(shopName, []);
      shopGroups.get(shopName).push(item);
    }

    const lines = [...shopGroups.entries()].map(([shopName, items]) => {
      const dishNames = items.map(i => escapeHtml(i.name)).join('、');
      return `<span style="color:var(--muted); font-size:12px;">${escapeHtml(shopName)}：</span>${dishNames}`;
    });

    return lines.join('<br>');
  }
    // 1.6 百景园三楼（独立节点，按店铺展示）
  if (place.id === 'canteen-baijingyuan-3f') {
    const shopGroups = new Map();
    for (const item of recs) {
      const shopName = item.shop || '其他店铺';
      if (!shopGroups.has(shopName)) shopGroups.set(shopName, []);
      shopGroups.get(shopName).push(item);
    }
    const lines = [...shopGroups.entries()].map(([shopName, items]) => {
      const dishNames = items.map(i => escapeHtml(i.name)).join('、');
      return `<span style="color:var(--muted); font-size:12px;">${escapeHtml(shopName)}：</span>${dishNames}`;
    });
    return lines.join('<br>');
  }
  
  // 2. 步行街 / 泛悦城 / 独立店铺（不分楼层展示）
  const isStreetOrStandalone = ['光谷步行街', '泛悦城', '东乡人家', '锅神麻辣烫', '重庆饭庄', '烤肉名家', '食尚嘉', '配满厨', '张亮麻辣烫', '杨国福麻辣烫'].some(kw => place.name.includes(kw));
  
  if (isStreetOrStandalone) {
    const shops = recs.map(item => {
      let s = item.shop && item.shop !== '整体' ? item.shop : item.name;
      return escapeHtml(s);
    });
    return [...new Set(shops)].join(' · ');
  }

  // 3. 普通食堂（只保留楼层和菜名）
  const groups = new Map();
  for (const item of recs) {
    const key = item.floor ? `${item.floor}` : 'none';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === 'none') return 1;
    if (b === 'none') return -1;
    return Number(a) - Number(b);
  });

  const lines = [];
  for (const key of sortedKeys) {
    const items = groups.get(key);
    // 直接连菜名
    const dishTexts = items.map(item => {
      let name = item.name;
      const period = item.mealPeriod ? `（${periodLabel(item.mealPeriod)}）` : '';
      return escapeHtml(`${name}${period}`);
    }).join(' · ');
    
    // 加上楼层前缀
    const prefix = key === 'none' ? '' : (key === '-1' ? 'B1 楼：' : `${key} 楼：`);
    lines.push(`${prefix}${dishTexts}`);
  }
  
  return lines.join('<br>');
}

function categoriesForText(words) {
  return Object.entries(typePatterns)
    .filter(([, pattern]) => pattern.test(words))
    .map(([category]) => category);
}

function categoriesOf(place) {
  return categoriesForText([place.name, ...place.recommendations.map(item => item.name)].join(' '));
}

function chooseResult(place, quick) {
  if (place.placeType !== 'canteen' || !place.recommendations.length) {
    return { ...place, featuredRecommendation: null };
  }
  let choices = place.recommendations;
  if (!quick && state.types.size) {
    const matching = choices.filter(item => categoriesForText(item.name).some(type => state.types.has(type)));
    if (matching.length) choices = matching;
  }
  return { ...place, featuredRecommendation: choices[Math.floor(Math.random() * choices.length)] };
}

function locationFor(place, featuredRecommendation = null) {
  if (place.placeType === 'canteen') {
    if (!featuredRecommendation?.floor) return place.name;
    const floor = { 1: '一', 2: '二', 3: '三' }[featuredRecommendation.floor] ?? featuredRecommendation.floor;
    return `${place.name.replace(/食堂$/, '')}${floor}楼`;
  }
  const location = (place.locationNote || '').split(/[；;]/)[0].trim();
  if (location) return location;
  if (place.parentId) {
    const parent = state.places.find(item => item.id === place.parentId);
    if (parent) return parent.name;
  }
  return place.name;
}

function normalizePlaces(list) {
  if (!Array.isArray(list)) throw new Error('地点数据格式不正确');
  return list.map(place => ({
    ...place,
    mapX: place.mapX !== null && place.mapX !== undefined && Number.isFinite(Number(place.mapX)) ? Number(place.mapX) : null,
    mapY: place.mapY !== null && place.mapY !== undefined && Number.isFinite(Number(place.mapY)) ? Number(place.mapY) : null,
    longitude: place.longitude !== null && place.longitude !== undefined && Number.isFinite(Number(place.longitude)) ? Number(place.longitude) : null,
    latitude: place.latitude !== null && place.latitude !== undefined && Number.isFinite(Number(place.latitude)) ? Number(place.latitude) : null,
    coordinateSource: place.coordinateSource || null,
    locationStatus: place.locationStatus || '未定位',
    recommendations: Array.isArray(place.recommendations) ? place.recommendations : [],
  }));
}

function fromSeed(seed) {
  if (!Array.isArray(seed.places) || !Array.isArray(seed.recommendations)) {
    throw new Error('种子数据格式不正确');
  }
  const byPlace = new Map(seed.places.map(place => [place.id, []]));
  for (const item of seed.recommendations) {
    byPlace.get(item.placeId)?.push({
      id: item.id,
      placeId: item.placeId,
      name: item.name,
      floor: item.floor ?? null,
      note: item.note ?? null,
      shop: item.shop ?? null,   // 加上这行
      price: item.price ?? null, // 加上这行
      mealPeriod: item.mealPeriod ?? null,
      sourceLabel: item.sourceLabel,
      verificationStatus: item.verificationStatus === '已核实' ? '已确认' : (item.verificationStatus || '待确认'),
            rating: item.rating ?? 3.0,
      ratingCount: item.ratingCount ?? 0,
      tags: item.tags || [], // 👈 加上这一行，保证本地模式也能读到标签
    });
  }
  return seed.places.map(place => ({
    id: place.id,
    name: place.name,
    placeType: place.placeType,
    sourceGroup: place.sourceGroup,
    parentId: place.parentId ?? null,
    campusArea: place.campusArea ?? null,
    locationNote: place.locationNote ?? null,
    mapX: place.mapX ?? null,
    mapY: place.mapY ?? null,
    longitude: place.longitude ?? null,
    latitude: place.latitude ?? null,
    coordinateSource: place.coordinateSource ?? null,
    locationStatus: place.locationStatus ?? '未定位',
    sourceLabel: place.sourceLabel,
    verificationStatus: place.verificationStatus === '已核实' ? '已确认' : (place.verificationStatus || '待确认'),
    lastConfirmedAt: place.lastConfirmedAt ?? null,
    recommendations: byPlace.get(place.id) ?? [],
  }));
}

async function readJson(path) {
  const response = await fetch(new URL(path, document.baseURI), { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}：HTTP ${response.status}`);
  return response.json();
}

// 用来清理和修正 seed.json 里的历史遗留脏数据
function cleanSeedData() {
  const byPlace = (id) => state.places.find(p => p.id === id);

  // 1. 处理驴打滚：把集锦园的移到校医院，删掉校医院原有的
  const hospital = byPlace('stall-hospital');
  if (hospital) {
    hospital.recommendations = hospital.recommendations.filter(r => r.name !== '驴打滚');
    const jijinyuan = byPlace('canteen-jijinyuan');
    if (jijinyuan) {
      const lvdagun = jijinyuan.recommendations.find(r => r.name === '驴打滚');
      if (lvdagun) {
        lvdagun.placeId = 'stall-hospital';
        lvdagun.name = '驴打滚';
        hospital.recommendations.push(lvdagun);
        jijinyuan.recommendations = jijinyuan.recommendations.filter(r => r.name !== '驴打滚');
      }
    }
  }

  // 2. 清理西一食堂重复的麻辣香锅
  const xiyi = byPlace('canteen-xiyi');
  if (xiyi) {
    const seen = new Set();
    xiyi.recommendations = xiyi.recommendations.filter(r => {
      if (r.name === '麻辣香锅') {
        if (seen.has(r.name)) return false;
        seen.add(r.name);
      }
      return true;
    });
  }

  // 3. 西二食堂的麻辣烫移到一楼
  const xier = byPlace('canteen-xier');
  if (xier) {
    xier.recommendations.forEach(r => {
      if (r.name === '麻辣烫') r.floor = 1;
    });
    
    
  }

  // 5. 拆分东一水吧合集
  const dongyi = byPlace('canteen-dongyi');
  if (dongyi) {
    const shuibaIndex = dongyi.recommendations.findIndex(r => r.name.includes('芒果芦荟茶、蜜桃番石榴'));
    if (shuibaIndex > -1) {
      const old = dongyi.recommendations[shuibaIndex];
      dongyi.recommendations.splice(shuibaIndex, 1);
      const items = ['芒果芦荟茶', '蜜桃番石榴', '鲜果汁', '多料烧仙草奶茶', '奇异百香果', '红豆布丁奶绿', '可可冰麦', '雪山葡萄鲜牛乳'];
      items.forEach(item => {
        dongyi.recommendations.push({
          ...old,
          id: `rec-dongyi-shuiba-${item}`,
          name: item,
          note: '水吧特饮'
        });
      });
    }

    // 6. 东一轻食套餐改名，避免以为是单品
    dongyi.recommendations.forEach(r => {
      if (r.name.includes('土豆泥、紫薯酱')) {
        r.name = '轻食自选拼盘（含土豆泥等）';
      }
    });
  }

  // 7. 修正世界城烧饼的店铺名
    
      // 8. 整理东边CBD的数据，补全周麻婆、吉野家、汉堡王，并修正氧气层
  const cbd = byPlace('shop-dongbiancbd');
  if (cbd) {
    const cbdShopByDish = {
      '黑椒牛肉': '周麻婆',
      '黄油啤酒': '氧气层',
      '泰式打抛饭': '氧气层',
      '鱿鱼包浆豆腐': '氧气层',
      '印度黄油鸡配烤饼': '氧气层',
      '松板肉': '氧气层',
      '泰式醉鬼炒面': '氧气层',
    };
    cbd.recommendations.forEach(r => {
      const mapped = cbdShopByDish[r.name];
      if (mapped) r.shop = mapped;
      else if (!r.shop || r.shop.includes('氧气层')) r.shop = '氧气层';
    });

    const addCbdItem = (name, shop, note) => {
      if (!cbd.recommendations.some(r => r.name === name && r.shop === shop)) {
        cbd.recommendations.push({
          id: `rec-cbd-${shop}-${name}`,
          placeId: 'shop-dongbiancbd',
          name: name,
          shop: shop,
          note: note,
          price: '未标价',
          verificationStatus: '已确认'
        });
      }
    };

    // 补全周麻婆
    addCbdItem('麻婆豆腐', '周麻婆', '推荐');
    addCbdItem('皮蛋辣椒擂茄子', '周麻婆', '推荐');
    addCbdItem('烤鱼', '周麻婆', '推荐');
    addCbdItem('黑椒牛肉', '周麻婆', '推荐'); // 把这个从氧气层纠正过来
    
    // 补全吉野家
    addCbdItem('招牌牛肉饭', '吉野家', '推荐');
    addCbdItem('照烧鸡排饭', '吉野家', '推荐');
    addCbdItem('鳗鱼饭', '吉野家', '推荐');

    // 补全汉堡王
    addCbdItem('汉堡套餐', '汉堡王', '都好吃');
  }
         // 9. 调整特定店名的区域归属（跨区调整）
  const updateArea = (name, area) => {
    const p = state.places.find(item => item.name === name);
    if (p) p.campusArea = area;
  };

  // 中区（中间）校外
  updateArea('张亮麻辣烫', 'central');
  updateArea('鱼来鱼美', 'central');
  updateArea('锅神麻辣烫', 'central'); 
  updateArea('东乡人家', 'central'); // 东乡人家回中区
  
  // 东区校外
  updateArea('老兵烧烤', 'east');
  updateArea('东小门外西安特色小吃', 'east');
  updateArea('生活门螺蛳粉', 'east'); 
  
  // 西区校外
  updateArea('南三门鸭血粉丝汤', 'west');

  // 🌟 把 杨国福 和 沙市女人串串 合并进光谷步行街
  const buxingjie = state.places.find(p => p.name === '光谷步行街');
  if (buxingjie) {
    // 处理杨国福麻辣烫
    const yangguofu = state.places.find(p => p.name === '杨国福麻辣烫');
    if (yangguofu) {
      yangguofu.recommendations.forEach(r => {
        r.shop = '杨国福麻辣烫';
        buxingjie.recommendations.push(r);
      });
      state.places = state.places.filter(p => p !== yangguofu); // 删掉独立地点
    }

    // 处理沙市女人串串 (顺便改名)
    const shashi = state.places.find(p => p.name === '沙市女人串串');
    if (shashi) {
      shashi.recommendations.forEach(r => {
        r.shop = '长沙市女人串串';
        buxingjie.recommendations.push(r);
      });
      state.places = state.places.filter(p => p !== shashi); // 删掉独立地点
    }
  }
      // 10. 重构崧邻里数据（精细调整店铺名、推荐菜与评价）
  const songlinlis = state.places.filter(p => p.name.includes('菘邻里') || p.name.includes('崧邻里'));
  if (songlinlis.length > 0) {
    const mainSonglinli = songlinlis[0];
    mainSonglinli.name = '崧邻里'; // 统一名字
    mainSonglinli.placeType = 'food_court';
    mainSonglinli.recommendations = [
      // 袁记云饺
      { id: 'rec-songlinli-01', placeId: mainSonglinli.id, name: '鲜虾蟹籽云吞', shop: '袁记云饺', note: '推荐', price: '未标价' },
      { id: 'rec-songlinli-02', placeId: mainSonglinli.id, name: '冬菇马蹄鲜肉云吞', shop: '袁记云饺', note: '推荐', price: '未标价' },
      { id: 'rec-songlinli-03', placeId: mainSonglinli.id, name: '椒麻干拌', shop: '袁记云饺', note: '口味推荐', price: '未标价' },
      { id: 'rec-songlinli-04', placeId: mainSonglinli.id, name: '剁椒红油花生酱干拌', shop: '袁记云饺', note: '口味推荐', price: '未标价' },
      { id: 'rec-songlinli-05', placeId: mainSonglinli.id, name: '老坛酸菜汤', shop: '袁记云饺', note: '口味推荐', price: '未标价' },
      
      // 赛百味与超吉卷
      { id: 'rec-songlinli-06', placeId: mainSonglinli.id, name: '三明治系列', shop: '赛百味', note: '推荐', price: '未标价' },
      { id: 'rec-songlinli-07', placeId: mainSonglinli.id, name: '卷饼类', shop: '超吉卷', note: '推荐', price: '未标价' },
      
      // 中百芊爽轻食 (包含菜品与酱料)
      { id: 'rec-songlinli-08', placeId: mainSonglinli.id, name: '韩式荞麦牛肉拌面', shop: '中百芊爽轻食', note: '推荐', price: '未标价' },
      { id: 'rec-songlinli-09', placeId: mainSonglinli.id, name: '蜜汁鸡腿排能量碗', shop: '中百芊爽轻食', note: '推荐', price: '未标价' },
      { id: 'rec-songlinli-10', placeId: mainSonglinli.id, name: '无色辣拌鸡肉暖沙拉', shop: '中百芊爽轻食', note: '推荐', price: '未标价' },
      { id: 'rec-songlinli-11', placeId: mainSonglinli.id, name: '蜜汁鸡腿排热压三明治', shop: '中百芊爽轻食', note: '推荐', price: '未标价' },
      { id: 'rec-songlinli-12', placeId: mainSonglinli.id, name: '浓香红烧牛肉饭', shop: '中百芊爽轻食', note: '推荐', price: '未标价' },
      { id: 'rec-songlinli-13', placeId: mainSonglinli.id, name: '蜜汁烧椒酱', shop: '中百芊爽轻食', note: '酱料推荐', price: '未标价' },
      { id: 'rec-songlinli-14', placeId: mainSonglinli.id, name: '秘制牛肉酱', shop: '中百芊爽轻食', note: '酱料推荐', price: '未标价' },
      { id: 'rec-songlinli-15', placeId: mainSonglinli.id, name: '日式油醋汁', shop: '中百芊爽轻食', note: '酱料推荐', price: '未标价' },
      { id: 'rec-songlinli-16', placeId: mainSonglinli.id, name: '美式甜辣酱', shop: '中百芊爽轻食', note: '酱料推荐', price: '未标价' },
      
      // 夏威驿西餐
      { id: 'rec-songlinli-17', placeId: mainSonglinli.id, name: '小龙虾意面', shop: '夏威驿西餐', note: '比较便宜吧味道一般', price: '未标价' },
      
      // 有家便利店
      { id: 'rec-songlinli-18', placeId: mainSonglinli.id, name: '关东煮', shop: '有家便利店', note: '比较鲜美，24h营业，半夜还可以出来吃', price: '未标价' },
      
      // 其他店铺
      { id: 'rec-songlinli-19', placeId: mainSonglinli.id, name: '披萨', shop: '达美乐', note: '推荐', price: '未标价' },
      { id: 'rec-songlinli-20', placeId: mainSonglinli.id, name: '冒菜', shop: '冒大仙冒菜', note: '推荐', price: '未标价' },
      { id: 'rec-songlinli-21', placeId: mainSonglinli.id, name: '米线', shop: '曾三仙米线', note: '推荐', price: '未标价' }
    ];
    
    // 删除重复的崧邻里节点
    for (let i = 1; i < songlinlis.length; i++) {
      state.places = state.places.filter(p => p !== songlinlis[i]);
    }
  }
        // 11. 整理百景园数据（把 3 楼挪给子节点，父节点留提示）
  const baijingyuan = byPlace('canteen-baijingyuan');
  const baijingyuan3f = byPlace('canteen-baijingyuan-3f');
  if (baijingyuan && baijingyuan3f) {
    // 删掉合菜、多余的牛肉饭，以及误当成菜的店铺名
    baijingyuan.recommendations = baijingyuan.recommendations.filter(r => 
      r.shop !== '合菜' && 
      r.name !== '牛肉饭' && 
      r.name !== '池奈' && 
      r.name !== '拌壹桶'
    );

    // 提取父节点里 3 楼的数据
    const floor3Recs = baijingyuan.recommendations.filter(r => r.floor === 3);
    // 父节点移除 3 楼数据
    baijingyuan.recommendations = baijingyuan.recommendations.filter(r => r.floor !== 3);

    // 如果子节点原本没数据，借用父节点挪过来的
    if (baijingyuan3f.recommendations.length === 0 && floor3Recs.length > 0) {
      baijingyuan3f.recommendations = floor3Recs;
    }

    // 确保子节点的数据带上正确的 shop
    baijingyuan3f.recommendations.forEach(r => {
      r.placeId = 'canteen-baijingyuan-3f';
      if (r.name.includes('麻辣拌')) r.shop = '拌壹桶';
      else if (['雪花肥牛番茄蛋包饭', '各口味咖喱蛋包饭', '乌冬面', '池奈'].some(k => r.name.includes(k))) r.shop = '池奈';
      r.floor = 3;
    });

    // 给父节点补一条假数据，让它显示“3楼：见百景园三楼”
    baijingyuan.recommendations.push({
      id: 'rec-bj-link-3f',
      placeId: 'canteen-baijingyuan',
      name: '见百景园三楼',
      floor: 3,
      verificationStatus: '已确认'
    });
  }

  // 11. 删除“老街烧烤”地点及其所有菜品
  const laojieIndex = state.places.findIndex(p => p.name === '老街烧烤');
  if (laojieIndex > -1) {
    state.places.splice(laojieIndex, 1);
  }
  
}

async function loadPlaces() {
 


  // 2. 优先从服务端 API 加载
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(new URL('./api/places', document.baseURI), {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const body = await response.json();
      if (body.places && body.places.length) {
        if (body.recommendations) {
          state.places = normalizePlaces(fromSeed(body));
        } else {
          state.places = normalizePlaces(body.places);
        }
        cleanSeedData();
        state.source = '服务端数据';
        state.hasBackend = true;
        $('#home-feed-count').textContent = `已收集 ${state.places.length} 个地点 · ${state.source}`;
        $('#count').textContent = `${state.places.length} 个地点`;
        loadCalibrationDraft();
        renderCalibrationPanel();
        renderAllPlaces();
        renderMap();
        renderHomeFeed();
        populateFeedbackPlaces();
        window.dispatchEvent(new CustomEvent('hustmap:data-loaded', { detail: { places: state.places } }));
        return;
      }
    }
  } catch (apiError) {
    console.log('后端 API 不可用，降级到本地 seed.json：', apiError.message || apiError.name);
  }

  // 3. 降级：读取 seed.json
  state.hasBackend = false;
  try {
    const seed = await readJson('./database/seed.json');
    state.places = normalizePlaces(fromSeed(seed));
    cleanSeedData();
    state.source = '项目组公开清单（本地模式）';
  } catch (seedError) {
    console.error('加载觅食点失败：', seedError);
    $('#home-feed-list').innerHTML = '<div class="empty">数据加载失败，请刷新页面重试。</div>';
    $('#adminlist').textContent = '数据加载失败，请通过本地服务或 GitHub Pages 打开网页后重试。';
    toast('觅食点加载失败，请检查 seed.json 格式是否正确');
    return;
  }

  $('#home-feed-count').textContent = `已收集 ${state.places.length} 个地点 · ${state.source}`;
  $('#count').textContent = `${state.places.length} 个地点`;
  loadCalibrationDraft();
  renderCalibrationPanel();
  renderAllPlaces();
  renderMap();
  renderHomeFeed();
  populateFeedbackPlaces();
  window.dispatchEvent(new CustomEvent('hustmap:data-loaded', { detail: { places: state.places } }));
}
 



function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2300);
}

function go(view, { resetScroll = true, updateHistory = true } = {}) {
  document.querySelectorAll('.view').forEach(element => {
    element.classList.toggle('active', element.id === view);
  });
  const activeNav = ['results', 'detail'].includes(view) ? 'home' : view;
  document.querySelectorAll('.nav [data-go]').forEach(button => {
    if (button.dataset.go === activeNav) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (view === 'admin') renderAllPlaces();
    if (view === 'rating') renderRating();
  if (view === 'review') renderReview();
  if (view === 'dishes') renderDishes(); 
  if (view === 'forum') window.renderForumPage?.();
  if (view === 'agent') window.renderAgentPage?.();
  if (view === 'home') {
    renderMap();
    setTimeout(() => leafletMap?.invalidateSize(), 0);
  }
  if (updateHistory && location.hash !== `#${view}`) history.pushState({ view }, '', `#${view}`);
  if (resetScroll) scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToMap(behavior = 'smooth') {
  go('home', { resetScroll: false, updateHistory: false });
  if (location.hash !== '#map') history.pushState({ view: 'map' }, '', '#map');
  setTimeout(() => {
    const mapSection = $('#home-map');
    if (mapSection) {
      const top = mapSection.getBoundingClientRect().top + window.scrollY - 18;
      window.scrollTo({ top, behavior });
    }
    leafletMap?.invalidateSize();
  }, 80);
}

let leafletMap = null;
let leafletMarkerLayer = null;
const leafletMarkerByPlace = new Map();

function mapKind(place) {
  return place.placeType === 'canteen' || place.placeType === 'stall' || place.sourceGroup === '食堂'
    ? 'canteen'
    : 'shop';
}

function calibrationTargets() {
  const groups = new Map();
  for (const place of state.places) {
    if (place.longitude === null || place.latitude === null) continue;
    const key = `${place.longitude.toFixed(7)}:${place.latitude.toFixed(7)}`;
    const group = groups.get(key) ?? {
      id: place.id,
      placeIds: [],
      names: [],
      originalLatitude: place.latitude,
      originalLongitude: place.longitude,
    };
    group.placeIds.push(place.id);
    group.names.push(place.name);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const places = group.placeIds.map(id => state.places.find(place => place.id === id)).filter(Boolean);
    const parent = places.find(place => place.placeType === 'food_court');
    const sharedLocation = places.every(place => place.locationNote && place.locationNote === places[0]?.locationNote)
      ? places[0].locationNote
      : null;
    return { ...group, label: parent?.name || sharedLocation || places[0]?.name || group.id };
  });
}

function calibrationForPlace(id) {
  return state.calibrations.find(item => item.placeIds.includes(id)) ?? null;
}

function effectiveCoordinates(place) {
  const calibration = calibrationForPlace(place.id);
  if (calibration) {
    // 校准坐标是从地图上点击获取的，已经是当前底图坐标系
    return { latitude: calibration.latitude, longitude: calibration.longitude };
  }
  // 原始数据坐标是 WGS84，需要转换到当前底图坐标系
  const converted = toMapCoords(place.longitude, place.latitude);
  return { latitude: converted.lat, longitude: converted.lng };
}

function loadCalibrationDraft() {
  try {
    const stored = JSON.parse(localStorage.getItem(calibrationStorageKey) || '[]');
    const validIds = new Set(state.places.map(place => place.id));
    state.calibrations = Array.isArray(stored) ? stored.filter(item => (
      Array.isArray(item.placeIds)
      && item.placeIds.length
      && item.placeIds.every(id => validIds.has(id))
      && Number.isFinite(Number(item.latitude))
      && Number.isFinite(Number(item.longitude))
    )).map(item => ({ ...item, latitude: Number(item.latitude), longitude: Number(item.longitude) })) : [];
  } catch (error) {
    console.warn('读取校准草稿失败：', error);
    state.calibrations = [];
  }
}

function saveCalibrationDraft() {
  try {
    localStorage.setItem(calibrationStorageKey, JSON.stringify(state.calibrations));
  } catch (error) {
    console.warn('保存校准草稿失败：', error);
    toast('浏览器无法保存草稿，请及时下载校准结果');
  }
}

function calibrationExport() {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    note: '华科觅食地图浏览器校准草稿；人工圈点仅作为大致位置，尚未写入线上数据',
    calibrations: state.calibrations.map(item => ({
      targetId: item.targetId,
      label: item.label,
      placeIds: item.placeIds,
      names: item.names,
      latitude: item.latitude,
      longitude: item.longitude,
      locationStatus: '大致位置',
      originalLatitude: item.originalLatitude,
      originalLongitude: item.originalLongitude,
    })),
  };
}

function renderCalibrationPanel() {
  const panel = $('#calibration-panel');
  const select = $('#calibration-target');
  if (!panel || !select) return;
  const targets = calibrationTargets();
  if (!state.calibrationTargetId || !targets.some(target => target.id === state.calibrationTargetId)) {
    state.calibrationTargetId = targets[0]?.id ?? null;
  }
  select.innerHTML = targets.map(target => {
    const done = state.calibrations.some(item => item.targetId === target.id);
    return `<option value="${escapeHtml(target.id)}"${target.id === state.calibrationTargetId ? ' selected' : ''}>${done ? '✓ ' : ''}${escapeHtml(target.label)}${target.names.length > 1 ? `（${target.names.length} 个地点）` : ''}</option>`;
  }).join('');
  panel.hidden = !state.calibrationMode;
  $('#campus-map').classList.toggle('calibration-active', state.calibrationMode);
  const current = state.calibrations.find(item => item.targetId === state.calibrationTargetId);
  const status = current
    ? `<strong>当前已记录</strong><br>${current.latitude.toFixed(7)}, ${current.longitude.toFixed(7)}`
    : '<strong>当前尚未记录</strong><br>请在地图上单击正确位置';
  $('#calibration-status').innerHTML = `${status}<br>本浏览器已记录：${state.calibrations.length} 处`;
  $('#calibration-undo').disabled = !current;
  $('#calibration-copy').disabled = state.calibrations.length === 0;
  $('#calibration-download').disabled = state.calibrations.length === 0;
  $('#calibration-clear').disabled = state.calibrations.length === 0;
}

function focusCalibrationTarget() {
  const target = calibrationTargets().find(item => item.id === state.calibrationTargetId);
  if (!target || !leafletMap) return;
  const marker = target.placeIds.map(id => leafletMarkerByPlace.get(id)).find(Boolean);
  const calibration = state.calibrations.find(item => item.targetId === target.id);
  const point = marker?.getLatLng() ?? (calibration
    ? { lat: calibration.latitude, lng: calibration.longitude }
    : { lat: target.originalLatitude, lng: target.originalLongitude });
  leafletMap.flyTo(point, Math.max(17, leafletMap.getZoom()), { duration: 0.55 });
}

function recordCalibration(latitude, longitude) {
  const target = calibrationTargets().find(item => item.id === state.calibrationTargetId);
  if (!target) return toast('请先选择一个待校准地点');
  const record = {
    ...target,
    targetId: target.id,
    latitude: Number(latitude.toFixed(7)),
    longitude: Number(longitude.toFixed(7)),
  };
  state.calibrations = state.calibrations.filter(item => item.targetId !== target.id);
  state.calibrations.push(record);
  saveCalibrationDraft();
  renderMap();
  renderCalibrationPanel();
  toast(`已记录：${target.label}`);
}

function stopCalibration() {
  state.calibrationMode = false;
  renderCalibrationPanel();
  toast('已退出位置校准');
}

function startCalibrationForPlace(id) {
  const target = calibrationTargets().find(item => item.placeIds.includes(id));
  if (!target) return toast('这个地点暂时没有可校准的地图标记');
  state.calibrationTargetId = target.id;
  state.calibrationMode = true;
  state.mapType = 'all';
  state.mapSearchQuery = '';
  $('#map-search').value = '';
  document.querySelectorAll('#map-filters [data-map-type]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mapType === 'all'));
  });
  closeMapPopup();
  renderMap();
  renderCalibrationPanel();
  scrollToMap();
  setTimeout(focusCalibrationTarget, 180);
  toast(`请在地图上单击“${target.label}”的正确位置`);
}

async function copyCalibrationResult() {
  const text = JSON.stringify(calibrationExport(), null, 2);
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    toast('校准结果已复制，可以直接发给项目维护者');
  } catch (error) {
    console.warn('复制校准结果失败：', error);
    toast('复制失败，请使用“下载 JSON”');
  }
}

function downloadCalibrationResult() {
  const blob = new Blob([JSON.stringify(calibrationExport(), null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `hustmap-calibration-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('校准结果已下载');
}

function mapGroups() {
  const groups = new Map();
  for (const place of state.places) {
    const coordinates = effectiveCoordinates(place);
    if (coordinates.longitude === null || coordinates.latitude === null) continue;
    const key = `${coordinates.longitude.toFixed(5)}:${coordinates.latitude.toFixed(5)}`;
    const group = groups.get(key) ?? {
      longitude: coordinates.longitude,
      latitude: coordinates.latitude,
      places: [],
    };
    group.places.push(place);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function mapGroupMatches(group) {
  const query = state.mapSearchQuery;
  return group.places.some(place => {
    const kindMatches = state.mapType === 'all' || mapKind(place) === state.mapType;
    const textMatches = !query || [place.name, place.locationNote, ...place.recommendations.map(item => item.name)]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(query));
    return kindMatches && textMatches;
  });
}

function initializeLeafletMap() {
  if (leafletMap) return true;
  const container = $('#campus-map');
  if (!container) return false;
  if (!window.L) {
    $('#map-loading').innerHTML = '在线地图组件加载失败，请检查网络后刷新。<br><a href="https://map.hust.edu.cn/" target="_blank" rel="noopener">打开华科官方地图</a>';
    return false;
  }

  leafletMap = L.map(container, {
    minZoom: 15,
    maxZoom: 19,
    zoomControl: true,
    // 初始边界限制（GCJ-02，华科主校区及周边），switchTileProvider 会更新精确值
    maxBounds: L.latLngBounds([30.4980, 114.3800], [30.5360, 114.4500]),
    maxBoundsViscosity: 0, // 边界弹性，0 为完全不能拖出，1 为完全弹性
  });
  leafletMarkerLayer = L.layerGroup().addTo(leafletMap);

  // ===== 极简模式：建筑轮廓图层 =====
  let buildingLayer = null;
  let buildingLabelLayer = null;
  let buildingData = null;
  let buildingsLoaded = false;

  // 需要显示名称标注的建筑关键词（食堂 + 重点教学楼 + 地标）
  const labelKeywords = {
    canteen: ['食堂', '餐厅', '美食', '饭'],
    landmark: ['教学楼', '图书馆', '体育馆', '主楼', '逸夫', '大学生活动中心', '东九', '西十二', '西九楼', '西一楼', '东一楼'],
  };

  function shouldShowBuildingLabel(name) {
    if (!name) return false;
    for (const kw of labelKeywords.canteen) {
      if (name.includes(kw)) return true;
    }
    for (const kw of labelKeywords.landmark) {
      if (name.includes(kw)) return true;
    }
    return false;
  }

  async function loadBuildings() {
    if (buildingsLoaded) return;
    buildingsLoaded = true;
    try {
      const resp = await fetch('/data/hust_buildings.geojson');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      buildingData = await resp.json();
    } catch (e) {
      console.warn('建筑数据加载失败:', e);
    }
  }

  function showBuildingLayer() {
    if (buildingLayer) return;
    if (!buildingData) {
      loadBuildings().then(() => showBuildingLayer());
      return;
    }

    // 建筑填充多边形
    buildingLayer = L.geoJSON(buildingData, {
      style: function (feature) {
        return {
          fillColor: '#e8ddd0',     // 建筑填充色（暖米色，跟页面配色协调）
          fillOpacity: 1,
          color: '#d4c4b0',         // 建筑边框色
          weight: 0.5,
          opacity: 1,
        };
      },
      // 坐标转换：OSM 是 WGS84，需要转成当前底图坐标系
      coordsToLatLng: function (coords) {
        const converted = toMapCoords(coords[0], coords[1]);
        return L.latLng(converted.lat, converted.lng);
      },
    }).addTo(leafletMap);

    // 建筑名称标注（只显示食堂和重点地标）
    buildingLabelLayer = L.layerGroup().addTo(leafletMap);
    buildingData.features.forEach(feature => {
      const name = feature.properties.name;
      if (!shouldShowBuildingLabel(name)) return;

      // 计算多边形中心点
      const coords = feature.geometry.coordinates[0];
      let sumLng = 0, sumLat = 0;
      for (const c of coords) {
        sumLng += c[0];
        sumLat += c[1];
      }
      const centerLng = sumLng / coords.length;
      const centerLat = sumLat / coords.length;
      const converted = toMapCoords(centerLng, centerLat);

      // 用 divIcon 创建文字标注
      const label = L.marker([converted.lat, converted.lng], {
        icon: L.divIcon({
          className: 'building-label',
          html: `<span class="building-label-text">${escapeHtml(name)}</span>`,
          iconSize: [100, 16],
          iconAnchor: [50, 8],
        }),
        interactive: false,
      });
      buildingLabelLayer.addLayer(label);
    });

    // 把建筑图层移到标记图层下面
    if (buildingLayer) buildingLayer.bringToBack();
  }

  function hideBuildingLayer() {
    if (buildingLayer) {
      leafletMap.removeLayer(buildingLayer);
      buildingLayer = null;
    }
    if (buildingLabelLayer) {
      leafletMap.removeLayer(buildingLabelLayer);
      buildingLabelLayer = null;
    }
  }

  function refreshBuildingLayer() {
    if (!buildingLayer) return;
    const wasVisible = !!buildingLayer;
    hideBuildingLayer();
    if (wasVisible) showBuildingLayer();
  }

  // 瓦片源配置：多个底图可选
  // coordSystem: 底图使用的坐标系（gcj02 或 wgs84）
  // type: tile（瓦片底图）或 minimal（极简建筑模式）
  const tileProviders = {
    amapVector: {
      name: '高德街道',
      coordSystem: 'gcj02',
      type: 'tile',
      url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      options: {
        minZoom: 15,
        maxZoom: 19,
        subdomains: '1234',
        attribution: '&copy; 高德地图',
      },
    },
    amapSatellite: {
      name: '高德卫星',
      coordSystem: 'gcj02',
      type: 'tile',
      url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
      options: {
        minZoom: 15,
        maxZoom: 19,
        subdomains: '1234',
        attribution: '&copy; 高德地图',
      },
    },
    minimal: {
      name: '极简建筑',
      coordSystem: 'gcj02',
      type: 'minimal',   // 极简模式：无瓦片，只用建筑多边形
      bgColor: '#f5efe6', // 背景色（米白色，和页面 cream 色协调）
    },
    
    osm: {
      name: 'OSM 标准',
      coordSystem: 'wgs84',
      type: 'tile',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        minZoom: 15,
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      },
    },
  };

  let currentTileLayer = null;
  let currentProviderName = 'minimal';
  let tileFailCount = 0;
  const tileFailThreshold = 10; // 失败超过这个数量就提示

  // 华科主校区范围（WGS84），用于限制地图浏览范围
    const hustBoundsWGS84 = {
    southWest: { lat: 30.4500, lng: 114.3000 },
    northEast: { lat: 30.6000, lng: 114.5500 },
  };

  function getHustBoundsForMap() {
    const sw = toMapCoords(hustBoundsWGS84.southWest.lng, hustBoundsWGS84.southWest.lat);
    const ne = toMapCoords(hustBoundsWGS84.northEast.lng, hustBoundsWGS84.northEast.lat);
    return L.latLngBounds([sw.lat, sw.lng], [ne.lat, ne.lng]);
  }

  function switchTileProvider(providerName) {
    const provider = tileProviders[providerName];
    if (!provider) return;

    const coordSystemChanged = currentCoordSystem !== provider.coordSystem;
    currentCoordSystem = provider.coordSystem;
    currentProviderName = providerName;

    // 移除旧瓦片层
    if (currentTileLayer) {
      leafletMap.removeLayer(currentTileLayer);
      currentTileLayer = null;
    }

    // 移除瓦片 CSS 滤镜
    const tilePane = leafletMap.getContainer().querySelector('.leaflet-tile-pane');
    if (tilePane) {
      tilePane.classList.remove('tile-style-minimal');
    }
    // 移除极简背景类
    container.classList.remove('map-mode-minimal');

    if (provider.type === 'minimal') {
      // ===== 极简模式：纯色背景 + 建筑多边形 =====
      container.classList.add('map-mode-minimal');
      container.classList.add('is-ready');
      updateOfflineNotice(false);
      // 设置背景色
      if (provider.bgColor) {
        leafletMap.getContainer().style.backgroundColor = provider.bgColor;
      }
      // 显示建筑图层
      showBuildingLayer();

    } else {
      // ===== 瓦片模式 =====
      leafletMap.getContainer().style.backgroundColor = '';
      // 隐藏建筑图层
      hideBuildingLayer();

      currentTileLayer = L.tileLayer(provider.url, provider.options);
      currentTileLayer.on('load', () => {
        container.classList.add('is-ready');
        tileFailCount = 0;
        updateOfflineNotice(false);
      });
      currentTileLayer.on('tileerror', () => {
        tileFailCount++;
        if (tileFailCount >= tileFailThreshold) {
          updateOfflineNotice(true, provider.name);
        }
      });
      currentTileLayer.addTo(leafletMap);

      // 应用瓦片风格 CSS
      if (tilePane && provider.tileStyle === 'minimal') {
        tilePane.classList.add('tile-style-minimal');
      }
    }

    // 更新地图边界限制
    leafletMap.setMaxBounds(getHustBoundsForMap());

    // 如果坐标系变了，需要重新渲染所有标记和建筑
    if (coordSystemChanged) {
      renderMap();
      refreshBuildingLayer();
    }

    // 更新底图切换按钮的状态
    document.querySelectorAll('[data-tile-provider]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.tileProvider === providerName));
    });
  }

  function updateOfflineNotice(show, providerName = '') {
    let notice = document.querySelector('.map-offline');
    if (show) {
      if (!notice) {
        notice = document.createElement('div');
        notice.className = 'map-offline';
        container.appendChild(notice);
      }
      notice.innerHTML = `⚠️ 当前底图（${escapeHtml(providerName)}）加载不稳定，可尝试切换其他底图`;
    } else if (notice) {
      notice.remove();
    }
  }

  switchTileProvider('minimal');
    // 👇 初始打开时，不管边界扩了多大，都强制锁定在华科中心点，并保持 16 级缩放
  const centerPoint = toMapCoords(114.415, 30.515);
  leafletMap.setView([centerPoint.lat, centerPoint.lng], 16);
  leafletMap.on('popupclose', () => {
    state.selectedMapPlaceId = null;
    updateLeafletMarkerIcons();
  });
  leafletMap.on('click', event => {
    if (!state.calibrationMode) return;
    recordCalibration(event.latlng.lat, event.latlng.lng);
  });
  setTimeout(() => container.classList.add('is-ready'), 1800);

  // 底图切换按钮事件
  document.querySelectorAll('[data-tile-provider]').forEach(button => {
    button.addEventListener('click', () => {
      const providerName = button.dataset.tileProvider;
      tileFailCount = 0;
      switchTileProvider(providerName);
    });
  });

  // 管理员编辑模式切换按钮
  $('#admin-edit-toggle')?.addEventListener('click', toggleAdminEditMode);

  return true;
}

function markerIcon(group) {
  const primary = group.places.find(place => place.placeType === 'canteen') ?? group.places[0];
  const approximate = group.places.some(place => place.locationStatus !== '已确认' || calibrationForPlace(place.id));
  const selected = group.places.some(place => place.id === state.selectedMapPlaceId);
  const recommended = state.homeRecommendationActive && group.places.some(place => state.results.some(result => result.id === place.id));
  const searched = Boolean(state.mapSearchQuery) && mapGroupMatches(group);
  const dimmed = state.homeRecommendationActive && !recommended && !searched;
  const calibrated = group.places.some(place => calibrationForPlace(place.id));
  return L.divIcon({
    className: 'food-map-icon',
    html: `<span class="geo-marker ${mapKind(primary) === 'shop' ? 'shop' : ''} ${approximate ? 'approximate' : ''} ${selected ? 'selected' : ''} ${recommended ? 'recommended' : ''} ${searched ? 'searched' : ''} ${dimmed ? 'dimmed' : ''} ${calibrated ? 'calibrated' : ''}"><span>${group.places.length > 1 ? group.places.length : '•'}</span></span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -34],
  });
}

function mapPopupContent(places) {
  const first = places[0];
  const hasCalibrationDraft = places.some(place => calibrationForPlace(place.id));
  const parent = places.find(place => place.placeType === 'food_court');
  const sharedLocation = places.every(place => place.locationNote && place.locationNote === first.locationNote)
    ? first.locationNote
    : null;
  const groupTitle = parent?.name || sharedLocation || first.name;
  const source = first.coordinateSource ? `<p>坐标来源：${escapeHtml(first.coordinateSource)}</p>` : '';
  const locationStatus = hasCalibrationDraft ? '大致位置（本地校准草稿）' : first.locationStatus;
  return `<h3>${escapeHtml(groupTitle)}</h3><p>${escapeHtml(places.map(place => place.name).join(' · '))}</p><p><span class="location-status">${escapeHtml(locationStatus)}</span>${first.locationNote && first.locationNote !== groupTitle ? ` · ${escapeHtml(first.locationNote)}` : ''}</p>${source}${places.map(place => `<button class="secondary" data-map-detail="${escapeHtml(place.id)}">查看${escapeHtml(place.name)}详情</button>`).join('')}`;
}

function updateLeafletMarkerIcons() {
  for (const marker of new Set(leafletMarkerByPlace.values())) {
    marker.setIcon(markerIcon(marker.foodGroup));
  }
}

function renderMap() {
  const groups = mapGroups();
  const visible = groups.filter(mapGroupMatches);
  $('#map-count').textContent = `${visible.reduce((sum, group) => sum + group.places.length, 0)} 个地点 · ${visible.length} 个标记`;
  if (!initializeLeafletMap()) return;

  leafletMarkerLayer.clearLayers();
  leafletMarkerByPlace.clear();
  for (const group of visible) {
    const names = group.places.map(place => place.name).join('、');
    const marker = L.marker([group.latitude, group.longitude], {
      icon: markerIcon(group),
      title: names,
      alt: names,
      keyboard: true,
      bubblingMouseEvents: false,
            draggable: isAdminEditMode, // 👈 允许编辑模式下的所有点拖拽//
    });
    marker.foodGroup = group;
    marker.bindPopup(mapPopupContent(group.places), { maxWidth: 320, minWidth: 240 });
    marker.on('click', () => {
      state.selectedMapPlaceId = group.places[0].id;
      updateLeafletMarkerIcons();
    });
    // 管理员编辑模式：拖拽保存位置
        if (isAdminEditMode) {  
      // 拖拽开始时关闭 popup，避免干扰
      marker.on('dragstart', (e) => {
        e.target.closePopup();
      });
      marker.on('dragend', async (e) => {
        const m = e.target;
        const latlng = m.getLatLng();
        // 把 GCJ-02 地图坐标转回 WGS-84 保存
        const wgs = gcj02ToWgs84(latlng.lng, latlng.lat);
                const place = group.places[0];
        const confirmed = confirm(`确定要把「${place.name}」及其关联地点移到新位置吗？`);
        if (!confirmed) {
          const orig = effectiveCoordinates(place);
          m.setLatLng([orig.latitude, orig.longitude]);
          return;
        }
        try {
          // 👇 循环把组内所有的地点（包括父节点和子店铺）坐标都更新一遍
          for (const p of group.places) {
            await adminRequest(`/api/admin/places/${encodeURIComponent(p.id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                longitude: wgs[0],
                latitude: wgs[1],
                locationStatus: '已确认',
                coordinateSource: '管理员拖拽定位',
              }),
            });
            // 同步更新前端内存里的数据
            const local = state.places.find(item => item.id === p.id);
            if (local) {
              local.longitude = wgs[0];
              local.latitude = wgs[1];
              local.locationStatus = '已确认';
              local.coordinateSource = '管理员拖拽定位';
            }
          }
          toast('位置已保存（已同步组内所有地点）');
          renderMap(); // 重新渲染地图
        } catch (error) {
          toast('保存失败：' + error.message);
          const orig = effectiveCoordinates(place);
          m.setLatLng([orig.latitude, orig.longitude]);
        }
      });
    }
    marker.addTo(leafletMarkerLayer);
    for (const place of group.places) leafletMarkerByPlace.set(place.id, marker);
  }

  if (state.selectedMapPlaceId && !leafletMarkerByPlace.has(state.selectedMapPlaceId)) {
    closeMapPopup();
  }
  setTimeout(() => leafletMap.invalidateSize(), 0);
}

function focusMapSearchResults() {
  if (!leafletMap || !state.mapSearchQuery) return;
  const markers = [...new Set(leafletMarkerByPlace.values())];
  if (!markers.length) return toast('地图中没有找到匹配地点');
  if (markers.length === 1) {
    const marker = markers[0];
    state.selectedMapPlaceId = marker.foodGroup.places[0].id;
    updateLeafletMarkerIcons();
    marker.openPopup();
    leafletMap.flyTo(marker.getLatLng(), 17, { duration: 0.65 });
    return;
  }
  leafletMap.fitBounds(L.featureGroup(markers).getBounds(), { padding: [55, 55], maxZoom: 16, animate: true, duration: 0.65 });
}

function closeMapPopup() {
  state.selectedMapPlaceId = null;
  leafletMap?.closePopup();
  updateLeafletMarkerIcons();
}

function showMapPopup(ids) {
  const marker = ids.map(id => leafletMarkerByPlace.get(id)).find(Boolean);
  if (!marker) return;
  state.selectedMapPlaceId = marker.foodGroup.places[0].id;
  updateLeafletMarkerIcons();
  marker.openPopup();
  leafletMap.panTo(marker.getLatLng(), { animate: true });
}

function focusPlaceOnMap(id, { scroll = true } = {}) {
  const original = state.places.find(place => place.id === id);
  if (!original) return;
  const place = original.parentId ? state.places.find(item => item.id === original.parentId) ?? original : original;
  state.mapType = 'all';
  state.mapSearchQuery = '';
  $('#map-search').value = '';
  document.querySelectorAll('#map-filters [data-map-type]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mapType === 'all'));
  });
  if (scroll) scrollToMap();
  setTimeout(() => {
    const marker = leafletMarkerByPlace.get(place.id) ?? leafletMarkerByPlace.get(original.id);
    if (!marker) return;
    leafletMap.flyTo(marker.getLatLng(), Math.max(17, leafletMap.getZoom()), { duration: 0.65 });
    showMapPopup([place.id, original.id]);
  }, scroll ? 180 : 40);
}

function updateMealButtons() {
  document.querySelectorAll('#meal [data-v]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.v === state.meal));
  });
}

function candidates(quick) {
  if (quick) return state.places.filter(place => !isFoodCourtChild(place));
  
  // 基础池：排除子节点
  const pool = state.places.filter(place => !isFoodCourtChild(place));

  // 第一层：严格匹配所有条件
  let strictMatch = pool.filter(place => {
    const areaMatches = state.area === 'all' || place.campusArea === state.area;
    const typeMatches = state.placeType === 'all' || mapKind(place) === state.placeType;
    const preferenceMatches = state.types.size === 0
      || categoriesOf(place).some(type => state.types.has(type));
    return areaMatches && typeMatches && preferenceMatches;
  });

  if (strictMatch.length > 0) return strictMatch;

  // 🚨 智能降级 1：如果严格筛选没结果，忽略“菜品偏好”，只按区域和类型找
  let relaxedMatch = pool.filter(place => {
    const areaMatches = state.area === 'all' || place.campusArea === state.area;
    const typeMatches = state.placeType === 'all' || mapKind(place) === state.placeType;
    return areaMatches && typeMatches;
  });

  if (relaxedMatch.length > 0) {
    setTimeout(() => toast('没有完全符合偏好的菜，已为你推荐同区域的其他地点'), 100);
    return relaxedMatch;
  }

  // 🚨 智能降级 2：如果连区域和类型都没结果，跨区域推荐符合偏好的
  let crossAreaMatch = pool.filter(place => {
    const preferenceMatches = state.types.size === 0
      || categoriesOf(place).some(type => state.types.has(type));
    return preferenceMatches;
  });

  if (crossAreaMatch.length > 0) {
    setTimeout(() => toast('该区域没有这类菜，已为你跨区推荐'), 100);
    return crossAreaMatch;
  }

  // 终极保底：随便选
  return pool;
}

function shuffled(list) {
  const output = [...list];
  for (let index = output.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [output[index], output[other]] = [output[other], output[index]];
  }
  return output;
}

function recommend(quick) {
  if (!state.places.length) return toast('觅食点尚未加载，请稍后重试');
  state.quickMode = quick;
  if (quick) {
    state.meal = new Date().getHours() >= 10 && new Date().getHours() < 15 ? 'lunch' : 'dinner';
    updateMealButtons();
  }

  // 👇 核心：计算每个地点的“智能综合得分”
  const scoredCandidates = candidates(quick).map(place => {
    let topScore = 0;
    place.recommendations.forEach(r => {
      // 基础分 = 评分(满分5) * 20 + 评价人数 * 5 (评价人数越多，越靠谱)
      let s = (Number(r.rating) || 3) * 20 + (Number(r.ratingCount) || 0) * 5;
      
      // 如果有特定的菜名偏好（比如选了“辣”），命中偏好额外加 100 分
      if (state.types.size > 0) {
        const cats = categoriesForText(r.name);
        if ([...state.types].some(t => cats.includes(t))) s += 100;
      }
      if (s > topScore) topScore = s;
    });
    return { place, score: topScore };
  }).sort((a, b) => b.score - a.score); // 按得分从高到低排序

  if (quick) {
    // 帮我决定：从前 10 名高分店里随机抽 3 个，保留盲盒感
    state.results = shuffled(scoredCandidates.slice(0, 10).map(c => c.place)).slice(0, 3).map(place => chooseResult(place, true));
    $('#resulttext').textContent = '从高人气地点中随机挑选；实际营业时段请到店确认。';
  } else {
    // 认真选一选：直接给出得分最高的前 12 名！
    state.results = scoredCandidates.slice(0, 12).map(c => c.place).map(place => chooseResult(place, false));
        $('#resulttext').textContent = `基于真实好评与热度，为你筛选出前 ${state.results.length} 个绝佳选择。如果你想恢复地图，可点击下方列表右上角的“退出推荐”。`;
  }

  $('#meta').textContent = quick
    ? `${mealLabel()}想吃什么 · ${state.source}`
    : `${areaLabel()} · ${placeTypeLabel()} · 智能推荐`;
  
  state.homeRecommendationActive = true;
  setDecisionTab(quick ? 'quick' : 'filter');
  
  renderHomeFeed();
  renderMap();
  setTimeout(() => focusRecommendedOnMap(), 80);
    // 👇 自动平滑滚动到下方的结果列表，让你立刻看到结果和“退出推荐”按钮
  setTimeout(() => {
    const feedSection = document.querySelector('.home-feed');
    if (feedSection) {
      feedSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 200);
}

function setDecisionTab(tab) {
  document.querySelectorAll('[data-decision-tab]').forEach(button => {
    button.setAttribute('aria-selected', String(button.dataset.decisionTab === tab));
  });
  $('#decision-quick-pane').hidden = tab !== 'quick';
  $('#decision-filter-pane').hidden = tab !== 'filter';
}



function homeFeedCard(place, index, recommended) {
  const featured = place.featuredRecommendation;
  const dish = featured?.name || place.recommendations[0]?.name || '暂无具体菜品记录';
  const location = locationFor(place, featured);
  return `<article class="feed-card">
    <span class="feed-card-top"><span class="feed-card-number">${String(index + 1).padStart(2, '0')}</span><span class="zone pending">${escapeHtml(recommended ? '为你推荐' : placeLabel(place))}</span></span>
        <h3>${escapeHtml(place.name)}</h3>
    <p><b>推荐菜品</b> · <span class="highlight-dish">${escapeHtml(dish)}</span></p>
    <p class="feed-card-meta">📍 ${escapeHtml(location)}</p>
    <p class="feed-card-meta">最近确认：${escapeHtml(place.lastConfirmedAt || '暂无确认记录')}</p>
    <div class="feed-card-actions"><button type="button" data-home-focus="${escapeHtml(place.id)}">地图定位</button><button type="button" data-home-detail="${escapeHtml(place.id)}">查看详情</button>${recommended ? `<button type="button" data-home-swap="${index}">换一家 ↻</button>` : ''}</div>
  </article>`;
}

function renderHomeFeed() {
  const list = $('#home-feed-list');
  if (!list) return;
  const recommended = state.homeRecommendationActive;
  const items = recommended ? state.results : state.places.slice(0, 6); 
  
  $('#home-feed-pill').textContent = recommended ? (state.quickMode ? '随机盲盒' : '智能精选榜单') : '本期新收录';
  $('#home-feed-title').textContent = recommended
    ? (state.quickMode ? `为你随机挑选了 ${items.length} 个` : `为你精选了 ${items.length} 个口碑好店`)
    : '新发现的觅食点';
  $('#home-feed-copy').textContent = recommended
    ? (state.quickMode ? '点击卡片可在地图中定位。' : '综合了真实用户评分与打卡人数，为你按口碑排序。')
    : '看看项目组刚整理进清单的地点，点击卡片可在地图中定位。';
  
  // 如果结果很多，动态把网格列数变多
  if (items.length > 3) {
    list.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
  } else {
    list.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
  }

  list.innerHTML = items.length
    ? items.map((place, index) => homeFeedCard(place, index, recommended)).join('')
    : '<div class="empty">没有匹配当前条件的地点，请放宽筛选后重试。</div>';
      const resetBtn = $('#reset-recommend-btn');
  if (resetBtn) {
    resetBtn.style.display = recommended ? 'inline-block' : 'none';
  }
}

function focusRecommendedOnMap() {
  if (!leafletMap || !state.results.length) return;
  const markers = state.results.map(place => leafletMarkerByPlace.get(place.id)).filter(Boolean);
  if (!markers.length) return;
  if (markers.length === 1) {
    leafletMap.flyTo(markers[0].getLatLng(), Math.max(16, leafletMap.getZoom()), { duration: 0.55 });
    return;
  }
  leafletMap.fitBounds(L.featureGroup(markers).getBounds(), { padding: [35, 35], maxZoom: 16, animate: true });
}

function card(place, index) {
  const featured = place.featuredRecommendation;
  const categories = featured ? categoriesForText(featured.name) : categoriesOf(place);
  const tags = categories.slice(0, 3).map(type => `<span class="tag">${escapeHtml(type)}</span>`).join('');
  const matchedPreferences = categories.filter(type => state.types.has(type));
  const reasons = state.quickMode
    ? ['随机遇见', areaLabel(place.campusArea), mapKind(place) === 'canteen' ? '食堂／窗口' : '校内店铺']
    : [
      state.area !== 'all' ? areaLabel(place.campusArea) : null,
      state.placeType !== 'all' ? placeTypeLabel(mapKind(place)) : null,
      matchedPreferences.length ? `符合${matchedPreferences.join('、')}偏好` : null,
    ].filter(Boolean);
  const reason = reasons.length ? reasons.join(' · ') : '从当前可选地点中随机挑选';
  return `<article class="card">
    <div class="cardtop"><span class="zone pending">${escapeHtml(placeLabel(place))}</span></div>
    <h3>${escapeHtml(place.name)}</h3>
    <p class="dish">${featured ? `推荐菜品：${escapeHtml(featured.name)}` : '可在详情中查看已收集的菜品与线索'}</p>
    ${tags ? `<div class="tags">${tags}</div>` : ''}
    <div class="reason">推荐理由：${escapeHtml(reason)}</div>
    <div class="info">📍 ${escapeHtml(locationFor(place, featured))}<br>🕒 最近确认：${escapeHtml(place.lastConfirmedAt || '暂无确认记录')}</div>
    <div class="cardactions"><button class="secondary" data-detail="${escapeHtml(place.id)}">查看详情</button><button class="secondary" data-swap="${index}">换一家 ↻</button></div>
  </article>`;
}

function renderResults() {
  const container = $('#cards');
  $('#results-title').textContent = state.results.length
    ? `${state.results.length} 个觅食选择可以先看看`
    : '暂时没有匹配的觅食选择';
  if (!state.results.length) {
    container.innerHTML = '<div class="empty">没有匹配该菜名偏好的地点，请返回并放宽选择。</div>';
    return;
  }
  container.innerHTML = state.results.map(card).join('');
}

function swap(index) {
  const used = new Set(state.results.map(place => place.id));
  const next = shuffled(candidates(state.quickMode)).find(place => !used.has(place.id));
  if (!next) return toast('当前条件下没有更多候选地点');
  state.results[index] = chooseResult(next, state.quickMode);
  renderResults();
  renderHomeFeed();
  renderMap();
  toast('已为你换一家');
}

function feedbackStatusLabel(status) {
  return ({
    '待审核': '待处理',
    '已批准': '已采纳',
    '已驳回': '未采纳',
    pending: '待处理',
    approved: '已采纳',
    rejected: '未采纳',
  }[status] || status || '待处理');
}

function localFeedbacks() {
  try {
    const stored = JSON.parse(localStorage.getItem(feedbackStorageKey) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    console.warn('读取本地反馈失败：', error);
    return [];
  }
}

let reviewFilter = '待审核';
let selectedReviewCode = '';
let adminFeedbacks = [];
let adminToken = localStorage.getItem('hustmap-admin-token') || '';
let isAdminEditMode = false;  // 管理员编辑模式：可拖拽、可增删改


function writeLocalFeedbacks(records) {
  localStorage.setItem(feedbackStorageKey, JSON.stringify(records.slice(0, 50)));
}

function showAdminLogin(message = '管理员登录后才能读取和处理反馈。') {
  $('#review-count').textContent = '未登录';
  $('#review-list').innerHTML = `<form id="admin-login-form" class="feedback-page-form"><label>管理员账号<input name="username" autocomplete="username" value="admin" required></label><label>管理员密码<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">登录审核台</button><p class="small">${escapeHtml(message)}</p></form>`;
  $('#review-detail').innerHTML = '<div class="empty">审核数据仅对经过服务端认证的管理员开放。</div>';
}

async function adminRequest(path, options = {}) {
  const response = await fetch(new URL(path, document.baseURI), {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, ...(options.headers || {}) },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    adminToken = '';
    localStorage.removeItem('hustmap-admin-token');
    throw Object.assign(new Error(body.message || '登录已失效'), { unauthorized: true });
  }
  if (!response.ok) throw new Error(body.message || '管理员请求失败');
  return body;
}

function renderReviewDetail(feedback) {
  const panel = $('#review-detail');
  if (!feedback) {
    panel.innerHTML = '<div class="empty">请从左侧选择一条反馈。</div>';
    return;
  }
  const place = state.places.find(item => item.id === feedback.placeId);
  const placeName = place?.name || feedback.proposedPlaceName || '新增地点';
  const reviewed = feedback.status !== '待审核';
  panel.innerHTML = `<span class="pill">${escapeHtml(feedbackStatusLabel(feedback.status))}</span><h2>${escapeHtml(placeName)}</h2>
    <div class="review-data"><div><b>反馈编号</b>${escapeHtml(feedback.trackingCode)}</div><div><b>反馈类型</b>${escapeHtml(feedback.feedbackType)}</div><div><b>提交时间</b>${escapeHtml(new Date(feedback.submittedAt).toLocaleString('zh-CN'))}</div><div><b>原地点</b>${escapeHtml(place?.locationNote || (feedback.placeId ? '地点信息待查看' : '无，新地点'))}</div></div>
    <div class="review-data"><div style="grid-column:1/-1"><b>用户说明</b><span class="review-evidence">${escapeHtml(feedback.details || '未填写补充说明')}</span></div></div>
    <label class="field"><span>处理说明</span><textarea id="review-note" class="review-note" maxlength="300" placeholder="说明采纳或驳回的依据。" ${reviewed ? 'disabled' : ''}>${escapeHtml(feedback.reviewNote || '')}</textarea></label>
    ${reviewed ? `<p class="notice">该反馈已经处理。如需修改结果，请在正式后台保留二次复核记录。</p>` : '<div class="review-actions"><button class="primary" data-review-action="approve">采纳反馈</button><button class="review-reject" data-review-action="reject">驳回反馈</button></div>'}`;
}

function paintReview() {
  const visible = reviewFilter === 'all' ? adminFeedbacks : adminFeedbacks.filter(item => item.status === '待审核');
  $('#review-count').textContent = `${adminFeedbacks.filter(item => item.status === '待审核').length} 条待处理`;
  $('#review-list').innerHTML = visible.length ? visible.map(item => {
    const place = state.places.find(placeItem => placeItem.id === item.placeId);
    const active = item.trackingCode === selectedReviewCode ? ' active' : '';
    const done = item.status === '待审核' ? '' : ' review-done';
    return `<button class="review-item${active}${done}" data-review-code="${escapeHtml(item.trackingCode)}"><b>${escapeHtml(place?.name || item.proposedPlaceName || '新增地点')}</b><em class="review-state">${escapeHtml(feedbackStatusLabel(item.status))}</em><span>${escapeHtml(item.feedbackType)} · ${escapeHtml(item.trackingCode)}</span></button>`;
  }).join('') : '<div class="empty">当前没有待处理反馈。可先从“反馈”页面提交一条演示数据。</div>';
  const selected = adminFeedbacks.find(item => item.trackingCode === selectedReviewCode);
  renderReviewDetail(selected);
}

async function renderReview() {
  if (!adminToken) return showAdminLogin();
  $('#review-list').innerHTML = '<div class="empty">正在读取受保护的反馈记录…</div>';
  try {
    const body = await adminRequest(`/api/admin/feedbacks?status=${reviewFilter === 'all' ? 'all' : 'pending'}`);
    adminFeedbacks = body.feedbacks;
    paintReview();
  } catch (error) {
    if (error.unauthorized) showAdminLogin(error.message);
    else showAdminLogin(`${error.message}。静态 GitHub Pages 无法运行管理员后端，请使用服务器部署版。`);
  }
}

async function loginAdmin(form) {
  const data = new FormData(form);
  const response = await fetch(new URL('./api/admin/login', document.baseURI), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: data.get('username'), password: data.get('password') }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || '管理员登录失败');
  adminToken = body.token;
  localStorage.setItem('hustmap-admin-token', adminToken);
  updateAdminModeUI();
  toast('管理员身份验证成功');
}

// 更新管理员模式相关的 UI
function updateAdminModeUI() {
  const mapBtn = $('#admin-edit-toggle');
  const dishBtn = $('#dishes-edit-toggle');
  
  if (adminToken) {
    // 如果已登录，显示按钮
    if (mapBtn) {
      mapBtn.style.display = '';
      mapBtn.textContent = isAdminEditMode ? '退出编辑' : '编辑模式';
      mapBtn.style.background = isAdminEditMode ? 'var(--red)' : '';
      mapBtn.style.color = isAdminEditMode ? '#fff' : '';
    }
    if (dishBtn) {
      dishBtn.style.display = '';
      dishBtn.textContent = isAdminEditMode ? '退出编辑模式' : '开启编辑模式';
      dishBtn.style.background = isAdminEditMode ? 'var(--red)' : '';
      dishBtn.style.color = isAdminEditMode ? '#fff' : '';
    }
  } else {
    // 没登录则彻底隐藏
    if (mapBtn) mapBtn.style.display = 'none';
    if (dishBtn) dishBtn.style.display = 'none';
    isAdminEditMode = false;
  }
  
  if (leafletMarkerLayer) renderMap();
}
// 切换管理员编辑模式
function toggleAdminEditMode() {
  if (!adminToken) return;
  isAdminEditMode = !isAdminEditMode;
  
  const currentView = document.querySelector('.view.active')?.id;
  if (currentView === 'dishes') {
    renderDishes();
  } else if (currentView === 'admin') {
    renderAllPlaces();
  }
  
  updateAdminModeUI(); // 确保按钮文字立刻变
  toast(isAdminEditMode ? '已进入编辑模式，可点击卡片修改或勾选' : '已退出编辑模式');
}
// ====== 管理员面板：标签切换 ======
let currentAdminTab = 'feedbacks';
function switchAdminTab(tabName) {
  currentAdminTab = tabName;
  document.querySelectorAll('.admin-tab[data-admin-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.adminTab === tabName);
  });
  document.querySelectorAll('.admin-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `admin-tab-${tabName}`);
  });
  if (tabName === 'places') loadAdminPlaces();
  if (tabName === 'dishes') loadAdminDishes();
  if (tabName === 'forum') window.loadForumAdminReports?.();
}

// ====== 管理员：店铺管理 ======
let adminPlacesCache = [];
let adminPlaceSearchQuery = '';

async function loadAdminPlaces() {
  if (!adminToken) return;
  try {
    const body = await adminRequest('/api/admin/places');
    adminPlacesCache = body.places;
    renderAdminPlaces();
  } catch (error) {
    if (error.unauthorized) showAdminLogin(error.message);
    else toast('加载店铺失败：' + error.message);
  }
}

function renderAdminPlaces() {
  const list = $('#admin-place-list');
  if (!list) return;
  let places = adminPlacesCache;
  if (adminPlaceSearchQuery) {
    const q = adminPlaceSearchQuery.toLowerCase();
    places = places.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }
  places.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  if (!places.length) {
    list.innerHTML = '<div class="empty">没有找到店铺</div>';
    return;
  }
  list.innerHTML = places.map(p => `
    <div class="admin-item" data-place-id="${escapeAttr(p.id)}">
      <div class="admin-item-info">
        <h4>${escapeHtml(p.name)} <span style="font-size:11px;color:var(--ink-2);font-weight:normal">${escapeHtml(p.id)}</span></h4>
        <p>${escapeHtml(p.placeType === 'canteen' ? '食堂' : p.placeType === 'food_court' ? '美食城' : p.placeType === 'stall' ? '档口' : '店铺')} · ${escapeHtml(p.sourceGroup || '')} · ${p.recommendations?.length || 0} 道菜</p>
      </div>
      <div class="admin-item-actions">
        <button class="edit-place-btn">编辑</button>
        <button class="delete-btn delete-place-btn">删除</button>
      </div>
    </div>
  `).join('');
  // 绑定事件
  list.querySelectorAll('.edit-place-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.admin-item').dataset.placeId;
      const place = adminPlacesCache.find(p => p.id === id);
      if (place) openPlaceModal(place);
    });
    
  });
  list.querySelectorAll('.delete-place-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.admin-item').dataset.placeId;
      const place = adminPlacesCache.find(p => p.id === id);
      if (!place) return;
      if (!confirm(`确定删除「${place.name}」吗？该店的所有菜品也会被一起删除，此操作不可恢复。`)) return;
      deletePlaceAdmin(id);
    });
  });
}

async function deletePlaceAdmin(id) {
  try {
    await adminRequest(`/api/admin/places/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('删除成功');
    adminPlacesCache = adminPlacesCache.filter(p => p.id !== id);
    renderAdminPlaces();
    // 同步本地数据和地图
    const idx = state.places.findIndex(p => p.id === id);
    if (idx >= 0) state.places.splice(idx, 1);
    renderMap();
  } catch (error) {
    toast('删除失败：' + error.message);
  }
}

// 店铺编辑/新增弹窗
function openPlaceModal(place = null) {
  const isEdit = !!place;
  const html = `
    <div class="admin-modal-overlay" id="place-modal-overlay">
      <div class="admin-modal">
        <h3>${isEdit ? '编辑店铺' : '新增店铺'}</h3>
        <form class="admin-modal-form" id="place-modal-form">
          <label>店铺 ID <input name="id" value="${escapeAttr(place?.id || '')}" ${isEdit ? 'readonly' : ''} placeholder="英文/拼音，如 xiyuan-canteen"></label>
          <label>店铺名称 <input name="name" value="${escapeAttr(place?.name || '')}" required></label>
          <label>类型
            <select name="placeType">
              <option value="shop" ${place?.placeType === 'shop' ? 'selected' : ''}>店铺</option>
              <option value="canteen" ${place?.placeType === 'canteen' ? 'selected' : ''}>食堂</option>
              <option value="food_court" ${place?.placeType === 'food_court' ? 'selected' : ''}>美食城</option>
              <option value="stall" ${place?.placeType === 'stall' ? 'selected' : ''}>档口</option>
            </select>
          </label>
          <label>分组
            <select name="sourceGroup">
              <option value="校内" ${place?.sourceGroup === '校内' ? 'selected' : ''}>校内</option>
              <option value="食堂" ${place?.sourceGroup === '食堂' ? 'selected' : ''}>食堂</option>
              <option value="校外" ${place?.sourceGroup === '校外' ? 'selected' : ''}>校外</option>
              <option value="外卖" ${place?.sourceGroup === '外卖' ? 'selected' : ''}>外卖</option>
            </select>
          </label>
          <label>校区区域
            <select name="campusArea">
              <option value="">（不指定）</option>
              <option value="east" ${place?.campusArea === 'east' ? 'selected' : ''}>东边</option>
              <option value="central" ${place?.campusArea === 'central' ? 'selected' : ''}>中间</option>
              <option value="west" ${place?.campusArea === 'west' ? 'selected' : ''}>西边</option>
            </select>
          </label>
          <label>父级店铺 ID（档口/子店填）<input name="parentId" value="${escapeAttr(place?.parentId || '')}" placeholder="可选"></label>
          <label>经度 (WGS84) <input name="longitude" type="number" step="0.000001" value="${place?.longitude ?? ''}" placeholder="如 114.415"></label>
          <label>纬度 (WGS84) <input name="latitude" type="number" step="0.000001" value="${place?.latitude ?? ''}" placeholder="如 30.513"></label>
          <label>位置说明 <input name="locationNote" value="${escapeAttr(place?.locationNote || '')}" placeholder="可选"></label>
          <label>定位状态
            <select name="locationStatus">
              <option value="未定位" ${place?.locationStatus === '未定位' ? 'selected' : ''}>未定位</option>
              <option value="大致位置" ${place?.locationStatus === '大致位置' ? 'selected' : ''}>大致位置</option>
              <option value="已确认" ${place?.locationStatus === '已确认' ? 'selected' : ''}>已确认</option>
            </select>
          </label>
          <label>核实状态
            <select name="verificationStatus">
              <option value="待确认" ${place?.verificationStatus === '待确认' ? 'selected' : ''}>待确认</option>
              <option value="已核实" ${place?.verificationStatus === '已核实' ? 'selected' : ''}>已核实</option>
            </select>
          </label>
          <div class="admin-modal-actions">
            <button type="button" id="place-modal-cancel">取消</button>
            <button type="submit" class="primary">${isEdit ? '保存' : '新增'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = $('#place-modal-overlay');
  $('#place-modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  $('#place-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    const body = {
      id: data.get('id').trim(),
      name: data.get('name').trim(),
      placeType: data.get('placeType'),
      sourceGroup: data.get('sourceGroup'),
      campusArea: data.get('campusArea') || null,
      parentId: data.get('parentId').trim() || null,
      longitude: data.get('longitude') ? Number(data.get('longitude')) : null,
      latitude: data.get('latitude') ? Number(data.get('latitude')) : null,
      locationNote: data.get('locationNote').trim() || null,
      locationStatus: data.get('locationStatus'),
      verificationStatus: data.get('verificationStatus'),
      sourceLabel: data.get('name').trim(),
    };
    try {
      if (isEdit) {
        await adminRequest(`/api/admin/places/${encodeURIComponent(place.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        toast('保存成功');
      } else {
        await adminRequest('/api/admin/places', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast('新增成功');
      }
      overlay.remove();
      await loadAdminPlaces();
      // 同步刷新首页数据
      await refreshPlacesData();
    } catch (error) {
      toast('操作失败：' + error.message);
    }
  });
}

// 刷新本地店铺数据
async function refreshPlacesData() {
  try {
    const response = await fetch(new URL('./api/places', document.baseURI), { cache: 'no-store' });
    const body = await response.json();
    if (body.places) {
      if (body.recommendations) {
        state.places = normalizePlaces(fromSeed(body));
      } else {
        state.places = normalizePlaces(body.places);
      }
      cleanSeedData();
      renderAllPlaces();
      renderMap();
      if (document.getElementById('dishes').classList.contains('active')) {
         renderDishes();
      }
    }
  } catch (e) {
    console.error('刷新数据失败', e);
  }
}

// ====== 管理员：菜品管理 ======
let adminDishesCache = [];
let adminDishSearchQuery = '';

async function loadAdminDishes() {
  if (!adminToken) return;
  try {
    const body = await adminRequest('/api/admin/places');
    adminPlacesCache = body.places;
    // 展开所有菜品
    adminDishesCache = [];
    for (const place of body.places) {
      if (place.recommendations) {
        for (const rec of place.recommendations) {
          adminDishesCache.push({ ...rec, placeName: place.name, placeId: place.id });
        }
      }
    }
    renderAdminDishes();
  } catch (error) {
    if (error.unauthorized) showAdminLogin(error.message);
    else toast('加载菜品失败：' + error.message);
  }
}

function renderAdminDishes() {
  const list = $('#admin-dish-list');
  if (!list) return;
  let dishes = adminDishesCache;
  if (adminDishSearchQuery) {
    const q = adminDishSearchQuery.toLowerCase();
    dishes = dishes.filter(d => d.name.toLowerCase().includes(q) || d.placeName.toLowerCase().includes(q));
  }
  dishes.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  if (!dishes.length) {
    list.innerHTML = '<div class="empty">没有找到菜品</div>';
    return;
  }
  list.innerHTML = dishes.map(d => `
    <div class="admin-item" data-dish-id="${escapeAttr(d.id)}">
      <div class="admin-item-info">
        <h4>${escapeHtml(d.name)} <span style="font-size:11px;color:var(--ink-2);font-weight:normal">${escapeHtml(d.id)}</span></h4>
        <p>所属：${escapeHtml(d.placeName)}${d.floor ? ` · ${d.floor}楼` : ''}${d.note ? ` · ${escapeHtml(d.note)}` : ''}</p>
      </div>
      <div class="admin-item-actions">
        <button class="edit-dish-btn">编辑</button>
        <button class="delete-btn delete-dish-btn">删除</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.edit-dish-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.admin-item').dataset.dishId;
      const dish = adminDishesCache.find(d => d.id === id);
      if (dish) openDishModal(dish);
    });
  });
  list.querySelectorAll('.delete-dish-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.admin-item').dataset.dishId;
      const dish = adminDishesCache.find(d => d.id === id);
      if (!dish) return;
      if (!confirm(`确定删除「${dish.name}」吗？此操作不可恢复。`)) return;
      deleteDishAdmin(id);
    });
  });
}

async function deleteDishAdmin(id) {
  try {
    await adminRequest(`/api/admin/recommendations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('删除成功');
    adminDishesCache = adminDishesCache.filter(d => d.id !== id);
    renderAdminDishes();
    // 同步本地
    await refreshPlacesData();
  } catch (error) {
    toast('删除失败：' + error.message);
  }
}

function openDishModal(dish = null) {
  const isEdit = !!dish;
  // 店铺下拉选项
  const placeOptions = adminPlacesCache
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    .map(p => `<option value="${escapeAttr(p.id)}" ${dish?.placeId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');
  const html = `
    <div class="admin-modal-overlay" id="dish-modal-overlay">
      <div class="admin-modal">
        <h3>${isEdit ? '编辑菜品' : '新增菜品'}</h3>
        <form class="admin-modal-form" id="dish-modal-form">
          <label>菜品 ID <input name="id" value="${escapeAttr(dish?.id || '')}" ${isEdit ? 'readonly' : ''} placeholder="英文/拼音，如 hongshao-rou"></label>
          <label>菜品名称 <input name="name" value="${escapeAttr(dish?.name || '')}" required></label>
          <label>所属店铺
            <select name="placeId" required>${placeOptions}</select>
          </label>
          <!-- 👇 新增这个输入框 -->
          <label>店铺名称（商场内填）<input name="shop" value="${escapeAttr(dish?.shop || '')}" placeholder="如：鱼酷、氧气层"></label>
          <label>楼层 <input name="floor" type="number" min="1" max="99" value="${dish?.floor ?? ''}" placeholder="可选"></label>
          <label>备注/描述 <textarea name="note" placeholder="可选">${escapeHtml(dish?.note || '')}</textarea></label>
          <label>时段
            <select name="mealPeriod">
              <option value="">全天</option>
              <option value="breakfast" ${dish?.mealPeriod === 'breakfast' ? 'selected' : ''}>早餐</option>
              <option value="lunch" ${dish?.mealPeriod === 'lunch' ? 'selected' : ''}>午餐</option>
              <option value="dinner" ${dish?.mealPeriod === 'dinner' ? 'selected' : ''}>晚餐</option>
            </select>
          </label>
          <label>核实状态
            <select name="verificationStatus">
              <option value="待确认" ${dish?.verificationStatus === '待确认' ? 'selected' : ''}>待确认</option>
              <option value="已核实" ${dish?.verificationStatus === '已核实' ? 'selected' : ''}>已核实</option>
            </select>
          </label>
          <div class="admin-modal-actions">
            <button type="button" id="dish-modal-cancel">取消</button>
            <button type="submit" class="primary">${isEdit ? '保存' : '新增'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = $('#dish-modal-overlay');
  $('#dish-modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  $('#dish-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    const floorVal = data.get('floor');
    const body = {
      id: data.get('id').trim(),
      placeId: data.get('placeId'),
      name: data.get('name').trim(),
      shop: data.get('shop').trim() || null,
      floor: floorVal ? Number(floorVal) : null,
      note: data.get('note').trim() || null,
      mealPeriod: data.get('mealPeriod') || null,
      verificationStatus: data.get('verificationStatus'),
      sourceLabel: data.get('name').trim(),
    };
    try {
      if (isEdit) {
        await adminRequest(`/api/admin/recommendations/${encodeURIComponent(dish.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        toast('保存成功');
      } else {
        await adminRequest('/api/admin/recommendations', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast('新增成功');
      }
      overlay.remove();
      await loadAdminDishes();
      await refreshPlacesData();
    } catch (error) {
      toast('操作失败：' + error.message);
    }
  });
}

// 管理员退出登录
function adminLogout() {
  adminToken = '';
  localStorage.removeItem('hustmap-admin-token');
  isAdminEditMode = false;
  updateAdminModeUI();
  showAdminLogin('已退出登录');
  toast('已退出登录');
}

async function decideFeedback(action) {
  if (!selectedReviewCode) return;
  const note = $('#review-note')?.value.trim() || '';
  if (!note) return toast('请先填写处理说明');
  try {
    await adminRequest(`/api/admin/feedbacks/${encodeURIComponent(selectedReviewCode)}`, {
      method: 'PATCH', body: JSON.stringify({ decision: action, reviewNote: note }),
    });
    await renderReview();
    toast(action === 'approve' ? '已采纳，用户可凭编号查询结果' : '已驳回，用户可查看处理说明');
  } catch (error) {
    if (error.unauthorized) showAdminLogin(error.message);
    else toast(error.message);
  }
}

function createTrackingCode() {
  const date = new Date();
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('').slice(0, 6).toUpperCase();
  return `FB-${day}-${suffix}`;
}

function saveLocalFeedback(payload) {
  const item = {
    trackingCode: createTrackingCode(),
    status: '待审核',
    submittedAt: new Date().toISOString(),
    reviewNote: '',
    ...payload,
  };
  const records = localFeedbacks();
  records.unshift(item);
  writeLocalFeedbacks(records);
  return item;
}

async function submitFeedback(payload) {
  try {
    const response = await fetch(new URL('./api/feedbacks', document.baseURI), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) return (await response.json()).feedback;
    if (![404, 405].includes(response.status)) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || '反馈提交失败');
    }
  } catch (error) {
    if (!/Failed to fetch|HTTP|404|405/i.test(error.message) && !location.hostname.endsWith('github.io')) throw error;
  }
  return saveLocalFeedback(payload);
}

async function findFeedback(trackingCode) {
  const normalized = trackingCode.trim().toUpperCase();
  try {
    const response = await fetch(new URL(`./api/feedbacks/${encodeURIComponent(normalized)}`, document.baseURI), { cache: 'no-store' });
    if (response.ok) return (await response.json()).feedback;
    if (response.status !== 404) throw new Error('暂时无法查询反馈');
  } catch (error) {
    if (!location.hostname.endsWith('github.io') && !/Failed to fetch|404/i.test(error.message)) throw error;
  }
  return localFeedbacks().find(item => item.trackingCode === normalized) ?? null;
}

function renderFeedbackResult(feedback) {
  if (!feedback) {
    $('#tracking-result').innerHTML = '<div class="empty">没有找到这个反馈编号，请检查后重试。</div>';
    return;
  }
  const place = state.places.find(item => item.id === feedback.placeId);
  $('#tracking-result').innerHTML = `<div class="feedback-receipt"><b>反馈编号：${escapeHtml(feedback.trackingCode)}</b><br>当前状态：${escapeHtml(feedbackStatusLabel(feedback.status))}<br>反馈对象：${escapeHtml(place?.name || feedback.proposedPlaceName || '新增地点')}<br>反馈类型：${escapeHtml(feedback.feedbackType)}<br>提交时间：${escapeHtml(new Date(feedback.submittedAt).toLocaleString('zh-CN'))}${feedback.reviewNote ? `<br>处理说明：${escapeHtml(feedback.reviewNote)}` : ''}</div>`;
}

function populateFeedbackPlaces() {
  const select = $('#feedback-place');
  if (!select) return;
  select.innerHTML = `<option value="">请选择反馈对象</option><option value="__new_place__">＋ 新地点（清单中没有）</option>${state.places
    .filter(place => !isFoodCourtChild(place))
    .map(place => `<option value="${escapeHtml(place.id)}">${escapeHtml(place.name)}（${escapeHtml(placeLabel(place))}）</option>`)
    .join('')}`;
}

function activateFeedbackTab(tab) {
  document.querySelectorAll('[data-feedback-tab]').forEach(button => {
    button.setAttribute('aria-selected', String(button.dataset.feedbackTab === tab));
  });
  $('#feedback-submit-pane').hidden = tab !== 'submit';
  $('#feedback-status-pane').hidden = tab !== 'status';
}

async function handleFeedbackSubmit(place, form, receiptSelector = '#feedback-receipt') {
  const data = new FormData(form);
  let feedbackType = String(data.get('feedbackType') || '其他');
  const details = String(data.get('details') || '').trim();
  const proposedPlaceName = String(data.get('proposedPlaceName') || '').trim();
  const selectedValue = place?.id || String(data.get('placeId') || '').trim() || null;
  const isNewPlace = selectedValue === '__new_place__' || feedbackType === '新增位置';
  if (isNewPlace) feedbackType = '新增位置';
  const selectedPlaceId = isNewPlace ? null : selectedValue;
  if (!details) return toast('请填写修改意见或补充说明');
  if (isNewPlace && !proposedPlaceName) return toast('请填写新增地点名称');
  if (!isNewPlace && !selectedPlaceId) return toast('请选择反馈对象，或选择“新地点”');
  const calibration = selectedPlaceId ? calibrationForPlace(selectedPlaceId) : null;
  const payload = {
    placeId: selectedPlaceId,
    proposedPlaceName: isNewPlace ? proposedPlaceName : null,
    feedbackType,
    details,
    proposedPayload: calibration ? { latitude: calibration.latitude, longitude: calibration.longitude } : null,
  };
  const button = form.querySelector('button[type="submit"]');
  const defaultText = button.textContent;
  button.disabled = true;
  button.textContent = '正在提交…';
  try {
    const feedback = await submitFeedback(payload);
    const receipt = $(receiptSelector);
    receipt.innerHTML = `<b>反馈已提交</b><br>反馈编号：<strong>${escapeHtml(feedback.trackingCode)}</strong><br>当前状态：${escapeHtml(feedbackStatusLabel(feedback.status))}<br><span class="small">请保存反馈编号，以便查询处理结果。</span><div class="feedback-actions"><button id="copy-tracking-code" class="secondary" type="button">复制编号</button><button id="open-feedback-status" class="secondary" type="button">查看处理状态</button></div>`;
    receipt.hidden = false;
    receipt.querySelector('#copy-tracking-code').onclick = async () => {
      await navigator.clipboard?.writeText(feedback.trackingCode);
      toast('反馈编号已复制');
    };
    receipt.querySelector('#open-feedback-status').onclick = () => {
      $('#tracking-code').value = feedback.trackingCode;
      renderFeedbackResult(feedback);
      activateFeedbackTab('status');
      go('feedback');
    };
    form.reset();
    form.querySelector('[data-proposed-name]').hidden = true;
    if (form.elements.placeId) form.elements.placeId.disabled = false;
  } catch (error) {
    toast(error.message || '反馈提交失败，请稍后重试');
  } finally {
    button.disabled = false;
    button.textContent = defaultText;
  }
}

function detail(id, from = 'results') {
  const place = state.places.find(item => item.id === id);
  if (!place) return toast('找不到这个觅食点');
  const featured = from === 'results' ? state.results.find(item => item.id === id)?.featuredRecommendation : null;
  const dishes = place.recommendations.map(item => `<li>${escapeHtml(dishLabel(item))}${item.note ? ` <span class="small">（${escapeHtml(item.note)}）</span>` : ''}</li>`).join('');
  $('#detailbox').innerHTML = `<div class="detailhero"><div><span class="zone pending">${escapeHtml(placeLabel(place))}</span><h2>${escapeHtml(place.name)}</h2>${featured ? `<p class="dish">本次推荐：${escapeHtml(featured.name)}</p>` : ''}</div><button id="feedback" class="primary">纠错反馈</button></div>
    <div class="details">
      <div class="detailitem"><b>位置线索</b><span>${escapeHtml(locationFor(place, featured))}<br><span class="small location-status">${escapeHtml(place.locationStatus || '未定位')}</span></span><button class="secondary map-location-button" data-locate="${escapeHtml(place.id)}">在地图上查看</button></div>
      <div class="detailitem"><b>用餐餐次</b><span>${escapeHtml(placePeriodLabel(place, featured))}</span></div>
      <div class="detailitem"><b>信息状态</b><span>${escapeHtml(place.verificationStatus || '待确认')}</span></div>
      <div class="detailitem"><b>最近确认</b><span>${escapeHtml(place.lastConfirmedAt || '暂无确认记录')}</span></div>
      <div class="detailitem"><b>区域标签</b><span>${escapeHtml(getZoneLabel(place))}</span></div>
    </div>
    <div id="feedback-correction" class="notice feedback-correction" hidden><b>提交修改意见</b><p>反馈只会进入待处理记录，不会直接修改公开地点。位置反馈可先在地图上重新圈点。</p><form id="feedback-form" class="feedback-form">
      <label>反馈类型<select name="feedbackType"><option>位置有误</option><option>名称有误</option><option>楼层入口错误</option><option>菜品信息有误</option><option>营业时间有误</option><option>暂停营业</option><option>还在这里</option><option>新增位置</option><option>其他</option></select></label>
      <label data-proposed-name hidden>新增地点名称<input name="proposedPlaceName" maxlength="80" placeholder="请输入地点或店铺名称"></label>
      <label>修改意见或补充说明<textarea name="details" maxlength="500" required placeholder="请描述当前信息哪里不准确，以及建议如何修改"></textarea></label>
      <div class="feedback-actions"><button id="calibrate-place" class="secondary" type="button">在地图上重新圈位置</button><button class="primary" type="submit">提交修改意见</button></div>
    </form><div id="feedback-receipt" class="feedback-receipt" hidden></div></div>
    ${dishes ? `<div class="notice"><b>已收集的菜品／线索</b><ul>${dishes}</ul><span class="small">这些内容来自项目组清单，营业情况和位置仍需现场核实。</span></div>` : ''}`;
  $('#feedback').onclick = () => {
    const panel = $('#feedback-correction');
    panel.hidden = !panel.hidden;
  };
  $('#calibrate-place').onclick = () => startCalibrationForPlace(place.id);
  const feedbackForm = $('#feedback-form');
  feedbackForm.elements.feedbackType.onchange = event => {
    feedbackForm.querySelector('[data-proposed-name]').hidden = event.target.value !== '新增位置';
  };
  feedbackForm.onsubmit = event => {
    event.preventDefault();
    handleFeedbackSubmit(place, feedbackForm);
  };
  $('#detailbox [data-locate]').onclick = event => focusPlaceOnMap(event.currentTarget.dataset.locate);
  const back = $('#detail .back');
  const returnToMap = from === 'map';
  back.dataset.go = returnToMap ? 'home' : from;
  back.dataset.returnMap = String(returnToMap);
  back.textContent = from === 'admin' ? '← 返回全部地点' : returnToMap ? '← 返回首页地图' : '← 返回推荐结果';
  go('detail');
}

// ===== 全部地点：按区域分组渲染 =====
const adminAreaOrder = ['east', 'central', 'west', 'out', 'takeout'];
const adminAreaNames = { east: '东区', central: '中区', west: '西区', out: '校外', takeout: '外卖' };

// 强制区域映射规则（根据你提供的清单）
const forcedAreaRules = [
  { area: 'east', keywords: ['学一', '学生一食堂', '学二', '韵苑', '韵酒', '东教工', '壹品豆花', '茶咖', '周麻婆', '汉堡王', '氧气层', '吉野家'] },
  { area: 'central', keywords: ['东一食堂', '东三', '紫荆园', '喻园', '集锦园', '集贤楼', '一捧饭团', '必胜客', '梧桐语', '校医院', '麦当劳'] },
  { area: 'west', keywords: ['崧邻里', '菘邻里', '百景园', '百惠园', '西一', '西二', '西华园'] },
];

function adminAreaOf(place) {
  let targetPlace = place;
  if (place.parentId) {
    const parent = state.places.find(item => item.id === place.parentId);
    if (parent) targetPlace = parent;
  }

  // 1. 优先根据名称强制匹配真实区域，纠正原数据错误
  for (const rule of forcedAreaRules) {
    if (rule.keywords.some(kw => targetPlace.name.includes(kw))) {
      return rule.area;
    }
  }

  // 2. 如果没匹配到规则，退回使用原数据的 campusArea
  return targetPlace.campusArea;
}

// 获取纯纯的标签分类
// 获取纯纯的标签分类
function getZoneLabel(place) {
  let target = place;
  if (place.parentId) {
    const parent = state.places.find(item => item.id === place.parentId);
    if (parent) target = parent;
  }

  // 1. 外卖
  if (target.campusArea === 'takeout') return '外卖';

  // 2. 校外
        const outNames = ['韩味屋', '老街烧烤', '西十二大叔', '世界城', '光谷', '南二门', '南四门', '南三门', '西小门外', '生活区', '东小门外', '华科周边', '泛悦城', '珞瑜路', '张亮麻辣烫', '鱼来鱼美', '老兵烧烤', '南三门鸭血粉丝汤', '西安特色小吃', '锅神麻辣烫', '生活门螺蛳粉', '东乡人家'];
  if (target.campusArea === 'out' || outNames.some(name => target.name.includes(name))) {
    return '校外';
  }

  // 3. 食堂（只要名字带有这些词，或者匹配名单，统统算食堂）
  const canteenNames = ['韵苑', '韵酒', '梧桐语', '学一', '学二', '东一', '东三', '东园', '东教工', '集锦', '集贤', '百景', '百惠', '西一', '西二', '西华', '喻园', '校医院', '紫荆园'];
  if (target.name.includes('食堂') || target.name.includes('餐厅') || target.name.includes('小窗口') || canteenNames.some(name => target.name.includes(name))) {
    return '食堂';
  }

  // 4. 剩下的都是校内
  return '校内';
}
function renderAllPlaces() {
  const query = ($('#place-search')?.value || '').trim().toLocaleLowerCase();
  const filtered = state.places.filter(place => {
  // 光谷步行街的子店铺不在列表单独出现；百景园三楼这种 canteen 子节点保留
  if (isFoodCourtChild(place)) return false;

  return [
    place.name,
    place.locationNote,
    ...place.recommendations.map(item => item.name),
  ].some(value => String(value ?? '').toLocaleLowerCase().includes(query));
});

    // 完全按照原始 JSON 的顺序排，但如果遇到子节点，则锚定到父节点所在的位置
  const sorted = [...filtered].sort((a, b) => {
    // 获取某个地点在原始全量数据里的索引
    const getOriginalIndex = (place) => state.places.findIndex(item => item.id === place.id);

    // 排序基准：如果有 parentId，则以其父节点的索引为准；否则以自己的索引为准
    const getSortKey = (place) => {
      if (place.parentId) {
        return getOriginalIndex({ id: place.parentId });
      }
      return getOriginalIndex(place);
    };

    const keyA = getSortKey(a);
    const keyB = getSortKey(b);

    // 如果不在同一个组（组由父节点索引决定），按组的基准顺序排
    if (keyA !== keyB) {
      return keyA - keyB;
    }

    // 如果是同一个组，父节点排前面
    if (!a.parentId) return -1;
    if (!b.parentId) return 1;

    // 同一个父节点下的多个子节点，按它们在原始数据里的顺序排
    return getOriginalIndex(a) - getOriginalIndex(b);
  });

  $('#count').textContent = `${filtered.length} / ${state.places.length} 个地点`;

  if (!sorted.length) {
    $('#adminlist').innerHTML = '<div class="empty">没有找到相关地点或菜品。</div>';
    return;
  }

  // 按区域归组（保持上面排好的顺序）
  const groups = new Map();
  for (const place of sorted) {
    const area = adminAreaOf(place);
    const key = adminAreaOrder.includes(area) ? area : 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(place);
  }

    const groupKeys = [
    ...adminAreaOrder.filter(key => groups.has(key)),
    ...(groups.has('other') ? ['other'] : []),
  ];

  // 定义标签的排序优先级：食堂 > 校内 > 校外 > 外卖
  const zonePriority = { '食堂': 1, '校内': 2, '校外': 3, '外卖': 4 };

  // 对每个区域内部的地点进行重新排序
  groupKeys.forEach(key => {
    groups.get(key).sort((a, b) => {
      const zoneA = getZoneLabel(a);
      const zoneB = getZoneLabel(b);
      // 如果标签不一样，按优先级排序
      if (zonePriority[zoneA] !== zonePriority[zoneB]) {
        return zonePriority[zoneA] - zonePriority[zoneB];
      }
      // 如果标签一样，保持原本的顺序（返回 0）
      return 0;
    });
  });

  // 渲染 HTML
  $('#adminlist').innerHTML = groupKeys.map(key => {
    const places = groups.get(key);
    const title = key === 'other' ? '未标注区域' : adminAreaNames[key];
    const rows = places.map(place => {
  const tagLabel = getZoneLabel(place);
  const indentStyle = place.parentId ? 'padding-left: 20px;' : '';
  const displayRecs = recommendationsForPlace(place);

  return `<div class="adminrow" style="${indentStyle}">
    <span class="zone pending">${escapeHtml(tagLabel)}</span>
    <strong>${escapeHtml(place.name)}${displayRecs.length ? `<small style="display: block; margin-top: 4px; line-height: 1.6;">${dishesOf(place)}</small>` : ''}</strong>
    <div style="display: flex; gap: 6px; flex: none;">
      <button class="secondary" data-detail="${escapeHtml(place.id)}">详情</button>
      <button class="secondary" style="color: var(--red); border-color: var(--red);" data-delete-place="${escapeHtml(place.id)}" data-place-name="${escapeHtml(place.name)}">删除</button>
    </div>
  </div>`;
}).join('');
    return `<section class="admin-area"><div class="admin-area-title"><h3>${escapeHtml(title)}</h3><span>${places.length} 个地点</span></div>${rows}</section>`;
  }).join('');
}

// ====== 美食图谱：分组数据结构 ======
const mockDishesGrouped = [
  {
    area: "east", areaName: "东边",
    canteens: [
      {
        name: "韵苑食堂（一楼）",
        dishes: [
          { name: "皮蛋拌粉", shop: "面食/粉类", price: "未标价", rating: 3, review: "推荐" },
          { name: "卤肉刀削面", shop: "面食/粉类", price: "7.00元", rating: 4, review: "刀削面筋道，卤肉超好吃，加点醋更好吃" },
          { name: "西红柿鸡蛋汤面", shop: "面食/粉类", price: "8.00元", rating: 3, review: "有配菜的西红柿鸡蛋面，鸡蛋很好吃" }
        ]
      },
      {
        name: "学一食堂",
        dishes: [
          { name: "大盘鸡", shop: "大盘鸡/正餐", price: "小锅30元", rating: 4, review: "小锅30够两人、赠面，鸡肉软烂、皮带面好吃" }
        ]
      }
    ]
  },
  {
    area: "central", areaName: "中间",
    canteens: [
      {
        name: "东一食堂（一楼）",
        dishes: [
          { name: "生烫牛肉面", shop: "生烫窗口", price: "14-17元", rating: 5, review: "牛肉嫩、汤鲜，“新晋顶流”；窗口很多人排" },
          { name: "蜜汁鸡腿", shop: "烧腊窗口", price: "12.00元", rating: 4, review: "“永远的神”" }
        ]
      }
    ]
  },
  {
    area: "west", areaName: "西边",
    canteens: [
      {
        name: "百景园（一楼）",
        dishes: [
          { name: "冬阴功小锅米线", shop: "云南临沧·米线", price: "17.00元", rating: 4, review: "酸酸辣辣、柠檬味明显、虾紧实、滑肉嫩" }
        ]
      },
      {
        name: "崧邻里",
        dishes: [
          { name: "达美乐", shop: "披萨", price: "未标价", rating: 4, review: "推荐" }
        ]
      }
    ]
  },
  {
    area: "out", areaName: "校外",
    canteens: [
      {
        name: "光谷步行街",
        dishes: [
          { name: "荔枝香辣烤鱼", shop: "鱼酷", price: "人均80-100元", rating: 5, review: "活鱼现选现做，荔枝果香中和辣感，鱼肉脱骨无小刺" }
        ]
      }
    ]
  },
  {
    area: "takeout", areaName: "外卖",
    canteens: [
      {
        name: "肥肥虾庄",
        dishes: [
          { name: "油焖大虾", shop: "招牌", price: "未标价", rating: 4, review: "虾界天花板，线上线下最畅销" },
          { name: "美极凤爪", shop: "小吃", price: "未标价", rating: 4, review: "非常好吃，必须吃热的，软糯带嚼劲" }
        ]
      },
      {
        name: "云海肴",
        dishes: [
          { name: "汽锅鸡", shop: "云南菜", price: "未标价", rating: 4, review: "汤很鲜，配辣椒调料更好吃" }
        ]
      }
    ]
  }
];


// 1. 详细小标签
function getDishDetailTag(name) {
  if (!name) return '正餐';

  if (name.includes('酱') && !name.includes('酱鸭') && !name.includes('酱香饼')) return '酱料';
  if (name.includes('油醋汁')) return '酱料';

  // 👇 绝对饮品 VIP 通道：只要命中这些词，无视任何肉类字眼，直接判为饮品！
  const absoluteDrinks = /牛奶|牛乳|酸奶|奶茶|果汁|果茶|可可|冰麦|奶昔|奶绿|芦荟茶|百香果|番石榴|桃胶|豆浆|咖啡/;
  if (absoluteDrinks.test(name)) {
    return '饮品';
  }

  // 👇 常规饮品判断：包含汁、果、茶、冰、汽水等，且没有明显肉菜特征
  const isDrink = /茶|汁|果|露|奶|冰|汽水|可乐|雪碧|桃|柚|石榴/.test(name);
  const hasMeat = /肉|鸡|鸭|鱼|虾|排骨|牛|羊|蛋|豆腐|饭|粉|煲|锅|丝|片|块|丸|面|饼|包|饺|馍|排|煮|辣|菜/.test(name);
  
  if (isDrink && !hasMeat) {
    return '饮品';
  }
  
  // 👇 强制让蛋包饭显示为“蛋包饭”标签
  if (name.includes('蛋包饭')) return '蛋包饭';

  // 强制指定优先判断
  if (name.includes('皮蛋豆腐') || name.includes('鸭血粉丝汤')) return '正餐';
  if (['豆花', '松板肉', '鱿鱼包浆豆腐', '黑椒羊扒配薯饼', '驴打滚'].some(k => name.includes(k))) return '小吃';
  if (name.includes('印度黄油鸡')) return '正餐';
  if (/烧烤|烤串/.test(name)) return '小吃';
  if (name.includes('乌冬面') || name.includes('麻辣拌（自选称重）')) {
    return name.includes('乌冬面') ? '池奈' : '拌壹桶';
  }

  let type = '';
  let flavor = '';

  // 【基础类型】
  if (/馄饨|抄手|云吞|饺|粉|面|线|米线/.test(name) && !/面包|面筋|面粉/.test(name) && !/蛋包饭/.test(name)) {
    type = /意面|炒面|拌面|焖面|汤面|拉面|刀削面|烩面|担担面|油泼面|凉面/.test(name) ? '面食' : '粉面';
  } else if (/包|小笼|烧麦|饼|馍|馕|煎饼|肉夹馍|豆皮/.test(name)) {
    type = '粥点';
  } else if (/粥/.test(name)) {
    type = '粥类';
  } else if (/蛋包饭/.test(name)) {
    type = '饭';
  } else if (/饭/.test(name)) {
    type = '米饭快餐';
  } else if (/煲|砂锅/.test(name)) {
    type = '煲仔砂锅';
      } else if (/汤|羹/.test(name)) {
    type = '汤';
  } else if (/豆腐|红薯|香蕉|榴莲|糕|甜点|布丁|烧仙草|串|炸|麻薯|地瓜|土豆条|鸡柳/.test(name)) {
    type = '小吃';
  } else {
    type = '正餐';
  }

  // 【口味特征】
  if (/鱼|虾|海鲜|花甲|鱿鱼|蟹|蛙/.test(name)) {
    flavor = '海鲜水产';
  } else if (/酸汤|冬阴功|番茄/.test(name)) {
    flavor = '酸汤番茄';
  } else if (/麻辣|香辣|辣子|水煮|冒菜|干锅|香锅|鸡公煲|肉蟹煲/.test(name)) {
    flavor = '麻辣香辣';
  } else if (/咖喱/.test(name)) {
    flavor = '咖喱';
  } else if (/烧腊|烧鹅|叉烧|烤鸭|口水鸡|蜜汁鸡腿|黑鸭|卤肉|猪脚|排骨/.test(name)) {
    flavor = '烧腊卤味';
  } else if (/铁板|石锅/.test(name)) {
    flavor = '铁板石锅';
  } else if (/大盘鸡/.test(name)) {
    flavor = '大盘鸡';
  } else if (/黄焖鸡/.test(name)) {
    flavor = '黄焖鸡';
  } else if (/轻食|沙拉/.test(name)) {
    flavor = '轻食';
  } else if (/烤|烧/.test(name)) {
    flavor = '烧烤';
  } else if (/芝士/.test(name)) {
    flavor = '芝士';
  }

  if (type === '正餐' && flavor) {
    if (flavor === '大盘鸡' || flavor === '黄焖鸡') type = flavor;
  }
  if (type === flavor) flavor = '';

  // 如果是正餐+汤，单独标出
  if (type === '汤') return '正餐 · 汤';

  return flavor ? `${type} · ${flavor}` : type;
}

// 2. 大板块分类（注意：面点改名为了粥点，菜改名为了正餐）
function getDishMainGroup(name) {
  const tag = getDishDetailTag(name);
  if (tag.includes('粉面') || tag.includes('面食')) return '粉面';
  if (tag.includes('粥点')) return '粥点';
  if (tag.includes('饮品')) return '饮料';
  if (tag.includes('小吃') || tag.includes('甜品')) return '小吃';
  return '正餐';
}

function renderDishes() {
  const container = $('#dish-groups-container');
  if (!container) return;

  // 直接更新 HTML 里写好的按钮状态
  updateAdminModeUI();

  const query = state.dishSearchQuery.toLowerCase();

  // 下面的代码保持原样不动
  const filteredPlaces = state.places
    .filter(place => !isFoodCourtChild(place))
    .map(place => {
      const sourceRecs = recommendationsForPlace(place);
      const matchedRecs = sourceRecs.filter(item => {
        if (!query) return true;
        const text = [item.name, item.note, item.shop].join(' ').toLowerCase();
        return text.includes(query);
      });
      return { ...place, recommendations: matchedRecs };
    })
    .filter(p => {
      if (p.recommendations.length === 0) return false;
      if (state.dishArea === 'all') return true;
      return p.campusArea === state.dishArea;
    });
  
  

  if (filteredPlaces.length === 0) {
    container.innerHTML = '<div class="empty">没有找到相关菜品，请换个关键词试试。</div>';
    return;
  }

   const renderCardHtml = (dish) => {
    const detailTag = getDishDetailTag(dish.name);
    const isSelected = state.selectedDishes && state.selectedDishes.has(dish.id);
    
    // 管理员模式下的覆盖层
    const editOverlay = isAdminEditMode ? `
      <div style="position: absolute; top: 12px; right: 12px; z-index: 10;">
        <input type="checkbox" class="dish-checkbox" data-dish-id="${dish.id}" ${isSelected ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
      </div>
    ` : '';
        const clickAttr = isAdminEditMode 
      ? `onclick="window.handleAdminDishClick(event, '${dish.id}')"` 
      : `onclick="window.openRateModal('${dish.id}')"`; // <-- 这里加普通用户的点击
    const cursorStyle = isAdminEditMode ? 'cursor: pointer; border: 1px solid var(--red);' : '';

    return `
      <article class="card" style="position: relative; min-height: auto; padding: 16px; ${cursorStyle}" ${clickAttr}>
        ${editOverlay}
        <div class="cardtop">
          <span class="zone pending" style="font-size: 11px;">${escapeHtml(detailTag)}</span>
        </div>
        <h3 style="margin: 10px 0 6px; font-size: 18px;">${escapeHtml(dish.name)}</h3>
        <p class="dish" style="min-height: auto; margin-bottom: 12px; color: #614a40; font-size: 13px; line-height: 1.5;">${escapeHtml(dish.note || '暂无评价')}</p>
        <div class="info" style="margin-top: auto; font-size: 12px; font-weight: bold; border-top: 1px dashed var(--line); padding-top: 10px; display: flex; justify-content: space-between;">
          <span>💰 参考：${escapeHtml(dish.price || '未标价')}</span>
        </div>
        ${isAdminEditMode ? `<div style="margin-top:8px; text-align:right;"><button type="button" onclick="event.stopPropagation(); window.deleteSingleDishFromGraph('${dish.id}')" style="font-size: 12px; padding: 4px 8px; color: var(--red); border: 1px solid var(--red); border-radius: 4px; background: transparent; cursor: pointer;">删除</button></div>` : ''}
      </article>
    `;
  };

  const areaNames = { east: '东边', central: '中间', west: '西边', out: '校外', takeout: '外卖', other: '未分类' };
  const grouped = {};
  filteredPlaces.forEach(place => {
    const area = place.campusArea || 'other';
    if (!grouped[area]) grouped[area] = [];
    grouped[area].push(place);
  });

  const areaOrder = ['east', 'central', 'west', 'out', 'takeout', 'other'];
  const categoryOrder = ['正餐', '粉面', '粥点', '饮料', '小吃'];

  container.innerHTML = areaOrder.filter(area => grouped[area]).map(area => {
    return grouped[area].map(place => {
      
      // 判断是否是商圈/综合体（这些第一层直接按店铺分，而不是楼层）
            const isStreetComplex = ['东边CBD', '菘邻里', '崧邻里', '泛悦城', '光谷步行街', '华科周边', '生活区', '光谷学生美食街', '百景园三楼'].some(kw => place.name.includes(kw));
            const sectionGroups = new Map();
      for (const item of place.recommendations) {
        let sKey;
        // 👇 强行让这两家店归入 B1 楼
        if (item.shop === '烧饼部落' || item.shop === '寿司郎') {
          sKey = '-1';
        } else if (isStreetComplex) {
          sKey = ((item.shop || '').trim().split('·')[0].trim() || place.name);
        } else {
          sKey = item.floor ? `${item.floor}` : 'none';
        }
        if (!sectionGroups.has(sKey)) sectionGroups.set(sKey, []);
        sectionGroups.get(sKey).push(item);
      }

      const sortedSections = [...sectionGroups.keys()].sort((a, b) => {
        if (isStreetComplex) return 0; // 商圈保持原序
        if (a === 'none') return 1;
        if (b === 'none') return -1;
        return Number(a) - Number(b);
      });

      const floorsHtml = sortedSections.map(sKey => {
        const items = sectionGroups.get(sKey);
        
        let sectionTitle = '';
        let sectionHeaderHtml = '';
        let borderColor = 'var(--red)'; // 默认红色
        
        if (isStreetComplex) {
          sectionTitle = sKey; // 商圈显示店铺名
          borderColor = 'var(--sage)'; // 绿色
        } else {
          sectionTitle = sKey === 'none' ? '' : (sKey === '-1' ? 'B1 楼' : `${sKey} 楼`); // 普通食堂显示楼层
        }
        
        sectionHeaderHtml = sectionTitle ? `<h3 style="margin: 32px 0 16px; font-size: 20px; color: var(--ink); border-left: 4px solid ${borderColor}; padding-left: 10px; font-family: Georgia, serif;">${escapeHtml(sectionTitle)}</h3>` : '';

        let typesHtml = '';
        
        // 🌟 1. 光谷世界城：楼层内部再按店铺分组
        if (place.name.includes('光谷世界城')) {
          const shopGroups = new Map();
          items.forEach(item => {
            const shop = item.shop || '其他店铺';
            if (!shopGroups.has(shop)) shopGroups.set(shop, []);
            shopGroups.get(shop).push(item);
          });
          typesHtml = [...shopGroups.entries()].map(([shopName, shopItems]) => {
            const shopTitleHtml = `<h4 style="margin: 20px 0 12px; font-size: 16px; color: var(--ink); border-bottom: 1px solid var(--line); padding-bottom: 6px;">${escapeHtml(shopName)}</h4>`;
            return `<div class="type-group">${shopTitleHtml}
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
                ${shopItems.map(renderCardHtml).join('')}
              </div>
            </div>`;
          }).join('');
        }
        // 🌟 2. 百景园 3 楼：楼层内部按店铺分组
        else if (place.name.includes('百景园') && sKey === '3') {
          const shopGroups = new Map();
          items.forEach(item => {
            const shop = item.shop || '其他店铺';
            if (!shopGroups.has(shop)) shopGroups.set(shop, []);
            shopGroups.get(shop).push(item);
          });
          typesHtml = [...shopGroups.entries()].map(([shopName, shopItems]) => {
            const shopTitleHtml = `<h4 style="margin: 20px 0 12px; font-size: 16px; color: var(--ink); border-bottom: 1px solid var(--line); padding-bottom: 6px;">${escapeHtml(shopName)}</h4>`;
            return `<div class="type-group">${shopTitleHtml}
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
                ${shopItems.map(renderCardHtml).join('')}
              </div>
            </div>`;
          }).join('');
        }
        // 🌟 3. 商圈类：第一层已经是店铺名，直接平铺卡片
        else if (isStreetComplex) {
          typesHtml = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
              ${items.map(renderCardHtml).join('')}
            </div>`;
        }
        // 🌟 4. 普通食堂：楼层内部按大分类（正餐、粉面等）分组
        else {
          const typeGroups = new Map();
          items.forEach(item => {
            const mainGroup = getDishMainGroup(item.name);
            if (!typeGroups.has(mainGroup)) typeGroups.set(mainGroup, []);
            typeGroups.get(mainGroup).push(item);
          });

          typesHtml = categoryOrder.map(mainGroupName => {
            const typeItems = typeGroups.get(mainGroupName);
            if (!typeItems || typeItems.length === 0) return ''; 

            const typeTitleHtml = `<h4 style="margin: 20px 0 12px; font-size: 15px; color: var(--muted); font-weight: normal; border-bottom: 1px dashed var(--line); padding-bottom: 6px;">${escapeHtml(mainGroupName)}</h4>`;
            
            return `<div class="type-group">${typeTitleHtml}
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
                ${typeItems.map(renderCardHtml).join('')}
              </div>
            </div>`;
          }).join('');
        }

        return `<div class="floor-group" style="margin-bottom: 24px;">${sectionHeaderHtml}${typesHtml}</div>`;
      }).join('');

      return `
      <section class="dish-group" style="margin-bottom: 64px;">
        <div class="dish-group-title" style="display: flex; align-items: baseline; gap: 12px; border-bottom: 2px solid var(--ink); padding-bottom: 8px; margin-bottom: 8px;">
          <span class="pill" style="padding: 4px 8px; font-size: 11px;">${escapeHtml(areaNames[area] || '未分类')}</span>
          <h2 style="font-family: Georgia, serif; font-size: 26px; letter-spacing: -0.04em; margin: 0;">${escapeHtml(place.name)}</h2>
        </div>
        ${floorsHtml}
      </section>
    `}).join('');
  }).join('');
  renderBatchToolbar();
}



function setupPage() {
    // 到底提示的防抖变量
  let scrollTipTimer = null;
  
  // 监听滚动到底部
  window.addEventListener('scroll', () => {
    const tip = document.getElementById('scroll-end-tip');
    if (!tip) return;

    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;

    // 只有页面有足够长的滚动条时才触发
    const canScroll = scrollHeight > clientHeight + 100;

    // 距离底部 50px 以内认为到底了
    if (canScroll && scrollTop + clientHeight >= scrollHeight - 50) {
      tip.classList.add('show');
      // 停留 3 秒后自动隐藏
      clearTimeout(scrollTipTimer);
      scrollTipTimer = setTimeout(() => {
        tip.classList.remove('show');
      }, 3000);
    } else {
      // 往上滚或离开底部，立刻隐藏
      tip.classList.remove('show');
      clearTimeout(scrollTipTimer);
    }

    // 回到顶部按钮显示/隐藏
    const backToTop = document.getElementById('back-to-top');
    if (backToTop) {
      if (window.scrollY > 400) {
        backToTop.classList.add('show');
      } else {
        backToTop.classList.remove('show');
      }
    }
  });

    // 绑定图谱里的编辑按钮
  $('#dishes-edit-toggle')?.addEventListener('click', toggleAdminEditMode);
  // 绑定地图上的编辑按钮（原来可能写在别处，也挪过来一起）
  $('#admin-edit-toggle')?.addEventListener('click', toggleAdminEditMode);

  // 回到顶部按钮点击
  const backToTopBtn = document.getElementById('back-to-top');
  if (backToTopBtn) {
    backToTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
    // 绑定图谱多选框事件（第六步新增）
  $('#dish-groups-container')?.addEventListener('change', event => {
    const checkbox = event.target.closest('.dish-checkbox');
    if (!checkbox) return;
    const id = checkbox.dataset.dishId;
    if (checkbox.checked) {
      state.selectedDishes.add(id);
    } else {
      state.selectedDishes.delete(id);
    }
    renderBatchToolbar(); // 更新顶部吸顶栏的已选数字
  });
  // 美食图谱的搜索监听
  $('#dish-search')?.addEventListener('input', event => {
    state.dishSearchQuery = event.target.value.trim();
    renderDishes();
  });
  $('#place-search').addEventListener('input', renderAllPlaces);
    $('#rating-search')?.addEventListener('input', renderRating);
    // 👇 新增：只要搜索框被清空，立刻重置地图
  $('#map-search').addEventListener('input', event => {
    if (event.target.value.trim() === '' && state.mapSearchQuery !== '') {
      state.mapSearchQuery = '';
      renderMap();
      toast('已恢复全部地点');
    }
  });
  $('#map-search-form').addEventListener('submit', event => {
    event.preventDefault();
    state.mapSearchQuery = $('#map-search').value.trim().toLocaleLowerCase();
    renderMap();
    setTimeout(focusMapSearchResults, 60);
    toast(state.mapSearchQuery ? `正在地图中查找“${$('#map-search').value.trim()}”` : '已显示全部地点');
  });
  $('#calibration-target').addEventListener('change', event => {
    state.calibrationTargetId = event.target.value;
    renderCalibrationPanel();
    focusCalibrationTarget();
  });
  $('#calibration-undo').addEventListener('click', () => {
    state.calibrations = state.calibrations.filter(item => item.targetId !== state.calibrationTargetId);
    saveCalibrationDraft();
    renderMap();
    renderCalibrationPanel();
    focusCalibrationTarget();
    toast('已撤销当前地点的校准草稿');
  });
   // 新增菜品区域切换事件
  $('#dish-area-filters')?.addEventListener('click', event => {
    const button = event.target.closest('[data-dish-area]');
    if (!button) return;
    state.dishArea = button.dataset.dishArea;
    document.querySelectorAll('#dish-area-filters button').forEach(item => {
      item.setAttribute('aria-selected', String(item === button));
    });
    renderDishes();
  });
  $('#calibration-copy').addEventListener('click', copyCalibrationResult);
  $('#calibration-download').addEventListener('click', downloadCalibrationResult);
  $('#calibration-close').addEventListener('click', stopCalibration);
  $('#calibration-clear').addEventListener('click', () => {
    if (!confirm('确定清空当前浏览器中的全部校准草稿吗？')) return;
    state.calibrations = [];
    saveCalibrationDraft();
    renderMap();
    renderCalibrationPanel();
    focusCalibrationTarget();
    toast('全部校准草稿已清空');
  });
  $('#map-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-map-type]');
    if (!button) return;
    state.mapType = button.dataset.mapType;
    document.querySelectorAll('#map-filters [data-map-type]').forEach(item => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    renderMap();
  });
  $('#campus-map').addEventListener('click', event => {
    const detailButton = event.target.closest('[data-map-detail]');
    if (detailButton) detail(detailButton.dataset.mapDetail, 'map');
  });

    document.querySelectorAll('[data-go]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.returnMap === 'true') {
        scrollToMap();
      } else {
        // 👇 新增的代码：如果点的是“推荐首页”，清除高亮
        if (button.dataset.go === 'home') {
          state.homeRecommendationActive = false; // 取消推荐状态
          renderHomeFeed(); // 恢复下方的默认列表
          renderMap();      // 恢复地图的所有标记
        }
        go(button.dataset.go);
      }
    });
  });
  document.querySelectorAll('[data-scroll-map]').forEach(button => {
    button.addEventListener('click', () => scrollToMap());
  });
  $('#meal').addEventListener('click', event => {
    const button = event.target.closest('[data-v]');
    if (!button) return;
    state.meal = button.dataset.v;
    updateMealButtons();
  });
  updateMealButtons();
  $('#area-filter').addEventListener('click', event => {
    const button = event.target.closest('[data-v]');
    if (!button) return;
    state.area = button.dataset.v;
    document.querySelectorAll('#area-filter [data-v]').forEach(item => {
      item.setAttribute('aria-pressed', String(item === button));
    });
  });
  $('#place-type-filter').addEventListener('click', event => {
    const button = event.target.closest('[data-v]');
    if (!button) return;
    state.placeType = button.dataset.v;
    document.querySelectorAll('#place-type-filter [data-v]').forEach(item => {
      item.setAttribute('aria-pressed', String(item === button));
    });
  });
  $('#types').addEventListener('click', event => {
    const button = event.target.closest('[data-v]');
    if (!button) return;
    if (state.types.has(button.dataset.v)) state.types.delete(button.dataset.v);
    else state.types.add(button.dataset.v);
    button.setAttribute('aria-pressed', String(state.types.has(button.dataset.v)));
  });
  $('#quick').addEventListener('click', () => recommend(true));
  $('#recommend').addEventListener('click', () => recommend(false));
  document.querySelectorAll('[data-decision-tab]').forEach(button => {
    button.addEventListener('click', () => setDecisionTab(button.dataset.decisionTab));
  });
  $('#home-feed-list').addEventListener('click', event => {
    const focusButton = event.target.closest('[data-home-focus]');
    const detailButton = event.target.closest('[data-home-detail]');
    const swapButton = event.target.closest('[data-home-swap]');
    if (focusButton) focusPlaceOnMap(focusButton.dataset.homeFocus, { scroll: false });
    if (detailButton) detail(detailButton.dataset.homeDetail, 'map');
    if (swapButton) swap(Number(swapButton.dataset.homeSwap));
  });
      $('#reset-recommend-btn')?.addEventListener('click', () => {
    // 1. 清除推荐状态
    state.homeRecommendationActive = false;
    state.results = [];
    // 2. 重新渲染列表和地图
    renderHomeFeed();
    renderMap();
    // 3. 恢复地图初始视野
    if (leafletMap) {
      const sw = toMapCoords(114.3850, 30.5020);
      const ne = toMapCoords(114.4450, 30.5300);
      leafletMap.fitBounds(L.latLngBounds([sw.lat, sw.lng], [ne.lat, ne.lng]).pad(-0.1), { padding: [22, 22] });
    }
    toast('已恢复全部地点视野');
  });
  $('#cards').addEventListener('click', event => {
    const detailButton = event.target.closest('[data-detail]');
    const swapButton = event.target.closest('[data-swap]');
    if (detailButton) detail(detailButton.dataset.detail);
    if (swapButton) swap(Number(swapButton.dataset.swap));
  });
    // 为“全部地点”列表里的删除按钮绑定事件
  $('#adminlist').addEventListener('click', async event => {
    const deleteBtn = event.target.closest('[data-delete-place]');
    if (!deleteBtn) return;

    const id = deleteBtn.dataset.deletePlace;
    const name = deleteBtn.dataset.placeName;

    if (!confirm(`确定要彻底删除「${name}」吗？此操作不可恢复。`)) return;

    // 如果连了 API 后台，就请求后端删库
    if (state.hasBackend && adminToken) {
      try {
        deleteBtn.textContent = '删除中…';
        deleteBtn.disabled = true;
        await adminRequest(`/api/admin/places/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('已从数据库删除');
      } catch (error) {
        toast('删除失败：' + error.message);
        deleteBtn.textContent = '删除';
        deleteBtn.disabled = false;
        return; // 删除失败就停止，不刷新页面
      }
    } else {
      // 如果是纯本地模式（没有后台），就只在前端内存里删掉
      toast('当前未连接后台，已从页面移除（刷新会恢复）');
    }

    // 从前端内存数组中删掉
    const idx = state.places.findIndex(p => p.id === id);
    if (idx >= 0) {
      state.places.splice(idx, 1);
      renderAllPlaces(); // 重新渲染列表
      renderMap();       // 重新渲染地图
      populateFeedbackPlaces(); // 更新反馈下拉框
    }
  });
  
  $('#review').addEventListener('click', event => {
    const filterButton = event.target.closest('[data-review-filter]');
    const recordButton = event.target.closest('[data-review-code]');
    const actionButton = event.target.closest('[data-review-action]');
    if (filterButton) {
      reviewFilter = filterButton.dataset.reviewFilter;
      document.querySelectorAll('[data-review-filter]').forEach(button => button.setAttribute('aria-pressed', String(button === filterButton)));
      renderReview();
    }
    if (recordButton) {
      selectedReviewCode = recordButton.dataset.reviewCode;
      renderReview();
    }
    if (actionButton) decideFeedback(actionButton.dataset.reviewAction);
  });
  $('#review').addEventListener('submit', async event => {
    if (event.target.id !== 'admin-login-form') return;
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '正在验证…';
    try {
      await loginAdmin(event.target);
    } catch (error) {
      showAdminLogin(error.message);
      toast(error.message);
    }
  });

  // 管理员标签切换
  document.querySelectorAll('.admin-tab[data-admin-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.adminTab));
  });
  $('#admin-logout-btn')?.addEventListener('click', adminLogout);
  $('#add-place-btn')?.addEventListener('click', () => openPlaceModal(null));
  $('#add-dish-btn')?.addEventListener('click', () => openDishModal(null));
  $('#admin-place-search')?.addEventListener('input', (e) => {
    adminPlaceSearchQuery = e.target.value;
    renderAdminPlaces();
  });
  $('#admin-dish-search')?.addEventListener('input', (e) => {
    adminDishSearchQuery = e.target.value;
    renderAdminDishes();
  });

  $('#tracking-form').addEventListener('submit', async event => {
    event.preventDefault();
    const code = $('#tracking-code').value.trim();
    if (!code) return;
    $('#tracking-result').innerHTML = '<div class="empty">正在查询…</div>';
    try {
      renderFeedbackResult(await findFeedback(code));
    } catch (error) {
      $('#tracking-result').innerHTML = `<div class="empty">${escapeHtml(error.message || '查询失败，请稍后重试')}</div>`;
    }
  });
  document.querySelectorAll('[data-feedback-tab]').forEach(button => {
    button.addEventListener('click', () => activateFeedbackTab(button.dataset.feedbackTab));
  });
  $('#feedback-page-form').addEventListener('submit', event => {
    event.preventDefault();
    handleFeedbackSubmit(null, event.currentTarget, '#feedback-page-receipt');
  });
  $('#feedback-page-form').elements.feedbackType.addEventListener('change', event => {
    const isNew = event.target.value === '新增位置';
    const form = event.currentTarget.form;
    form.querySelector('[data-proposed-name]').hidden = !isNew;
    if (isNew) form.elements.placeId.value = '__new_place__';
    else if (form.elements.placeId.value === '__new_place__') form.elements.placeId.value = '';
  });
  $('#feedback-page-form').elements.placeId.addEventListener('change', event => {
    const form = event.currentTarget.form;
    const isNew = event.target.value === '__new_place__';
    form.querySelector('[data-proposed-name]').hidden = !isNew;
    if (isNew) form.elements.feedbackType.value = '新增位置';
    else if (form.elements.feedbackType.value === '新增位置') form.elements.feedbackType.value = '位置有误';
  });
}

setupPage();
updateAdminModeUI(); // 初始化管理员按钮状态
const initialView = location.hash.slice(1);
if (initialView === 'map') scrollToMap('auto');
else if (['home', 'admin', 'feedback', 'review', 'forum', 'agent'].includes(initialView)) go(initialView, { updateHistory: false });
window.addEventListener('popstate', () => {
  const view = location.hash.slice(1);
  if (view === 'map') scrollToMap('auto');
  else go(['home', 'results', 'detail', 'admin', 'feedback', 'review', 'forum', 'agent'].includes(view) ? view : 'home', { updateHistory: false });
});
loadPlaces();
// ================= 管理员图谱编辑逻辑 =================

function renderBatchToolbar() {
  let toolbar = document.getElementById('dish-batch-toolbar');
  if (!isAdminEditMode) {
     if (toolbar) toolbar.remove();
     return;
  }

  if (!toolbar) {
     toolbar = document.createElement('div');
     toolbar.id = 'dish-batch-toolbar';
     // 👇 核心修改：使用 fixed 定位，悬浮在页面顶部
     toolbar.style = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); width: calc(100% - 40px); max-width: 1480px; z-index: 9999; background: #fff; padding: 12px 16px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 12px; border: 1px solid var(--red); flex-wrap: wrap;';
     document.body.appendChild(toolbar); // 👈 直接挂载到 body 上，不受页面滚动影响
  }
  
  const count = state.selectedDishes.size;
  toolbar.innerHTML = `
    <span style="font-weight: bold; color: var(--ink)">已选 ${count} 项</span>
    <button type="button" class="secondary" onclick="window.selectAllDishes()">全选当前</button>
    <button type="button" class="secondary" onclick="window.clearSelectedDishes()">取消选择</button>
    <button type="button" class="primary" onclick="window.batchMoveDishes()" ${count === 0 ? 'disabled' : ''}>批量移动/合并</button>
    <button type="button" class="secondary" style="color: var(--red); border-color: var(--red);" onclick="window.batchDeleteDishes()" ${count === 0 ? 'disabled' : ''}>批量删除</button>
    <!-- 👇 新增：退出编辑按钮，直接放在悬浮条里，随用随点 -->
    <button type="button" class="primary" style="margin-left: auto; background: var(--ink); border-color: var(--ink);" onclick="window.toggleAdminEditMode()">退出编辑</button>
  `;
}

window.handleAdminDishClick = function(event, id) {
  if (!isAdminEditMode) return;
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON') return;
  
  let foundDish = null;
  for (const p of state.places) {
    const r = p.recommendations.find(x => x.id === id);
    if (r) {
      foundDish = r;
      break;
    }
  }
  if (!foundDish) return;
  
  if (!adminPlacesCache.length) adminPlacesCache = state.places;
  openDishModal({ ...foundDish });
};

window.deleteSingleDishFromGraph = async function(id) {
  if (!confirm('确定要删除这个菜品吗？')) return;
  try {
    await adminRequest(`/api/admin/recommendations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('删除成功');
    await loadAdminDishes();
    await refreshPlacesData();
    renderDishes();
  } catch (e) {
    toast('删除失败：' + e.message);
  }
};

window.selectAllDishes = function() {
  document.querySelectorAll('.dish-checkbox').forEach(cb => {
    cb.checked = true;
    state.selectedDishes.add(cb.dataset.dishId);
  });
  renderBatchToolbar();
};

window.clearSelectedDishes = function() {
  document.querySelectorAll('.dish-checkbox').forEach(cb => cb.checked = false);
  state.selectedDishes.clear();
  renderBatchToolbar();
};

window.batchMoveDishes = function() {
  if (state.selectedDishes.size === 0) return;
  const places = adminPlacesCache.length ? adminPlacesCache : state.places;
  const options = places.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const html = `
    <div class="admin-modal-overlay" id="batch-move-modal-overlay">
      <div class="admin-modal">
        <h3>将 ${state.selectedDishes.size} 个菜品移动/合并到...</h3>
        <div class="admin-modal-form">
          <label>目标店铺
            <select id="batch-move-target">${options}</select>
          </label>
          <div class="admin-modal-actions">
            <button type="button" id="batch-move-cancel">取消</button>
            <button type="button" class="primary" id="batch-move-confirm">确认移动</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('batch-move-modal-overlay');
  document.getElementById('batch-move-cancel').onclick = () => overlay.remove();
  
  document.getElementById('batch-move-confirm').onclick = async () => {
    const targetId = document.getElementById('batch-move-target').value;
    const btn = document.getElementById('batch-move-confirm');
    btn.disabled = true;
    btn.textContent = '处理中...';
    
    try {
      for (const id of state.selectedDishes) {
        await adminRequest(`/api/admin/recommendations/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ placeId: targetId }),
        });
      }
      toast('移动成功');
      overlay.remove();
      state.selectedDishes.clear();
      await loadAdminDishes(); 
      await refreshPlacesData();
      renderDishes(); 
    } catch (e) {
      toast('移动失败：' + e.message);
      btn.disabled = false;
      btn.textContent = '确认移动';
    }
  };
};

window.batchDeleteDishes = async function() {
  if (state.selectedDishes.size === 0) return;
  if (!confirm(`确定要删除选中的 ${state.selectedDishes.size} 个菜品吗？`)) return;
  try {
    for (const id of state.selectedDishes) {
      await adminRequest(`/api/admin/recommendations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    toast('批量删除成功');
    state.selectedDishes.clear();
    await loadAdminDishes();
    await refreshPlacesData();
    renderDishes();
  } catch (e) {
    toast('删除失败：' + e.message);
  }
};
// ================= 大家评（评分系统）逻辑 =================

function renderRating() {
  const container = $('#rating-list');
  if (!container) return;

  const filter = $('#rating-filters button[aria-selected="true"]')?.dataset.ratingFilter || 'all';
  const query = ($('#rating-search')?.value || '').trim().toLowerCase();

  let allDishes = [];
  state.places.forEach(place => {
    place.recommendations.forEach(r => {
      if (r.name.includes('见百景园')) return;
      // 搜索过滤
      if (query && !r.name.toLowerCase().includes(query) && !place.name.toLowerCase().includes(query)) return;
      
      allDishes.push({
        ...r,
        rating: Number(r.rating ?? 3.0),
        ratingCount: Number(r.ratingCount ?? 0),
        tags: r.tags || [],
        placeName: place.name,
      });
    });
  });

  if (filter === 'high') {
    allDishes = allDishes.filter(d => d.rating >= 4.0).sort((a, b) => b.rating - a.rating);
  } else if (filter === 'low') {
    allDishes = allDishes.filter(d => d.rating < 3.0).sort((a, b) => a.rating - b.rating);
  } else {
    allDishes.sort((a, b) => b.rating - a.rating);
  }

  const getStars = (score) => {
    const fullStars = Math.floor(score);
    const hasHalf = score % 1 !== 0;
    const emptyStars = Math.max(0, 5 - fullStars - (hasHalf ? 1 : 0));
    let str = '★'.repeat(fullStars);
    if (hasHalf) str += '⯨';
    str += '☆'.repeat(emptyStars);
    return str;
  };

  if (allDishes.length === 0) {
    container.innerHTML = '<div class="empty">暂无符合条件的数据</div>';
    return;
  }

  container.innerHTML = allDishes.map(d => {
    // 渲染标签
    const tagsHtml = d.tags.length > 0 
      ? `<div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px;">${d.tags.map(t => `<span style="font-size: 10px; padding: 2px 6px; background: #fff4df; color: #72503e; border-radius: 4px;">${escapeHtml(t)}</span>`).join('')}</div>` 
      : '';

    return `
    <div class="adminrow" style="cursor: pointer; align-items: center;" onclick="window.openRateModal('${d.id}')">
      <div style="flex: 1; min-width: 0;">
        <strong style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(d.name)}</strong>
        <small style="color: var(--muted);">${escapeHtml(d.placeName)} ${d.floor ? `· ${d.floor}楼` : ''}</small>
        ${tagsHtml}
      </div>
      <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
        <span style="color: var(--red); font-family: monospace; font-size: 15px; letter-spacing: 1px;">${getStars(d.rating)}</span>
        <span style="font-weight: bold; font-size: 16px; min-width: 35px; text-align: right;">${d.rating.toFixed(1)}</span>
        <span class="small" style="width: 50px; text-align: right;">(${d.ratingCount}人)</span>
      </div>
    </div>
  `}).join('');
}

// 打分弹窗
window.openRateModal = function(id) {
  let foundDish = null;
  let placeName = '';
  for (const p of state.places) {
    const r = p.recommendations.find(x => x.id === id);
    if (r) {
      foundDish = r;
      placeName = p.name;
      break;
    }
  }
  if (!foundDish) return;

  // 👇 判断是不是管理员，并判断是否已评价过
  const isAdmin = !!localStorage.getItem('hustmap-admin-token');
  const ratedDishes = JSON.parse(localStorage.getItem('hustmap-rated-dishes') || '[]');
  const hasRated = ratedDishes.includes(foundDish.id);

  if (!isAdmin && hasRated) {
    toast('你已经评价过这道菜啦，感谢支持！');
    return;
  }

  // 展示已有标签
  const existingTags = foundDish.tags || [];
  const existingTagsHtml = existingTags.length 
    ? `<div style="margin-bottom: 16px;"><span class="small" style="display:block; margin-bottom: 6px;">大家打过的标签</span><div style="display:flex; gap:6px; flex-wrap:wrap;">${existingTags.map(t => `<span style="font-size:12px; padding:4px 8px; background:#eee8e2; color:#7c6e65; border-radius:4px;">${escapeHtml(t)}</span>`).join('')}</div></div>`
    : '';

  const html = `
    <div class="admin-modal-overlay" id="rate-modal-overlay">
      <div class="admin-modal" style="max-width: 400px;">
        <h3 style="margin-bottom: 4px;">${escapeHtml(foundDish.name)}</h3>
        <p class="small" style="margin-bottom: 20px;">${escapeHtml(placeName)}</p>
        
        ${existingTagsHtml}

        <div style="text-align: center; margin-bottom: 24px;">
          <div id="rate-stars" style="font-size: 32px; color: var(--line); cursor: pointer; user-select: none; letter-spacing: 4px;">
            ★ ★ ★ ★ ★
          </div>
          <p class="small" style="margin-top: 8px;">点击星星打分</p>
        </div>

        <div style="margin-bottom: 20px;">
          <span class="small" style="display:block; margin-bottom: 8px;">添加标签（可选，可多选）</span>
          <div class="choices" id="rate-tags-container" style="gap: 6px; flex-wrap: wrap;">
            ${['味道赞', '性价比高', '量大', '份量少', '偏咸/偏油', '排队久', '环境好', '服务好', '避雷', '下次还来', '出餐快', '有点贵'].map(t => `
              <button type="button" class="choice" style="font-size:12px; padding: 5px 10px; border-radius: 4px;" data-tag="${t}" aria-pressed="false">${t}</button>
            `).join('')}
          </div>
        </div>

        <div class="admin-modal-actions">
          <button type="button" id="rate-cancel">取消</button>
          <button type="button" class="primary" id="rate-confirm">提交评价</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  
  let selectedScore = 5;
  const starEl = document.getElementById('rate-stars');
  
  starEl.addEventListener('click', (e) => {
    const rect = starEl.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    selectedScore = Math.ceil(percent * 5);
    if (selectedScore < 1) selectedScore = 1;
    if (selectedScore > 5) selectedScore = 5;
    let str = '';
    for (let i = 1; i <= 5; i++) {
      str += i <= selectedScore ? '<span style="color:var(--red)">★</span> ' : '<span>★</span> ';
    }
    starEl.innerHTML = str;
  });
  starEl.dispatchEvent(new MouseEvent('click', { clientX: starEl.getBoundingClientRect().right - 5 }));

  document.getElementById('rate-tags-container').addEventListener('click', (e) => {
    const btn = e.target.closest('.choice');
    if (!btn) return;
    const isPressed = btn.getAttribute('aria-pressed') === 'true';
    btn.setAttribute('aria-pressed', isPressed ? 'false' : 'true');
  });

  document.getElementById('rate-cancel').onclick = () => document.getElementById('rate-modal-overlay').remove();
  
  document.getElementById('rate-confirm').onclick = async () => {
    const btn = document.getElementById('rate-confirm');
    btn.disabled = true;
    btn.textContent = '提交中...';

    const tags = Array.from(document.querySelectorAll('#rate-tags-container .choice[aria-pressed="true"]')).map(b => b.dataset.tag);

    try {
      const res = await fetch(new URL('./api/rate', document.baseURI), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendationId: foundDish.id, score: selectedScore, tags: tags }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '打分失败');

      foundDish.rating = data.rating;
      foundDish.ratingCount = data.ratingCount;
      foundDish.tags = data.tags;

      // 👇 记录已评价
      if (!isAdmin) {
        ratedDishes.push(foundDish.id);
        localStorage.setItem('hustmap-rated-dishes', JSON.stringify(ratedDishes));
      }

      toast('感谢你的评价！');
      document.getElementById('rate-modal-overlay').remove();

      if (document.querySelector('.view.active')?.id === 'rating') {
        renderRating();
      }
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
      btn.textContent = '提交评价';
    }
  };
};

// 绑定过滤器事件
document.addEventListener('DOMContentLoaded', () => {
  // 因为 setupPage 已经绑定了很多事件，我们把过滤器的绑定放在这里也可以，或者直接加到 setupPage 里面
  // 为了不改乱你的 setupPage 结构，我们用事件委托挂在 body 上
  document.body.addEventListener('click', event => {
    const filterBtn = event.target.closest('[data-rating-filter]');
    if (filterBtn) {
      document.querySelectorAll('#rating-filters button').forEach(item => {
        item.setAttribute('aria-selected', String(item === filterBtn));
      });
      renderRating();
    }
  });
});
// ================= 普通用户登录/注册系统 =================

// 1. 初始化用户状态（塞到最前面的 state 对象里，或者直接挂在 window 上也行，这里为了简单直接放外面）
let userToken = localStorage.getItem('hustmap-user-token') || '';
let userInfo = JSON.parse(localStorage.getItem('hustmap-user-info') || 'null');

// 2. 在页面右上角动态注入一个按钮
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  
  // 创建登录按钮
  const userBtn = document.createElement('button');
  userBtn.id = 'user-login-btn';
  userBtn.className = 'secondary';
  userBtn.style.marginLeft = '12px';
  userBtn.textContent = userToken && userInfo ? `👤 ${userInfo.nickname || userInfo.username}` : '👤 登录 / 注册';
  
  // 挂载到导航栏最后
  nav.appendChild(userBtn);

  userBtn.addEventListener('click', () => {
    if (userToken && userInfo) {
      if (confirm(`当前已登录：${userInfo.username}\n是否退出登录？`)) {
        logoutUser();
      }
    } else {
      openUserModal();
    }
  });
});

// 3. 退出登录
function logoutUser() {
  userToken = '';
  userInfo = null;
  localStorage.removeItem('hustmap-user-token');
  localStorage.removeItem('hustmap-user-info');
  window.dispatchEvent(new CustomEvent('hustmap:user-changed'));
  const btn = document.getElementById('user-login-btn');
  if (btn) btn.textContent = '👤 登录 / 注册';
  toast('已退出登录');
}

// 4. 打开登录/注册弹窗
function openUserModal() {
  // 如果已经有弹窗，先删掉
  document.getElementById('user-modal-overlay')?.remove();

  const html = `
    <div class="admin-modal-overlay" id="user-modal-overlay">
      <div class="admin-modal" style="max-width: 360px;">
        <h3 style="margin-bottom: 16px;" id="user-modal-title">登录账号</h3>
        
        <form id="user-auth-form" class="admin-modal-form">
          <label>用户名 <input name="username" required placeholder="请输入用户名"></label>
          <label>密码 <input name="password" type="password" required placeholder="请输入密码"></label>
          
          <div style="margin-top: 12px; font-size: 13px; text-align: center; color: var(--muted);">
            <span id="user-toggle-text">还没有账号？</span>
            <a href="javascript:void(0)" id="user-toggle-mode" style="color: var(--red); text-decoration: underline;">去注册</a>
          </div>

          <div class="admin-modal-actions" style="margin-top: 20px;">
            <button type="button" id="user-modal-cancel">取消</button>
            <button type="submit" class="primary" id="user-submit-btn">登录</button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', html);
  
  let isRegisterMode = false;
  const form = document.getElementById('user-auth-form');
  const title = document.getElementById('user-modal-title');
  const toggleText = document.getElementById('user-toggle-text');
  const toggleLink = document.getElementById('user-toggle-mode');
  const submitBtn = document.getElementById('user-submit-btn');
  const overlay = document.getElementById('user-modal-overlay');

  document.getElementById('user-modal-cancel').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // 切换登录/注册模式
  toggleLink.onclick = () => {
    isRegisterMode = !isRegisterMode;
    if (isRegisterMode) {
      title.textContent = '注册新账号';
      toggleText.textContent = '已经有账号了？';
      toggleLink.textContent = '去登录';
      submitBtn.textContent = '注册';
    } else {
      title.textContent = '登录账号';
      toggleText.textContent = '还没有账号？';
      toggleLink.textContent = '去注册';
      submitBtn.textContent = '登录';
    }
  };

  // 提交表单
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const body = {
      username: data.get('username').trim(),
      password: data.get('password')
    };

    submitBtn.disabled = true;
    submitBtn.textContent = '处理中...';

    const endpoint = isRegisterMode ? '/api/user/register' : '/api/user/login';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const resData = await res.json();

      if (!res.ok) throw new Error(resData.message || resData.error || '请求失败');

      if (isRegisterMode) {
        toast('注册成功！请登录');
        // 注册成功后自动切回登录界面，并填入刚才的账号
        toggleLink.click();
        form.elements.username.value = body.username;
        form.elements.password.value = '';
      } else {
        // 登录成功
        userToken = resData.token;
        userInfo = resData.user;
        localStorage.setItem('hustmap-user-token', userToken);
        localStorage.setItem('hustmap-user-info', JSON.stringify(userInfo));
        window.dispatchEvent(new CustomEvent('hustmap:user-changed'));
        
        toast(`欢迎回来，${userInfo.nickname || userInfo.username}！`);
        
        // 更新右上角按钮文字
        const btn = document.getElementById('user-login-btn');
        if (btn) btn.textContent = `👤 ${userInfo.nickname || userInfo.username}`;
        
        overlay.remove();
      }
    } catch (err) {
      toast(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isRegisterMode ? '注册' : '登录';
    }
  };
}
