// performance.js
// - 테이블 렌더/필터/합계 로직 제거 (index.html 담당)
// - 폼 계산/유틸/드롭다운/페이로드 수집만 유지
// - index.html의 import 목록과 호환되도록 동일한 export 유지(필요 없는 것들은 no-op)

import {
  formatNumberWithCommas, numOrNull, intOrNull, dateOrNull, formatArea1,
} from '../../../modules/core/format.js';
import { waitForSupabase } from '../../../modules/core/supabase.js';

// ==== 호환용 no-op (index.html이 호출하므로 인터페이스만 유지) ====
export function registerPerformanceRenderer(fn) { /* no-op (index.html에서 자체 사용) */ }
export function setPerformanceRows(rows) { /* no-op (index.html에서 자체 보관) */ }

// ==== 직원 이름 맵 ====
export const STAFF_NAME_BY_ID = new Map();

export async function ensureStaffNameMap() {
  if (STAFF_NAME_BY_ID.size > 0) return;
  await waitForSupabase();
  const { data, error } = await window.supabase
    .from('staff_profiles')
    .select('id, name')
    .is('leave_date', null);
  if (!error && data) {
    STAFF_NAME_BY_ID.clear();
    data.forEach(({ id, name }) => STAFF_NAME_BY_ID.set(id, name));
  }
}

// ==== UI 라벨 하이라이트 ====
export function updateHighlight() {
  const dealTypeEl = document.getElementById("f_deal_type");
  const saleLabel    = document.querySelector("#f_sale_price")?.closest("label")?.querySelector("span");
  const depositLabel = document.querySelector("#f_deposit_price")?.closest("label")?.querySelector("span");
  const monthlyLabel = document.querySelector("#f_monthly_rent")?.closest("label")?.querySelector("span");
  if (!dealTypeEl) return;
  const type = (dealTypeEl.value || '').trim();

  const reset = (el, text) => { if (!el) return; el.textContent = text; el.classList.remove("text-red-600"); el.classList.add("text-gray-600"); };
  reset(saleLabel, "매매가"); reset(depositLabel, "보증금"); reset(monthlyLabel, "월세");

  const mark = (el, text) => { if (!el) return; el.textContent = text; el.classList.replace("text-gray-600","text-red-600"); };
  if (type === "월세") { mark(depositLabel, "보증금*"); mark(monthlyLabel, "월세*"); }
  else if (type === "매매") { mark(saleLabel, "매매가*"); }
}

// ==== 표 셀 블록 빌더 (index.html에서 사용) ====
export function buildPriceBlock(row) {
  const parts = [];
  const pushIf = (label, v) => { const n = Number(v || 0); if (n > 0) parts.push(`${label} ${formatNumberWithCommas(n)}`); };
  pushIf('매매가',  row.sale_price);
  pushIf('보증금',  row.deposit_price);
  pushIf('월세',    row.monthly_rent);
  pushIf('권리금',  row.premium_price);
  return parts.join('<br>');
}
export function buildDateBlock(row) {
  const parts = [];
  if (row.contract_date) parts.push(`계약 ${row.contract_date}`);
  if (row.interim_payment1_date) parts.push(`중도금1 ${row.interim_payment1_date}`);
  if (row.interim_payment2_date) parts.push(`중도금2 ${row.interim_payment2_date}`);
  if (row.interim_payment3_date) parts.push(`중도금3 ${row.interim_payment3_date}`);
  if (row.balance_date) parts.push(`잔금 ${row.balance_date}`);
  return parts.join('<br>');
}

