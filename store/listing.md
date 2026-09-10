# 商店提交素材与文案

Chrome Web Store 与 Edge Add-ons 共用同一个 ZIP（`node tools/pack.mjs` 的产物）。
这里记的是两家**各自要填的字段和要上传的图**，尺寸是官方硬要求，不合规格直接卡在提交页。

## 图片素材

| 素材 | Chrome Web Store | Edge Add-ons | 现状 |
| :--- | :--- | :--- | :--- |
| 图标 / logo | 128×128，必需 | 1:1，推荐 300×300，最低 128×128，每种语言必需 | 已齐：`assets/icons/icon128.png`、`store/logo-300.png`（`node tools/gen-icons.mjs` 生成） |
| 截图 | 1280×800，至少 1 张，必需 | 可选，640×480 或 1280×800，最多 6 张 | **仍缺**。README 三张已于 2026-09-10 重拍（CoordKey 品牌、v1.0.0 徽标、背景虚化），但是 800×1412 竖图，尺寸不合商店要求 |
| 小宣传图 | 440×280，必需 | 440×280，可选 | 已生成：`store/tile-440x280.png` |
| 大宣传图 | 1400×560，可选 | 1400×560，可选 | 不做 |

商店横图只能人工拍：Chrome stable 从 137 起不再认 `--load-extension`，自动化要引入 Puppeteer 的
`enableExtensions` 和一个 dev 依赖，为一次性素材不值。拍法参考 README 那三张：背景虚化压暗
（同时解决第三方美术资产与深色背景辨识度），截之前收起游戏聊天框，面板里别留第三方域名。

## 语言

中文单语。manifest 的 `name`/`description` 硬编码中文，商店只会识别出一个 locale。

不要加 `default_locale`——它只在同时存在 `_locales/` 时合法，单语加了会让 manifest 直接报错。
将来要上英文市场，再一起加 `_locales/<lang>/messages.json` + `default_locale` + `__MSG_*__`
占位符；那时还要决定 UI 文案（`panel.js` / `hint.js` / `recorder.js`）是否一并国际化。

## 提审文案（两家都要填，内容基本可复用）

- **单一用途说明**：把键盘快捷键绑定到屏幕坐标，在录制的位置派发合成鼠标点击。
- **`<all_urls>` 权限理由**：坐标点击必须在任意页面生效，包括把 UI 全画进 canvas 的页面；
  收窄到特定站点会让工具在用户的真实场景里失效。不要试图换成 `activeTab`——那要求用户先点
  扩展图标授权当前站，会破坏「打开页面就能用快捷键」这个核心体验。
- **远程代码**：否。MV3 本身也不允许。
- **数据使用声明**：不收集任何用户数据。配置只写在本机 `chrome.storage.local`，扩展不联网，
  没有远程请求。
- **隐私政策 URL**：Edge 只在收集隐私信息时必需，本扩展不收集，但两家都建议填。可用 GitHub
  Pages 挂一页，两店通用。
- **认证测试备注**：说明这是坐标点击工具、如何在 `test/demo.html` 上验证、以及合成事件在
  校验 `isTrusted` 的页面上无效属于预期行为（避免审核员当成 malfunction）。
- **Edge 描述长度**：每种语言 250–10000 字符。`manifest.json` 的 `description` 会作为
  短描述显示在列表页，商店页的长描述另填。

## 提交流程

1. 升 `manifest.json` 的 `version`（商店不接受重复版本号，这是唯一的版本事实来源）
2. `node tools/smoke-content.mjs` → 必须 `SMOKE: PASSED`
3. `node tools/pack.mjs` → `dist/coordkey-<version>.zip`
4. 提交、打 tag `v<version>`、发 Release，ZIP 作为 Release 资产
5. 同一个 ZIP 分别上传 Chrome Web Store 与 Edge Partner Center，两边版本号保持一致
6. Edge 认证最长 7 个工作日；CWS 因为 `<all_urls>` 属于宽权限，审核会更慢
