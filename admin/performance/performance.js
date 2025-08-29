// performance.js
import {
    formatArea1, intOrNull, dateOrNull, formatNumberWithCommas,numOrNull,
} from '../../../modules/core/format.js';

import { waitForSupabase } from '../../../modules/core/supabase.js';
import { buildListingTitle, buildAddress } from '../../../modules/data/listing.js';
import { client } from '../../../modules/core/supabase.js';

export const STAFF_NAME_BY_ID = new Map();

// 매물등록) 거래유형에 따라 매매가 / 보증금,월세 빨갛게 - 비교 전에 trim
export function updateHighlight() {
    const dealTypeEl = document.getElementById("f_deal_type");

    // ✅ 더 견고한 라벨 선택
    const saleLabel    = document.querySelector("#f_sale_price")?.closest("label")?.querySelector("span");
    const depositLabel = document.querySelector("#f_deposit_price")?.closest("label")?.querySelector("span");
    const monthlyLabel = document.querySelector("#f_monthly_rent")?.closest("label")?.querySelector("span");

    if (!dealTypeEl) return;
    const type = (dealTypeEl.value || '').trim();

    // reset
    if (saleLabel)    { saleLabel.textContent    = "매매가"; saleLabel.classList.remove("text-red-600"); saleLabel.classList.add("text-gray-600"); }
    if (depositLabel) { depositLabel.textContent = "보증금"; depositLabel.classList.remove("text-red-600"); depositLabel.classList.add("text-gray-600"); }
    if (monthlyLabel) { monthlyLabel.textContent = "월세";   monthlyLabel.classList.remove("text-red-600"); monthlyLabel.classList.add("text-gray-600"); }

    if (type === "월세") {
    if (depositLabel) { depositLabel.textContent = "보증금*"; depositLabel.classList.replace("text-gray-600","text-red-600"); }
    if (monthlyLabel) { monthlyLabel.textContent = "월세*";   monthlyLabel.classList.replace("text-gray-600","text-red-600"); }
    } else if (type === "매매") {
    if (saleLabel) { saleLabel.textContent = "매매가*"; saleLabel.classList.replace("text-gray-600","text-red-600"); }
    }
}

export function buildPriceBlock(row) {
    const parts = [];
    const pushIf = (label, v) => {
    const n = Number(v || 0);
    if (n > 0) parts.push(`${label} ${formatNumberWithCommas(n)}`);
    };

    pushIf('매매가',  row.sale_price);
    pushIf('보증금',  row.deposit_price);
    pushIf('월세',    row.monthly_rent);
    pushIf('권리금',  row.premium_price);

    return parts.join('<br>'); // 줄바꿈으로 구분
}

export function buildDateBlock(row) {
    const parts = [];

    if (row.contract_date) parts.push(`계약 ${row.contract_date}`);

    // 중도금 1~3
    if (row.interim_payment1_date) {
        const amt = row.interim_payment1 ? formatNumberWithCommas(row.interim_payment1) : '';
        parts.push(`중도금1 ${row.interim_payment1_date}`);
    }
    if (row.interim_payment2_date) {
        const amt = row.interim_payment2 ? formatNumberWithCommas(row.interim_payment2) : '';
        parts.push(`중도금2 ${row.interim_payment2_date}`);
    }
    if (row.interim_payment3_date) {
        const amt = row.interim_payment3 ? formatNumberWithCommas(row.interim_payment3) : '';
        parts.push(`중도금3 ${row.interim_payment3_date}`);
    }
    
    if (row.balance_date)  parts.push(`잔금 ${row.balance_date}`);

    return parts.join('<br>'); // 줄바꿈
}

/**
 * 직원 선택 박스(select)들을 Supabase에서 불러온 직원 데이터로 채움
 * @param {string|null} myAffiliation - 내 소속(있으면 해당 소속이 맨 위로 정렬됨)
 * @example
 * await populateAllStaffSelects("강남지점");
 * // -> select_staff1~4 박스가 직원명으로 채워짐
 */
export async function populateAllStaffSelects(myAffiliation=null) {
    try {
        await waitForSupabase();
        const { data, error } = await window.supabase
            .from('staff_profiles')
            .select('id, name, affiliation')
            .is('leave_date', null)
            .order('affiliation', { ascending: true });

        if (error) { console.error('직원 목록 불러오기 실패:', error); return; }

        // 이름맵 업데이트
        STAFF_NAME_BY_ID.clear();
        for (const r of data) STAFF_NAME_BY_ID.set(r.id, r.name);

        // 지점별 그룹화 + select 채우기 (기존 로직 동일)
        const grouped = {};
        for (const { id, name, affiliation } of data) {
            (grouped[affiliation] ||= []).push({ id, name });
        }
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
    } catch (e) { console.error(e); }
}

