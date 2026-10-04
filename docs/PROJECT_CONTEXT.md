# 卡周期：持续维护上下文

核验日期：2026-10-02。事实依据为当前代码、Git、实际检查输出；部署历史依据单列。最新状态入口为根目录 `HANDOFF.md`。

## 项目身份与阅读顺序

当前目录 `/Users/yangqiuyuan/Coding/credit-card-repay` 是普通 Git 主工作区，`.git` 与 common-dir 均为本目录 `.git`，不是 detached/临时 worktree。主线由 `origin/HEAD -> origin/main`、本地 `main` 和公开 GitHub main 共同核实。origin 为 `git@github.com:qiuyuanqr/cardcycle.git`；2026-10-02 核验 HEAD 为 `b1e43e2e43e03ed04a70f66547944b04e8b56f81`，本地历史 51 个提交。

Claude 历史会话内部 cwd 为 `/Users/yangqiuyuan/Coding/信用卡还款`；会话与记忆现放在英文目录对应的项目文件夹中，最新功能与当前 Git 提交一致，旧中文目录不存在。综合这些证据判断当前目录可继续维护；不声称单凭目录名证明了完整搬迁过程。

原 `HANDOVER.md` 面向交给另一位维护者的“拷贝接管”，包含改名 origin、剔除本地数据、31 项测试等指令。本次是在所有者当前目录继续维护，不执行那个克隆流程，不改远端。私有数据文件现仍被忽略；只核查存在和忽略状态，没有读取内容。

理解代码的顺序：`说明.md` → `core.js` 的 `calc` / 迁移 / ICS → `test/core.test.js` → `miniprogram/utils/store.js` 与 `test/store.test.js` → 本次涉及的网页或小程序页面。

## 当前架构与数据契约（代码已核实）

| 入口 | 职责 |
|---|---|
| `core.js` | UMD 纯函数；日期数学、周期与金额归属、数据清洗迁移、排序、ICS |
| `index.html` | 网页完整 UI 与 localStorage 适配；全局 `CardCycleCore` |
| `sw.js` / `manifest.webmanifest` / 图标 | PWA 壳与离线缓存，当前 CACHE 为 `cardcycle-v4` |
| `miniprogram/utils/core.js` | 根核心的同步副本，不能独立维护 |
| `miniprogram/utils/store.js` | wx.storage、标准化、可测事务与展示数据；APP_VERSION 1.0.22 |
| `miniprogram/pages/` | dash/hist/settings 三个 tab；swipe/card/cardtx/pos 页面 |
| `miniprogram/components/repay/` | 自绘还款组件 |
| `test/` / `package.json` / `.github/workflows/test.yml` | Node 内置测试、双核心一致性、Node 22 CI |

两端的存储 key 均为 `cardcycle.v1`。备份为包含 people/cards/terminals/txns/payments/settings 的 JSON，两端互导；无需后端、构建、数据库或 AI API。`package.json` 无 dependencies/devDependencies；现存 node_modules 是历史工具残留，本次未删除。

- 卡片字段：id/personId/bank/last4/statementDay/buffer/limit；日期以本地 `YYYY-MM-DD` 处理，不套 UTC 日期逻辑。
- 消费 txns 和还款 payments 是独立账。`calc` 以分单位整数运算，让还款先冲最早消费，再按消费的 date 算周期。超出全部消费的还款返回 deposit。
- 下个账单日使用短月末尾夹取；工具的提醒截止为下个账单日减 buffer，是产品自定义提醒口径，不能冒充银行合同还款日。
- future 周期消费仍占用还款额度，但单独报 fut/futN，避免“存款减少却没有提示”。待还、存款和未来消费展示须按 core 的字段理解。
- multiUser 是显示/代管开关，不提供跨设备或不同用户数据同步；本地商户间隔只覆盖本设备记录。
- `parseAmount` 负责有限、正数、最多两位小数、上限一亿；历史数据清洗较宽容，不用入口规则抹掉旧数据。
- `normalize` 先把旧 repaid 标记迁移为独立 payments，再按白名单清洗、清理旧占位商户/孤儿流水；顺序不能颠倒。
- 排序：日期倒序 → 同日 ts 倒序 → id 兜底。`ts` 是记账时刻，不是消费日期。历史缺 ts 的真实先后不可恢复，fallback 只用于排序，不写回数据。

## 已完成成果与决策来源

以下实现已对照代码及现有测试；“上线/上传”的历史表述不代替当前平台验收。

