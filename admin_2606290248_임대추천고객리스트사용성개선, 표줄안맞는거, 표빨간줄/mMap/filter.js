// filter.js
// 모든 숫자(min/max) 필터와 체크박스 필터를 공통 관리하는 모듈

export const numericFilters = {
    floor: "floor",
    area: "area_py",
    deposit: "deposit_price",
    rent: "monthly_rent",
    premium: "premium_price",
    sale: "sale_price",
    "total-deposit": "total_deposit",
    "total-rent": "total_rent",
    roi: "roi",
    rent_per_py: "rent_per_py"
};

// 공통: 체크박스 필터들
export function getSelectedStatuses() {
    return Array.from(document.querySelectorAll(".status-check:checked"))
        .map(cb => cb.value);
}

export function getSelectedDealTypes() {
    return Array.from(document.querySelectorAll(".dealtype-check:checked"))
        .map(cb => cb.value);
}

export function getSelectedCategories() {
    return Array.from(document.querySelectorAll(".category-check:checked"))
        .map(cb => cb.value);
}

// min/max 읽기
export function getNumericFilterRange(key) {
    const minInput = document.getElementById(`${key}-min`);
    const maxInput = document.getElementById(`${key}-max`);

    const minVal = minInput?.value !== "" ? Number(minInput.value) : null;
    const maxVal = maxInput?.value !== "" ? Number(maxInput.value) : null;

    return {
        min: (minVal !== null && !isNaN(minVal)) ? minVal : null,
        max: (maxVal !== null && !isNaN(maxVal)) ? maxVal : null
    };
}

// 리스트에 숫자 필터 적용
export function applyNumericFilters(listings) {
    return listings.filter(item => {
        for (const key in numericFilters) {
            const col = numericFilters[key];
            const { min, max } = getNumericFilterRange(key);

            if (min === null && max === null) continue;

            const val = Number(item[col]);
            if (isNaN(val)) continue;

            if (min !== null && val < min) return false;
            if (max !== null && val > max) return false;
        }
        return true;
    });
}

// 체크박스 + 숫자 필터 동시에 적용
export function applyAllFilters(listings) {
    // 체크박스 필터
    const statuses = getSelectedStatuses();
    const dealTypes = getSelectedDealTypes();
    const categories = getSelectedCategories();

    let filtered = [...listings];

    if (statuses.length > 0) {
        filtered = filtered.filter(i =>
            statuses.some(s => (i.transaction_status || "").includes(s))
        );
    }

    if (dealTypes.length > 0) {
        filtered = filtered.filter(i =>
            dealTypes.some(t => (i.deal_type || "").includes(t))
        );
    }

    if (categories.length > 0) {
        filtered = filtered.filter(i =>
            categories.some(c => (i.category || "").includes(c))
        );
    }

    // 숫자 필터
    filtered = applyNumericFilters(filtered);

    return filtered;
}

// 입력값 변경 이벤트 등록
export function attachFilterInputEvents(onChange) {
    [
        ".status-check",
        ".dealtype-check",
        ".category-check"
    ].forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            el.addEventListener("change", onChange);
        });
    });

    Object.keys(numericFilters).forEach(key => {
        ["min", "max"].forEach(type => {
            const el = document.getElementById(`${key}-${type}`);
            if (el) el.addEventListener("change", onChange);
        });
    });
}
