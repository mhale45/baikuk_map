// /admin/settlement/settlement.js

import { client as supabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';
import { formatNumberWithCommas } from '../../modules/core/format.js';

const $ = (sel, doc = document) => doc.querySelector(sel);
const $$ = (sel, doc = document) => Array.from(doc.querySelectorAll(sel));

let __selectedAffiliation = null;

// ============ 날짜/월 유틸 ============
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
function monthToRange(ym) {
  // 'YYYY-MM' -> ['YYYY-MM-01', 'YYYY-MM-31'] (루즈하게 31일까지)
  if (!ym) return [null, null];
  return [`${ym}-01`, `${ym}-31`];
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

// ============ 월별 집계 로딩 ============
// 잔금매출: performance (status=true, affiliation=선택지점, balance_date 기준 월 묶음) → buyer_performance+seller_performance 합
// 급여: staff_settlement_incomes (affiliation=선택지점, period_month 저장은 그 달 1일 권장) → confirmed_income 합
async function loadMonthlySettlement(affiliation, startYM, endYM) {
  if (!affiliation || !startYM || !endYM) return [];
  const [startDate] = monthToRange(startYM);
  const [, endDate] = monthToRange(endYM);

  // 1) performance
  const { data: perf, error: perfErr } = await supabase
    .from('performance')
    .select('balance_date,buyer_performance,seller_performance,affiliation,status')
    .eq('affiliation', affiliation)
    .eq('status', true) // 확정만 집계
    .not('balance_date', 'is', null)
    .gte('balance_date', startDate)
    .lte('balance_date', endDate);

  if (perfErr) console.error(perfErr);

  // 2) staff_settlement_incomes
  const { data: incomes, error: incErr } = await supabase
    .from('staff_settlement_incomes')
    .select('period_month,affiliation,confirmed_income')
    .eq('affiliation', affiliation)
    .gte('period_month', startDate)
    .lte('period_month', endDate);

  if (incErr) console.error(incErr);

  // 3) 그룹핑: ym -> { revenue, salary }
  const map = new Map();
  const ensure = (ym) => {
    if (!map.has(ym)) map.set(ym, { revenue: 0, salary: 0 });
    return map.get(ym);
  };

  (perf || []).forEach(r => {
    const ym = ymFromDateStr(r.balance_date);
    if (!ym) return;
    const buyer = Number(r.buyer_performance || 0);
    const seller = Number(r.seller_performance || 0);
    ensure(ym).revenue += (buyer + seller);
  });

  (incomes || []).forEach(r => {
    const ym = ymFromDateStr(r.period_month); // period_month는 YYYY-MM-01 저장 권장
    if (!ym) return;
    ensure(ym).salary += Number(r.confirmed_income || 0);
  });

  // 결과 배열: 최신월 우선 정렬
  return Array.from(map.entries())
    .map(([ym, v]) => ({ ym, revenue: v.revenue, salary: v.salary }))
    .sort((a, b) => (a.ym < b.ym ? 1 : -1));
}

// ============ 렌더 ============ 
function renderSettlementTable(rows) {
  const tbody = $('#settlement-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  rows.forEach(({ ym, revenue, salary }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-2 py-1">${formatYM_KR(ym)}</td>
      <td class="border px-2 py-1 text-right">${formatNumberWithCommas(Math.round(revenue || 0))}</td>
      <td class="border px-2 py-1 text-right">${formatNumberWithCommas(Math.round(salary || 0))}</td>
    `;
    tbody.appendChild(tr);
  });

  // 합계행
  const totalRev = rows.reduce((s, r) => s + (r.revenue || 0), 0);
  const totalSal = rows.reduce((s, r) => s + (r.salary || 0), 0);
  const trSum = document.createElement('tr');
  trSum.className = 'bg-gray-50 font-semibold';
  trSum.innerHTML = `
    <td class="border px-2 py-1 text-right">합계</td>
    <td class="border px-2 py-1 text-right">${formatNumberWithCommas(Math.round(totalRev))}</td>
    <td class="border px-2 py-1 text-right">${formatNumberWithCommas(Math.round(totalSal))}</td>
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
