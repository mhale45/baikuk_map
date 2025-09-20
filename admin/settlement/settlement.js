// /admin/settlement/settlement.js

import { client as supabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';
import { formatNumberWithCommas } from '../../modules/core/format.js';

const $ = (sel, doc = document) => doc.querySelector(sel);
const $$ = (sel, doc = document) => Array.from(doc.querySelectorAll(sel));

let __selectedAffiliation = null;

// === 선택 지점 소속 직원 ID Set ===
// - staff_profiles에서 affiliation이 지점명과 같은 직원 전원(ID) 조회
async function getStaffIdsForAffiliation(affiliation) {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select('id, affiliation')
    .eq('affiliation', affiliation);

  if (error) {
    console.error('getStaffIdsForAffiliation error:', error);
    return new Set();
  }
  const set = new Set();
  (data || []).forEach(r => { if (r?.id) set.add(String(r.id)); });
  return set;
}

// ============ 날짜/월 유틸 ============
// 'YYYY-MM' -> 'YYYY-MM-01'
function startOfMonth(ym) {
  return `${ym}-01`;
}

// 'YYYY-MM' -> 다음달 1일 (exclusive upper bound)
function nextMonthStart(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  let y = Number(m[1]);
  let mon = Number(m[2]); // 1~12
  mon += 1;
  if (mon === 13) { y += 1; mon = 1; }
  return `${y}-${String(mon).padStart(2, '0')}-01`;
}
function ymFromDateStr(dateStr) {
  // 'YYYY-MM-DD' -> 'YYYY-MM'
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  return m ? `${m[1]}-${m[2]}` : null;
}
function ymValidate(monthStr) {
  // input[type=month] -> 'YYYY-MM' or null
  if (!monthStr) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(monthStr);
  return m ? monthStr : null;
}
function formatYM(ym) {
  return ym || '';
}
function formatYM_KR(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${y}년 ${Number(m)}월`;
}
function ensureDefaultMonths() {
  const sEl = $('#settle-start-month');
  const eEl = $('#settle-end-month');
  if (!sEl || !eEl) return;
  const today = new Date();
  const toYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const from = new Date(today.getFullYear(), today.getMonth() - 5, 1); // 최근 6개월
  const fromYM = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
  if (!sEl.value) sEl.value = fromYM;
  if (!eEl.value) eEl.value = toYM;
}

// ============ 지점 리스트 렌더 ============
async function renderBranchList() {
  try {
    const { data: branches, error } = await supabase
      .from('branch_info')
      .select('affiliation')
      .order('affiliation', { ascending: true });

    if (error) throw error;

    const container = $('#branch-list');
    if (!container) return;

    container.innerHTML = '';
    const seen = new Set();

    for (const row of (branches || [])) {
      const aff = row?.affiliation?.trim();
      if (!aff || seen.has(aff)) continue;
      seen.add(aff);

      const div = document.createElement('div');
      div.className = 'px-3 py-2 text-sm font-medium hover:bg-yellow-100 cursor-pointer name-item';
      div.textContent = aff;
      div.dataset.affiliation = aff;

      div.addEventListener('click', () => {
        // 좌측 하이라이트
        $$('#branch-list > div').forEach(el => el.classList.remove('bg-yellow-200'));
        div.classList.add('bg-yellow-200');

        __selectedAffiliation = aff;
        const lab = $('#settle-branch-label');
        if (lab) lab.textContent = `지점: ${aff}`;

        ensureDefaultMonths();
        applySettlementFilter();
      });

      container.appendChild(div);
    }
  } catch (e) {
    console.error('지점 목록 로딩 실패:', e);
    showToastGreenRed('지점 목록 로딩 실패');
  }
}

// ============ 월별 집계 (요건 반영 버전) ============
// 규칙 요약:
// 1) 선택 지점의 소속 직원(staff_profiles.affiliation == 지점) ID들을 구함
// 2) 기간 내(balance_date 기준)의 performance 목록 ID/날짜를 구함
// 3) 그 ID들에 대한 performance_allocations를 가져와서
//    각 row의 slot(1~4) 중 staff_idN이 '선택 지점 소속 직원'이면 involvement_salesN을 해당 월(잔금월)에 더함
// 4) staff_settlement_incomes는 같은 기간/지점의 confirmed_income을 월별 합산
// 5) 최종적으로 '잔금매출 > 0'인 월만 행으로 반환
async function loadMonthlySettlement(affiliation, startYM, endYM) {
  if (!affiliation || !startYM || !endYM) return [];

  const startDate = startOfMonth(startYM);
  const endExcl   = nextMonthStart(endYM);

  // 0) 지점 소속 직원 ID set
  const staffIdSet = await getStaffIdsForAffiliation(affiliation);
  if (!staffIdSet.size) {
    // 소속 직원이 아예 없다면 급여만 있을 수 있으므로 이후 급여만 집계
    console.warn('해당 지점 소속 직원이 없습니다:', affiliation);
  }

  // 1) 기간 내 performance (잔금월 판단용)
  const { data: perf, error: perfErr } = await supabase
    .from('performance')
    .select('id, balance_date, affiliation')
    .eq('affiliation', affiliation)
    .not('balance_date', 'is', null)
    .gte('balance_date', startDate)
    .lt('balance_date', endExcl);
    // .eq('status', true)  // 확정 건만 집계하려면 주석 해제

  if (perfErr) {
    console.error('performance query error:', perfErr);
    return [];
  }

  const perfIds = (perf || []).map(r => r.id).filter(Boolean);
  if (perfIds.length === 0) {
    // 매출 0 → 그래도 급여는 표시할 수 있으나, 요구사항 상 "잔금매출이 있는 월만"이므로 빈 배열
    // 만약 급여도 함께 보이길 원하면 아래에서 incomes만으로도 rows를 만들도록 분기 추가 가능
    // (지금은 명시대로 revenue>0 월만 표시)
  }

  // 잔금월 lookup: performance_id -> 'YYYY-MM'
  const perfYmById = new Map();
  (perf || []).forEach(r => {
    const ym = ymFromDateStr(r.balance_date);
    if (r?.id && ym) perfYmById.set(String(r.id), ym);
  });

  // 2) performance_allocations: 해당 거래들만
  let allocations = [];
  if (perfIds.length > 0) {
    const { data: allocs, error: allocErr } = await supabase
      .from('performance_allocations')
      .select(`
        performance_id,
        staff_id1, staff_id2, staff_id3, staff_id4,
        involvement_sales1, involvement_sales2, involvement_sales3, involvement_sales4
      `)
      .in('performance_id', perfIds);

    if (allocErr) {
      console.error('performance_allocations query error:', allocErr);
    } else {
      allocations = allocs || [];
    }
  }

  // 3) 월별 집계: 잔금매출(revenue)
  const map = new Map(); // ym -> { revenue, salary }
  const ensure = (ym) => {
    if (!map.has(ym)) map.set(ym, { revenue: 0, salary: 0 });
    return map.get(ym);
  };

  for (const row of allocations) {
    const pid = String(row.performance_id);
    const ym  = perfYmById.get(pid);
    if (!ym) continue;

    // slot 1~4 검사 → staff_idN이 선택 지점 소속이면 involvement_salesN 더함
    for (let i = 1; i <= 4; i++) {
      const sid = row[`staff_id${i}`];
      if (!sid) continue;
      if (!staffIdSet.has(String(sid))) continue;

      const inv = Number(row[`involvement_sales${i}`] || 0);
      if (inv > 0) ensure(ym).revenue += inv;
    }
  }

  // 4) 급여(salary): 같은 기간/지점
  const { data: incomes, error: incErr } = await supabase
    .from('staff_settlement_incomes')
    .select('period_month, affiliation, confirmed_income')
    .eq('affiliation', affiliation)
    .gte('period_month', startDate)
    .lt('period_month', endExcl);

  if (incErr) {
    console.error('staff_settlement_incomes query error:', incErr);
  } else {
    (incomes || []).forEach(r => {
      const ym = ymFromDateStr(r.period_month); // 'YYYY-MM-01' 저장 권장
      if (!ym) return;
      ensure(ym).salary += Number(r.confirmed_income || 0);
    });
  }

  // 5) 결과: "잔금매출 > 0" 월만 남기고 최신월 우선 정렬
  const rows = Array.from(map.entries())
    .map(([ym, v]) => ({ ym, revenue: v.revenue || 0, salary: v.salary || 0 }))
    .filter(r => r.revenue > 0)
    .sort((a, b) => (a.ym < b.ym ? 1 : -1));

  return rows;
}

function renderSettlementTable(rows) {
  const tbody = document.querySelector('#settlement-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // "잔금매출 > 0"인 월만 표시
  const list = (rows || []).filter(r => (r?.revenue || 0) > 0);

  list.forEach(({ ym, revenue, salary }) => {
    const salaryCell = (salary && salary > 0)
      ? formatNumberWithCommas(Math.round(salary))
      : ''; // 0이면 빈칸

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-2 py-1">${formatYM(ym)}</td>
      <td class="border px-2 py-1 text-right">${formatNumberWithCommas(Math.round(revenue))}</td>
      <td class="border px-2 py-1 text-right">${salaryCell}</td>
    `;
    tbody.appendChild(tr);
  });

  // 합계행(표시된 행 기준)
  const totalRev = list.reduce((s, r) => s + (r.revenue || 0), 0);
  const totalSal = list.reduce((s, r) => s + (r.salary || 0), 0);
  const trSum = document.createElement('tr');
  trSum.className = 'bg-gray-50 font-semibold';
  trSum.innerHTML = `
    <td class="border px-2 py-1 text-right">합계</td>
    <td class="border px-2 py-1 text-right">${formatNumberWithCommas(Math.round(totalRev))}</td>
    <td class="border px-2 py-1 text-right">${totalSal ? formatNumberWithCommas(Math.round(totalSal)) : ''}</td>
  `;
  tbody.appendChild(trSum);
}

// ============ 필터 적용 ============
async function applySettlementFilter() {
  const sYM = ymValidate($('#settle-start-month')?.value);
  const eYM = ymValidate($('#settle-end-month')?.value);
  if (!__selectedAffiliation || !sYM || !eYM) {
    renderSettlementTable([]);
    return;
  }
  const rows = await loadMonthlySettlement(__selectedAffiliation, sYM, eYM);
  renderSettlementTable(rows);
}

// ============ 초기화 ============
export async function initSettlement() {
  await renderBranchList();
  ensureDefaultMonths();
  $('#settle-apply')?.addEventListener('click', applySettlementFilter);

  // UX: 첫 지점을 자동선택하려면 아래 주석 해제
  // const first = $('#branch-list .name-item');
  // if (first) first.click();
}
