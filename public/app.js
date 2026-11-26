let currentRate = null;
let currentCurrency = 'USD';
let currentGBPRate = null;
let isUpdatingGBPRate = true;
const REQUEST_TIMEOUT_MS = 8000;
const QUOTE_TTL_MS = 5 * 60 * 1000;
// Keep integer-cent products used by the 0.988 profit formula exact.
const MAX_BASE_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / 2000);
const centFormatter = new Intl.NumberFormat('en-US', {
    useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2
});
let quoteExpiryTimer;
let rateRequestId = 0;
let isUpdatingRate = true;
let currentQuote = null;

const elements = {
    currency: document.getElementById('currency'),
    amount: document.getElementById('amount'),
    baseResult: document.getElementById('baseResult'),
    result1: document.getElementById('result1'),
    result2: document.getElementById('result2'),
    result3: document.getElementById('result3'),
    diff1: document.getElementById('diff1'),
    diff2: document.getElementById('diff2'),
    diff3: document.getElementById('diff3'),
    profit1: document.getElementById('profit1'),
    profit2: document.getElementById('profit2'),
    profit3: document.getElementById('profit3'),
    notice: document.getElementById('notice'),
    noticeContent: document.querySelector('.notice-content'),
    loading: document.getElementById('loading'),
    rateInfo: document.getElementById('rateInfo'),
    updateTime: document.getElementById('updateTime'),
    checkedTime: document.getElementById('checkedTime'),
    refreshBtn: document.getElementById('refreshBtn'),
    rate1: document.getElementById('rate1'),
    rate2: document.getElementById('rate2'),
    rate3: document.getElementById('rate3'),
    resultItems: document.querySelectorAll('.results-section .result-item:not(.main-result):not(.gbp-result)'),
    gbpResult: document.getElementById('gbpResult'),
    gbpRateInfo: document.getElementById('gbpRateInfo'),
    gbpSuggestion: document.getElementById('gbpSuggestion'),
    copyBtn: document.getElementById('copyBtn'),
    retryBtn: document.getElementById('retryBtn')
};

function populateCurrencies() {
    for (const [code, { name, region, flag, label }] of Object.entries(CURRENCIES)) {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = `${flag} ${region} - ${label ?? name} (${code})`;
        elements.currency.appendChild(option);
    }
    elements.currency.value = currentCurrency;
}

function formatUnitRate(rate) {
    return rate >= 0.001 ? rate.toFixed(4) : rate.toPrecision(5);
}

