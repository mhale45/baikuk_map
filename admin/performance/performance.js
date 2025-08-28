// performance.js
import {
    formatNumberWithCommas,
    numOrNull,
    intOrNull,
    dateOrNull,
} from '../../../modules/core/format.js';
import { waitForSupabase } from '../../../modules/core/supabase.js';

export const STAFF_NAME_BY_ID = new Map();

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

export async function getMyAffiliation() {
  try {
    await waitForSupabase();
    const { data: sessionRes } = await window.supabase.auth.getSession();
    const user = sessionRes?.session?.user;
    if (!user?.id) return null;
    const { data: prof } = await window.supabase
      .from('staff_profiles')
      .select('affiliation')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    return prof?.affiliation ?? null;
  } catch {
    return null;
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
