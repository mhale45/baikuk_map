// recommend_imDae.js

export function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;

  toast.style.backgroundColor = '#F2C130';
  toast.style.color = 'black';
  toast.style.fontWeight = 'bold';
  toast.className =
    'fixed top-5 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded shadow-lg z-[9999]';

  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

export function setDocumentTitle(name) {
  document.title = (name && name.trim()) ? name.trim() : '임대추천';
}

export function formatKoreanMoney(value) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (isNaN(num)) return '-';
  return num.toLocaleString('ko-KR');
}
