const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const response = (data, ok = true) => ({ ok, json: async () => data });
const market = (currency = 'USD') => response({
    result: 'success', base_code: currency, rates: { CNY: 7, GBP: 0.8 }
});
const boc = (currency = 'USD', rate = 7, rateType = 'remittance') =>
    response({ currency, rate, rateType });
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
function setup(t, fetcher = async url => url.includes('/api/boc-rate/')
    ? boc(url.split('/').pop()) : market(url.split('/').pop())) {
    const dom = new JSDOM(html, { url: 'https://example.test', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const w = dom.window;
    w.console = { log() {}, error() {} };
    w.fetch = fetcher;
    const copied = [];
    w.navigator.clipboard = { writeText: async text => copied.push(text) };
    w.eval(fs.readFileSync(path.join(root, 'public/currencies.js'), 'utf8') + '\n' + source.replace(/\nupdateExchangeRate\(\);\s*$/, '\nwindow.initialUpdate = updateExchangeRate();') +
        '\nwindow.api = { calculate, copyResult, updateExchangeRate, fetchMarketRate, fetchBOCRate, isValidRate };');
    const el = id => w.document.getElementById(id);
    const amount = value => {
        el('amount').value = String(value);
        el('amount').dispatchEvent(new w.Event('input'));
    };
    const select = currency => { el('currency').value = currency; return w.api.updateExchangeRate(); };
    const value = id => Number(el(id).textContent.replace(/[^0-9.-]/g, ''));
    const highlighted = () => [...w.document.querySelectorAll('.results-section .highlighted')]
        .map(x => x.querySelector('.result-value').id);
    return { w, el, amount, select, value, highlighted, copied };
}

test('BOC quote boundaries, displayed multipliers and copied quote agree', async t => {
    const ui = setup(t, async url => url.includes('/api/') ? boc('USD', 1) : market());
    await ui.w.initialUpdate;
    assert.equal(ui.el('copyBtn').disabled, true);
    for (const [amount, expected, resultId] of [
        [99, 109.94, 'result1'], [99.99, 110.99, 'result1'], [100, 106, 'result2'],
        [999, 1058.94, 'result2'], [999.99, 1059.99, 'result2'], [1000, 1050, 'result3']
    ]) {
        ui.amount(amount);
        assert.deepEqual(ui.highlighted(), [resultId]);
        assert.equal(ui.value(resultId), expected);
        await ui.w.api.copyResult();
        assert.match(ui.copied.at(-1), new RegExp(expected.toFixed(2).replace('.', '\\.')));
    }
    assert.equal(ui.el('rate1').textContent, '1.06');
    assert.match(ui.el('rateInfo').textContent, /现汇卖出价/);
});

test('the displayed cent-rounded base selects the quote tier and copied amount', async t => {
    const ui = setup(t, async url => url.includes('/api/') ? boc('USD', 1) : market());
    await ui.w.initialUpdate;
    for (const [amount, displayedBase, result, expected] of [
        [99.994, 99.99, 'result1', 110.99],
        [99.995, 100, 'result2', 106],
        [999.994, 999.99, 'result2', 1059.99],
        [999.995, 1000, 'result3', 1050]
    ]) {
        ui.amount(amount);
        assert.equal(ui.value('baseResult'), displayedBase);
        assert.deepEqual(ui.highlighted(), [result]);
        assert.equal(ui.value(result), expected);
        await ui.w.api.copyResult();
        assert.ok(ui.copied.at(-1).includes(`共收 ${expected.toFixed(2)} 人民币`));
    }
    ui.amount(0.004);
    assert.equal(ui.value('baseResult'), 0);
    assert.deepEqual(ui.highlighted(), []);
    assert.equal(ui.el('copyBtn').disabled, true);
});

test('a cached quote cannot be copied past its remaining lifetime and refresh preserves input', async t => {
    let rate = 7;
    let validForMs = 20000;
    const ui = setup(t, async (url, options) => {
        if (!url.includes('/api/')) return market();
        assert.equal(options.cache, 'no-store');
        return response({ currency: 'USD', rate, rateType: 'cash', validForMs, cached: true,
            publishedAt: '2026/11/26 16:41:29' });
    });
    const start = Date.now();
    let now = start;
    ui.w.Date.now = () => now;
    await ui.w.initialUpdate;
    ui.amount(20);
    assert.equal(ui.el('copyBtn').disabled, false);
    assert.match(ui.el('checkedTime').textContent, /本页取价时间/);
    assert.match(ui.el('updateTime').textContent, /中行牌价发布时间.*缓存报价/);

    now += 20000;
    await ui.w.api.copyResult();
    assert.equal(ui.copied.length, 0);
    assert.equal(ui.el('copyBtn').disabled, true);
    assert.equal(ui.el('baseResult').textContent, '—');
    assert.match(ui.w.document.querySelector('.notice-content').textContent, /报价已过期/);

    rate = 8;
    validForMs = 300000;
    ui.el('refreshBtn').click();
    await new Promise(setImmediate);
    assert.equal(ui.el('currency').value, 'USD');
    assert.equal(ui.el('amount').value, '20');
    assert.equal(ui.value('result2'), 169.6);
    assert.equal(ui.el('copyBtn').disabled, false);

    now += 300000;
    ui.w.dispatchEvent(new ui.w.Event('pageshow'));
    assert.equal(ui.el('copyBtn').disabled, true);
});

test('fixed CNY quotes do not age while market fallback quotes expire', async t => {
    const ui = setup(t, async url => url.includes('/api/') ? response({}, false) : market(url.split('/').pop()));
    let now = Date.now();
    ui.w.Date.now = () => now;
    await ui.w.initialUpdate;
    ui.amount(20);
    now += 300000;
    await ui.w.api.copyResult();
    assert.deepEqual(ui.copied, []);
    assert.equal(ui.el('copyBtn').disabled, true);
    await ui.select('CNY');
    now += 300000;
    await ui.w.api.copyResult();
    assert.equal(ui.copied.length, 1);
    assert.equal(ui.el('copyBtn').disabled, false);
});

test('BOC fallback applies higher multipliers at every tier and labels the source', async t => {
    const ui = setup(t, async url => url.includes('/api/')
        ? response({}, false) : response({ result: 'success', rates: { CNY: 1, GBP: 0.8 } }));
    await ui.w.initialUpdate;
    assert.match(ui.w.document.querySelector('.notice-content').textContent, /提高 0.01/);
    for (const [amount, expected, id] of [[99, 110.93, 'result1'], [100, 107, 'result2'], [1000, 1060, 'result3']]) {
        ui.amount(amount);
        assert.equal(ui.value(id), expected);
        await ui.w.api.copyResult();
        assert.ok(ui.copied.at(-1).includes(expected.toFixed(2)));
    }
    assert.equal(ui.el('rate1').textContent, '1.07');
    assert.equal(ui.el('rate3').textContent, '1.06');
    assert.match(ui.el('rateInfo').textContent, /市场汇率/);
});

test('CNY and GBP share market responses and validate each target independently', async t => {
    const calls = [];
    const ui = setup(t, async url => {
        calls.push(url);
        if (url.includes('/api/')) return response({}, false);
        if (url.includes('api.exchangerate-api.com')) {
            return response({ base: 'USD', rates: { GBP: 0.8 } });
        }
        return response({ result: 'success', base_code: 'USD', rates: { CNY: 7 } });
    });
    await ui.w.initialUpdate;
    ui.amount(50);
    assert.equal(ui.value('baseResult'), 350);
    assert.equal(ui.value('gbpResult'), 40);
    assert.equal(calls.filter(url => url.includes('api.exchangerate-api.com')).length, 1);
    assert.equal(calls.filter(url => url.includes('open.er-api.com')).length, 1);

    const sharedBackup = [];
    ui.w.fetch = async url => {
        sharedBackup.push(url);
        return url.includes('open.er-api.com') ? market() : response({}, false);
    };
    await ui.select('USD');
    assert.equal(sharedBackup.filter(url => url.includes('api.exchangerate-api.com')).length, 1);
    assert.equal(sharedBackup.filter(url => url.includes('open.er-api.com')).length, 1);
    assert.equal(ui.value('baseResult'), 350);
    assert.equal(ui.value('gbpResult'), 40);
});

test('a newly listed cash currency displays nonzero small unit rates', async t => {
    const ui = setup(t, async url => {
        const code = url.split('/').pop();
        return url.includes('/api/')
            ? boc(code, code === 'VND' ? 0.000271 : 7, 'cash')
            : response({ base: code, rates: { GBP: 0.000027 } });
    });
    await ui.w.initialUpdate;
    assert.equal(ui.el('currency').options.length, 46);
    await ui.select('VND');
    ui.amount(1000000);
    assert.equal(ui.value('baseResult'), 271);
    assert.equal(ui.value('gbpResult'), 27);
    assert.match(ui.el('rateInfo').textContent, /现钞卖出价.*0\.000271/);
    assert.match(ui.el('gbpRateInfo').textContent, /0\.000027/);
});

test('SAR uses the standard code for BOC and GBP; cash prices remain explicit', async t => {
    const calls = [];
    const ui = setup(t, async url => {
        calls.push(url);
        const currency = url.split('/').pop();
        return url.includes('/api/') ? boc(currency, 2, 'cash') : market(currency);
    });
    await ui.w.initialUpdate;
    calls.length = 0;
    await ui.select('SAR');
    ui.amount(10);
    assert.ok(calls.some(url => url.endsWith('/api/boc-rate/SAR')));
    assert.ok(calls.some(url => url.endsWith('/latest/SAR')));
    assert.equal(ui.w.document.querySelector('option[value="AER"]'), null);
    assert.match(ui.el('rateInfo').textContent, /现钞卖出价/);
    assert.match(ui.w.document.querySelector('.notice-content').textContent, /现钞卖出价/);
    await ui.w.api.copyResult();
    assert.match(ui.copied[0], /沙特里亚尔/);
});

test('loading and terminal failures clear all old results and block copying', async t => {
    const ui = setup(t);
    await ui.w.initialUpdate;
    ui.amount(50);
    assert.equal(ui.value('result2'), 371);
    const pending = deferred();
    ui.w.fetch = () => pending.promise;
    const update = ui.select('EUR');
    assert.equal(ui.el('baseResult').textContent, '—');
    assert.equal(ui.el('gbpRateInfo').textContent, '');
    assert.equal(ui.el('gbpSuggestion').textContent, '');
    assert.equal(ui.el('copyBtn').disabled, true);
    assert.deepEqual(ui.highlighted(), []);
    await ui.w.api.copyResult();
    assert.equal(ui.copied.length, 0);
    pending.reject(new Error('offline'));
    await update;
    ui.amount(10);
    await ui.w.api.copyResult();
    assert.equal(ui.el('baseResult').textContent, '—');
    assert.equal(ui.el('updateTime').textContent, '');
    assert.equal(ui.el('copyBtn').disabled, true);
    assert.equal(ui.copied.length, 0);
});

test('retry reloads the selected currency and keeps the entered amount', async t => {
    let offline = true;
    const ui = setup(t, async url => {
        if (offline) return response({}, false);
        const currency = url.split('/').pop();
        return url.includes('/api/') ? boc(currency, 8) : market(currency);
    });
    await ui.w.initialUpdate;
    ui.amount(50);
    await ui.select('EUR');
    assert.equal(ui.el('retryBtn').hidden, false);
    assert.equal(ui.el('copyBtn').disabled, true);

    offline = false;
    ui.el('retryBtn').click();
    await new Promise(setImmediate);
    assert.equal(ui.el('retryBtn').hidden, true);
    assert.equal(ui.el('currency').value, 'EUR');
    assert.equal(ui.el('amount').value, '50');
    assert.equal(ui.value('result2'), 424);
    assert.equal(ui.el('copyBtn').disabled, false);
});

test('late success cannot overwrite a newer currency, including its GBP result', async t => {
    const old = deferred();
    const ui = setup(t, async url => {
        const currency = url.split('/').pop();
        if (url.includes('/api/')) return currency === 'USD' ? old.promise : boc(currency, 8);
        return market(currency);
    });
    await ui.select('EUR');
    ui.amount(50);
    assert.equal(ui.value('baseResult'), 400);
    old.resolve(boc('USD', 99));
    await ui.w.initialUpdate;
    assert.equal(ui.value('baseResult'), 400);
    assert.match(ui.el('rateInfo').textContent, /EUR/);
    assert.match(ui.el('gbpRateInfo').textContent, /EUR/);
    assert.equal(ui.el('loading').classList.contains('show'), false);
});

test('late failure cannot clear a newer quote', async t => {
    const old = deferred();
    const ui = setup(t, async url => {
        const currency = url.split('/').pop();
        if (currency === 'USD') return url.includes('/api/') ? old.promise : response({}, false);
        return url.includes('/api/') ? boc(currency, 8) : market(currency);
    });
    await ui.select('EUR');
    ui.amount(50);
    old.reject(new Error('old request failed'));
    await ui.w.initialUpdate;
    assert.equal(ui.value('baseResult'), 400);
    assert.equal(ui.el('copyBtn').disabled, false);
    assert.match(ui.w.document.querySelector('.notice-content').textContent, /现汇卖出价/);
});

test('a pending GBP request does not block CNY quotes or copying', async t => {
    const latest = deferred();
    const ui = setup(t, async url => {
        const currency = url.split('/').pop();
        if (url.includes('/api/')) return boc(currency);
        return currency === 'CNY' ? latest.promise : market(currency);
    });
    await ui.w.initialUpdate;
    ui.amount(100);
    const next = ui.select('CNY');
    await new Promise(setImmediate);
    assert.equal(ui.el('loading').classList.contains('show'), false);
    assert.match(ui.el('gbpResult').textContent, /正在获取/);
    assert.equal(ui.el('copyBtn').disabled, false);
    await ui.w.api.copyResult();
    assert.deepEqual(ui.copied, ['100 CNY 共收 106.00 人民币']);
    latest.resolve(market('CNY'));
    await next;
    assert.equal(ui.el('gbpResult').textContent, '£80.00');
});

test('GBP can render while CNY is pending and late GBP cannot overwrite it', async t => {
    const staleGBP = deferred();
    const latestBOC = deferred();
    const ui = setup(t, async url => {
        const currency = url.split('/').pop();
        if (currency === 'USD') return url.includes('/api/') ? boc() : staleGBP.promise;
        return url.includes('/api/') ? latestBOC.promise : market(currency);
    });
    ui.amount(50);
    const next = ui.select('EUR');
    await new Promise(setImmediate);
    assert.equal(ui.el('loading').classList.contains('show'), true);
    assert.equal(ui.el('copyBtn').disabled, true);
    assert.equal(ui.el('gbpResult').textContent, '£40.00');
    staleGBP.resolve(response({ rates: { GBP: 1.2 } }));
    await ui.w.initialUpdate;
    assert.match(ui.el('gbpRateInfo').textContent, /EUR/);
    assert.equal(ui.el('gbpResult').textContent, '£40.00');
    latestBOC.resolve(boc('EUR', 8));
    await next;
    assert.equal(ui.value('baseResult'), 400);
});

test('timing out a stalled response body aborts it and tries the backup', async t => {
    const ui = setup(t);
    await ui.w.initialUpdate;
    const realSetTimeout = ui.w.setTimeout.bind(ui.w);
    ui.w.setTimeout = callback => realSetTimeout(callback, 0);
    let signal;
    ui.w.fetch = async (url, options) => {
        if (url.includes('open.er-api.com')) return market();
        signal = options.signal;
        return {
            ok: true,
            json: () => new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            })
        };
    };
    assert.equal(await ui.w.api.fetchMarketRate('USD', 'CNY'), 7);
    assert.equal(signal.aborted, true);
});

