const BOC_CURRENCIES = [
    'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'SGD',
    'CHF', 'NZD', 'KRW', 'THB', 'MYR', 'RUB', 'ZAR', 'SEK',
    'DKK', 'NOK', 'TWD', 'AED', 'AER'
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
    'AER': '沙特里亚尔'
};

let currentRate = null;
let currentCurrency = 'USD';
let currentGBPRate = null;

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
    gbpSuggestion: document.getElementById('gbpSuggestion')
};

async function fetchBOCRate(currency) {
    try {
        console.log('🔍 开始获取BOC汇率:', currency);
        const apiBase = window.location.origin;
        const response = await fetch(`${apiBase}/api/boc-rate/${currency}`);
        console.log('📡 BOC响应状态:', response.status, response.ok);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('❌ BOC响应错误:', errorData);
            throw new Error(errorData.error || '获取中国银行汇率失败');
        }

        const data = await response.json();
        console.log('✅ BOC数据:', data);

        if (data.cached) {
            console.log(`📦 [缓存命中] 数据时间: ${data.cacheTime}`);
        } else {
            console.log(`🌐 [源站请求] 数据时间: ${data.cacheTime}`);
        }

        const result = { rate: data.rate, source: 'BOC', bocFailed: false };
        console.log('✅ BOC返回结果:', result);
        return result;
    } catch (error) {
        console.error('❌ BOC fetch error:', error);
        throw error;
    }
}

async function fetchGBPRate(currency) {
    if (currency === 'GBP') {
        return 1;
    }

    try {
        const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`);

        if (!response.ok) {
            throw new Error('获取GBP汇率失败');
        }

        const data = await response.json();
        return data.rates.GBP;
    } catch (error) {
        console.error('Error fetching GBP rate:', error);

        try {
            const fallbackResponse = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
            const fallbackData = await fallbackResponse.json();
            return fallbackData.rates.GBP;
        } catch (fallbackError) {
            console.error('Fallback GBP API also failed:', fallbackError);
            return null;
        }
    }
}

async function fetchExchangeRate(currency) {
    if (currency === 'CNY') {
        return { rate: 1, source: 'CNY' };
    }

    const isBOCCurrency = BOC_CURRENCIES.includes(currency);
    let bocFailed = false;

    if (isBOCCurrency) {
        try {
            return await fetchBOCRate(currency);
        } catch (error) {
            console.error('中国银行汇率获取失败，使用备用数据源:', error);
            bocFailed = true;
        }
    }

    try {
        const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`);

        if (!response.ok) {
            throw new Error('汇率获取失败');
        }

        const data = await response.json();
        return {
            rate: data.rates.CNY,
            source: bocFailed ? 'fallback' : 'market',
            bocFailed: bocFailed
        };
    } catch (error) {
        console.error('Error fetching exchange rate:', error);

        try {
            const fallbackResponse = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
            const fallbackData = await fallbackResponse.json();
            return {
                rate: fallbackData.rates.CNY,
                source: bocFailed ? 'fallback' : 'market',
                bocFailed: bocFailed
            };
        } catch (fallbackError) {
            console.error('Fallback API also failed:', fallbackError);
            throw new Error('无法获取汇率数据，请稍后重试');
        }
    }
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
    if (!gbpRate || amount <= 0) {
        elements.gbpResult.textContent = '£ 0.00';
        elements.gbpRateInfo.textContent = '';
        elements.gbpSuggestion.textContent = '建议数额 £ 0.00';
        return;
    }

    const gbpAmount = amount * gbpRate;
    const suggestedAmount = currentCurrency === 'GBP' ? gbpAmount : gbpAmount * 1.01;
    elements.gbpResult.textContent = formatGBP(gbpAmount);
    elements.gbpSuggestion.textContent = '建议数额 ' + formatGBP(suggestedAmount);
    elements.gbpRateInfo.textContent = `1 ${currentCurrency} = ${gbpRate.toFixed(4)} GBP`;
}

function updateRateDisplay() {
    const isBOCCurrency = BOC_CURRENCIES.includes(currentCurrency);

    if (currentCurrency === 'CNY') {
        elements.rate1.textContent = '1.06';
        elements.rate2.textContent = '1.06';
        elements.rate3.textContent = '1.05';
    } else if (!isBOCCurrency) {
        elements.rate1.textContent = '1.07';
        elements.rate2.textContent = '1.07';
        elements.rate3.textContent = '1.06';
    } else {
        elements.rate1.textContent = '1.06';
        elements.rate2.textContent = '1.06';
        elements.rate3.textContent = '1.05';
    }
}

