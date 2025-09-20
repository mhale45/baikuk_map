import { CONFIG } from '../core/config.js';
import { applyButtonStyle } from './util-style.js';

export function renderDealAndCategoryButtons(state, onChange){
  const wrap = document.getElementById('btn-wrap');
  wrap.innerHTML = '';

  const mk = (text, isActive, toggleFn)=>{
    const btn = document.createElement('button');
    btn.textContent = isActive ? `✓ ${text}` : text;
    btn.className = 'px-3 py-2 rounded-full border text-[13px] font-medium transition';
    applyButtonStyle(btn, isActive);
    btn.addEventListener('click', ()=>{ toggleFn(text); onChange(); });
    wrap.appendChild(btn);
  };

  CONFIG.DEAL_TYPES.forEach(t => mk(t, state.selectedDealTypes.includes(t), txt=>{
    const i = state.selectedDealTypes.indexOf(txt);
    if (i>=0 && state.selectedDealTypes.length>1) state.selectedDealTypes.splice(i,1);
    else if (i<0) state.selectedDealTypes.push(txt);
    renderDealAndCategoryButtons(state, onChange);
  }));

  CONFIG.CATEGORIES.forEach(c => mk(c, state.selectedCategories.includes(c), txt=>{
    const i = state.selectedCategories.indexOf(txt);
    if (i>=0) state.selectedCategories.splice(i,1);
    else state.selectedCategories.push(txt);
    renderDealAndCategoryButtons(state, onChange);
  }));
}
