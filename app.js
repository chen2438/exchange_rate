const BOC_CURRENCIES = [
    'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'SGD',
    'CHF', 'NZD', 'KRW', 'THB', 'MYR', 'RUB', 'ZAR', 'SEK',
    'DKK', 'NOK', 'TWD', 'AED', 'SAR'
];

const CURRENCY_NAME_MAP = {
    'USD': '美元',
    'EUR': '欧元',
    'GBP': '英镑',
    'JPY': '日元',
    'HKD': '港币',
    'AUD': '澳大利亚元',
    'CAD': '加拿大元',
    'SGD': '新加坡元',
    'CHF': '瑞士法郎',
    'NZD': '新西兰元',
    'KRW': '韩国元',
    'THB': '泰国铢',
    'MYR': '林吉特',
    'RUB': '卢布',
    'ZAR': '南非兰特',
    'SEK': '瑞典克朗',
    'DKK': '丹麦克朗',
    'NOK': '挪威克朗',
    'TWD': '新台币',
    'AED': '阿联酋迪拉姆',
    'SAR': '沙特里亚尔'
};

let currentRate = null;
let currentCurrency = 'USD';
let currentGBPRate = null;
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
    rate1: document.getElementById('rate1'),
    rate2: document.getElementById('rate2'),
    rate3: document.getElementById('rate3'),
    resultItems: document.querySelectorAll('.results-section .result-item:not(.main-result):not(.gbp-result)'),
    gbpResult: document.getElementById('gbpResult'),
    gbpRateInfo: document.getElementById('gbpRateInfo'),
    gbpSuggestion: document.getElementById('gbpSuggestion'),
    copyBtn: document.getElementById('copyBtn')
};

