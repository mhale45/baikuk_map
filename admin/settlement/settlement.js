// /admin/settlement/settlement.js

import { client as supabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';

const $  = (sel, doc = document) => doc.querySelector(sel);
const $$ = (sel, doc = document) => Array.from(doc.querySelectorAll(sel));
// [ADD] 급여율: 관여매출의 50%
const PAYROLL_RATE = 0.5;
// [ADD] 월별 합계/브레이크다운 캐시(드로어/테이블에서 재사용)
let __LAST_AFFILIATION = null;
// 합계
let __LAST_SALES_MAP = {};
let __LAST_PAYROLL_TOTAL_MAP = {};
let __LAST_COST_MAP = {};
// 직원 목록(이 지점의 재직자) 및 직원별 급여 맵
let __LAST_STAFF_LIST = []; // [{id, name}]
let __LAST_PAYROLL_BY_STAFF = {}; // { 'YYYY-MM': { staffId: amount(급여, 50%적용) } }

// [ADD] 월별 메모 캐시 (미리보기/저장 후 재표시용)
let __LAST_MEMO_MAP = {}; // { 'YYYY-MM': '...' }


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

function renderMonthlyTable({ titleAffiliation, salesMap, payrollByStaff, costMap, staffList }) {
  const titleEl = $('#branch-monthly-title');
  const thead   = $('#monthly-thead');
  const tbody   = $('#branch-monthly-tbody');
  if (titleEl) titleEl.textContent = titleAffiliation ? `지점: ${titleAffiliation}` : '지점을 선택하세요';
  if (!thead || !tbody) return;

  // 키 수집
  const ymSet = new Set([
    ...Object.keys(salesMap || {}),
    ...Object.keys(costMap || {}),
    ...Object.keys(payrollByStaff || {}),
  ]);
  const yms = Array.from(ymSet).sort();

  // 직원 컬럼(이 지점 재직자) 정렬
  const staff = Array.isArray(staffList) ? [...staffList] : [];
  staff.sort((a,b) => String(a.name).localeCompare(String(b.name), 'ko'));

  // === THEAD 동적 구성 ===
  // 기간 / 잔금매출 / (직원별 급여 …) / 총급여 / 총비용 / 순이익
  const headRow = document.createElement('tr');
  headRow.innerHTML = `
    <th class="border px-2 py-2 whitespace-nowrap">기간(YYYY-MM)</th>
    <th class="border px-2 py-2 whitespace-nowrap">잔금매출 합계</th>
    ${staff.map(s => `<th class="border px-2 py-2 whitespace-nowrap">급여-${s.name}</th>`).join('')}
    <th class="border px-2 py-2 whitespace-nowrap">총 급여</th>
    <th class="border px-2 py-2 whitespace-nowrap">총 비용</th>
    <th class="border px-2 py-2 whitespace-nowrap">순이익</th>
  `;
  thead.innerHTML = '';
  thead.appendChild(headRow);

  // === TBODY ===
  tbody.innerHTML = '';
  if (yms.length === 0) {
    tbody.innerHTML = `
      <tr><td class="border px-2 py-3 text-center text-gray-500" colspan="${5 + staff.length}">데이터가 없습니다</td></tr>
    `;
    return;
  }

  for (const ym of yms) {
    const sales = Number(salesMap?.[ym] || 0);
    const cost  = Number(costMap?.[ym] || 0);

    const pmap = payrollByStaff?.[ym] || {}; // {staffId: amount(50%)}
    let payrollTotal = 0;

    const staffCells = staff.map(s => {
      const val = Number(pmap[s.id] || 0);
      payrollTotal += val;
      return `<td class="border px-2 py-2 text-right">${fmt(val)}</td>`;
    }).join('');

    const profit = sales - payrollTotal - cost;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-yellow-50 cursor-pointer';
    tr.innerHTML = `
      <td class="border px-2 py-2 text-center">${ym}</td>
      <td class="border px-2 py-2 text-right font-semibold">${fmt(sales)}</td>
      ${staffCells}
      <td class="border px-2 py-2 text-right font-semibold text-blue-700">${fmt(payrollTotal)}</td>
      <td class="border px-2 py-2 text-right">${fmt(cost)}</td>
      <td class="border px-2 py-2 text-right font-semibold text-green-700">${fmt(profit)}</td>
    `;

    // 행 클릭 → 드로어 오픈 (직원별 브레이크다운 전달)
    tr.addEventListener('click', () => {
      openSettlementDrawer({
        affiliation: __LAST_AFFILIATION,
        ym,
        sales,
        payrollTotal,
        pmap, // 직원별 급여
        cost: __LAST_COST_MAP[ym] ?? cost,
        staffList: staff
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
    __LAST_AFFILIATION = affiliation;

    // 1) 이 지점 재직자(id, name)
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff_profiles')
      .select('id, name')
      .eq('affiliation', affiliation)
      .is('leave_date', null);
    if (staffErr) throw staffErr;

    const staffIds = new Set((staffRows || []).map(r => String(r.id)));
    __LAST_STAFF_LIST = (staffRows || []).map(r => ({ id: String(r.id), name: r.name }));
    if (staffIds.size === 0) {
      __LAST_SALES_MAP = {};
      __LAST_PAYROLL_TOTAL_MAP = {};
      __LAST_PAYROLL_BY_STAFF = {};
      renderMonthlyTable({
        titleAffiliation: affiliation,
        salesMap: {},
        payrollByStaff: {},
        costMap: __LAST_COST_MAP || {},
        staffList: __LAST_STAFF_LIST
      });
      return;
    }

    // 2) 잔금일 있는 performance (확정/미확정 모두)
    const { data: perfRows, error: perfErr } = await supabase
      .from('performance')
      .select('id, balance_date')
      .not('balance_date', 'is', null);
    if (perfErr) throw perfErr;

    if (!perfRows || perfRows.length === 0) {
      __LAST_SALES_MAP = {};
      __LAST_PAYROLL_TOTAL_MAP = {};
      __LAST_PAYROLL_BY_STAFF = {};
      renderMonthlyTable({
        titleAffiliation: affiliation,
        salesMap: {},
        payrollByStaff: {},
        costMap: __LAST_COST_MAP || {},
        staffList: __LAST_STAFF_LIST
      });
      return;
    }

    // perf id → ym
    const perfIdToYM = new Map();
    const perfIds = [];
    for (const p of perfRows) {
      const ym = ymKey(p.balance_date);
      if (!ym) continue;
      perfIdToYM.set(String(p.id), ym);
      perfIds.push(p.id);
    }
    if (perfIds.length === 0) {
      __LAST_SALES_MAP = {};
      __LAST_PAYROLL_TOTAL_MAP = {};
      __LAST_PAYROLL_BY_STAFF = {};
      renderMonthlyTable({
        titleAffiliation: affiliation,
        salesMap: {},
        payrollByStaff: {},
        costMap: __LAST_COST_MAP || {},
        staffList: __LAST_STAFF_LIST
      });
      return;
    }

    // 3) allocations 조회 & 합산(관여매출 50% = 급여)
    const BATCH = 800;
    const salesMap = {};               // 월별 잔금매출(=관여매출 합)
    const payrollByStaff = {};         // { ym: { staffId: 급여(=관여×0.5) } }

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
        const ym = perfIdToYM.get(pid);
        if (!ym) continue;

        for (let k = 1; k <= 4; k++) {
          const sid = row[`staff_id${k}`];
          if (!sid) continue;
          const sidStr = String(sid);
          if (!staffIds.has(sidStr)) continue;

          const inv = Number(row[`involvement_sales${k}`] || 0);
          // 잔금매출(모든 직원의 관여매출 합)
          salesMap[ym] = (salesMap[ym] || 0) + inv;

          // 급여(=관여×50%)를 직원별로 적립
          const pay = Math.round(inv * PAYROLL_RATE);
          (payrollByStaff[ym] ||= {});
          payrollByStaff[ym][sidStr] = (payrollByStaff[ym][sidStr] || 0) + pay;
        }
      }
    }

    // 총 급여 합계도 캐시(드로어 합계 표시용)
    const payrollTotalMap = {};
    for (const [ym, map] of Object.entries(payrollByStaff)) {
      payrollTotalMap[ym] = Object.values(map || {}).reduce((a,b) => a + Number(b||0), 0);
    }

    // 전역 캐시 저장
    __LAST_SALES_MAP = salesMap;
    __LAST_PAYROLL_BY_STAFF = payrollByStaff;
    __LAST_PAYROLL_TOTAL_MAP = payrollTotalMap;
    __LAST_COST_MAP = { ...(__LAST_COST_MAP || {}) }; // 유지

    renderMonthlyTable({
      titleAffiliation: affiliation,
      salesMap,
      payrollByStaff,
      costMap: __LAST_COST_MAP,
      staffList: __LAST_STAFF_LIST
    });
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

function openSettlementDrawer({ affiliation, ym, sales, payrollTotal, pmap, cost, staffList }) {
  __LAST_COST_MAP[ym] = Number(cost || 0); // 캐시 동기화

  const drawer = document.getElementById('settlement-drawer');
  const overlay = document.getElementById('settlement-overlay');
  if (!drawer || !overlay) return;

  const $id = (i) => document.getElementById(i);
  const fmtKR = (n) => Number(n || 0).toLocaleString('ko-KR');

  $id('d_branch').textContent = affiliation ? `(${affiliation})` : '';
  $id('d_period').value  = ym;
  $id('d_sales').value   = fmtKR(sales);
  $id('d_payroll').value = fmtKR(payrollTotal);

  // 직원별 급여 목록 렌더
  const listEl = $id('d_payroll_breakdown');
  if (listEl) {
    const rows = (staffList || []).map(s => {
      const val = Number(pmap?.[s.id] || 0);
      return `
        <div class="flex items-center justify-between px-3 py-1 border-t first:border-t-0">
          <span class="text-sm text-gray-700">${s.name}</span>
          <span class="text-sm font-medium text-right">${fmtKR(val)}</span>
        </div>
      `;
    }).join('');
    listEl.innerHTML = `
      <div class="text-xs text-gray-500 px-3 py-1">직원별 급여(관여매출의 50%)</div>
      ${rows || `<div class="px-3 py-2 text-sm text-gray-500">해당 월 직원 급여 데이터가 없습니다</div>`}
    `;
  }

  // 비용 입력 핸들러/재계산
  const costEl = $id('d_cost');
  costEl.value = __LAST_COST_MAP[ym] ? fmtKR(__LAST_COST_MAP[ym]) : '0';

  const toNumber = (v) => Number(String(v || '0').replace(/[^\d.-]/g, '')) || 0;
  const recompute = () => {
    const c = Math.max(toNumber(costEl.value), 0);
    __LAST_COST_MAP[ym] = c;
    const profit = Number(sales || 0) - Number(payrollTotal || 0) - c;
    $id('d_profit').value = fmtKR(profit);
  };
  costEl.oninput = recompute;
  costEl.onblur  = () => { costEl.value = fmtKR(toNumber(costEl.value)); recompute(); };

  // 메모 표시/동기화
  const memoEl = $id('d_memo');
  if (memoEl) {
    memoEl.value = __LAST_MEMO_MAP[ym] || '';
    memoEl.oninput = () => {
      __LAST_MEMO_MAP[ym] = memoEl.value;
    };
  }

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

// YYYY-MM -> YYYY-MM-01 로 변환
function firstDayOfMonth(ym) {
  // ym: 'YYYY-MM'
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
}

// [REPLACE-ALT] 저장(수동 upsert) - affiliation(지점명)으로 저장
async function saveBranchMonthlyExpense({ affiliation, ym, totalExpense, memo }) {
  const aff = (affiliation || '').trim();
  if (!aff) {
    showToastGreenRed?.('지점명을 확인해주세요.');
    throw new Error('invalid affiliation');
  }

  const period_month = firstDayOfMonth(ym);
  if (!period_month) {
    showToastGreenRed?.('기간(YYYY-MM)을 확인해주세요.');
    throw new Error('invalid period_month');
  }

  const payload = {
    affiliation: aff,                         // ✅ 지점명 컬럼
    period_month,                             // ✅ DATE 'YYYY-MM-01'
    total_expense: Number(totalExpense || 0),
    memo: (memo ?? '').trim(),
  };

  // 존재여부 확인 (컬럼명만 사용, 테이블명 접두사 금지)
  const { data: existing, error: selErr } = await supabase
    .from('branch_settlement_expenses')
    .select('id')
    .eq('affiliation', aff)                   // ✅ FK 대신 지점명으로 매칭
    .eq('period_month', period_month)         // ✅ 날짜 컬럼
    .maybeSingle();

  if (selErr) {
    showToastGreenRed?.('저장 실패(조회 오류)');
    throw selErr;
  }

  if (existing?.id) {
    const { error: updErr } = await supabase
      .from('branch_settlement_expenses')
      .update(payload)
      .eq('id', existing.id);
    if (updErr) {
      showToastGreenRed?.('저장 실패(업데이트 오류)');
      throw updErr;
    }
  } else {
    const { error: insErr } = await supabase
      .from('branch_settlement_expenses')
      .insert(payload);
    if (insErr) {
      showToastGreenRed?.('저장 실패(추가 오류)');
      throw insErr;
    }
  }

  return true;
}

// 닫기 버튼/오버레이 클릭 연결 (초기 1회 바인딩)
document.addEventListener('DOMContentLoaded', () => {
  const c1 = document.getElementById('close-settlement-drawer');
  const c2 = document.getElementById('settlement-drawer-close');
  const ov = document.getElementById('settlement-overlay');
  [c1, c2, ov].forEach(el => el && el.addEventListener('click', closeSettlementDrawer));
});

document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('settlement-drawer-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        const ym   = document.getElementById('d_period')?.value;
        const cost = Number(String(document.getElementById('d_cost')?.value || '0').replace(/[^\d.-]/g, '')) || 0;
        const memo = document.getElementById('d_memo')?.value || '';
        const aff  = (__LAST_AFFILIATION || '').trim();

        if (!ym || !aff) {
          showToastGreenRed?.('기간/지점 정보를 확인해주세요.');
          return;
        }

        await saveBranchMonthlyExpense({
          affiliation: aff,
          ym,
          totalExpense: cost,
          memo,
        });

        // 캐시 반영 및 토스트
        __LAST_COST_MAP[ym] = cost;
        __LAST_MEMO_MAP[ym] = memo;
        showToastGreenRed?.('저장되었습니다.');

        // 저장 후 테이블 즉시 반영(이 달만 다시 계산해서 렌더 호출)
        // 간단하게 전체 렌더를 다시 호출
        renderMonthlyTable({
          titleAffiliation: __LAST_AFFILIATION,
          salesMap: __LAST_SALES_MAP,
          payrollByStaff: __LAST_PAYROLL_BY_STAFF,
          costMap: __LAST_COST_MAP,
          staffList: __LAST_STAFF_LIST,
        });
      } catch (e) {
        console.error(e);
      }
    });
  }
});
