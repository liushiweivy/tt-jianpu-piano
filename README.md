# 简谱钢琴（tt-jianpu-piano · 抖音小游戏版）

输入简谱自动演奏、跟弹打分的**抖音小游戏**：35 白键 / 25 黑键（C2–B6）多指钢琴，纯 Canvas、零素材零依赖（音色用 WebAudio 合成）。

> 同源项目：小程序版 `E:\1workspace\jianpu-piano-mp`、网页版 `E:\1workspace\jianpu-piano`。本目录是抖音小游戏移植版，**不改动原版**，parser/songs 逐行同源。

## 玩法

- **自动演奏**：输入简谱（或选 5 首预设曲），选调号（C/D/E/F/G/A/B/♭B/♭E）、速度（40–200）、点「▶ 播放」，琴键按音高三色亮起自动弹奏。
- **跟弹模式**：打开开关后播放，圆圈提示下一个音，在 ±0.4s 窗内点对应数字垫（或琴键）即得分：PERFECT (<0.12s) / GOOD (<0.26s) / OK；错音不计、漏判断连击；曲终结算命中率（八度自动宽容，只需点对数字）。
- **自由弹奏**：数字垫 1–7（do…si）+ 八度 −/＋（倍低/低/中/高/倍高），或直接点 61 个琴键；黑键照常发声但不参与跟弹判定。
- 蓝=低音 · 金=中音 · 粉=高音。

简谱语法：`1 2 3 4 5 6 7`、`0` 休止、`1'` 高音点 / `1,` 低音点（可叠两个）、`5 -` 增时线、`5_` 减时线、`3.` 附点、`#`/`b` 升降号、`[1 3 5]` 和弦、`|` 小节线；支持全角符号。

## 抖音适配点（相对小程序版）

| 项 | 小程序版 | 抖音小游戏版 |
|---|---|---|
| 形态 | TTML/WXSS + Page setData | **纯 Canvas 450×800 逻辑世界**，DPR + letterbox 等比缩放 |
| 输入 | `<textarea>` | `tt.showKeyboard` 系统键盘 + `onKeyboardInput/Confirm/Complete`（Canvas 只读渲染曲谱） |
| 控件 | picker / switch / slider / scroll-view | Canvas 自绘：调号循环钮、开关、速度滑杆（支持拖动）、横向音轨自滚动、chips、两个弹层 |
| 音频 | wx WebAudio（含 Compressor） | **`tt.getAudioContext()`（基础库 ≥1.34.0）**；无 Compressor → 主增益 0.6 限幅；createDelay 反馈混响 try/catch 降级干声 |
| 触摸 | bindtouchstart 组件事件 | 全局 `tt.onTouch*`；黑键优先命中（**严格视觉矩形，不外扩**）、多指和弦（同帧 changedTouches 多点）；速度滑杆 identifier 跟踪拖动 |
| 坐标 | — | clientX 优先、screenX 兜底；首触 `[probe] touch` 探针日志，物理像素上报（越出 screenWidth/Height 数百 px）自动按 1/DPR 归一；归一后仍越窗再 warn |
| 生命周期 | onHide | `tt.onHide` 停播 + 收键盘；`tt.onShow` 恢复音频；`tt.setKeepScreenOn` 常亮 |
| 反馈 | wx.vibrateShort | `tt.vibrateShort`（try/catch） |

引擎 core.js **不碰音频节点**：`start(now, scheduleNote)` 由平台层注入发声回调，`update/pressDegree/pressMidi` 时钟全部外部注入，Node 可控时钟直接测试。

## 运行

1. 打开**抖音开发者工具**（本仓用 4.5.6 验证）→ 导入项目 → 选择本目录 → 类型「小游戏」（竖屏）。
2. AppID 选**测试号**（可编译/预览调试，不可上传）；`project.config.json` 里 appid 留空。
3. 基础库 ≥ 1.34.0（音频需要）。
4. **首次编译/真机必查**：console 首条 `[probe] touch` 日志，确认点按位置准确（screenX 物理像素时会自动 1/DPR 归一）。

浏览器联调：

```powershell
# 双击 start.bat，或 Git Bash：
"/c/Users/4v/AppData/Local/Programs/Python/Python312/python.exe" -m http.server 8823
# 打开 http://127.0.0.1:8823/harness/index.html
```

harness 查询参数：`?sound=1` 真实 AudioContext（需一次点按解锁）、`?strict=1` Touch 只给 screenX/Y；`tt._life.hide()/show()` 模拟前后台；`tt._kb.set(v)/confirm()/complete()` 模拟系统键盘输入；`globalThis.__piano` 暴露引擎与调试口（hit/handleTap）。

## 测试

```powershell
node --test tests/core.test.mjs
```

- **16 个测试全绿**：键盘几何（35/25、C2 首键、黑键跨缝）、播放调度（t0=0.22 前置、末音增时线 2 拍、亮键随时钟推进、手动/自动亮键合并、非跟弹不累计漏判）、trackShown 音轨显示生命周期、跟弹判定（PERFECT/GOOD/OK、错音不计、漏判断连、1/7=14% 结算、**中途关-开跟弹的积压补判与源小程序对齐**）、空输入保护、黑键不判定、设置边界、stop 清理、render 命中几何（控件/垫/白键/黑键视觉矩形/chips/模态弹层）、速度滑杆命中高度与往返、折行。
- harness 实测：真实音频时钟播放一曲（亮键/音轨滚动/HUD）、跟弹 GOOD 加分、onHide 停播、多指和弦（两指同响两键）、系统键盘桩改曲谱、结算/语法弹层、停止后音轨保留、280 字超长粘贴裁剪，0 console error；截图见 `docs/`（home/playing/result/help/track-retain/longpaste）。

## 发布备注（暂未做）

- 测试号不能上传；正式发布需抖音开放平台小游戏 AppID（游戏类目通常需企业主体 + 版号等资质）。
- 上传预检必接「侧边栏复访」`tt.navigateToScene`，本地编译与预览不受影响。

## 代码结构

```
game.js              入口：require("./js/main.js")
game.json            竖屏配置（deviceOrientation: portrait）
project.config.json  抖音工程配置（appid 留空=导入时选测试号）
js/
  parser.js          简谱词法解析（与小程序版逐行同源，UMD）
  songs.js           5 首预设曲（小星星/两只老虎/欢乐颂/生日快乐/致爱丽丝）
  core.js            纯逻辑引擎：token VM、键盘几何、播放调度、亮键、跟弹判定/结算（UMD）
  audio.js           WebAudio 合成（triangle 基音 + 2/3/4 倍频 + 延迟混响；tt/wx/浏览器三分支）
  render.js          Canvas UI：7 区布局 + 命中几何 + 两弹层（UMD，无平台依赖）
  main.js            平台层：画布、触摸多指、系统键盘、音频时钟驱动、生命周期
harness/index.html   浏览器 tt shim（sound/strict/键盘桩/前后台）
tests/core.test.mjs  node:test 15 项
docs/                harness 实测截图（6 张）
```
