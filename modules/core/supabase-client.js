import { createClient as _createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { CONFIG } from './config.js';

// 기본 정리(제로폭, 제어문자, 공백 제거)
const basicSanitize = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width
    .replace(/[\r\n\t ]/g, '')             // controls + spaces
    .trim();

// JWT/Anon Key 허용 문자만 남기기 (A-Z a-z 0-9 _ - .)
const toJwtSafe = (s) => (String(s ?? '').match(/[A-Za-z0-9._-]+/g) || []).join('');

// 문제 되는 문자들 출력용(디버그에만)
const diffChars = (orig, cleaned) => {
  const set = new Set(cleaned.split(''));
  return [...orig].filter(ch => !set.has(ch));
};

// 1) 원본
const RAW_URL = CONFIG?.SUPABASE_URL ?? '';
const RAW_KEY = CONFIG?.SUPABASE_ANON_KEY ?? '';

// 2) 1차 정리
let SUPABASE_URL = basicSanitize(RAW_URL);
let SUPABASE_KEY = basicSanitize(RAW_KEY);

// 3) KEY는 JWT-safe 문자만 유지(비ASCII/한글/따옴표 등 제거)
const SAFE_KEY = toJwtSafe(SUPABASE_KEY);
if (SAFE_KEY !== SUPABASE_KEY) {
  try {
    const removed = diffChars(SUPABASE_KEY, SAFE_KEY);
    console.warn('[supabase-client] Anon key contained invalid chars and was cleaned. Removed:', removed);
  } catch {}
  SUPABASE_KEY = SAFE_KEY;
}

// 4) URL은 공백/개행만 지웠으면 충분 (한글 도메인 쓰지 않음)
if (!/^https?:\/\/[a-z0-9.-]+/i.test(SUPABASE_URL)) {
  console.warn('[supabase-client] SUPABASE_URL looks unusual:', SUPABASE_URL);
}

// 5) 클라이언트 생성
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