| 成果/决策 | 原因及核对入口 |
|---|---|
| 纯核心复用，双端本地存储 | 两端计算保持一致，个人数据留在设备；核心与 store、HANDOVER 第 3/5 节 |
| 消费/还款分账，超额记存款 | 去掉逐笔 repaid 关联；`calc/migrateRepaid` 与测试 |
| 读失败保护、导出阻止、恢复入口可达 | 曾把异常当首次启动覆盖真实数据；`load/save/exportBlocked`、store readFailed；审查 W-b 复盘 |
| 导入白名单与金额入口收紧 | 防恶意 id 拼入 onclick，自 XSS；防 Infinity 入 JSON 变 null、0.001 变显示零；提交 `5e42ba9` 与 Codex 第二批复审 |
| 卡片快照事务，持卡人纳入回滚 | 保存失败重试会积累重复卡；ensureMe 必须在快照内；提交 `3bd076e` 与第三批复审 |
| 商户改名，不重建商户 | 保留 terminalId 关联，不牺牲历史记录；`normTermName/renameTerm`，提交 `f252ea8` |
| 单笔消费编辑 | 原地改商户、日期、金额、备注，保留 id/ts、写失败回滚；`txnForEdit/updateTxn` 与网页 editTx；`b1e43e2` |
| 过期进度条报下一窗口 | 避免过了截止仍写上月“起可刷”误导；`winTicks`，两端引用；`b1e43e2` |
| ICS 导出保留、安卓批量写日历放弃 | 历史三轮真机中用户手势限制、多次确认、未写入仍回调 success；用户已拍板，不恢复旧实现 |
| 原生 editable 还款弹窗放弃 | content 会预填进输入框；自绘 repay 组件沿用 |
| 并列按钮 ghost | 避免实心按钮被读成已选择；`21042ca` |
| 不自动轮换 AppSecret | 历史用户已决定不做；这是账号操作决策，本次没有接管账号或读取凭据，不重新擅自操作 |

Git 和审查资料明确记载了 Codex 的多轮复审及已落地修复，Claude 会话也记录了这些修改。不把成果按助手品牌互相覆盖。

## 排查经验与实际处理

1. **“数据没了”先看环境。** 开发、体验、正式的隔离是历史真机结论；设置的“本机存储”显示 envVersion、条数与版本。再分辨读取失败、真空存储或走错环境，不直接重置。更新首启种子不影响旧设备，需显式迁移。
2. **读失败不能种空数据。** 小程序 readRaw 重试一次，失败返回只读空壳；网页 loadFailed 必须先声明再 `S=load()`。恢复路径要实际可达，不能只见 try 就认定已兜住。
3. **写失败要回滚，不能谎报成功。** 重点包括新增消费、还款、卡片、商户改名、消费编辑；卡片 people 快照要取在 ensureMe 之前。历史审查“saveCard 已回滚”曾写错，后续已纠正，代码和测试优先。
4. **备份不能用空数据验关键链路。** 现有往返测试包含初始样本外新增 6 消费+6 还款，逐卡比较金额；真机备份/分享仍须单独验。使用合成样本，不擅自读取个人文件。
5. **0 是合法参数。** buffer/minGap 不能用 `|| 默认值`；合法零值已两轮修复。
6. **微信文件分享保持用户手势。** 写文件后直接在点击链调用 shareFileMessage，不放到异步回调；回调 success 本身不是系统日历实际写入证明。
7. **工具报错先核实基础库。** 历史无效 libVersion 导致误导性 `41002 appid missing`；当前配置为 latest。服务端口关闭、登录过期、automator 超时是历史工具问题；修改私有工具设置仍需授权与备份，不照抄旧记忆直接改。
8. **版本号显示是人工标记。** 上传版本应同步 store.APP_VERSION，但它不证明后台或真机跑的版本。历史体验版自动跟随与预览码有效期均是当时实测记录，需要使用时复核现状。
9. **PWA 数据保留/审核/费用不要当永恒事实。** 旧文档的 Safari 七天说明、微信类目/隐私申报要求、云开发价格与预览期限是历史资料；涉及新决策时查当前官方资料。本次未重审这些平台规则。

## 本地开发与运维入口

```sh
# 无需 npm install
npm test
# 只在确实修改根核心之后执行
npm run sync-core
npm run check-sync
# 前台启动；退出 Ctrl-C
python3 -m http.server 8791 --bind 127.0.0.1
```

`.claude/launch.json`（忽略的本机配置）唯一项目启动项就是上述 Python 静态服务，不依赖 Claude 专属协议。Codex 直接用终端运行即可，本次已验证相同标准库 HTTP 服务的 7 个资源，无需迁移到另一个后台系统。

测试用 Node 自带 node:test/assert 和手写 wx mock；本次 48/48，CI 配置 Node 22，本机验证 Node 26.3.0/npm 11.16.0。业务样本是测试中构造的数据。现有测试不覆盖网页 DOM/存储适配及微信平台编译，语法和 HTTP 通过不能越界声明 UI 或真机通过。

