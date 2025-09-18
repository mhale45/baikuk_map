export async function initMobileCarrier() {
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

  // === 버튼 이벤트 추가 ===
  const submitBtn = document.getElementById("submit-phone");
  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      const phoneInput = document.getElementById("phone-input").value.trim();
      if (!phoneInput) {
        alert("휴대폰 번호를 입력하세요!");
        return;
      }
      console.log("입력된 번호:", phoneInput);
      // 👉 여기서 supabase 저장, API 호출, 파이썬 크롤러 연동 등 연결 가능
    });
  }
}
