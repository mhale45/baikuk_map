// performance-module.js

import {
  formatNumberWithCommas,
  numOrNull,
  intOrNull,
  dateOrNull,
  recalcPerformanceFromFees,
  calculateFees,
  STAFF_NAME_BY_ID,
  waitForSupabase,
  showToast
} from './sales-module.js';

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
