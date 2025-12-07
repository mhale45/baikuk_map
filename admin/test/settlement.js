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
// [ADD] 월별 부가세 합계 캐시
let __LAST_VAT_MAP = {}; // { 'YYYY-MM': number }
// [ADD] 월별 계좌 잔고 캐시
let __LAST_MAIN_BAL_MAP = {}; // { 'YYYY-MM': number }  // main_balance
let __LAST_SUB_BAL_MAP  = {}; // { 'YYYY-MM': number }  // sub_balance
let __LAST_RESERVE_MAP = {};  // [ADD] 월별 유보금


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

// [ADD] ==== 타지점 이체금액 계산 유틸 ====

// 직원ID -> 소속지점 맵
const STAFF_AFF_BY_ID = new Map();

async function ensureStaffAffMap() {
  if (STAFF_AFF_BY_ID.size > 0) return;
  await waitForSupabase();
  const { data, error } = await window.supabase
    .from('staff_profiles')
    .select('id, affiliation')
    .is('leave_date', null);
  if (error || !data) return;
  STAFF_AFF_BY_ID.clear();
  data.forEach(({ id, affiliation }) => {
    STAFF_AFF_BY_ID.set(id, affiliation || '');
  });
}

/** 선택 지점(baseAff) 명의로 발행된 매출 중
 *   타지점 직원들의 관여매출 합계 (= 이체해야 할 금액)
 * rows: performance 행 배열 (performance_allocations 1:1 포함)
 */
function computeTransfersByAff(rows, baseAff) {
  const byAff = new Map(); // 타지점별 합
  if (!baseAff) return byAff;

  for (const row of (rows || [])) {
    if (row.affiliation !== baseAff) continue; // 이 지점 명의로 발행된 건만

    const pa = Array.isArray(row.performance_allocations)
      ? row.performance_allocations[0]
      : row.performance_allocations;
    if (!pa) continue;

    for (let i = 1; i <= 4; i++) {
      const sid = pa[`staff_id${i}`];
      if (!sid) continue;

      const staffAff = STAFF_AFF_BY_ID.get(sid) || '';
      if (!staffAff || staffAff === baseAff) continue; // 같은 지점은 제외(타지점만)

      const savedInv  = Number(pa[`involvement_sales${i}`] || 0);
      const buyerAmt  = Number(pa[`buyer_amount${i}`]      || 0);
      const sellerAmt = Number(pa[`seller_amount${i}`]     || 0);
      const amt = savedInv > 0 ? savedInv : (buyerAmt + sellerAmt);
      if (amt <= 0) continue;

      byAff.set(staffAff, (byAff.get(staffAff) || 0) + amt);
    }
  }
  // 총합만 필요하면 합계를 다시 합쳐 반환
  let total = 0;
  for (const v of byAff.values()) total += v;
  return { byAff, total };
}

/** 정산(지점별 표) 기간에 맞춰 필요한 performance 행을 로드 */
async function fetchPerformanceRowsForSettlementRange({ start, end }) {
  await waitForSupabase();
  // settlement의 조회 기간 필터와 동일하게 맞추세요.
  // (status=true만 집계할지 정책에 맞춰 조건 추가 가능)
  let q = window.supabase
    .from('performance')
    .select(`
      id, affiliation, balance_date, contract_date,
      performance_allocations(
        staff_id1, staff_id2, staff_id3, staff_id4,
        buyer_amount1, buyer_amount2, buyer_amount3, buyer_amount4,
        seller_amount1, seller_amount2, seller_amount3, seller_amount4,
        involvement_sales1, involvement_sales2, involvement_sales3, involvement_sales4
      )
    `);

  if (start) q = q.gte('balance_date', start);
  if (end)   q = q.lte('balance_date', end);

  const { data, error } = await q;
  if (error) {
    console.warn('[settlement] performance 조회 실패:', error.message);
    return [];
  }
  return data || [];
}

