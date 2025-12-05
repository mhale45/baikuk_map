// modules/core/supabase.js

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.3/+esm';
import { CONFIG } from './config.js';

export const client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// 세션 유틸
export async function getSession() {
  const { data: { session } } = await client.auth.getSession();
  return session ?? null;
}

// RPC 래퍼(선택)
export async function rpc(name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}

/**
 * Supabase 준비되기까지 대기하는 공통 헬퍼
 */
export function waitForSupabase(timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    if (window.supabase) return resolve(window.supabase);

    function onReady() {
      document.removeEventListener('supabase-ready', onReady);
      resolve(window.supabase);
    }

    document.addEventListener('supabase-ready', onReady);

    const iv = setInterval(() => {
      if (window.supabase) {
        clearInterval(iv);
        document.removeEventListener('supabase-ready', onReady);
        resolve(window.supabase);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        document.removeEventListener('supabase-ready', onReady);
        reject(new Error('Supabase not ready'));
      }
    }, 50);
  });
}
