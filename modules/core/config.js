// 상수/환경
export const CONFIG = {
  SUPABASE_URL: 'https://sfinbtiqlfnaaarziixu.supabase.co',
  SUPABASE_ANON_KEY: '...여기에 기존 키...',
  REQUIRE_AUTH: /\/admin(?:\/index\.html)?\/?$/.test(location.pathname),

  BUCKET: 'listing-images',
  BUCKET_IS_PUBLIC: false,

  WM_BUCKET: 'baikuk-images-open',
  WM_PREFIX: '',
  WM_FILE: 'baikuk-logo-warter-mark.png',
  WM_BUCKET_IS_PUBLIC: true,

  UI: {
    HIGHLIGHT_COLOR: '#F2C130',
    HIGHLIGHT_TEXT: '#111',
    DEFAULT_BTN_BG: '#f3f4f6',
    DEFAULT_BTN_TEXT: '#374151',
    PAGE_SIZE: 15,
  },

  FILTER_DEFS: [
    { id:'deposit',       label:'보증금',   width:300 },
    { id:'rent',          label:'월세',     width:280 },
    { id:'floor',         label:'층',       width:280 },
    { id:'area_py',       label:'전용평수',  width:280 },
    { id:'sale',          label:'매매가',    width:300 },
    { id:'total_deposit', label:'총보증금',  width:300 },
    { id:'total_rent',    label:'총월세',    width:280 },
  ],
  FILTER_UNITS: { floor:'층', sale:'만', deposit:'만', rent:'만', total_deposit:'만', total_rent:'만', area_py:'평' },

  DEAL_TYPES: ['월세','매매'],
  CATEGORIES: ['상가','공장·창고'],

  LOGIN_PAGE: 'index.html',
};
