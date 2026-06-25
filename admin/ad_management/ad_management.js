import { client as supabase, waitForSupabase } from '../../modules/core/supabase.js';

// 전역 객체로 supabase 노출 (타 스크립트와의 호환성)
window.supabase = supabase;

(async () => {
  try {
    await waitForSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      showLoginScreen();
      return;
    }

    // 로그인된 사용자가 있을 경우 권한 확인 실행
    await checkUserAuthority(session.user);

  } catch (e) {
    console.error('초기 세션 확인 중 예외 발생:', e);
    showLoginScreen();
  }
})();

// 로그인 화면 표시 및 이벤트 바인딩
function showLoginScreen() {
  const $screen = document.getElementById('auth-screen');
  const $email  = document.getElementById('auth-email');
  const $pw     = document.getElementById('auth-password');
  const $login  = document.getElementById('auth-login');
  const $close  = document.getElementById('auth-close');
  const $err    = document.getElementById('auth-error');

  $screen?.classList.remove('hidden');

  const showError = (msg) => {
    if ($err) {
      $err.textContent = String(msg || '로그인 실패');
      $err.classList.remove('hidden');
    }
  };

  const doLogin = async () => {
    try {
      if (!$login) return;
      $login.disabled = true;
      $login.textContent = '로그인 중...';
      $err?.classList.add('hidden');

      const emailVal = ($email?.value || '').trim();
      const pwVal = ($pw?.value || '').trim();

      if (!emailVal || !pwVal) {
        throw new Error('이메일과 비밀번호를 입력해 주세요.');
      }

      // 1) 이메일/비번 로그인
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailVal,
        password: pwVal
      });
      if (error) throw error;

      // 2) 세션 등록 / 허용 검사 (기존 listings.js와 일관성 유지)
      try {
        await supabase.rpc('register_session', {
          device_label: (navigator.platform + ' ' + (navigator.vendor || '')).trim(),
          user_agent: navigator.userAgent
        });
      } catch (_) { /* ignore */ }

      let allowed = true;
      try {
        const { data: isAllowed } = await supabase.rpc('is_session_allowed');
        if (isAllowed === false) allowed = false;
      } catch (_) { /* ignore */ }

      if (!allowed) {
        await supabase.auth.signOut();
        throw new Error('허용된 기기 수를 초과했습니다. 다른 기기에서 로그아웃 후 다시 시도해 주세요.');
      }

      // 로그인 성공 시 권한 체크로 진행
      if (data?.user) {
        await checkUserAuthority(data.user);
      } else {
        throw new Error('사용자 정보를 가져올 수 없습니다.');
      }

    } catch (e) {
      showError(e?.message || '로그인 실패');
      if ($login) {
        $login.disabled = false;
        $login.textContent = '로그인';
      }
    }
  };

  if ($login) $login.onclick = doLogin;
  if ($close) $close.onclick = () => location.replace('https://baikuk.com/map');

  [$email, $pw].forEach(inp => {
    inp?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
  });
}

// 사용자 권한 확인 및 페이지 진입 제어
async function checkUserAuthority(user) {
  try {
    if (!user?.id) {
      throw new Error('유효하지 않은 사용자 정보입니다.');
    }

    const { data: staff, error: spErr } = await supabase
      .from('staff_profiles')
      .select('authority_grade')
      .eq('user_id', user.id)
      .maybeSingle();

    if (spErr) throw spErr;
    if (!staff) {
      throw new Error('직원 프로필 정보를 찾을 수 없습니다.');
    }

    // authority_grade 값이 '1' 인지 검증 (타입 유연성을 위해 String 변환 후 비교)
    const grade = String(staff.authority_grade || '').trim();

    if (grade === '1') {
      // 권한이 '1' 이면 로그인 화면을 완전히 숨기고 페이지에 머무름
      const $screen = document.getElementById('auth-screen');
      $screen?.classList.add('hidden');
      console.log('✅ 권한 검증 완료: ad_management 접근이 허용되었습니다.');
    } else {
      // '1'이 아닐 경우 경고 후 ad_censorship 페이지로 리다이렉트
      alert('광고 관리 권한이 없습니다. 광고 검토 페이지로 이동합니다.');
      location.replace('/admin/ad_censorship/');
    }

  } catch (err) {
    console.error('권한 확인 오류:', err);
    alert('권한 확인 도중 오류가 발생했습니다. 로그아웃 후 다시 시도하거나 관리자에게 문의해 주세요. ' + err.message);
    // 보안을 위해 오류 발생 시 ad_censorship으로 강제 리다이렉트
    location.replace('/admin/ad_censorship/');
  }
}
