/**
 * 토스트 메시지를 화면에 표시
 */
export function showToastGreenRed(msg, { ok=false } = {}) {
  const el = document.getElementById('toast');
  if (!el) return alert(msg); // fallback
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.background = ok ? '#F2C130' : '#ef4444';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 2200);
}