// - select + buyer/seller weight 입력 필드와 성과 자동계산 기능 포함
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

    // 🔒 결과 입력은 자동계산 전용(수정 불가 + 회색 스타일)
    resultInput.readOnly = true;
    resultInput.classList.add('bg-gray-50','text-gray-500');
    ['keydown','beforeinput','paste','drop'].forEach(ev =>
        resultInput.addEventListener(ev, e => e.preventDefault())
    );

    function calculatePerformance() {
    const buyerPerf = numOrNull(document.getElementById('f_buyer_performance')?.value) || 0;
    const sellerPerf = numOrNull(document.getElementById('f_seller_performance')?.value) || 0;

    const bw = parseFloat(buyerInput.value) || 0;
    const sw = parseFloat(sellerInput.value) || 0;

    const result = (buyerPerf * bw * 0.01) + (sellerPerf * sw * 0.01);
    if (!resultInput) return; // 안전 가드
        resultInput.value = formatNumberWithCommas(Math.round(result));
    }

    buyerInput.addEventListener('input', calculatePerformance);
    sellerInput.addEventListener('input', calculatePerformance);

    return root;
}
/**
 * 계약금, 중도금, 잔금 계산 로직
 * - 계약금은 기본적으로 보증금의 10%
 * - 자동으로 balance(잔금) 필드 업데이트
 * @param {object} opts
 * @param {boolean} [opts.forceDownPaymentUpdate=false] 강제 계약금 재계산 여부
 * @example
 * calculateDownPaymentAndBalance();
 * // -> f_balance input 값이 업데이트됨
 */
export function calculateDownPaymentAndBalance({ forceDownPaymentUpdate = false } = {}) {
  const deposit = numOrNull(document.getElementById('f_deposit_price')?.value) || 0;
  const downPaymentInput = document.getElementById('f_down_payment');

  if (!window.isDownPaymentAutoFilled || forceDownPaymentUpdate) {
    const downPayment = Math.round(deposit * 0.1);
    downPaymentInput.value = formatNumberWithCommas(downPayment);
    window.isDownPaymentAutoFilled = true;
  }

  const downPayment = numOrNull(downPaymentInput?.value) || 0;
  const i1 = numOrNull(document.getElementById('f_interim_payment1')?.value) || 0;
  const i2 = numOrNull(document.getElementById('f_interim_payment2')?.value) || 0;
  const i3 = numOrNull(document.getElementById('f_interim_payment3')?.value) || 0;

  const balance = deposit - (downPayment + i1 + i2 + i3);
  document.getElementById('f_balance').value = formatNumberWithCommas(Math.max(balance, 0));
}

/**
 * STAFF_NAME_BY_ID 맵이 비어있으면 Supabase에서 직원 목록을 불러 채움
 * @example
 * await ensureStaffNameMap();
 * console.log(STAFF_NAME_BY_ID.get(123)); // "홍길동"
 */
export async function ensureStaffNameMap() {
  if (STAFF_NAME_BY_ID.size > 0) return;
  await waitForSupabase();
  const { data, error } = await window.supabase
    .from('staff_profiles')
    .select('id, name')
    .is('leave_date', null);
  if (!error && data) {
    STAFF_NAME_BY_ID.clear();
    data.forEach(({id, name}) => STAFF_NAME_BY_ID.set(id, name));
  }
}

