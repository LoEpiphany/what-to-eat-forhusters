// 批量更新 seed.json：去重、补坐标、新增店铺、商场结构
import { readFileSync, writeFileSync } from 'node:fs';

const seedPath = './database/seed.json';
const raw = JSON.parse(readFileSync(seedPath, 'utf8'));

// ====== GCJ-02 → WGS-84 转换 ======
// 搜索结果大多是高德坐标（GCJ-02），seed.json 统一存 WGS-84
const PI = Math.PI;
const a = 6378245.0;
const ee = 0.00669342162296594323;

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x, y) {
  let ret = -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  ret += (20.0*Math.sin(6.0*x*PI) + 20.0*Math.sin(2.0*x*PI)) * 2.0/3.0;
  ret += (20.0*Math.sin(y*PI) + 40.0*Math.sin(y/3.0*PI)) * 2.0/3.0;
  ret += (160.0*Math.sin(y/12.0*PI) + 320*Math.sin(y*PI/30.0)) * 2.0/3.0;
  return ret;
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  ret += (20.0*Math.sin(6.0*x*PI) + 20.0*Math.sin(2.0*x*PI)) * 2.0/3.0;
  ret += (20.0*Math.sin(x*PI) + 40.0*Math.sin(x/3.0*PI)) * 2.0/3.0;
  ret += (150.0*Math.sin(x/12.0*PI) + 300.0*Math.sin(x/30.0*PI)) * 2.0/3.0;
  return ret;
}
function gcj02ToWgs84(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  return [lng - dLng, lat - dLat];
}

// 辅助：从 GCJ-02 转 WGS84，保留6位小数
function fromGCJ(lng, lat) {
  const [wLng, wLat] = gcj02ToWgs84(lng, lat);
  return { longitude: +wLng.toFixed(6), latitude: +wLat.toFixed(6) };
}

// ====== 参考坐标（WGS84，来自已有 seed 数据） ======
const REF = {
  // 西区
  xiyi: { lng: 114.400505, lat: 30.516593 },     // 西一食堂
  xier: { lng: 114.399555, lat: 30.516512 },     // 西二食堂
  baijingyuan: { lng: 114.402179, lat: 30.518657 }, // 百景园
  xihuayuanLamb: { lng: 114.400907, lat: 30.516637 }, // 西华园羊排
  songlinli: { lng: 114.401242, lat: 30.516622 }, // 菘邻里
  // 中区
  dongyi: { lng: 114.413816, lat: 30.513675 },   // 东一食堂
  dongsan: { lng: 114.414837, lat: 30.513250 },  // 东三食堂
  jijinyuan: { lng: 114.409330, lat: 30.519132 }, // 集锦园
  yuyuan: { lng: 114.409243, lat: 30.518615 },   // 喻园食堂
  jixianlou: { lng: 114.411408, lat: 30.516945 }, // 集贤楼
  // 东区
  dongyuan: { lng: 114.430525, lat: 30.515924 }, // 东园食堂
  xueer: { lng: 114.426332, lat: 30.514342 },    // 学二食堂
  dongjiaogong: { lng: 114.426594, lat: 30.509172 }, // 东教工
  yunyuanChaka: { lng: 114.427001, lat: 30.518452 }, // 韵苑茶咖
  burgerKing: { lng: 114.426150, lat: 30.513050 }, // 汉堡王（东校区）
  // 校门（估算）
  nanSanMen: { lng: 114.4038, lat: 30.5095 },    // 南三门
  nanErMen: { lng: 114.4102, lat: 30.5080 },     // 南二门
  nanSiMen: { lng: 114.4175, lat: 30.5068 },     // 南四门
  xiXiaoMen: { lng: 114.3975, lat: 30.5135 },    // 西小门
  dongXiaoMen: { lng: 114.4325, lat: 30.5155 },  // 东小门/生活门
  // 校外商圈
  guangguPlaza: { lng: 114.4025, lat: 30.5055 }, // 光谷广场/世界城
  fanyuecheng: { lng: 114.4135, lat: 30.5058 },  // 泛悦城
};

