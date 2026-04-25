# UW Brave Discovery Pack

## 目的

用 Brave Search API 查找 `unusualwhales.com` 的公开页面入口和字段说明，给后续本地 Playwright DOM Reader 使用。

这一步只做 URL discovery，不读取 UW 会员数据。

## 文件

- `integrations/unusual-whales/discovery/uw_discovery.sh`：调用 Brave Search API，生成 `integrations/unusual-whales/discovery/uw_raw_results/raw_*.json`
- `integrations/unusual-whales/discovery/uw_parse.py`：清洗 raw JSON，生成 `integrations/unusual-whales/discovery/uw_discovery_results.json`
- `integrations/unusual-whales/.env.uw.example`：环境变量示例

## 运行方式

```bash
export BRAVE_API_KEY="your_key_here"
chmod +x integrations/unusual-whales/discovery/uw_discovery.sh
./integrations/unusual-whales/discovery/uw_discovery.sh
python3 integrations/unusual-whales/discovery/uw_parse.py
```

## 输出

```text
integrations/unusual-whales/discovery/uw_raw_results/raw_*.json
integrations/unusual-whales/discovery/uw_discovery_results.json
```

`integrations/unusual-whales/discovery/uw_discovery_results.json` 包含：

- `source_discovery`
- `modules`
- `errors`

每个 `candidate_url` 包含：

- `url`
- `title`
- `snippet`
- `extra_snippets`
- `confidence`
- `keyword_hits`
- `source_file`
- `why_it_matters`

## 第一阶段只使用 S 级模块

1. `spx_greek_exposure`
2. `spy_darkpool_offlit`
3. `options_flow_alerts`

筛选规则：

```text
priority = S
status = found
confidence >= 0.70
```

## Cursor 下一步

读取 `integrations/unusual-whales/discovery/uw_discovery_results.json`，选择 S 级高置信 URL。

然后才开始本地 Playwright DOM Reader：

```text
已登录 UW 浏览器 profile
→ 打开高置信 URL
→ 确认 DOM selector
→ 读取页面可见数据
→ 生成 uw_snapshot
→ POST /ingest/uw
```

## 禁止事项

- 不调用 UW 官方 API
- 不读取 cookie 文件
- 不保存 UW 账号密码
- 不绕过登录
- 不处理验证码
- 不高频抓取
- 不复制 UW 原始会员数据到线上
- 不把原始表格塞进 Dashboard

## 后续 ingest 目标格式

后续 DOM Reader 推送到：

```text
POST https://spxopslab.store/ingest/uw
```

摘要 JSON 只保留：

- Gamma / Dealer
- Flow
- Dark Pool
- 速度
- 推力
- 冲突原因
- 中文结论
