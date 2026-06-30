const tagApi = require("../../utils/tagApi");
const assets = require("../../utils/assets");
const sharedCloud = require("../../utils/cloud");
const secretaryBubble = require("../../utils/secretaryBubble");
const runtime = require("../../config/runtime");
const experience = require("../../utils/experience");

const STORAGE_KEYS = {
  profile: "daimao_profile",
  history: "daimao_met_history",
  pendingCard: "daimao_pending_card_profile",
  pendingVisit: "daimao_pending_visit_context",
  pendingBindToken: "daimao_pending_bind_token",
  agreementAccepted: "daimao_agreement_accepted",
  mockTags: "daimao_mock_tags",
  mockVisits: "daimao_mock_tag_visits",
  knownCatFriends: "daimao_known_cat_friend_ids",
  secretaryNotifications: "daimao_2_notifications",
};
const AGREEMENT_VERSION = "2026-06-13-v2";
const PROFILE_REMINDER_TEMPLATE_ID = "g_4-pPRh3dGyv9EEUNscNu81ZDGfwS-QkDdpyWv-lFU";

let resolvedAssetMap = {};

function assetURL(key) {
  return resolvedAssetMap[key] || "";
}

function defaultAvatarFileID() {
  return assets.getAsset("defaultAvatar") || assets.getAsset("logo");
}

function defaultAvatarURL() {
  return assetURL("defaultAvatar") || assetURL("logo");
}

function isDevelopEnv() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
    return info && info.miniProgram && info.miniProgram.envVersion === "develop";
  } catch (err) {
    return false;
  }
}

function canWriteCloudFromThisBuild() {
  return !(isDevelopEnv() && !runtime.allowCloudWritesInDevelop);
}

const avatarCatVariants = [
  { key: "catRub", src: assetURL("catRub"), pose: "side-rub" },
  { key: "catTapSuccess", src: assetURL("catTapSuccess"), pose: "side-peek" },
  { key: "catFlat", src: assetURL("catFlat"), pose: "side-flat" },
  { key: "catLaying", src: assetURL("catLaying"), pose: "side-lay" },
];
const stickerCatVariants = [
  { key: "catLaying", src: assetURL("catLaying"), pose: "laying" },
  { key: "catPaw", src: assetURL("catPaw"), pose: "paw" },
  { key: "catHold", src: assetURL("catHold"), pose: "hold" },
];

const demoProfiles = {
  "DM-0001": {
    id: "demo-alice",
    name: "小葵",
    job: "咖啡店主理人",
    wechat: "daimao_kui",
    avatar: assetURL("catRub"),
    intro: "白天做咖啡，晚上研究城市散步路线。喜欢把经历按“下次可以做什么”来记住。",
    answers: [
      { q: "休息日通常在干什么？", a: "逛菜市场、看展，顺手记录路边好看的招牌。" },
      { q: "最近最想聊的话题？", a: "怎样把一家小店做得温柔但不无聊。" },
      { q: "一个隐藏技能？", a: "能靠气味猜出咖啡豆大概的烘焙程度。" },
      { q: "理想的第一次见面？", a: "一杯热拿铁加一段没有目的地的散步。" },
      { q: "最近的关键词？", a: "慢慢来，也要亮晶晶。" },
    ],
    tags: ["咖啡", "城市散步", "小店", "拍照"],
    stickerCode: "DM-0001",
  },
};

const fixedQuestions = [
  "你叫什么呀？想让别人怎么称呼你？",
  "你现在在做什么工作，或者最近主要在忙什么？",
  "用一句话介绍你自己",
];

const funQuestionBank = [
  "休息的时候你最常做什么？",
  "最近有什么让你很上头的小爱好？",
  "你最容易被哪类人吸引？",
  "如果线下介绍自己，你会推荐从哪件事聊起？",
  "你最近最想聊的话题是什么？",
  "你有什么看起来普通但很加分的小技能？",
  "你喜欢什么样的周末？",
  "给自己贴三个关键词，会是哪三个？",
  "最近让你开心的一件小事是什么？",
  "你希望别人通过这张名片记住什么？",
  "如果今天突然多出两小时，你会拿来做什么？",
  "你最近最想安利给别人的东西是什么？",
  "有什么小事会让你瞬间开心？",
  "你最喜欢别人怎么夸你？",
  "你最近在练习什么新技能？",
  "你最常出现在哪些地方？",
  "你私下和工作状态反差大吗？",
  "你最喜欢别人从哪个角度了解你？",
  "你对什么东西特别有耐心？",
  "你对什么东西特别没抵抗力？",
  "你最近收藏最多的内容是什么？",
  "你会因为什么事情临时出门？",
  "你最像哪种天气？",
  "你最近的生活关键词是什么？",
  "如果用一道菜形容你，会是什么？",
  "你更喜欢计划好，还是随便走走？",
  "你有什么奇怪但可爱的坚持？",
  "你最近最常说的一句话是什么？",
  "你喜欢热闹还是安静？为什么？",
  "你觉得自己最适合出现在什么场景里？",
  "你最想在名片里放下什么信息？",
  "什么话题能让你聊很久？",
  "你最近有什么小小的成就感？",
  "你最会照顾哪类事情？",
  "你喜欢怎样的见面节奏？",
  "你觉得自己是慢热还是自来熟？",
  "你最喜欢城市里的哪个角落？",
  "你有哪些常年不变的小习惯？",
  "你最近最想去哪里待一下午？",
  "你最喜欢的夜晚通常怎么过？",
  "你会被什么样的细节打动？",
  "你最近有什么想重新捡起来的爱好？",
  "你最喜欢别人记住你的哪一点？",
  "你觉得自己身上最有趣的设定是什么？",
  "你在团队或活动里通常扮演什么角色？",
  "你最擅长把什么事情变简单？",
  "你最近在为什么事情花时间？",
  "如果要介绍你的城市，你会推荐哪里？",
  "你喜欢什么样的工作方式？",
  "你最近最想合作做一件什么事？",
  "你对什么审美特别挑？",
  "你有什么低成本但很快乐的爱好？",
  "你最喜欢的独处方式是什么？",
  "你最近发现了什么宝藏小店或地点？",
  "你更像早晨的人还是夜晚的人？",
  "你会为什么事情主动约人？",
  "你最容易和哪类人聊起来？",
  "你有什么看起来没用但很好玩的知识？",
  "你最近最常打开哪个 App？为什么？",
  "你希望别人不要错过你的哪一面？",
  "你有什么小众但真心喜欢的东西？",
  "你最喜欢收到什么样的邀请？",
  "你最近在认真研究什么？",
  "你最喜欢什么样的房间或空间？",
  "你常常被别人问什么问题？",
  "你觉得自己有什么隐藏标签？",
  "你喜欢怎样的拍照风格？",
  "你最想和别人一起完成什么小计划？",
  "你最近有什么值得庆祝的小事？",
  "你最喜欢什么样的声音或气味？",
  "你会为了什么排队？",
  "你有什么不太明显但很稳定的喜好？",
  "你最近买过最满意的小东西是什么？",
  "你最喜欢的通勤或散步路线是什么？",
  "你在什么状态下最有能量？",
  "你会如何安排一个理想的下午？",
  "你有什么想让别人带你入门的领域？",
  "你最想听别人讲什么故事？",
  "你最近最需要什么样的灵感？",
  "你喜欢把钱花在哪些快乐上？",
  "你有什么别人一熟悉就会发现的特点？",
  "你最喜欢哪种临时起意？",
  "你最近最想向谁学习？",
  "你对什么事情有自己的小标准？",
  "你喜欢用什么方式记录生活？",
  "你有什么能让聚会变好玩的小能力？",
  "你最近最想把什么事情做到 80 分？",
  "你有什么越聊越明显的爱好？",
  "你希望这张名片呈现给什么样的人？",
  "你最喜欢别人向你请教什么？",
  "你最近有什么很想推荐的歌、书或电影？",
  "你喜欢怎样的礼物？",
  "你最容易被什么样的创意吸引？",
  "你有什么长期想做但还没开始的事？",
  "你平时如何给自己充电？",
  "你觉得自己最像哪种交通工具？",
  "你最近最想拥有哪种超能力？",
  "你喜欢记录什么内容？",
  "你有什么很生活化的小骄傲？",
  "你最怕别人误会你哪一点？",
  "如果要介绍一种你喜欢的食物，会是什么？",
  "你会为什么事情一秒变认真？",
  "你觉得自己适合什么样的昵称？",
  "你最近有什么想试但还没试的体验？",
  "你喜欢别人怎样介绍你？",
  "你有什么一聊就会眼睛发亮的话题？",
  "你最近在和什么问题和平相处？",
  "你想把哪件普通小事过得更有仪式感？",
  "你会给第一次见面的人什么小建议？",
  "你最喜欢自己哪种状态？",
  "你希望这张呆猫名片帮你遇到什么人？",
];

