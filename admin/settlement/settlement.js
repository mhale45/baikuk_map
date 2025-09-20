// /admin/settlement/settlement.js

import { client as supabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';

const $  = (sel, doc = document) => doc.querySelector(sel);
const $$ = (sel, doc = document) => Array.from(doc.querySelectorAll(sel));

/** 숫자 콤마 */
function fmt(n) {
  const x = Number(n || 0);
  return x.toLocaleString('ko-KR');
}

/** YYYY-MM 키 생성 */
function ymKey(dateStr) {
  // dateStr: 'YYYY-MM-DD'
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateStr);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** 테이블 렌더 */
function renderMonthlyTable({ titleAffiliation, monthlyMap }) {
  const titleEl = $('#branch-monthly-title');
  const tbody   = $('#branch-monthly-tbody');
  if (titleEl) titleEl.textContent = titleAffiliation ? `지점: ${titleAffiliation}` : '지점을 선택하세요';
  if (!tbody) return;

  // 비움
  tbody.innerHTML = '';

  const keys = Object.keys(monthlyMap).sort(); // 오름차순
  if (keys.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td class="border px-2 py-3 text-center text-gray-500" colspan="2">데이터가 없습니다</td>
      </tr>
    `;
    return;
  }

  for (const ym of keys) {
    const total = monthlyMap[ym] || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-2 py-2 text-center">${ym}</td>
      <td class="border px-2 py-2 text-right font-semibold">${fmt(total)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/**
 * 지점별 월합계 로딩 로직
 * - 1) 해당 지점 소속의 재직자 staff id 집합 구함
 * - 2) 확정(performance.status=true) + balance_date 있는 performance 목록 조회
 * - 3) allocations에서 staff_id1~4가 지점 직원이면 involvement_sales1~4를 해당 월(YYYY-MM)에 합산
 */
async function loadBranchMonthlySales(affiliation) {
  try {
    if (!affiliation) return;

    // 1) 소속 직원 id
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff_profiles')
      .select('id')
      .eq('affiliation', affiliation)
      .is('leave_date', null);
    if (staffErr) throw staffErr;

    const staffIds = new Set((staffRows || []).map(r => String(r.id)));
    if (staffIds.size === 0) {
      renderMonthlyTable({ titleAffiliation: affiliation, monthlyMap: {} });
      return;
    }

    // 2) 확정 + 잔금일 존재하는 performance
    const { data: perfRows, error: perfErr } = await supabase
      .from('performance')
      .select('id, balance_date, status')
      // .eq('status', true)
      .not('balance_date', 'is', null);
    if (perfErr) throw perfErr;

    if (!perfRows || perfRows.length === 0) {
      renderMonthlyTable({ titleAffiliation: affiliation, monthlyMap: {} });
      return;
    }

    const perfIdToYM = new Map();
    const perfIds = [];
    for (const p of perfRows) {
      const ym = ymKey(p.balance_date);
      if (!ym) continue;
      perfIdToYM.set(String(p.id), ym);
      perfIds.push(p.id);
    }
    if (perfIds.length === 0) {
      renderMonthlyTable({ titleAffiliation: affiliation, monthlyMap: {} });
      return;
    }

    // 3) allocations 조회 (IN 조건은 1000개 제한 고려 → 배치)
    const BATCH = 800;
    const monthlyMap = {}; // { 'YYYY-MM': sum }
    for (let i = 0; i < perfIds.length; i += BATCH) {
      const chunk = perfIds.slice(i, i + BATCH);
      const { data: allocRows, error: allocErr } = await supabase
        .from('performance_allocations')
        .select(`
          performance_id,
          staff_id1, buyer_weight1, seller_weight1, buyer_amount1, seller_amount1, involvement_sales1,
          staff_id2, buyer_weight2, seller_weight2, buyer_amount2, seller_amount2, involvement_sales2,
          staff_id3, buyer_weight3, seller_weight3, buyer_amount3, seller_amount3, involvement_sales3,
          staff_id4, buyer_weight4, seller_weight4, buyer_amount4, seller_amount4, involvement_sales4
        `)
        .in('performance_id', chunk);
      if (allocErr) throw allocErr;

      for (const row of (allocRows || [])) {
        const perfId = String(row.performance_id);
        const ym = perfIdToYM.get(perfId);
        if (!ym) continue;

        // 1~4 슬롯 검사
        for (let k = 1; k <= 4; k++) {
          const sid = row[`staff_id${k}`];
          if (!sid) continue;
          if (!staffIds.has(String(sid))) continue;

          const inv = Number(row[`involvement_sales${k}`] || 0);
          monthlyMap[ym] = (monthlyMap[ym] || 0) + inv;
        }
      }
    }

    renderMonthlyTable({ titleAffiliation: affiliation, monthlyMap });
  } catch (e) {
    console.error('월별 합계 로딩 실패:', e);
    showToastGreenRed?.('월별 합계 로딩 실패');
  }
}

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

    for (const branch of (branches || [])) {
      const aff = branch.affiliation;
      if (!aff) continue;

      const div = document.createElement('div');
      div.className = 'px-3 py-2 text-sm font-medium hover:bg-yellow-100 cursor-pointer';
      div.textContent = aff;
      div.dataset.affiliation = aff;

      div.addEventListener('click', () => {
        // 선택 스타일 초기화
        $$('#branch-list > div').forEach(el => el.classList.remove('bg-yellow-200'));
        // 현재 선택 표시
        div.classList.add('bg-yellow-200');

        // 월별 합계 로딩
        loadBranchMonthlySales(aff);
      });

      container.appendChild(div);
    }
  } catch (e) {
    console.error('지점 목록 로딩 실패:', e);
    showToastGreenRed?.('지점 목록 로딩 실패');
  }
}

// === 초기화 ===
export async function initSettlement() {
  await renderBranchList();
  // 최초엔 “지점을 선택하세요” 상태로 대기
}