function calculate() {
    const amount = parseFloat(elements.amount.value) || 0;

    if (amount <= 0) {
        elements.baseResult.textContent = formatCurrency(0);
        elements.result1.textContent = formatCurrency(0);
        elements.result2.textContent = formatCurrency(0);
        elements.result3.textContent = formatCurrency(0);
        elements.diff1.textContent = formatCurrency(0);
        elements.diff2.textContent = formatCurrency(0);
        elements.diff3.textContent = formatCurrency(0);
        elements.profit1.textContent = '综合利润 ¥ 0.00';
        elements.profit2.textContent = '综合利润 ¥ 0.00';
        elements.profit3.textContent = '综合利润 ¥ 0.00';
        elements.gbpResult.textContent = '£ 0.00';
        elements.resultItems.forEach(item => item.classList.remove('highlighted'));
        return;
    }

    if (currentRate === null || currentRate === undefined) {
        return;
    }

    const rate = typeof currentRate === 'object' ? currentRate.rate : currentRate;
    console.log('🧮 计算中 - amount:', amount, 'currentRate:', currentRate, 'rate:', rate);
    const baseAmount = amount * rate;

    const isBOCCurrency = BOC_CURRENCIES.includes(currentCurrency);
    let multiplier1, multiplier2, multiplier3;

    if (currentCurrency === 'CNY') {
        multiplier1 = 1.06;
        multiplier2 = 1.06;
        multiplier3 = 1.05;
    } else if (!isBOCCurrency) {
        multiplier1 = 1.07;
        multiplier2 = 1.07;
        multiplier3 = 1.06;
    } else {
        multiplier1 = 1.06;
        multiplier2 = 1.06;
        multiplier3 = 1.05;
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

    if (currentCurrency !== 'CNY' && currentRate) {
        const rate = typeof currentRate === 'object' ? currentRate.rate : currentRate;
        elements.rateInfo.textContent = `1 ${currentCurrency} = ${rate.toFixed(4)} CNY`;
    } else {
        elements.rateInfo.textContent = '';
    }

    updateGBPDisplay(amount, currentGBPRate);
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

async function updateExchangeRate() {
    const currency = elements.currency.value;
    currentCurrency = currency;

    if (currency === 'CNY') {
        currentRate = { rate: 1, source: 'CNY' };
        showLoading(true);
        try {
            currentGBPRate = await fetchGBPRate(currency);
            showNotice('当前选择人民币，无需汇率转换，直接按规则计算', 'info');
        } catch (error) {
            console.error('获取GBP汇率失败:', error);
            currentGBPRate = null;
            showNotice('人民币转英镑汇率获取失败', 'error');
        }
        showLoading(false);
        updateRateDisplay();
        calculate();
        elements.updateTime.textContent = `更新时间: ${new Date().toLocaleString('zh-CN')}`;
        return;
    }

    const isBOCCurrency = BOC_CURRENCIES.includes(currency);

    showLoading(true);

    try {
        const [result, gbpRate] = await Promise.all([
            fetchExchangeRate(currency),
            fetchGBPRate(currency)
        ]);

        console.log('💰 获取到的汇率结果:', result);
        console.log('💷 获取到的GBP汇率:', gbpRate);

        currentRate = result;
        currentGBPRate = gbpRate;
        updateRateDisplay();
        calculate();

        elements.updateTime.textContent = `更新时间: ${new Date().toLocaleString('zh-CN')}`;

        console.log('📊 result.source:', result.source, 'result.bocFailed:', result.bocFailed, 'isBOCCurrency:', isBOCCurrency);

        if (result.source === 'BOC') {
            showNotice('✅ 使用中国银行购汇汇率计算', 'info');
        } else if (result.bocFailed) {
            showNotice('⚠️ 中国银行汇率获取失败，已切换至备用数据源（市场中间价），倍率上调1%', 'warning');
        } else if (!isBOCCurrency) {
            showNotice('该币种不在中国银行购汇服务范围内，使用市场中间价计算，倍率上调1%', 'warning');
        }
    } catch (error) {
        console.error('❌ 汇率更新失败:', error);
        showNotice('❌ 汇率获取失败，请检查网络连接后重试', 'warning');
        currentRate = null;
    } finally {
        showLoading(false);
    }
}

elements.currency.addEventListener('change', updateExchangeRate);
elements.amount.addEventListener('input', calculate);

updateExchangeRate();