// 基于参考点做小幅偏移估算
function offset(ref, dLng, dLat) {
  return {
    longitude: +(ref.lng + dLng).toFixed(6),
    latitude: +(ref.lat + dLat).toFixed(6),
  };
}

// ====== 坐标补全表 ======
// key: place id, value: { longitude, latitude, coordinateSource }
// 所有坐标统一为 WGS-84
const coordMap = {
  // === 食堂类 ===
  'canteen-baihuiyuan': { // 百惠园 - 西区，西一再往西南，紫菘公寓附近
    ...offset(REF.xiyi, -0.0012, -0.0015),
    coordinateSource: '估算（西一食堂西南方向，紫菘公寓旁）',
  },
  'canteen-xueyi': { // 学一食堂 - 东校区学二旁边
    ...offset(REF.xueer, 0.0008, 0.0005),
    coordinateSource: '估算（学二食堂东侧）',
  },
  'canteen-yunjiu': { // 韵酒食堂 - 韵苑食堂二楼
    ...offset(REF.dongyuan, -0.0015, -0.0010),
    coordinateSource: '估算（韵苑食堂区域，东园西侧）',
  },
  'canteen-yunyuan': { // 韵苑食堂 - 360地图 GCJ-02: 114.431913, 30.514299
    ...fromGCJ(114.431913, 30.514299),
    coordinateSource: '360地图（GCJ-02 转 WGS-84）',
  },
  'shop-wutongyu': { // 梧桐语餐厅 - 360地图 GCJ-02: 114.415800, 30.514659
    ...fromGCJ(114.415800, 30.514659),
    coordinateSource: '360地图（GCJ-02 转 WGS-84）',
  },

  // === 校内店铺类 ===
  'shop-yipindouhua': { // 壹品豆花 - 360地图 GCJ-02: 114.431830, 30.511540
    ...fromGCJ(114.431830, 30.511540),
    coordinateSource: '360地图（城建学院店，GCJ-02 转 WGS-84）',
  },
  'shop-hanweiwu': { // 韩味屋 - 360地图 GCJ-02: 114.432710, 30.506080
    ...fromGCJ(114.432710, 30.506080),
    coordinateSource: '360地图（华科店，GCJ-02 转 WGS-84）',
  },
  'shop-dongbiancbd': { // 东边CBD - 东校区韵苑附近的商业区
    ...offset(REF.dongyuan, -0.0020, -0.0005),
    coordinateSource: '估算（东校区韵苑附近）',
  },
  'shop-guming': { // 古茗 - 360地图鲁磨路店 GCJ-02: 114.399940, 30.513340
    ...fromGCJ(114.399940, 30.513340),
    coordinateSource: '360地图（鲁磨路店，GCJ-02 转 WGS-84）',
  },
  'shop-xihuayuan': { // 西华园 - 360地图 GCJ-02: 114.405843, 30.514289
    ...fromGCJ(114.405843, 30.514289),
    coordinateSource: '360地图（GCJ-02 转 WGS-84）',
  },
  'shop-xiquwangqiuchang': { // 西区网球场小吃摊 - 西区网球场旁
    ...offset(REF.xiyi, 0.0015, -0.0010),
    coordinateSource: '估算（西区网球场旁，西一东南）',
  },
  'shop-xishidaershu': { // 西十二大叔山东煎饼 - 南三门
    ...offset(REF.nanSanMen, 0.0003, -0.0002),
    coordinateSource: '估算（南三门附近）',
  },
  'shop-xiaji': { // 夏记水果捞 - 喻园步行街
    ...offset(REF.yuyuan, 0.0005, -0.0008),
    coordinateSource: '估算（喻园步行街附近）',
  },
  'shop-lucai': { // 绝望坡卤菜 - 绝望坡
    ...offset(REF.baijingyuan, -0.0005, -0.0020),
    coordinateSource: '估算（绝望坡中段）',
  },

  // === 校外门店类 - 知名地点 ===
  'shop-guanggu_shijiecheng': { // 光谷世界城 - 高德 GCJ-02: 114.402329, 30.505311
    ...fromGCJ(114.402329, 30.505311),
    coordinateSource: '高德地图（GCJ-02 转 WGS-84）',
  },
  'shop-guanggu_buxingjie': { // 光谷步行街 - 同世界城
    ...fromGCJ(114.402329, 30.505311),
    coordinateSource: '高德地图（GCJ-02 转 WGS-84）',
  },
  'shop-fanyuecheng': { // 泛悦城 - Bigemap GCJ-02: 114.413493, 30.505786
    ...fromGCJ(114.413493, 30.505786),
    coordinateSource: 'Bigemap（GCJ-02 转 WGS-84）',
  },
  'shop-zhijiamian': { // 郅家面馆 - 高德 GCJ-02: 114.410856, 30.507359
    ...fromGCJ(114.410856, 30.507359),
    coordinateSource: '高德地图（GCJ-02 转 WGS-84）',
  },
  'shop-yulaiyumei': { // 鱼来鱼美 - 高德 GCJ-02: 114.417352, 30.506760
    ...fromGCJ(114.417352, 30.506760),
    coordinateSource: '高德地图（GCJ-02 转 WGS-84）',
  },

  // === 校外门店类 - 估算位置 ===
  'shop-laoxiangji': { // 老乡鸡 - 鲁磨路紫菘附近
    ...offset(REF.xiXiaoMen, 0.0010, 0.0010),
    coordinateSource: '估算（鲁磨路联峰时代广场）',
  },
  'shop-yangguofu': { // 杨国福麻辣烫 - 华科附近
    ...offset(REF.nanSiMen, 0.0010, 0.0005),
    coordinateSource: '估算（南四门附近）',
  },
  'shop-zhangliang': { // 张亮麻辣烫 - 珞瑜路
    ...offset(REF.nanErMen, 0.0020, -0.0005),
    coordinateSource: '估算（南二门东侧珞瑜路）',
  },
  'shop-gudejiwang': { // 古德鸡王 - 生活门右侧
    ...offset(REF.dongXiaoMen, 0.0008, -0.0005),
    coordinateSource: '估算（东区生活门右侧）',
  },
  'shop-xiaomindapaidang': { // 小民大排档 - 生活门外
    ...offset(REF.dongXiaoMen, 0.0010, -0.0008),
    coordinateSource: '估算（东区生活门外）',
  },
  'shop-laobingshaokao': { // 老兵烧烤 - 生活门外
    ...offset(REF.dongXiaoMen, 0.0012, -0.0006),
    coordinateSource: '估算（东区生活门外）',
  },
  'shop-shenghuomenluosifen': { // 生活门螺蛳粉 - 生活门右侧约100m
    ...offset(REF.dongXiaoMen, 0.0010, -0.0003),
    coordinateSource: '估算（东区生活门右侧约100米）',
  },
  'shop-shashinvtrenchuan': { // 沙市女人串串 - 光谷世界城附近
    ...offset(REF.guangguPlaza, 0.0015, 0.0008),
    coordinateSource: '估算（光谷世界城西班牙风情街附近）',
  },
  'shop-fanglingxiaochu': { // 房陵小厨 - 南二门金地世家
    ...offset(REF.nanErMen, 0.0008, -0.0005),
    coordinateSource: '估算（南二门金地光谷世家）',
  },
  'shop-qinjianmian': { // 秦见面 - 南二门对面
    ...offset(REF.nanErMen, 0.0003, -0.0003),
    coordinateSource: '估算（南二门对面）',
  },
  'shop-azhenchaomifen': { // 啊臻炒米粉 - 光谷
    ...offset(REF.guangguPlaza, 0.0020, 0.0010),
    coordinateSource: '估算（光谷步行街附近）',
  },
  'shop-nansanmenyaxue': { // 南三门鸭血粉丝汤 - 南三门对面
    ...offset(REF.nanSanMen, 0.0005, -0.0003),
    coordinateSource: '估算（南三门对面珞瑜路）',
  },
  'shop-xianxiaochi': { // 东小门外西安特色小吃 - 东小门外
    ...offset(REF.dongXiaoMen, 0.0008, 0.0002),
    coordinateSource: '估算（东校区正门外）',
  },
  'shop-heleimian': { // 豫中饸饹面 - 华科周边
    ...offset(REF.xiXiaoMen, 0.0005, -0.0010),
    coordinateSource: '估算（鲁磨路南段）',
  },
  'shop-xieshifuniugu': { // 谢师傅牛骨头 - 光谷
    ...offset(REF.fanyuecheng, 0.0030, -0.0020),
    coordinateSource: '估算（关山大道南段格林东郡附近）',
  },
  'shop-qianqiqi': { // 黔七七 - 光谷风情街
    ...offset(REF.guangguPlaza, 0.0018, 0.0005),
    coordinateSource: '估算（光谷世界城法国风情街附近）',
  },
  'shop-ziranwei': { // 自然味 - 光谷大道
    ...offset(REF.fanyuecheng, 0.0050, -0.0010),
    coordinateSource: '估算（光谷大道创业街附近）',
  },
  'shop-dongxiangrenjia': { // 东乡人家 - 华科附近
    ...offset(REF.nanSiMen, 0.0020, -0.0010),
    coordinateSource: '估算（光谷体育馆附近）',
  },
  'shop-guoshenmalatang': { // 锅神麻辣烫 - 珞瑜路888号
    ...offset(REF.nanSiMen, 0.0008, -0.0003),
    coordinateSource: '估算（南四门对面剑桥春天）',
  },
  'shop-chongqingfanzhuang': { // 重庆饭庄 - 雄楚大道
    ...offset(REF.nanSiMen, 0.0030, -0.0050),
    coordinateSource: '估算（雄楚大道保利花园附近）',
  },
  'shop-kaoroumingjia': { // 炽城烤肉名家 - 华科附近
    ...offset(REF.fanyuecheng, 0.0010, 0.0010),
    coordinateSource: '估算（泛悦城附近）',
  },
  'shop-shishangjia': { // 食尚嘉养生鱼 - 光谷大道
    ...offset(REF.fanyuecheng, 0.0040, -0.0015),
    coordinateSource: '估算（光谷大道未来之光附近）',
  },
  'shop-chengdumaocai': { // 西小门外成都冒菜 - 西小门外
    ...offset(REF.xiXiaoMen, -0.0005, 0.0003),
    coordinateSource: '估算（西小门外鲁磨路）',
  },
  'shop-yunnanhuoguo': { // 西小门外云南火锅 - 西小门外
    ...offset(REF.xiXiaoMen, -0.0006, 0.0005),
    coordinateSource: '估算（西小门外鲁磨路）',
  },

  // === 重复条目（后面的重复项） ===
  'shop-riceball': { // 一捧饭团（重复项，第86行）- 用已有坐标
    longitude: 114.417635, latitude: 30.517630,
    coordinateSource: '补全（与第20行同一店铺）',
  },
  'shop-pizzahut': { // 必胜客（重复项，第87行）- 用已有坐标
    longitude: 114.418652, latitude: 30.517168,
    coordinateSource: '补全（与第21行同一店铺）',
  },
};

