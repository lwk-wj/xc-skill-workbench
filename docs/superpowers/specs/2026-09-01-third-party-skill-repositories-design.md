# 第三方 Skill 仓库设计

## 背景与目标

XC Skills Desktop 当前只把一个中央仓库作为可安装资源来源。CLI 虽然可以从任意 Git URL 临时下载并安装，但临时目录会在安装后删除，桌面端无法继续浏览该仓库、识别安装来源或判断更新。

本功能增加持久登记的第三方 Git 仓库。用户可以在侧边栏添加仓库、浏览其中的 Skills、手动拉取更新，并把具体 Skill 安装或更新到项目及全局 Agent 目录。中央仓库的配置和行为保持不变。

V1 只管理 Skills，不扩展第三方 Rules、Workflows、自动更新、凭据存储、发布能力或多版本并存。

## 用户体验

左侧栏新增“第三方仓库”分区和添加按钮。每个仓库是独立资源来源，仓库菜单提供拉取更新、编辑和移除。

添加仓库弹窗包含 Git URL、可选显示名称和可选分支。分支为空时读取远端默认分支。应用必须先完成拉取与扫描，显示识别到的仓库布局和 Skill 数量，随后才保存登记。支持使用系统现有 Git 凭据访问 HTTPS、SSH 和 `git@` 地址，但不读取或保存账号密码。

仓库页面显示名称、分支、最近拉取时间和“拉取更新”操作。标准仓库显示分组筛选；单 Skill 仓库不显示分组筛选。详情抽屉、预览、源码、文件和安装状态复用现有界面。

第三方远程仓库只提供复制安装。刷新只重新计算状态，不自动更新项目。内容变化显示“可更新”，用户选择具体项目、全局范围和 Agent 后手动更新。

目标路径已有不同来源的同名 Skill 时默认阻止安装。用户必须选择“替换现有来源”，并在二次确认中看到原来源、新来源和受影响路径。删除仓库只删除登记和应用缓存，已安装 Skill 保留并显示“来源已移除”；卸载和冻结仍可用，更新禁用，并提供重新关联已登记仓库的入口。

## 数据模型与迁移

`DesktopState` 从 V1 升级到 V2。读取 V1 时进行内存迁移并在下一次写入时保存 V2；已有项目、Agent、启用状态、主题、窗口尺寸和最后访问来源必须原样保留。

```ts
interface ThirdPartyRepository {
  id: string
  name: string
  url: string
  branch: string
  layout: 'catalog' | 'single-skill'
  createdAt: string
  lastFetchedAt: string | null
}

interface InstallationSourceRecord {
  id: string
  scope: 'project' | 'global'
  projectId: string | null
  agentId: string
  targetPath: string
  asset: { type: 'skills'; group: string; name: string }
  source: {
    kind: 'central' | 'third-party'
    repositoryId: string | null
    repositoryName: string
    repositoryUrl: string | null
  }
  installedCommit: string | null
  installedHash: string
}
```

安装来源记录以规范化的 `scope + projectId + agentId + targetPath` 唯一。仓库名称和 URL 快照保留在安装记录中，因此仓库登记被移除后仍能解释来源。仓库缓存路径、凭据和任意用户文件路径不得写入 Renderer 可控状态。

`SourceSelection` 增加 `{ kind: 'third-party'; repositoryId: string }`。旧安装没有来源记录时继续使用当前中央仓库名称/分组匹配逻辑，不自动猜测第三方来源。

## 仓库与扫描架构

每个第三方仓库使用应用数据目录中的独立缓存根和独立并发锁。远端解析复用 Core 的 Git 参数执行与分支缓存能力，但第三方配置不写入中央仓库配置文件。URL 与分支组合必须唯一；编辑仓库保留稳定 ID。

添加和刷新采用发布式缓存更新：先在临时缓存完成拉取、检出和扫描，验证成功后再替换当前可见缓存。刷新失败且已有缓存时返回陈旧缓存并记录错误；首次添加失败时不保存仓库。

`xc-skills/core.scanAssets` 扩展布局参数：

```ts
scanAssets({
  root,
  types: ['skills'],
  layout: 'auto' | 'catalog' | 'single-skill',
  sourceName?: string,
})
```

`auto` 先识别标准 XC 目录；仓库根存在有效 `SKILL.md` 时识别为单 Skill 仓库。单 Skill 名称优先取 frontmatter 的合法 `name`，否则使用登记仓库名称。无论布局如何，资产都必须由 Core 扫描器生成可信 provenance，后续详情、哈希和操作计划不得接受 Renderer 伪造路径。

