// modules/core/supabase.js

/**
 * Supabase 준비되기까지 대기하는 공통 헬퍼
 * @param {number} timeoutMs - 타임아웃(ms)
 * @returns {Promise<any>} resolves with window.supabase
 */
export function waitForSupabase(timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    if (window.supabase) return resolve(window.supabase);

    function onReady() {
      document.removeEventListener('supabase-ready', onReady);
      resolve(window.supabase);
    }

    document.addEventListener('supabase-ready', onReady);

    const iv = setInterval(() => {
      if (window.supabase) {
        clearInterval(iv);
        document.removeEventListener('supabase-ready', onReady);
        resolve(window.supabase);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        document.removeEventListener('supabase-ready', onReady);
        reject(new Error('Supabase not ready'));
      }
    }, 50);
  });
}