// ====== 新增店铺（数据里完全没有的） ======
const newPlaces = [
  // 校外新店
  {
    id: 'shop-youmagang', name: '油麻岗', placeType: 'shop',
    sourceGroup: '校外', campusArea: 'out', locationStatus: '大致位置',
    sourceLabel: '油麻岗',
    ...offset(REF.guangguPlaza, 0.0010, 0.0015),
    coordinateSource: '估算（光谷世界城附近）',
    verificationStatus: '待确认', lastConfirmedAt: '2026-11-07',
  },
  {
    id: 'shop-paidangjianghu', name: '排档江湖', placeType: 'shop',
    sourceGroup: '校外', campusArea: 'out', locationStatus: '大致位置',
    sourceLabel: '排档江湖',
    ...offset(REF.dongXiaoMen, 0.0020, -0.0010),
    coordinateSource: '估算（东区生活门外）',
    verificationStatus: '待确认', lastConfirmedAt: '2026-11-07',
  },
  {
    id: 'shop-liuzhou-luosifen', name: '柳州螺蛳粉&桂林米粉', placeType: 'shop',
    sourceGroup: '校外', campusArea: 'out', locationStatus: '大致位置',
    sourceLabel: '柳州螺蛳粉',
    ...offset(REF.dongXiaoMen, 0.0015, -0.0002),
    coordinateSource: '估算（东区生活门附近）',
    verificationStatus: '待确认', lastConfirmedAt: '2026-11-07',
  },
  {
    id: 'shop-songbencang', name: '松本藏日式烤肉', placeType: 'shop',
    sourceGroup: '校外', campusArea: 'out', locationStatus: '大致位置',
    sourceLabel: '松本藏',
    ...offset(REF.guangguPlaza, 0.0025, 0.0010),
    coordinateSource: '估算（光谷世界城附近）',
    verificationStatus: '待确认', lastConfirmedAt: '2026-11-07',
  },
  {
    id: 'shop-hubai', name: '虎白川味寿司', placeType: 'shop',
    sourceGroup: '校外', campusArea: 'out', locationStatus: '大致位置',
    sourceLabel: '虎白川味寿司',
    ...offset(REF.guangguPlaza, 0.0015, 0.0012),
    coordinateSource: '估算（光谷步行街附近）',
    verificationStatus: '待确认', lastConfirmedAt: '2026-11-07',
  },
  {
    id: 'shop-changsha-nvren', name: '长沙市女人串串', placeType: 'shop',
    sourceGroup: '校外', campusArea: 'out', locationStatus: '大致位置',
    sourceLabel: '长沙市女人串串',
    ...offset(REF.guangguPlaza, 0.0008, 0.0006),
    coordinateSource: '估算（光谷世界城附近）',
    verificationStatus: '待确认', lastConfirmedAt: '2026-11-07',
  },

  // 百景园三楼（独立店铺，挨着百景园）
  {
    id: 'canteen-baijingyuan-3f', name: '百景园三楼', placeType: 'canteen',
    sourceGroup: '食堂', campusArea: 'west', locationStatus: '大致位置',
    sourceLabel: '百景园三楼', parentId: 'canteen-baijingyuan',
    ...offset(REF.baijingyuan, 0.0001, 0.0001), // 同一栋楼，微偏
    coordinateSource: '估算（百景园食堂三楼）',
    verificationStatus: '待确认', lastConfirmedAt: '2026-11-07',
  },
];

