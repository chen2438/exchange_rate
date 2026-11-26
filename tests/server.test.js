const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const axios = require('axios');

async function server(t, html, onRequest) {
    const oldGet = axios.get;
    const oldEnv = process.env.NODE_ENV;
    axios.get = typeof html === 'function' ? html : async () => ({ data: html });
    process.env.NODE_ENV = 'production';
    delete require.cache[require.resolve('../server')];
    const app = require('../server');
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    const listener = app.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    if (onRequest) listener.prependListener('request', onRequest);
    t.after(async () => {
        axios.get = oldGet;
        await new Promise(resolve => listener.close(resolve));
    });
    return currency => fetch(`http://127.0.0.1:${listener.address().port}/api/boc-rate/${currency}`);
}
const row = (name, remittance, cash, date = '', time = '') => `<tr><td>${name}</td><td></td><td></td>` +
    `<td>${remittance}</td><td>${cash}</td><td>700</td><td>${date}</td><td>${time}</td></tr>`;

test('SAR route returns per-unit remittance price, type and cached result', async t => {
    const get = await server(t, `<table>${row('沙特里亚尔', '200', '210', '2026/11/26 16:41:29', '16:41:29')}</table>`);
    const first = await get('SAR');
    assert.equal(first.status, 200);
    const data = await first.json();
    assert.equal(data.currency, 'SAR');
    assert.equal(data.rate, 2);
    assert.equal(data.rateType, 'remittance');
    assert.equal(data.cached, false);
    assert.equal(data.publishedAt, '2026/11/26 16:41:29');
    const cached = await (await get('SAR')).json();
    assert.equal(cached.cached, true);
    assert.equal(cached.publishedAt, data.publishedAt);
    assert.equal((await get('AER')).status, 404);
});

test('concurrent currencies share a refresh; expired quotes are never returned after failure', async t => {
    let release;
    const upstream = new Promise(resolve => { release = resolve; });
    let bothArrived;
    const requestsArrived = new Promise(resolve => { bothArrived = resolve; });
    let requests = 0;
    let fetches = 0;
    const html = `<table>${row('美元', '700', '710')}${row('欧元', '800', '810')}</table>`;
    const get = await server(t, async () => {
        fetches++;
        if (fetches === 1) await upstream;
        if (fetches === 2) throw new Error('BOC offline');
        return { data: html };
    }, () => {
        if (++requests === 2) bothArrived();
    });

    const pending = [get('USD'), get('EUR')];
    await requestsArrived;
    release();
    const [usd, eur] = await Promise.all(pending.map(async response => (await response).json()));
    assert.deepEqual([usd.rate, eur.rate], [7, 8]);
    assert.deepEqual([usd.cached, eur.cached], [false, false]);
    assert.equal(fetches, 1);
    assert.equal((await (await get('USD')).json()).cached, true);

    const now = Date.now.bind(Date);
    t.mock.method(Date, 'now', () => now() + 5 * 60 * 1000);
    assert.equal((await get('USD')).status, 500);
    const recovered = await (await get('EUR')).json();
    assert.equal(recovered.rate, 8);
    assert.equal(recovered.cached, false);
    assert.equal(fetches, 3);
});

test('unsupported currency skips the upstream and a malformed snapshot can be retried', async t => {
    let fetches = 0;
    const get = await server(t, async () => ({
        data: ++fetches === 1 ? '<html>unavailable</html>' : `<table>${row('美元', '700', '710')}</table>`
    }));
    assert.equal((await get('AER')).status, 404);
    assert.equal(fetches, 0);
    assert.equal((await get('USD')).status, 404);
    assert.equal((await (await get('USD')).json()).cached, false);
    assert.equal(fetches, 2);
});

test('invalid or absent remittance falls back to a valid cash price', async t => {
    const invalid = ['', '0', '-100', 'Infinity', 'NaN', '700junk', '1e309'];
    const codes = ['USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD'];
    const names = ['美元', '欧元', '英镑', '日元', '港币', '澳大利亚元', '加拿大元'];
    const get = await server(t, `<table>${invalid.map((value, i) => row(names[i], value, '710')).join('')}</table>`);
    for (const currency of codes) {
        const res = await get(currency);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.rate, 7.1);
        assert.equal(data.rateType, 'cash');
    }
});

test('no valid price returns a controlled error, not zero or non-finite JSON', async t => {
    const get = await server(t, `<table>${row('美元', 'Infinity', '-1')}</table>`);
    const res = await get('USD');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: '该币种暂无可用汇率' });
});

test('cash quotes expose separate date and time cells, with null for missing time', async t => {
    const get = await server(t, `<table>${row('新台币', '', '21', '2026/11/26', '16:41:29')}
        ${row('美元', '700', '710', '2026/11/26')}</table>`);
    const cash = await (await get('TWD')).json();
    assert.equal(cash.publishedAt, '2026/11/26 16:41:29');
    assert.equal(cash.rateType, 'cash');
    assert.equal((await (await get('USD')).json()).publishedAt, null);
});

test('upstream timeout is bounded and returns a 504 response', async t => {
    const get = await server(t, async (url, options) => {
        assert.equal(options.timeout, 5000);
        assert.equal(options.signal.aborted, false);
        throw Object.assign(new Error('upstream timed out'), { code: 'ECONNABORTED' });
    });
    const res = await get('USD');
    assert.equal(res.status, 504);
    assert.deepEqual(await res.json(), { error: '中国银行牌价请求超时' });
});

test('DOM -> HTTP API -> BOC HTML -> quote -> clipboard completes end to end', async t => {
    const { JSDOM } = require('jsdom');
    const fs = require('node:fs');
    const path = require('node:path');
    const get = await server(t, `<table>${row('美元', '700', '710')}</table>`);
    const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'), {
        url: 'https://example.test', runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const w = dom.window;
    w.console = { log() {}, error() {} };
    w.fetch = async url => url.includes('/api/') ? get(url.split('/').pop()) : {
        ok: true, json: async () => ({ result: 'success', rates: { GBP: 0.8 } })
    };
    const copied = [];
    w.navigator.clipboard = { writeText: async text => copied.push(text) };
    const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    w.eval(source.replace(/\nupdateExchangeRate\(\);\s*$/, '\nwindow.ready = updateExchangeRate();') +
        '\nwindow.copyQuote = copyResult;');
    await w.ready;
    const amount = w.document.getElementById('amount');
    amount.value = '50';
    amount.dispatchEvent(new w.Event('input'));
    assert.equal(w.document.getElementById('result2').textContent.replace(/[^0-9.]/g, ''), '371.00');
    assert.match(w.document.getElementById('rateInfo').textContent, /现汇卖出价/);
    await w.copyQuote();
    assert.deepEqual(copied, ['50 美元 共收 371.00 人民币']);
});