// ==== 직원 선택 박스 채우기 ====
export async function populateAllStaffSelects(myAffiliation=null) {
  await waitForSupabase();
  const { data, error } = await window.supabase
    .from('staff_profiles')
    .select('id, name, affiliation')
    .is('leave_date', null)
    .order('affiliation', { ascending: true });
  if (error || !data) return;

  STAFF_NAME_BY_ID.clear();
  data.forEach(r => STAFF_NAME_BY_ID.set(r.id, r.name));

  const grouped = {};
  for (const { id, name, affiliation } of data) (grouped[affiliation] ||= []).push({ id, name });
  const entries = Object.entries(grouped);
  const ordered = myAffiliation
    ? entries.sort(([a],[b]) => (a===myAffiliation?-1:b===myAffiliation?1:a.localeCompare(b,'ko')))
    : entries.sort(([a],[b]) => a.localeCompare(b,'ko'));

  for (let i=1; i<=4; i++) {
    const select = document.getElementById(`select_staff${i}`);
    if (!select) continue;
    select.innerHTML = `<option value="">-- 직원 선택 --</option>`;
    for (const [aff, list] of ordered) {
      const group = document.createElement('optgroup');
      group.label = aff;
      list.forEach(({id, name}) => {
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = name;
        group.appendChild(opt);
      });
      select.appendChild(group);
    }
  }
}

// ==== 분배 UI 아이템 ====
export function createAllocationItem(index) {
  const template = document.getElementById("allocation-template");
  const clone = template.content.cloneNode(true);
  const root = clone.querySelector("div");

  const select = root.querySelector("select");
  const buyerInput = root.querySelector(".buyer-weight");
  const sellerInput = root.querySelector(".seller-weight");
  const inputs = root.querySelectorAll("input");
  const resultInput = inputs[inputs.length - 1];

  select.id = `select_staff${index}`;
  buyerInput.id = `f_buyer_weight${index}`;
  sellerInput.id = `f_seller_weight${index}`;
  resultInput.id = `f_involvement_sales${index}`;

  resultInput.readOnly = true;
  resultInput.classList.add('bg-gray-50','text-gray-500');
  ['keydown','beforeinput','paste','drop'].forEach(ev =>
    resultInput.addEventListener(ev, e => e.preventDefault())
  );

  const calc = () => {
    const buyerPerf  = numOrNull(document.getElementById('f_buyer_performance')?.value) || 0;
    const sellerPerf = numOrNull(document.getElementById('f_seller_performance')?.value) || 0;
    const bw = parseFloat(buyerInput.value) || 0;
    const sw = parseFloat(sellerInput.value) || 0;
    const result = (buyerPerf * bw * 0.01) + (sellerPerf * sw * 0.01);
    resultInput.value = formatNumberWithCommas(Math.round(result));
  };
  buyerInput.addEventListener('input', calc);
  sellerInput.addEventListener('input', calc);

  return root;
}

// ==== 계약금/잔금 ====
export function calculateDownPaymentAndBalance({ forceDownPaymentUpdate = false } = {}) {
  const deposit = numOrNull(document.getElementById('f_deposit_price')?.value) || 0;
  const downPaymentInput = document.getElementById('f_down_payment');

  if (!window.isDownPaymentAutoFilled || forceDownPaymentUpdate) {
    const downPayment = Math.round(deposit * 0.1);
    if (downPaymentInput) downPaymentInput.value = formatNumberWithCommas(downPayment);
    window.isDownPaymentAutoFilled = true;
  }

  const downPayment = numOrNull(downPaymentInput?.value) || 0;
  const i1 = numOrNull(document.getElementById('f_interim_payment1')?.value) || 0;
  const i2 = numOrNull(document.getElementById('f_interim_payment2')?.value) || 0;
  const i3 = numOrNull(document.getElementById('f_interim_payment3')?.value) || 0;
  const balance = Math.max(deposit - (downPayment + i1 + i2 + i3), 0);
  const balEl = document.getElementById('f_balance');
  if (balEl) balEl.value = formatNumberWithCommas(balance);
}

