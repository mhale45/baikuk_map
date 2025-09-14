// /admin/settlement/settlement.js

import { client as supabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';

const $ = (sel, doc = document) => doc.querySelector(sel);
const $$ = (sel, doc = document) => Array.from(doc.querySelectorAll(sel));

// === 지점 리스트 렌더 ===
async function renderBranchList() {
  try {
    const { data: branches, error } = await supabase
      .from('branch_info')
      .select('affiliation')
      .order('affiliation', { ascending: true });

    if (error) throw error;

    const container = $('#branch-list');
    if (!container) return;

    container.innerHTML = ''; // 기존 내용 제거

    for (const branch of branches) {
      const div = document.createElement('div');
      div.className = 'px-3 py-2 text-sm font-medium hover:bg-yellow-100 cursor-pointer';
      div.textContent = branch.affiliation;
      div.dataset.affiliation = branch.affiliation;

      // 클릭 이벤트 예시 (향후 필터 연동 예정)
      div.addEventListener('click', () => {
        console.log('지점 클릭:', branch.affiliation);
        // 예: 필터링 로직 또는 선택 상태 저장
      });

      container.appendChild(div);
    }
  } catch (e) {
    console.error('지점 목록 로딩 실패:', e);
    showToastGreenRed('지점 목록 로딩 실패');
  }
}

// === 초기화 ===
export async function initSettlement() {
  await renderBranchList();
}
