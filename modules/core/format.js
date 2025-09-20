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
// 입력할 때마다 숫자 콤마 변환 (커서 유지 + IME 대응)
export function attachCommaFormatter(idOrEl) {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (!el) return;

  let composing = false; // IME 조합 중 여부

  const sanitize = (s) => s.replace(/[^\d.-]/g, ''); // 숫자/마이너스/소수점만 유지
  const format = (s) => {
    // 입력 도중의 특수 상태는 그대로 허용
    if (s === '' || s === '-' || s === '.' || s === '-.') return s;
    const neg = s.startsWith('-');
    const [intPart, decPart = ''] = s.replace('-', '').split('.');
    // 정수부 콤마 삽입
    const withComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + withComma + (decPart ? '.' + decPart : '');
  };

  // 이전 커서 왼쪽에 '숫자'가 몇 개 있었는지 기준으로 새 커서 계산
  const calcNewCaret = (oldV, newV, oldPos) => {
    // oldPos 이전의 숫자 개수
    const targetDigits = (oldV.slice(0, oldPos).match(/\d/g) || []).length;

    // 숫자가 하나도 없던 자리면, 새 문자열의 첫 숫자 위치로
    if (targetDigits === 0) {
      const firstDigit = newV.search(/\d/);
      return firstDigit >= 0 ? firstDigit : 0;
    }

    // 새 문자열에서 같은 개수의 숫자를 지난 지점에 커서 배치
    let seen = 0;
    for (let i = 0; i < newV.length; i++) {
      if (/\d/.test(newV[i])) seen++;
      if (seen === targetDigits) return i + 1;
    }
    return newV.length; // fallback: 맨 끝
  };

  const handle = () => {
    if (composing) return; // 조합 중에는 포맷 금지
    const oldV = el.value;
    const oldPos = el.selectionStart ?? oldV.length;

    const raw = sanitize(oldV);
    const next = format(raw);

    if (next !== oldV) {
      const newPos = calcNewCaret(oldV, next, oldPos);
      el.value = next;
      if (typeof el.setSelectionRange === 'function') {
        el.setSelectionRange(newPos, newPos);
      }
    }
  };

  // IME(한글 등) 조합 이벤트
  el.addEventListener('compositionstart', () => { composing = true; });
  el.addEventListener('compositionend',   () => { composing = false; handle(); });

  // 입력 시마다 포맷 (조합 중 제외)
  el.addEventListener('input', handle);

  // 포커스 잃으면 최종 정리
  el.addEventListener('blur', () => {
    if (composing) return;
    el.value = format(sanitize(el.value));
  });

  // 초기 값도 정리
  el.value = format(sanitize(el.value));
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