// ==== 수수료/매출 ====
export function recalcPerformanceFromFees() {
  const buyerFee = numOrNull(document.getElementById("f_buyer_fee")?.value) || 0;
  const sellerFee = numOrNull(document.getElementById("f_seller_fee")?.value) || 0;
  const distRate  = numOrNull(document.getElementById("f_seller_distribution_rate")?.value) || 0;
  const expense   = numOrNull(document.getElementById("f_expense")?.value) || 0;

  const sellerPerfGross = sellerFee * (distRate * 0.01);
  const buyerPerfGross  = (buyerFee + sellerFee) - sellerPerfGross;

  const denom = buyerFee + sellerFee;
  let expenseToSeller = 0, expenseToBuyer = 0;
  if (denom > 0 && expense > 0) {
    expenseToSeller = expense * ((sellerFee * 0.30) / denom);
    expenseToBuyer  = expense * ((buyerFee + sellerFee * 0.70) / denom);
  }

  const sellerPerformance = Math.max(sellerPerfGross - expenseToSeller, 0);
  const buyerPerformance  = Math.max(buyerPerfGross  - expenseToBuyer , 0);

  const sp = document.getElementById("f_seller_performance");
  const bp = document.getElementById("f_buyer_performance");
  if (sp) sp.value = formatNumberWithCommas(Math.round(sellerPerformance));
  if (bp) bp.value = formatNumberWithCommas(Math.round(buyerPerformance));
}

export function calculateFees() {
  const type = (document.getElementById("f_deal_type")?.value || '').trim();
  const salePrice   = numOrNull(document.getElementById("f_sale_price")?.value) || 0;
  const deposit     = numOrNull(document.getElementById("f_deposit_price")?.value) || 0;
  const monthlyRent = numOrNull(document.getElementById("f_monthly_rent")?.value) || 0;

  let base = 0;
  if (type === "매매") base = salePrice;
  else if (type === "월세") base = monthlyRent * 100 + deposit;
  else return;

  const fee = base >= 50_000_000 ? base * 0.009 : base * 0.007;
  const buyerFeeEl = document.getElementById("f_buyer_fee");
  const sellerFeeEl = document.getElementById("f_seller_fee");
  if (buyerFeeEl)  buyerFeeEl.value  = formatNumberWithCommas(Math.round(fee));
  if (sellerFeeEl) sellerFeeEl.value = formatNumberWithCommas(Math.round(fee));
  recalcPerformanceFromFees();
}

// ==== 담당 지점 셀렉트 채우기 ====
export async function populateAffiliationSelect() {
  const el = document.getElementById('f_affiliation');
  if (!el) return;

  await waitForSupabase();
  const { data, error } = await window.supabase
    .from('staff_profiles')
    .select('affiliation')
    .is('leave_date', null);

  if (error || !data) return;

  const ko = new Intl.Collator('ko');
  const list = Array.from(new Set(
    data.map(r => r.affiliation).filter(v => !!v && String(v).trim() !== '')
  )).sort(ko.compare);

  el.innerHTML = `<option value="">-- 지점 선택 --</option>` +
    list.map(aff => `<option value="${aff}">${aff}</option>`).join('');
}

// ==== 분배 비율 검증 (알림 주입 가능) ====
export function validateTotalWeight(notify) {
  const n = notify || (msg => { if (window.showToastGreenRed) window.showToastGreenRed(msg); else alert(msg); });
  let totalBuyer = 0, totalSeller = 0;
  for (let i = 1; i <= 4; i++) {
    totalBuyer  += numOrNull(document.getElementById(`f_buyer_weight${i}`)?.value)  || 0;
    totalSeller += numOrNull(document.getElementById(`f_seller_weight${i}`)?.value) || 0;
  }
  if (totalBuyer !== 100 && totalSeller !== 100) { n('클로징과 매물확보 비율의 합이 각각 100%이어야 합니다.'); return false; }
  if (totalBuyer !== 100)  { n('클로징(매수) 비율의 합이 100%가 아닙니다.'); return false; }
  if (totalSeller !== 100) { n('매물확보(매도) 비율의 합이 100%가 아닙니다.'); return false; }
  return true;
}

// ==== 자동 리사이즈 텍스트에어리어 ====
export function enableAutoGrowTextArea(el) {
  if (!el) return;
  const grow = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
  el.addEventListener('input', grow);
  el.addEventListener('change', grow);
  requestAnimationFrame(grow);
  window.addEventListener('resize', grow);
}