/** 기간 내 모든 지점의 "타지점" 금액을 미리 계산(Map<affiliation, total>) */
async function buildTransfersMapForAllBranches({ start, end }) {
  await ensureStaffAffMap();
  const rows = await fetchPerformanceRowsForSettlementRange({ start, end });
  const map = new Map();
  const branchSet = new Set(rows.map(r => r.affiliation).filter(Boolean));
  branchSet.forEach(aff => {
    const { total } = computeTransfersByAff(rows, aff);
    map.set(aff, total);
  });
  return map;
}

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

  // === THEAD: 순이익 열 추가 (비용과 지점자율금 사이) ===
  // 기간 / 잔금매출 합계 / 계좌 잔고1 / 계좌 잔고2 / 총 급여 / 부가세 / 비용 / 순이익 / 지점자율금 / 배당금
  const headRow = document.createElement('tr');
  headRow.innerHTML = `
    <th class="border px-2 py-2 whitespace-nowrap">기간(YYYY-MM)</th>
    <th class="border px-2 py-2 whitespace-nowrap">잔금매출 합계</th>
    <th class="border px-2 py-2 whitespace-nowrap">계좌 잔고1</th>
    <th class="border px-2 py-2 whitespace-nowrap">계좌 잔고2</th>
    <th class="border px-2 py-2 whitespace-nowrap">총 급여</th>
    <th class="border px-2 py-2 whitespace-nowrap">부가세</th>
    <th class="border px-2 py-2 whitespace-nowrap">유보금</th>
    <th class="border px-2 py-2 whitespace-nowrap">순이익</th>
    <th class="border px-2 py-2 whitespace-nowrap">총비용</th>
    <th class="border px-2 py-2 whitespace-nowrap">지점자율금</th>
    <th class="border px-2 py-2 whitespace-nowrap">배당금</th>
  `;

  thead.innerHTML = '';
  thead.appendChild(headRow);

  // === TBODY ===
  tbody.innerHTML = '';
  if (yms.length === 0) {
    // 열 개수: 10
    tbody.innerHTML = `
      <tr><td class="border px-2 py-3 text-center text-gray-500" colspan="11">데이터가 없습니다</td></tr>
    `;
    return;
  }

  for (const ym of yms) {
    const sales = Number(salesMap?.[ym] || 0);
    const cost = Number(__LAST_COST_MAP?.[ym] ?? costMap?.[ym] ?? 0);

    // 총 급여
    const pmap = payrollByStaff?.[ym] || {};
    const payrollTotal = Object.values(pmap).reduce((a, b) => a + Number(b || 0), 0);

    // 부가세(월별 합계)
    const vat = Number(__LAST_VAT_MAP?.[ym] || 0);

    // 잔고 합계
    const mainBal = Number(__LAST_MAIN_BAL_MAP?.[ym] || 0);
    const subBal  = Number(__LAST_SUB_BAL_MAP?.[ym]  || 0);
    const balanceTotal = mainBal + subBal;

    // 유보금(입력 저장된 값 사용)
    const RESERVE = Number(__LAST_RESERVE_MAP?.[ym] || 0);

    // 자율금 계산을 위한 기반
    const autonomousRate = Number(__LAST_AUTONOMOUS_RATE || 0);
    const baseForAuto = balanceTotal - payrollTotal - vat - RESERVE;

    // [NEW] 순이익(자율금 산정 전)
    const netIncome = Math.round(baseForAuto);
    
    // [NEW] 총비용 = 매출합계 - 총급여 - 순이익 (드로어와 동일한 정의)
    const totalCost = Math.round(Number(sales || 0) - Number(payrollTotal || 0) - netIncome);

    // 지점자율금 = 순이익 × 비율
    const autonomousFee = Math.round(netIncome * autonomousRate);

    // 최종 배당금
    const finalProfit = Math.round(netIncome - autonomousFee);
    // ▼▼▼ 추가: 음수는 표시만 0으로
    const dispAutonomousFee = Math.max(0, autonomousFee);
    const dispFinalProfit   = Math.max(0, finalProfit);

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-yellow-50 cursor-pointer';
    const reserve = Number(__LAST_RESERVE_MAP?.[ym] || 0);
    tr.innerHTML = `
      <td class="border px-2 py-2 text-center">${ym}</td>
      <td class="border px-2 py-2 text-right font-semibold">${fmt(sales)}</td>
      <td class="border px-2 py-2 text-right">${fmt(mainBal)}</td>
      <td class="border px-2 py-2 text-right">${fmt(subBal)}</td>
      <td class="border px-2 py-2 text-right font-semibold">${fmt(payrollTotal)}</td>
      <td class="border px-2 py-2 text-right">${fmt(vat)}</td>
      <td class="border px-2 py-2 text-right font-semibold">${fmt(reserve)}</td>
      <td class="border px-2 py-2 text-right font-semibold">${fmt(netIncome)}</td>
      <td class="border px-2 py-2 text-right font-semibold text-blue-600">${fmt(totalCost)}</td>
      <td class="border px-2 py-2 text-right text-purple-700">${fmt(dispAutonomousFee)}</td>
      <td class="border px-2 py-2 text-right font-semibold text-amber-700">${fmt(dispFinalProfit)}</td>
    `;

    // 행 클릭 → 드로어 오픈
    tr.addEventListener('click', () => {
      openSettlementDrawer({
        affiliation: __LAST_AFFILIATION,
        ym,
        sales,
        payrollTotal,
        pmap,
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

    await loadBranchExpenseCache(affiliation);

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
      __LAST_AUTONOMOUS_RATE = Number(bi?.['autonomous-rate'] ?? 0) || 0;
    } catch (e) {
      console.warn('affiliation_en 조회 실패:', e?.message || e);
      __LAST_AFFILIATION_EN = null;
    }

    const staffIds = new Set((staffRows || []).map(r => String(r.id)));
    __LAST_STAFF_LIST = (staffRows || []).map(r => ({ id: String(r.id), name: r.name }));
    const hasStaff = staffIds.size > 0;

    // 2) 잔금일 있는 performance (status=true인 확정된 매출만)
    const { data: perfRows, error: perfErr } = await supabase
      .from('performance')
      .select('id, balance_date')
      .eq('status', true)
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

    // 3) allocations 조회 & 합산
    const BATCH = 800;
    const salesMap = {};
    const payrollByStaff = {};

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

            salesMap[ym] = (salesMap[ym] || 0) + inv;

            const pay = Math.round(inv * PAYROLL_RATE);
            (payrollByStaff[ym] ||= {});
            payrollByStaff[ym][sidStr] = (payrollByStaff[ym][sidStr] || 0) + pay;
          }
        }
      }
    }

    const payrollTotalMap = {};
    for (const [ym, map] of Object.entries(payrollByStaff)) {
      payrollTotalMap[ym] = Object.values(map || {}).reduce((a, b) => a + Number(b || 0), 0);
    }

    __LAST_SALES_MAP = salesMap;
    __LAST_PAYROLL_BY_STAFF = payrollByStaff;
    __LAST_PAYROLL_TOTAL_MAP = payrollTotalMap;

    // ----------------------------
    // 🔥 [CHANGE] surtax 불러오기
    // ----------------------------
    __LAST_VAT_MAP = {}; // 초기화

    const { data: surtaxRows, error: surtaxErr } = await supabase
      .from('branch_settlement_expenses')
      .select('period_month, affiliation, surtax')
      .eq('affiliation', affiliation);

    if (surtaxErr) {
      console.warn('surtax 불러오기 실패:', surtaxErr.message);
    } else if (surtaxRows) {
      surtaxRows.forEach(row => {
        const d = new Date(row.period_month);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        __LAST_VAT_MAP[ym] = Number(row.surtax || 0);
      });
    }

    // 비용 캐시는 기존대로 유지
    __LAST_COST_MAP = { ...(__LAST_COST_MAP || {}) };

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

    // [CHANGE] 초기 자동 선택: ① 내 소속 지점이 목록에 있으면 그 지점, ② 없으면 첫 번째 클릭 가능 지점
    (function autoSelectDefaultBranch() {
      // 후보: 내 소속 지점 → 없으면 첫 번째 지점
      let targetAff = null;

      // 1) 내 소속 지점이 있으면 우선
      if (__MY_AFFILIATION) {
        const el = $(`#branch-list > div[data-affiliation="${CSS.escape(__MY_AFFILIATION)}"]`);
        if (el && !el.classList.contains('pointer-events-none')) {
          targetAff = __MY_AFFILIATION;
        }
      }

      // 2) 없으면(관리자 등) 클릭 가능한 첫 번째 지점
      if (!targetAff) {
        const firstClickable = $$('#branch-list > div')
          .find(el => !el.classList.contains('pointer-events-none'));
        if (firstClickable) {
          targetAff = firstClickable.dataset.affiliation || null;
        }
      }

      if (!targetAff) return;

      // 선택 표시 초기화 후, 대상 지점 선택/로딩
      $$('#branch-list > div').forEach(el => el.classList.remove('bg-yellow-200'));
      const targetEl = $(`#branch-list > div[data-affiliation="${CSS.escape(targetAff)}"]`);
      if (targetEl) targetEl.classList.add('bg-yellow-200');

      loadBranchMonthlySales(targetAff);
    })();
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

