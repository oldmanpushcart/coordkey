# 存储结构

配置保存在 `chrome.storage.local` 的单个 key（`coordkey`）下。**配置 schema 版本号是整数 1**，与扩展的 app 版本（manifest 里的 semver `1.0.0`）是两个独立演进的计数器，别混为一谈。

> 1.0.0 之前的 v1/v2/v3 是测试期设计，写在旧 key `profile` 下。换 key 之后它们对新代码完全不可见，`onInstalled` 会顺手清掉。**这是唯一一次不作迁移的版本归零**——从 v1 起下面这套策略生效，不再有第二次。

```jsonc
{
  "version": 1,
  "settings": { "enabled": true, "holdMs": 50, "skipInInput": true, "recordPassthrough": true,
                "showMarkers": true, "hintOpacity": 0.3, "hintDurationMs": 900 },
  "sites": {
    "https://example.com": {           // origin 本身就是稳定自然键，不再另发 id
      "enabled": true,
      "activeSchemeId": "sc_xxx",
      "schemes": [
        { "id": "sc_xxx", "name": "默认", "rules": [
          { "id": "r_xxx", "name": "",
            "shortcut": { "code": "KeyH", "key": "h",
                          "ctrl": false, "alt": false, "shift": false, "meta": false },
            "steps": [
              { "nx": 0.5, "ny": 0.5, "x": 640, "y": 360,
                "canvas": { "index": 0, "id": "", "cls": "", "w": 1280, "h": 720 } },
              { "nx": 0.8, "ny": 0.6, "x": 1024, "y": 432, "canvas": null, "gapMs": 1500 }
            ],
            "intervalMs": 120,
            "env": { "vw": 1280, "vh": 720, "dpr": 1 },
            "createdAt": "2026-09-10T..." }
        ] }
      ]
    }
  }
}
```

## 字段说明

- **单点快捷键就是只有一个步骤的组**，结构完全一致，没有独立的「单点」类型。
- `intervalMs` 是组内相邻两次点击的**统一间隔**；步骤可选带 `gapMs` **覆盖**它，含义是「本步点击后到下一步点击前的等待」，缺省或非法时回落到 `intervalMs`。最后一步之后没有点击，它的间隔不参与播放。
- `env` 在规则级而非方案级：同一方案里不同录制批次的窗口环境可以不同。
- 点击没有落在 canvas 上的步骤长这样：`{ "nx": null, "ny": null, "x": 512, "y": 384, "canvas": null }`，播放时直接按 `x` / `y` 的视口像素点击。**这是普通网页的正常形状，不是脏数据**——导入校验只看 `x`/`y` 是不是有限数，与 `clicker.resolveTarget` 的判据对齐。
- 方案的身份是 `id`，`name` 只是展示标签。改名不会动 `activeSchemeId`，也不会动任何引用。名字仍然要求唯一，那是「下拉框里分不清切到了哪个」的展示约束，不是身份约束。

## 读取：`loadProfile` 是唯一入口

`src/shared/protocol.js` 是 Service Worker（`importScripts`）与内容脚本（manifest `js` 数组）唯一的共享文件，所有纯函数都收在这里，**不碰 DOM 也不碰 `chrome.storage`**。SW 不再自己复制一份归一化逻辑。

```js
loadProfile(raw) -> { profile, foreign }
```

先按 `MIGRATIONS` 把数据升到当前版本，再归一化。`MIGRATIONS` 现在是空对象——没有旧数据要迁移。这十几行骨架是**契约**而不是装饰：以后加 v2 就是「往 `MIGRATIONS` 追加一个 `1: (p) => ...`，再把 `VERSION` 改成 2」，读老数据的路径自动接上。

> `MIGRATIONS` 的条目**只追加、永不修改**。改一个已经发布过的迁移函数，等于让老数据走上一条从没测过的路径。

### 归一化是无损的

三个 normalizer 统一遵守一条原则：**已知字段缺失就补默认，未知字段一律原样保留**（靠 spread）。

- `normalizeSettings`：先铺开 raw，再给 `DEFAULT_SETTINGS` 里缺失的键补默认。废弃的旧设置项会留在数据里但没人读，无害。
- `normalizeSite` / `normalizeScheme` / `normalizeRule`：同样 spread，站点级、方案级、规则级的未知键都能活过一次读写往返。

这条约束是版本策略的地基。少了它，将来加一个字段，用户改一次设置就把新字段洗掉了。

## 版本策略：只有破坏性改动才升版本

