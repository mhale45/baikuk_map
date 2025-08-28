// /modules/core/supabase-client.js
import { createClient as _createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { CONFIG } from './config.js';

// 보이지 않는 공백/제어문자 제거
const sanitize = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width
    .replace(/[\r\n\t]/g, '')              // control chars
    .trim();

// 헤더에 넣어도 안전한지 검사 (ISO-8859-1 범위 밖 문자가 있는지)
const assertIso88591 = (s, label) => {
  if (/[^\x00-\xFF]/.test(s)) {
    throw new TypeError(`${label} has non ISO-8859-1 code point`);
  }
  if (/[\r\n]/.test(s)) {
    throw new TypeError(`${label} contains newline`);
  }
};

// 입력 정리
const RAW_URL = CONFIG?.SUPABASE_URL;
const RAW_KEY = CONFIG?.SUPABASE_ANON_KEY;

const SUPABASE_URL = sanitize(RAW_URL);
const SUPABASE_KEY = sanitize(RAW_KEY);

// 검증 (문제 있으면 여기서 명확히 throw)
assertIso88591(SUPABASE_URL, 'SUPABASE_URL');
assertIso88591(SUPABASE_KEY, 'SUPABASE_ANON_KEY');

// 안전 클라이언트 생성
export const client = _createClient(SUPABASE_URL, SUPABASE_KEY);

// === 유틸 ===
export async function getSession() {
  const { data: { session } } = await client.auth.getSession();
  return session ?? null;
}

export async function rpc(name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}
