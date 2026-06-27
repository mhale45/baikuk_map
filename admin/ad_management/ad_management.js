import { client as supabase, waitForSupabase } from '../../modules/core/supabase.js';
import { renderSidebar } from '../../modules/ui/sidebar.js';

// 사이드바 렌더링
renderSidebar('ad_management');

// 전역 객체로 supabase 노출 (타 스크립트와의 호환성)
window.supabase = supabase;

// 로그인한 직원의 소속 매장 정보를 기억할 변수
let myAffiliation = '';
// 선택된 자동갱신 계정 정보를 기억할 변수
let selectedAccount = null;

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
  const $email = document.getElementById('auth-email');
  const $pw = document.getElementById('auth-password');
  const $login = document.getElementById('auth-login');
  const $close = document.getElementById('auth-close');
  const $err = document.getElementById('auth-error');

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
      .select('authority_grade, affiliation')
      .eq('user_id', user.id)
      .maybeSingle();

    if (spErr) throw spErr;
    if (!staff) {
      throw new Error('직원 프로필 정보를 찾을 수 없습니다.');
    }

    // authority_grade 값이 '1' 인지 검증 (타입 유연성을 위해 String 변환 후 비교)
    const grade = String(staff.authority_grade || '').trim();

    if (grade === '1') {
      // 소속 매장 정보 저장
      myAffiliation = staff.affiliation || '';

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

  // 자동갱신 여부 선택에 따른 거래완료 갱신 연동 이벤트 바인딩
  const $executionSelect = document.getElementById('auto-execution');
  const $completedSelect = document.getElementById('auto-completed');
  if ($executionSelect && $completedSelect) {
    $executionSelect.addEventListener('change', () => {
      if ($executionSelect.value === 'false') {
        $completedSelect.value = 'false';
      }
    });
  }

  // 새로고침 버튼 이벤트 바인딩
  const $refreshBtn = document.getElementById('btn-refresh-results');
  if ($refreshBtn) {
    $refreshBtn.onclick = () => {
      if (selectedAccount) {
        loadRenewalResults(selectedAccount.channel, selectedAccount.id);
      }
    };
  }
}

