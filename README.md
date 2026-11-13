# dsh-away（出门）

心情踩线的时候，给自己开一扇窗：自动新建一条「出门-日期」的会话，把提醒投进去，出门回来说一句「回来了」，记一笔。

它不是情绪引擎，也不管评论巡查 —— 只做一件事：**该出去走走了吗**。

## 它怎么判断

从情绪引擎读当前心情（只走 HTTP，`GET /mo-emotion/state`）。低于阈值、或者连着几天没出门，就提醒。

**没有情绪引擎也能用**：读不到心情时不会报错，只是不再自动判断 —— 你手动点「现在出门」照样开会话、照样记 leg。

## 安装

profile 的 `dependencies` 里加 `"dsh-away": "link:/path/to/dsh-away"`，重启 DSH。设置左侧栏会出现「出门」。

## 依赖

| 要什么 | 必需？ |
|---|---|
| Node.js ≥ 20 | 必需 |
| 情绪引擎（`/mo-emotion/state`） | 可选，没有就退化成手动 |
| DSH 会话接口（新建 / 投递） | 必需（插件自带的能力，跟着宿主走） |

## 它做什么

- 到点检查一次心情，踩线就在设置页亮提示
- 开一条独立会话（不动你正在用的那条），把「出去走走」投进去
- 你回来说一句，记一笔 leg 事件（fun / work / biz）转给情绪引擎算数值
- 避峰：收费高峰不提醒（可关）

## 配置

存 `~/.dsh/mo-out/config.json`（跟着宿主数据目录走）。面板上改数字要点「保存」才生效 —— 因为改的是「下次什么时候提醒」，不是即时生效的开关。

## 路由

```
GET  /dsh-away/state         全部状态（配置 + 记账 + 活会话）
GET  /dsh-away/sessions      只列活会话
POST /dsh-away/config        改配置（patch 式）
POST /dsh-away/new-session   新建一条出门会话
POST /dsh-away/leg           记一笔「出门回来」
POST /dsh-away/check         立刻检查一次（不花钱，调试用）
```

## 自检

```bash
node panel-check.mjs
```

## 许可

MIT