// ==== 저장 페이로드 ====
export function collectPerformancePayload() {
  return {
    listing_id: intOrNull(document.getElementById('f_listing_id')?.value),
    deal_type: (document.getElementById('f_deal_type')?.value ?? '').trim() || null,
    listing_title: (document.getElementById('f_listing_title')?.value ?? '').trim() || null,
    province: (document.getElementById('f_province')?.value ?? '').trim() || null,
    city: (document.getElementById('f_city')?.value ?? '').trim() || null,
    district: (document.getElementById('f_district')?.value ?? '').trim() || null,
    detail_address: (document.getElementById('f_detail_address')?.value ?? '').trim() || null,
    affiliation: (document.getElementById('f_affiliation')?.value ?? '').trim() || null,
    contract_date: dateOrNull(document.getElementById('f_contract_date')?.value),

    down_payment: numOrNull(document.getElementById('f_down_payment')?.value),
    balance: numOrNull(document.getElementById('f_balance')?.value),
    interim_payment1: numOrNull(document.getElementById('f_interim_payment1')?.value),
    interim_payment2: numOrNull(document.getElementById('f_interim_payment2')?.value),
    interim_payment3: numOrNull(document.getElementById('f_interim_payment3')?.value),
    interim_payment1_date: dateOrNull(document.getElementById('f_interim_payment1_date')?.value),
    interim_payment2_date: dateOrNull(document.getElementById('f_interim_payment2_date')?.value),
    interim_payment3_date: dateOrNull(document.getElementById('f_interim_payment3_date')?.value),

    balance_date: dateOrNull(document.getElementById('f_balance_date')?.value),

    deposit_price: numOrNull(document.getElementById('f_deposit_price')?.value),
    monthly_rent: numOrNull(document.getElementById('f_monthly_rent')?.value),
    sale_price: numOrNull(document.getElementById('f_sale_price')?.value),
    area_py: numOrNull(document.getElementById('f_area_py')?.value),
    unit_info: (document.getElementById('f_unit_info')?.value ?? '').trim() || null,
    floor: intOrNull(document.getElementById('f_floor')?.value),

    premium_price: numOrNull(document.getElementById('f_premium_price')?.value),
    expense: numOrNull(document.getElementById('f_expense')?.value),

    buyer_fee: numOrNull(document.getElementById('f_buyer_fee')?.value),
    buyer_tax: numOrNull(document.getElementById('f_buyer_tax')?.value),
    buyer_tax_date: dateOrNull(document.getElementById('f_buyer_tax_date')?.value),

    seller_fee: numOrNull(document.getElementById('f_seller_fee')?.value),
    seller_tax: numOrNull(document.getElementById('f_seller_tax')?.value),
    seller_tax_date: dateOrNull(document.getElementById('f_seller_tax_date')?.value),

    seller_distribution_rate: numOrNull(document.getElementById('f_seller_distribution_rate')?.value),
    seller_performance: numOrNull(document.getElementById('f_seller_performance')?.value),
    buyer_performance: numOrNull(document.getElementById('f_buyer_performance')?.value),

    special_contract: (document.getElementById('f_special_contract')?.value ?? '').trim() || null,
  };
}

export function collectAllocationPayloadRow(performance_id) {
  const buyerPerf  = numOrNull(document.getElementById('f_buyer_performance')?.value) || 0;
  const sellerPerf = numOrNull(document.getElementById('f_seller_performance')?.value) || 0;
  const row = { performance_id };

  for (let i = 1; i <= 4; i++) {
    const sid = document.getElementById(`select_staff${i}`)?.value || null;
    const bwP = numOrNull(document.getElementById(`f_buyer_weight${i}`)?.value) || 0;
    const swP = numOrNull(document.getElementById(`f_seller_weight${i}`)?.value) || 0;
    const bw = bwP * 0.01, sw = swP * 0.01;

    const buyerAmt  = sid ? Math.round(buyerPerf  * bw) : 0;
    const sellerAmt = sid ? Math.round(sellerPerf * sw) : 0;
    const calcSum   = buyerAmt + sellerAmt;

    row[`staff_id${i}`]       = sid || null;
    row[`buyer_weight${i}`]   = sid ? bw : 0;
    row[`seller_weight${i}`]  = sid ? sw : 0;
    row[`buyer_amount${i}`]   = buyerAmt;
    row[`seller_amount${i}`]  = sellerAmt;
    row[`involvement_sales${i}`] = sid ? calcSum : 0;

    const sumInputEl = document.getElementById(`f_involvement_sales${i}`);
    if (sumInputEl) sumInputEl.value = formatNumberWithCommas(Math.round(calcSum));
  }
  return row;
}