// ✅ 수수료 → (클로징/물건) 매출 재계산 + '거래관련 사용비용' 비율 차감 로직 반영
export function recalcPerformanceFromFees() {
  const buyerFee = numOrNull(document.getElementById("f_buyer_fee")?.value) || 0;
  const sellerFee = numOrNull(document.getElementById("f_seller_fee")?.value) || 0;
  const distRate  = numOrNull(document.getElementById("f_seller_distribution_rate")?.value) || 0;
  const expense   = numOrNull(document.getElementById("f_expense")?.value) || 0;

  // 1) 기존 규칙으로 '총 매출'을 클로징/물건으로 분배 (물건분 = 매도인 수수료 × distRate%)
  const sellerPerfGross = sellerFee * (distRate * 0.01);
  const buyerPerfGross  = (buyerFee + sellerFee) - sellerPerfGross;

  // 2) '거래관련 사용비용' 분배 규칙
  //    물건 매출 차감 몫 : sellerFee * 30%
  //    클로징 매출 차감 몫: buyerFee + sellerFee * 70%
  //    → 두 몫의 합은 (buyerFee + sellerFee)
  const denom = buyerFee + sellerFee;
  let expenseToSeller = 0;
  let expenseToBuyer  = 0;
  if (denom > 0 && expense > 0) {
    expenseToSeller = expense * ((sellerFee * 0.30) / denom);
    expenseToBuyer  = expense * ((buyerFee + sellerFee * 0.70) / denom);
  }

  // 3) 차감 적용 (음수 방지)
  const sellerPerformance = Math.max(sellerPerfGross - expenseToSeller, 0);
  const buyerPerformance  = Math.max(buyerPerfGross  - expenseToBuyer , 0);

  // 4) 화면 반영
  document.getElementById("f_seller_performance").value = formatNumberWithCommas(Math.round(sellerPerformance));
  document.getElementById("f_buyer_performance").value  = formatNumberWithCommas(Math.round(buyerPerformance));
}


// ✅ 수수료 자동계산 (매매가/월세/보증금 기반)
export function calculateFees() {
  const type = (document.getElementById("f_deal_type")?.value || '').trim();
  const salePrice   = numOrNull(document.getElementById("f_sale_price")?.value) || 0;
  const deposit     = numOrNull(document.getElementById("f_deposit_price")?.value) || 0;
  const monthlyRent = numOrNull(document.getElementById("f_monthly_rent")?.value) || 0;

  let 기준금액 = 0;
  if (type === "매매") 기준금액 = salePrice;
  else if (type === "월세") 기준금액 = monthlyRent * 100 + deposit;
  else return;

  const fee = 기준금액 >= 50_000_000 ? 기준금액 * 0.009 : 기준금액 * 0.007;
  const buyerFeeEl = document.getElementById("f_buyer_fee");
  const sellerFeeEl = document.getElementById("f_seller_fee");

  buyerFeeEl.value  = formatNumberWithCommas(Math.round(fee));
  sellerFeeEl.value = formatNumberWithCommas(Math.round(fee));

  recalcPerformanceFromFees();
}

// 분배비율 점검 함수
export function validateTotalWeight() {
    let totalBuyer = 0;
    let totalSeller = 0;

    for (let i = 1; i <= 4; i++) {
    totalBuyer += numOrNull(document.getElementById(`f_buyer_weight${i}`)?.value) || 0;
    totalSeller += numOrNull(document.getElementById(`f_seller_weight${i}`)?.value) || 0;
    }

    const buyerOk = totalBuyer === 100;
    const sellerOk = totalSeller === 100;

    if (!buyerOk && !sellerOk) {
    showToastGreenRed('클로징과 매물확보 비율의 합이 각각 100%이어야 합니다.');
    return false;
    }

    if (!buyerOk) {
    showToastGreenRed('클로징(매수) 비율의 합이 100%가 아닙니다.');
    return false;
    }

    if (!sellerOk) {
    showToastGreenRed('매물확보(매도) 비율의 합이 100%가 아닙니다.');
    return false;
    }

    return true;
}

// 특약사항 오토 리사이즈 함수 + 바인딩
export function enableAutoGrowTextArea(el) {
    if (!el) return;
    const grow = () => {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    };
    // 입력/붙여넣기/값 변경 시 늘어나게
    el.addEventListener('input', grow);
    el.addEventListener('change', grow);
    // 처음 로드될 때도 한 번 맞춤
    requestAnimationFrame(grow);
    // 레이아웃/폭이 바뀔 때 재계산(선택)
    window.addEventListener('resize', grow);
}

