# exchange_rate 项目文档

> 编写日期：2026-11-17（Asia/Singapore）。基于 main 分支提交 [e7f60e1](https://github.com/chen2438/exchange_rate/tree/e7f60e13a2255d7d8f267e07773702aa30074a3b) 扫描全部 10 个原有文件后编写。以下记录该提交的实现；已知问题不代表已经修复。

## 1. 项目介绍

这是一个外币兑换和收款报价计算器。用户选择币种、输入金额后，页面展示：

- 等值人民币及三档收款报价。
- 每档报价相对于基准金额的差额和综合利润。
- 等值英镑及建议英镑金额。
- 自动高亮的适用报价，并支持一键复制。

人民币换算优先使用中国银行外汇卖出价，失败后尝试第三方汇率。英镑换算独立使用第三方数据。

- 线上地址：[currency.vayki.com](https://currency.vayki.com)
- 默认域名：[exchange-rate-lime.vercel.app](https://exchange-rate-lime.vercel.app)
- 代码仓库：[chen2438/exchange_rate](https://github.com/chen2438/exchange_rate)
- Vercel 项目：[exchange-rate](https://vercel.com/chen2438s-projects/exchange-rate)

编写时已通过 Vercel 查询确认项目关联该仓库，最近生产部署状态为 READY，源提交与本文基准一致。这是平台元数据查询结果，不等于已完成线上页面或接口可用性测试。

## 2. 技术栈

| 部分 | 当前实现 |
| --- | --- |
| 前端 | 原生 HTML、CSS、JavaScript |
| 后端 | Node.js、Express，CommonJS 模块 |
| HTTP 请求 | 浏览器 Fetch、后端 Axios |
| HTML 解析 | JSDOM |
| 缓存 | 后端实例内存，5 分钟 |
| 部署 | Vercel 静态资源与 Node.js 函数 |
| 数据库 | 无 |
| 应用账户系统 | 无 |
| 前端构建 | 无打包器或构建步骤 |

项目 npm 包名为 exchange-rate-converter，版本为 1.0.0。应用自身无认证系统，Vercel 平台的部署访问保护单独配置。

## 3. 仓库结构

~~~text
exchange_rate/
├── .gitignore
├── .vercelignore
├── README.md
├── app.js
├── index.html
├── package-lock.json
├── package.json
├── server.js
├── style.css
├── vercel.json
└── docs/
    └── PROJECT.md
~~~

docs/PROJECT.md 是本次新增文档，不计入原有 10 个扫描文件。

| 文件 | 作用 |
| --- | --- |
| index.html | 币种选择、金额输入、报价卡片、GBP 结果、复制按钮和加载状态 |
| app.js | 请求汇率、处理回退、计算报价与利润、更新展示、复制结果 |
| server.js | Express 服务、抓取中行网页、解析价格、缓存和 API 响应 |
| style.css | 页面样式、档位高亮、状态颜色、加载动画和响应式布局 |
| package.json | 运行依赖、入口和启动命令 |
| package-lock.json | 锁定依赖版本；锁文件格式为版本 3 |
| vercel.json | Vercel 构建入口和请求路由 |
| .gitignore | 忽略 node_modules/、logs/、*.log、.DS_Store、.vercel |
| .vercelignore | 排除 logs/、node_modules/、.git/、.DS_Store、*.log |
| README.md | 项目入口；原内容为复制优化、缓存及定时请求 TODO |

基准提交没有测试目录、CI 工作流、数据库配置、Docker 配置、环境变量模板或许可证文件。扫描覆盖固定提交的完整文件树，不包含全部历史、其他分支或依赖包源码审计。

## 4. 系统流程

~~~mermaid
flowchart TD
    A[用户选择币种] --> B{是否为人民币}
    B -->|是| C[人民币汇率固定为 1]
    B -->|否| D[请求后端 BOC API]
    D --> E{实例缓存是否有效}
    E -->|是| F[使用缓存 HTML]
    E -->|否| G[抓取中行外汇牌价网页]
    G --> F
    F --> H[解析卖出价并除以 100]
    D -->|失败| I[浏览器请求第三方汇率]
    I -->|首选失败| J[请求备用接口]
    C --> K[计算人民币报价和利润]
    H --> K
    I --> K
    J --> K
    A --> L[独立获取 GBP 汇率]
    L --> M[计算等值英镑和建议金额]
    K --> N[高亮适用档位并支持复制]
~~~

后端只返回 BOC 单位汇率；报价、利润和档位判断均在浏览器完成。

页面加载和切换币种时请求汇率，输入金额时只重新计算。当前没有定时刷新或后台轮询。普通外币的人民币汇率和 GBP 汇率通过 Promise.all 并行查询。

app.js 另有“不在 BOC 列表内的币种直接使用第三方数据”的分支，但基准版本的页面外币选项全部在 BOC 列表内。

## 5. 汇率数据

### 5.1 中国银行数据

来源：[中国银行外汇牌价](https://www.boc.cn/sourcedb/whpj/)。

后端处理步骤：

1. 使用 Axios 获取中行网页，附带固定 User-Agent。
2. 使用 JSDOM 遍历 table tr。
3. 按中文币种名称完全匹配首个对应行。
4. 优先读取 cells[3]，即现汇卖出价。
5. 现汇卖出价无法解析时，读取 cells[4]，即现钞卖出价。
6. 将价格除以 100，转换为每单位外币对应的人民币价格。

代码不使用买入价或中行折算价，也不查询历史牌价。

卖出价适用于估算购入外币的人民币成本；如果业务目的是向银行出售外币，应另行明确是否改用买入价。中行网页报价单位为 100 外币兑人民币，实际交易价格及可兑换币种以银行渠道为准。

### 5.2 第三方数据

| 顺序 | 接口 |
| --- | --- |
| 首选 | https://api.exchangerate-api.com/v4/latest/{currency} |
| 备用 | https://open.er-api.com/v6/latest/{currency} |

前端读取响应中的 rates.CNY 和 rates.GBP。人民币回退和 GBP 查询分别执行，可能对同一币种产生重复请求。

这些请求直接从浏览器发出，依赖用户网络和第三方跨域支持。前端称其为“市场中间价”，源码未独立验证价格口径和数据新鲜度。应用中没有第三方 API Key 配置。

### 5.3 缓存与时间

缓存保存整份中行网页 HTML，有效期为 300000ms，即 5 分钟。

- 同一实例中的不同币种共享缓存。
- 缓存命中后仍会重新创建 JSDOM 并解析 HTML。
- 缓存过期后，在下一次请求到来时重新抓取。
- 冷启动或进程重启后缓存丢失。
- Vercel 不同函数实例之间不共享此缓存。
- 没有并发请求合并、旧缓存兜底、持久化缓存或定时预热。

接口中的 cacheTime 是网页抓取时间，并非中行汇率发布时间，按 Asia/Shanghai 格式化。页面“更新时间”是浏览器完成更新的本地时间。后端日志时间也使用 Asia/Shanghai。

## 6. 当前支持币种

页面包含人民币及 21 个配置为 BOC 的外币条目：

| 代码 | 币种 | 代码 | 币种 |
| --- | --- | --- | --- |
| CNY | 人民币 | USD | 美元 |
| EUR | 欧元 | GBP | 英镑 |
| JPY | 日元 | HKD | 港币 |
| AUD | 澳大利亚元 | CAD | 加拿大元 |
| SGD | 新加坡元 | CHF | 瑞士法郎 |
| NZD | 新西兰元 | KRW | 韩国元 |
| THB | 泰国铢 | MYR | 林吉特 |
| RUB | 卢布 | ZAR | 南非兰特 |
| SEK | 瑞典克朗 | DKK | 丹麦克朗 |
| NOK | 挪威克朗 | TWD | 新台币 |
| AED | 阿联酋迪拉姆 | AER | 沙特里亚尔，代码应修正为 SAR |

AER 是源码当前写法。BOC 后端通过中文名称映射可能仍能取价，但第三方接口使用该代码查询时可能失败。

### 新增币种

需要同步修改：

1. index.html 中的币种选项。
2. app.js 中的 BOC_CURRENCIES 和 CURRENCY_NAME_MAP。
3. server.js 中的 CURRENCY_NAME_MAP。

同时核对中行中文名称、可用价格类型、报价单位及第三方 GBP 汇率支持情况。建议后续集中维护币种配置，减少前后端不同步。

2026-11-17 核对中行页面时，可供后续扩展的未配置币种如下。报价类型为当日页面快照，可能变化；本次文档提交不添加这些币种。

| 当日价格情况 | 币种 |
| --- | --- |
| 有现汇卖出价，14 种 | 澳门元 MOP、菲律宾比索 PHP、印尼卢比 IDR、土耳其里拉 TRY、匈牙利福林 HUF、波兰兹罗提 PLN、墨西哥比索 MXN、卡塔尔里亚尔 QAR、哈萨克斯坦坚戈 KZT、蒙古图格里克 MNT、毛里求斯卢比 MUR、罗马尼亚列伊 RON、塞尔维亚第纳尔 RSD、赞比亚克瓦查 ZMW |
| 仅现钞卖出价，10 种 | 越南盾 VND、印度卢比 INR、文莱元 BND、巴西雷亚尔 BRL、捷克克朗 CZK、以色列谢克尔 ILS、柬埔寨瑞尔 KHR、科威特第纳尔 KWD、尼泊尔卢比 NPR、巴基斯坦卢比 PKR |

## 7. 报价计算规则

定义：

~~~text
A = 输入的外币金额
R = 每单位外币对应的人民币汇率
B = A × R，即人民币基准金额
~~~

人民币的 R 固定为 1。

### 7.1 三档报价

| 适用区间 | CNY 或 BOC 列表内币种 | 其他币种 |
| --- | --- | --- |
| 0 < B < 100 | B × 1.06 + 5 | B × 1.07 + 5 |
| 100 ≤ B < 1000 | B × 1.06 | B × 1.07 |
| B ≥ 1000 | B × 1.05 | B × 1.06 |

三档结果同时显示，适用档位自动高亮。判断使用未四舍五入的基准金额，展示保留两位小数。HTML 公式中的“原数额”实际指人民币基准金额 B，并非外币金额 A。

当前页面的外币全部在 BOC 列表内。“其他币种”逻辑主要供后续扩展使用。

**现有实现中，BOC 币种即使回退到第三方汇率，也仍使用 1.06／1.05 倍率。页面提示中的“倍率上调 1%”没有对应的计算行为。**

### 7.2 差额和综合利润

设某档报价为 Q：

~~~text
差额 = Q − B
综合利润 = Q × 0.988 − B
~~~

0.988 相当于从报价扣除 1.2% 后再计算利润。源码没有说明该扣减的业务来源，也没有提供配置入口，不能据此认定为某渠道实际费率。

例如，假设输入 50 美元，演示汇率为 7：

~~~text
基准金额：50 × 7 = 350.00 元
适用第二档：350 × 1.06 = 371.00 元
差额：21.00 元
综合利润：371 × 0.988 − 350 = 16.548 元
显示利润：16.55 元
~~~

以上汇率仅用于说明公式。

### 7.3 英镑建议金额

~~~text
等值英镑 = 输入金额 × GBP 汇率
~~~

- 输入币种为 GBP：汇率固定为 1，建议金额等于原金额。
- 其他币种，包括 CNY：建议金额为等值英镑乘以 1.01。

英镑查询全部失败时函数返回 null，GBP 区域显示 0，人民币计算仍可继续。英镑加成与人民币分档报价相互独立。

## 8. API 文档

### 获取 BOC 汇率

~~~http
GET /api/boc-rate/:currency
~~~

示例：

~~~bash
curl http://localhost:3000/api/boc-rate/USD
~~~

币种代码区分大小写。CNY 由前端特殊处理，不属于此接口支持的映射。

成功响应示例，价格和时间为演示值：

~~~json
{
  "rate": 7,
  "currency": "USD",
  "currencyName": "美元",
  "rateType": "remittance",
  "cached": false,
  "cacheTime": "2026/11/17 12:00:00"
}
~~~

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| rate | number | 已除以 100 的单位外币人民币价格 |
| currency | string | 请求币种代码 |
| currencyName | string | 中行中文币种名称 |
| rateType | string | remittance 为现汇卖出价，cash 为现钞卖出价 |
| cached | boolean | 是否使用有效的实例内缓存 |
| cacheTime | string | 网页抓取时间，按 Asia/Shanghai 格式化；字符串细节受运行环境影响 |

错误响应格式：

~~~json
{
  "error": "错误说明"
}
~~~

| HTTP 状态 | 错误说明 | 条件 |
| --- | --- | --- |
| 404 | 不支持的币种 | 币种不在映射内 |
| 404 | 该币种暂无可用汇率 | 匹配行的两种卖出价均无法解析 |
| 404 | 未找到该币种的汇率 | 没有中文名称匹配的表格行 |
| 500 | 获取汇率失败 | 抓取或解析等流程抛出异常 |

币种校验在网页抓取及解析初始化之后执行。因此，冷缓存下请求无效币种时，如果源站请求先失败，可能返回 500。

该 API 不执行第三方回退；回退由前端完成。应用使用默认 cors()，没有配置调用方限制、API 认证、限流或专门的健康检查接口。

## 9. 本地运行

建议采用与编写时 Vercel 项目一致的 Node.js 24.x。

仓库未声明 Node engines，但锁定的 JSDOM 要求 Node.js ≥18；这只是依赖最低要求。

~~~bash
git clone https://github.com/chen2438/exchange_rate.git
cd exchange_rate
npm ci
npm start
~~~

访问 http://localhost:3000 。

应通过服务器访问页面，直接打开 HTML 文件无法正常调用同源 BOC API。需要能够访问中行和第三方服务。

| 依赖 | 声明范围 | 锁定版本 |
| --- | --- | --- |
| Express | ^4.18.2 | 4.22.1 |
| CORS | ^2.8.5 | 2.8.5 |
| Axios | ^1.6.0 | 1.13.2 |
| JSDOM | ^23.0.0 | 23.2.0 |

推荐 npm ci 使用锁文件复现依赖。仓库只有 start 脚本，没有 dev、build、test、lint 或热更新配置。修改后端后需要重启进程，修改前端后刷新页面。

### 环境变量

代码只显式读取 NODE_ENV：

| 条件 | 行为 |
| --- | --- |
| 不等于 production | 监听固定端口 3000 |
| 等于 production | 仅导出 Express 应用，由托管平台调用 |

因此，直接运行 NODE_ENV=production npm start 不会启动独立 HTTP 监听。迁移到普通生产服务器时，需要调整监听与端口配置。

当前没有 API Key、数据库连接、可配置 PORT 或缓存时长环境变量。

## 10. Vercel 部署

现有 vercel.json 使用显式 builds 和 routes：

| 配置项 | 行为 |
| --- | --- |
| server.js | 使用 @vercel/node |
| index.html、app.js、style.css | 使用 @vercel/static |
| /api/(.*) | 转发到 /server.js |
| 指定静态扩展名请求 | 映射到同名资源路径 |
| / | 映射到 /index.html |

静态扩展名包括 html、css、js、png、jpg、jpeg、svg、ico、json；路径匹配并不保证对应文件一定存在于部署产物。

这是静态前端与 Node.js 函数组合的项目，没有 Next.js 或其他前端框架构建流程。域名、Node 版本及部署保护由 Vercel 平台维护。仓库没有 Cron 配置或 GitHub Actions 部署工作流。

后续发布变更时，应先检查预览部署的首页、API、数据源回退和剪贴板行为，再确认生产域名结果。

## 11. 页面交互和复制

页面默认选择 USD，输入金额为空。

- 非正数金额会将主要计算结果清零。
- 金额变化后自动计算，无需提交。
- 复制按钮优先提取高亮档位的报价。
- 没有高亮时使用第一档结果。

复制文本示例：

~~~text
50 美元 共收 371.00 人民币
~~~

CNY 未加入前端中文名称映射，因此人民币复制文本使用 CNY。

剪贴板功能使用 navigator.clipboard.writeText，通常需要 HTTPS 或 localhost，以及浏览器支持和权限。复制被拒绝会显示失败提示；API 本身不存在的情况未显式兼容。

页面容器最大宽度为 600px；样式在 640px 以下将输入区域改为单列，在 400px 以下将结果行改为纵向排列。这些是源码规则，本次未进行视觉验收。

## 12. 已知问题

以下为源码扫描发现，未在本次文档工作中修复。

| 问题 | 影响及建议 |
| --- | --- |
| 沙特代码写为 AER | 统一改为标准代码 SAR，同步三处币种配置 |
| 回退提示与倍率不一致 | 明确业务规则后，同步计算与提示 |
| 现汇／现钞类型未展示 | 前端 fetchBOCRate 丢弃后端 rateType，应保留并显示 |
| 请求失败可能保留旧报价 | 最终失败仅清空 currentRate，旧卡片和高亮可能保留；应清空结果并禁止复制过期报价 |
| 缺少请求竞态保护 | 没有请求取消或序号校验；旧响应可能覆盖新状态，加载遮罩不构成一致性保证 |
| 清零金额未完全重置 GBP 区域 | 旧建议金额和汇率文本可能保留 |
| 负利润缺少负号 | 使用绝对值显示，只给非负数添加加号；负差额也有相同模式 |
| 第三方响应校验不足 | 首选未验证目标字段；备用未检查 HTTP 状态、业务状态，可能产生 undefined 或 NaN |
| 请求未显式设置超时 | 源站缓慢时可能等待过久 |
| 缓存缺少并发合并和旧数据兜底 | 冷缓存并发可能重复抓取，刷新失败无法继续使用旧值 |
| 静态目录范围过宽 | express.static(__dirname) 在本地可提供同目录非隐藏文件；建议使用独立静态目录 |
| 业务参数分散硬编码 | 集中维护币种、倍率、扣减比例和缓存时长 |
| 缺少自动化测试 | 优先覆盖档位边界、价格解析、回退和失败后复制行为 |

静态文件暴露在 Vercel 上的实际范围取决于部署产物，本次未在线验证。

建议优先修正币种代码、报价提示一致性和过期结果复制，再完善价格类型、请求校验及稳定性。原 TODO 中的“定时请求”仍未实现，5 分钟缓存不等于自动更新。

## 13. 排障参考

| 现象 | 检查方向 |
| --- | --- |
| BOC 获取失败 | API 响应、后端日志、中行连通性和 HTML 结构 |
| 单个币种失败 | 代码大小写、中文映射、报价列是否为空 |
| 人民币正常但 GBP 为 0 | 浏览器第三方请求、跨域、rates.GBP 字段 |
| 沙特 GBP 查询失败 | 当前使用了 AER |
| 汇率没有自动更新 | 页面没有定时刷新，输入金额只重新计算 |
| 5 分钟内仍请求源站 | 是否处于不同函数实例或发生冷启动 |
| 本地无服务监听 | NODE_ENV 是否为 production、3000 端口是否占用 |
| 复制失败 | HTTPS／localhost、剪贴板 API 和浏览器权限 |
| 切换后出现旧结果 | 检查请求竞态和请求失败后保留的界面状态 |

后端日志输出请求、缓存命中、抓取结果和耗时；浏览器控制台输出请求及计算信息。项目没有实际写入日志文件的逻辑。

静态文件中间件在请求日志中间件之前，成功响应的静态文件请求不会进入后续请求日志。

## 14. 后续维护验收建议

以下清单供后续修改时使用，不代表本次全部执行：

- 检查基准金额为 99、100、999、1000 及临近舍入边界时的高亮、报价和复制。
- 验证 BOC 现汇成功、现钞回退、BOC 失败及第三方两路失败。
- 确认价格类型、提示和报价倍率一致。
- 检查空金额、0、负值、清空金额后的全部展示。
- 快速切换币种，确认最终代码、汇率和金额对应。
- 检查同实例缓存命中、过期刷新及冷启动。
- 确认失败后无法复制旧报价，HTTPS 下复制正常。
- 验证桌面和小屏幕的长币种名、金额及按钮展示。

## 15. 扫描与验证记录

| 检查 | 结果 |
| --- | --- |
| 完整递归文件树 | 基准提交 10 个文件，无截断 |
| 文件完整性 | 10 个文件的 Git blob SHA-1 与固定提交文件树一致 |
| 前端语法 | node --check app.js 通过 |
| 后端语法 | node --check server.js 通过 |
| 币种数量 | BOC 列表 21 项、HTML 22 项，差集为 CNY |
| 后端币种覆盖 | 前端全部 BOC 代码均有后端映射 |
| 配置 | 已解析依赖、锁文件和部署配置 |
| 运行验证 | 未安装依赖、启动服务或执行浏览器端到端测试 |
| 依赖安全 | 未运行漏洞审计，不据此声明依赖无漏洞 |

## 16. 源码索引

以下固定到扫描提交，便于后续对照：

- [前端业务逻辑 app.js](https://github.com/chen2438/exchange_rate/blob/e7f60e13a2255d7d8f267e07773702aa30074a3b/app.js)
- [后端接口 server.js](https://github.com/chen2438/exchange_rate/blob/e7f60e13a2255d7d8f267e07773702aa30074a3b/server.js)
- [页面 index.html](https://github.com/chen2438/exchange_rate/blob/e7f60e13a2255d7d8f267e07773702aa30074a3b/index.html)
- [样式 style.css](https://github.com/chen2438/exchange_rate/blob/e7f60e13a2255d7d8f267e07773702aa30074a3b/style.css)
- [依赖声明 package.json](https://github.com/chen2438/exchange_rate/blob/e7f60e13a2255d7d8f267e07773702aa30074a3b/package.json)
- [依赖锁定 package-lock.json](https://github.com/chen2438/exchange_rate/blob/e7f60e13a2255d7d8f267e07773702aa30074a3b/package-lock.json)
- [部署 vercel.json](https://github.com/chen2438/exchange_rate/blob/e7f60e13a2255d7d8f267e07773702aa30074a3b/vercel.json)
- [Git 忽略规则](https://github.com/chen2438/exchange_rate/blob/e7f60e13a2255d7d8f267e07773702aa30074a3b/.gitignore)
- [Vercel 忽略规则](https://github.com/chen2438/exchange_rate/blob/e7f60e13a2255d7d8f267e07773702aa30074a3b/.vercelignore)
- [原 README](https://github.com/chen2438/exchange_rate/blob/e7f60e13a2255d7d8f267e07773702aa30074a3b/README.md)
