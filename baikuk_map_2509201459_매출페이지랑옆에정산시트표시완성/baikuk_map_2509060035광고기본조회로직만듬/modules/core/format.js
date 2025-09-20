//admin/modules/core/format.js

export function formatKoreanMoney(value){
  if (value===undefined || value===null || value==='') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  if (num >= 10000) {
    const eok = Math.floor(num/10000);
    const man = num % 10000;
    return `${eok}억${man>0 ? ' '+man.toLocaleString('ko-KR') : ''}`;
  }
  return num.toLocaleString('ko-KR');
}

export function formatDealPrice(l){
  if (l.deal_type==='매매') return formatKoreanMoney(l.sale_price);
  if (l.deal_type==='월세') return `${formatKoreanMoney(l.deposit_price)} / ${formatKoreanMoney(l.monthly_rent)}`;
  return '';
}

export function formatFloor(floor, total_floors){
  if (floor===undefined||floor===null||floor==='') return '-';
  const floorStr = floor < 0 ? `B${Math.abs(floor)}` : String(floor);
  return `${floorStr}${total_floors ? `/${total_floors}층` : ''}`;
}
/**
 * ✅ 숫자/날짜 포맷 유틸 모음
 * : 문자열 숫자 → 숫자 변환, 콤마 포맷, 날짜 문자열 처리 등
 *
 * 📌 사용 예시:
 *   numOrNull("1,200") → 1200
 *   intOrNull("1,234.56") → 1234
 *   dateOrNull(" 2024-01-01 ") → "2024-01-01"
 *   formatNumberWithCommas(1234567) → "1,234,567"
 */

// 입력할 때 마다 숫자 콤마 변환
export function attachCommaFormatter(id) {
  const el = document.getElementById(id);
  if (!el) return;

  // 입력할 때마다 숫자 변환 + 콤마 표시
  el.addEventListener("input", () => {
    const cursor = el.selectionStart;
    const raw = el.value.replace(/,/g, '');
    if (!raw) { el.value = ''; return; }
    const num = Number(raw);
    if (!isNaN(num)) {
      el.value = formatNumberWithCommas(num);
      // 커서 위치 보정 (선택사항)
      el.setSelectionRange(cursor, cursor);
    }
  });

  // 포커스 잃었을 때도 포맷 적용
  el.addEventListener("blur", () => {
    el.value = formatNumberWithCommas(el.value);
  });
}

// 헬퍼: 면적 소수점 1자리
export function formatArea1(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : '';
}

// ✅ 숫자 문자열 → 숫자 (null 허용)
export const numOrNull = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replaceAll(',', ''));
  return Number.isFinite(n) ? n : null;
};

// ✅ 숫자 문자열 → 정수 (소수점 버림)
export const intOrNull = (v) => {
  const n = numOrNull(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

// ✅ 날짜 문자열이 공백이면 null 반환
export const dateOrNull = (v) => {
  const s = (v ?? '').trim();
  return s ? s : null;
};

// ✅ 숫자에 천 단위 콤마 추가
export const formatNumberWithCommas = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(num) ? num.toLocaleString('ko-KR') : value;
};

// [ADD] 여러 input id의 현재 값을 강제로 콤마 포맷 (readonly 포함)
export function formatIdsWithCommas(ids = []) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const n = Number(String(el.value ?? '').replace(/,/g, '')) || 0;
    el.value = formatNumberWithCommas(n);
  });
}