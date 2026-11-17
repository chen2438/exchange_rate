const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const axios = require('axios');

async function server(t, html) {
    const oldGet = axios.get;
    const oldEnv = process.env.NODE_ENV;
    axios.get = async () => ({ data: html });
    process.env.NODE_ENV = 'production';
    delete require.cache[require.resolve('../server')];
    const app = require('../server');
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    const listener = app.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    t.after(async () => {
        axios.get = oldGet;
        await new Promise(resolve => listener.close(resolve));
    });
    return currency => fetch(`http://127.0.0.1:${listener.address().port}/api/boc-rate/${currency}`);
}
const row = (name, remittance, cash) => `<tr><td>${name}</td><td></td><td></td>` +
    `<td>${remittance}</td><td>${cash}</td><td>700</td></tr>`;

test('SAR route returns per-unit remittance price, type and cached result', async t => {
    const get = await server(t, `<table>${row('沙特里亚尔', '200', '210')}</table>`);
    const first = await get('SAR');
    assert.equal(first.status, 200);
    const data = await first.json();
    assert.equal(data.currency, 'SAR');
    assert.equal(data.rate, 2);
    assert.equal(data.rateType, 'remittance');
    assert.equal(data.cached, false);
    assert.equal((await (await get('SAR')).json()).cached, true);
    assert.equal((await get('AER')).status, 404);
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
