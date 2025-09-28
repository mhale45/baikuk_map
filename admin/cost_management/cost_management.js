// /admin/cost_management/cost_management.js

import { client as supabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';

// 현재 로그인 사용자의 권한 확인
async function resolveMyAuthority() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      // 로그인 사용자 없음 → listings로 이동
      window.location.href = '/admin/listings/';
      return;
    }

    const { data: rows, error } = await supabase
      .from('staff_profiles')
      .select('authority, affiliation')
      .eq('user_id', user.id)
      .is('leave_date', null);

    if (error) throw error;

    if (!rows || rows.length === 0) {
      // 소속이 없으면 listings로 이동
      window.location.href = '/admin/listings/';
      return;
    }

    // 관리자/지점장/직원 여부 확인 (지금은 단순히 로그인 체크만 필요하므로 유지)
    const myRole = rows.some(r => r.authority === '관리자') ? '관리자'
                  : rows.some(r => r.authority === '지점장') ? '지점장'
                  : '직원';

    console.log('[권한 확인]', myRole, rows.map(r => r.affiliation).join(', '));

  } catch (e) {
    console.error('권한 조회 실패:', e);
    showToastGreenRed?.('권한 확인 실패');
    // 오류 발생 시 listings로 이동
    window.location.href = '/admin/listings/';
  }
}

// 초기 실행
resolveMyAuthority();
