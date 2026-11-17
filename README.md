# 外币兑换计算器

基于中国银行外汇牌价的人民币换算与收款报价工具，支持三档报价、差额和综合利润展示、英镑换算及一键复制。

## 项目文档

[查看完整项目文档](docs/PROJECT.md)：包含架构、文件说明、汇率来源、计算规则、币种扩展、API、本地运行、Vercel 部署、已知问题和排障说明。

## 快速启动

建议使用 Node.js 24.x 和 npm。

```bash
npm ci
npm start
```

访问 http://localhost:3000 。本地运行时不要将 NODE_ENV 设为 production；该值会使应用只导出 Express 实例而不监听端口。

## 在线访问

- [currency.vayki.com](https://currency.vayki.com)
- [exchange-rate-lime.vercel.app](https://exchange-rate-lime.vercel.app)

## TODO

- [x] 优化显示，使其便于复制
- [x] 增加汇率缓存
- [ ] 汇率定时请求
