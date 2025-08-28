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

export async function loadPerformanceTable() {
    await ensureStaffNameMap();
    try {
    await waitForSupabase();
    const { data, error } = await window.supabase
        .from('performance')
        .select(`
        id, listing_id, listing_title, province, city, district, detail_address,
        floor, unit_info, deal_type, sale_price, deposit_price, monthly_rent, premium_price, area_py,
        contract_date, balance_date,
        down_payment, balance,
        interim_payment1, interim_payment1_date,
        interim_payment2, interim_payment2_date,
        interim_payment3, interim_payment3_date,
        buyer_fee, buyer_tax, buyer_tax_date,
        seller_fee, seller_tax, seller_tax_date,
        expense,
        special_contract,
        performance_allocations:performance_allocations!performance_allocations_performance_id_fkey(
            staff_id1, staff_id2, staff_id3, staff_id4,
            buyer_weight1, buyer_weight2, buyer_weight3, buyer_weight4,
            seller_weight1, seller_weight2, seller_weight3, seller_weight4,
            buyer_amount1, buyer_amount2, buyer_amount3, buyer_amount4,
            seller_amount1, seller_amount2, seller_amount3, seller_amount4
        )
        `)
        .order('contract_date', { ascending: false });

    if (error) {
        console.error('테이블 조회 실패:', error);
        showToast('조회 실패: ' + error.message);
        return;
    }

    const tbody = document.querySelector('#performance-table tbody');
    tbody.innerHTML = '';

    data.forEach(row => {
        // 관계가 1:1이라도 PostgREST가 배열로 줄 수 있으니 방어적으로 처리
        const pa = Array.isArray(row.performance_allocations)
        ? row.performance_allocations[0]
        : row.performance_allocations;

        // 1) 직원/비율 텍스트를 한 셀용으로 준비
        const names  = [];
        const buyerP = [];
        const sellerP= [];
        if (pa) {
        for (let i = 1; i <= 4; i++) {
            const sid = pa[`staff_id${i}`];
            const bw  = pa[`buyer_weight${i}`];   // 0~1
            const sw  = pa[`seller_weight${i}`];  // 0~1
            if (sid && ((bw ?? 0) > 0 || (sw ?? 0) > 0)) {
            names.push(STAFF_NAME_BY_ID.get(sid) || '-');
            buyerP.push(((bw ?? 0) * 100).toFixed(0) + '%');
            sellerP.push(((sw ?? 0) * 100).toFixed(0) + '%');
            }
        }
        }
        if (names.length === 0) { names.push('-'); buyerP.push('-'); sellerP.push('-'); }

        const addr = buildAddress(row);
        const areaDisp = formatArea1(row.area_py);

        // 2) 한 행만 만들어서 넣기
        const tr = document.createElement('tr');
        tr.classList.add('cursor-pointer', 'hover:bg-gray-100');

        // 간단 헬퍼
        const tdHTML = (html) => {
        const td = document.createElement('td');
        td.className = 'border px-2 py-1';
        td.innerHTML = html ?? '';
        return td;
        };
        const tdMulti = (text) => {
        const td = document.createElement('td');
        td.className = 'border px-2 py-1 whitespace-pre-line'; // \n을 줄바꿈으로
        td.textContent = text ?? '';
        return td;
        };

        // 컬럼 추가 (헤더 순서 그대로)
        tr.appendChild(tdHTML(buildListingTitle(row)));
        tr.appendChild(tdHTML(addr));
        tr.appendChild(tdHTML(row.deal_type ?? ''));
        tr.appendChild(tdHTML(buildPriceBlock(row)));
        tr.appendChild(tdHTML(areaDisp));
        tr.appendChild(tdHTML(buildDateBlock(row)));
        tr.appendChild(tdHTML(formatNumberWithCommas(row.buyer_fee) ?? ''));
        tr.appendChild(tdHTML(formatNumberWithCommas(row.buyer_tax) ?? ''));
        tr.appendChild(tdHTML(row.buyer_tax_date ?? ''));
        tr.appendChild(tdHTML(formatNumberWithCommas(row.seller_fee) ?? ''));
        tr.appendChild(tdHTML(formatNumberWithCommas(row.seller_tax) ?? ''));
        tr.appendChild(tdHTML(row.seller_tax_date ?? ''));
        tr.appendChild(tdHTML(formatNumberWithCommas(row.expense) ?? ''));

        // ★ 여기 3칸이 다중라인 셀
        tr.appendChild(tdMulti(names.join('\n')));     // 직원이름
        tr.appendChild(tdMulti(buyerP.join('\n')));    // 클로징
        tr.appendChild(tdMulti(sellerP.join('\n')));   // 매물확보

        tr.addEventListener('click', () => {
        currentPerformanceId = row.id;
        isDownPaymentAutoFilled = false;
        openDrawer();
        fillFormWithPerformance(row);
        fillAllocations(pa || null);
        updateHighlight();
        });

        tbody.appendChild(tr);
    });
    } catch (e) {
    console.error(e);
    showToast('예상치 못한 오류');
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

export function openDrawer() {
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => {
    drawer.classList.remove('translate-x-full');
    });
    initSalesLocationSelects();
}
export function closeDrawer() {
    drawer.classList.add('translate-x-full');
    overlay.classList.add('hidden');
    currentPerformanceId = null;
}