// 자동갱신 목록 로드 및 렌더링
// 자동갱신 목록 로드 및 렌더링
async function loadAutoRenewList() {
  const $list = document.getElementById('auto-renew-list');
  if (!$list) return;

  $list.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">불러오는 중...</td></tr>`;

  try {
    const { data, error } = await supabase
      .from('aa_renewal_channel_list')
      .select('*')
      .eq('affiliation', myAffiliation);

    if (error) throw error;

    if (!data || data.length === 0) {
      $list.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">등록된 자동갱신 채널이 없습니다.</td></tr>`;
      return;
    }

    $list.innerHTML = data.map(item => {
      // 날짜 포맷팅 (KST)
      const dateStr = item.created_at
        ? new Date(item.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
        : '-';

      const isExec = item.execution === true;
      const isCompleted = item.completed === true;

      return `
        <tr class="border-b hover:bg-gray-50 cursor-pointer transition-colors ${!isExec ? 'bg-gray-100/70' : ''}" data-id="${item.id}">
          <td class="px-4 py-3 font-semibold ${isExec ? 'text-gray-800' : 'text-gray-400'}">${item.add_channal || '-'}</td>
          <td class="px-4 py-3 font-mono ${isExec ? 'text-gray-600' : 'text-gray-400'}">${item.add_id || '-'}</td>
          <td class="px-4 py-3 max-renewal-cell cursor-pointer hover:bg-gray-100 transition-colors" data-id="${item.id}" data-value="${item.max_renewal_count || ''}" data-exec="${isExec}">
            <span class="border-b border-dashed border-gray-400 pb-0.5 ${isExec ? 'text-gray-600' : 'text-gray-400'}">
              ${item.max_renewal_count || '-'}개
            </span>
          </td>
          <td class="px-4 py-3 ${isExec ? 'text-gray-600' : 'text-gray-400'}">${item.mail_address || '-'}</td>
          <td class="px-4 py-3">
            <button class="btn-toggle-execution px-2.5 py-1 text-xs font-semibold rounded-md border transition-all active:scale-95 ${isExec
          ? 'bg-green-50 hover:bg-green-100 text-green-700 border-green-200'
          : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200'
        }" data-id="${item.id}" data-execution="${isExec}">
              ${isExec ? '활성화' : '비활성화'}
            </button>
          </td>
          <td class="px-4 py-3">
            <button class="btn-toggle-completed px-2.5 py-1 text-xs font-semibold rounded-md border transition-all active:scale-95 ${isCompleted
          ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
          : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200'
        }" data-id="${item.id}" data-completed="${isCompleted}">
              ${isCompleted ? '갱신' : '종료'}
            </button>
          </td>
          <td class="px-4 py-3 text-xs text-gray-400">${dateStr}</td>
          <td class="px-4 py-3 text-center">
            <button class="btn-delete-auto px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-md border border-red-200 transition-all active:scale-95" data-id="${item.id}">
              삭제
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // 각 행 클릭 이벤트 바인딩
    const $rows = $list.querySelectorAll('tr');
    $rows.forEach(($row, idx) => {
      const item = data[idx];

      // 만약 이미 선택된 계정이 있고 그 계정 정보와 일치하면 다시 활성화 처리
      if (selectedAccount && selectedAccount.channel === item.add_channal && selectedAccount.id === item.add_id) {
        $row.classList.add('bg-blue-50/70', 'hover:bg-blue-50/70');
      }

      $row.addEventListener('click', () => {
        // 모든 행 스타일 초기화
        $rows.forEach(r => r.classList.remove('bg-blue-50/70', 'hover:bg-blue-50/70'));
        // 현재 클릭 행 활성화
        $row.classList.add('bg-blue-50/70', 'hover:bg-blue-50/70');

        selectedAccount = { channel: item.add_channal, id: item.add_id };
        loadRenewalResults(item.add_channal, item.add_id);
      });
    });

    // 실행여부 토글 버튼 이벤트 바인딩
    const $toggleBtns = $list.querySelectorAll('.btn-toggle-execution');
    $toggleBtns.forEach(($btn) => {
      $btn.onclick = async (e) => {
        e.stopPropagation(); // 행 클릭 이벤트 전파 차단

        const id = $btn.getAttribute('data-id');
        const currentExecution = $btn.getAttribute('data-execution') === 'true';
        if (!id) return;

        try {
          $btn.disabled = true;
          $btn.textContent = '변경 중...';

          const nextExecution = !currentExecution;
          const updateData = { execution: nextExecution };
          if (nextExecution === false) {
            updateData.completed = false;
          }

          const { error: updateErr } = await supabase
            .from('aa_renewal_channel_list')
            .update(updateData)
            .eq('id', id);

          if (updateErr) throw updateErr;

          // 즉시 반영을 위해 목록 다시 불러오기
          await loadAutoRenewList();
        } catch (err) {
          console.error('자동갱신 여부 업데이트 오류:', err);
          alert('상태 변경에 실패했습니다: ' + err.message);
          $btn.disabled = false;
          $btn.textContent = currentExecution ? '활성화' : '비활성화';
        }
      };
    });

    // 거래완료 갱신 토글 버튼 이벤트 바인딩
    const $completedToggleBtns = $list.querySelectorAll('.btn-toggle-completed');
    $completedToggleBtns.forEach(($btn) => {
      $btn.onclick = async (e) => {
        e.stopPropagation(); // 행 클릭 이벤트 전파 차단

        const id = $btn.getAttribute('data-id');
        const currentCompleted = $btn.getAttribute('data-completed') === 'true';
        if (!id) return;

        try {
          $btn.disabled = true;
          $btn.textContent = '변경 중...';

          const nextCompleted = !currentCompleted;
          const { error: updateErr } = await supabase
            .from('aa_renewal_channel_list')
            .update({ completed: nextCompleted })
            .eq('id', id);

          if (updateErr) throw updateErr;

          // 즉시 반영을 위해 목록 다시 불러오기
          await loadAutoRenewList();
        } catch (err) {
          console.error('거래완료 갱신 여부 업데이트 오류:', err);
          alert('상태 변경에 실패했습니다: ' + err.message);
          $btn.disabled = false;
          $btn.textContent = currentCompleted ? '갱신' : '종료';
        }
      };
    });

    // 최대 갱신 수 클릭 인라인 수정 이벤트 바인딩
    const $maxRenewalCells = $list.querySelectorAll('.max-renewal-cell');
    $maxRenewalCells.forEach(($cell) => {
      $cell.onclick = (e) => {
        e.stopPropagation(); // 행 클릭 이벤트 전파 차단
        
        // 이미 select 박스가 활성화되어 있으면 중복 처리 방지
        if ($cell.querySelector('select')) return;

        const id = $cell.getAttribute('data-id');
        const currentValue = parseInt($cell.getAttribute('data-value'), 10) || 0;
        const isExec = $cell.getAttribute('data-exec') === 'true';
        
        // select 엘리먼트 생성
        const $select = document.createElement('select');
        $select.className = 'border border-gray-300 rounded px-1.5 py-0.5 text-xs font-semibold focus:ring-2 focus:ring-blue-100 outline-none bg-white transition-all';
        
        // 1~50 옵션 추가
        for (let i = 1; i <= 50; i++) {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = `${i}개`;
          if (i === currentValue) {
            opt.selected = true;
          }
          $select.appendChild(opt);
        }

        // 기존 텍스트 비우기 및 select 추가
        $cell.innerHTML = '';
        $cell.appendChild($select);
        $select.focus();

        let isSaving = false;

        const saveChange = async () => {
          if (isSaving) return;
          isSaving = true;

          const newValue = parseInt($select.value, 10);
          if (newValue === currentValue) {
            // 변경사항이 없으면 원래 텍스트로 복원
            $cell.innerHTML = `<span class="border-b border-dashed border-gray-400 pb-0.5 ${isExec ? 'text-gray-600' : 'text-gray-400'}">${currentValue || '-'}개</span>`;
            return;
          }

          try {
            $select.disabled = true;
            
            const { error: updateErr } = await supabase
              .from('aa_renewal_channel_list')
              .update({ max_renewal_count: newValue })
              .eq('id', id);

            if (updateErr) throw updateErr;

            // 즉시 반영을 위해 목록 다시 불러오기
            await loadAutoRenewList();
          } catch (err) {
            console.error('최대 갱신 수 업데이트 오류:', err);
            alert('최대 갱신 수 변경에 실패했습니다: ' + err.message);
            // 에러 발생 시 원래 상태 복구를 위해 리로드
            await loadAutoRenewList();
          }
        };

        // 이벤트 바인딩
        $select.onchange = saveChange;
        $select.onblur = saveChange;
        $select.onkeydown = (ev) => {
          if (ev.key === 'Enter') {
            saveChange();
          } else if (ev.key === 'Escape') {
            // 변경 취소 및 복원
            isSaving = true; // saveChange가 실행되지 않도록 flag 설정
            $cell.innerHTML = `<span class="border-b border-dashed border-gray-400 pb-0.5 ${isExec ? 'text-gray-600' : 'text-gray-400'}">${currentValue || '-'}개</span>`;
          }
        };
      };
    });

    // 삭제 버튼 이벤트 바인딩
    const $deleteBtns = $list.querySelectorAll('.btn-delete-auto');
    $deleteBtns.forEach(($btn, idx) => {
      $btn.onclick = async (e) => {
        e.stopPropagation(); // 행 클릭 이벤트 전파 차단

        const id = $btn.getAttribute('data-id');
        if (!id) return;

        const item = data[idx];

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

            // 삭제된 계정이 현재 선택된 계정일 경우 결과 이력 영역 초기화
            if (selectedAccount && selectedAccount.channel === item.add_channal && selectedAccount.id === item.add_id) {
              clearRenewalResults();
            }

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
    $list.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-red-500">목록을 불러오는 중 오류가 발생했습니다: ${e.message}</td></tr>`;
  }
}

// 자동갱신 저장 로직
async function saveAutoRenew() {
  const $channelNameSelect = document.getElementById('auto-channel-name');
  const $channelIdInput = document.getElementById('auto-channel-id');
  const $channelPwInput = document.getElementById('auto-channel-pw');
  const $maxCountSelect = document.getElementById('auto-max-count');
  const $alarmMailInput = document.getElementById('auto-alarm-mail');
  const $executionSelect = document.getElementById('auto-execution');
  const $completedSelect = document.getElementById('auto-completed');
  const $saveBtn = document.getElementById('btn-save-auto-renew');

  if (!$channelNameSelect || !$channelIdInput || !$channelPwInput || !$maxCountSelect || !$alarmMailInput || !$saveBtn) return;

  const channelName = $channelNameSelect.value;
  const channelId = $channelIdInput.value.trim();
  const channelPw = $channelPwInput.value.trim();
  const maxCount = $maxCountSelect.value;
  const alarmMail = $alarmMailInput.value.trim();
  const executionVal = $executionSelect ? ($executionSelect.value === 'true') : true;
  const completedVal = $completedSelect ? ($completedSelect.value === 'true') : true;

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
  if (!alarmMail) {
    alert('알람메일을 입력해 주세요.');
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
        max_renewal_count: parseInt(maxCount, 10),
        affiliation: myAffiliation,
        mail_address: alarmMail,
        execution: executionVal,
        completed: completedVal
      });

    if (error) throw error;

    alert('성공적으로 저장되었습니다.');

    // 입력창 초기화
    $channelNameSelect.value = '';
    $channelIdInput.value = '';
    $channelPwInput.value = '';
    $maxCountSelect.value = '';
    $alarmMailInput.value = '';
    if ($executionSelect) $executionSelect.value = 'true';
    if ($completedSelect) $completedSelect.value = 'true';

    // 결과 목록 초기화
    clearRenewalResults();

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

// 선택된 계정의 갱신 결과 로드
async function loadRenewalResults(channel, idVal) {
  const $resultList = document.getElementById('auto-renew-result-list');
  const $selectedInfo = document.getElementById('selected-account-info');
  const $refreshBtn = document.getElementById('btn-refresh-results');

  if (!$resultList) return;

  if ($selectedInfo) {
    $selectedInfo.textContent = `(${channel} - ${idVal})`;
  }
  if ($refreshBtn) {
    $refreshBtn.classList.remove('hidden');
  }

  $resultList.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">결과를 불러오는 중...</td></tr>`;

  try {
    const { data, error } = await supabase
      .from('aa_renewal_result')
      .select('*')
      .eq('add_channal', channel)
      .eq('add_id', idVal)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    if (!data || data.length === 0) {
      $resultList.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">갱신 결과 이력이 없습니다.</td></tr>`;
      return;
    }

    // baikukdbtest에서 listing_title 매핑 정보 조회
    const listingIds = data.map(item => item.listing_id).filter(Boolean);
    let titleMap = {};
    if (listingIds.length > 0) {
      try {
        const { data: dbData, error: dbError } = await supabase
          .from('baikukdbtest')
          .select('listing_id, listing_title')
          .in('listing_id', listingIds);

        if (!dbError && dbData) {
          dbData.forEach(row => {
            titleMap[row.listing_id] = row.listing_title;
          });
        }
      } catch (err) {
        console.error('baikukdbtest 조회 에러:', err);
      }
    }

    $resultList.innerHTML = data.map(item => {
      const dateStr = item.created_at
        ? new Date(item.created_at).toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
        : '-';

      const statusText = item.status || '-';
      let statusBadge = '';

      // 상태값에 따른 뱃지 연출 (성공/완료 등은 초록색, 실패/에러 등은 빨간색, 그 외는 회색)
      if (statusText.includes('성공') || statusText.includes('완료') || statusText.includes('정상')) {
        statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">${statusText}</span>`;
      } else if (statusText.includes('실패') || statusText.includes('에러') || statusText.includes('오류')) {
        statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">${statusText}</span>`;
      } else {
        statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">${statusText}</span>`;
      }

      const listingTitle = titleMap[item.listing_id] || '-';

      return `
        <tr class="border-b hover:bg-gray-50 transition-colors">
          <td class="px-4 py-3 text-xs text-gray-500 font-mono">${dateStr}</td>
          <td class="px-4 py-3">${statusBadge}</td>
          <td class="px-4 py-3 text-gray-600 truncate max-w-[250px]" title="${item.listing_id ? `${item.listing_id} ` : ''}${listingTitle}">
            ${item.listing_id
              ? `<a href="https://baikuk.com/item/view/${item.listing_id}" target="_blank" class="text-blue-600 hover:underline font-semibold">${item.listing_id} ${listingTitle}</a>`
              : listingTitle
            }
          </td>
          <td class="px-4 py-3 text-gray-600">
            ${item.listing_id
          ? `<a href="https://agency.neonet.co.kr/novo-agency/view/offerings/NaverOfferingsList.neo?search_type=total&search_text=${item.listing_id}" target="_blank" class="inline-flex items-center justify-center px-2.5 py-1 text-xs font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-md transition-all duration-200 shadow-sm hover:shadow active:scale-95">링크</a>`
          : '-'
        }
          </td>
          <td class="px-4 py-3 text-gray-600">${item.product || '-'}</td>
          <td class="px-4 py-3 text-xs text-gray-400 max-w-[200px] truncate" title="${item.note || ''}">${item.note || '-'}</td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    console.error('결과 이력 로드 실패:', e);
    $resultList.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-red-500 font-semibold">이력을 불러오는 도중 오류가 발생했습니다: ${e.message}</td></tr>`;
  }
}

// 결과 영역 초기화
function clearRenewalResults() {
  selectedAccount = null;
  const $resultList = document.getElementById('auto-renew-result-list');
  const $selectedInfo = document.getElementById('selected-account-info');
  const $refreshBtn = document.getElementById('btn-refresh-results');

  if ($resultList) {
    $resultList.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">계정 목록에서 계정을 선택해 주세요.</td></tr>`;
  }
  if ($selectedInfo) {
    $selectedInfo.textContent = '';
  }
  if ($refreshBtn) {
    $refreshBtn.classList.add('hidden');
  }
}
