export async function initMobileCarrier() {
  // (선택) 미로그인 방지
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

}