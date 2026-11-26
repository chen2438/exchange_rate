const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { JSDOM } = require('jsdom');

const app = express();

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

const CACHE_DURATION = 5 * 60 * 1000;
const supportedNames = new Set(Object.values(CURRENCY_NAME_MAP));
let rateCache = null;
let refreshInProgress = null;

function parseRates(html) {
    const dom = new JSDOM(html);
    try {
        const rates = new Map();
        for (const row of dom.window.document.querySelectorAll('table tr')) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) continue;

            const name = cells[0].textContent.trim();
            if (!supportedNames.has(name) || rates.has(name)) continue;

            const remittance = Number(cells[3].textContent.trim()) / 100;
            const cash = Number(cells[4].textContent.trim()) / 100;
            const hasRemittance = Number.isFinite(remittance) && remittance > 0;
            const rate = hasRemittance ? remittance : cash;
            if (!Number.isFinite(rate) || rate <= 0) {
                rates.set(name, null);
                continue;
            }

            const date = cells[6]?.textContent.trim() ?? '';
            const time = cells[7]?.textContent.trim() ?? '';
            const stamp = /^\d{4}[/-]\d{2}[/-]\d{2}$/.test(date) ? `${date} ${time}` : date;
            const publishedAt = /^\d{4}[/-]\d{2}[/-]\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp)
                ? stamp
                : null;
            rates.set(name, { rate, rateType: hasRemittance ? 'remittance' : 'cash', publishedAt });
        }
        return rates;
    } finally {
        dom.window.close();
    }
}

async function refreshRates() {
    log('🌐 正在刷新中行牌价');
    const response = await axios.get('https://www.boc.cn/sourcedb/whpj/', {
        signal: AbortSignal.timeout(5000),
        timeout: 5000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });
    const rates = parseRates(response.data);
    const snapshot = { rates, timestamp: Date.now() };
    if ([...rates.values()].some(Boolean)) rateCache = snapshot;
    return snapshot;
}

async function getRates() {
    if (rateCache && Date.now() - rateCache.timestamp < CACHE_DURATION) {
        return { snapshot: rateCache, cached: true };
    }
    if (!refreshInProgress) {
        refreshInProgress = refreshRates().finally(() => { refreshInProgress = null; });
    }
    return { snapshot: await refreshInProgress, cached: false };
}

const log = (message) => {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`[${timestamp}] ${message}`);
};

app.use(cors());

app.use((req, res, next) => {
    log(`${req.method} ${req.url}`);
    next();
});

app.get('/api/boc-rate/:currency', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { currency } = req.params;
    if (!Object.hasOwn(CURRENCY_NAME_MAP, currency)) {
        return res.status(404).json({ error: '不支持的币种' });
    }
    const currencyName = CURRENCY_NAME_MAP[currency];
    const startTime = Date.now();
    try {
        const { snapshot, cached } = await getRates();
        const quote = snapshot.rates.get(currencyName);
        if (quote === undefined) {
            return res.status(404).json({ error: '未找到该币种的汇率' });
        }
        if (quote === null) {
            return res.status(404).json({ error: '该币种暂无可用汇率' });
        }

        log(`✨ ${currency} ${quote.rateType} · ${cached ? '缓存' : '刷新'} · ${Date.now() - startTime}ms`);
        return res.json({
            ...quote,
            currency,
            currencyName,
            cached,
            validForMs: Math.max(0, CACHE_DURATION - (Date.now() - snapshot.timestamp)),
            cacheTime: new Date(snapshot.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ 获取汇率失败 (耗时: ${duration}ms):`, error.message);
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ERR_CANCELED') {
            return res.status(504).json({ error: '中国银行牌价请求超时' });
        }
        res.status(500).json({ error: '获取汇率失败' });
    }
});

// Serve static assets after the API so rate requests skip filesystem lookups.
app.use(express.static(__dirname));

if (process.env.NODE_ENV !== 'production') {
    const PORT = 3000;
    app.listen(PORT, () => {
        const separator = '='.repeat(60);
        const startupTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

        console.log(separator);
        console.log(`🚀 代理服务器运行在 http://localhost:${PORT}`);
        console.log(`📅 启动时间: ${startupTime}`);
        console.log(separator);

        log(`🚀 代理服务器启动 - http://localhost:${PORT}`);
    });
}

module.exports = app;