test('BOC metadata uses the source timestamp and cache flag', async t => {
    const ui = setup(t, async url => url.includes('/api/') ? response({
        currency: 'USD', rate: 7, rateType: 'remittance',
        publishedAt: '2026/11/26 16:41:29', cached: true
    }) : market());
    await ui.w.initialUpdate;
    assert.equal(ui.el('updateTime').textContent,
        '中行牌价发布时间：2026/11/26 16:41:29（北京时间） · 缓存报价');
    ui.w.fetch = async url => url.includes('/api/') ? boc() : market();
    await ui.select('USD');
    assert.equal(ui.el('updateTime').textContent, '中行牌价发布时间：未提供');
});

test('invalid primary market responses invoke a valid backup', async t => {
    const ui = setup(t);
    await ui.w.initialUpdate;
    const invalid = [
        response({}, false), { ok: true, json: async () => { throw new Error('bad JSON'); } },
        response(null), response({ rates: {} }), response({ rates: { CNY: 0 } }),
        response({ rates: { CNY: -1 } }), response({ rates: { CNY: '7' } }),
        response({ rates: { CNY: Infinity } }), response({ rates: { CNY: NaN } }),
        response({ result: 'error', rates: { CNY: 7 } }),
        response({ base: 'EUR', rates: { CNY: 7 } })
    ];
    for (const first of invalid) {
        let calls = 0;
        ui.w.fetch = async () => ++calls === 1 ? first : market();
        assert.equal(await ui.w.api.fetchMarketRate('USD', 'CNY'), 7);
        assert.equal(calls, 2);
    }
});

