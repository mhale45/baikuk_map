import { CONFIG } from './config.js';

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
