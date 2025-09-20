// modules/auth/profile.js
import { waitForSupabase } from '../core/supabase.js';

/**
 * 현재 로그인된 유저의 ID를 반환
 * @returns {Promise<string|null>}
 */
export async function getCurrentUserId() {
  await waitForSupabase();
  const { data: sessionRes } = await window.supabase.auth.getSession();
  return sessionRes?.session?.user?.id ?? null;
}

/**
 * 로그인된 유저의 소속(affiliation) 조회
 * @returns {Promise<string|null>} affiliation 값 또는 null
 * @example
 * const aff = await getMyAffiliation();
 * if (aff) console.log("내 소속:", aff);
 */
export async function getMyAffiliation() {
  try {
    await waitForSupabase();
    const userId = await getCurrentUserId();
    if (!userId) return null;

    const { data: prof, error } = await window.supabase
      .from('staff_profiles')
      .select('affiliation')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (error) return null;
    return prof?.affiliation ?? null;
  } catch {
    return null;
  }
}
