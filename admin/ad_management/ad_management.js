import { client as supabase, waitForSupabase } from '../../modules/core/supabase.js';
import { renderSidebar } from '../../modules/ui/sidebar.js';

// 사이드바 렌더링
renderSidebar('ad_management');

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
      initTabSystem();
      loadAutoRenewList();
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

// 상단 서브 탭 시스템 초기화
function initTabSystem() {
  // 갱신 최대 갯수 선택박스 옵션 채우기 (1~50)
  const $maxCountSelect = document.getElementById('auto-max-count');
  if ($maxCountSelect) {
    $maxCountSelect.innerHTML = '<option value="">갯수 선택</option>';
    for (let i = 1; i <= 50; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i;
      $maxCountSelect.appendChild(opt);
    }
  }

  const tabs = [
    { buttonId: 'tab-auto-renew', contentId: 'content-auto-renew' },
    { buttonId: 'tab-top-renew', contentId: 'content-top-renew' }
  ];

  tabs.forEach(tab => {
    const $btn = document.getElementById(tab.buttonId);
    if ($btn) {
      $btn.onclick = () => {
        // 모든 탭 스타일 초기화 및 패널 숨김
        tabs.forEach(t => {
          const $b = document.getElementById(t.buttonId);
          const $c = document.getElementById(t.contentId);
          if ($b) {
            $b.className = 'px-4 py-2 font-bold text-lg text-gray-500 hover:text-gray-700 focus:outline-none transition-all';
          }
          if ($c) {
            $c.classList.add('hidden');
          }
        });

        // 클릭된 탭 활성화
        $btn.className = 'px-4 py-2 font-bold text-lg border-b-2 border-blue-600 text-blue-600 focus:outline-none transition-all';
        const $targetContent = document.getElementById(tab.contentId);
        if ($targetContent) {
          $targetContent.classList.remove('hidden');
        }
      };
    }
  });

  // 저장 버튼 이벤트 바인딩
  const $saveBtn = document.getElementById('btn-save-auto-renew');
  if ($saveBtn) {
    $saveBtn.onclick = saveAutoRenew;
  }
}

// 자동갱신 목록 로드 및 렌더링
async function loadAutoRenewList() {
  const $list = document.getElementById('auto-renew-list');
  if (!$list) return;

  $list.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">불러오는 중...</td></tr>`;

  try {
    const { data, error } = await supabase
      .from('aa_renewal_channel_list')
      .select('*');

    if (error) throw error;

    if (!data || data.length === 0) {
      $list.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">등록된 자동갱신 채널이 없습니다.</td></tr>`;
      return;
    }

    $list.innerHTML = data.map(item => {
      // 날짜 포맷팅 (KST)
      const dateStr = item.created_at 
        ? new Date(item.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) 
        : '-';

      return `
        <tr class="border-b hover:bg-gray-50 transition-colors">
          <td class="px-4 py-3 font-semibold text-gray-800">${item.add_channal || '-'}</td>
          <td class="px-4 py-3 text-gray-600 font-mono">${item.add_id || '-'}</td>
          <td class="px-4 py-3 text-gray-600">${item.max_renewal_count || '-'}개</td>
          <td class="px-4 py-3 text-xs text-gray-400">${dateStr}</td>
          <td class="px-4 py-3 text-center">
            <button class="btn-delete-auto px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-md border border-red-200 transition-all active:scale-95" data-id="${item.id}">
              삭제
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // 삭제 버튼 이벤트 바인딩
    const $deleteBtns = $list.querySelectorAll('.btn-delete-auto');
    $deleteBtns.forEach($btn => {
      $btn.onclick = async () => {
        const id = $btn.getAttribute('data-id');
        if (!id) return;

        if (confirm('정말로 이 자동갱신 설정을 삭제하시겠습니까?')) {
          try {
            $btn.disabled = true;
            $btn.textContent = '삭제 중...';

            const { error: delErr } = await supabase
              .from('aa_renewal_channel_list')
              .delete()
              .eq('id', id);

            if (delErr) throw delErr;

            alert('삭제되었습니다.');
            await loadAutoRenewList();
          } catch (e) {
            console.error('삭제 오류:', e);
            alert('삭제에 실패했습니다: ' + e.message);
            $btn.disabled = false;
            $btn.textContent = '삭제';
          }
        }
      };
    });

  } catch (e) {
    console.error('목록 로드 실패:', e);
    $list.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-red-500">목록을 불러오는 중 오류가 발생했습니다: ${e.message}</td></tr>`;
  }
}

// 자동갱신 저장 로직
async function saveAutoRenew() {
  const $channelNameSelect = document.getElementById('auto-channel-name');
  const $channelIdInput = document.getElementById('auto-channel-id');
  const $channelPwInput = document.getElementById('auto-channel-pw');
  const $maxCountSelect = document.getElementById('auto-max-count');
  const $saveBtn = document.getElementById('btn-save-auto-renew');

  if (!$channelNameSelect || !$channelIdInput || !$channelPwInput || !$maxCountSelect || !$saveBtn) return;

  const channelName = $channelNameSelect.value;
  const channelId = $channelIdInput.value.trim();
  const channelPw = $channelPwInput.value.trim();
  const maxCount = $maxCountSelect.value;

  if (!channelName) {
    alert('광고 채널명을 선택해 주세요.');
    return;
  }
  if (!channelId) {
    alert('아이디를 입력해 주세요.');
    return;
  }
  if (!channelPw) {
    alert('비밀번호를 입력해 주세요.');
    return;
  }
  if (!maxCount) {
    alert('갱신 최대 갯수를 선택해 주세요.');
    return;
  }

  try {
    $saveBtn.disabled = true;
    $saveBtn.textContent = '저장 중...';

    const { error } = await supabase
      .from('aa_renewal_channel_list')
      .insert({
        add_channal: channelName,
        add_id: channelId,
        add_password: channelPw,
        max_renewal_count: parseInt(maxCount, 10)
      });

    if (error) throw error;

    alert('성공적으로 저장되었습니다.');
    
    // 입력창 초기화
    $channelNameSelect.value = '';
    $channelIdInput.value = '';
    $channelPwInput.value = '';
    $maxCountSelect.value = '';

    // 목록 새로고침
    await loadAutoRenewList();

  } catch (e) {
    console.error('저장 실패:', e);
    alert('저장에 실패했습니다: ' + e.message);
  } finally {
    $saveBtn.disabled = false;
    $saveBtn.textContent = '저장하기';
  }
}
