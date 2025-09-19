// modules/auth-module.js

// Supabase 클라이언트는 index.html 또는 별도 config.js에서 생성 후 import해서 전달받는 방식 추천
// ex) import { client } from './supabase-client.js';

// --- Helper for show/hide elements ---
const showHide = (id, show) => {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !show);
};

// --- Modal control ---
export const showLogin = () => showHide('login-modal', true);
export const hideLogin = () => showHide('login-modal', false);
export const showLoadingOverlay = () => showHide('loading-overlay', true);
export const hideLoadingOverlay = () => showHide('loading-overlay', false);

// --- Redirect with sessionStorage message ---
export function redirectWithMessage(msg, loginPage = 'index.html') {
  const loginUrl = new URL(loginPage, location.origin);

  // 이미 로그인 페이지라면 모달만 띄움
  if (location.pathname === loginUrl.pathname) {
    try { sessionStorage.removeItem('auth_msg'); } catch (_) {}
    const errorDiv = document.getElementById('login-error');
    if (errorDiv) {
      errorDiv.textContent = String(msg || '');
      errorDiv.classList.remove('hidden');
    }
    showLogin();
    return;
  }

  try { sessionStorage.setItem('auth_msg', String(msg || '')); } catch (_) {}
  if (location.search) loginUrl.search = location.search;
  location.replace(loginUrl.href);
}

// --- Auth Guard ---
export async function guardAuthOrRedirect(client, requireAuth, loginPage = 'index.html') {
  if (!requireAuth) return;

  try {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      redirectWithMessage('로그인이 필요합니다.', loginPage);
      return;
    }

    // 서버에 허용 세션인지 확인
    const { data: allowed, error } = await client.rpc('is_session_allowed');
    if (error || allowed !== true) {
      await client.auth.signOut();
      redirectWithMessage('허용된 기기 수를 초과했습니다. 다른 기기에서 로그아웃 후 다시 시도해 주세요.', loginPage);
      return;
    }

    // 세션 갱신/만료 이벤트에도 감시
    client.auth.onAuthStateChange(async (_evt, s) => {
      if (!s) {
        redirectWithMessage('로그인이 필요합니다.', loginPage);
        return;
      }
      const { data: ok } = await client.rpc('is_session_allowed').catch(() => ({ data: false }));
      if (!ok) {
        await client.auth.signOut();
        redirectWithMessage('허용된 기기 수를 초과했습니다. 다른 기기에서 로그아웃 후 다시 시도해 주세요.', loginPage);
      }
    });
  } catch (e) {
    await client.auth.signOut().catch(()=>{});
    redirectWithMessage('인증 확인 중 오류가 발생했습니다. 다시 로그인해 주세요.', loginPage);
  }
}

// --- Login ---
export async function login(client) {
  showLoadingOverlay();

  const email = document.getElementById('login-email')?.value.trim();
  const password = document.getElementById('login-password')?.value.trim();
  const errorDiv = document.getElementById('login-error');

  try {
    // 1) 로그인 시도
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // 2) 세션 등록
    await client.rpc('register_session', {
      device_label: (navigator.platform + ' ' + (navigator.vendor || '')).trim(),
      user_agent: navigator.userAgent
    });

    // 3) 허용 세션 확인
    const { data: allowed } = await client.rpc('is_session_allowed');
    if (allowed === false) {
      await client.auth.signOut();
      throw new Error('허용된 기기 수를 초과했습니다. 다른 기기에서 로그아웃 후 다시 시도해 주세요.');
    }

    // 4) 성공 시 admin으로 이동
    window.location.href = '/admin';
  } catch (e) {
    if (errorDiv) {
      errorDiv.textContent = '로그인 실패: ' + (e?.message || e);
      errorDiv.classList.remove('hidden');
    }
  } finally {
    hideLoadingOverlay();
  }
}

// --- Logout ---
export async function logout(client) {
  await client.auth.signOut();
  window.location.reload();
}

// --- Auth redirect message 표시 ---
export function showAuthRedirectMessage() {
  try {
    const msg = sessionStorage.getItem('auth_msg');
    if (msg) {
      sessionStorage.removeItem('auth_msg');
      const errorDiv = document.getElementById('login-error');
      if (errorDiv) {
        errorDiv.textContent = msg;
        errorDiv.classList.remove('hidden');
      }
      showLogin();
    }
  } catch (_) {}
}