function shuffle(list) {
  return list
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

function buildEmptyProfile() {
  return {
    id: `local-${Date.now()}`,
    name: "",
    job: "",
    wechat: "",
    avatar: defaultAvatarURL(),
    avatarCloudFileID: defaultAvatarFileID(),
    intro: "",
    answers: [],
    tags: [],
    stickerCode: "",
  };
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function getProfileKey(profile) {
  if (!profile) return "";
  return String(profile.id || profile.userId || profile.ownerUserId || profile.stickerCode || profile.wechat || profile.name || "");
}

function normalizeProfileForDisplay(profile) {
  if (!profile) return profile;
  const rawAnswers = Array.isArray(profile.answers) ? profile.answers : [];
  const hasLegacyFixedAnswers =
    rawAnswers[0] &&
    (rawAnswers[0].q === fixedQuestions[0] || (rawAnswers[1] && rawAnswers[1].q === fixedQuestions[1]));
  const normalizedAnswers = (hasLegacyFixedAnswers ? rawAnswers.slice(2) : rawAnswers).slice(0, 3);
  const normalizedProfile = {
    ...profile,
    answers: normalizedAnswers,
  };
  const points = Number(profile.experiencePoints || profile.experience_points || 0);
  if (points || profile.communities) {
    const level = experience.getLevel(points);
    normalizedProfile.levelName = level.name;
    normalizedProfile.levelColor = level.levelColor;
    normalizedProfile.experiencePoints = points;
  }
  const avatar = String(profile.avatar || "");
  if (avatar.indexOf("../../images/") === 0 || avatar.indexOf("/images/") === 0) {
    return { ...normalizedProfile, avatar: defaultAvatarURL(), avatarCloudFileID: defaultAvatarFileID() };
  }
  if (assets.isCloudFile(avatar)) {
    const defaultFileID = defaultAvatarFileID();
    return {
      ...normalizedProfile,
      avatarCloudFileID: avatar,
      avatar: avatar === defaultFileID ? defaultAvatarURL() : "",
    };
  }
  if (!avatar) {
    return { ...normalizedProfile, avatar: defaultAvatarURL(), avatarCloudFileID: defaultAvatarFileID() };
  }
  return normalizedProfile;
}

Page({
  data: {
    mode: "loading",
    activeTab: "history",
    profile: buildEmptyProfile(),
    cardProfile: null,
    metHistory: [],
    filteredMetHistory: [],
    anonymousMetHistory: [],
    showAnonymousFriends: false,
    newCatFriendCount: 0,
    historySearch: "",
    questionFlow: [],
    questionDrafts: [],
    currentStep: 0,
    progressWidth: 14,
    currentAnswer: "",
    tagText: "",
    canSave: false,
    isEditing: false,
    posterSaving: false,
    cardIsMine: false,
    showStickerContactModal: false,
    showOwnedCatModal: false,
    agreementAccepted: false,
    catFriendsEnabled: false,
    catFriendsLoading: false,
    catFriendsError: "",
    reminderSubscriptionStatus: "",
    reminderSubscriptionLoading: false,
    pendingVisitContext: null,
    remindingConnectionId: "",
    chatCatSrc: "",
    emptySrc: "",
    modalStickerSrc: "",
    contactQrSrc: "",
    miniProgramQrSrc: "",
    ownedCatSrc: "",
    stickerCat: stickerCatVariants[0],
    editAvatarCat: avatarCatVariants[0],
    cardAvatarCat: avatarCatVariants[1],
    secretaryBubble: secretaryBubble.defaultState(),
    navIcons: {
      watch: "/images/daimao2/search.png",
      innings: "/images/daimao2/puzzle.png",
      friends: "/images/daimao2/friends.png",
      me: "/images/daimao2/project-task.png",
    },
  },

  pickAvatarCat() {
    const variant = pickRandom(avatarCatVariants);
    return variant && variant.src ? variant : { src: assetURL("catRub"), pose: "side-rub" };
  },

  pickStickerCat() {
    return pickRandom(stickerCatVariants);
  },

  onLoad(options) {
    secretaryBubble.start(this);
    this.resolveCloudAssets();
    this.setData({
      agreementAccepted: wx.getStorageSync(STORAGE_KEYS.agreementAccepted) === AGREEMENT_VERSION,
    });

    if (options.reset === "1" || options.reset === "true") {
      this.resetLocalState();
      return;
    }

    const profile = normalizeProfileForDisplay(wx.getStorageSync(STORAGE_KEYS.profile) || null);
    const metHistory = (wx.getStorageSync(STORAGE_KEYS.history) || []).map(normalizeProfileForDisplay);
    const preferredTab = options.tab === "me" ? "me" : "history";
    this.setData({ catFriendsEnabled: !!profile && profile.agreementVersion === AGREEMENT_VERSION });

    if (options.card === "share" && options.uid) {
      this.openSharedCard(options.uid, profile, metHistory);
      return;
    }

    if (options.card) {
      const pendingCard = normalizeProfileForDisplay(wx.getStorageSync(STORAGE_KEYS.pendingCard));
      const pendingVisitContext = wx.getStorageSync(STORAGE_KEYS.pendingVisit) || null;
      if (pendingCard) {
        if (options.card !== "mine") this.rememberMetProfile(pendingCard, metHistory);
        wx.removeStorageSync(STORAGE_KEYS.pendingCard);
        wx.removeStorageSync(STORAGE_KEYS.pendingVisit);
        const canSubscribeReminder =
          options.card !== "mine" &&
          pendingVisitContext &&
          !pendingVisitContext.currentUserHasProfile &&
          !(profile && profile.name && profile.wechat);
        this.setData({
          mode: "card",
          cardProfile: pendingCard,
          profile: profile || buildEmptyProfile(),
          cardIsMine: !!profile && pendingCard.id === profile.id,
          cardAvatarCat: this.pickAvatarCat(),
          pendingVisitContext: canSubscribeReminder ? pendingVisitContext : null,
          reminderSubscriptionStatus: canSubscribeReminder ? "available" : "",
        });
        return;
      }
      if (options.card === "mine" && profile) {
        this.setData({ mode: "card", cardProfile: profile, profile, cardIsMine: true, cardAvatarCat: this.pickAvatarCat() });
        return;
      }
    }

    if (options.ns || options.uid) {
      const cardProfile = this.resolveCardProfile(options, profile);
      this.rememberMetProfile(cardProfile, metHistory);
      this.setData({
        mode: "card",
        cardProfile,
        profile: profile || buildEmptyProfile(),
        cardIsMine: !!profile && cardProfile.id === profile.id,
        cardAvatarCat: this.pickAvatarCat(),
      });
      return;
    }

    if (profile && profile.name && profile.wechat) {
      const grouped = this.groupCatFriends(metHistory);
      this.setData({
        mode: "home",
        activeTab: preferredTab,
        profile,
        metHistory: grouped.registered,
        anonymousMetHistory: grouped.anonymous,
        newCatFriendCount: grouped.newCount,
        stickerCat: this.pickStickerCat(),
      });
      this.updateFilteredHistory(grouped.registered, "");
      if (this.data.catFriendsEnabled) this.loadCatFriends();
      this.refreshCurrentProfileFromCloud(preferredTab);
      return;
    }

    this.startOnboarding(profile || buildEmptyProfile(), metHistory);
    this.refreshCurrentProfileFromCloud(preferredTab);
  },

  onShow() {
    secretaryBubble.start(this);
    this.refreshCurrentProfileFromCloud(this.data.activeTab || "history");
  },

  onUnload() {
    secretaryBubble.stop(this);
  },

  onShareAppMessage(options) {
    const profile = this.data.cardProfile || this.data.profile || wx.getStorageSync(STORAGE_KEYS.profile) || {};
    const userId = profile.userId || profile.id || "";
    const isCardShare = options && options.from === "button" && options.target && options.target.dataset.shareCard;
    if (isCardShare && userId) {
      return {
        title: `${profile.name || "朋友"} 的呆猫名片`,
        path: `/pages/index/index?card=share&uid=${encodeURIComponent(userId)}`,
      };
    }
    return {
      title: "碰一碰交换OPC名片，你也是同路人吗",
      path: "/pages/index/index",
    };
  },

  openSharedCard(userId, localProfile, metHistory) {
    this.setData({ mode: "loading", profile: localProfile || buildEmptyProfile() });
    tagApi
      .getProfileByUserId(userId)
      .then((result) => {
        if (!result || !result.success || !result.profile) {
          throw new Error((result && result.message) || "这张名片暂时不可见");
        }
        const cardProfile = normalizeProfileForDisplay(result.profile);
        this.rememberMetProfile(cardProfile, metHistory || []);
        tagApi.recordTagVisit({ ownerUserId: userId, source: "share_card" }).catch((err) => {
          console.warn("record shared card visit failed", err);
        });
        this.setData({
          mode: "card",
          cardProfile,
          profile: localProfile || buildEmptyProfile(),
          cardIsMine: !!localProfile && (cardProfile.id === localProfile.id || cardProfile.userId === localProfile.userId),
          cardAvatarCat: this.pickAvatarCat(),
          pendingVisitContext: null,
          reminderSubscriptionStatus: "",
        });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || "名片打不开", icon: "none" });
        this.startOnboarding(localProfile || buildEmptyProfile(), metHistory || []);
      });
  },

  refreshCurrentProfileFromCloud(preferredTab) {
    if (this.data.mode === "edit" || this.data.mode === "questions" || this.data.mode === "loading") {
      return Promise.resolve();
    }
    return tagApi
      .getCurrentProfile()
      .then((result) => {
        if (!result || !result.success || !result.profile) return null;
        const profile = normalizeProfileForDisplay(result.profile);
        if (!profile || !profile.name || !profile.wechat) return null;
        wx.setStorageSync(STORAGE_KEYS.profile, profile);
        const grouped = this.groupCatFriends((wx.getStorageSync(STORAGE_KEYS.history) || []).map(normalizeProfileForDisplay));
        const update = {
          profile,
          catFriendsEnabled: profile.agreementVersion === AGREEMENT_VERSION,
        };
        if (this.data.mode === "home" || this.data.mode === "onboarding") {
          Object.assign(update, {
            mode: "home",
            activeTab: preferredTab || this.data.activeTab || "history",
            metHistory: grouped.registered,
            anonymousMetHistory: grouped.anonymous,
            newCatFriendCount: grouped.newCount,
            stickerCat: this.pickStickerCat(),
          });
        }
        if (this.data.cardIsMine) {
          update.cardProfile = profile;
        }
        this.setData(update);
        this.resolveProfileCloudAvatars([profile]);
        if (update.mode === "home") {
          this.updateFilteredHistory(grouped.registered, this.data.historySearch || "");
          if (update.catFriendsEnabled) this.loadCatFriends();
        }
        return profile;
      })
      .catch((err) => {
        console.warn("refresh current profile from cloud failed", err);
        return null;
      });
  },

  resolveCardProfile(options, localProfile) {
    const code = options.ns || options.uid || "";
    if (demoProfiles[code]) return demoProfiles[code];
    if (localProfile && (localProfile.id === code || localProfile.stickerCode === code)) return localProfile;
    return {
      ...demoProfiles["DM-0001"],
      id: `unknown-${code || "guest"}`,
      name: "一只还没绑定的呆猫",
      job: "等待认领 NFC 贴纸",
      wechat: "",
      intro: "这张小贴纸还没有主人。先把它收进自己的猫窝，再让它替你递名片。",
      stickerCode: code || "未识别",
      tags: ["未绑定", "待确认"],
    };
  },

  rememberMetProfile(cardProfile, history) {
    const key = getProfileKey(cardProfile);
    if (!cardProfile || !key) return;
    const normalizedProfile = {
      ...cardProfile,
      id: cardProfile.id || cardProfile.userId || cardProfile.ownerUserId || key,
    };
    const next = [
      { ...normalizedProfile, metAt: this.formatTime(new Date()) },
      ...history.filter((item) => getProfileKey(item) !== key),
    ].slice(0, 50);
    wx.setStorageSync(STORAGE_KEYS.history, next);
    this.updateFilteredHistory(next, this.data.historySearch || "");
  },

  startOnboarding(profile, metHistory) {
    const fun = shuffle(funQuestionBank).slice(0, 3);
    this.setData({
      mode: "onboarding",
      profile,
      metHistory,
      filteredMetHistory: metHistory,
      questionFlow: [...fixedQuestions, ...fun],
      currentStep: 0,
      progressWidth: 100 / (fixedQuestions.length + fun.length),
      currentAnswer: "",
      isEditing: false,
      editAvatarCat: this.pickAvatarCat(),
    });
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
    if (e.currentTarget.dataset.tab === "history" && this.data.catFriendsEnabled) {
      this.loadCatFriends();
    }
    if (e.currentTarget.dataset.tab === "me" && this.data.profile) {
      this.setData({ stickerCat: this.pickStickerCat() });
    }
  },

  openPlatform() {
    wx.navigateTo({ url: "/pages/home/index" });
  },

  goMainNav(e) {
    const routes = {
      watch: "/pages/discover/index",
      innings: "/pages/innings/index",
      friends: "/pages/index/index?tab=history",
      me: "/pages/me/index",
    };
    const target = routes[e.currentTarget.dataset.target];
    if (target && target !== "/pages/index/index?tab=history") wx.redirectTo({ url: target });
  },

  toggleAnonymousFriends() {
    this.setData({ showAnonymousFriends: !this.data.showAnonymousFriends });
  },

  onHistorySearch(e) {
    const historySearch = e.detail.value;
    this.setData({ historySearch });
    this.updateFilteredHistory(this.data.metHistory, historySearch);
  },

  clearHistorySearch() {
    this.setData({ historySearch: "" });
    this.updateFilteredHistory(this.data.metHistory, "");
  },

  updateFilteredHistory(history, keyword) {
    const text = (keyword || "").trim().toLowerCase();
    const filteredMetHistory = !text
      ? history
      : history.filter((item) => {
          const haystack = [
            item.name,
            item.job,
            item.intro,
            ...(item.tags || []),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.indexOf(text) >= 0;
        });
    this.setData({ filteredMetHistory });
  },

  openEditor() {
    const profile = normalizeProfileForDisplay(
      this.data.profile && this.data.profile.name ? this.data.profile : buildEmptyProfile()
    );
    this.setData({ mode: "edit", profile: { ...profile }, tagText: (profile.tags || []).join("、"), editAvatarCat: this.pickAvatarCat() });
  },

  openQuestionEditor() {
    const current = (this.data.profile.answers || []).slice(0, 3);
    const used = current.map((item) => item.q);
    const additions = shuffle(funQuestionBank.filter((question) => used.indexOf(question) < 0));
    const questionDrafts = Array.from({ length: 3 }, (_, index) => {
      if (current[index]) return { ...current[index] };
      return { q: additions.shift() || funQuestionBank[index], a: "" };
    });
    this.setData({ mode: "questions", questionDrafts });
  },

  onQuestionDraftInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const questionDrafts = this.data.questionDrafts.map((item, itemIndex) =>
      itemIndex === index ? { ...item, a: e.detail.value } : item
    );
    this.setData({ questionDrafts });
  },

  changeDraftQuestion(e) {
    const index = Number(e.currentTarget.dataset.index);
    const used = this.data.questionDrafts.map((item) => item.q);
    const candidates = funQuestionBank.filter((question) => used.indexOf(question) < 0);
    const nextQuestion = pickRandom(candidates.length ? candidates : funQuestionBank);
    const questionDrafts = this.data.questionDrafts.map((item, itemIndex) =>
      itemIndex === index ? { q: nextQuestion, a: "" } : item
    );
    this.setData({ questionDrafts });
  },

  saveQuestionDrafts() {
    const questionDrafts = this.data.questionDrafts.map((item) => ({
      q: String(item.q || "").trim(),
      a: String(item.a || "").trim(),
    }));
    if (questionDrafts.some((item) => !item.q || !item.a)) {
      wx.showToast({ title: "三个问题都回答一下吧", icon: "none" });
      return;
    }
    this.setData({
      mode: "edit",
      profile: { ...this.data.profile, answers: questionDrafts },
      questionDrafts: [],
      editAvatarCat: this.pickAvatarCat(),
    });
  },

  cancelQuestionEditor() {
    this.setData({ mode: "edit", questionDrafts: [], editAvatarCat: this.pickAvatarCat() });
  },

  previewMyCard() {
    const profile = normalizeProfileForDisplay(wx.getStorageSync(STORAGE_KEYS.profile)) || this.data.profile;
    if (!profile || !profile.name || !profile.wechat) {
      wx.showToast({ title: "先保存一张自己的名片", icon: "none" });
      return;
    }
    this.setData({
      mode: "card",
      cardProfile: profile,
      profile,
      cardIsMine: true,
      cardAvatarCat: this.pickAvatarCat(),
      pendingVisitContext: null,
      reminderSubscriptionStatus: "",
    });
  },

  startOwnCardFromCard() {
    const profile = normalizeProfileForDisplay(wx.getStorageSync(STORAGE_KEYS.profile));
    if (profile && profile.name && profile.wechat) {
      this.setData({ showOwnedCatModal: true });
      return;
    }
    const metHistory = wx.getStorageSync(STORAGE_KEYS.history) || [];
    this.startOnboarding(buildEmptyProfile(), metHistory.map(normalizeProfileForDisplay));
  },

  requestSticker() {
    const profile = normalizeProfileForDisplay(wx.getStorageSync(STORAGE_KEYS.profile)) || this.data.profile;
    if (!profile || !profile.name || !profile.wechat) {
      wx.showToast({ title: "先保存自己的名片", icon: "none" });
      return;
    }

    this.setData({ showStickerContactModal: true });
  },

  toggleAgreement() {
    const agreementAccepted = !this.data.agreementAccepted;
    wx.setStorageSync(STORAGE_KEYS.agreementAccepted, agreementAccepted ? AGREEMENT_VERSION : "");
    this.setData({ agreementAccepted });
  },

  enableCatFriends() {
    if (!this.requireAgreementAccepted()) return;
    this.setData({ catFriendsLoading: true, catFriendsError: "" });
    tagApi
      .acceptCurrentAgreement()
      .then((result) => {
        if (!result || !result.success) {
          throw new Error((result && result.message) || "协议确认失败");
        }
        const profile = { ...this.data.profile, agreementVersion: AGREEMENT_VERSION };
        wx.setStorageSync(STORAGE_KEYS.profile, profile);
        this.setData({ profile, catFriendsEnabled: true });
        return this.loadCatFriends();
      })
      .catch((err) => {
        console.error("enable cat friends failed", err);
        this.setData({ catFriendsError: "暂时无法启用我的猫友，请稍后再试。" });
      })
      .finally(() => this.setData({ catFriendsLoading: false }));
  },

  loadCatFriends() {
    if (!this.data.catFriendsEnabled) return Promise.resolve();
    this.setData({ catFriendsLoading: true, catFriendsError: "" });
    return tagApi
      .getMyConnections()
      .then((result) => {
        if (!result || !result.success) {
          if (result && result.code === "AGREEMENT_REQUIRED") {
            this.setData({ catFriendsEnabled: false });
            return;
          }
          throw new Error((result && result.message) || "猫友列表加载失败");
        }
        const allConnections = (result.connections || []).map((item) => ({
          ...normalizeProfileForDisplay(item),
          metAt: this.formatCloudTime(item.metAt),
        }));
        const grouped = this.groupCatFriends(allConnections, true);
        wx.setStorageSync(STORAGE_KEYS.history, allConnections);
        this.setData({
          metHistory: grouped.registered,
          anonymousMetHistory: grouped.anonymous,
          newCatFriendCount: grouped.newCount,
        });
        if (grouped.newCount > 0) {
          this.pushSecretaryNewFriendNotice(grouped.newFriends);
        }
        this.updateFilteredHistory(grouped.registered, this.data.historySearch || "");
        this.resolveProfileCloudAvatars(grouped.registered);
      })
      .catch((err) => {
        console.error("load cat friends failed", err);
        this.setData({ catFriendsError: "猫友列表暂时没加载出来，请稍后再试。" });
      })
      .finally(() => this.setData({ catFriendsLoading: false }));
  },

  groupCatFriends(list, markNew) {
    const normalized = (list || []).map(normalizeProfileForDisplay);
    const anonymous = normalized.filter((item) => item && item.anonymous);
    const known = wx.getStorageSync(STORAGE_KEYS.knownCatFriends) || [];
    const knownSet = known.reduce((map, key) => {
      map[key] = true;
      return map;
    }, {});
    const registered = normalized
      .filter((item) => item && !item.anonymous)
      .map((item) => {
        const key = getProfileKey(item);
        const isNew = markNew && key && !knownSet[key];
        return isNew ? { ...item, newFriend: true } : item;
      });
    const nextKnown = Array.from(new Set([...known, ...registered.map(getProfileKey).filter(Boolean)]));
    if (markNew) wx.setStorageSync(STORAGE_KEYS.knownCatFriends, nextKnown);
    if (!markNew && !known.length && nextKnown.length) wx.setStorageSync(STORAGE_KEYS.knownCatFriends, nextKnown);
    const newFriends = registered.filter((item) => item.newFriend || item.isNew);
    return { registered, anonymous, newCount: newFriends.length, newFriends };
  },

  pushSecretaryNewFriendNotice(newFriends) {
    if (!newFriends || !newFriends.length) return;
    const notifications = wx.getStorageSync(STORAGE_KEYS.secretaryNotifications) || [];
    const names = newFriends
      .map((item) => item.name)
      .filter(Boolean)
      .slice(0, 3)
      .join("、");
    const notice = {
      id: `cat_friend_${Date.now()}`,
      type: "system",
      title: "有新的猫友留下名片",
      content: names ? `${names} 已经保存呆猫名片，我把他们拉进“我的猫友”了。` : "有人已经保存呆猫名片，我把他们拉进“我的猫友”了。",
      read_status: "unread",
      created_at: new Date().toISOString(),
    };
    wx.setStorageSync(STORAGE_KEYS.secretaryNotifications, [notice, ...notifications].slice(0, 100));
  },

  subscribeToProfileReminder() {
    if (this.data.reminderSubscriptionLoading || !this.data.pendingVisitContext) return;
    if (!wx.requestSubscribeMessage) {
      wx.showToast({ title: "当前微信版本不支持订阅提醒", icon: "none" });
      return;
    }

    this.setData({ reminderSubscriptionLoading: true });
    wx.requestSubscribeMessage({
      tmplIds: [PROFILE_REMINDER_TEMPLATE_ID],
      success: (res) => {
        const status = res[PROFILE_REMINDER_TEMPLATE_ID];
        if (status !== "accept" && status !== "acceptWithAudio" && status !== "acceptWithAlert") {
          this.setData({ reminderSubscriptionStatus: "rejected" });
          wx.showToast({ title: "未开启提醒，不影响查看名片", icon: "none" });
          return;
        }

        tagApi
          .registerProfileReminderSubscription({
            token: this.data.pendingVisitContext.token,
          })
          .then((result) => {
            if (!result || !result.success) {
              throw new Error((result && result.message) || "订阅记录保存失败");
            }
            this.setData({ reminderSubscriptionStatus: result.status === "sent" ? "sent" : "accepted" });
            wx.showToast({
              title: result.status === "sent" ? "对方已经提醒过你" : "已允许对方提醒一次",
              icon: "none",
            });
          })
          .catch((err) => {
            console.error("register reminder subscription failed", err);
            wx.showToast({ title: "提醒授权保存失败，请稍后再试", icon: "none" });
          });
      },
      fail: (err) => {
        console.error("request subscribe message failed", err);
        wx.showToast({ title: "订阅提醒没有打开", icon: "none" });
      },
      complete: () => {
        this.setData({ reminderSubscriptionLoading: false });
      },
    });
  },

  remindAnonymousFriend(e) {
    const connectionId = e.currentTarget.dataset.connectionId;
    const reminderStatus = e.currentTarget.dataset.reminderStatus;
    if (reminderStatus === "sent") {
      wx.showToast({ title: "已经提醒过对方了", icon: "none" });
      return;
    }
    if (reminderStatus !== "available") {
      wx.showToast({ title: "对方还没授权接收提醒", icon: "none" });
      return;
    }
    if (!connectionId || this.data.remindingConnectionId) return;

    this.setData({ remindingConnectionId: connectionId });
    tagApi
      .sendProfileReminder(connectionId)
      .then((result) => {
        if (!result || !result.success) {
          throw new Error((result && result.message) || "提醒发送失败");
        }
        const patch = (item) =>
          item.connectionId === connectionId ? { ...item, reminderStatus: "sent" } : item;
        const metHistory = this.data.metHistory.map(patch);
        const filteredMetHistory = this.data.filteredMetHistory.map(patch);
        wx.setStorageSync(STORAGE_KEYS.history, metHistory);
        this.setData({ metHistory, filteredMetHistory });
        wx.showToast({ title: "已经提醒对方", icon: "success" });
      })
      .catch((err) => {
        console.error("send profile reminder failed", err);
        wx.showToast({ title: String(err.message || "提醒发送失败").slice(0, 20), icon: "none" });
        this.loadCatFriends();
      })
      .finally(() => this.setData({ remindingConnectionId: "" }));
  },

  openAgreement(e) {
    const type = e.currentTarget.dataset.type;
    const url = type === "privacy" ? "/pages/agreement/privacy-policy" : "/pages/agreement/user-service";
    wx.navigateTo({ url });
  },

  requireAgreementAccepted() {
    if (this.data.agreementAccepted) return true;
    wx.showToast({ title: "请先阅读并同意用户服务协议和隐私政策", icon: "none" });
    return false;
  },

  closeStickerContact() {
    this.setData({ showStickerContactModal: false });
  },

  closeOwnedCat() {
    this.setData({ showOwnedCatModal: false });
  },

  noop() {
    return false;
  },

  resolveCloudAssets() {
    const keys = [
      "logo",
      "defaultAvatar",
      "catRub",
      "catTapSuccess",
      "catFlat",
      "catLaying",
      "catPaw",
      "catHold",
      "catStretch",
      "empty",
      "card",
      "stickerNine",
      "contactQr",
      "miniProgramQr",
    ];

    assets
      .resolveAssets(keys)
      .then((map) => {
        resolvedAssetMap = map;
        avatarCatVariants.forEach((item) => {
          item.src = assetURL(item.key);
        });
        stickerCatVariants.forEach((item) => {
          item.src = assetURL(item.key);
        });
        demoProfiles["DM-0001"].avatar = assetURL("catRub");

        const profile = normalizeProfileForDisplay(this.data.profile);
        const cardProfile = normalizeProfileForDisplay(this.data.cardProfile);
        const metHistory = (this.data.metHistory || []).map(normalizeProfileForDisplay);
        this.setData({
          profile,
          cardProfile,
          metHistory,
          chatCatSrc: assetURL("catStretch"),
          emptySrc: assetURL("empty"),
          modalStickerSrc: assetURL("stickerNine"),
          contactQrSrc: assetURL("contactQr"),
          miniProgramQrSrc: assetURL("miniProgramQr"),
          ownedCatSrc: assetURL("catLaying"),
          stickerCat: this.pickStickerCat(),
          editAvatarCat: this.pickAvatarCat(),
          cardAvatarCat: this.pickAvatarCat(),
        });
        this.updateFilteredHistory(metHistory, this.data.historySearch || "");
        this.resolveProfileCloudAvatars([profile, cardProfile, ...metHistory]);
      })
      .catch((err) => {
        console.error("resolve cloud assets failed", err);
        wx.showToast({ title: "云存储图片加载失败", icon: "none" });
      });
  },

  resolveProfileCloudAvatars(profiles) {
    (profiles || []).forEach((profile) => {
      if (!profile || !profile.avatarCloudFileID || profile.avatar) return;
      assets
        .resolveCloudTempFileURL(profile.avatarCloudFileID)
        .then((url) => {
          this.patchProfileAvatar(profile.id || profile.userId, url);
        })
        .catch((err) => {
          console.error("resolve profile avatar failed", profile.avatarCloudFileID, err);
        });
    });
  },

  patchProfileAvatar(profileId, avatarUrl) {
    if (!profileId || !avatarUrl) return;
    const patchOne = (profile) => {
      if (!profile || (profile.id !== profileId && profile.userId !== profileId)) return profile;
      return { ...profile, avatar: avatarUrl };
    };
    const metHistory = (this.data.metHistory || []).map(patchOne);
    const filteredMetHistory = (this.data.filteredMetHistory || []).map(patchOne);
    this.setData({
      profile: patchOne(this.data.profile),
      cardProfile: patchOne(this.data.cardProfile),
      metHistory,
      filteredMetHistory,
    });
  },

  resetLocalState() {
    Object.keys(STORAGE_KEYS).forEach((key) => {
      wx.removeStorageSync(STORAGE_KEYS[key]);
    });
    wx.showToast({ title: "本地测试数据已清空", icon: "none" });
    this.startOnboarding(buildEmptyProfile(), []);
  },

  backHome() {
    const profile = normalizeProfileForDisplay(wx.getStorageSync(STORAGE_KEYS.profile));
    const metHistory = (wx.getStorageSync(STORAGE_KEYS.history) || []).map(normalizeProfileForDisplay);
    this.setData({ mode: "home", profile, metHistory, stickerCat: this.pickStickerCat() });
    this.updateFilteredHistory(metHistory, this.data.historySearch || "");
  },

  onAnswerInput(e) {
    this.setData({ currentAnswer: e.detail.value });
  },

  changeQuestion() {
    if (this.data.currentStep < fixedQuestions.length) {
      wx.showToast({ title: "这个问题先固定一下", icon: "none" });
      return;
    }

    const used = [
      ...this.data.profile.answers.map((item) => item.q),
      ...this.data.questionFlow,
    ];
    const candidates = funQuestionBank.filter((question) => used.indexOf(question) < 0);
    const nextQuestion = (candidates.length ? shuffle(candidates) : shuffle(funQuestionBank))[0];
    const questionFlow = [...this.data.questionFlow];
    questionFlow[this.data.currentStep] = nextQuestion;
    this.setData({ questionFlow, currentAnswer: "" });
  },

  nextQuestion() {
    const answer = this.data.currentAnswer.trim();
    if (!answer) {
      wx.showToast({ title: "先写一点点吧", icon: "none" });
      return;
    }

    const q = this.data.questionFlow[this.data.currentStep];
    const profile = { ...this.data.profile };

    if (this.data.currentStep === 0) profile.name = answer;
    if (this.data.currentStep === 1) profile.job = answer;
    if (this.data.currentStep === 2) profile.intro = answer;
    if (this.data.currentStep >= fixedQuestions.length) {
      profile.answers = [...(profile.answers || []), { q, a: answer }].slice(-3);
    }

    if (this.data.currentStep >= this.data.questionFlow.length - 1) {
      this.setData({
        mode: "edit",
        profile,
        tagText: (profile.tags || []).join("、"),
        currentAnswer: "",
        editAvatarCat: this.pickAvatarCat(),
      });
      return;
    }

    this.setData({
      profile,
      currentStep: this.data.currentStep + 1,
      progressWidth: ((this.data.currentStep + 2) * 100) / this.data.questionFlow.length,
      currentAnswer: "",
    });
  },

  chooseAvatar() {
    wx.showModal({
      title: "建议上传真人头像",
      content: "呆猫是线下个人名片。用真实头像，别人下次看到名片才不会对不上人。",
      confirmText: "上传头像",
      cancelText: "先不用",
      success: (modal) => {
        if (!modal.confirm) return;
        wx.chooseMedia({
          count: 1,
          mediaType: ["image"],
          sourceType: ["album", "camera"],
          success: (res) => {
            const file = res.tempFiles && res.tempFiles[0];
            if (file && file.tempFilePath) {
              this.setData({ profile: { ...this.data.profile, avatar: file.tempFilePath, avatarCloudFileID: "" } });
            }
          },
        });
      },
    });
  },

  onChooseWechatAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    if (avatarUrl) {
      this.setData({ profile: { ...this.data.profile, avatar: avatarUrl, avatarCloudFileID: "" } });
    }
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ profile: { ...this.data.profile, [field]: e.detail.value } });
  },

  onTagInput(e) {
    this.setData({ tagText: e.detail.value });
  },

  saveProfile() {
    if (!this.requireAgreementAccepted()) return;

    const profile = {
      ...this.data.profile,
      name: (this.data.profile.name || "").trim(),
      job: (this.data.profile.job || "").trim(),
      wechat: (this.data.profile.wechat || "").trim(),
      avatar: this.data.profile.avatarCloudFileID || this.data.profile.avatar || "",
      intro: (this.data.profile.intro || "").trim(),
      stickerCode: (this.data.profile.stickerCode || "").trim(),
      agreementVersion: AGREEMENT_VERSION,
      tags: this.data.tagText
        .split(/[、,，\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 6),
    };

    if (!profile.name || !profile.job || !profile.wechat || !profile.intro) {
      wx.showToast({ title: "姓名、工作、微信号和介绍都要填", icon: "none" });
      return;
    }

    wx.showLoading({ title: "正在保存..." });
    this.prepareProfileForCloud(profile)
      .then((cloudProfile) => tagApi.upsertCurrentUserProfile(cloudProfile).then((result) => ({ result, cloudProfile })))
      .then((result) => {
        if (!result.result || !result.result.success || !result.result.profile) {
          throw new Error((result.result && result.result.message) || "save profile failed");
        }
        const savedProfile = { ...result.cloudProfile, ...result.result.profile };
        wx.setStorageSync(STORAGE_KEYS.profile, savedProfile);
        return this.bindPendingTagIfNeeded(savedProfile).then((bindResult) => ({ savedProfile, bindResult }));
      })
      .then(({ savedProfile, bindResult }) => {
        const nextProfile = bindResult && bindResult.ownerProfile ? { ...savedProfile, ...bindResult.ownerProfile } : savedProfile;
        const displayProfile = normalizeProfileForDisplay(nextProfile);
        wx.setStorageSync(STORAGE_KEYS.profile, nextProfile);
        this.setData({
          mode: "home",
          profile: displayProfile,
          activeTab: "me",
          catFriendsEnabled: displayProfile.agreementVersion === AGREEMENT_VERSION,
          stickerCat: this.pickStickerCat(),
        });
        this.resolveProfileCloudAvatars([displayProfile]);
        this.updateFilteredHistory((wx.getStorageSync(STORAGE_KEYS.history) || []).map(normalizeProfileForDisplay), this.data.historySearch || "");
        wx.showToast({ title: bindResult ? "名片已保存，贴纸已绑定" : "已保存", icon: "success" });
      })
      .catch((err) => {
        console.error("save profile failed", err);
        const message = err && (err.errMsg || err.message) ? err.errMsg || err.message : "请检查云函数";
        wx.showToast({ title: `云端保存失败：${message}`.slice(0, 28), icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  bindPendingTagIfNeeded(profile) {
    const token = wx.getStorageSync(STORAGE_KEYS.pendingBindToken);
    if (!token) return Promise.resolve(null);

    return tagApi.bindTagToCurrentUser(token).then((result) => {
      if (!result || !result.success) {
        throw new Error((result && result.message) || "贴纸绑定失败");
      }
      wx.removeStorageSync(STORAGE_KEYS.pendingBindToken);
      return {
        ...result,
        ownerProfile: {
          ...(result.ownerProfile || profile),
          stickerCode: result.tag && result.tag.tagCode ? result.tag.tagCode : profile.stickerCode,
        },
      };
    });
  },

  prepareProfileForCloud(profile) {
    if (!canWriteCloudFromThisBuild()) return Promise.resolve(profile);
    if (!this.shouldUploadAvatar(profile.avatar)) {
      return Promise.resolve(profile);
    }

    return this.uploadAvatar(profile.avatar).then((fileID) => ({
      ...profile,
      avatar: fileID,
    }));
  },

  shouldUploadAvatar(path) {
    if (!path) return false;
    if (assets.isCloudFile(path)) return false;
    if (path.indexOf("https://") === 0 && path.indexOf("tmp/") < 0) return false;
    return true;
  },

  uploadAvatar(filePath) {
    const extMatch = String(filePath).match(/\.(png|jpg|jpeg|webp)(?:\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
    const cloudPath = `daimao/avatars/avatar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    return sharedCloud
      .uploadFile({
        cloudPath,
        filePath,
      })
      .then((res) => {
        if (!res || !res.fileID) throw new Error("avatar upload returned empty fileID");
        return res.fileID;
      });
  },

  copyWechat(e) {
    const wechat = e.currentTarget.dataset.wechat;
    if (!wechat) {
      wx.showToast({ title: "对方还没填写微信号", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: wechat,
      success: () => wx.showToast({ title: "微信号已复制", icon: "success" }),
    });
  },

  showScreenshotGuide() {
    wx.showModal({
      title: "存下这张名片",
      content: "这一页已经压成适合截图的一屏。现在用手机系统截图，就能把头像、工作、介绍和标签一起存下来。",
      showCancel: false,
      confirmText: "去截图",
    });
  },

  savePoster() {
    if (this.data.posterSaving) return;
    if (!this.data.cardProfile) {
      wx.showToast({ title: "还没有可保存的名片", icon: "none" });
      return;
    }

    this.setData({ posterSaving: true });
    wx.showLoading({ title: "正在画名片..." });

    this.createPosterImage(this.data.cardProfile)
      .then((filePath) => this.saveImageToAlbum(filePath))
      .then(() => {
        wx.showToast({ title: "已保存到相册", icon: "success" });
      })
      .catch((err) => {
        console.error("save poster failed", err);
        wx.showToast({ title: "保存失败，再试一次", icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ posterSaving: false });
      });
  },

  createPosterImage(profile) {
    const width = 750;
    const height = 1600;
    const dpr = wx.getSystemInfoSync().pixelRatio || 2;

    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select("#posterCanvas")
        .fields({ node: true, size: true })
        .exec(async (res) => {
          const canvas = res && res[0] && res[0].node;
          if (!canvas) {
            reject(new Error("poster canvas not found"));
            return;
          }

          try {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            const ctx = canvas.getContext("2d");
            ctx.scale(dpr, dpr);
            await this.drawPoster(ctx, canvas, profile, width, height);

            wx.canvasToTempFilePath({
              canvas,
              width,
              height,
              destWidth: width * 2,
              destHeight: height * 2,
              fileType: "png",
              quality: 1,
              success: (result) => resolve(result.tempFilePath),
              fail: reject,
            });
          } catch (err) {
            reject(err);
          }
        });
    });
  },

  async drawPoster(ctx, canvas, profile, width, height) {
    const cardCat = await this.loadCanvasImage(canvas, assets.getPosterAsset("card"));
    const avatar = await this.loadCanvasImage(canvas, this.normalizePosterPath(profile.avatar || assetURL("logo")));
    const miniProgramQr = await this.loadCanvasImage(canvas, assets.getPosterAsset("miniProgramQr")).catch((err) => {
      console.warn("load mini program qr failed", err);
      return null;
    });

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#faf7f1";
    ctx.fillRect(0, 0, width, height);

    this.drawRoundRect(ctx, 42, 48, 666, 1468, 18);
    ctx.fillStyle = "#fffdfa";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#23211f";
    ctx.stroke();
    ctx.fillStyle = "#23211f";
    ctx.fillRect(58, 82, 84, 10);
    ctx.fillRect(58, 104, 48, 10);
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("DAIMAO CARD", 500, 106);

    ctx.fillStyle = "#f5ead8";
    ctx.beginPath();
    ctx.arc(width / 2, 264, 94, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#23211f";
    ctx.stroke();
    this.drawCircleImage(ctx, avatar, 288, 176, 174);

    ctx.textAlign = "center";
    ctx.fillStyle = "#23211f";
    ctx.font = "bold 52px sans-serif";
    ctx.fillText(this.ellipsis(profile.name || "呆猫名片", 10), width / 2, 430);
    ctx.fillStyle = "#756f68";
    ctx.font = "28px sans-serif";
    ctx.fillText(this.ellipsis(profile.job || "正在认真生活", 18), width / 2, 476);

    this.drawRoundRect(ctx, 82, 526, 586, 154, 10);
    ctx.fillStyle = "#f5ead8";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#23211f";
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#23211f";
    ctx.font = "30px sans-serif";
    this.drawWrappedText(ctx, profile.intro || "这只呆猫还没写介绍。", 112, 572, 526, 42, 3);

    let y = 730;
    let tagX = 82;
    const tags = (profile.tags || []).slice(0, 5);
    tags.forEach((tag) => {
      const text = String(tag);
      const tagWidth = Math.min(ctx.measureText(text).width + 36, 156);
      if (tagX + tagWidth > 668) {
        tagX = 82;
        y += 54;
      }
      this.drawRoundRect(ctx, tagX, y, tagWidth, 40, 20);
      ctx.fillStyle = "#e8f3ef";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#23211f";
      ctx.stroke();
      ctx.fillStyle = "#23211f";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(this.ellipsis(text, 6), tagX + 18, y + 27);
      tagX += tagWidth + 12;
    });

    y = tags.length ? y + 82 : 748;
    const answers = (profile.answers || []).slice(0, 3);
    answers.forEach((item, index) => {
      ctx.strokeStyle = "#e8dfd3";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(82, y - 24);
      ctx.lineTo(668, y - 24);
      ctx.stroke();
      ctx.fillStyle = "#8a8178";
      ctx.font = "24px sans-serif";
      ctx.fillText(this.ellipsis(item.q || `小问题 ${index + 1}`, 22), 82, y);
      ctx.fillStyle = "#23211f";
      ctx.font = "28px sans-serif";
      const lines = this.drawWrappedText(ctx, item.a || "还没回答。", 82, y + 40, 586, 38, 2);
      y += 74 + lines * 38;
    });

    this.drawImageContain(ctx, cardCat, 492, 1246, 146, 210);
    ctx.textAlign = "left";
    ctx.fillStyle = "#23211f";
    if (miniProgramQr) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(82, 1308, 126, 126);
      this.drawImageContain(ctx, miniProgramQr, 88, 1314, 114, 114);
      ctx.font = "bold 23px sans-serif";
      ctx.fillText("长按识别小程序码", 230, 1360);
      ctx.font = "21px sans-serif";
      ctx.fillStyle = "#756f68";
      ctx.fillText("创建你的呆猫名片", 230, 1398);
    } else {
      ctx.font = "bold 24px sans-serif";
      ctx.fillText("微信搜一搜：呆猫呆猫", 82, 1368);
      ctx.font = "21px sans-serif";
      ctx.fillStyle = "#756f68";
      ctx.fillText("创建你的呆猫名片", 82, 1406);
    }
  },

  loadCanvasImage(canvas, src) {
    return new Promise((resolve, reject) => {
      assets
        .getCloudTempFileURL(src)
        .then((path) => {
          const image = canvas.createImage();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = path;
        })
        .catch(reject);
    });
  },

  saveImageToAlbum(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: resolve,
        fail: (err) => {
          if (err.errMsg && err.errMsg.indexOf("auth deny") >= 0) {
            wx.showModal({
              title: "需要相册权限",
              content: "打开相册权限后，呆猫才能把完整名片图存进去。",
              confirmText: "去设置",
              success: (res) => {
                if (res.confirm) wx.openSetting();
              },
            });
          }
          reject(err);
        },
      });
    });
  },

  normalizePosterPath(path) {
    if (!path) return assets.getPosterAsset("logo");
    if (path.indexOf("../../") === 0) return path.replace("../..", "");
    return path;
  },

  drawRoundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  },

  drawCircleImage(ctx, image, cx, cy, size) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + size / 2, cy + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    this.drawImageCover(ctx, image, cx, cy, size, size);
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#23211f";
    ctx.beginPath();
    ctx.arc(cx + size / 2, cy + size / 2, size / 2, 0, Math.PI * 2);
    ctx.stroke();
  },

  drawImageCover(ctx, image, x, y, width, height) {
    const scale = Math.max(width / image.width, height / image.height);
    const sw = width / scale;
    const sh = height / scale;
    const sx = (image.width - sw) / 2;
    const sy = (image.height - sh) / 2;
    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
  },

  drawImageContain(ctx, image, x, y, width, height) {
    const scale = Math.min(width / image.width, height / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    ctx.drawImage(image, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
  },

  drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const source = String(text || "");
    const lines = [];
    let line = "";
    for (let i = 0; i < source.length; i++) {
      const testLine = line + source[i];
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = source[i];
        if (lines.length >= maxLines) break;
      } else {
        line = testLine;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    lines.forEach((item, index) => {
      const value = index === maxLines - 1 && source.length > item.length ? this.ellipsis(item, item.length) : item;
      ctx.fillText(value, x, y + index * lineHeight);
    });
    return lines.length || 1;
  },

  ellipsis(text, maxLength) {
    const value = String(text || "");
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
  },

  previewMet(e) {
    const id = e.currentTarget.dataset.id;
    const cardProfile = this.data.metHistory.find((item) => item.id === id);
    const profile = normalizeProfileForDisplay(wx.getStorageSync(STORAGE_KEYS.profile));
    if (cardProfile && !cardProfile.anonymous) {
      this.setData({
        mode: "card",
        cardProfile,
        cardIsMine: !!profile && cardProfile.id === profile.id,
        cardAvatarCat: this.pickAvatarCat(),
        pendingVisitContext: null,
        reminderSubscriptionStatus: "",
      });
    }
  },

  openDemoCard() {
    const cardProfile = demoProfiles["DM-0001"];
    const history = (wx.getStorageSync(STORAGE_KEYS.history) || []).map(normalizeProfileForDisplay);
    this.rememberMetProfile(cardProfile, history);
    this.setData({
      mode: "card",
      cardProfile,
      metHistory: (wx.getStorageSync(STORAGE_KEYS.history) || []).map(normalizeProfileForDisplay),
      cardIsMine: false,
      cardAvatarCat: this.pickAvatarCat(),
      pendingVisitContext: null,
      reminderSubscriptionStatus: "",
    });
  },

  openSecretary() {
    secretaryBubble.open(this, "/pages/index/index?tab=history");
  },

  closeCard() {
    const profile = normalizeProfileForDisplay(wx.getStorageSync(STORAGE_KEYS.profile));
    const metHistory = (wx.getStorageSync(STORAGE_KEYS.history) || []).map(normalizeProfileForDisplay);
    if (profile && profile.name && profile.wechat) {
      const activeTab = this.data.cardProfile && this.data.cardProfile.id === profile.id ? "me" : "history";
      this.setData({
        mode: "home",
        profile,
        metHistory,
        activeTab,
        stickerCat: this.pickStickerCat(),
        pendingVisitContext: null,
        reminderSubscriptionStatus: "",
      });
      this.updateFilteredHistory(metHistory, this.data.historySearch || "");
    } else {
      this.startOnboarding(buildEmptyProfile(), metHistory);
    }
  },

  formatTime(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  formatCloudTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return this.formatTime(date);
  },
});
