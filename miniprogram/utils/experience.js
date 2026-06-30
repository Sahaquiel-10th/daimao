const LEVEL_TITLES = [
  "刚进窝",
  "有名片了",
  "开始认识人",
  "稳定出没",
  "靠谱协作者",
  "项目熟手",
  "营主苗子",
  "强交付者",
  "社区骨干",
  "王牌合作者",
  "项目领队",
  "交付专家",
  "社区招牌",
  "共创合伙人",
  "联盟核心",
  "项目发动机",
  "生态建设者",
  "可信主理人",
  "超级协作者",
  "呆猫传说",
];

function minPointsForLevel(levelNumber) {
  if (levelNumber <= 1) return 0;
  return Math.round(10 * Math.pow(levelNumber - 1, 2.15));
}

const LEVEL_TAIL_TITLES = [
  "联盟核心",
  "项目发动机",
  "生态建设者",
  "可信主理人",
  "超级协作者",
  "呆猫传说",
];

function levelLabel(levelNumber) {
  return `Lv.${String(levelNumber).padStart(2, "0")}`;
}

function levelTitle(levelNumber) {
  if (levelNumber <= LEVEL_TITLES.length) return LEVEL_TITLES[levelNumber - 1];
  const tailIndex = (levelNumber - LEVEL_TITLES.length - 1) % LEVEL_TAIL_TITLES.length;
  const lap = Math.floor((levelNumber - LEVEL_TITLES.length - 1) / LEVEL_TAIL_TITLES.length) + 2;
  return `${LEVEL_TAIL_TITLES[tailIndex]} ${lap}`;
}

function levelColor(levelNumber) {
  const clamped = Math.min(Math.max(Number(levelNumber || 1), 1), 80);
  const hue = Math.max(8, 170 - clamped * 2);
  const saturation = Math.min(92, 54 + clamped);
  const lightness = Math.max(34, 48 - Math.floor(clamped / 5));
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

const LEVELS = Array.from({ length: LEVEL_TITLES.length }, (_, index) => {
  const levelNumber = index + 1;
  const level = levelLabel(levelNumber);
  return {
    level,
    levelNumber,
    min: minPointsForLevel(levelNumber),
    title: levelTitle(levelNumber),
    color: levelColor(levelNumber),
    name: `${level} ${levelTitle(levelNumber)}`,
  };
});

const RULES = [
  { key: "register_profile", label: "注册并保存名片", points: 10, note: "足够升到 Lv.02" },
  { key: "card_viewed_by_other", label: "有人碰你的名片", points: 2, note: "每次有效碰一碰" },
  { key: "view_other_card", label: "你碰别人的名片", points: 1, note: "每次有效碰一碰" },
  { key: "share_card", label: "分享自己的名片", points: 1, note: "每日最多可限额" },
  { key: "watch_project", label: "围观项目", points: 1, note: "每个项目首次围观" },
  { key: "apply_project", label: "提交项目申请", points: 3, note: "秘书审核后计入" },
  { key: "join_project", label: "被项目接受参与", points: 20, note: "成为项目参与者" },
  { key: "complete_project_task", label: "完成一次项目任务", points: 15, note: "需营主确认" },
  { key: "project_completed_member", label: "参与项目顺利完成", points: 50, note: "成员获得" },
  { key: "project_completed_lead", label: "主理项目顺利完成", points: 120, note: "营主获得" },
  { key: "attend_event", label: "参加一次活动", points: 8, note: "签到或管理员确认" },
  { key: "pass_review", label: "通过社区评审", points: 30, note: "获得社区徽章" },
  { key: "host_event", label: "协助组织活动", points: 40, note: "管理员确认" },
  { key: "positive_feedback", label: "获得正向协作反馈", points: 10, note: "来自营主或项目成员" },
];

function getLevel(points) {
  const score = Math.max(Number(points || 0), 0);
  let levelNumber = 1;
  while (score >= minPointsForLevel(levelNumber + 1)) {
    levelNumber += 1;
  }
  const nextLevelNumber = levelNumber + 1;
  const current = {
    level: levelLabel(levelNumber),
    levelNumber,
    min: minPointsForLevel(levelNumber),
    title: levelTitle(levelNumber),
    color: levelColor(levelNumber),
  };
  const nextMin = minPointsForLevel(nextLevelNumber);
  return {
    ...current,
    name: `${current.level} ${current.title}`,
    points: score,
    nextLevel: levelLabel(nextLevelNumber),
    nextMin,
    pointsToNext: Math.max(nextMin - score, 0),
    progress: Math.min(Math.round(((score - current.min) / (nextMin - current.min)) * 100), 100),
    progressPercent: Math.min(Math.round(((score - current.min) / (nextMin - current.min)) * 100), 100),
    levelColor: current.color,
  };
}

module.exports = {
  LEVELS,
  RULES,
  getLevel,
};