// ==== 자동계산 필드 잠금 ====
export function enforceComputedReadOnly() {
  const lock = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.readOnly = true;
    el.classList.add('bg-gray-50','text-gray-500');
    ['keydown','beforeinput','paste','drop'].forEach(ev => el.addEventListener(ev, e => e.preventDefault()));
  };
  ['f_balance','f_buyer_performance','f_seller_performance'].forEach(lock);
  for (let i = 1; i <= 4; i++) lock(`f_involvement_sales${i}`);
}

// ==== 폼 리셋 ====
export function resetForm() {
  document.querySelectorAll('#sales-drawer input, #sales-drawer textarea, #sales-drawer select')
    .forEach(el => {
      if (el.id === 'f_seller_distribution_rate') { el.value = 30; return; }
      if (el.tagName === 'SELECT') el.value = '';
      else el.value = '';
    });
}

// ==== 지역 드롭다운 ====
let _pcdCache = null;
export async function fetchAllPCD(batchSize = 1000) {
  if (_pcdCache) return _pcdCache;
  await waitForSupabase();
  const supa = window.supabase;
  let from = 0; const all = [];
  while (true) {
    const to = from + batchSize - 1;
    const { data, error } = await supa
      .from('province_city_district')
      .select('province, city, district')
      .order('province', { ascending: true })
      .order('city', { ascending: true })
      .order('district', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length === 0) break;
    from += chunk.length;
  }
  _pcdCache = all;
  return all;
}

export async function initSalesLocationSelects(preset = {}) {
  const provinceEl = document.getElementById('f_province');
  const cityEl     = document.getElementById('f_city');
  const districtEl = document.getElementById('f_district');
  if (!provinceEl || !cityEl || !districtEl) return;

  const selected = {
    province: preset.province ?? provinceEl.value ?? '',
    city:     preset.city     ?? cityEl.value     ?? '',
    district: preset.district ?? districtEl.value ?? '',
  };

  const setPlaceholder = () => {
    provinceEl.innerHTML = `<option value="">시/도</option>`;
    cityEl.innerHTML     = `<option value="">시/군/구</option>`;
    districtEl.innerHTML = `<option value="">읍/면/동</option>`;
  };
  setPlaceholder();

  const collate = new Intl.Collator('ko-KR');
  const uniq = arr => Array.from(new Set(arr));
  const sortKo = arr => arr.sort((a,b)=>collate.compare(a,b));

  const fillSelect = (selectEl, values, selectedVal) => {
    const ph = selectEl.querySelector('option[value=""]');
    selectEl.innerHTML = '';
    if (ph) selectEl.appendChild(ph);
    let list = [...values];
    if (selectedVal && !values.includes(selectedVal)) list = [selectedVal, ...values];
    for (const v of list) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      if (selectedVal && v === selectedVal) opt.selected = true;
      selectEl.appendChild(opt);
    }
  };

  let rows = [];
  try { rows = await fetchAllPCD(); }
  catch {
    fillSelect(provinceEl, selected.province ? [selected.province] : [], selected.province);
    fillSelect(cityEl,     selected.city     ? [selected.city]     : [], selected.city);
    fillSelect(districtEl, selected.district ? [selected.district] : [], selected.district);
    return;
  }

  const citiesByProv = new Map();
  const distsByProvCity = new Map();
  for (const { province, city, district } of rows) {
    if (!province || !city || !district) continue;
    (citiesByProv.get(province) || citiesByProv.set(province, new Set()).get(province)).add(city);
    const key = `${province}|${city}`;
    (distsByProvCity.get(key) || distsByProvCity.set(key, new Set()).get(key)).add(district);
  }

  const provinces = sortKo(uniq(rows.map(r => r.province).filter(Boolean)));
  fillSelect(provinceEl, provinces, selected.province);

  const selProvince = provinceEl.value || selected.province || '';
  const cities = selProvince ? sortKo(uniq([...(citiesByProv.get(selProvince) || [])])) : [];
  fillSelect(cityEl, cities, selected.city);

  const selCity = cityEl.value || selected.city || '';
  const key = `${selProvince}|${selCity}`;
  const districts = (selProvince && selCity) ? sortKo(uniq([...(distsByProvCity.get(key) || [])])) : [];
  fillSelect(districtEl, districts, selected.district);

  provinceEl.onchange = () => {
    const p = provinceEl.value;
    const cities2 = p ? sortKo(uniq([...(citiesByProv.get(p) || [])])) : [];
    fillSelect(cityEl, cities2, '');
    fillSelect(districtEl, [], '');
  };
  cityEl.onchange = () => {
    const p = provinceEl.value;
    const c = cityEl.value;
    const k = `${p}|${c}`;
    const d2 = (p && c) ? sortKo(uniq([...(distsByProvCity.get(k) || [])])) : [];
    fillSelect(districtEl, d2, '');
  };
}

