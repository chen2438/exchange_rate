const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { JSDOM } = require('jsdom');

const app = express();

// 缓存配置
let rateCache = {
    data: null,
    timestamp: 0
};
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

const log = (message) => {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`[${timestamp}] ${message}`);
};

app.use(cors());

// 托管静态文件
app.use(express.static(__dirname));

app.use((req, res, next) => {
    log(`${req.method} ${req.url}`);
    next();
});

app.get('/api/boc-rate/:currency', async (req, res) => {
    const startTime = Date.now();
    try {
        const currency = req.params.currency;
        log(`📊 开始获取汇率 - 币种: ${currency}`);

        let htmlData;
        const now = Date.now();
        let isCache = false;
        let cacheTimestamp = 0;

        // 检查缓存
        if (rateCache.data && (now - rateCache.timestamp < CACHE_DURATION)) {
            log(`📦 使用缓存数据 (缓存时间: ${new Date(rateCache.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })})`);
            htmlData = rateCache.data;
            isCache = true;
            cacheTimestamp = rateCache.timestamp;
        } else {
            log(`🌐 缓存过期或不存在，正在从源站获取数据...`);
            const response = await axios.get('https://www.boc.cn/sourcedb/whpj/', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            log(`✅ 成功获取中国银行网页数据`);

            htmlData = response.data;
            rateCache = {
                data: htmlData,
                timestamp: Date.now()
            };
            isCache = false;
            cacheTimestamp = rateCache.timestamp;
        }

        const dom = new JSDOM(htmlData);
        const document = dom.window.document;
        const rows = document.querySelectorAll('table tr');

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

        const currencyName = CURRENCY_NAME_MAP[currency];

        if (!currencyName) {
            log(`❌ 不支持的币种: ${currency}`);
            return res.status(404).json({ error: '不支持的币种' });
        }

        log(`🔍 查找币种: ${currencyName} (${currency})`);

        for (let row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 6) {
                const name = cells[0].textContent.trim();
                if (name === currencyName) {
                    const sellRateText = cells[3].textContent.trim();
                    let sellRate = sellRateText === '' ? NaN : Number(sellRateText);

                    if (!Number.isFinite(sellRate) || sellRate <= 0) {
                        log(`⚠️  ${currencyName} 暂无现汇卖出价，尝试使用现钞卖出价`);
                        const cashSellRateText = cells[4].textContent.trim();
                        sellRate = cashSellRateText === '' ? NaN : Number(cashSellRateText);

                        if (!Number.isFinite(sellRate) || sellRate <= 0) {
                            log(`❌ ${currencyName} 现钞卖出价也无法获取`);
                            return res.status(404).json({ error: '该币种暂无可用汇率' });
                        }

                        const rate = sellRate / 100;
                        const duration = Date.now() - startTime;
                        log(`✨ 汇率获取成功（现钞卖出价）- ${currencyName}: ${rate.toFixed(4)} (耗时: ${duration}ms)`);
                        return res.json({
                            rate,
                            currency,
                            currencyName,
                            rateType: 'cash',
                            cached: isCache,
                            cacheTime: new Date(cacheTimestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                        });
                    }

                    const rate = sellRate / 100;
                    const duration = Date.now() - startTime;
                    log(`✨ 汇率获取成功（现汇卖出价）- ${currencyName}: ${rate.toFixed(4)} (耗时: ${duration}ms)`);
                    return res.json({
                        rate,
                        currency,
                        currencyName,
                        rateType: 'remittance',
                        cached: isCache,
                        cacheTime: new Date(cacheTimestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                    });
                }
            }
        }

        const duration = Date.now() - startTime;
        console.log(`❌ 未找到该币种的汇率: ${req.params.currency} (耗时: ${duration}ms)`);
        res.status(404).json({ error: '未找到该币种的汇率' });

    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ 获取汇率失败 (耗时: ${duration}ms):`, error.message);
        res.status(500).json({ error: '获取汇率失败' });
    }
});

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