function isValidRate(rate) {
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

async function fetchBOCRate(currency) {
    const response = await fetch(`${window.location.origin}/api/boc-rate/${currency}`);
    if (!response.ok) {
        throw new Error('获取中国银行汇率失败');
    }
    const data = await response.json();
    if (!data || data.currency !== currency || !isValidRate(data.rate) ||
        !['remittance', 'cash'].includes(data.rateType)) {
        throw new Error('中国银行汇率数据无效');
    }
    return { rate: data.rate, source: 'BOC', rateType: data.rateType, bocFailed: false };
}

async function fetchMarketRate(currency, target) {
    const endpoints = [
        `https://api.exchangerate-api.com/v4/latest/${currency}`,
        `https://open.er-api.com/v6/latest/${currency}`
    ];
    for (const [index, endpoint] of endpoints.entries()) {
        try {
            const response = await fetch(endpoint);
            if (!response.ok) {
                throw new Error('汇率接口请求失败');
            }
            const data = await response.json();
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

async function fetchGBPRate(currency) {
    if (currency === 'GBP') return 1;
    try {
        return await fetchMarketRate(currency, 'GBP');
    } catch (error) {
        console.error('获取英镑汇率失败:', error);
        return null;
    }
}

async function fetchExchangeRate(currency) {
    if (currency === 'CNY') return { rate: 1, source: 'CNY', bocFailed: false };
    const isBOCCurrency = BOC_CURRENCIES.includes(currency);
    if (isBOCCurrency) {
        try {
            return await fetchBOCRate(currency);
        } catch (error) {
            console.error('中国银行汇率获取失败，使用备用数据源:', error);
        }
    }
    return {
        rate: await fetchMarketRate(currency, 'CNY'),
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

function updateGBPDisplay(amount, gbpRate) {
    if (!isValidRate(gbpRate) || amount <= 0) {
        elements.gbpResult.textContent = amount > 0 ? '暂不可用' : '£ 0.00';
        elements.gbpRateInfo.textContent = '';
        elements.gbpSuggestion.textContent = amount > 0 ? '建议数额暂不可用' : '建议数额 £ 0.00';
        return;
    }

    const gbpAmount = amount * gbpRate;
    const suggestedAmount = currentCurrency === 'GBP' ? gbpAmount : gbpAmount * 1.01;
    elements.gbpResult.textContent = formatGBP(gbpAmount);
    elements.gbpSuggestion.textContent = '建议数额 ' + formatGBP(suggestedAmount);
    elements.gbpRateInfo.textContent = `1 ${currentCurrency} = ${gbpRate.toFixed(4)} GBP`;
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
    elements.gbpResult.textContent = placeholder;
    elements.gbpSuggestion.textContent = `建议数额 ${placeholder}`;
    elements.gbpRateInfo.textContent = '';
    elements.rateInfo.textContent = '';
    elements.updateTime.textContent = '';
    elements.resultItems.forEach(item => item.classList.remove('highlighted'));
}

function calculate() {
    const amount = Number(elements.amount.value);
    if (isUpdatingRate || !currentRate || currentCurrency !== elements.currency.value ||
        !isValidRate(currentRate.rate)) {
        clearResults();
        return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        clearResults(formatCurrency(0));
        updateGBPDisplay(0, null);
        return;
    }

    const rate = currentRate.rate;
    const baseAmount = amount * rate;
    const [multiplier1, multiplier2, multiplier3] = getMultipliers();
    // Keep overflow or invalid input from becoming a displayable/copyable quote.
    if (!Number.isFinite(baseAmount * multiplier1 + 5)) {
        clearResults();
        return;
    }

    const amount1 = baseAmount * multiplier1 + 5;
    const amount2 = baseAmount * multiplier2;
    const amount3 = baseAmount * multiplier3;

    const diff1 = amount1 - baseAmount;
    const diff2 = amount2 - baseAmount;
    const diff3 = amount3 - baseAmount;

    elements.baseResult.textContent = formatCurrency(baseAmount);
    elements.result1.textContent = formatCurrency(amount1);
    elements.result2.textContent = formatCurrency(amount2);
    elements.result3.textContent = formatCurrency(amount3);

    updateDifference(elements.diff1, diff1);
    updateDifference(elements.diff2, diff2);
    updateDifference(elements.diff3, diff3);

    const profit1 = amount1 * 0.988 - baseAmount;
    const profit2 = amount2 * 0.988 - baseAmount;
    const profit3 = amount3 * 0.988 - baseAmount;

    updateProfit(elements.profit1, profit1);
    updateProfit(elements.profit2, profit2);
    updateProfit(elements.profit3, profit3);

    updateHighlight(baseAmount);

    const rateLabel = currentRate.source === 'BOC'
        ? `中国银行${currentRate.rateType === 'cash' ? '现钞' : '现汇'}卖出价`
        : currentRate.source === 'CNY' ? '人民币' : '市场汇率';
    elements.rateInfo.textContent = `${rateLabel} · 1 ${currentCurrency} = ${rate.toFixed(4)} CNY`;
    updateGBPDisplay(amount, currentGBPRate);
    const selectedAmount = baseAmount >= 1000 ? amount3 : baseAmount >= 100 ? amount2 : amount1;
    currentQuote = { currency: currentCurrency, amount, value: selectedAmount, requestId: rateRequestId };
    elements.copyBtn.disabled = false;
}

function updateHighlight(baseAmount) {
    elements.resultItems.forEach((item, index) => {
        item.classList.remove('highlighted');
    });

    if (baseAmount >= 1000) {
        elements.resultItems[2].classList.add('highlighted');
    } else if (baseAmount >= 100) {
        elements.resultItems[1].classList.add('highlighted');
    } else if (baseAmount > 0) {
        elements.resultItems[0].classList.add('highlighted');
    }
}

function updateDifference(element, diff) {
    const sign = diff >= 0 ? '+' : '';
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
    const sign = profit >= 0 ? '+' : '';
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
    // Recompute from the current input, never copy a previously rendered card.
    calculate();
    const quote = currentQuote;
    if (!quote || isUpdatingRate) {
        showNotice('请等待有效汇率并输入有效金额后再复制', 'warning');
        return;
    }
    const currencyName = CURRENCY_NAME_MAP[quote.currency] || quote.currency;
    const resultValue = formatCurrency(quote.value).replace(/[^0-9.]/g, '');
    const copyText = `${quote.amount} ${currencyName} 共收 ${resultValue} 人民币`;
    try {
        if (!navigator.clipboard?.writeText) throw new Error('浏览器不支持剪贴板');
        await navigator.clipboard.writeText(copyText);
        if (quote.requestId !== rateRequestId || quote.currency !== elements.currency.value ||
            quote.amount !== Number(elements.amount.value) || !currentQuote) return;
        showNotice('复制成功: ' + copyText, 'info');
    } catch (error) {
        if (quote.requestId !== rateRequestId) return;
        console.error('复制失败:', error);
        showNotice('复制失败，请手动复制', 'warning');
    }
}

async function updateExchangeRate() {
    const requestId = ++rateRequestId;
    const currency = elements.currency.value;
    currentCurrency = currency;
    currentRate = null;
    currentGBPRate = null;
    isUpdatingRate = true;
    clearResults();
    [elements.rate1, elements.rate2, elements.rate3].forEach(element => {
        element.textContent = '—';
    });
    hideNotice();
    showLoading(true);

    try {
        const [result, gbpRate] = await Promise.all([
            fetchExchangeRate(currency),
            fetchGBPRate(currency)
        ]);
        // Every update to shared state and UI belongs to the latest selection only.
        if (requestId !== rateRequestId) return;
        currentRate = result;
        currentGBPRate = gbpRate;
        isUpdatingRate = false;
        updateRateDisplay();
        calculate();
        elements.updateTime.textContent = `更新时间: ${new Date().toLocaleString('zh-CN')}`;

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
        if (!isValidRate(gbpRate)) {
            message += '；英镑汇率暂不可用';
            type = 'warning';
        }
        showNotice(message, type);
    } catch (error) {
        if (requestId !== rateRequestId) return;
        currentRate = null;
        currentGBPRate = null;
        clearResults();
        console.error('汇率更新失败:', error);
        showNotice('❌ 汇率获取失败，报价已清空，请重新选择币种重试', 'warning');
    } finally {
        if (requestId === rateRequestId) {
            isUpdatingRate = false;
            showLoading(false);
        }
    }
}

elements.currency.addEventListener('change', updateExchangeRate);
elements.amount.addEventListener('input', calculate);
elements.copyBtn.addEventListener('click', copyResult);

updateExchangeRate();