export function collectPerformancePayload() {
    return {
    listing_id: intOrNull(document.getElementById('f_listing_id')?.value),
    deal_type: (document.getElementById('f_deal_type')?.value ?? '').trim() || null,
    listing_title: (document.getElementById('f_listing_title')?.value ?? '').trim() || null,
    province: (document.getElementById('f_province')?.value ?? '').trim() || null,
    city: (document.getElementById('f_city')?.value ?? '').trim() || null,
    district: (document.getElementById('f_district')?.value ?? '').trim() || null,
    detail_address: (document.getElementById('f_detail_address')?.value ?? '').trim() || null,

    contract_date: dateOrNull(document.getElementById('f_contract_date')?.value),

    down_payment: numOrNull(document.getElementById('f_down_payment')?.value),
    balance: numOrNull(document.getElementById('f_balance')?.value),
    interim_payment1: numOrNull(document.getElementById('f_interim_payment1')?.value),
    interim_payment2: numOrNull(document.getElementById('f_interim_payment2')?.value),
    interim_payment3: numOrNull(document.getElementById('f_interim_payment3')?.value),
    // ✅ 새로 추가된 날짜 3개
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

// ✅ 새 함수: 단일 행(upsert) + 금액 자동 계산(입력값 우선)
export function collectAllocationPayloadRow(performance_id) {
  const buyerPerf  = numOrNull(document.getElementById('f_buyer_performance')?.value) || 0;
  const sellerPerf = numOrNull(document.getElementById('f_seller_performance')?.value) || 0;

  const row = { performance_id };

  for (let i = 1; i <= 4; i++) {
    const sid = document.getElementById(`select_staff${i}`)?.value || null;
    const bwP = numOrNull(document.getElementById(`f_buyer_weight${i}`)?.value) || 0; // % 단위
    const swP = numOrNull(document.getElementById(`f_seller_weight${i}`)?.value) || 0;

    const bw = bwP * 0.01; // 0~1
    const sw = swP * 0.01;

    // 기본 금액(계산값)
    const buyerAmt  = sid ? Math.round(buyerPerf  * bw) : 0;
    const sellerAmt = sid ? Math.round(sellerPerf * sw) : 0;
    const calcSum   = buyerAmt + sellerAmt;

    row[`staff_id${i}`]       = sid || null;
    row[`buyer_weight${i}`]   = sid ? bw : 0;
    row[`seller_weight${i}`]  = sid ? sw : 0;
    row[`buyer_amount${i}`]   = buyerAmt;
    row[`seller_amount${i}`]  = sellerAmt;

    // 🔒 합계 입력값은 무시하고 항상 계산값으로 저장
    row[`involvement_sales${i}`] = sid ? calcSum : 0;

    // 화면에도 계산값을 강제로 반영(콤마)
    const sumInputEl = document.getElementById(`f_involvement_sales${i}`);
    if (sumInputEl) sumInputEl.value = formatNumberWithCommas(Math.round(calcSum));
  }

  return row;
}

// === 자동계산 필드 잠금 ===
export function enforceComputedReadOnly() {
  const lock = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.readOnly = true;
    el.classList.add('bg-gray-50','text-gray-500');
    ['keydown','beforeinput','paste','drop'].forEach(ev =>
      el.addEventListener(ev, e => e.preventDefault())
    );
  };

  // 잔금 + 매출(클로징/물건)
  ['f_balance','f_buyer_performance','f_seller_performance'].forEach(lock);

  // 직원별 총매출
  for (let i = 1; i <= 4; i++) lock(`f_involvement_sales${i}`);
}

export function resetForm() {
    document.querySelectorAll('#sales-drawer input, #sales-drawer textarea, #sales-drawer select')
    .forEach(el => {
        if (el.id === 'f_seller_distribution_rate') { el.value = 30; return; }
        if (el.tagName === 'SELECT') el.value = '';
        else el.value = '';
    });
}

// 3) 조회 함수
export async function fetchListingAndFill(listingId) {
    try { await waitForSupabase(); } 
    catch { showToastGreenRed('Supabase 초기화 지연'); return; }

    const n = intOrNull(listingId);
    if (n === null) return; // 숫자 아닐 때 종료

    const selectCols = Object.keys(FIELD_MAP).join(', ');

    // 1) 지정 컬럼으로 조회
    let { data, error } = await window.supabase
    .from('public_baikuk_view')
    .select(selectCols)
    .eq('listing_id', n)
    .maybeSingle();

    if (error) {
    const msg = (error.message || '').toLowerCase();

    // 컬럼 문제 → 전체(*) 재조회 후 교차 매핑
    if (msg.includes('does not exist') || msg.includes('column')) {
        const retry = await window.supabase
        .from('public_baikuk_view')
        .select('*')
        .eq('listing_id', n)
        .maybeSingle();

        if (retry.error) {
        showToastGreenRed('매물 조회 실패: ' + (retry.error.message || ''));
        return;
        }
        if (!retry.data) { showToastGreenRed('해당 매물번호를 찾을 수 없습니다.'); return; }

        const row = retry.data;
        fillFormFromRow(row);
        calculateFees();
        calculateDownPaymentAndBalance();

        // 선택값과 무관하게 드롭다운을 강제로 맞춤
        initSalesLocationSelects({
        province: row.province, city: row.city, district: row.district
        });
        showToastGreenRed('매물 정보 자동 채움 완료(교차 매핑)', { ok: true });
        return;
    }

    if (msg.includes('relation') && msg.includes('does not exist')) {
        showToastGreenRed('뷰를 찾을 수 없습니다. public 스키마의 public_baikuk_view 확인 필요');
    }
    return;
    }

    // 2) 정상 채움
    fillFormFromRow(data);
    calculateFees();
    calculateDownPaymentAndBalance();

    // 선택값과 상관없이 드롭다운을 해당 값으로 재구성+선택
    initSalesLocationSelects({
    province: data.province, city: data.city, district: data.district
    });

    // ✅ 거래유형에 맞춰 라벨/색 즉시 갱신
    if (typeof updateHighlight === "function") updateHighlight();
    showToastGreenRed('매물 정보 자동 채움 완료', { ok: true });
}

let _pcdCache = null;

/** province_city_district 테이블 전체 로드 + 캐시 */
export async function fetchAllPCD(batchSize = 1000) {
  if (_pcdCache) return _pcdCache;

  await waitForSupabase();
  const supa = window.supabase;

  let from = 0;
  const all = [];
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


// ===== 지역(시/도-시/군/구-읍/면/동) 의존형 드롭다운 (sales 폼용) =====
export async function initSalesLocationSelects(preset = {}) {
    const provinceEl = document.getElementById('f_province');
    const cityEl     = document.getElementById('f_city');
    const districtEl = document.getElementById('f_district');
    if (!provinceEl || !cityEl || !districtEl) return;

    // 현재 값(자동채움으로 미리 들어온 값이 있으면 우선 사용)
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

    // 정렬/유틸
    const collate = new Intl.Collator('ko-KR');
    const uniq = arr => Array.from(new Set(arr));
    const sortKo = arr => arr.sort((a,b)=>collate.compare(a,b));

    const fillSelect = (selectEl, values, selectedVal) => {
    // placeholder 유지 후 값 채우기
    const ph = selectEl.querySelector('option[value=""]');
    selectEl.innerHTML = '';
    if (ph) selectEl.appendChild(ph);

    let list = [...values];
    if (selectedVal && !values.includes(selectedVal)) list = [selectedVal, ...values];

    for (const v of list) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        if (selectedVal && v === selectedVal) opt.selected = true;
        selectEl.appendChild(opt);
    }
    };

    // 데이터 로드
    let rows = [];
    try {
    if (typeof fetchAllPCD !== 'function') throw new Error('fetchAllPCD가 정의되어 있지 않음');
    rows = await fetchAllPCD(); // 필요시 상한 조정
    } catch (e) {
    console.error('지역 데이터 로드 실패:', e);
    // 실패 시에도 현재 선택값만이라도 보이도록
    fillSelect(provinceEl, selected.province ? [selected.province] : [], selected.province);
    fillSelect(cityEl,     selected.city     ? [selected.city]     : [], selected.city);
    fillSelect(districtEl, selected.district ? [selected.district] : [], selected.district);
    return;
    }

    // 맵 구성
    const citiesByProv = new Map();            // province -> Set(cities)
    const distsByProvCity = new Map();         // `${province}|${city}` -> Set(districts)
    for (const { province, city, district } of rows) {
    if (!province || !city || !district) continue;
    if (!citiesByProv.has(province)) citiesByProv.set(province, new Set());
    citiesByProv.get(province).add(city);

    const key = `${province}|${city}`;
    if (!distsByProvCity.has(key)) distsByProvCity.set(key, new Set());
    distsByProvCity.get(key).add(district);
    }

    const provinces = sortKo(uniq(rows.map(r => r.province).filter(Boolean)));

    // 1) province
    fillSelect(provinceEl, provinces, selected.province);

    // 2) city (province에 종속)
    const selProvince = provinceEl.value || selected.province || '';
    const cities = selProvince ? sortKo(uniq([...(citiesByProv.get(selProvince) || [])])) : [];
    fillSelect(cityEl, cities, selected.city);

    // 3) district (province+city에 종속)
    const selCity = cityEl.value || selected.city || '';
    const key = `${selProvince}|${selCity}`;
    const districts = (selProvince && selCity) ? sortKo(uniq([...(distsByProvCity.get(key) || [])])) : [];
    fillSelect(districtEl, districts, selected.district);

    // 이벤트 바인딩
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