// ==== 합계 계산/표시 (index.html에서 사용) ====
// 전제: index.html이 rows를 window.__RENDERED_ROWS 에 보관하고,
//       선택 컨텍스트를 __selectedStaffId / __selectedAffiliation 에 보관합니다.

function numberOrZero(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : 0;
}

/**
 * 전달된 staffId 집합(staffIdSet)에 속하는 슬롯만 buyer/seller 금액 합산
 * rows: performance 행 배열 (각 행은 performance_allocations 1:1)
 * staffIdSet: Set<string>
 */
export function sumForStaffIds(rows, staffIdSet) {
  let sum = 0;

  for (const row of (rows || [])) {
    const pa = Array.isArray(row.performance_allocations)
      ? row.performance_allocations[0]
      : row.performance_allocations;
    if (!pa) continue;

    for (let i = 1; i <= 4; i++) {
      const sid = pa?.[`staff_id${i}`];
      if (!sid) continue;
      if (!staffIdSet.has(String(sid))) continue;

      const inv = Number(pa?.[`involvement_sales${i}`]);
      const buyerAmt  = Number(pa?.[`buyer_amount${i}`]  || 0);
      const sellerAmt = Number(pa?.[`seller_amount${i}`] || 0);

      // involvement_sales 가 숫자로 채워져 있으면 그걸 우선 사용
      if (!Number.isNaN(inv) && inv > 0) {
        sum += inv;
      } else {
        sum += (buyerAmt + sellerAmt);
      }
    }
  }
  return sum;
}

/**
 * 현재 선택 컨텍스트(직원/지점)에 맞는 합계 계산
 * - 직원 선택시: 그 직원의 관여매출 합
 * - 지점 선택시: 그 지점 소속 직원들의 관여매출 합
 * - 아무것도 선택 안 되면 0
 */
export function computeSalesTotalForCurrentContext() {
  const rows = window.__RENDERED_ROWS || [];
  if (!rows.length) return 0;

  // 1) 직원 단일 선택이 최우선
  if (typeof window.__selectedStaffId !== 'undefined' && window.__selectedStaffId != null) {
    const only = new Set([String(window.__selectedStaffId)]);
    return sumForStaffIds(rows, only);
  }

  // 2) 지점 선택 시: 해당 지점 소속 직원들만 합산
  if (typeof window.__selectedAffiliation !== 'undefined' && window.__selectedAffiliation) {
    const set = (window.__AFFIL_STAFF_IDS && window.__AFFIL_STAFF_IDS[window.__selectedAffiliation]) || null;
    if (!set || set.size === 0) return 0;
    return sumForStaffIds(rows, set);
  }

  // 3) 전체 모드(선택 없음) → 0
  return 0;
}

/** #salesTotal 텍스트 갱신 */
export function updateSalesTotal() {
  const el = document.getElementById('salesTotal');
  if (!el) return;
  const total = computeSalesTotalForCurrentContext();
  el.textContent = '합계: ' + formatNumberWithCommas(total) + '원';
}
