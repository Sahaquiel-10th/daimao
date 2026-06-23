const LEVELS = [
  { level: "Lv.01", min: 0, title: "刚进窝" },
  { level: "Lv.02", min: 10, title: "有名片了" },
  { level: "Lv.03", min: 30, title: "开始认识人" },
  { level: "Lv.04", min: 70, title: "稳定出没" },
  { level: "Lv.05", min: 140, title: "靠谱协作者" },
  { level: "Lv.06", min: 260, title: "项目熟手" },
  { level: "Lv.07", min: 460, title: "营主苗子" },
  { level: "Lv.08", min: 760, title: "强交付者" },
  { level: "Lv.09", min: 1200, title: "社区骨干" },
  { level: "Lv.10", min: 1800, title: "王牌合作者" },
];

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
    points: score,
    nextLevel: next ? next.level : "",
    nextMin: next ? next.min : current.min,
    pointsToNext: next ? Math.max(next.min - score, 0) : 0,
    progress: next ? Math.min(Math.round(((score - current.min) / (next.min - current.min)) * 100), 100) : 100,
  };
}

module.exports = {
  LEVELS,
  RULES,
  getLevel,
};