// ====== 商场/美食城的子店铺 ======
// 东边CBD子店（先列几个常见的）
const cbdSubShops = [
  { id: 'shop-cbd-mala', name: '麻辣烫', placeType: 'shop', sourceGroup: '校内', parentId: 'shop-dongbiancbd', campusArea: 'east', sourceLabel: '东边CBD：麻辣烫', verificationStatus: '待确认', lastConfirmedAt: '2026-11-07' },
  { id: 'shop-cbd-chaofan', name: '炒饭', placeType: 'shop', sourceGroup: '校内', parentId: 'shop-dongbiancbd', campusArea: 'east', sourceLabel: '东边CBD：炒饭', verificationStatus: '待确认', lastConfirmedAt: '2026-11-07' },
  { id: 'shop-cbd-shuijiao', name: '水饺', placeType: 'shop', sourceGroup: '校内', parentId: 'shop-dongbiancbd', campusArea: 'east', sourceLabel: '东边CBD：水饺', verificationStatus: '待确认', lastConfirmedAt: '2026-11-07' },
];

// 光谷世界城子店（连锁品牌，坐标用世界城中心）
const worldCitySubShops = [
  { id: 'shop-shijie-kuaishou', name: '快手菜', placeType: 'shop', sourceGroup: '校外', parentId: 'shop-guanggu_shijiecheng', campusArea: 'out', sourceLabel: '世界城：快手菜', verificationStatus: '待确认', lastConfirmedAt: '2026-11-07' },
];