网页发布目标为 [GitHub Pages](https://qiuyuanqr.github.io/cardcycle/)。历史记录称 main push 自动发布；当前网页三份运行文件与本地一致，但未读取后台 Pages 配置、未验证未来发布时延或测试门禁。现有 test workflow 仅测试，没有部署步骤及 Pages 门禁。

小程序导入目录为 `miniprogram/`；CLI 文件存在。微信开发者工具本次未运行，登录态未验证。经授权后可使用：

```sh
/Applications/wechatwebdevtools.app/Contents/MacOS/cli preview --project "$PWD/miniprogram" --qr-format image --qr-output /tmp/cardcycle-preview.png
# upload 前核对后台已有版本，确定新版本号，并同步 APP_VERSION
/Applications/wechatwebdevtools.app/Contents/MacOS/cli upload --project "$PWD/miniprogram" -v <确认的新版本号> -d "<变更说明>"
```

preview/upload 均涉及微信远端，不能当只读本地编译操作。登录扫码、体验成员配置、提审、发布按授权和用户配合执行；不发送二维码或文件给第三方。

本机项目相关 LaunchAgent/Daemon 配置、已加载 launchd 标签、用户 crontab、Codex automation 均未找到匹配项，8791 无监听。扫描范围与结论限本机及本项目标识，未检查远端机器/其他目录命名的外部任务。项目运行文件未发现 Claude CLI、Anthropic API、wx.cloud/wx.request 或业务定时任务；不需要替换模型调用，也没有“聊天导入即服务迁移”的依据。

## 待办、限制与决定

| 优先级 | 状态 | 下一步 |
|---|---|---|
| P1 验收 | 小程序当前后台状态与 1.0.22 真机未核实 | 用户在体验环境检查版本、过期文案、单笔编辑/重进持久化；再决定是否提审/发布。账号扫码需用户配合 |
| P2 测试缺口 | 网页内联 UI/存储无自动化覆盖 | 后续涉及存储/UI时用独立测试环境和合成账本验四个读取场景与写失败，不污染用户存储 |
| P2 已知暂缓 M-a | 一些次要写路径忽略 save 返回值 | 加/删商户、删流水/卡片等，以及备份导入的保存反馈仍需专项核对；网页也存在忽略 save 的路径。`settings.applyBackupText` 当前确实未检查 store.save 返回值，本次未改。历史“下次 onShow 自纠正”只适用小程序，不能套用网页所有场景 |
| 已处理 E-a | CI 文档与配置触发范围不一致 | 本次已澄清只在 main push/PR 测试；没有扩大 workflow，也没有建立 Pages 发布门禁 |
| 待规划 3.0 | 云开发、共享商户状态、多设备同步/订阅提醒未开工 | 属新功能、成本/隐私选择；先获得用户需求和决定，不按旧路线自动实现 |
| 接管交付 | 文档已本地保存，未提交/发布 | 可以在本目录新聊天继续；之后按用户授权保存 Git 提交和安排发布，勿因文档接管顺手 push |

## 规则、记忆与历史冲突登记

| 来源/冲突 | 核验与当前处理 |
|---|---|
| 适用规则 | 接管前根目录/适用文件系统父目录未发现 AGENTS.md/CLAUDE.md；`~/.codex/AGENTS.md` 与用户本轮规则已读。现在新增根 AGENTS，未删除或替换 Claude 规则文件 |
| 旧中文路径、拷贝接管 | 历史会话确在旧路径；当前继续维护英文主工作区，不执行旧克隆/远端改名要求。原文保留、顶端标注 |
| 31/38/43 项测试、1.0.17 硬编码示例 | 历史阶段基线；本次为 48 项、APP_VERSION 1.0.22，不自动重写各历史段落 |
| 架构早期 repaid/“小程序将来”模型 | 早期设计；当前分账模型和已实现小程序以上方代码核验为准 |
| 备案仍进行中、附录“未发布” vs 已发布记录 | 旧文档内有冲突；2026-08-07 发布有更晚历史记录支持，现时后台仍未查，不选一个旧表格冒充当前 |
| P0/P1 零发现 vs 后续 P1 TDZ | 前者仅当时四批审查结果，不能当“全历史无 P1”；后续真实 P1 与 saveCard 审错已更正并保留 |
| Claude 自动 push/upload/狗不理记忆 vs 当前边界 | 旧项目记忆确记有长期例行部署授权；本次用户明确只做本地可逆整理，2026-10-02 狗不理不新增 push/部署授权。冲突单列保留，未把旧授权升级为本次发布指令。今后按当轮覆盖具体动作的明确授权处理；不自行修改记忆中的约定 |
| Claude “更新 memory” vs Codex 自动记忆规则 | 不手工改 Codex 自动生成记忆，所有核实内容落在仓库文件；本次也未改 Claude 记忆 |

本项目 Claude 记忆源：`~/.claude/projects/-Users-yangqiuyuan-Coding-credit-card-repay/memory/` 的 MEMORY/cardcycle-app/goubuli-wrapup/prefers-autonomous-completion/verify-with-real-data/report-done-vs-pending/prefers-visual-mockups。已提炼有效内容，保留原文件；没有复制原始聊天、个人流水或凭据。

聊天导入与规则/记忆迁移是三个独立问题：本次检查 `~/.codex/external_agent_session_imports.json`、`claude-cowork-import-history.json` 和只读 state_5.sqlite，按新旧路径、项目名及 9 个 Claude 会话 ID 未找到本项目匹配导入记录。数据库能确认当前 Codex 聊天绑定正确目录；它不能证明旧会话从未导入或从未参与。Codex 全局记忆索引也未找到此项目专有条目，自动记忆是否完整导入无法证明。根 AGENTS、HANDOFF 与本文件现在承担持续上下文入口，开新聊天不需访问旧助手的自动记忆才能开工。
