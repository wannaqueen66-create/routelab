/**
 * User Card Module
 * 处理用户卡片数据构建逻辑
 */

const { PRIVACY_LEVEL_MAP } = require('../constants/privacy');
const { getDefaultNickname, getAvatarColor, getInitialFromName } = require('../utils/profile-meta');
const rewards = require('./rewards');

// === 标签映射常量 ===
const AGE_RANGE_LABELS = {
    under18: '18岁以下',
    '18_24': '18-24岁',
    '25_34': '25-34岁',
    '35_44': '35-44岁',
    '45_54': '45-54岁',
    '55_plus': '55岁及以上',
};

const IDENTITY_LABELS = {
    minor: '未成年',
    undergrad: '本科生',
    postgrad: '研究生',
    staff: '教职工',
    resident: '居民',
    other: '其他',
};

/**
 * 格式化性别标签
 * @param {string} value - 性别值
 * @returns {string} 格式化的性别标签
 */
function formatGenderLabel(value) {
    if (value === 'male') {
        return '男';
    }
    if (value === 'female') {
        return '女';
    }
    return '未填写';
}

/**
 * 格式化年龄段标签
 * @param {string} value - 年龄段值
 * @returns {string} 格式化的年龄段标签
 */
function formatAgeRangeLabel(value) {
    return AGE_RANGE_LABELS[value] || '未填写';
}

/**
 * 格式化身份标签
 * @param {string} value - 身份值
 * @returns {string} 格式化的身份标签
 */
function formatIdentityLabel(value) {
    return IDENTITY_LABELS[value] || '未填写';
}

/**
 * 解析用户昵称
 * @param {Object} profile - 用户资料
 * @param {Object} account - 账户信息
 * @returns {string} 用户昵称
 */
function resolveProfileNickname(profile, account) {
    const fallback = getDefaultNickname(account);
    return (
        profile?.nickname ||
        account?.nickname ||
        account?.username ||
        account?.displayName ||
        fallback
    );
}

/**
 * 创建用户资料卡片数据
 * @param {Object} params - 参数对象
 * @param {Object} params.settings - 用户设置
 * @param {Object} params.profile - 用户资料
 * @param {Object} params.account - 账户信息
 * @returns {Object} 资料卡片数据
 */
function createProfileCard({ settings, profile, account }) {
    const nickname = resolveProfileNickname(profile, account);
    const avatarUrl = profile?.avatarUrl || account?.avatar || '';
    const avatarSeed = avatarUrl || account?.id || nickname;
    const avatarColor = getAvatarColor(avatarSeed);
    const initial = getInitialFromName(nickname || avatarSeed);
    const privacyLevel = settings?.privacyLevel || 'private';
    const defaultPublic = privacyLevel === 'public';
    const personalInfo = [
        { key: 'name', label: '姓名', value: nickname || '未填写' },
        { key: 'gender', label: '性别', value: formatGenderLabel(profile?.gender || account?.gender) },
        { key: 'ageRange', label: '年龄段', value: formatAgeRangeLabel(profile?.ageRange || account?.ageRange) },
        { key: 'identity', label: '身份标签', value: formatIdentityLabel(profile?.identity || account?.identity) },
    ];
    return {
        nickname,
        avatarUrl,
        avatarColor,
        privacyLevel,
        privacyLabel: PRIVACY_LEVEL_MAP[privacyLevel]?.label || '仅自己可见',
        privacyDescription:
            privacyLevel === 'public'
                ? '默认将新轨迹同步到公共社区'
                : '仅自己可见，需要时可手动公开',
        initial,
        shareStatus: defaultPublic ? '公开分享' : '私密记录',
        userIdLabel: account?.id ? `User ID: ${account.id}` : 'User ID: --',
        personalInfo,
        defaultPublic,
    };
}

/**
 * 构建完整的用户卡片数据（包含成就信息）
 * @param {Object} params - 参数对象
 * @param {Object} params.settings - 用户设置
 * @param {Object} params.profile - 用户资料
 * @param {Object} params.account - 账户信息
 * @param {Object} params.overview - 运动概览
 * @returns {Object} 完整的用户卡片数据
 */
function buildUserCard({ settings, profile, account, overview }) {
    const base = createProfileCard({ settings, profile, account, overview });
    const achievementSnapshot = rewards.getAchievementSnapshot();
    const unlockedText = `已获勋章：${achievementSnapshot.unlockedCount}/${achievementSnapshot.badgeCount}`;
    const nextHint = achievementSnapshot.nextBadge
        ? `${achievementSnapshot.nextBadge.icon} ${achievementSnapshot.nextBadge.label} 还差 ${achievementSnapshot.remainingToNext} 分`
        : '已解锁全部勋章';
    return {
        ...base,
        totalPoints: achievementSnapshot.totalPoints,
        badgeIcon: achievementSnapshot.badgeIcon,
        badgeLabel: achievementSnapshot.badgeLabel,
        badgeUnlockedText: unlockedText,
        badgeNextHint: nextHint,
    };
}

module.exports = {
    // 常量导出
    AGE_RANGE_LABELS,
    IDENTITY_LABELS,
    // 函数导出
    formatGenderLabel,
    formatAgeRangeLabel,
    formatIdentityLabel,
    resolveProfileNickname,
    createProfileCard,
    buildUserCard,
};
