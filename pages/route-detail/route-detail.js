const { applyThemeMixin } = require('../../utils/theme');
const { getRoutes, updateRoutePrivacy, deleteRoute, syncRouteToCloud } = require('../../services/route-store');
const { PRIVACY_LEVELS, PRIVACY_LEVEL_MAP } = require('../../constants/privacy');
const { ACTIVITY_TYPE_MAP, DEFAULT_ACTIVITY_TYPE } = require('../../constants/activity');
const { PURPOSE_MAP } = require('../../constants/purpose');
const { formatDistance, formatSpeed, formatCalories } = require('../../utils/format');
const { formatDuration, formatDate, formatClock } = require('../../utils/time');
const { getActivityLevel } = require('../../services/analytics');
const { getActivityLevelMeta, ACTIVITY_LEVEL_LIST } = require('../../constants/activity-level');
const api = require('../../services/api');
function buildPolyline(points = []) {
  if (!Array.isArray(points) || !points.length) {
    return [];
  }
  return [
    {
      points: points.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
      })),
      color: '#0ea5e9',
      width: 6,
      arrowLine: true,
    },
  ];
}
function buildMarkers(points = [], pausePoints = []) {
  if (!Array.isArray(points) || !points.length) {
    return [];
  }
  const markers = [
    {
      id: 'start',
      latitude: points[0].latitude,
      longitude: points[0].longitude,
      iconPath: '/assets/icons/start.png',
      width: 28,
      height: 28,
      callout: {
        content: '起点',
        color: '#ffffff',
        bgColor: '#22c55e',
        padding: 6,
        borderRadius: 16,
        display: 'ALWAYS',
      },
    },
    {
      id: 'end',
      latitude: points[points.length - 1].latitude,
      longitude: points[points.length - 1].longitude,
      iconPath: '/assets/icons/end.png',
      width: 28,
      height: 28,
      callout: {
        content: '终点',
        color: '#ffffff',
        bgColor: '#ef4444',
        padding: 6,
        borderRadius: 16,
        display: 'ALWAYS',
      },
    },
  ];
  (pausePoints || []).forEach((point, index) => {
    if (!point) {
      return;
    }
    markers.push({
      id: `pause-${index}`,
      latitude: point.latitude,
      longitude: point.longitude,
      iconPath: '/assets/icons/pause.png',
      width: 24,
      height: 24,
      callout: {
        content: '暂停点',
        color: '#1e293b',
        bgColor: '#fde68a',
        padding: 4,
        borderRadius: 12,
        display: 'ALWAYS',
      },
    });
  });
  return markers;
}
function normalizePhotos(photos = []) {
  if (!Array.isArray(photos)) {
    return [];
  }
  return photos.map((item) => {
    if (typeof item === 'string') {
      return { path: item, note: '' };
    }
    return {
      path: item?.path || item?.url || '',
      note: item?.note || '',
    };
  });
}
function formatDisplayName(nickname, accountId) {
  const raw = typeof nickname === 'string' ? nickname.trim() : '';
  if (raw) {
    return raw;
  }
  const numericId = Number(accountId);
  if (Number.isFinite(numericId) && numericId > 0) {
    return `用户 ID ${numericId}`;
  }
  return 'RouteLab 用户';
}
function formatCommentReply(reply = {}, fallbackRouteId) {
  if (!reply || typeof reply !== 'object') {
    return null;
  }
  const rawId = reply.id ?? reply.replyId ?? reply.reply_id;
  const numericId = Number(rawId);
  const id = Number.isFinite(numericId) ? numericId : rawId;
  const createdAtValue =
    reply.createdAt instanceof Date
      ? reply.createdAt.getTime()
      : reply.created_at instanceof Date
      ? reply.created_at.getTime()
      : Number(reply.createdAt ?? reply.created_at ?? Date.now());
  const timestamp = Number.isFinite(createdAtValue) ? createdAtValue : Date.now();
  const userSource =
    reply.user ||
    reply.author ||
    reply.owner ||
    reply.userProfile ||
    reply.user_profile ||
    {};
  const rawUserId = userSource.id ?? reply.userId ?? reply.user_id ?? null;
  const userId = Number.isFinite(Number(rawUserId)) ? Number(rawUserId) : rawUserId;
  const nickname = userSource.nickname ?? reply.userNickname ?? '';
  const avatar = userSource.avatar ?? reply.userAvatar ?? '';
  const displayName = formatDisplayName(nickname || userSource.displayName, userId);
  return {
    id,
    commentId: Number(
      reply.commentId ?? reply.comment_id ?? reply.parentId ?? reply.parent_id ?? 0
    ),
    routeId: reply.routeId ?? reply.route_id ?? fallbackRouteId ?? null,
    content: reply.content || '',
    createdAt: timestamp,
    createdAtText: formatDate(timestamp),
    user: {
      id: userId,
      displayName,
      nickname,
      avatar,
    },
  };
}
function formatCommentThread(comment = {}, fallbackRouteId) {
  if (!comment || typeof comment !== 'object') {
    return null;
  }
  const rawId = comment.id ?? comment.commentId ?? comment.comment_id;
  const numericId = Number(rawId);
  const id = Number.isFinite(numericId) ? numericId : rawId;
  const createdAtValue =
    comment.createdAt instanceof Date
      ? comment.createdAt.getTime()
      : comment.created_at instanceof Date
      ? comment.created_at.getTime()
      : Number(comment.createdAt ?? comment.created_at ?? Date.now());
  const timestamp = Number.isFinite(createdAtValue) ? createdAtValue : Date.now();
  const userSource =
    comment.user ||
    comment.author ||
    comment.owner ||
    comment.userProfile ||
    comment.user_profile ||
    {};
  const rawUserId = userSource.id ?? comment.userId ?? comment.user_id ?? null;
  const userId = Number.isFinite(Number(rawUserId)) ? Number(rawUserId) : rawUserId;
  const nickname = userSource.nickname ?? comment.userNickname ?? '';
  const avatar = userSource.avatar ?? comment.userAvatar ?? '';
  const displayName = formatDisplayName(nickname || userSource.displayName, userId);
  const replies = Array.isArray(comment.replies)
    ? comment.replies.map((reply) => formatCommentReply(reply, fallbackRouteId)).filter(Boolean)
    : [];
  const repliesCount = Number(
    comment.repliesCount ?? comment.replies_count ?? replies.length ?? 0
  );
  const deletedAtCandidate =
    comment.deletedAt ?? comment.deleted_at ?? comment.deletedAtMs ?? null;
  const deletedAtNumeric = Number(deletedAtCandidate);
  const canDelete = Boolean(
    comment.canDelete ??
      comment.can_delete ??
      comment.deletable ??
      comment.isOwner ??
      comment.is_owner ??
      false
  );
  const canModerate = Boolean(comment.canModerate ?? comment.can_moderate ?? false);
  const isDeleted = Boolean(comment.isDeleted ?? comment.is_deleted ?? false);
  return {
    id,
    routeId: comment.routeId ?? comment.route_id ?? fallbackRouteId ?? null,
    content: comment.content || '',
    createdAt: timestamp,
    createdAtText: formatDate(timestamp),
    likes: Number(comment.likes ?? comment.likesCount ?? comment.likes_count ?? 0) || 0,
    liked: Boolean(
      comment.liked ?? comment.likedByCurrent ?? comment.liked_by_current ?? false
    ),
    repliesCount,
    replies,
    user: {
      id: Number.isFinite(Number(userId)) ? Number(userId) : userId,
      displayName,
      nickname,
      avatar,
    },
    canDelete,
    canModerate,
    isDeleted,
    deletedAt: Number.isFinite(deletedAtNumeric) ? deletedAtNumeric : null,
  };
}
function sortComments(list = []) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const likeDiff = (Number(b.likes) || 0) - (Number(a.likes) || 0);
    if (likeDiff !== 0) {
      return likeDiff;
    }
    return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  });
}
Page(applyThemeMixin({
  data: {
    routeId: '',
    detail: null,
    polyline: [],
    markers: [],
    privacyOptions: PRIVACY_LEVELS,
    privacyIndex: 0,
    levelStandards: ACTIVITY_LEVEL_LIST,
    ownRoute: true,
    loading: false,
    comments: [],
    commentsLoading: false,
    commentsError: '',
    commentStats: null,
  },
  onLoad(options) {
    this.routeId = options.id;
    this.loadRoute();
  },
  onShow() {
    if (this.routeId) {
      this.loadRoute();
    }
  },
  loadRoute() {
    const routes = getRoutes();
    const route = routes.find((item) => item.id === this.routeId);
    if (route) {
      this.applyRouteDetail(route, true);
      return;
    }
    this.setData({ loading: true, detail: null });
    api
      .getRouteById(this.routeId)
      .then((remoteRoute) => {
        if (!remoteRoute) {
          wx.showToast({
            title: '未找到轨迹',
            icon: 'none',
          });
          return;
        }
        this.applyRouteDetail(remoteRoute, false);
      })
      .catch(() => {
        wx.showToast({
          title: '未找到轨迹',
          icon: 'none',
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },
  applyRouteDetail(route, ownRoute) {
    const activityType = route.meta?.activityType || route.activityType || DEFAULT_ACTIVITY_TYPE;
    const activityMeta = ACTIVITY_TYPE_MAP[activityType] || ACTIVITY_TYPE_MAP[DEFAULT_ACTIVITY_TYPE];
    const startLabel = route.meta?.startLabel || route.campusZone || '起点未识别';
    const endLabel = route.meta?.endLabel || startLabel;
    const duration = formatDuration(route.stats?.duration);
    const distance = formatDistance(route.stats?.distance);
    const calories = formatCalories(route.stats?.calories);
    const steps = activityType === 'ride' ? '--' : Math.round((route.stats?.distance || 0) / 0.75);
    const paceOrSpeed =
      activityType === 'ride'
        ? `${route.stats?.speed ? (route.stats.speed * 3.6).toFixed(1) : '0.0'} km/h`
        : formatSpeed(route.stats?.speed);
    const photos = normalizePhotos(route.photos);
    const privacyIndex = Math.max(PRIVACY_LEVELS.findIndex((item) => item.key === route.privacyLevel), 0);
    const activityLevelKey = route.meta?.activityLevel || getActivityLevel(route);
    const activityLevelMeta = getActivityLevelMeta(activityLevelKey);
    const rawPurpose =
      typeof route.meta?.purposeType === 'string'
        ? route.meta.purposeType
        : typeof route.purposeType === 'string'
        ? route.purposeType
        : '';
    const purposeMeta = rawPurpose && PURPOSE_MAP[rawPurpose] ? PURPOSE_MAP[rawPurpose] : null;
    this.setData({
      routeId: route.id,
      detail: {
        title: route.title,
        campusLabel: `${startLabel} → ${endLabel}`,
        startLabel,
        endLabel,
        startDate: formatDate(route.startTime),
        timeRange: `${formatClock(route.startTime)} - ${formatClock(route.endTime)}`,
        duration,
        paceOrSpeed,
        distance,
        calories,
        steps,
        privacyLabel: PRIVACY_LEVEL_MAP[route.privacyLevel]?.label || '未知',
        note: route.note || '未填写备注',
        activityLabel: activityMeta.label,
        photos,
        activityLevel: activityLevelMeta,
        purposeLabel: purposeMeta ? purposeMeta.label : '未填写',
        purposeDescription: purposeMeta
          ? purposeMeta.description
          : '本次路线未填写出行目的',
        purposeIcon: purposeMeta ? purposeMeta.icon : '？',
        hasPurpose: !!purposeMeta,
      },
      polyline: buildPolyline(route.points),
      markers: buildMarkers(route.points, route.meta?.pausePoints),
      centerLatitude: route.points?.[0]?.latitude || 30.27415,
      centerLongitude: route.points?.[0]?.longitude || 120.15515,
      privacyIndex,
      levelStandards: ACTIVITY_LEVEL_LIST,
      ownRoute,
    });
    // Ensure start/end labels show place names via local fallback if needed
    const isWeak = (name = '') => {
      if (!name || typeof name !== 'string') return true;
      const s = name.trim();
      if (!s) return true;
      if (/^\d+(\.\d+)?\s*,\s*\d+(\.\d+)?$/.test(s)) return true;
      return s.includes('未识别') || s.includes('待定') || s.startsWith('坐标') || s.includes('离线轨迹');
    };
    const points = Array.isArray(route.points) ? route.points : [];
    if (points.length) {
      const start = points[0];
      const end = points[points.length - 1] || start;
      const needStart = isWeak(startLabel);
      const needEnd = isWeak(endLabel);
      if (needStart || needEnd) {
        const tasks = [];
        if (needStart) tasks.push(api.reverseGeocodeSafe({ latitude: start.latitude, longitude: start.longitude }));
        else tasks.push(Promise.resolve({ displayName: startLabel }));
        if (needEnd) tasks.push(api.reverseGeocodeSafe({ latitude: end.latitude, longitude: end.longitude }));
        else tasks.push(Promise.resolve({ displayName: endLabel }));
        Promise.all(tasks)
          .then(([sRes, eRes]) => {
            const sLabel = sRes?.name || sRes?.displayName || startLabel;
            const eLabel = eRes?.name || eRes?.displayName || endLabel;
            this.setData({
              'detail.startLabel': sLabel,
              'detail.endLabel': eLabel,
              'detail.campusLabel': `${sLabel} · ${eLabel}`,
            });
          })
          .catch(() => {});
      }
    }
  },
  loadComments() {
    if (!this.routeId) {
      return;
    }
    this.setData({ commentsLoading: true, commentsError: '' });
    api
      .listRouteComments(this.routeId)
      .then((res) => {
        const comments = Array.isArray(res?.comments)
          ? sortComments(
              res.comments
                .map((item) => formatCommentThread(item, this.routeId))
                .filter(Boolean)
            )
          : [];
        this.setData({
          comments,
          commentStats: res?.stats || null,
        });
      })
      .catch((error) => {
        const message = error?.errMsg || error?.message || '评论加载失败';
        this.setData({ commentsError: message });
      })
      .finally(() => {
        this.setData({ commentsLoading: false });
      });
  },
  mergeCommentUpdate(comment) {
    if (!comment) {
      return;
    }
    const list = Array.isArray(this.data.comments) ? [...this.data.comments] : [];
    const index = list.findIndex((item) => item.id === comment.id);
    if (comment.isDeleted) {
      if (index >= 0) {
        list.splice(index, 1);
        this.setData({ comments: sortComments(list) });
      }
      return;
    }
    if (index >= 0) {
      list.splice(index, 1, comment);
    } else {
      list.unshift(comment);
    }
    this.setData({ comments: sortComments(list) });
  },
  syncDiscussionPatch(patch = {}) {
    const pages = getCurrentPages();
    if (!Array.isArray(pages) || pages.length < 2) {
      return;
    }
    const prevPage = pages[pages.length - 2];
    if (prevPage && typeof prevPage.updateDiscussionRoute === 'function') {
      prevPage.updateDiscussionRoute(patch);
    }
  },
  handleAddComment() {
    if (!this.routeId) {
      return;
    }
    wx.showModal({
      title: '发表评论',
      editable: true,
      placeholderText: '写下你的想法',
      confirmText: '发布',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        if (typeof res.content !== 'string') {
          wx.showToast({ title: '请升级微信后再试', icon: 'none' });
          return;
        }
        const content = res.content.trim();
        if (!content) {
          wx.showToast({ title: '评论内容不能为空', icon: 'none' });
          return;
        }
        if (content.length > 280) {
          wx.showToast({ title: '评论内容过长', icon: 'none' });
          return;
        }
        this.commentBusyIds = this.commentBusyIds || new Set();
        if (this.commentBusyIds.has(this.routeId)) {
          return;
        }
        this.commentBusyIds.add(this.routeId);
        wx.showLoading({ title: '发布中...', mask: true });
        api
          .createRouteComment(this.routeId, content)
          .then((result) => {
            const formatted = formatCommentThread(result?.comment, this.routeId);
            if (formatted) {
              this.mergeCommentUpdate(formatted);
            }
            if (result?.comment) {
              const patch = {
                id: this.routeId,
                comment: result.comment,
              };
              const commentsValue = Number(result?.comments ?? NaN);
              const commentsTopLevel = Number(result?.commentsTopLevel ?? NaN);
              const commentsReplies = Number(result?.commentsReplies ?? NaN);
              if (Number.isFinite(commentsValue)) {
                patch.comments = commentsValue;
              }
              if (Number.isFinite(commentsTopLevel)) {
                patch.commentsTopLevel = commentsTopLevel;
              }
              if (Number.isFinite(commentsReplies)) {
                patch.commentsReplies = commentsReplies;
              }
              this.syncDiscussionPatch(patch);
              this.setData({
                commentStats: {
                  comments: Number.isFinite(commentsValue) ? commentsValue : null,
                  commentsTopLevel: Number.isFinite(commentsTopLevel)
                    ? commentsTopLevel
                    : null,
                  commentsReplies: Number.isFinite(commentsReplies)
                    ? commentsReplies
                    : null,
                },
              });
            }
            wx.showToast({ title: '已发布', icon: 'success' });
          })
          .catch(() => {
            wx.showToast({ title: '评论失败，请稍后重试', icon: 'none' });
          })
          .finally(() => {
            this.commentBusyIds.delete(this.routeId);
            wx.hideLoading();
          });
      },
    });
  },
  handleToggleCommentLike(event) {
    const { id, liked } = event.currentTarget.dataset || {};
    if (id === undefined || id === null) {
      return;
    }
    const numericId = Number(id);
    const commentId = Number.isFinite(numericId) ? numericId : id;
    this.commentLikeBusy = this.commentLikeBusy || new Set();
    if (this.commentLikeBusy.has(commentId)) {
      return;
    }
    this.commentLikeBusy.add(commentId);
    const finish = () => {
      this.commentLikeBusy.delete(commentId);
    };
    const requester = liked ? api.unlikeRouteComment : api.likeRouteComment;
    requester(commentId)
      .then((res) => {
        const formatted = formatCommentThread(res?.comment, this.routeId);
        if (formatted) {
          this.mergeCommentUpdate(formatted);
          this.syncDiscussionPatch({
            id: this.routeId,
            comment: res.comment,
          });
        }
        wx.showToast({
          title: formatted?.liked ? '已赞同评论' : '已取消点赞',
          icon: 'none',
        });
      })
      .catch(() => {
        wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' });
      })
      .finally(finish);
  },
  handleReplyComment(event) {
    const { id } = event.currentTarget.dataset || {};
    if (id === undefined || id === null || !this.routeId) {
      return;
    }
    wx.showModal({
      title: '回复评论',
      editable: true,
      placeholderText: '写下你的回复',
      confirmText: '回复',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        if (typeof res.content !== 'string') {
          wx.showToast({ title: '请升级微信后再试', icon: 'none' });
          return;
        }
        const content = res.content.trim();
        if (!content) {
          wx.showToast({ title: '回复内容不能为空', icon: 'none' });
          return;
        }
        if (content.length > 280) {
          wx.showToast({ title: '回复内容过长', icon: 'none' });
          return;
        }
        this.replyBusyIds = this.replyBusyIds || new Set();
        if (this.replyBusyIds.has(id)) {
          return;
        }
        this.replyBusyIds.add(id);
        wx.showLoading({ title: '回复中...', mask: true });
        api
          .createRouteCommentReply(this.routeId, id, content)
          .then((result) => {
            const formatted = formatCommentThread(result?.comment, this.routeId);
            if (formatted) {
              this.mergeCommentUpdate(formatted);
            }
            if (result?.comment) {
              const patch = {
                id: this.routeId,
                comment: result.comment,
              };
              const commentsValue = Number(result?.comments ?? NaN);
              const commentsTopLevel = Number(result?.commentsTopLevel ?? NaN);
              const commentsReplies = Number(result?.commentsReplies ?? NaN);
              if (Number.isFinite(commentsValue)) {
                patch.comments = commentsValue;
              }
              if (Number.isFinite(commentsTopLevel)) {
                patch.commentsTopLevel = commentsTopLevel;
              }
              if (Number.isFinite(commentsReplies)) {
                patch.commentsReplies = commentsReplies;
              }
              this.syncDiscussionPatch(patch);
              this.setData({
                commentStats: {
                  comments: Number.isFinite(commentsValue) ? commentsValue : null,
                  commentsTopLevel: Number.isFinite(commentsTopLevel)
                    ? commentsTopLevel
                    : null,
                  commentsReplies: Number.isFinite(commentsReplies)
                    ? commentsReplies
                    : null,
                },
              });
            }
            wx.showToast({ title: '已回复', icon: 'success' });
          })
          .catch(() => {
            wx.showToast({ title: '回复失败，请稍后重试', icon: 'none' });
          })
          .finally(() => {
          this.replyBusyIds.delete(id);
          wx.hideLoading();
        });
  },
  handleDeleteComment(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const rawId =
      dataset.commentId !== undefined
        ? dataset.commentId
        : dataset.id !== undefined
        ? dataset.id
        : dataset.commentid !== undefined
        ? dataset.commentid
        : null;
    if (rawId === undefined || rawId === null || rawId === '') {
      return;
    }
    const numericId = Number(rawId);
    const commentId = Number.isFinite(numericId) ? numericId : rawId;
    wx.showModal({
      title: '删除评论',
      content: '删除后评论将立即从列表中隐藏，管理员仍可在后台审核。确认删除？',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.commentDeleteBusy = this.commentDeleteBusy || new Set();
        if (this.commentDeleteBusy.has(commentId)) {
          return;
        }
        this.commentDeleteBusy.add(commentId);
        wx.showLoading({ title: '删除中…', mask: true });
        api
          .deleteRouteComment(commentId)
          .then((result) => {
            const current = Array.isArray(this.data.comments) ? this.data.comments : [];
            const filtered = current.filter((item) => item.id !== commentId);
            const statsPayload = result?.stats || null;
            let nextStats = null;
            if (statsPayload) {
              const commentsValue = Number(statsPayload.comments ?? NaN);
              const commentsTopLevel = Number(statsPayload.commentsTopLevel ?? NaN);
              const commentsReplies = Number(statsPayload.commentsReplies ?? NaN);
              nextStats = {
                comments: Number.isFinite(commentsValue) ? commentsValue : null,
                commentsTopLevel: Number.isFinite(commentsTopLevel) ? commentsTopLevel : null,
                commentsReplies: Number.isFinite(commentsReplies) ? commentsReplies : null,
              };
            } else {
              const topLevel = filtered.length;
              const replies = filtered.reduce((acc, item) => {
                const replyCount = Number(item.repliesCount ?? (Array.isArray(item.replies) ? item.replies.length : 0));
                return acc + (Number.isFinite(replyCount) ? replyCount : 0);
              }, 0);
              nextStats = {
                comments: topLevel + replies,
                commentsTopLevel: topLevel,
                commentsReplies: replies,
              };
            }
            const commentPayload =
              result?.comment || { id: commentId, routeId: this.routeId, isDeleted: true };
            const patch = {
              id: this.routeId,
              comment: commentPayload,
            };
            if (nextStats) {
              if (Number.isFinite(Number(nextStats.comments))) {
                patch.comments = Number(nextStats.comments);
              }
              if (Number.isFinite(Number(nextStats.commentsTopLevel))) {
                patch.commentsTopLevel = Number(nextStats.commentsTopLevel);
              }
              if (Number.isFinite(Number(nextStats.commentsReplies))) {
                patch.commentsReplies = Number(nextStats.commentsReplies);
              }
            }
            this.setData({
              comments: filtered,
              commentStats: nextStats,
            });
            this.syncDiscussionPatch(patch);
            wx.showToast({ title: '已删除', icon: 'success' });
          })
          .catch(() => {
            wx.showToast({ title: '删除失败，请稍后再试', icon: 'none' });
          })
          .finally(() => {
            this.commentDeleteBusy.delete(commentId);
            wx.hideLoading();
          });
      },
    });
  },
    });
  },  handlePrivacyChange(event) {
    if (!this.data.ownRoute) {
      wx.showToast({
        title: '公开轨迹无法修改隐私',
        icon: 'none',
      });
      return;
    }
    const index = Number(event.detail.value);
    const level = PRIVACY_LEVELS[index].key;
    updateRoutePrivacy(this.routeId, level);
    const route = getRoutes().find((item) => item.id === this.routeId) || null;
    syncRouteToCloud(route).catch(() => {});
    wx.showToast({
      title: '隐私已更新',
      icon: 'success',
    });
    this.loadRoute();
  },
  handleDelete() {
    if (!this.data.ownRoute) {
      wx.showToast({
        title: '公开轨迹无法删除',
        icon: 'none',
      });
      return;
    }
    wx.showModal({
      title: '删除轨迹',
      content: '确定删除本次轨迹？删除后不可恢复',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: (res) => {
        if (res.confirm) {
          deleteRoute(this.routeId);
          wx.showToast({
            title: '已删除',
            icon: 'none',
          });
          wx.navigateBack();
        }
      },
    });
  },
  handlePreviewPhoto(event) {
    const { index } = event.currentTarget.dataset;
    const photoIndex = Number(index);
    const photos = this.data.detail?.photos || [];
    if (!photos.length) {
      return;
    }
    const target = photos[photoIndex] || {};
    wx.previewImage({
      current: target.path,
      urls: photos.map((item) => item.path),
    });
  },
  onShareAppMessage() {
    if (!this.data.detail) {
      return {};
    }
    return {
      title: `RouteLab | ${this.data.detail.title}`,
      path: `/pages/route-detail/route-detail?id=${this.routeId}`,
    };
  },
}));
