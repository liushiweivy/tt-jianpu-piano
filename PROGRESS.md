# 简谱钢琴抖音版（tt-jianpu-piano）— 进度断点

> 2026-10-16（凌晨）。**WF3 完成（code-reviewer APPROVE，二轮修复已合入；待 DevTools 真机编译）**：竖屏 Canvas 全 UI 重画、16 node 测试绿、harness 真实音频/多指/strict/键盘桩/结算全链路 0 console error。

## 二轮审查修复（APPROVE 后）

- MEDIUM-1：**黑键命中热区回归视觉矩形**（去掉 ±2px 外扩）——白键仅 12.2px 宽，外扩使 D/G/A 白键上半段永远点不到；与源 DOM 精确命中不一致。新增命中回归断言。
- MEDIUM-2：播放中点「简谱输入」开键盘前先停播（避免 tokensVM/events 脱节）。
- LOW-1：新增 `engine.trackShown` 生命周期——start 置位、stop/曲终保留（音轨卡持续显示）、setScore/pickSong 复位（留空）；取代原来的 `events.length` 判断（stop 后音轨会闪空）。
- LOW-2：漏判（misses/combo 清零/命中率）**仅跟弹模式累计**，自动演奏不污染评分状态。
- LOW-3：速度滑杆命中高度 20→16（不侵上方调号/开关行）。
- LOW-5：曲谱输入区加 clip 裁剪，超长不可折行粘贴不溢出 chips。
- 测试 13 → 16（trackShown 生命周期、滑杆命中高度；黑键白键抢占断言加强；中途切 guide 积压补判）。
- 浏览器回归：播放→停止音轨保留、选曲复位、D4 白键上半段 w:62、280 字无空格串裁剪（docs/tt-piano-track-retain.png、tt-piano-longpaste.png）。
- 三轮增量复审 APPROVE（0 C/H/M，2 LOW 已关：stop 冗余实参清理、切 guide 补判测试）。

## 当前状态：抖音小游戏版可玩，待开发者工具编译验证

### 2026-10-16 抖音移植（源 jianpu-piano-mp）

- 架构：core（纯逻辑，时钟/scheduleNote 外部注入，Node 可测）+ audio（三平台 UMD）+ render（Canvas UI + 命中几何）+ main（薄平台层）；parser/songs 与小程序版逐行同源
- render.js（450×800 逻辑世界）：header / 简谱输入卡（3 行截断显示 + 5 chips）/ 控制卡（调号循环、跟弹开关、速度 −/滑杆/＋、播放停止）/ 音轨卡（未播放留空；播放后横向自滚动、active 金色上浮、passed 半透明、增时线画在动态间隙内不溢出）/ 数字垫（−八度名＋ + 7 垫）/ 35 白 25 黑钢琴（三色亮键 + glow，黑键优先命中）/ 脚注 / 结算·语法两弹层
- main.js：tt.createCanvas + DPR letterbox；onTouchStart/Move/End（多指 changedTouches、滑杆 identifier 拖动）；tt.showKeyboard + onKeyboardInput/Confirm/Complete 曲谱输入；音频时钟驱动 engine.update；onHide 停播+收键盘、onShow ensure；vibrateShort/setKeepScreenOn try/catch；首触 [probe] touch 探针 + 物理像素 1/DPR 自校正
- audio.js：tt.getAudioContext()（≥1.34.0）→ wx → 浏览器；master 0.6(tt)/0.8 直连（无 Compressor）；createDelay 反馈混响失败降级干声
- harness：450×800 shim；?sound=1 / ?strict=1；tt._kb 系统键盘桩；tt._life 前后台；鼠标 move(buttons) 支持滑杆拖动；__piano 暴露 engine/ui/start/stop/hit/handleTap
- 验证：
  - `node --test tests/core.test.mjs` → 16/16 绿（移植小程序 smoke 全部断言 + render 几何/命中/模态/滑杆/折行 + 二轮审查回归；三轮复审 APPROVE 后补中途切 guide 积压补判测试）
  - harness muted：帮助开关、跟弹/调号/八度/选曲/键盘桩改曲谱全部接线正确
  - harness sound（真实 AudioContext + 受信点击解锁）：播放推进（curTok/lit60）、跟弹 GOOD+combo1、结算 total=3 rate=0%、onHide 停播
  - strict+sound 双指 touchstart：w:59/w:62 同帧两键点亮（多指和弦）
  - 0 console error；docs/ 四截图（home/playing/result/help）
- 设计决策：
  - 引擎不碰音频节点：start(now, scheduleNote) 回调发声，update/press* 吃注入时钟 → Node 测试与小程序 smoke 同构
  - 未播放时音轨留空（对齐源小程序 tokens=[] 初始态），不用 scoreText 预渲染
  - 速度热区上沿曾因浏览器 rect 小数偏移（290.2 vs 热区 291）在合成事件下误判，真实点按在键中央不受影响；滑杆几何抽 bpmTrackBox() 单点真源
  - 黑键命中严格用视觉矩形（不外扩，二轮审查结论）；白键 1/35≈12.2px 宽（450 逻辑世界），真机 letterbox 后约 11px，属钢琴类应用常规密度
- 待办：code-reviewer 审查；抖音开发者工具 4.5.6 测试号导入编译 + 模拟器/真机截图（音频基础库 ≥1.34.0，首触核对探针坐标）；正式上架需企业+版号，上传预检必接 tt.navigateToScene