test('invalid backup responses fail closed even if rates are present', async t => {
    const ui = setup(t);
    await ui.w.initialUpdate;
    const invalid = [
        response({ result: 'success', rates: { CNY: 7 } }, false),
        response({ result: 'error', rates: { CNY: 7 } }),
        response({ rates: { CNY: 7 } }),
        response({ result: 'success', base_code: 'EUR', rates: { CNY: 7 } }),
        response({ result: 'success', rates: { CNY: 0 } }),
        response({ result: 'success', rates: { CNY: '7' } }),
        response({ result: 'success', rates: { CNY: Infinity } })
    ];
    for (const last of invalid) {
        let calls = 0;
        ui.w.fetch = async () => ++calls === 1 ? response({}, false) : last;
        await assert.rejects(() => ui.w.api.fetchMarketRate('USD', 'CNY'));
        assert.equal(calls, 2);
    }
});

test('invalid BOC price, currency or rate type triggers market fallback', async t => {
    const ui = setup(t);
    await ui.w.initialUpdate;
    for (const data of [null, { currency: 'USD', rate: 0, rateType: 'cash' },
        { currency: 'USD', rate: '7', rateType: 'cash' },
        { currency: 'USD', rate: Infinity, rateType: 'cash' },
        { currency: 'EUR', rate: 7, rateType: 'cash' },
        { currency: 'USD', rate: 7, rateType: 'unknown' }]) {
        ui.w.fetch = async url => url.includes('/api/') ? response(data) : market();
        await ui.select('USD');
        ui.amount(100);
        assert.equal(ui.el('rate1').textContent, '1.07');
        assert.equal(ui.value('result2'), 749);
    }
});

