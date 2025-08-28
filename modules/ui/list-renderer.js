import { state } from '../data/listings-service.js';
import { renderMatchedListings, showDetailPanel } from './panels.js';

export function bindListEvents(){
  const info = document.getElementById('info-panel');
  info.classList.remove('hidden');
  info.addEventListener('scroll', function(){
    if (this.scrollTop + this.clientHeight >= this.scrollHeight - 50){
      if (state.page * 15 < state.matched.length){ // 15는 config로 빼도 됨
        state.page++;
        renderMatchedListings();
      }
    }
  });

  // 위임: 목록 클릭 -> 상세 열기
  document.getElementById('info-content').addEventListener('click', (e)=>{
    const cell = e.target.closest('[data-action="open-detail"]');
    if (!cell) return;
    const id = cell.getAttribute('data-id');
    showDetailPanel(id);
  });
}