// 泛悦城子店
const fanyueSubShops = [
  { id: 'shop-fanyue-chaoshiji', name: '超食集', placeType: 'shop', sourceGroup: '校外', parentId: 'shop-fanyuecheng', campusArea: 'out', sourceLabel: '泛悦城：超食集', verificationStatus: '待确认', lastConfirmedAt: '2026-11-07' },
];

// ====== 处理逻辑 ======
// 1. 给已有地点补坐标
// 2. 去重（按 id）
// 3. 新增地点
// 4. 更新商场子店铺坐标（继承父店）

const seen = new Set();
const finalPlaces = [];

// 先处理所有已有地点
for (const place of raw.places) {
  if (seen.has(place.id)) {
    console.log(`去重：跳过重复 id=${place.id} name=${place.name}`);
    continue;
  }
  seen.add(place.id);

  // 补坐标
  if ((place.longitude === undefined || place.longitude === null) && coordMap[place.id]) {
    const c = coordMap[place.id];
    place.longitude = c.longitude;
    place.latitude = c.latitude;
    place.coordinateSource = c.coordinateSource;
    place.locationStatus = '大致位置';
    console.log(`补坐标：${place.name} -> (${place.longitude}, ${place.latitude})`);
  }

  finalPlaces.push(place);
}

// 新增地点
for (const place of newPlaces) {
  if (seen.has(place.id)) {
    console.log(`跳过已存在：${place.id}`);
    continue;
  }
  seen.add(place.id);
  finalPlaces.push(place);
  console.log(`新增：${place.name} (${place.longitude}, ${place.latitude})`);
}

