# 存储结构

配置保存在 `chrome.storage.local` 的单个 key（`profile`）下，当前版本号为 **3**。

```jsonc
{
  "version": 3,
  "settings": { "enabled": true, "holdMs": 50, "skipInInput": true, "recordPassthrough": true,
                "showMarkers": true, "hintOpacity": 0.3, "hintDurationMs": 900 },
  "sites": {
    "https://example.com": {
      "enabled": true,
      "activeScheme": "默认",
      "schemes": {
        "默认": { "rules": [ { "id": "r_x", "name": "", "shortcut": { "code": "KeyH", "key": "h",
                   "ctrl": false, "alt": false, "shift": false, "meta": false, "label": "H" },
                   "steps": [
                     { "nx": 0.5, "ny": 0.5, "x": 640, "y": 360,
                       "canvas": { "index": 0, "id": "", "cls": "", "w": 1280, "h": 720 } },
                     { "nx": 0.8, "ny": 0.6, "x": 1024, "y": 432,
                       "canvas": { "index": 0, "id": "", "cls": "", "w": 1280, "h": 720 },
                       "gapMs": 1500 }
                   ],
                   "intervalMs": 120,
                   "button": "left", "clickCount": 1,
                   "env": { "vw": 1280, "vh": 720, "dpr": 1 }, "createdAt": "..." } ] },
        "大屏": { "rules": [] }
      }
    }
  }
}
```

## 字段说明

- **单点快捷键就是只有一个步骤的组**，结构完全一致，没有独立的「单点」类型。
- `intervalMs` 是组内相邻两次点击的**统一间隔**；步骤可选带 `gapMs` **覆盖**它，含义是「本步点击后到下一步点击前的等待」，缺省或非法时回落到 `intervalMs`。最后一步之后没有点击，它的间隔不参与播放。
- `env` 仍在规则级——同一次录制里窗口环境是相同的，触发时用它检测窗口尺寸 / 屏幕缩放是否变化。
- 点击没有落在 canvas 上的步骤长这样：`{ "nx": null, "ny": null, "x": 512, "y": 384, "canvas": null }`，播放时直接按 `x` / `y` 的视口像素点击。

## 读取时的形状约束

`normalizeRule` 只做形状约束：丢弃没有有效 `steps` 的规则、为缺失的 `intervalMs` 补默认值、只保留 `DEFAULT_SETTINGS` 里声明过的设置键。它**不做版本迁移**。

## 版本与迁移策略

**不做旧数据迁移**：v1（站点直接挂 `rules`）与 v2（规则直接挂 `nx/ny/x/y`）的本地数据在读取时会被丢弃，旧版导出的 JSON 会在导入时被明确拒绝（提示「不支持的配置版本 N（当前为 3）」），都需要重新录制。这是有意为之：宁可让用户重录，也不留下「似乎还兼容」的错觉。
