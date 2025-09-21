import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time

# 드라이버 실행
driver = uc.Chrome(headless=False)
driver.get("https://www.tworld.co.kr/web/home")

try:
    # 최대 10초 동안 대기 → 요소가 나타나면 클릭
    close_btn = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable((By.XPATH, '//*[@id="expiredCloseIcon"]'))
    )
    close_btn.click()
    print("닫기 버튼 클릭 완료!")
except Exception as e:
    print("닫기 버튼을 찾지 못했거나 클릭 실패:", e)

try:
    # 최대 10초 동안 대기 → 요소가 나타나면 클릭
    close_btn = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable((By.XPATH, '//*[@id="header"]/div/div[2]/div/div[1]/div[5]/a'))
    )
    close_btn.click()
    print("MY페이지 클릭 완료!")
except Exception as e:
    print("MY페이지 클릭 실패:", e)

try:
    # inputId 요소가 나타날 때까지 기다리기 (최대 10초)
    input_box = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.XPATH, '//*[@id="inputId"]'))
    )
    # 값 입력
    input_box.clear()   # 혹시 기존 값이 있다면 지우기
    input_box.send_keys("01071689123")
    print("아이디 입력 완료!")
except Exception as e:
    print("inputId를 찾지 못했거나 입력 실패:", e)

try:
    # inputId 요소가 나타날 때까지 기다리기 (최대 10초)
    input_box = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.XPATH, '//*[@id="inputPassword"]'))
    )
    # 값 입력
    input_box.clear()   # 혹시 기존 값이 있다면 지우기
    input_box.send_keys("wqwq!21221")
    print("비번 입력 완료!")
except Exception as e:
    print("비번입력을 찾지 못했거나 입력 실패:", e)
    
try:
    # 최대 10초 동안 대기 → 요소가 나타나면 클릭
    close_btn = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable((By.XPATH, '/html/body/div[1]/main/div[2]/div[1]/button'))
    )
    close_btn.click()
    print("로그인 클릭 완료!")
except Exception as e:
    print("로그인 클릭 실패:", e)

try:
    # 최대 10초 동안 대기 → 요소가 나타나면 클릭
    close_btn = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable((By.XPATH, '//*[@id="section_one_data"]/div/div[5]/button[2]'))
    )
    close_btn.click()
    print("데이터선물 클릭 완료!")
except Exception as e:
    print("데이터선물 클릭 실패:", e)

try:
    # inputId 요소가 나타날 때까지 기다리기 (최대 10초)
    input_box = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.XPATH, '//*[@id="histSvcNum"]'))
    )
    # 값 입력
    input_box.clear()   # 혹시 기존 값이 있다면 지우기
    input_box.send_keys("여기에번호입력")
    print("번호 입력 완료!")
except Exception as e:
    print("번호를 찾지 못했거나 입력 실패:", e)
    

# 이후 필요한 작업 ...
time.sleep(5)
driver.quit()
