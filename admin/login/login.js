import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const client = createClient(
  "https://sfinbtiqlfnaaarziixu.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmaW5idGlxbGZuYWFhcnppaXh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MDkxNjEsImV4cCI6MjA2ODA4NTE2MX0.4-7vnIjbF-biWWuv9-vTxK9Y99gMm-vS6oaRMdRL5fA"
);

document.getElementById("login-btn").addEventListener("click", doLogin);

async function doLogin() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value.trim();
  const btn = document.getElementById("login-btn");
  const err = document.getElementById("login-error");

  try {
    err.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "로그인 중...";

    // 로그인
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // 로그인 성공 → 매물장부 페이지 이동
    location.replace("/admin/listings/");
  } catch (e) {
    err.textContent = e.message || "로그인 실패";
    err.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "로그인";
  }
}

// Enter 키 입력 지원
["login-email", "login-password"].forEach(id => {
  document.getElementById(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
});
