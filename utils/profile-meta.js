'use strict';

const AVATAR_COLORS = ['#4f46e5', '#0ea5e9', '#059669', '#f97316', '#a855f7', '#14b8a6', '#ef4444', '#facc15'];

function hashSeed(seed = '') {
  const text = typeof seed === 'string' ? seed : String(seed || '');
  if (!text) return 0;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function getAvatarColor(seed) {
  const colors = AVATAR_COLORS;
  if (!colors.length) return '#e2e8f0';
  const text = typeof seed === 'string' ? seed : String(seed || '');
  if (!text) {
    return colors[0];
  }
  const index = Math.abs(hashSeed(text)) % colors.length;
  return colors[index];
}

function getInitialFromName(name = '') {
  const clean = name.trim();
  if (!clean) return 'R';
  return clean.charAt(0).toUpperCase();
}

function getDefaultNickname(account, fallback = 'RouteLab 用户') {
  if (account && Object.prototype.hasOwnProperty.call(account, 'id')) {
    const idText = `${account.id}`.trim();
    if (idText) {
      return idText;
    }
  }
  return fallback;
}

module.exports = {
  AVATAR_COLORS,
  getAvatarColor,
  getInitialFromName,
  getDefaultNickname,
};
