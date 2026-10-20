# 战斗音频测试实验场

面向游戏音频功能、混音、空间定位、性能、兼容性和故障注入的可交互测试作品集。

## 在线内容

- 互动测试实验场：GitHub Pages 首页
- 测试作品集：[张成-音频测试工程师-作品集.pdf](portfolio/张成-音频测试工程师-作品集.pdf)
- 测试方案：[audio-test-plan.md](docs/audio-test-plan.md)
- 测试报告：[test-report.md](docs/test-report.md)

## 项目内容

- Canvas 2D 战斗场景
- Web Audio API 程序化音频
- 探索与战斗BGM状态切换
- 攻击、受击、技能、死亡和语音事件
- Master、Music、SFX、Voice分轨
- 空间声像与距离衰减
- 六类故障注入
- Playwright自动验证
- 42条事件追踪记录

## 本地运行

```powershell
node server.js
```

打开 `http://127.0.0.1:4173`。

## 自动测试

```powershell
node tests/smoke-test.js
```

## 说明

当前版本使用浏览器音频实现验证测试流程。Unity、Wwise、真实声卡、耳机、扬声器和蓝牙设备兼容性需要在正式游戏工程中继续验证。
