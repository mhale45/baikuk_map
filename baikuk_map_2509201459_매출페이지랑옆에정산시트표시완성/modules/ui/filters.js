import { CONFIG } from '../core/config.js';

export function renderFilterButtons(onChange){
  const wrap = document.getElementById('filter-btns-wrap');
  wrap.innerHTML = '';
  CONFIG.FILTER_DEFS.forEach(def => {
    const box = document.createElement('div'); box.className='relative';
    const btn = document.createElement('button');
    btn.id = `filter-btn-${def.id}`;
    btn.className = 'px-2 py-2 border border-gray-300 bg-white rounded-md shadow-sm text-[14px] text-gray-800 font-medium hover:bg-gray-100';
    btn.dataset.defaultLabel = def.label + ' ▼';
    btn.innerText = def.label + ' ▼';
    btn.addEventListener('click', () => toggleFilterPanel(def.id));

    const panel = document.createElement('div');
    panel.id = `filter-panel-${def.id}`;
    panel.className = 'hidden absolute left-0 mt-1 bg-white border rounded shadow z-50 p-3';
    panel.style.width = `${def.width}px`;
    panel.innerHTML = `
      <div class="flex items-center gap-2">
        <input id="${def.id}_min" type="number" placeholder="이상" class="w-20 px-2 py-1 border rounded text-sm" />
        <span class="text-gray-500">~</span>
        <input id="${def.id}_max" type="number" placeholder="이하" class="w-20 px-2 py-1 border rounded text-sm" />
      </div>`;

    const update = () => { updateFilterButtonText(def.id); onChange(); };
    panel.querySelector(`#${def.id}_min`).addEventListener('input', update);
    panel.querySelector(`#${def.id}_max`).addEventListener('input', update);

    box.append(btn, panel);
    wrap.appendChild(box);
  });
}

export function getFilterValues(){
  const values = {};
  CONFIG.FILTER_DEFS.forEach(def => {
    const id = def.id;
    const col = id==='rent' ? 'monthly_rent' : id==='deposit' ? 'deposit_price' : id==='sale' ? 'sale_price' : id;
    values[`${col}_min`] = parseFloat(document.getElementById(`${id}_min`)?.value);
    values[`${col}_max`] = parseFloat(document.getElementById(`${id}_max`)?.value);
  });
  return values;
}

export function toggleFilterPanel(type){
  document.querySelectorAll('[id^="filter-panel-"]').forEach(p => {
    p.classList.toggle('hidden', p.id !== `filter-panel-${type}` || !p.classList.contains('hidden')===false);
    if (p.id === `filter-panel-${type}`) p.classList.toggle('hidden');
  });
}

export function updateFilterButtonText(type){
  const min = document.getElementById(`${type}_min`)?.value;
  const max = document.getElementById(`${type}_max`)?.value;
  const btn = document.getElementById(`filter-btn-${type}`);
  if (!btn) return;

  const units = CONFIG.FILTER_UNITS;
  const fmt = (t,v)=>{
    if (v===''||v==null) return '';
    const n = Number(v); if (!Number.isFinite(n)) return '-';
    if (['sale','deposit','rent','total_deposit','total_rent'].includes(type)) return (n>=10000?`${Math.floor(n/10000)}억 ${n%10000||''}`:n) + (n<10000?'만':'');
    if (['floor','area_py'].includes(type)) return `${n}${units[type]}`;
    return v;
  };
  let label = btn.dataset.defaultLabel;
  if (min||max){
    const l = (min && max) ? `${fmt(type,min)}~${fmt(type,max)}` : (min ? `${fmt(type,min)}~` : `~${fmt(type,max)}`);
    label = l;
  }
  btn.textContent = label;
}
