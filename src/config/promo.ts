/**
 * 全局常量与推广位配置。
 * 推广链接集中在这里，各端引用同一份，改一处全端生效。
 */

export const APP_NAME = __APP_NAME__;
export const APP_VERSION = __APP_VERSION__;
export const APP_DESC = __APP_DESC__;

/** 中文名 */
export const APP_NAME_CN = '我的EMBY';

export const PROMO = {
  /** 展示名称 */
  title: 'UHD 4K 影音媒体库 EMBY',
  /** 一行简介，用在首页等显眼位置 */
  short: '还没有自己的 Emby 服务器？可以看看这家',
  /** 长一点的说明，用在设置/关于页 */
  long: '提供 UHD 4K 影音媒体库的 Emby 服务，注册后即可配合 myemby 使用。',
  url: 'https://www.uhdnow.com/signup?invite=AN913K',
};

export const PROJECT = {
  repo: 'https://github.com/xikkcn/myemby',
  releases: 'https://github.com/xikkcn/myemby/releases',
  issues: 'https://github.com/xikkcn/myemby/issues',
};
