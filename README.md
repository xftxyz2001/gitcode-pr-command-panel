# GitCode PR 快捷命令

一个轻量的 Chromium Manifest V3 扩展。在 GitCode Pull Request 页面显示可拖动的悬浮按钮组，点击后通过 GitCode 自身的评论接口立即发送对应机器人命令。

## 内置命令

| 按钮 | 发送内容 |
| --- | --- |
| 编译 | `compile` |
| 查看日志 | `get-log` |
| 重试流水线 | `retry` |
| 停止流水线 | `stop` |
| 检查 CLA | `/check-cla` |
| LGTM | `/lgtm` |
| 批准合入 | `/approve` |
| 检查合入 | `/check-pr` |

## 安装

### Chrome

1. 打开 `chrome://extensions/`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录 `gitcode-pr-command-panel`。

### Edge

1. 打开 `edge://extensions/`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本目录 `gitcode-pr-command-panel`。

安装后打开形如 `https://gitcode.com/<组织>/<仓库>/pull/<编号>` 的页面即可看到悬浮按钮组。

## 使用与保护措施

- 点击命令按钮后会立即发表评论，不会再次弹出确认框。
- 可在“讨论”“提交”“检查”和“文件改动”任意选项卡中使用。
- 不切换选项卡、不展开评论框，也不覆盖评论草稿。
- 插件直接复用当前 GitCode 登录态调用 PR 评论接口，因此在“提交”“检查”“文件改动”中也能发送。
- 同一个命令发送后的 5 秒内会阻止重复点击，避免重复评论。
- 按住面板标题可拖动位置，点击右上角按钮可收起。

## v1.1.1 修复

- 不再仅依赖选项卡的 `aria-expanded` 状态。
- 以可见的底部“回复”入口或评论编辑器作为讨论区已就绪的判断依据。
- 修复页面已经位于“讨论”时仍提示“无法自动切换”的问题。

## v1.1.2 修复

- 触发“回复”后使用 `MutationObserver` 监听编辑器挂载和显隐变化。
- 等待窗口延长至 15 秒，兼容 GitCode 评论组件延迟展开。
- 移除连续模拟点击和回车的逻辑，避免页面稍后展开但插件已提前报错。

## v1.1.3 修复

- 已按 GitCode 的实际 DOM 结构锁定底部 `input[placeholder="回复"]`。
- 展开评论框时补齐 `pointerdown`、`mousedown`、聚焦、`pointerup`、`mouseup`、`click` 事件序列，兼容依赖鼠标事件而非单纯 `element.click()` 的页面逻辑。
- 继续监听编辑器的异步挂载，展开后直接找到 CodeMirror 输入区并发送，无需用户手动点击“回复”。

## v1.2.0 改为直接发送

- 根据页面打包代码确认，“发送评论”最终调用 `POST /issuepr/api/v1/projects/{project_id}/merge_requests/{iid}/notes`。
- 请求体与 GitCode 页面一致：`{ body: command, need_to_resolve: false }`。
- 新增主页面桥接脚本，复用 GitCode 当前登录态；不再查找输入框、模拟鼠标、切换选项卡或点击发送按钮。
- 主页面桥接只接受本插件内置的八条命令，避免页面事件被用于发送任意文本。

- `/lgtm`、`/approve` 等命令是否生效取决于当前 GitCode 账号的仓库角色。
- 插件仅注入 GitCode 页面，不申请浏览历史、存储、下载等额外权限。

## 修改按钮

编辑 `content.js` 顶部的 `COMMANDS` 数组，然后在扩展管理页面点击“重新加载”即可。例如：

```js
{ label: "检查合入", command: "/check-pr" }
```
