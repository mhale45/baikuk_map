// performance.js
import {
    formatArea1, formatNumberWithCommas,numOrNull,
} from '../../../modules/core/format.js';

import { waitForSupabase } from '../../../modules/core/supabase.js';
import { buildListingTitle, buildAddress } from '../../../modules/data/listing.js';

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
    if (row.balance_date)  parts.push(`잔금 ${row.balance_date}`);

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
  const resultInput = root.querySelectorAll("input")[3];

  select.id = `select_staff${index}`;
  buyerInput.id = `f_buyer_weight${index}`;
  sellerInput.id = `f_seller_weight${index}`;

  function calculatePerformance() {
    const buyerPerf = numOrNull(document.getElementById('f_buyer_performance')?.value) || 0;
    const sellerPerf = numOrNull(document.getElementById('f_seller_performance')?.value) || 0;

    const bw = parseFloat(buyerInput.value) || 0;
    const sw = parseFloat(sellerInput.value) || 0;

    const result = (buyerPerf * bw * 0.01) + (sellerPerf * sw * 0.01);
    resultInput.value = Math.round(result);
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

// ✅ 자동계산: 수수료 → 매출 계산
export function recalcPerformanceFromFees() {
  const buyerFee = numOrNull(document.getElementById("f_buyer_fee")?.value) || 0;
  const sellerFee = numOrNull(document.getElementById("f_seller_fee")?.value) || 0;
  const distRate  = numOrNull(document.getElementById("f_seller_distribution_rate")?.value) || 0;

  const sellerPerformance = sellerFee * distRate * 0.01;
  const buyerPerformance  = (buyerFee + sellerFee) - sellerPerformance;

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
