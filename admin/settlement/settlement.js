// /admin/settlement/settlement.js

import { client as supabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';

const $  = (sel, doc = document) => doc.querySelector(sel);
const $$ = (sel, doc = document) => Array.from(doc.querySelectorAll(sel));
// [ADD] 급여율: 관여매출의 50%
const PAYROLL_RATE = 0.5;

// [ADD] 총 비용 안내 항목(원하는 만큼 추가/수정)
const COST_INCLUDE_HINTS  = [
  '월세, 관리비, 공과금',
  '네이버 광고, 현수막, 명함, 봉투',
  '식대(만원), 사무용품',
  '통신비, 정수기, 프린터, 주차비',
  '직원들 대목 선물',
];

const COST_EXCLUDE_HINTS = [
  '회식비, 교통비, 경조사비',
];

// [ADD] 월별 합계/브레이크다운 캐시(드로어/테이블에서 재사용)
let __LAST_AFFILIATION = null;
// 합계
let __LAST_SALES_MAP = {};
let __LAST_PAYROLL_TOTAL_MAP = {};
let __LAST_COST_MAP = {};
// [ADD] 월별 부가세 합계 캐시
let __LAST_VAT_MAP = {}; // { 'YYYY-MM': number }


// 직원 목록(이 지점의 재직자) 및 직원별 급여 맵
let __LAST_STAFF_LIST = []; // [{id, name}]
let __LAST_PAYROLL_BY_STAFF = {}; // { 'YYYY-MM': { staffId: amount(급여, 50%적용) } }

// [ADD] 월별 메모 캐시 (미리보기/저장 후 재표시용)
let __LAST_MEMO_MAP = {}; // { 'YYYY-MM': '...' }

// [ADD] 로그인 사용자의 권한/소속 지점
let __MY_ROLE = '직원';         // '직원' | '지점장' | '관리자'
let __MY_AFFILIATION = null;    // 지점장/직원일 때 본인 지점명

// ===== Expense 업로더 설정 =====
const EXPENSE_BUCKET = 'expense';
const EXP_ALLOWED_EXT = ['.xlsx', '.xls', '.csv'];
const EXP_MAX_MB = 20;

let __LAST_AFFILIATION_EN = null;   // [ADD] 현재 선택 지점의 영문명
let __CURRENT_DRAWER_YM = null;      // [ADD] 드로어에 열린 YYYY-MM

// [ADD] 현재 선택 지점의 자율금 비율(0.0 ~ 1.0)
let __LAST_AUTONOMOUS_RATE = 0;

// 확정 상태 캐시: { 'YYYY-MM': true }
let __LAST_CONFIRMED_MAP = {};

// 문자열(₩,콤마 포함) → 숫자
function toNumberKR(v) {
  return Number(String(v ?? '0').replace(/[^\d.-]/g, '')) || 0;
}

function expValidate(file) {
  const name = String(file?.name || '').toLowerCase();
  const okExt = EXP_ALLOWED_EXT.some(ext => name.endsWith(ext));
  const okSize = (file?.size || 0) <= EXP_MAX_MB * 1024 * 1024;
  return okExt && okSize;
}

// 'YYYY-MM' → {yyyy, mm}
function ymToParts(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  return m ? { yyyy: m[1], mm: m[2] } : null;
}

// 저장 경로: [영문지점]/YYYY/MM/DD/timestamp_파일명
function makeExpensePath(fileName, affiliationEn, ym) {
  const parts = ymToParts(ym);
  if (!parts) throw new Error('invalid ym');
  const aff = String(affiliationEn || '').trim() || 'Unknown';
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const sanitized = String(fileName || '').replace(/[^\w.\-()가-힣\[\]\s]/g, '_');
  return `${aff}/${parts.yyyy}/${parts.mm}/${dd}/${Date.now()}_${sanitized}`;
}

// 목록 prefix: [영문지점]/YYYY/MM
function makeMonthPrefix(affiliationEn, ym) {
  const parts = ymToParts(ym);
  if (!parts) throw new Error('invalid ym');
  const aff = String(affiliationEn || '').trim() || 'Unknown';
  return `${aff}/${parts.yyyy}/${parts.mm}`;
}

function expShowProgress(percent, label) {
  const box = document.getElementById('expUploadProgress');
  const bar = document.getElementById('expUploadBar');
  const lab = document.getElementById('expUploadLabel');
  if (!box || !bar || !lab) return;
  box.classList.remove('hidden');
  bar.style.width = `${percent}%`;
  lab.textContent = label || '';
}

function expAppendResult({ name, url, path, error }) {
  const box = document.getElementById('expUploadList');
  const ul = document.getElementById('expUploadItems');
  if (!box || !ul) return;
  box.classList.remove('hidden');

  const li = document.createElement('li');
  li.className = "flex items-center justify-between border rounded-lg px-3 py-2 bg-white";
  li.innerHTML = `
    <div class="truncate">
      ${error ? `❌ <b>${name}</b> · <span class="text-red-500">${error}</span>`
              : `✅ <b>${name}</b> · <code class="text-slate-500">${path || ''}</code>`}
    </div>
    <div>${url ? `<a href="${url}" target="_blank" rel="noopener" class="text-blue-600 underline">열기</a>` : ''}</div>
  `;
  ul.appendChild(li);
}

// [REPLACE] 저장된 파일 목록 불러오기(+일자 폴더까지 내려가서 파일 수집)
async function loadExpenseFileList(affiliationEn, ym) {
  try {
    const ul = document.getElementById('expFileList');
    const empty = document.getElementById('expFileEmpty');
    if (!ul || !empty) return;

    ul.innerHTML = '';
    empty.classList.add('hidden');

    const monthPrefix = makeMonthPrefix(affiliationEn, ym); // ex) Mokdong/2025/09

    // 1) 월 폴더 1레벨 목록
    const { data: monthEntries, error: monthErr } = await supabase
      .storage.from(EXPENSE_BUCKET)
      .list(monthPrefix, { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
    if (monthErr) throw monthErr;

    // helper: 파일 렌더
    const renderFile = async (fullPath, name, size) => {
      let signedUrl = null;
      try {
        const { data: sig, error: sigErr } = await supabase
          .storage.from(EXPENSE_BUCKET)
          .createSignedUrl(fullPath, 60 * 60); // 1시간
        if (!sigErr) signedUrl = sig?.signedUrl || null;
      } catch (_) {}

      const li = document.createElement('li');
      li.className = 'flex items-center justify-between border rounded-lg px-3 py-2 bg-white';
      li.innerHTML = `
        <div class="truncate">
          📄 <b class="truncate">${name}</b>
          ${typeof size === 'number' ? `<span class="ml-2 text-xs text-slate-400">${size.toLocaleString()} B</span>` : ''}
        </div>
        <div>${signedUrl ? `<a href="${signedUrl}" target="_blank" rel="noopener" class="text-blue-600 underline">열기</a>` : ''}</div>
      `;
      ul.appendChild(li);
    };

    // 2) 월 폴더에 파일이 직접 있을 수도 있으니 먼저 그 파일들 렌더
    for (const e of (monthEntries || [])) {
      // 파일이면 metadata가 있음, 폴더면 metadata가 null
      if (e?.name && e?.metadata && e.name !== '.keep') {
        const fullPath = `${monthPrefix}/${e.name}`;
        await renderFile(fullPath, e.name, e.metadata.size ?? null);
      }
    }

    // 3) 월 폴더 아래 하위 폴더(=일자: 01~31)를 다시 list 해서 파일 렌더
    for (const e of (monthEntries || [])) {
      if (!e?.name || e?.metadata) continue; // metadata가 없으면 폴더
      const dayPrefix = `${monthPrefix}/${e.name}`; // ex) Mokdong/2025/09/21
      const { data: dayEntries, error: dayErr } = await supabase
        .storage.from(EXPENSE_BUCKET)
        .list(dayPrefix, { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
      if (dayErr) continue;

      for (const f of (dayEntries || [])) {
        if (!f?.name || f.name === '.keep') continue;
        const fullPath = `${dayPrefix}/${f.name}`;
        await renderFile(fullPath, `${e.name}/${f.name}`, f?.metadata?.size ?? null); // 표시: "21/파일명"
      }
    }

    // 4) 아무것도 없으면 빈 메시지
    if (!ul.children.length) {
      empty.textContent = '아직 업로드된 파일이 없습니다.';
      empty.classList.remove('hidden');
    }
  } catch (e) {
    console.warn('[expense] list load failed:', e?.message || e);
    const empty = document.getElementById('expFileEmpty');
    if (empty) { empty.textContent = '파일 목록을 불러오지 못했습니다.'; empty.classList.remove('hidden'); }
  }
}

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

// 기존 renderMonthlyTable 전체 삭제 후 아래로 교체
function renderMonthlyTable({ titleAffiliation, salesMap, payrollByStaff, costMap, staffList }) {
  const titleEl = $('#branch-monthly-title');
  const thead   = $('#monthly-thead');
  const tbody   = $('#branch-monthly-tbody');
  if (titleEl) titleEl.textContent = titleAffiliation ? `지점: ${titleAffiliation}` : '지점을 선택하세요';
  if (!thead || !tbody) return;

  // 사용되는 월 키 수집
  const ymSet = new Set([
    ...Object.keys(salesMap || {}),
    ...Object.keys(costMap || {}),
    ...Object.keys(payrollByStaff || {}),
    ...Object.keys(__LAST_VAT_MAP || {}),
  ]);
  const yms = Array.from(ymSet).sort();

  // === THEAD: 직원별 급여 열 제거 + '부가세' 열 추가 ===
  // 기간 / 잔금매출 합계 / 총 급여 / 부가세 / 총 비용 / 지점자율금 / 최종 순이익
  const headRow = document.createElement('tr');
  headRow.innerHTML = `
    <th class="border px-2 py-2 whitespace-nowrap">기간(YYYY-MM)</th>
    <th class="border px-2 py-2 whitespace-nowrap">잔금매출 합계</th>
    <th class="border px-2 py-2 whitespace-nowrap">총 급여</th>
    <th class="border px-2 py-2 whitespace-nowrap">부가세</th>
    <th class="border px-2 py-2 whitespace-nowrap">총 비용</th>
    <th class="border px-2 py-2 whitespace-nowrap">지점자율금</th>
    <th class="border px-2 py-2 whitespace-nowrap">최종 순이익</th>
  `;
  thead.innerHTML = '';
  thead.appendChild(headRow);

  // === TBODY ===
  tbody.innerHTML = '';
  if (yms.length === 0) {
    // 열 개수: 7
    tbody.innerHTML = `
      <tr><td class="border px-2 py-3 text-center text-gray-500" colspan="7">데이터가 없습니다</td></tr>
    `;
    return;
  }

  for (const ym of yms) {
    const sales = Number(salesMap?.[ym] || 0);
    const cost = Number(__LAST_COST_MAP?.[ym] ?? costMap?.[ym] ?? 0);

    // 총 급여는 기존 로직 유지
    const pmap = payrollByStaff?.[ym] || {};
    const payrollTotal = Object.values(pmap).reduce((a, b) => a + Number(b || 0), 0);

    // 부가세(월별 합계)
    const vat = Number(__LAST_VAT_MAP?.[ym] || 0);

    // [CHANGE] 드로어와 동일한 계산 적용
    const vatVal = Number(__LAST_VAT_MAP?.[ym] || 0); // 부가세도 반영
    const profitBefore = sales - payrollTotal - cost - vatVal;

    const ar = Number(__LAST_AUTONOMOUS_RATE || 0);
    const autonomousFee = Math.round(profitBefore * ar);

    const finalProfit = profitBefore - autonomousFee;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-yellow-50 cursor-pointer';
    tr.innerHTML = `
      <td class="border px-2 py-2 text-center">${ym}</td>
      <td class="border px-2 py-2 text-right font-semibold">${fmt(sales)}</td>
      <td class="border px-2 py-2 text-right font-semibold text-blue-700">${fmt(payrollTotal)}</td>
      <td class="border px-2 py-2 text-right">${fmt(vat)}</td>
      <td class="border px-2 py-2 text-right">${fmt(cost)}</td>
      <td class="border px-2 py-2 text-right text-purple-700">${fmt(autonomousFee)}</td>
      <td class="border px-2 py-2 text-right font-semibold text-green-700">${fmt(finalProfit)}</td>
    `;

    // 행 클릭 → 드로어 오픈 (드로어에서는 직원별 브레이크다운 계속 표시)
    tr.addEventListener('click', () => {
      openSettlementDrawer({
        affiliation: __LAST_AFFILIATION,
        ym,
        sales,
        payrollTotal,
        pmap, // 드로어에서 사용
        cost: __LAST_COST_MAP[ym] ?? cost,
        staffList: __LAST_STAFF_LIST
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

    // [ADD] 권한 가드
    if (__MY_ROLE === '직원') {
      showToastGreenRed?.('권한이 없습니다.');
      return;
    }
    if (__MY_ROLE === '지점장' && affiliation !== __MY_AFFILIATION) {
      showToastGreenRed?.('본인 지점만 조회할 수 있습니다.');
      return;
    }

    __LAST_AFFILIATION = affiliation;

    // 1) 이 지점 재직자(id, name)
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff_profiles')
      .select('id, name')
      .eq('affiliation', affiliation)
      .is('leave_date', null);

    await loadBranchExpenseCache(affiliation); // ← [ADD] 월별 총비용 캐시 선로딩

    if (staffErr) throw staffErr;

    // [ADD] 영문 지점명 로드
    try {
      const { data: bi, error: biErr } = await supabase
        .from('branch_info')
        .select('affiliation, affiliation_en, autonomous-rate')
        .eq('affiliation', affiliation)
        .maybeSingle();
      if (biErr) throw biErr;
      __LAST_AFFILIATION_EN = (bi?.affiliation_en || '').trim() || null;
      // [ADD] 자율금 비율 캐시 (컬럼명이 하이픈이라 bracket-access)
      __LAST_AUTONOMOUS_RATE = Number(bi?.['autonomous-rate'] ?? 0) || 0;
    } catch (e) {
      console.warn('affiliation_en 조회 실패:', e?.message || e);
      __LAST_AFFILIATION_EN = null;
    }

    const staffIds = new Set((staffRows || []).map(r => String(r.id)));
    __LAST_STAFF_LIST = (staffRows || []).map(r => ({ id: String(r.id), name: r.name }));
    const hasStaff = staffIds.size > 0; // ✅ 직원이 없어도 VAT/비용은 보여야 하므로 계속 진행

    // 2) 잔금일 있는 performance (status=true인 확정된 매출만)
    const { data: perfRows, error: perfErr } = await supabase
      .from('performance')
      .select('id, balance_date, buyer_tax, seller_tax')
      // .eq('status', true)              // ✅ 확정된 매출만
      .not('balance_date', 'is', null);

    if (perfErr) throw perfErr;

    if (!perfRows || perfRows.length === 0) {
      __LAST_SALES_MAP = {};
      __LAST_PAYROLL_TOTAL_MAP = {};
      __LAST_PAYROLL_BY_STAFF = {};
      __LAST_VAT_MAP = {};
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
    const vatMap = {}; 

    for (const p of perfRows) {
      const ym = ymKey(p.balance_date);
      if (!ym) continue;

      perfIdToYM.set(String(p.id), ym);
      perfIds.push(p.id);

      // 부가세 = (buyer_tax + seller_tax) / 1.1 * 0.1
      const bt = Number(p.buyer_tax || 0);
      const st = Number(p.seller_tax || 0);
      const vat = Math.round(((bt + st) / 1.1) * 0.1);
      vatMap[ym] = (vatMap[ym] || 0) + vat;
    }
    if (perfIds.length === 0) {
      __LAST_SALES_MAP = {};
      __LAST_PAYROLL_TOTAL_MAP = {};
      __LAST_PAYROLL_BY_STAFF = {};
      __LAST_VAT_MAP = vatMap; // ✅ 이 달의 부가세 합계(없으면 0 맵)

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

          if (hasStaff) {
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
    __LAST_VAT_MAP = vatMap; // ✅ 부가세 캐시 저장 (누락되었던 부분)

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

// === 지점 리스트 렌더 (권한 적용) ===
async function renderBranchList() {
  try {
    // 내 권한/지점이 준비되어 있지 않다면 보장
    if (!__MY_ROLE) await resolveMyAuthority();

    const { data: branches, error } = await supabase
      .from('branch_info')
      .select('affiliation')
      .order('affiliation', { ascending: true });
    if (error) throw error;

    const container = $('#branch-list');
    if (!container) return;

    container.innerHTML = '';

    for (const branch of (branches || [])) {
      const aff = branch.affiliation;
      if (!aff) continue;

      // 권한별 클릭 가능 여부
      const canClick =
        (__MY_ROLE === '관리자') ||
        (__MY_ROLE === '지점장' && __MY_AFFILIATION === aff);

      const div = document.createElement('div');
      div.textContent = aff;
      div.dataset.affiliation = aff;
      div.className = [
        'px-3 py-2 text-sm font-medium',
        canClick ? 'hover:bg-yellow-100 cursor-pointer'
                 : 'opacity-50 cursor-not-allowed pointer-events-none'
      ].join(' ');

      if (canClick) {
        div.addEventListener('click', () => {
          // 선택 스타일 초기화
          $$('#branch-list > div').forEach(el => el.classList.remove('bg-yellow-200'));
          div.classList.add('bg-yellow-200');

          // 월별 합계 로딩
          loadBranchMonthlySales(aff);
        });
      }

      container.appendChild(div);
    }

    // 지점장이라면 본인 지점을 자동 선택해서 로딩(선택 표시 포함)
    if (__MY_ROLE === '지점장' && __MY_AFFILIATION) {
      const myEl = $(`#branch-list > div[data-affiliation="${CSS.escape(__MY_AFFILIATION)}"]`);
      if (myEl) {
        myEl.classList.add('bg-yellow-200');
        loadBranchMonthlySales(__MY_AFFILIATION);
      }
    }
  } catch (e) {
    console.error('지점 목록 로딩 실패:', e);
    showToastGreenRed?.('지점 목록 로딩 실패');
  }
}

// === 초기화 ===
export async function initSettlement() {
  await resolveMyAuthority();  // [ADD] 권한/소속 로드
  await renderBranchList();    // [CHANGE] 권한 반영하여 렌더
  // 지점장일 경우 본인 지점이 자동 선택/로딩됨 (renderBranchList에서 처리)
}

function openSettlementDrawer({ affiliation, ym, sales, payrollTotal, pmap, cost, staffList }) {
  __LAST_COST_MAP[ym] = Number(cost || 0); // 캐시 동기화
  __CURRENT_DRAWER_YM = ym; // [ADD] 현재 드로어의 YYYY-MM

  const drawer = document.getElementById('settlement-drawer');
  const overlay = document.getElementById('settlement-overlay');
  if (!drawer || !overlay) return;

  const $id = (i) => document.getElementById(i);
  const fmtKR = (n) => Number(n || 0).toLocaleString('ko-KR');

  $id('d_branch').textContent = affiliation ? `(${affiliation})` : '';
  $id('d_period').value  = ym;
  $id('d_sales').value   = fmtKR(sales);
  $id('d_payroll').value = fmtKR(payrollTotal);
  // [ADD] 부가세 표시: __LAST_VAT_MAP[ym] 사용
  const vatVal = Number(__LAST_VAT_MAP?.[ym] || 0);
  const vatEl = $id('d_vat');
  if (vatEl) vatEl.value = fmtKR(vatVal);

  // 직원별 급여 목록 렌더
  const listEl = $id('d_payroll_breakdown');
  if (listEl) {
    const rows = (staffList || []).map(s => {
      const val = Number(pmap?.[s.id] || 0); // 급여
      const deposit = Math.round(val * 0.967); // 입금액
      return `
        <div class="flex items-center justify-between px-3 py-1 border-t first:border-t-0">
          <span class="text-sm text-gray-700">${s.name}</span>
          <span class="text-sm text-blue-700 font-medium text-right"> ${fmtKR(deposit)} </span>
          <span class="text-sm ml-1">${fmtKR(val)}</span>
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
  // [ADD] 자율금/비율 표시 요소(없으면 null)
  const autoRateEl = $id('d_autonomous_rate'); // e.g. "20%" 같은 텍스트 노출 용도
  const autoFeeEl  = $id('d_autonomous_fee');  // 금액 입력/출력(readonly 권장)
  const autoAmtEl  = $id('d_autonomous_amount'); // ← 이 인풋에도 동일 값 표시

  costEl.value = __LAST_COST_MAP[ym] ? fmtKR(__LAST_COST_MAP[ym]) : '0';

  const toNumber = (v) => Number(String(v || '0').replace(/[^\d.-]/g, '')) || 0;
  const recompute = () => {
    const c = Math.max(toNumber(costEl.value), 0);
    __LAST_COST_MAP[ym] = c;

    const vatVal = Number(__LAST_VAT_MAP?.[ym] || 0);
    const profitBefore = Number(sales || 0) - Number(payrollTotal || 0) - c - vatVal;
    const ar = Number(__LAST_AUTONOMOUS_RATE || 0);
    const aFee = Math.round(profitBefore * ar);
    const finalProfit = profitBefore - aFee;

    if (autoRateEl) autoRateEl.textContent = `${Math.round(ar * 100)}%`;
    if (autoFeeEl)  autoFeeEl.value = fmtKR(aFee);
    if (autoAmtEl)  autoAmtEl.value = fmtKR(aFee);

    $id('d_profit').value = fmtKR(finalProfit);
  };

  costEl.oninput = recompute;
  costEl.onblur  = () => { costEl.value = fmtKR(toNumber(costEl.value)); recompute(); };

  // 메모 표시/동기화 + 자동 높이
  const memoEl = $id('d_memo');
  if (memoEl) {
    const autoGrow = (el) => {
      // 내용 길이에 맞춰 높이 자동 조절
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };

    memoEl.value = __LAST_MEMO_MAP[ym] || '';
    autoGrow(memoEl); // 초기 표시 시 높이 맞춤

    memoEl.addEventListener('input', () => {
      __LAST_MEMO_MAP[ym] = memoEl.value;
      autoGrow(memoEl); // 입력할 때마다 높이 재조정
    });
  }

  // [ADD] 초기 비율/자율금 표시
  const ar = Number(__LAST_AUTONOMOUS_RATE || 0);
  if ($id('d_autonomous_rate')) $id('d_autonomous_rate').textContent = `${Math.round(ar * 100)}%`;
  if ($id('d_autonomous_fee'))  $id('d_autonomous_fee').value = '0';
  if ($id('d_autonomous_amount')) $id('d_autonomous_amount').value = '0';

  // 최초 계산
  recompute();

  renderCostHints();

  // 오픈
  overlay.classList.remove('hidden');
  drawer.classList.remove('translate-x-full');

  // 권한에 따라 확정 버튼 표시/숨김
  const confirmBtn = document.getElementById('settlement-confirm-btn');
  if (confirmBtn) {
    if (!['지점장','관리자'].includes(__MY_ROLE)) {
      confirmBtn.classList.add('hidden');
    } else {
      confirmBtn.classList.remove('hidden');
    }
  }

  // DB에서 확정/저장 값 반영 후 UI 잠금 적용
  fetchAndApplySettlementState(affiliation, ym);


  // [ADD] 업로더 이벤트 바인딩(1회)
  (function wireExpenseUploaderOnce() {
    const pick = document.getElementById('expFilePickBtn');
    const input = document.getElementById('expFileInput');
    const drop = document.getElementById('expDropZone');
    if (!pick || !input || !drop) return;
    if (pick.dataset.wired === '1') return;
    pick.dataset.wired = '1';

    pick.addEventListener('click', () => input.click());
    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length) await handleExpenseFiles(files);
      e.target.value = '';
    });

    ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      drop.classList.add('bg-indigo-50', 'border-indigo-400');
    }));
    ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      drop.classList.remove('bg-indigo-50', 'border-indigo-400');
    }));
    drop.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) await handleExpenseFiles(files);
    });
  })();
    
  // [ADD] 드로어 열릴 때, 해당 달 저장된 파일 목록 로딩
  if (__LAST_AFFILIATION_EN) {
    loadExpenseFileList(__LAST_AFFILIATION_EN, ym);
  } else if (__LAST_AFFILIATION) {
    // affiliation_en이 없으면 한글명으로 폴백(폴더도 한글로 만든 경우 대비)
    loadExpenseFileList(__LAST_AFFILIATION, ym);
  }
}

async function handleExpenseFiles(files) {
  try {
    const ym = __CURRENT_DRAWER_YM;
    if (!ym) throw new Error('기간(YYYY-MM)이 없습니다.');
    if (!__LAST_AFFILIATION_EN && !__LAST_AFFILIATION) {
      throw new Error('지점 정보를 확인할 수 없습니다.');
    }

    const valid = files.filter(expValidate);
    if (!valid.length) {
      showToastGreenRed?.('허용되지 않는 형식/크기의 파일입니다.');
      return;
    }

    expShowProgress(0, '업로드 시작…');
    for (let i=0; i<valid.length; i++) {
      const f = valid[i];
      try {
        const { path, signedUrl } = await uploadExpenseFile(f, ym, (ratio) => {
          const overall = Math.round(((i + ratio) / valid.length) * 100);
          expShowProgress(overall, `업로드 중… (${overall}%)`);
        });
        expAppendResult({ name: f.name, url: signedUrl, path });
      } catch (err) {
        console.error('[expense] upload failed:', err);
        expAppendResult({ name: f.name, error: err?.message || '업로드 실패' });
      }
    }
    expShowProgress(100, '완료');
  } catch (e) {
    showToastGreenRed?.(e?.message || '업로드 준비 실패');
  }

  // 업로드 후 목록 다시 불러오기
  const affEn = (__LAST_AFFILIATION_EN || __LAST_AFFILIATION);
  if (affEn && __CURRENT_DRAWER_YM) {
    loadExpenseFileList(affEn, __CURRENT_DRAWER_YM);
  }
}

// [REPLACE] 실제 업로드 (expense 버킷 / 영문지점 폴더)
async function uploadExpenseFile(file, ym, onTick) {
  // 권한 가드가 필요하면 주석 해제
  if (!['지점장','관리자'].includes(__MY_ROLE)) throw new Error('업로드 권한이 없습니다.');

  const affEn = (__LAST_AFFILIATION_EN || '').trim()
              || String(__LAST_AFFILIATION || '').trim(); // fallback
  if (!affEn) throw new Error('지점 정보가 없습니다.');

  const path = makeExpensePath(file.name, affEn, ym);

  // ✅ import된 supabase 클라이언트를 사용
  const { error } = await supabase
    .storage
    .from(EXPENSE_BUCKET)
    .upload(path, file, { upsert: false });

  if (error) throw error;
  if (typeof onTick === 'function') onTick(1);

  // Private 버킷 → 서명 URL 발급
  let signedUrl = null;
  try {
    const { data: sig, error: sigErr } = await supabase
      .storage
      .from(EXPENSE_BUCKET)
      .createSignedUrl(path, 60 * 60); // 1시간
    if (!sigErr) signedUrl = sig?.signedUrl || null;
  } catch (_) {}

  return { path, signedUrl };
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

// === [ADD] 지점 월별 총비용 캐시 선로딩 ===
async function loadBranchExpenseCache(affiliation) {
  try {
    const { data, error } = await supabase
      .from('branch_settlement_expenses')
      .select('period_month, total_expense')
      .eq('affiliation', affiliation);

    if (error) throw error;

    const map = {};
    for (const row of (data || [])) {
      // period_month: 'YYYY-MM-DD' → 'YYYY-MM'
      const ym = ymKey(String(row.period_month));
      if (!ym) continue;
      map[ym] = Number(row.total_expense || 0);
    }

    __LAST_COST_MAP = map;    // ✅ 전역 캐시에 반영
    return map;
  } catch (e) {
    console.warn('[settlement] expense cache load failed:', e?.message || e);
    return {};
  }
}

// [ADD] 현재 로그인 사용자의 권한과 지점명 로드
async function resolveMyAuthority() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      __MY_ROLE = '직원';
      __MY_AFFILIATION = null;
      return;
    }

    const { data: rows, error } = await supabase
      .from('staff_profiles')
      .select('authority, affiliation')
      .eq('user_id', user.id)
      .is('leave_date', null);

    if (error) throw error;

    // 기본값
    __MY_ROLE = '직원';
    __MY_AFFILIATION = null;

    // 여러 행이 있을 수 있으니 우선순위로 결정
    for (const r of (rows || [])) {
      if (r.authority === '관리자') {
        __MY_ROLE = '관리자';
      } else if (r.authority === '지점장' && __MY_ROLE !== '관리자') {
        __MY_ROLE = '지점장';
        __MY_AFFILIATION = r.affiliation || __MY_AFFILIATION;
      } else if (r.authority === '직원' && !__MY_AFFILIATION) {
        __MY_AFFILIATION = r.affiliation || __MY_AFFILIATION;
      }
    }
  } catch (e) {
    console.error('권한 조회 실패:', e);
    __MY_ROLE = '직원';
    __MY_AFFILIATION = null;
  }
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
        if (__LAST_CONFIRMED_MAP[ym]) {
          showToastGreenRed?.('이미 확정된 달입니다. 수정할 수 없습니다.');
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
        showToastGreenRed?.('저장되었습니다.', { ok: true });

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

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('settlement-confirm-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      try {
        const ym  = document.getElementById('d_period')?.value;
        const aff = (__LAST_AFFILIATION || '').trim();
        if (!ym || !aff) return;
        if (__LAST_CONFIRMED_MAP[ym]) return; // 이미 확정
        await confirmSettlement(aff, ym);
      } catch (e) {
        console.error('[settlement] confirm failed:', e);
        showToastGreenRed?.('정산확정에 실패했습니다.');
      }
    });
  }
});

function applyLockUI(locked) {
  const costEl = document.getElementById('d_cost');
  const memoEl = document.getElementById('d_memo');
  const saveBtn = document.getElementById('settlement-drawer-save');
  const confirmBtn = document.getElementById('settlement-confirm-btn');

  if (costEl) {
    costEl.readOnly = locked;
    costEl.disabled = locked;
    costEl.classList.toggle('bg-gray-50', locked);
  }
  if (memoEl) {
    memoEl.readOnly = locked;
    memoEl.disabled = locked;
    memoEl.classList.toggle('bg-gray-50', locked);
  }
  if (saveBtn) {
    saveBtn.disabled = locked;
    saveBtn.classList.toggle('opacity-50', locked);
    saveBtn.classList.toggle('cursor-not-allowed', locked);
  }
  if (confirmBtn) {
    confirmBtn.disabled = locked;
    confirmBtn.textContent = locked ? '확정됨' : '정산확정';

    if (locked) {
      confirmBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
      confirmBtn.classList.add('bg-gray-400', 'hover:bg-gray-400');
    } else {
      confirmBtn.classList.remove('bg-gray-400', 'hover:bg-gray-400');
      confirmBtn.classList.add('bg-red-600', 'hover:bg-red-700');
    }
  }
}

async function fetchAndApplySettlementState(affiliation, ym) {
  try {
    const period_month = firstDayOfMonth(ym);
    const { data: row, error } = await supabase
      .from('branch_settlement_expenses')
      .select('id, total_expense, memo, is_confirmed')
      .eq('affiliation', affiliation)
      .eq('period_month', period_month)
      .maybeSingle();
    if (error) throw error;

    const costEl = document.getElementById('d_cost');
    const memoEl = document.getElementById('d_memo');

    if (row) {
      if (typeof row.total_expense === 'number' && costEl) {
        __LAST_COST_MAP[ym] = row.total_expense;
        costEl.value = Number(row.total_expense).toLocaleString('ko-KR');
      }
      if (typeof row.memo === 'string' && memoEl) {
        __LAST_MEMO_MAP[ym] = row.memo;
        memoEl.value = row.memo;
      }
      __LAST_CONFIRMED_MAP[ym] = !!row.is_confirmed;
    } else {
      __LAST_CONFIRMED_MAP[ym] = false;
    }

    applyLockUI(__LAST_CONFIRMED_MAP[ym] === true);
    // [ADD] 표도 DB값 반영되도록 즉시 재렌더
    try {
      renderMonthlyTable({
        titleAffiliation: __LAST_AFFILIATION,
        salesMap: __LAST_SALES_MAP,
        payrollByStaff: __LAST_PAYROLL_BY_STAFF,
        costMap: __LAST_COST_MAP,  // ← 방금 갱신된 캐시 사용
        staffList: __LAST_STAFF_LIST,
      });
    } catch (_) {}

  } catch (e) {
    console.warn('[settlement] fetch state failed:', e?.message || e);
    applyLockUI(false);
  }
}

async function confirmSettlement(affiliation, ym) {
  const ok = window.confirm('정산을 확정하면 총 비용과 메모가 잠깁니다. 계속 진행할까요?');
  if (!ok) return;

  const costEl = document.getElementById('d_cost');
  const memoEl = document.getElementById('d_memo');

  const cost = toNumberKR(costEl?.value);
  const memo = (memoEl?.value || '').trim();
  const period_month = firstDayOfMonth(ym);

  // upsert 형태: 있으면 update, 없으면 insert(확정)
  const { data: existing, error: selErr } = await supabase
    .from('branch_settlement_expenses')
    .select('id')
    .eq('affiliation', affiliation)
    .eq('period_month', period_month)
    .maybeSingle();
  if (selErr) throw selErr;

  if (existing?.id) {
    const { error: upErr } = await supabase
      .from('branch_settlement_expenses')
      .update({ total_expense: cost, memo, is_confirmed: true })
      .eq('id', existing.id);
    if (upErr) throw upErr;
  } else {
    const { error: insErr } = await supabase
      .from('branch_settlement_expenses')
      .insert({ affiliation, period_month, total_expense: cost, memo, is_confirmed: true });
    if (insErr) throw insErr;
  }

  // 캐시/UI 반영
  __LAST_COST_MAP[ym] = cost;
  __LAST_MEMO_MAP[ym] = memo;
  __LAST_CONFIRMED_MAP[ym] = true;
  applyLockUI(true);
  showToastGreenRed?.('정산이 확정되었습니다.', { ok: true });
}

// [ADD] 참고/제외 항목 렌더링
function renderCostHints() {
  const inc = document.getElementById('d_cost_includes');
  const exc = document.getElementById('d_cost_excludes');
  if (inc) {
    inc.innerHTML = (COST_INCLUDE_HINTS.length
      ? COST_INCLUDE_HINTS.map(v => `<li>${v}</li>`).join('')
      : `<li class="text-gray-400">없음</li>`);
  }
  if (exc) {
    exc.innerHTML = (COST_EXCLUDE_HINTS.length
      ? COST_EXCLUDE_HINTS.map(v => `<li>${v}</li>`).join('')
      : `<li class="text-gray-400">없음</li>`);
  }
}
