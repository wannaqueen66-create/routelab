const mediaService = require('../../services/media');
const api = require('../../services/api');
const {
  getUserProfile,
  saveUserProfile,
  getUserAccount,
  saveUserAccount,
} = require('../../utils/storage');

const GENDER_OPTIONS = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
];

const AGE_RANGE_OPTIONS = [
  { value: 'under18', label: '18岁以下' },
  { value: '18_24', label: '18-24岁' },
  { value: '25_34', label: '25-34岁' },
  { value: '35_44', label: '35-44岁' },
  { value: '45_54', label: '45-54岁' },
  { value: '55_plus', label: '55岁及以上' },
];

const IDENTITY_OPTIONS = [
  { value: 'minor', label: '未成年' },
  { value: 'undergrad', label: '本科生' },
  { value: 'postgrad', label: '研究生' },
  { value: 'staff', label: '教职工' },
  { value: 'resident', label: '居民' },
  { value: 'other', label: '其他' },
];

const SECURITY_NOTICE =
  '头像或昵称可能未通过微信安全校验，请稍后重试或确认基础库版本满足要求。';

function findOptionLabel(list, value) {
  if (!value) {
    return '';
  }
  const matched = list.find((item) => item.value === value);
  return matched ? matched.label : '';
}

Page({
  data: {
    avatarPreview: '',
    avatarRemoteUrl: '',
    avatarUploading: false,
    avatarError: '',
    avatarSecurityNotice: '',
    nickname: '',
    nicknameError: '',
    submitting: false,
    canChooseAvatar: true,
    genderOptions: GENDER_OPTIONS,
    gender: '',
    genderError: '',
    ageRangeOptions: AGE_RANGE_OPTIONS,
    ageRange: '',
    ageRangeLabel: '请选择年龄段',
    ageRangeError: '',
    identityOptions: IDENTITY_OPTIONS,
    identity: '',
    identityLabel: '请选择身份标签',
    identityError: '',
  },
  onLoad() {
    const storedProfile = getUserProfile();
    const account = getUserAccount();
    const avatar =
      storedProfile?.avatarUrl || account?.avatar || storedProfile?.avatar || account?.avatarUrl || '';
    const nickname =
      storedProfile?.nickname || account?.nickname || storedProfile?.nickName || account?.nickName || '';
    const canChooseAvatar =
      typeof wx !== 'undefined' && typeof wx.canIUse === 'function'
        ? wx.canIUse('button.open-type.chooseAvatar')
        : false;
    const genderValue = storedProfile?.gender || account?.gender || '';
    const ageRangeValue = storedProfile?.ageRange || account?.ageRange || '';
    const identityValue = storedProfile?.identity || account?.identity || '';

    this.securityTimer = null;

    const resolvedGender = GENDER_OPTIONS.some((item) => item.value === genderValue)
      ? genderValue
      : '';
    const resolvedAgeRange = AGE_RANGE_OPTIONS.some((item) => item.value === ageRangeValue)
      ? ageRangeValue
      : '';
    const resolvedIdentity = IDENTITY_OPTIONS.some((item) => item.value === identityValue)
      ? identityValue
      : '';

    this.setData({
      avatarPreview: avatar || '',
      avatarRemoteUrl: avatar || '',
      nickname: nickname || '',
      canChooseAvatar,
      gender: resolvedGender,
      ageRange: resolvedAgeRange,
      ageRangeLabel: findOptionLabel(AGE_RANGE_OPTIONS, resolvedAgeRange) || '请选择年龄段',
      identity: resolvedIdentity,
      identityLabel: findOptionLabel(IDENTITY_OPTIONS, resolvedIdentity) || '请选择身份标签',
    });
  },
  onUnload() {
    this.clearSecurityTimer();
  },
  clearSecurityTimer() {
    if (this.securityTimer) {
      clearTimeout(this.securityTimer);
      this.securityTimer = null;
    }
  },
  handleAvatarButtonTap() {
    this.clearSecurityTimer();
    this.setData({
      avatarSecurityNotice: '',
      avatarError: '',
    });
    this.securityTimer = setTimeout(() => {
      this.setData({
        avatarSecurityNotice: SECURITY_NOTICE,
      });
    }, 2000);
  },
  handleChooseAvatar(event) {
    this.clearSecurityTimer();
    const tempPath = event?.detail?.avatarUrl;
    if (!tempPath) {
      this.setData({
        avatarError: '未获取到头像，请稍后重试',
        avatarSecurityNotice: SECURITY_NOTICE,
      });
      return;
    }
    const previousRemote = this.data.avatarRemoteUrl || '';
    this.setData({
      avatarPreview: tempPath,
      avatarUploading: true,
      avatarError: '',
      avatarSecurityNotice: '',
    });
    mediaService
      .ensureRemotePhotos([{ path: tempPath }])
      .then(([photo]) => {
        const remoteUrl = photo?.uploaded ? photo.path : '';
        if (!remoteUrl) {
          this.setData({
            avatarError: '头像上传失败，请稍后重试',
            avatarPreview: previousRemote,
            avatarRemoteUrl: previousRemote,
          });
          return;
        }
        this.setData({
          avatarPreview: remoteUrl,
          avatarRemoteUrl: remoteUrl,
        });
      })
      .catch((error) => {
        const message = error?.message || '头像上传失败，请稍后重试';
        this.setData({
          avatarError: message,
          avatarPreview: previousRemote,
          avatarRemoteUrl: previousRemote,
        });
      })
      .finally(() => {
        this.setData({
          avatarUploading: false,
        });
      });
  },
  handleNicknameInput(event) {
    this.setData({
      nickname: event?.detail?.value || '',
      nicknameError: '',
    });
  },
  handleGenderChange(event) {
    const value = event?.detail?.value || '';
    this.setData({
      gender: value,
      genderError: '',
    });
  },
  handleAgeRangeChange(event) {
    const index = Number(event?.detail?.value);
    if (Number.isNaN(index)) {
      return;
    }
    const option = AGE_RANGE_OPTIONS[index] || null;
    this.setData({
      ageRange: option ? option.value : '',
      ageRangeLabel: option ? option.label : '请选择年龄段',
      ageRangeError: '',
    });
  },
  handleIdentityChange(event) {
    const index = Number(event?.detail?.value);
    if (Number.isNaN(index)) {
      return;
    }
    const option = IDENTITY_OPTIONS[index] || null;
    this.setData({
      identity: option ? option.value : '',
      identityLabel: option ? option.label : '请选择身份标签',
      identityError: '',
    });
  },
  validate({ nickname, avatarUrl, gender, ageRange, identity }) {
    if (!avatarUrl) {
      this.setData({
        avatarError: '请选择并上传头像',
      });
      return false;
    }
    if (!nickname) {
      this.setData({
        nicknameError: '昵称不能为空',
      });
      return false;
    }
    if (!gender) {
      this.setData({
        genderError: '请选择性别',
      });
      return false;
    }
    if (!ageRange) {
      this.setData({
        ageRangeError: '请选择年龄段',
      });
      return false;
    }
    if (!identity) {
      this.setData({
        identityError: '请选择身份标签',
      });
      return false;
    }
    return true;
  },
  handleSubmit(event) {
    if (this.data.submitting) {
      return;
    }
    const nickname = (event?.detail?.value?.nickname || this.data.nickname || '').trim();
    const avatarUrl = this.data.avatarRemoteUrl || '';
    const { gender, ageRange, identity } = this.data;
    this.setData({
      nickname,
      nicknameError: '',
      avatarError: '',
      genderError: '',
      ageRangeError: '',
      identityError: '',
    });
    if (!this.validate({ nickname, avatarUrl, gender, ageRange, identity })) {
      wx.showToast({
        title: '请完善必填资料',
        icon: 'none',
      });
      return;
    }
    this.setData({
      submitting: true,
    });
    api
      .updateUserProfile({ nickname, avatarUrl, gender, ageRange, identity })
      .then(() => {
        saveUserProfile({ nickname, avatarUrl, gender, ageRange, identity });
        const account = getUserAccount();
        if (account) {
          saveUserAccount({
            ...account,
            nickname,
            avatar: avatarUrl,
            gender,
            ageRange,
            identity,
          });
        }
        wx.showToast({
          title: '资料已更新',
          icon: 'success',
        });
        const app = typeof getApp === 'function' ? getApp() : null;
        if (app && typeof app.getProfileCompletionStatus === 'function') {
          app.getProfileCompletionStatus();
        }
        setTimeout(() => {
          wx.navigateBack();
        }, 600);
      })
      .catch((error) => {
        const message =
          error?.response?.error ||
          error?.errMsg ||
          error?.message ||
          '资料更新失败，请稍后重试';
        wx.showToast({
          title: message,
          icon: 'none',
        });
      })
      .finally(() => {
        this.setData({
          submitting: false,
        });
      });
  },
});
