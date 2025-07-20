# 위도, 경도 열 추가하고 카카오api로 수집
# import pandas as pd
# import requests
# import time

# def get_lat_lng(address, api_key, retries=3):
#     url = "https://dapi.kakao.com/v2/local/search/address.json"
#     headers = {"Authorization": f"KakaoAK {api_key}"}
#     params = {"query": address}

#     for attempt in range(retries):
#         try:
#             response = requests.get(url, headers=headers, params=params)
#             status_code = response.status_code

#             if status_code == 200:
#                 result = response.json()
#                 documents = result.get("documents", [])
#                 if documents:
#                     lat = float(documents[0]["y"])
#                     lng = float(documents[0]["x"])
#                     return lat, lng
#                 else:
#                     print(f"⚠️ 주소 변환 실패 (결과 없음): '{address}'")
#                     return 0.0, 0.0
#             elif status_code == 401:
#                 print(f"❌ API 키 오류: API 키를 확인하세요.")
#                 return 0.0, 0.0
#             elif status_code == 429:
#                 print(f"⚠️ 요청 제한 초과 (429): {attempt + 1}/{retries}회 재시도 중...")
#                 time.sleep(2)
#             else:
#                 print(f"❌ API 요청 실패 (HTTP {status_code}): {response.text}")
#                 return 0.0, 0.0

#         except requests.exceptions.RequestException as e:
#             print(f"❌ 예외 발생: {e}")
#             time.sleep(2)

#     print(f"❌ 모든 재시도 실패: '{address}'")
#     return 0.0, 0.0


# # ✅ 주요 실행 부분
# def process_csv_and_add_lat_lng(input_path, output_path, api_key):
#     df = pd.read_csv(input_path)

#     # 주소 열이 없는 경우 대비
#     required_cols = ['province', 'city', 'district', 'address_detail']
#     for col in required_cols: 
#         if col not in df.columns:
#             raise KeyError(f"❌ '{col}' 열이 존재하지 않습니다. 열 이름을 확인하세요.")

#     lat_list, lng_list = [], []

#     for idx, row in df.iterrows():
#         address = f"{row['province']} {row['city']} {row['district']} {row['address_detail']}"
#         lat, lng = get_lat_lng(address, api_key)
#         lat_list.append(lat)
#         lng_list.append(lng)
#         print(f"[{idx+1}/{len(df)}] {address} → 위도: {lat}, 경도: {lng}")

#     df['lat'] = lat_list
#     df['lng'] = lng_list

#     df.to_csv(output_path, index=False, encoding='utf-8-sig')
#     print(f"\n✅ 저장 완료: {output_path}")



# # ✅ 사용 예시
# if __name__ == "__main__":
#     kakao_api_key = "2bc87e55e54855e459d1f38d6ed96a3b"  # 예: "0123456789abcdef..."
#     input_csv_path = "매물데이터.csv"
#     output_csv_path = "매물데이터_with_latlng.csv"
    
#     process_csv_and_add_lat_lng(input_csv_path, output_csv_path, kakao_api_key)



# 주어진 열에 대해 - 같은 문자는 0으로 처리하고, 나머지는 int로 변환하는 Python 코드
import pandas as pd

# 처리할 컬럼 목록
int_columns = [
    'listing_id', 'floor', 'total_floors', 'sale_price', 'deposit_price', 'monthly_rent',
    'premium_price', 'total_deposit', 'total_rent', 'room_count', 'bathroom_count', 'parking'
]

# CSV 파일 불러오기
df = pd.read_csv("매물데이터.csv")

# 각 컬럼에 대해 처리
for col in int_columns:
    df[col] = df[col].apply(
        lambda x: 0 if pd.isna(x) or str(x).strip() == '-' 
        else int(float(str(x).replace(",", "").strip()))
    )

# 결과 확인
print(df[int_columns].head())

# 저장 (선택 사항)
df.to_csv("정리된_매물데이터.csv", index=False, encoding='utf-8-sig')
