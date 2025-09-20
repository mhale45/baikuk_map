/**
 * input 요소 길이에 따라 width 자동 조정
 * @param {HTMLInputElement} el - 대상 input
 * @param {object} [opts]
 * @param {number} [opts.min=6] - 최소 글자수
 * @param {number} [opts.max=40] - 최대 글자수
 */
export function autosizeInputByCh(el, { min=6, max=40 } = {}) {
  if (!el) return;
  if (el._autowidthInit) { apply(); return; }  // 중복 바인딩 방지

  function apply() {
    const len = Math.max(min, Math.min((el.value || el.placeholder || '').length, max));
    el.style.width = `${len}ch`;
  }

  el.addEventListener('input', apply);
  el.addEventListener('change', apply);
  el._autowidthInit = true;
  apply();
}