// 把东边CBD改成 food_court 类型，并添加子店
const cbdPlace = finalPlaces.find(p => p.id === 'shop-dongbiancbd');
if (cbdPlace) {
  cbdPlace.placeType = 'food_court';
  cbdPlace.name = '东边CBD';
  // 添加子店，继承坐标
  for (const sub of cbdSubShops) {
    if (!seen.has(sub.id)) {
      sub.longitude = cbdPlace.longitude;
      sub.latitude = cbdPlace.latitude;
      sub.coordinateSource = cbdPlace.coordinateSource;
      sub.locationStatus = '大致位置';
      finalPlaces.push(sub);
      seen.add(sub.id);
      console.log(`新增CBD子店：${sub.name}`);
    }
  }
}

// 光谷世界城改成 food_court
const worldCityPlace = finalPlaces.find(p => p.id === 'shop-guanggu_shijiecheng');
if (worldCityPlace) {
  worldCityPlace.placeType = 'food_court';
  worldCityPlace.name = '光谷世界城';
  for (const sub of worldCitySubShops) {
    if (!seen.has(sub.id)) {
      sub.longitude = worldCityPlace.longitude;
      sub.latitude = worldCityPlace.latitude;
      sub.coordinateSource = worldCityPlace.coordinateSource;
      sub.locationStatus = '大致位置';
      finalPlaces.push(sub);
      seen.add(sub.id);
      console.log(`新增世界城子店：${sub.name}`);
    }
  }
}

// 泛悦城改成 food_court
const fanyuePlace = finalPlaces.find(p => p.id === 'shop-fanyuecheng');
if (fanyuePlace) {
  fanyuePlace.placeType = 'food_court';
  fanyuePlace.name = '泛悦城';
  for (const sub of fanyueSubShops) {
    if (!seen.has(sub.id)) {
      sub.longitude = fanyuePlace.longitude;
      sub.latitude = fanyuePlace.latitude;
      sub.coordinateSource = fanyuePlace.coordinateSource;
      sub.locationStatus = '大致位置';
      finalPlaces.push(sub);
      seen.add(sub.id);
      console.log(`新增泛悦城子店：${sub.name}`);
    }
  }
}

// 统计
const withCoords = finalPlaces.filter(p => p.longitude !== undefined && p.longitude !== null).length;
const canteens = finalPlaces.filter(p => p.placeType === 'canteen').length;
const shops = finalPlaces.filter(p => p.placeType === 'shop').length;
const foodCourts = finalPlaces.filter(p => p.placeType === 'food_court').length;
const takeout = finalPlaces.filter(p => p.campusArea === 'takeout').length;

console.log(`\n====== 统计 ======`);
console.log(`总地点数：${finalPlaces.length}`);
console.log(`有坐标的：${withCoords}`);
console.log(`食堂：${canteens}`);
console.log(`店铺：${shops}`);
console.log(`美食城：${foodCourts}`);
console.log(`外卖：${takeout}`);

// 写回
raw.places = finalPlaces;
writeFileSync(seedPath, JSON.stringify(raw, null, 2), 'utf8');
console.log('\n✓ 已保存到 database/seed.json');
