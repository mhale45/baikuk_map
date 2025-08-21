# one_stop_view.py
# pip install flask flask-cors selenium webdriver-manager

import os, threading, uuid, time
from flask import Flask, request, jsonify
from flask_cors import CORS, cross_origin

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from webdriver_manager.chrome import ChromeDriverManager

# =========================
# Config
# =========================
URL = "https://gris.gg.go.kr/ost/oneStopView.do"

# 환경변수로 표시/헤드리스 제어
VISIBLE = os.getenv("VISIBLE", "1") == "1"   # 1 이면 창 보이게, 0 이면 headless
DETACH  = os.getenv("DETACH",  "0") == "1"   # 1 이면 드라이버 종료해도 창 남김(로컬 디버깅용 비권장)

DRIVER_BIN = ChromeDriverManager().install()

# 간단 잡 상태
JOBS = {}  # {job_id: {...}}

# --- XPATH 상수들 ---
POPUP_CLOSE_XPATH    = '//*[@id="noticePopup"]/div/div/div/div/button'
XPATH_TARGET         = '//*[@id="container"]/div[3]/div/div[1]/div[1]/div[1]/div/a[1]'  # 첫 진입 클릭
SEARCH_INPUT_XPATH   = '//*[@id="searchText"]'
SEARCH_BTN_XPATH     = '//*[@id="searchVo"]/div/input[2]'
SEARCH_TRIGGER       = 'BUTTON'  # 'ENTER' 로 바꾸면 엔터검색
TAB3_XPATH           = '//*[@id="ostpTab3"]/a'   # "원스톱 건물정보" 탭
RESULT_READY_XPATH   = '//*[@id="totUseLandMltmImg"]'  # 로드 확인용(토지이용계획 이미지)

# =========================
# Selenium helpers
# =========================
def wait_visible_any_frame(driver, xpath, timeout=20):
    driver.switch_to.default_content()
    contexts = [None] + driver.find_elements(By.CSS_SELECTOR, "iframe, frame")
    for ctx in contexts:
        try:
            driver.switch_to.default_content()
            if ctx is not None:
                driver.switch_to.frame(ctx)
            WebDriverWait(driver, timeout).until(
                EC.visibility_of_element_located((By.XPATH, xpath))
            )
            driver.switch_to.default_content()
            return True
        except TimeoutException:
            continue
    driver.switch_to.default_content()
    return False

def wait_invisible_any_frame(driver, xpath, timeout=5):
    driver.switch_to.default_content()
    contexts = [None] + driver.find_elements(By.CSS_SELECTOR, "iframe, frame")
    for ctx in contexts:
        try:
            driver.switch_to.default_content()
            if ctx is not None:
                driver.switch_to.frame(ctx)
            el = WebDriverWait(driver, max(1, timeout//2)).until(
                EC.presence_of_element_located((By.XPATH, xpath))
            )
            WebDriverWait(driver, timeout).until(EC.invisibility_of_element(el))
            driver.switch_to.default_content()
            return True
        except TimeoutException:
            continue
    driver.switch_to.default_content()
    return False

def wait_page_loaded(driver, timeout=20):
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )

def click_xpath_any_frame(driver, xpath, timeout=15):
    driver.switch_to.default_content()
    try:
        el = WebDriverWait(driver, timeout).until(
            EC.element_to_be_clickable((By.XPATH, xpath))
        )
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
        el.click()
        return True
    except TimeoutException:
        pass

    frames = driver.find_elements(By.CSS_SELECTOR, "iframe, frame")
    for fr in frames:
        try:
            driver.switch_to.default_content()
            driver.switch_to.frame(fr)
            el = WebDriverWait(driver, timeout//2).until(
                EC.element_to_be_clickable((By.XPATH, xpath))
            )
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
            el.click()
            return True
        except TimeoutException:
            continue

    driver.switch_to.default_content()
    return False

def type_xpath_any_frame(driver, xpath, text, timeout=15, clear=True):
    driver.switch_to.default_content()
    try:
        el = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located((By.XPATH, xpath))
        )
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
        if clear:
            try:
                el.clear()
            except Exception:
                el.send_keys(Keys.CONTROL, 'a')
                el.send_keys(Keys.BACKSPACE)
        el.send_keys(text)
        return True
    except TimeoutException:
        pass

    frames = driver.find_elements(By.CSS_SELECTOR, "iframe, frame")
    for fr in frames:
        try:
            driver.switch_to.default_content()
            driver.switch_to.frame(fr)
            el = WebDriverWait(driver, timeout//2).until(
                EC.presence_of_element_located((By.XPATH, xpath))
            )
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
            if clear:
                try:
                    el.clear()
                except Exception:
                    el.send_keys(Keys.CONTROL, 'a')
                    el.send_keys(Keys.BACKSPACE)
            el.send_keys(text)
            return True
        except TimeoutException:
            continue

    driver.switch_to.default_content()
    return False