仓库内指向缓存根之外的软链接视为无效资源。读取文本、二进制和大小限制继续沿用现有 Core 规则。

## IPC 与服务边界

Preload 暴露第三方仓库的最小声明式接口：

```ts
thirdPartyRepositories.list()
thirdPartyRepositories.add({ url, name?, branch? })
thirdPartyRepositories.update(id, { url, name?, branch? })
thirdPartyRepositories.remove(id)
thirdPartyRepositories.refresh(id)
thirdPartyRepositories.relinkInstallation({ installationId, repositoryId, assetId })
```

Renderer 不能指定缓存目录、Git 命令、删除路径或安装来源路径。Main 负责验证 URL、分支、仓库 ID、缓存所有权和资产目录。

资产扫描、详情和操作请求通过新增的 `third-party` SourceSelection 选择仓库。CoreService 的计划登记除 `OperationPlan` 外还保存经过解析的操作请求、来源仓库、目标位置和安装来源快照。只有操作结果为 `completed` 时才原子更新来源登记：

- install/update/replace：写入或替换来源记录；
- uninstall：删除来源记录；
- freeze/thaw：保留来源记录；
- cancelled/rolled_back/needs_attention：不修改来源记录。

项目或全局列表发起更新时，Main 先按目标位置读取来源登记，再从对应第三方缓存解析同一 Skill。禁止退回中央仓库同名猜测。重新关联只在已安装内容哈希与所选来源内容哈希一致时更新登记，不修改文件；内容不一致时必须改走显式更新或替换流程。

状态增加 `source_unavailable`。当仓库已移除、没有可用缓存且刷新失败，或来源仓库不再包含该 Skill 时使用该状态。凭据失效但仍有有效缓存时继续展示缓存与上次可计算状态，同时标记仓库为陈旧。仓库存在且内容不同则继续使用 `update_available` 或 `locally_modified`。

## 安全、冲突与生命周期

- Git 调用只使用参数数组，不拼接 Shell 命令；分支沿用现有安全 ref 校验。
- 不保存 Git 密码、Token 或私钥；认证完全交给系统 Git 环境。
- 仓库缓存删除必须验证真实路径位于应用管理的第三方缓存根内。
- 同一仓库重复刷新合并为一个任务；不同仓库可以并行刷新。
- 活跃操作计划引用仓库时禁止编辑或移除该仓库。
- 更新执行前重新验证提交、资产 provenance 和内容哈希；变化时以 `SOURCE_CHANGED` 终止且不修改目标。
- 同一 Agent 目标路径已有不同来源登记或未登记内容时返回来源冲突；只有显式 `replaceExistingSource` 和二次确认才能覆盖。
- Markdown 继续经过现有净化与外链处理，第三方内容不能执行脚本或发起 Renderer 导航。

## 测试与验收

Core 与 Main：

- 扫描标准仓库和根目录单 Skill 仓库，验证名称回退、非法资源和软链接逃逸。
- 添加时自动识别默认分支、布局和 Skill 数；重复 URL/分支被拒绝。
- 刷新成功原子发布新缓存；失败时使用旧缓存；首次失败不写状态。
- V1 状态无损迁移到 V2，安装来源唯一键和仓库快照通过校验。
- 安装、更新、替换、卸载、冻结、解冻及回滚分别验证来源登记的提交规则。
- 第三方来源更新不匹配中央同名 Skill；仓库移除返回 `source_unavailable`。
- 仓库缓存删除、路径越界、危险分支、伪造仓库 ID 和跨窗口操作被拒绝。

Renderer 与端到端：

- 添加、验证、编辑、刷新和移除第三方仓库；侧边栏来源切换正确。
- 标准仓库显示分组，单 Skill 仓库不显示无意义筛选。
- 拉取新提交后显示“可更新”，不会自动修改项目文件。
- 手动更新只影响选中的项目、Agent 和 Skill。
- 同名来源冲突默认阻止，确认替换后来源标签和状态同步更新。
- 移除仓库后已安装文件保留，更新禁用，卸载/冻结可用，重新关联可恢复更新。
- 使用临时本地 Git 远端覆盖标准仓库与单 Skill 仓库的完整添加、安装、提交更新、刷新和手动更新流程。

## 交付顺序

实现跨两个代码库：先在 `xc-skills/core` 增加可信的单 Skill 布局扫描及测试，构建新的本地依赖；再在 Desktop 中完成 V2 状态、缓存服务、IPC、来源登记、界面与端到端测试。中央仓库与旧安装流程必须在每一阶段保持通过。