function isValidRate(rate) {
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

async function fetchRateJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('汇率接口请求失败');
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function fetchBOCRate(currency) {
    const startedAt = Date.now();
    const data = await fetchRateJSON(`${window.location.origin}/api/boc-rate/${currency}`);
    if (!data || data.currency !== currency || !isValidRate(data.rate) ||
        !['remittance', 'cash'].includes(data.rateType)) {
        throw new Error('中国银行汇率数据无效');
    }
    return {
        rate: data.rate, source: 'BOC', rateType: data.rateType, bocFailed: false,
        publishedAt: data.publishedAt, cached: data.cached,
        // Anchor the server's remaining cache lifetime to the start of this request.
        expiresAt: Number.isFinite(data.validForMs)
            ? startedAt + Math.max(0, Math.min(data.validForMs, QUOTE_TTL_MS))
            : undefined
    };
}

async function fetchMarketRate(currency, target, marketRequests = new Map()) {
    const endpoints = [
        `https://api.exchangerate-api.com/v4/latest/${currency}`,
        `https://open.er-api.com/v6/latest/${currency}`
    ];
    for (const [index, endpoint] of endpoints.entries()) {
        try {
            if (!marketRequests.has(endpoint)) marketRequests.set(endpoint, fetchRateJSON(endpoint));
            const data = await marketRequests.get(endpoint);
            if (!data || (index === 1 && data.result !== 'success') ||
                (data.result !== undefined && data.result !== 'success') ||
                (data.base !== undefined && data.base !== currency) ||
                (data.base_code !== undefined && data.base_code !== currency) ||
                !isValidRate(data.rates?.[target])) {
                throw new Error('汇率接口数据无效');
            }
            return data.rates[target];
        } catch (error) {
            console.error('汇率数据源不可用:', endpoint, error);
        }
    }
    throw new Error('无法获取有效汇率，请稍后重试');
}

async function fetchGBPRate(currency, marketRequests) {
    if (currency === 'GBP') return 1;
    try {
        return await fetchMarketRate(currency, 'GBP', marketRequests);
    } catch (error) {
        console.error('获取英镑汇率失败:', error);
        return null;
    }
}

async function fetchExchangeRate(currency, marketRequests) {
    if (currency === 'CNY') return { rate: 1, source: 'CNY', bocFailed: false };
    const isBOCCurrency = CURRENCIES[currency]?.boc === true;
    if (isBOCCurrency) {
        try {
            return await fetchBOCRate(currency);
        } catch (error) {
            console.error('中国银行汇率获取失败，使用备用数据源:', error);
        }
    }
    return {
        rate: await fetchMarketRate(currency, 'CNY', marketRequests),
        source: isBOCCurrency ? 'fallback' : 'market',
        bocFailed: isBOCCurrency
    };
}

function showLoading(show) {
    if (show) {
        elements.loading.classList.add('show');
    } else {
        elements.loading.classList.remove('show');
    }
}

function showNotice(message, type = 'info') {
    console.log('📢 显示提示:', message, '类型:', type);
    elements.noticeContent.textContent = message;
    elements.noticeContent.className = `notice-content show ${type}`;
}

function hideNotice() {
    elements.noticeContent.classList.remove('show');
}

function formatCurrency(value) {
    return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

function formatGBP(value) {
    return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

function updateGBPDisplay(amount) {
    const gbpRate = currentGBPRate;
    if (isUpdatingGBPRate) {
        elements.gbpResult.textContent = '正在获取英镑汇率…';
        elements.gbpSuggestion.textContent = '';
        elements.gbpRateInfo.textContent = '';
        return;
    }
    if (!isValidRate(gbpRate) || !isValidRate(amount) || !Number.isFinite(amount * gbpRate * 1.01)) {
        elements.gbpResult.textContent = !isValidRate(gbpRate) || amount > 0 ? '暂不可用' : '£ 0.00';
        elements.gbpRateInfo.textContent = '';
        elements.gbpSuggestion.textContent = !isValidRate(gbpRate) || amount > 0 ? '建议数额暂不可用' : '建议数额 £ 0.00';
        return;
    }

    const gbpAmount = amount * gbpRate;
    const suggestedAmount = currentCurrency === 'GBP' ? gbpAmount : gbpAmount * 1.01;
    elements.gbpResult.textContent = formatGBP(gbpAmount);
    elements.gbpSuggestion.textContent = '建议数额 ' + formatGBP(suggestedAmount);
    elements.gbpRateInfo.textContent = `1 ${currentCurrency} = ${formatUnitRate(gbpRate)} GBP`;
}

function getMultipliers() {
    const useMarketRate = currentRate?.source === 'fallback' || currentRate?.source === 'market';
    return useMarketRate ? [1.07, 1.07, 1.06] : [1.06, 1.06, 1.05];
}

function updateRateDisplay() {
    const multipliers = getMultipliers();
    [elements.rate1, elements.rate2, elements.rate3].forEach((element, index) => {
        element.textContent = multipliers[index].toFixed(2);
    });
}

function clearResults(placeholder = '—') {
    currentQuote = null;
    elements.copyBtn.disabled = true;
    elements.copyBtn.textContent = '📋 复制结果';
    [elements.baseResult, elements.result1, elements.result2, elements.result3,
        elements.diff1, elements.diff2, elements.diff3].forEach(element => {
        element.textContent = placeholder;
        element.classList.remove('positive', 'negative');
    });
    [elements.profit1, elements.profit2, elements.profit3].forEach(element => {
        element.textContent = `综合利润 ${placeholder}`;
        element.classList.remove('positive', 'negative');
    });
    elements.rateInfo.textContent = '';
    elements.resultItems.forEach(item => item.classList.remove('highlighted'));
}

function expireQuoteIfNeeded() {
    if (currentRate?.expiresAt === undefined || Date.now() < currentRate.expiresAt) return false;
    clearResults();
    showNotice('人民币报价已过期，请刷新汇率后再复制。', 'warning');
    return true;
}

function calculate() {
    if (expireQuoteIfNeeded()) return;
    const amount = Number(elements.amount.value);
    if (isUpdatingRate || !currentRate || currentCurrency !== elements.currency.value ||
        !isValidRate(currentRate.rate)) {
        clearResults();
        return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        clearResults(formatCurrency(0));
        return;
    }

    const rate = currentRate.rate;
    const converted = amount * rate;
    const baseCents = Number(centFormatter.format(converted).replace('.', ''));
    if (!Number.isSafeInteger(baseCents) || baseCents > MAX_BASE_CENTS) {
        clearResults();
        return;
    }
    if (baseCents === 0) {
        clearResults(formatCurrency(0));
        return;
    }

    const tier = baseCents >= 100000 ? 2 : baseCents >= 10000 ? 1 : 0;
    const quoteCents = getMultipliers().map((multiplier, index) =>
        Math.round(baseCents * Math.round(multiplier * 100) / 100) + (index === 0 ? 500 : 0)
    );
    const results = [elements.result1, elements.result2, elements.result3];
    const differences = [elements.diff1, elements.diff2, elements.diff3];
    const profits = [elements.profit1, elements.profit2, elements.profit3];
    elements.baseResult.textContent = formatCurrency(baseCents / 100);
    quoteCents.forEach((cents, index) => {
        results[index].textContent = formatCurrency(cents / 100);
        updateDifference(differences[index], (cents - baseCents) / 100);
        const profitNumerator = cents * 988 - baseCents * 1000;
        const profitCents = Math.sign(profitNumerator) * Math.round(Math.abs(profitNumerator) / 1000);
        updateProfit(profits[index], profitCents / 100);
    });
    elements.resultItems.forEach((item, index) => item.classList.toggle('highlighted', index === tier));

    const rateLabel = currentRate.source === 'BOC'
        ? `中国银行${currentRate.rateType === 'cash' ? '现钞' : '现汇'}卖出价`
        : currentRate.source === 'CNY' ? '人民币' : '市场汇率';
    elements.rateInfo.textContent = `${rateLabel} · 1 ${currentCurrency} = ${formatUnitRate(rate)} CNY`;
    currentQuote = { currency: currentCurrency, amount, value: quoteCents[tier] / 100, requestId: rateRequestId };
    elements.copyBtn.disabled = false;
}

function updateDifference(element, diff) {
    const sign = diff >= 0 ? '+' : '−';
    element.textContent = sign + formatCurrency(Math.abs(diff));

    if (diff >= 0) {
        element.classList.remove('negative');
        element.classList.add('positive');
    } else {
        element.classList.remove('positive');
        element.classList.add('negative');
    }
}

function updateProfit(element, profit) {
    const sign = profit >= 0 ? '+' : '−';
    element.textContent = '综合利润 ' + sign + formatCurrency(Math.abs(profit));

    if (profit >= 0) {
        element.classList.remove('negative');
        element.classList.add('positive');
    } else {
        element.classList.remove('positive');
        element.classList.add('negative');
    }
}

async function copyResult() {
    if (expireQuoteIfNeeded()) return;
    calculate();
    const quote = currentQuote;
    if (!quote || isUpdatingRate) {
        showNotice('请等待有效汇率并输入有效金额后再复制', 'warning');
        return;
    }
    const currencyName = quote.currency === 'CNY' ? 'CNY' : CURRENCIES[quote.currency]?.name || quote.currency;
    const resultValue = formatCurrency(quote.value).replace(/[^0-9.]/g, '');
    const copyText = `${quote.amount} ${currencyName} 共收 ${resultValue} 人民币`;
    try {
        if (!navigator.clipboard?.writeText) throw new Error('浏览器不支持剪贴板');
        await navigator.clipboard.writeText(copyText);
        if (quote.requestId !== rateRequestId || quote.currency !== elements.currency.value ||
            quote.amount !== Number(elements.amount.value) || !currentQuote || expireQuoteIfNeeded()) return;
        showNotice('复制成功: ' + copyText, 'info');
    } catch (error) {
        if (quote.requestId !== rateRequestId || expireQuoteIfNeeded()) return;
        console.error('复制失败:', error);
        showNotice('复制失败，请手动复制', 'warning');
    }
}

async function updateExchangeRate() {
    const requestId = ++rateRequestId;
    clearTimeout(quoteExpiryTimer);
    const currency = elements.currency.value;
    currentCurrency = currency;
    currentRate = null;
    currentGBPRate = null;
    isUpdatingRate = true;
    isUpdatingGBPRate = true;
    clearResults();
    updateGBPDisplay(Number(elements.amount.value));
    elements.updateTime.textContent = '';
    elements.checkedTime.textContent = '';
    elements.refreshBtn.disabled = true;
    [elements.rate1, elements.rate2, elements.rate3].forEach(element => {
        element.textContent = '—';
    });
    hideNotice();
    elements.retryBtn.hidden = true;
    showLoading(true);

    // Share responses for this update while each target validates and falls back independently.
    const marketRequests = new Map();
    const gbpUpdate = fetchGBPRate(currency, marketRequests).then(rate => {
        if (requestId !== rateRequestId) return;
        currentGBPRate = rate;
        isUpdatingGBPRate = false;
        updateGBPDisplay(Number(elements.amount.value));
    });

    try {
        const result = await fetchExchangeRate(currency, marketRequests);
        if (requestId !== rateRequestId) return;
        const checkedAt = Date.now();
        if (result.source !== 'CNY' && result.expiresAt === undefined) {
            result.expiresAt = checkedAt + QUOTE_TTL_MS;
        }
        currentRate = result;
        isUpdatingRate = false;
        updateRateDisplay();
        if (result.source !== 'CNY') {
            elements.checkedTime.textContent = `本页取价时间：${new Date(checkedAt).toLocaleString('zh-CN')}`;
        }
        if (result.source === 'BOC') {
            const published = result.publishedAt
                ? `${result.publishedAt}（北京时间）`
                : '未提供';
            const cache = result.cached === true ? ' · 缓存报价' : '';
            elements.updateTime.textContent = `中行牌价发布时间：${published}${cache}`;
        }

        let message;
        let type = 'info';
        if (result.source === 'BOC') {
            message = `✅ 使用中国银行${result.rateType === 'cash' ? '现钞' : '现汇'}卖出价计算`;
        } else if (result.source === 'CNY') {
            message = '当前选择人民币，无需汇率转换，直接按规则计算';
        } else {
            type = 'warning';
            const reason = result.bocFailed ? '中国银行汇率获取失败，已切换至备用数据源' : '该币种使用市场汇率';
            message = `⚠️ ${reason}，报价倍率提高 0.01（1.06 → 1.07，1.05 → 1.06）`;
        }
        showNotice(message, type);
        calculate();
        if (result.expiresAt !== undefined) {
            const remaining = Math.max(0, result.expiresAt - Date.now());
            quoteExpiryTimer = setTimeout(expireQuoteIfNeeded, remaining);
        }
    } catch (error) {
        if (requestId !== rateRequestId) return;
        currentRate = null;
        clearResults();
        console.error('汇率更新失败:', error);
        showNotice('人民币汇率获取失败，报价已清空。', 'warning');
        elements.retryBtn.hidden = false;
    } finally {
        if (requestId === rateRequestId) {
            isUpdatingRate = false;
            showLoading(false);
            elements.refreshBtn.disabled = false;
        }
    }
    await gbpUpdate;
}

elements.currency.addEventListener('change', updateExchangeRate);
elements.amount.addEventListener('input', () => {
    calculate();
    updateGBPDisplay(Number(elements.amount.value));
});
elements.copyBtn.addEventListener('click', copyResult);
elements.retryBtn.addEventListener('click', updateExchangeRate);
elements.refreshBtn.addEventListener('click', updateExchangeRate);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) expireQuoteIfNeeded();
});
window.addEventListener('pageshow', expireQuoteIfNeeded);

populateCurrencies();
updateExchangeRate();