def build_driver(visible: bool, detach: bool):
    options = webdriver.ChromeOptions()
    if not visible:
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1080")

    # 서버 안정화 옵션
    options.add_argument("--start-maximized")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")

    # 로컬 디버깅 시 창 유지
    if detach:
        options.add_experimental_option("detach", True)

    # 필요 시 크롬 바이너리 지정
    # options.binary_location = os.getenv("CHROME_BINARY", "/usr/bin/chromium")

    service = Service(DRIVER_BIN)
    return webdriver.Chrome(service=service, options=options)

def open_and_click(url=URL, first_click_xpath=XPATH_TARGET, visible=True, address:str=""):
    driver = build_driver(visible=visible, detach=DETACH)
    driver.get(url)
    wait_page_loaded(driver)

    # 1) 공지 팝업 닫기(있으면)
    try:
        if click_xpath_any_frame(driver, POPUP_CLOSE_XPATH, timeout=3):
            wait_invisible_any_frame(driver, POPUP_CLOSE_XPATH, timeout=5)
            wait_page_loaded(driver, timeout=10)
    except Exception as e:
        print("[INFO] notice popup skip:", e)

    # 2) 진입용 첫 클릭(필요 시)
    if first_click_xpath:
        click_xpath_any_frame(driver, first_click_xpath)

    # 3) 주소 검색
    if address:
        typed = type_xpath_any_frame(driver, SEARCH_INPUT_XPATH, address, timeout=10, clear=True)
        if not typed:
            return False, driver

        if SEARCH_TRIGGER.upper() == 'ENTER':
            type_xpath_any_frame(driver, SEARCH_INPUT_XPATH, Keys.ENTER, timeout=5, clear=False)
        else:
            clicked = click_xpath_any_frame(driver, SEARCH_BTN_XPATH, timeout=20)
            if not clicked:
                return False, driver

        # --- 탭/콘텐츠 로드 순서 안정화 ---
        # A안: 탭 먼저 클릭 → 콘텐츠 보일 때까지 대기
        if click_xpath_any_frame(driver, TAB3_XPATH, timeout=15):
            if wait_visible_any_frame(driver, RESULT_READY_XPATH, timeout=30):
                return True, driver

        # B안: 콘텐츠 대기 → 탭 클릭 재시도
        ready = wait_visible_any_frame(driver, RESULT_READY_XPATH, timeout=20)
        if ready:
            if click_xpath_any_frame(driver, TAB3_XPATH, timeout=10):
                return True, driver

        return False, driver

    # 주소 없이 열기만 하는 경우
    return True, driver

# =========================
# Flask App
# =========================
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=False)

def run_gris_job(job_id: str, address: str):
    driver = None
    try:
        ok, driver = open_and_click(address=address, visible=VISIBLE)
        JOBS[job_id] = {
            "ok": ok, "address": address, "ts": time.time(),
            "status": "done" if ok else "fail"
        }
        print(f"[GRIS] ({job_id}) done ok={ok} address={address}")
    except Exception as e:
        JOBS[job_id] = {
            "ok": False, "address": address, "ts": time.time(),
            "status": "error", "error": str(e)
        }
        print(f"[GRIS] ({job_id}) error:", e)
    finally:
        # 드라이버 누수 방지
        try:
            if driver and not DETACH:
                driver.quit()
        except Exception:
            pass

@app.route("/api/gris-start", methods=["POST","OPTIONS"])
@cross_origin(origins="*", methods=["POST","OPTIONS"],
              allow_headers=["Content-Type","Authorization"],
              supports_credentials=False)
def api_gris_start():
    payload = request.get_json(silent=True) or {}
    address = (payload.get("address") or "").strip()
    if not address:
        return jsonify({"ok": False, "message": "address가 비어있습니다."}), 400

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"ok": None, "address": address, "ts": time.time(), "status": "queued"}

    t = threading.Thread(target=run_gris_job, args=(job_id, address), daemon=True)
    t.start()

    return jsonify({"ok": True, "message": "job accepted", "job_id": job_id, "address": address}), 202

# 상태 조회 추가
@app.get("/api/gris-job/<job_id>")
def api_gris_job(job_id):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"ok": False, "message": "unknown job_id"}), 404
    return jsonify({"ok": True, "job": job})

@app.get('/api/ping')
def ping():
    return jsonify(ok=True, msg='pong')

@app.get("/")
def root():
    return "백억지도 API OK"

@app.get("/health")
def health():
    return jsonify({"ok": True})

# PNA: HTTPS 페이지 -> 로컬호스트 접근 허용 헤더
@app.after_request
def add_headers(resp):
    resp.headers['Access-Control-Allow-Private-Network'] = 'true'
    return resp

if __name__ == "__main__":
    # 예: VISIBLE=0 DETACH=0 python one_stop_view.py
    app.run(host="0.0.0.0", port=5000, debug=True)
