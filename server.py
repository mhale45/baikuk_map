# server.py
# pip install flask flask-cors selenium webdriver-manager

import threading, uuid, time
from flask import Flask, request, jsonify
from flask_cors import CORS

from flask_cors import cross_origin
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from selenium.common.exceptions import TimeoutException

JOBS = {}  # 간단 상태 저장(선택)
URL = "https://gris.gg.go.kr/ost/oneStopView.do"
DRIVER_BIN = ChromeDriverManager().install()

# --- XPATH 상수들 ---
POPUP_CLOSE_XPATH = '//*[@id="noticePopup"]/div/div/div/div/button'
XPATH_TARGET      = '//*[@id="container"]/div[3]/div/div[1]/div[1]/div[1]/div/a[1]'  # 기존 첫 클릭
SEARCH_INPUT_XPATH = '//*[@id="searchText"]'               # 주소 입력창
SEARCH_BTN_XPATH   = '//*[@id="searchVo"]/div/input[2]'    # 검색 버튼
SEARCH_TRIGGER     = 'BUTTON'  # 'ENTER' 로 바꾸면 Enter로 검색
TAB3_XPATH = '//*[@id="ostpTab3"]/a' # 원스톱 건물정보 버튼
RESULT_READY_XPATH = '//*[@id="totUseLandMltmImg"]' # 토지이용계획 이미지 부분

def wait_visible_any_frame(driver, xpath, timeout=20):
    """기본 문서와 모든 iframe을 순회하며, 대상이 '보일 때'까지 대기."""
    driver.switch_to.default_content()
    # 기본 문서 + 모든 프레임
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
    """여러 frame을 탐색해 입력창을 찾아 text 입력."""
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

def open_and_click(url=URL, first_click_xpath=XPATH_TARGET, visible=True, address:str=""):
    options = webdriver.ChromeOptions()
    if not visible:
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1080")
    options.add_argument("--start-maximized")
    options.add_experimental_option("detach", True)

    driver = webdriver.Chrome(service=Service(DRIVER_BIN), options=options)
    driver.get(url)
    wait_page_loaded(driver)

    # 1) 공지 팝업 닫기(있으면)
    try:
        if click_xpath_any_frame(driver, POPUP_CLOSE_XPATH, timeout=3):
            wait_invisible_any_frame(driver, POPUP_CLOSE_XPATH, timeout=5)
            wait_page_loaded(driver, timeout=10)
    except Exception as e:
        print("[INFO] notice popup skip:", e)

    # 2) 첫 대상 클릭(필요할 때)
    if first_click_xpath:
        click_xpath_any_frame(driver, first_click_xpath)

    # 3) 주소 입력
    if address:
        typed = type_xpath_any_frame(driver, SEARCH_INPUT_XPATH, address, timeout=10, clear=True)
        if not typed:
            return False, driver

        # 4) 검색 실행 (버튼 클릭 또는 ENTER)
        if SEARCH_TRIGGER.upper() == 'ENTER':
            type_xpath_any_frame(driver, SEARCH_INPUT_XPATH, Keys.ENTER, timeout=5, clear=False)
        else:
            clicked = click_xpath_any_frame(driver, SEARCH_BTN_XPATH, timeout=20)
            if not clicked:
                return False, driver

        # ✅ 탭 내용이 로드되어 결과 이미지가 '보일 때'까지 대기
        ready = wait_visible_any_frame(driver, RESULT_READY_XPATH, timeout=30)
        if not ready:
            return False, driver
        
        # ✅ 결과 탭(ostpTab3) 클릭
        tab_ok = click_xpath_any_frame(driver, TAB3_XPATH, timeout=20)
        if not tab_ok:
            return False, driver


    return True, driver


app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=False)

def run_gris_job(job_id: str, address: str):
    try:
        ok, _driver = open_and_click(address=address, visible=True)
        JOBS[job_id] = {"ok": ok, "address": address, "ts": time.time(), "status": "done" if ok else "fail"}
        print(f"[GRIS] ({job_id}) done ok={ok} address={address}")
    except Exception as e:
        JOBS[job_id] = {"ok": False, "address": address, "ts": time.time(), "status": "error", "error": str(e)}
        print(f"[GRIS] ({job_id}) error:", e)


@app.route("/api/gris-start", methods=["POST","OPTIONS"])
@cross_origin(origins="*", 
              methods=["POST","OPTIONS"],
              allow_headers=["Content-Type"],
              supports_credentials=False)
def api_gris_start():
    print("[API] gris-start hit")
    payload = request.get_json(silent=True) or {}
    address = (payload.get("address") or "").strip()
    if not address:
        return jsonify({"ok": False, "message": "address가 비어있습니다."}), 400

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"ok": None, "address": address, "ts": time.time(), "status": "queued"}
    threading.Thread(target=run_gris_job, args=(job_id, address), daemon=True).start()
    return jsonify({"ok": True, "message": "job accepted", "job_id": job_id, "address": address}), 202

@app.after_request
def add_headers(resp):
    # PNA 대응 (HTTPS 페이지 → localhost 접근)
    resp.headers['Access-Control-Allow-Private-Network'] = 'true'
    return resp


@app.get('/api/ping')
def ping():
    return jsonify(ok=True, msg='pong')

@app.get("/")
def root():
    return "백억지도 API OK"

@app.get("/health")
def health():
    return jsonify({"ok": True})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
