// modules/data/staff.js
import { waitForSupabase } from '../core/supabase.js';

/** 직원 이름 캐시: id -> name */
export const STAFF_NAME_BY_ID = new Map();

/**
 * 재직 중인 직원의 기본 정보(id, name, affiliation) 목록을 가져옴
 * @returns {Promise<Array<{id:number,name:string,affiliation:string}>>}
 * @example
 * const rows = await getActiveStaffBasics();
 */
export async function getActiveStaffBasics() {
  await waitForSupabase();
  const { data, error } = await window.supabase
    .from('staff_profiles')
    .select('id, name, affiliation')
    .is('leave_date', null)
    .order('affiliation', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * STAFF_NAME_BY_ID 캐시를 주어진 rows로 채움
 * @param {Array<{id:number,name:string}>} rows
 * @example
 * const rows = await getActiveStaffBasics();
 * hydrateStaffNameMap(rows);
 */
export function hydrateStaffNameMap(rows) {
  STAFF_NAME_BY_ID.clear();
  for (const r of rows) STAFF_NAME_BY_ID.set(r.id, r.name);
}