- **纯加法 = 不升版本。** 新增可选字段 + 在 normalizer 里补默认值即可。老数据读出来就是「该功能关闭」；新数据被老代码读到，靠 spread 保住字段。
- **结构性 / 破坏性改动 = 升 `VERSION` + 往 `MIGRATIONS` 追加一个迁移函数。**

「重复执行」就是加法的教科书例子。将来在规则上加一个自包含的兄弟字段：

```jsonc
"repeat": { "count": 3, "intervalMs": 2000 }   // 遍与遍之间的间隔
```

嵌套在 `repeat` 里是为了让「遍间隔」和已有的规则级 `intervalMs`（**同一遍内**相邻两步的间隔）语义不撞车。`clicker.js` 的改动也很便宜：把现有的步骤循环外面套一层遍历循环即可，取消与 `sleep(ms, run)` 的中断机制已经能复用。

**现在不预先物化这个字段。** 预留一个没人读的默认值，就是 v3 时代 `shortcut.label` / `rule.button` / `rule.clickCount` 这三个死字段的来历——它们在 1.0.0 被删掉了，因为全仓没有任何读取方，却会永久污染每一份导出文件。（`createdAt` 留下了：它是事后无法重建的诊断信息，而那三个只是「以后可能用到的功能位」，按加法策略随时零成本补回。）

这也是 `intervalMs` **不**包进 `timing: {}` 的理由：分组是破坏性改动，会强制升版本、写真迁移、动 clicker / store / panel / recorder 四个文件和一批 smoke 断言，换来的只有美观。

## 降级：读到了更新版本写的数据

`stored.version > VERSION` 时（用户装了旧版扩展，但配置是新版本写的）：

- **不迁移，也不把 version 写低。** 尽力归一化读取，未知字段靠 spread 保住，`foreign` 记下来那个更高的版本号。
- **存储转为只读**：`store.save()` 检测到 `foreign` 就直接更新内存缓存并返回，**不落盘**。`store.foreignVersion()` 非 0 即表示只读。
- `main.js` 启动时弹一条长时错误提示，明说「配置来自更新版本的 CoordKey，本次改动不会保存」。不说用户会以为保存了。
- 扩展图标上的总开关**仍然可用**，因为 SW 走的是下面这套外科手术式写入。

> 这里否决了「归一化后仍写回原 version 号」的做法。既然版本只在结构性改动时递增，旧代码就不可能正确归一化新结构；写回去等于给一份 v1 形状的数据盖上 v2 的章——用户再升级时迁移链看到 2 会跳过 1→2，数据永久损坏。**只读是唯一自洽的选择。**

## Service Worker 只做外科手术式写入

SW 点图标切总开关时，**只翻 `settings.enabled` 这一个布尔**，直接在原始对象上改，绝不把整份 profile 归一化后写回：

```js
const raw = data[STORAGE_KEY] || emptyProfile();
raw.settings = { ...raw.settings, enabled: !isEnabled(raw) };
await chrome.storage.local.set({ [STORAGE_KEY]: raw });
```

这样 SW 在任何版本下都不会破坏它看不懂的数据，只读模式下总开关照常工作，同时消灭了双实现漂移。徽标读取用 `raw?.settings?.enabled !== false`，不需要归一化。

## 导入导出

导出的 payload 在存储内容之外多带两个外壳字段：`appVersion`（取自 manifest，用户回传配置时能一眼看出是哪个版本写的）与 `exportedAt`。导入时只并 `settings` 与 `sites`，外壳字段不进存储。

版本校验走的是和 store 同一条链：

| 文件里的 version | 行为 |
| :--- | :--- |
| 缺失 / 非法 | 拒绝：「文件缺少有效的配置版本号」 |
| `> VERSION` | 拒绝：「这份配置来自更新版本的 CoordKey（配置 vN，当前支持到 vM），请升级扩展后再导入」 |
| `<= VERSION` | 交给 `loadProfile` 迁移后归一化 |

**导入一律重新发 id**（规则 `r_`、方案 `sc_`）。外来 id 在本机没有意义，而且保留它会让重复导入同一份文件在一个方案里产生两条同 id 的规则——`patchRule` 的 `findIndex` 和 clicker 的运行表都会命中错的那条。

合并策略：

- **覆盖**：整份替换 `schemes` 数组（发新 id）；`activeSchemeId` 指向与来源 active **同名**的方案，找不到就用第一个。
- **跳过已有**：按**方案名**匹配现有方案（跨文件只能按名字匹配，id 是各自本地随机发的，两份导出之间对不上）；命中就把规则并进去、按 `comboId` 去重，未命中就 push 一个新方案。
