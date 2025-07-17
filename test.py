import boto3

endpoint_url = 'https://sfinbtiqlfnaaarziixu.supabase.co/storage/v1/s3'
bucket_name = 'biakuk-images'
access_key = '3fa6a28605e7e00e5bbe77d41d1d08dc'
secret_key = '1fd459894e8b1de28ebfcd4979144e2db8b483e913cf7c987f54a9e6674ff29f'

# 올릴 파일 경로와 버킷 내 저장될 이름
file_path = 'D:/Google Drive 스트리밍/.shortcut-targets-by-id/1sBcKPNAnMj7y9DLTd2lxTNJIwVwTirA3/업무폴더-운정상가/명근/일러스트_포토샵/백억공인중개사 로고파일입니다/baikuk-simbol-logo.png'
object_name = 'baikuk-simbol-logo.png'  # 버킷 내 저장될 파일명

session = boto3.session.Session()
s3 = session.client(
    service_name='s3',
    endpoint_url=endpoint_url,
    aws_access_key_id=access_key,
    aws_secret_access_key=secret_key,
)

# 실제 업로드
s3.upload_file(file_path, bucket_name, object_name)
print("업로드 성공!")
