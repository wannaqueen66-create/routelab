'use strict';

Page({
  onLoad() {
    wx.redirectTo({
      url: '/pages/index/index?tab=profile',
    });
  },
});
