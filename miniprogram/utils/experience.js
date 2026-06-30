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

const LEVELS = LEVEL_TITLES.map((title, index) => {
  const levelNumber = index + 1;
  const level = `Lv.${String(levelNumber).padStart(2, "0")}`;
  return {
    level,
    min: minPointsForLevel(levelNumber),
    title,
    name: `${level} ${title}`,
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
  let current = LEVELS[0];
  let next = null;
  for (let index = 0; index < LEVELS.length; index += 1) {
    if (score >= LEVELS[index].min) {
      current = LEVELS[index];
      next = LEVELS[index + 1] || null;
    }
  }
  return {
    ...current,
    name: `${current.level} ${current.title}`,
    points: score,
    nextLevel: next ? next.level : "",
    nextMin: next ? next.min : current.min,
    pointsToNext: next ? Math.max(next.min - score, 0) : 0,
    progress: next ? Math.min(Math.round(((score - current.min) / (next.min - current.min)) * 100), 100) : 100,
    progressPercent: next ? Math.min(Math.round(((score - current.min) / (next.min - current.min)) * 100), 100) : 100,
  };
}

module.exports = {
  LEVELS,
  RULES,
  getLevel,
};
