// /admin/settlement/settlement.js

import { client as supabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';

const $  = (sel, doc = document) => doc.querySelector(sel);
const $$ = (sel, doc = document) => Array.from(doc.querySelectorAll(sel));
// [ADD] 급여율: 관여매출의 50%
const PAYROLL_RATE = 0.5;
// [ADD] 월별 합계 캐시(드로어에서 참조)
let __LAST_AFFILIATION = null;
let __LAST_SALES_MAP = {};
let __LAST_PAYROLL_MAP = {};
let __LAST_COST_MAP = {};

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

function renderMonthlyTable({ titleAffiliation, salesMap, payrollMap, costMap }) {
  const titleEl = $('#branch-monthly-title');
  const tbody   = $('#branch-monthly-tbody');
  if (titleEl) titleEl.textContent = titleAffiliation ? `지점: ${titleAffiliation}` : '지점을 선택하세요';
  if (!tbody) return;

  tbody.innerHTML = '';

  const ymSet = new Set([
    ...Object.keys(salesMap || {}),
    ...Object.keys(payrollMap || {}),
    ...Object.keys(costMap || {}),
  ]);
  const keys = Array.from(ymSet).sort();

  if (keys.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td class="border px-2 py-3 text-center text-gray-500" colspan="5">데이터가 없습니다</td>
      </tr>
    `;
    return;
  }

  for (const ym of keys) {
    const sales   = Number(salesMap?.[ym]   || 0);
    const payroll = Number(payrollMap?.[ym] || 0);
    const cost    = Number(costMap?.[ym]    || 0);
    const profit  = sales - payroll - cost;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-yellow-50 cursor-pointer';
    tr.innerHTML = `
      <td class="border px-2 py-2 text-center">${ym}</td>
      <td class="border px-2 py-2 text-right font-semibold">${fmt(sales)}</td>
      <td class="border px-2 py-2 text-right font-semibold text-blue-700">${fmt(payroll)}</td>
      <td class="border px-2 py-2 text-right">${fmt(cost)}</td>
      <td class="border px-2 py-2 text-right font-semibold text-green-700">${fmt(profit)}</td>
    `;

    // [핵심] 행 클릭 → 드로어 오픈
    tr.addEventListener('click', () => {
      openSettlementDrawer({
        affiliation: __LAST_AFFILIATION,
        ym,
        sales,
        payroll,
        cost: __LAST_COST_MAP[ym] ?? cost, // 사용자가 바꿨다면 캐시 우선
      });
    });

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

    // 1) 소속 재직자 id
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff_profiles')
      .select('id')
      .eq('affiliation', affiliation)
      .is('leave_date', null);
    if (staffErr) throw staffErr;

    const staffIds = new Set((staffRows || []).map(r => String(r.id)));
    if (staffIds.size === 0) {
      renderMonthlyTable({ titleAffiliation: affiliation, salesMap: {}, payrollMap: {} });
      return;
    }

    // 2) 잔금일 있는 performance (확정/미확정 모두)
    const { data: perfRows, error: perfErr } = await supabase
      .from('performance')
      .select('id, balance_date, status')
      .not('balance_date', 'is', null);
    if (perfErr) throw perfErr;

    if (!perfRows || perfRows.length === 0) {
      renderMonthlyTable({ titleAffiliation: affiliation, salesMap: {}, payrollMap: {} });
      return;
    }

    const perfIdTo = new Map(); // id -> { ym, status }
    const perfIds = [];
    for (const p of perfRows) {
      const ym = ymKey(p.balance_date);
      if (!ym) continue;
      const pid = String(p.id);
      perfIdTo.set(pid, { ym, status: !!p.status });
      perfIds.push(p.id);
    }
    if (perfIds.length === 0) {
      renderMonthlyTable({ titleAffiliation: affiliation, salesMap: {}, payrollMap: {} });
      return;
    }

    // 3) allocations 조회 & 합산
    const BATCH = 800;
    const salesMap   = {}; // 모든 건 합계 (잔금매출)
    const payrollMap = {}; // ✅ 확정 건만 합계 (총 급여)
    const costMap    = {}; // ✅ 총 비용(월별). 지금은 0으로 두고, 추후 불러오기/저장 연동
    for (let i = 0; i < perfIds.length; i += BATCH) {
      const chunk = perfIds.slice(i, i + BATCH);
      const { data: allocRows, error: allocErr } = await supabase
        .from('performance_allocations')
        .select(`
          performance_id,
          staff_id1, involvement_sales1,
          staff_id2, involvement_sales2,
          staff_id3, involvement_sales3,
          staff_id4, involvement_sales4
        `)
        .in('performance_id', chunk);
      if (allocErr) throw allocErr;

      for (const row of (allocRows || [])) {
        const pid = String(row.performance_id);
        const meta = perfIdTo.get(pid);
        if (!meta) continue;
        const { ym, status } = meta;

        for (let k = 1; k <= 4; k++) {
          const sid = row[`staff_id${k}`];
          if (!sid) continue;
          if (!staffIds.has(String(sid))) continue;

          const inv = Number(row[`involvement_sales${k}`] || 0);
          // 잔금매출(모든 건)
          salesMap[ym] = (salesMap[ym] || 0) + inv;

          // 총 급여(확정만) = 관여매출의 50%
          // if (status === true) {
          //   const payroll = Math.round(inv * PAYROLL_RATE);
          //   payrollMap[ym] = (payrollMap[ym] || 0) + payroll;
          // }
          
          // 총 급여(전체) = 관여매출의 50%
          {
            const payroll = Math.round(inv * PAYROLL_RATE);
            payrollMap[ym] = (payrollMap[ym] || 0) + payroll;
          }
        }
      }
    }

    // 전역 캐시 보관 (드로어/후속 클릭에서 사용)
    __LAST_SALES_MAP   = salesMap;
    __LAST_PAYROLL_MAP = payrollMap;
    __LAST_COST_MAP    = { ...costMap, ...__LAST_COST_MAP }; // 사용자가 드로어에서 임시 수정했을 수도 있으니 merge

    renderMonthlyTable({ titleAffiliation: affiliation, salesMap, payrollMap, costMap: __LAST_COST_MAP });
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

function openSettlementDrawer({ affiliation, ym, sales, payroll, cost }) {
  __LAST_COST_MAP[ym] = Number(cost || 0); // 편집 전에 캐시에 동기화

  const drawer = document.getElementById('settlement-drawer');
  const overlay = document.getElementById('settlement-overlay');
  if (!drawer || !overlay) return;

  // 채우기
  const fmtKR = (n) => Number(n || 0).toLocaleString('ko-KR');
  const $id = (i) => document.getElementById(i);

  $id('d_branch').textContent = affiliation ? `(${affiliation})` : '';
  $id('d_period').value   = ym;
  $id('d_sales').value    = fmtKR(sales);
  $id('d_payroll').value  = fmtKR(payroll);
  $id('d_cost').value     = __LAST_COST_MAP[ym] ? fmtKR(__LAST_COST_MAP[ym]) : '0';

  const recompute = () => {
    const rawCost = String($id('d_cost').value || '0').replace(/[^\d.-]/g, '');
    const c = Math.max(Number(rawCost || 0), 0);
    const p = Math.max(Number(payroll || 0), 0);
    const s = Math.max(Number(sales || 0), 0);
    const profit = s - p - c; // 음수 허용
    $id('d_profit').value = fmtKR(profit);
  };

  // 비용 입력 시 즉시 재계산(미저장)
  const costEl = $id('d_cost');
  // 입력을 숫자만 허용 + 천단위 포맷
  const toNumber = (v) => Number(String(v || '0').replace(/[^\d.-]/g, '')) || 0;
  const format = (v) => toNumber(v).toLocaleString('ko-KR');

  costEl.oninput = () => { // 입력 중엔 포맷 없이 계산
    recompute();
  };
  costEl.onblur = () => {  // 포맷 적용 및 캐시 반영
    const c = toNumber(costEl.value);
    __LAST_COST_MAP[ym] = c;
    costEl.value = format(c);
    recompute();
  };

  // 최초 계산
  recompute();

  // 오픈
  overlay.classList.remove('hidden');
  drawer.classList.remove('translate-x-full');
}

function closeSettlementDrawer() {
  const drawer = document.getElementById('settlement-drawer');
  const overlay = document.getElementById('settlement-overlay');
  if (!drawer || !overlay) return;
  drawer.classList.add('translate-x-full');
  overlay.classList.add('hidden');
}

// 닫기 버튼/오버레이 클릭 연결 (초기 1회 바인딩)
document.addEventListener('DOMContentLoaded', () => {
  const c1 = document.getElementById('close-settlement-drawer');
  const c2 = document.getElementById('settlement-drawer-close');
  const ov = document.getElementById('settlement-overlay');
  [c1, c2, ov].forEach(el => el && el.addEventListener('click', closeSettlementDrawer));
});
