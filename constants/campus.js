const CAMPUS_STRUCTURE = [
  {
    category: '宿舍区',
    areas: [
      { name: '东区', locations: ['东一舍', '东二舍', '东三舍', '东四舍'] },
      { name: '南区', locations: ['南一舍', '南二舍', '南三舍'] },
      { name: '西区', locations: ['西一舍', '西二舍', '西三舍'] },
      { name: '北区', locations: ['北一舍', '北二舍', '北三舍'] },
    ],
  },
  {
    category: '教学楼',
    areas: [
      { name: '东区', locations: ['一号教学楼', '二号教学楼'] },
      { name: '南区', locations: ['综合教学楼A', '综合教学楼B'] },
      { name: '北区', locations: ['博学楼', '致知楼'] },
    ],
  },
  {
    category: '行政与科研楼',
    areas: [
      { name: '中心区', locations: ['行政楼', '图书信息中心', '国际交流中心'] },
      { name: '实验区', locations: ['理学院科研楼', '工学院实验楼', '材料学院楼'] },
    ],
  },
  {
    category: '运动场馆',
    areas: [
      { name: '东区', locations: ['田径场', '游泳馆'] },
      { name: '西区', locations: ['体育馆', '篮球中心', '网球场'] },
      { name: '北区', locations: ['羽毛球馆', '综合健身房'] },
    ],
  },
  {
    category: '食堂',
    areas: [
      { name: '东区', locations: ['东区食堂', '清真餐厅'] },
      { name: '南区', locations: ['南区食堂'] },
      { name: '西区', locations: ['西区食堂', '校园咖啡厅'] },
      { name: '北区', locations: ['北区食堂'] },
    ],
  },
  {
    category: '公共服务',
    areas: [
      { name: '中心区', locations: ['图书馆', '校园银行', '医务室'] },
      { name: '生活区', locations: ['快递驿站', '洗衣房', '文创商店'] },
    ],
  },
];

const CATEGORY_NAMES = CAMPUS_STRUCTURE.map((item) => item.category);

function getCategoryNames() {
  return CATEGORY_NAMES;
}

function getAreaNames(categoryName) {
  const category = CAMPUS_STRUCTURE.find((item) => item.category === categoryName) || CAMPUS_STRUCTURE[0];
  return category.areas.map((area) => area.name);
}

function getLocationNames(categoryName, areaName) {
  const category = CAMPUS_STRUCTURE.find((item) => item.category === categoryName) || CAMPUS_STRUCTURE[0];
  const area = category.areas.find((item) => item.name === areaName) || category.areas[0];
  return area.locations;
}

function normalizeSelection(selection = {}) {
  const categoryName = selection.category || CAMPUS_STRUCTURE[0].category;
  const category = CAMPUS_STRUCTURE.find((item) => item.category === categoryName) || CAMPUS_STRUCTURE[0];

  const areaName = selection.area || category.areas[0].name;
  const area = category.areas.find((item) => item.name === areaName) || category.areas[0];

  const locationName = selection.location || area.locations[0];

  return {
    category: category.category,
    area: area.name,
    location: locationName,
  };
}

function buildCampusDisplayName(selection) {
  if (!selection) {
    return '';
  }
  const normalized = normalizeSelection(selection);
  return `${normalized.category} · ${normalized.area} · ${normalized.location}`;
}

function findSelectionIndices(selection) {
  const normalized = normalizeSelection(selection);
  const categoryIndex = CAMPUS_STRUCTURE.findIndex((item) => item.category === normalized.category);
  const areas = getAreaNames(normalized.category);
  const areaIndex = areas.findIndex((name) => name === normalized.area);
  const locations = getLocationNames(normalized.category, normalized.area);
  const locationIndex = locations.findIndex((name) => name === normalized.location);
  return {
    categoryIndex: categoryIndex >= 0 ? categoryIndex : 0,
    areaIndex: areaIndex >= 0 ? areaIndex : 0,
    locationIndex: locationIndex >= 0 ? locationIndex : 0,
  };
}

const CAMPUS_ZONES = CAMPUS_STRUCTURE.flatMap((category) =>
  category.areas.flatMap((area) => area.locations.map((location) => `${category.category} · ${area.name} · ${location}`))
);

module.exports = {
  CAMPUS_STRUCTURE,
  CAMPUS_ZONES,
  getCategoryNames,
  getAreaNames,
  getLocationNames,
  normalizeSelection,
  buildCampusDisplayName,
  findSelectionIndices,
};