test('unavailable GBP does not block a valid CNY quote or masquerade as zero', async t => {
    const ui = setup(t, async url => url.includes('/api/') ? boc() : response({}, false));
    await ui.w.initialUpdate;
    ui.amount(50);
    assert.equal(ui.value('result2'), 371);
    assert.equal(ui.el('copyBtn').disabled, false);
    assert.equal(ui.el('gbpResult').textContent, '暂不可用');
});

test('clearing input resets all GBP content and disables copy', async t => {
    const ui = setup(t);
    await ui.w.initialUpdate;
    ui.amount(50);
    assert.notEqual(ui.el('gbpRateInfo').textContent, '');
    ui.amount('');
    assert.equal(ui.el('gbpRateInfo').textContent, '');
    assert.equal(ui.el('gbpSuggestion').textContent, '建议数额 £ 0.00');
    assert.equal(ui.el('copyBtn').disabled, true);
    assert.deepEqual(ui.highlighted(), []);
});

test('copy recomputes current input and tolerates missing clipboard support', async t => {
    const ui = setup(t);
    await ui.w.initialUpdate;
    ui.amount(50);
    ui.el('amount').value = '1000';
    await ui.w.api.copyResult();
    assert.match(ui.copied[0], /7350.00/);
    ui.w.navigator.clipboard = undefined;
    await ui.w.api.copyResult();
    assert.match(ui.w.document.querySelector('.notice-content').textContent, /复制失败/);
});
