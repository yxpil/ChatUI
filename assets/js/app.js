/* ===========================================================
   app.js · 启动入口
   =========================================================== */
(function () {
  'use strict';

  function boot() {
    try {
      Store.init();
    } catch (e) {
      console.error('[ChatUI] 数据初始化失败', e);
      U.toast('本地数据读取失败，已使用默认配置：' + e.message, 'err', 4000);
    }
    try {
      UI.init();
    } catch (e) {
      console.error('[ChatUI] 界面初始化失败', e);
      U.toast('界面初始化失败：' + e.message, 'err', 6000);
    }
    // 便于调试
    window.ChatUI = { Store: Store, UI: UI, API: API, MD: MD, Memory: Memory, U: U };
  }

  window.addEventListener('error', function (e) {
    if (e && e.message && /ResizeObserver|Script error/i.test(e.message)) return;
    console.error('[ChatUI]', e.message);
  });
  window.addEventListener('unhandledrejection', function (e) {
    console.warn('[ChatUI] 未处理的 Promise 拒绝：', e.reason);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
