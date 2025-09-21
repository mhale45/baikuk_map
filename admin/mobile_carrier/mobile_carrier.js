// /admin/mobile_carrier/mobile_carrier.js
import { client as supabase, waitForSupabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';

export async function initMobileCarrier() {
  // 로그인 가드
  try {
    await waitForSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data?.session) {
      location.replace('https://baikuk.com/map');
      return;
    }
  } catch (e) {
    console.warn(e);
  }

  // 입력 중에 숫자만 유지(옵션)
  const phoneEl = document.getElementById('phone-input');
  if (phoneEl) {
    phoneEl.addEventListener('input', (e) => {
      // 숫자만 남기기
      e.target.value = e.target.value.replace(/\D/g, '');
    });
  }

  // 저장 버튼
  const submitBtn = document.getElementById('submit-phone');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      try {
        const raw = (document.getElementById('phone-input')?.value || '').trim();
        const phone = raw.replace(/\D/g, ''); // 하이픈 등 제거 → 숫자만

        if (!phone) {
          showToastGreenRed('휴대폰 번호를 입력하세요.', false);
          return;
        }

        // 현재 로그인 유저와 staff_profiles 조회
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr || !user) {
          showToastGreenRed('로그인 정보를 확인할 수 없습니다.', false);
          return;
        }

        // movement 고정, memo는 번호만 저장
        const movement = '통신사체크';
        const memo = phone;

        const payload = {
          movement,
          memo,
          requested_by: user.id,                 // 동시성 안전용
          imDae_sheet_timetz: new Date().toISOString(), // DB에 DEFAULT now() 있으면 생략 가능
        };

        const { error: insertErr } = await supabase
          .from('update_log')
          .insert(payload);

        if (insertErr) {
          console.error(insertErr);
          showToastGreenRed('기록 저장에 실패했습니다.', false);
          return;
        }

        showToastGreenRed('통신사 체크 기록 완료!', { ok: true });

        try {
          await fetch('modules/api/run-crawler', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ phone })
          });
        } catch (e) {
          console.error('크롤러 실행 실패:', e);
          showToastGreenRed('크롤러 실행에 실패했습니다.', false);
        }
      } catch (err) {
        console.error(err);
        showToastGreenRed('알 수 없는 오류가 발생했습니다.', false);
      }
    });
  }
}
