'use strict';

const { applyThemeMixin } = require('../../utils/theme');
const api = require('../../services/api');

Page(applyThemeMixin({
  data: {
    categoryOptions: [
      { key: 'bug', label: '功能异常 / Bug' },
      { key: 'feature', label: '新功能建议' },
      { key: 'data', label: '数据问题' },
      { key: 'other', label: '其他' },
    ],
    categoryIndex: 0,
    title: '',
    content: '',
    submitting: false,
  },

  handleCategoryChange(event) {
    const index = Number(event?.detail?.value || 0) || 0;
    this.setData({ categoryIndex: index });
  },

  handleTitleInput(event) {
    this.setData({ title: event.detail.value || '' });
  },

  handleContentInput(event) {
    this.setData({ content: event.detail.value || '' });
  },

  handleSubmit() {
    if (this.data.submitting) return;
    const title = (this.data.title || '').trim();
    const content = (this.data.content || '').trim();
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }
    if (!content) {
      wx.showToast({ title: '请填写详细描述', icon: 'none' });
      return;
    }
    const category = this.data.categoryOptions[this.data.categoryIndex]?.key || 'other';

    this.setData({ submitting: true });
    api
      .submitFeedbackTicket({
        category,
        title,
        content,
      })
      .then(() => {
        wx.showToast({ title: '反馈已提交', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack({ delta: 1 });
        }, 500);
      })
      .catch(() => {
        wx.showToast({ title: '提交失败，请稍后重试', icon: 'none' });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },
}));

