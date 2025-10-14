const CAMPUS_STRUCTURE = [
  {
    category: '宿舍区',
    areas: [
      {
        name: '东区',
        locations: ['东二', '东三', '东四', '东五', '东六', '东七', '东八', '东九', '东十', '东十一', '东十二'],
      },
      {
        name: '西区',
        locations: [
          '西一',
          '西二',
          '西三',
          '西四',
          '西五',
          '西六',
          '西七',
          '西八',
          '西九',
          '西十',
          '西十一',
          '西十二',
          '西十三',
          '西十四',
          '西十五',
          '西十六',
          '西十七',
          '西十八',
          '西十九',
          '西二十',
          '西二十一',
        ],
      },
      {
        name: '北区',
        locations: [
          '北一',
          '北二',
          '北三',
          '北四',
          '北五',
          '北六',
          '北七',
          '北八',
          '北九',
          '北十',
          '北十一',
          '北十二',
          '北十三',
          '北十四',
          '北十五',
          '北十六',
          '北十七',
          '北十八',
        ],
      },
      {
        name: '其他',
        locations: ['成教楼', '博士后公寓'],
      },
    ],
  },
  {
    category: '教学楼',
    areas: [
      {
        name: '东区',
        locations: ['1号楼'],
      },
      {
        name: '西区',
        locations: ['31号楼', '32号楼', '33号楼', '34号楼'],
      },
      {
        name: '北区',
        locations: ['博学楼'],
      },
    ],
  },
  {
    category: '行政、科研楼',
    areas: [
      {
        name: '东区',
        locations: [
          '励吾+E4:F41楼（20号楼）',
          '外国语学院楼',
          '土木工程系（7号楼）',
          '自动化学院楼',
          '电力学院电力实验楼',
          '电力学院楼',
          '机械与汽车工程学院楼',
          '文学院楼',
          '公共管理学院楼',
          '政管学院楼',
          '数学学院楼',
        ],
      },
      {
        name: '西区',
        locations: [
          '亚热带建筑科学实验楼',
          '宏生科技楼（30号楼）',
          '聚合物成品加工重点实验室',
          '土木工程材料实验室',
          '风洞实验室',
          '国际教育学院楼',
        ],
      },
      {
        name: '南区',
        locations: [
          '食品学院楼',
          '土木与交通学院楼',
          '物理与光电学院楼',
          '光电通信材料研究所',
          '传热强化设备研制中心',
          '唯美楼',
          '化学工程系楼（16号楼）',
          '化学院与化工学院能源工程系楼',
          '化工与能源学院制药工程系楼（15号楼）',
          '造纸技术与装备公共实验室',
          '绿色食品研发中心',
        ],
      },
      {
        name: '北区',
        locations: [
          '食科学与工程学院',
          '北区2号楼',
          '网络教育学院',
          '北区5号楼',
          '机械学院楼',
        ],
      },
      {
        name: '中区',
        locations: [
          '建筑学院楼（采荷楼，27号楼）',
          '建筑红楼（6号楼）',
          '清清文理楼',
          '信息网络工程研究中心',
          '光电工程技术研究开发中心（23号楼）',
        ],
      },
    ],
  },
  {
    category: '运动场',
    areas: [
      {
        name: '东区',
        locations: ['东区田径场', '东区游泳馆'],
      },
      {
        name: '西区',
        locations: ['西区田径场', '西区体育馆', '西区篮球场', '西区网球场'],
      },
      {
        name: '北区',
        locations: ['北区网球场地', '北区田径场', '北区羽毛球场'],
      },
    ],
  },
  {
    category: '食堂',
    areas: [
      {
        name: '东区',
        locations: ['东区饭堂', '逸夫人文馆餐厅'],
      },
      {
        name: '西区',
        locations: ['西区饭堂', '发电所餐厅'],
      },
      {
        name: '南区',
        locations: ['南区饭堂'],
      },
      {
        name: '北区',
        locations: ['北一饭堂', '北二饭堂'],
      },
      {
        name: '中区',
        locations: ['中区饭堂'],
      },
    ],
  },
  {
    category: '其他',
    areas: [
      {
        name: '公共设施',
        locations: ['图书馆', '笃行楼', '国际校区', '大学城校区', '学校咖啡厅（建筑院旁）', '中区银行', '校医院', '中区理发店'],
      },
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