function openSettlementDrawer({ affiliation, ym, sales, payrollTotal, pmap, staffList }) {
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
          <span class="text-sm text-blue-700 font-semibold text-right"> ${fmtKR(deposit)} </span>
          <span class="text-sm ml-1">${fmtKR(val)}</span>
        </div>
      `;
    }).join('');
    listEl.innerHTML = `
      <div class="text-xs text-gray-500 px-3 py-1">직원별 급여(관여매출의 50%)</div>
      ${rows || `<div class="px-3 py-2 text-sm text-gray-500">해당 월 직원 급여 데이터가 없습니다</div>`}
    `;
  }

  // [ADD] 자율금/비율 표시 요소(없으면 null)
  const autoRateEl = $id('d_autonomous_rate'); // 예: "20%" 같은 텍스트
  const autoFeeEl  = $id('d_autonomous_fee');  // 금액 표시용(readonly 권장)
  const autoAmtEl  = $id('d_autonomous_amount'); // 동일 값 표시 (필요 시)

  const toNumber = (v) => Number(String(v || '0').replace(/[^\d.-]/g, '')) || 0;
  const recompute = () => {
    const vatVal = Number(__LAST_VAT_MAP?.[ym] || 0);

    // 잔고 읽기
    const mainEl = document.getElementById('input-main-balance');
    const subEl  = document.getElementById('input-sub-balance');
    const main = toNumber(mainEl?.value ?? __LAST_MAIN_BAL_MAP?.[ym] ?? 0);
    const sub  = Number(__LAST_SUB_BAL_MAP?.[ym] || 0);
    const balanceTotalNow = main + sub;

    // ✅ 유보금 읽기 (중요!)
    const reserveEl = document.getElementById('d_reserves');
    const RESERVE = toNumber(reserveEl?.value ?? __LAST_RESERVE_MAP?.[ym] ?? 0);

    // 자율금 비율
    const rate = Number(__LAST_AUTONOMOUS_RATE || 0);

    // 순이익 계산 기반
    const baseForAuto = balanceTotalNow - Number(payrollTotal || 0) - vatVal - RESERVE;

    // 순이익
    const netIncome = Math.round(baseForAuto);

    // 자율금
    const aFee = Math.round(baseForAuto * rate);

    // 총비용 = 매출 - 급여 - 순이익
    const totalCost = Math.round(Number(sales || 0) - Number(payrollTotal || 0) - netIncome);

    // 배당금
    const finalProfit = Math.round(netIncome - aFee);

    // ▼ 표시 업데이트
    const netEl = document.getElementById('d_netincome');
    if (netEl) netEl.value = fmtKR(netIncome);

    const totalCostEl = document.getElementById('d_totalcost');
    if (totalCostEl) totalCostEl.value = fmtKR(totalCost);

    const profitEl = document.getElementById('d_profit');
    if (profitEl) profitEl.value = fmtKR(Math.max(0, finalProfit));

    const autoFeeEl = document.getElementById('d_autonomous_fee');
    if (autoFeeEl) autoFeeEl.value = fmtKR(Math.max(0, aFee));

    const autoAmtEl = document.getElementById('d_autonomous_amount');
    if (autoAmtEl) autoAmtEl.value = fmtKR(Math.max(0, aFee));
  };

  // [ADD] 부가세 입력 변경 시 재계산
  const vatInput = document.getElementById('d_vat');
  if (vatInput) {
    vatInput.addEventListener('input', () => {
      // 숫자만 남기고 콤마 포맷 적용
      const num = Number(String(vatInput.value).replace(/[^\d.-]/g, '')) || 0;
      vatInput.value = num.toLocaleString('ko-KR');

      // 캐시에 즉시 반영
      __LAST_VAT_MAP[ym] = num;

      // 재계산
      recompute();
    });
  }

  // 유보금 입력 변경 시 재계산
  const reserveEl = document.getElementById('d_reserves');
  if (reserveEl) {
    reserveEl.addEventListener('input', () => {
      // 숫자만 남기기
      const n = Number(String(reserveEl.value).replace(/[^\d.-]/g, '')) || 0;
      reserveEl.value = n.toLocaleString('ko-KR');

      // 유보금 캐시에 즉시 반영
      __LAST_RESERVE_MAP[ym] = n;

      // 재계산 실행
      recompute();
    });
  }

  // 잔고 입력 변경 → 재계산
  {
    const mainEl = document.getElementById('input-main-balance');
    const subEl  = document.getElementById('input-sub-balance');
    const handler = () => recompute();

    // subEl은 항상 읽기 전용/비활성 → 이벤트 바인딩하지 않음
    if (mainEl) {
      mainEl.addEventListener('input', handler);
      mainEl.addEventListener('blur', () => {
        mainEl.value = fmtKR(toNumber(mainEl.value));
        handler();
      });
    }
  }

  // [ADD] 잔고 초기값 반영 (비용과 동일한 표시 형식)
  {
    const mainEl = document.getElementById('input-main-balance');
    const subEl  = document.getElementById('input-sub-balance');
    const fmtKR  = (n) => Number(n || 0).toLocaleString('ko-KR');

    if (mainEl) mainEl.value = fmtKR(__LAST_MAIN_BAL_MAP?.[ym] || 0);
    if (subEl) {
      subEl.value  = fmtKR(__LAST_SUB_BAL_MAP?.[ym]  || 0);
      // 항상 수정 불가(비용과 동일) + 굵게
      subEl.readOnly = true;
      subEl.disabled = true;
      subEl.classList.add('bg-gray-50', 'font-semibold');
      subEl.title = '계좌 잔고2는 cost_management(사용비용) 집계값으로 자동 표시됩니다.';
    }
    {
      const reserveEl = document.getElementById('d_reserves');
      if (reserveEl) {
        reserveEl.value = Number(__LAST_RESERVE_MAP?.[ym] || 0).toLocaleString('ko-KR');
      }
    }
  }

  // [ADD] 순이익 아래/메모 위에 동적으로 삽입
  {
    const memoEl = document.getElementById('d_memo');
    if (memoEl && !document.getElementById('input-main-balance')) {
      const wrap = document.createElement('div');
      wrap.className = 'mt-3 grid grid-cols-2 gap-3';
      wrap.innerHTML = `
        <div>
          <label class="block text-sm text-gray-700 mb-1">계좌 잔고1 (main_balance)</label>
          <input id="input-main-balance" type="text" inputmode="numeric" placeholder="0" class="border rounded px-3 py-2 text-right"/>
        </div>
        <div>
          <label class="block text-sm text-gray-700 mb-1">계좌 잔고2 (sub_balance)</label>
          <!-- 항상 수정 불가 + 굵게 표시 -->
          <input
            id="input-sub-balance"
            type="text"
            inputmode="numeric"
            placeholder="0"
            class="border rounded px-3 py-2 text-right bg-gray-50 font-semibold"
            readonly
            disabled
            title="계좌 잔고2는 cost_management(사용비용) 집계값으로 자동 표시됩니다."
          />
        </div>
      `;
      memoEl.parentElement.insertBefore(wrap, memoEl);
    }
  }

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

  // [CHANGE] 초기 비율/자율금 표시 (지점별 비율 사용)
  if ($id('d_autonomous_rate')) $id('d_autonomous_rate').textContent = `${Math.round((__LAST_AUTONOMOUS_RATE||0)*100)}%`;
  if ($id('d_autonomous_fee'))  $id('d_autonomous_fee').value = '0';
  if ($id('d_autonomous_amount')) $id('d_autonomous_amount').value = '0';

  // 최초 계산
  recompute();


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

// === [CHANGE] 지점 월별 총비용 캐시 선로딩 ===
// 비용은 cost_management에서 "사용비용"을 월별 합산하여 사용하고,
// 계좌잔고(main)는 branch_settlement_expenses에서 불러오며,
// 계좌잔고2(sub)는 cost_management에서 division='사용비용' 월합으로 대체합니다.
async function loadBranchExpenseCache(affiliation) {
  try {
    // 1) 계좌잔고1(main)은 기존 테이블에서 유지 로딩
    let mainBalMap = {};
    let reserveMap = {};  // [ADD]

    try {
      const { data: balRows, error: balErr } = await supabase
        .from('branch_settlement_expenses')
        .select('period_month, main_balance, reserve')
        .eq('affiliation', affiliation);

      if (balErr) throw balErr;

      for (const row of (balRows || [])) {
        const ym = ymKey(String(row.period_month));
        if (!ym) continue;
        mainBalMap[ym] = Number(row.main_balance || 0);
        reserveMap[ym] = Number(row.reserve || 0); 
      }
    } catch (e) {
      console.warn('[settlement] main balance load failed:', e?.message || e);
    }

    // 2) 비용(cost): cost_management에서 division='사용비용' 월합
    const costMap = {};
    try {
      const { data: costRows, error: costErr } = await supabase
        .from('cost_management')
        .select('date, amount, affiliation, division')
        .eq('affiliation', affiliation)
        .eq('division', '사용비용');

      if (costErr) throw costErr;

      for (const row of (costRows || [])) {
        const ym = ymKey(String(row.date)); // 'YYYY-MM-DD' → 'YYYY-MM'
        if (!ym) continue;
        const amt = Number(row.amount || 0);
        costMap[ym] = (costMap[ym] || 0) + amt;
      }
    } catch (e) {
      console.warn('[settlement] cost_management(load 비용) failed:', e?.message || e);
    }

    // 3) 계좌잔고2(sub): cost_management에서 division='사용비용' 합
    // 1) 지점장 ID 조회
    const { data: managerRows, error: mgrErr } = await supabase
      .from('branch_info')
      .select('branch_manager_id')
      .eq('affiliation', affiliation)
      .maybeSingle();

    let managerId = null;
    if (!mgrErr && managerRows) {
      managerId = managerRows.branch_manager_id;
    }

    if (managerId) {
      // 2) 해당 지점장의 사용비용을 월별 합산
      for (const ym of Object.keys(__LAST_COST_MAP)) {
        const [yyyy, mm] = ym.split('-');
        const startDate = `${yyyy}-${mm}-01`;
        const endDate = `${yyyy}-${mm}-31`; // Supabase가 날짜 비교에서는 자동 처리됨

        const { data: costSumRows, error: costSumErr } = await supabase
          .from('cost_management')
          .select('amount')
          .eq('division', '사용비용')
          .eq('staff_id', managerId)
          .gte('date', startDate)
          .lte('date', endDate);

        if (!costSumErr && costSumRows) {
          const total = costSumRows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
          __LAST_SUB_BAL_MAP[ym] = total;
        } else {
          __LAST_SUB_BAL_MAP[ym] = 0;
        }
      }
    } else {
      console.warn('⚠ 지점장 ID를 찾을 수 없어서 계좌 잔고2 계산을 건너뜀');
    }

    // 4) 전역 캐시 갱신
    __LAST_COST_MAP     = costMap;     // 비용: cost_management('사용비용')
    __LAST_MAIN_BAL_MAP = mainBalMap;  // 잔고1: branch_settlement_expenses.main_balance
    __LAST_SUB_BAL_MAP  = subCMMap;    // ★ 잔고2: cost_management('사용비용')
    __LAST_RESERVE_MAP  = reserveMap;  // [ADD] 유보금: branch_settlement_expenses.reserve

    return costMap;

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
        // [ADD] 관리자라도 소속이 있으면 기본 선택 지점으로 활용
        if (!__MY_AFFILIATION && r.affiliation) {
          __MY_AFFILIATION = r.affiliation;
        }
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

  // [ADD] 드로어 input 값 읽기
  const $main = document.getElementById('input-main-balance');
  const $sub  = document.getElementById('input-sub-balance');
  const mainBalance = toNumberKR($main?.value);
  const subBalance  = toNumberKR($sub?.value);

  const $reserve = document.getElementById('d_reserves');
  const reserve = toNumberKR($reserve?.value);

  // [ADD] 부가세(surtax) Input 읽기
  const $vat = document.getElementById('d_vat');
  const surtax = toNumberKR($vat?.value || 0);

  // [MODIFY] surtax 포함하여 payload 구성
  const payload = {
    affiliation: aff,
    period_month,
    total_expense: Number(totalExpense || 0),
    memo: (memo ?? '').trim(),
    main_balance: mainBalance,
    sub_balance:  subBalance,
    reserve: reserve,
    surtax: surtax,                // ← ★ 추가됨
  };

  // 존재여부 확인 (컬럼명만 사용, 테이블명 접두사 금지)
  const { data: existing, error: selErr } = await supabase
    .from('branch_settlement_expenses')
    .select('id')
    .eq('affiliation', aff)                   // 지점명으로 매칭
    .eq('period_month', period_month)         // 날짜
    .maybeSingle();

  if (selErr) {
    showToastGreenRed?.('저장 실패(조회 오류)');
    throw selErr;
  }

  // UPDATE
  if (existing?.id) {
    const { error: updErr } = await supabase
      .from('branch_settlement_expenses')
      .update(payload)
      .eq('id', existing.id);

    if (updErr) {
      showToastGreenRed?.('저장 실패(업데이트 오류)');
      throw updErr;
    }

  // INSERT
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
        const cost = Number((__LAST_COST_MAP || {})[ym] || 0);
        const memo = document.getElementById('d_memo')?.value || '';
        const aff  = (__LAST_AFFILIATION || '').trim();
        const surtax = toNumberKR(document.getElementById('d_vat')?.value || 0);

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

        // [ADD] 잔고 캐시도 반영
        const $main = document.getElementById('input-main-balance');
        const $sub  = document.getElementById('input-sub-balance');
        __LAST_MAIN_BAL_MAP[ym] = toNumberKR($main?.value);
        __LAST_SUB_BAL_MAP[ym]  = toNumberKR($sub?.value);
        const $reserve = document.getElementById('d_reserves');
        __LAST_RESERVE_MAP[ym] = toNumberKR($reserve?.value);
        __LAST_VAT_MAP[ym] = surtax;

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
  const $main = document.getElementById('input-main-balance');
  const $sub  = document.getElementById('input-sub-balance');

  const toNumber = (v) => Number(String(v || '0').replace(/[^\d.-]/g, '')) || 0;
  const fmtKR = (n) => Number(n || 0).toLocaleString('ko-KR');

  // sub는 항상 읽기 전용 → 포맷터 불필요
  if ($main) {
    $main.addEventListener('blur', () => {
      $main.value = fmtKR(toNumber($main.value));
    });
  }
});

function applyLockUI(locked) {
  const memoEl = document.getElementById('d_memo');
  const saveBtn = document.getElementById('settlement-drawer-save');
  const confirmBtn = document.getElementById('settlement-confirm-btn');
  const mainEl = document.getElementById('input-main-balance');
  const subEl  = document.getElementById('input-sub-balance');

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

  // [ADD] 계좌 잔고 입력칸도 잠금
  if (mainEl) {
    mainEl.readOnly = locked;
    mainEl.disabled = locked;
    mainEl.classList.toggle('bg-gray-50', locked);
  }

  // 계좌 잔고2는 잠금상태와 무관하게 항상 수정 불가
  if (subEl) {
    subEl.readOnly = true;
    subEl.disabled = true;
    subEl.classList.add('bg-gray-50', 'font-semibold');
    subEl.title = '계좌 잔고2는 cost_management(사용비용) 집계값으로 자동 표시됩니다.';
  }
}

async function fetchAndApplySettlementState(affiliation, ym) {
  try {
    const period_month = firstDayOfMonth(ym);
    const { data: row, error } = await supabase
      .from('branch_settlement_expenses')
      .select('id, total_expense, memo, is_confirmed, main_balance, sub_balance')
      .eq('affiliation', affiliation)
      .eq('period_month', period_month)
      .maybeSingle();
    if (error) throw error;

    const memoEl = document.getElementById('d_memo');

    if (row) {
      // 비용은 DB total_expense로 덮어쓰지 않습니다. (표시는 cost_management 집계 기반)
      // 캐시/입력창은 현재 값 유지 + 강제 잠금
      setDrawerCostByYM(ym);

      if (typeof row.memo === 'string' && memoEl) {
        __LAST_MEMO_MAP[ym] = row.memo;
        memoEl.value = row.memo;
      }
      __LAST_MAIN_BAL_MAP[ym] = Number(row.main_balance || 0);
      __LAST_CONFIRMED_MAP[ym] = !!row.is_confirmed;
      // [ADD] 드로어 input 기본값 채우기
      const $main = document.getElementById('input-main-balance');
      const $sub  = document.getElementById('input-sub-balance');
      if ($main) $main.value = Number(row.main_balance || 0).toLocaleString('ko-KR');
      if ($sub)  $sub.value  = Number(__LAST_SUB_BAL_MAP?.[ym] || 0).toLocaleString('ko-KR');
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
  const ok = window.confirm('정산을 확정하면 비용과 메모가 잠깁니다. 계속 진행할까요?');
  if (!ok) return;

  const memoEl = document.getElementById('d_memo');

  // 비용은 입력 불가: 캐시 고정 사용
  const cost = Number((__LAST_COST_MAP || {})[ym] || 0);
  const memo = (memoEl?.value || '').trim();
  
  const period_month = firstDayOfMonth(ym);
  // [ADD] 계좌 잔고 값도 같이 저장
  const $main = document.getElementById('input-main-balance');
  const $sub  = document.getElementById('input-sub-balance');
  const mainBalance = toNumberKR($main?.value);
  const subBalance  = toNumberKR($sub?.value);

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
      .update({
        total_expense: cost,
        memo,
        is_confirmed: true,
        main_balance: mainBalance,
        sub_balance:  subBalance,
        reserve: toNumberKR(document.getElementById('d_reserves')?.value),   // [ADD]
      })
      .eq('id', existing.id);
    if (upErr) throw upErr;
  } else {
    const { error: insErr } = await supabase
      .from('branch_settlement_expenses')
      .insert({
        affiliation,
        period_month,
        total_expense: cost,
        memo,
        is_confirmed: true,
        main_balance: mainBalance,
        sub_balance:  subBalance,
        reserve: toNumberKR(document.getElementById('d_reserves')?.value),   // [ADD]
      })
    if (insErr) throw insErr;
  }

  // 캐시/UI 반영
  __LAST_COST_MAP[ym] = cost;
  __LAST_MEMO_MAP[ym] = memo;
  __LAST_CONFIRMED_MAP[ym] = true;
  // [ADD] 확정 시점 값으로 캐시 고정
  __LAST_MAIN_BAL_MAP[ym] = mainBalance;
  __LAST_SUB_BAL_MAP[ym]  = subBalance;
  __LAST_RESERVE_MAP[ym] = toNumberKR(document.getElementById('d_reserves')?.value);

  applyLockUI(true);
  showToastGreenRed?.('정산이 확정되었습니다.', { ok: true });
}