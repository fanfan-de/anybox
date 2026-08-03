---
name: godot-cli
description: 通过 godot-cli 命令检查并安全控制已打开的 Godot 4.6 编辑器中的场景。适用于查看编辑器状态、项目元数据、项目资源、可创建节点类型、引擎类 API、场景列表、当前及已打开场景、受限场景树、分页节点结构与实例状态、节点组、信号签名与连接、编辑器可见的节点或资源属性，以及执行经过明确确认的本地节点创建、删除、复制、PackedScene 实例化、持久用户组替换、简单持久信号连接或断开、已有 GDScript 附加、移动与重命名、场景生命周期操作、安全属性更改、已有白名单 Resource 赋值和白名单 SubResource 创建。
---

# Godot CLI

仅使用 CLI 作为连接 Godot 的桥梁。不要读取会话文件、建立原始 TCP 连接、暴露令牌，也不要虚构不受支持的工具。

## 选择可执行文件

在 Godot 项目根目录中，按以下顺序选择 CLI：

```powershell
$cliCandidates = @(
  '.\target\x86_64-pc-windows-msvc\release\godot-cli.exe'
  '.\.godot-cli\bin\godot-cli.exe'
)
$cli = $cliCandidates |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($cli)) {
  $command = Get-Command godot-cli -ErrorAction SilentlyContinue
  if ($null -ne $command) {
	$cli = $command.Source
  }
}
```

优先使用仓库的 release 构建，其次使用便携安装包中的 EXE，最后使用 `PATH` 中的 `godot-cli`。如果三者都不存在，停止操作并说明必须先构建或安装 CLI；不要修改系统 `PATH`。后续命令始终通过 `& $cli` 调用选中的可执行文件。

## 开始每个工作流

保持 Godot 编辑器处于打开状态并启用插件。使用结构化输出，并明确选择项目：

```powershell
& $cli --json --project . doctor
```

将非零退出码和 `"ok": false` 视为失败。日志应输出到 stderr；只解析 stdout 中唯一的 JSON 对象。

## 读取编辑器状态 

使用作用域最小的领域命令：

```powershell
& $cli --json --project . project info
& $cli --json --project . scene current
& $cli --json --project . scene tree --depth 4 --max-nodes 500
& $cli --json --project . scene list-project
& $cli --json --project . scene list-open
& $cli --json --project . resource list --extension png,svg
& $cli --json --project . resource inspect res://game/assets/player.png
& $cli --json --project . class search-nodes camera --base-type Node3D
& $cli --json --project . class api Node2D --section properties --filter position
& $cli --json --project . node list . --group actors --limit 200
& $cli --json --project . node groups get Player
& $cli --json --project . node signals get Player --signal health_changed
& $cli --json --project . node get Player --fields visible,process_mode
```

契约未知时，在使用通用 `tool-call` 前先使用 `tools list`、`tools search` 和 `tools schema`。通过 `--args-json` 或 `--args-file` 以对象形式传递通用参数。绝不要把 `apply` 放入该对象。

## 安全创建本地节点

只有在用户明确批准具体父路径、类型和名称后才能创建节点。

1. 读取当前场景，并用 `node list` 核验父节点、owner 边界和同级名称。
2. 必要时先用 `class search-nodes` 确认精确的运行时 ClassDB 节点类型。
3. 调用 `node create`，单独传入 `--apply`。
4. 再次用 `node list` 核验路径、类型、父路径、`owner_path="."` 和 `editable=true`，并检查 `scene current`。
5. 报告节点已进入 UndoRedo、场景仍未保存且磁盘没有被隐式修改。

```powershell
& $cli --json --project . node create . `
  --type Node2D `
  --name Player `
  --apply
```

父路径 `.` 表示场景根。其他父节点必须由当前场景根直接拥有；实例场景根若由当前场景根拥有可以作为父节点，但实例内部由其他 owner 拥有的节点不可写。类型必须已启用、可实例化、属于运行时 `core` 或 `extension` API 且继承 `Node`；项目脚本 `class_name`、资源和编辑器专用类型不接受。同一父节点下的普通或 internal 直接子节点只要存在完全相同的名称，创建就会失败，不会自动改名。

## 安全复制本地节点

只有在用户明确批准源路径和精确新名称后才能复制节点子树。

1. 用 `node list` 核验源节点、父节点、owner、全部直接同级名称，以及源普通子树中的 owner 与实例边界。
2. 确认源节点和父节点都在当前场景的本地 owner 边界，源节点不是场景根或实例内部节点。
3. 调用 `node duplicate`，单独传入 `--apply`；新名称不会自动生成、规范化或补数字。
4. 再次用 `node list` 核验复制节点紧跟源节点、普通子树路径、脚本可读属性、场景 owner 和实例内部 owner。
5. 检查 `scene current`，报告动作已进入 UndoRedo、场景尚未保存且磁盘场景文件没有变化。

```powershell
& $cli --json --project . node duplicate Player `
  --name PlayerCopy `
  --apply
```

复制使用 Godot 的默认 `Node.duplicate()` 语义：递归复制普通子节点、序列化属性、脚本、持久信号和组，并复用 PackedScene 实例化；internal child 不会复制。普通子树中的 owner 必须指向当前场景根或子树内普通祖先；未拥有节点和跨边界 owner 会被拒绝。节点路径会形成新的并行子树，但脚本字符串、外部 `NodePath`、动画轨道等引用不会被全局重写。Resource 属性通常继续共享原资源；若目标属性和类型落在 v0.6 白名单内，可在复制后经用户明确批准创建新的 SubResource 或赋入另一个已有资源。任何脚本、类型、实例路径或 owner 映射无法可靠保留时，整次操作会失败。

## 安全实例化已有场景

只有在用户明确批准父路径、源 PackedScene 路径以及可选精确实例名后才能实例化场景。

1. 读取 `scene current`，确认当前场景路径；用 `node list` 核验父节点位于本地 owner 边界并检查全部直接同级名称。
2. 确认源路径是已有的规范项目内 `.tscn` 或 `.scn`，且不是当前场景，也不会通过嵌套实例或继承把当前场景带回自身。
3. 调用 `node instantiate`，单独传入 `--apply`。省略 `--name` 会保留 PackedScene 根名；只有用户明确要求名称覆盖时才传入该选项。
4. 再次用 `node list` 核验实例路径、父路径、根 `owner_path="."`、实例内部 owner 与源场景路径，并检查 `scene current`。
5. 报告动作已进入 UndoRedo、场景仍未保存且磁盘场景文件没有变化。

```powershell
& $cli --json --project . node instantiate World `
  --scene res://actors/Enemy.tscn `
  --name EnemyOne `
  --apply
```

父节点必须是场景根或由场景根拥有，实例内部节点不可作为父节点。工具使用 Godot 编辑器实例化状态，实例根 owner 设为当前场景根，普通后代 owner 必须保持在实例子树内部。`SCENE_DEPENDENCY_CYCLE` 表示源场景的真实实例或继承图包含当前场景；不要通过改名或重试绕过。普通或 internal 同级名称冲突不会自动补数字。Undo/Redo 保持同一实例及内部 owner；实例化不会创建、覆盖或保存源场景文件。

## 安全附加已有 GDScript

只有在用户明确批准目标节点路径和已有脚本路径后才能附加脚本。

1. 读取 `scene current`，并用 `node list <PATH>` 核验目标是场景根或 `owner_path="."`、`editable=true` 的本地节点；实例内部节点不可写。
2. 直接检查项目内 `.gd` 文件，确认精确 `res://` 路径、`extends` 基类以及 `_init()`、`@tool` 等可能在编辑器内运行的代码。不要仅凭文件名推断安全性。
3. 调用 `node attach-script`，单独传入 `--apply`。该工具不会替换已有脚本；遇到 `SCRIPT_ALREADY_ATTACHED` 时停止并报告。
4. 核验返回的 `path`、`node_type`、`script_path`、`script_base_type`、`script_global_name`、`script_tool` 和 `scene_unsaved`，并根据脚本公开属性使用 `node get` 复查节点。
5. 报告附加关系已进入 UndoRedo、场景仍未保存，且场景文件和脚本文件都没有被隐式修改。

```powershell
& $cli --json --project . node attach-script Player `
  --script res://scripts/player.gd `
  --apply
```

首版只接受已有、规范项目路径中的 `.gd`。抽象脚本返回 `SCRIPT_NOT_INSTANTIABLE`，目标不继承脚本原生基类时返回 `SCRIPT_BASE_TYPE_MISMATCH`。普通非 `@tool` 脚本在编辑器中可能由 Godot 作为占位脚本实例附加，这不影响场景保存关系。`Object.set_script()` 会实例化脚本并可能调用 `_init()`；Undo/Redo 只保证恢复脚本附加关系和同一节点，不要声称 `_init()`、`@tool` 或其他项目代码造成的外部副作用可撤销。

## 安全删除本地节点

只有在用户明确批准具体目标路径及其整棵普通子树后才能删除。删除不会保存场景，但会让目标路径立即从编辑器场景树中消失。

1. 用 `node list <PATH> --limit 1000` 检查目标及普通子树，并单独检查父节点、owner、实例边界和同级索引；结果截断时不要删除。
2. 确认目标不是场景根，目标及父节点都在当前场景的本地 owner 边界；实例内部节点不可写。
3. 向用户明确说明将删除的根路径和子树范围；只有请求或批准已经覆盖该具体删除时，才调用 `node delete` 并单独传入 `--apply`。
4. 再次用 `node list` 确认旧路径返回 `NODE_NOT_FOUND`，并用 `scene tree` 核验其余同级顺序及 `scene current` 的未保存状态。
5. 报告动作已进入 UndoRedo、删除节点仍由历史保留以便恢复，且磁盘场景文件没有被隐式修改。

```powershell
& $cli --json --project . node list Player --limit 1000
& $cli --json --project . node delete Player --apply
```

工具只移除普通子树根与父节点的连接，不调用 `free()` 或 `queue_free()`。Undo 会重新挂载同一节点实例、恢复原普通同级索引，并按预检 owner 图恢复当前场景 owner 与子树内部实例 owner；Redo 再次移除同一实例。普通子树中存在未拥有节点、owner 指向删除边界外或依赖 internal owner 时会拒绝。internal child 会随同一个根节点对象一起保留和恢复，但不计入 `subtree_node_count`。不要把“可撤销”当作保存或备份；如果随后清空 Undo 历史，被删除的孤立节点可由 Godot 释放。

## 安全移动本地节点

只有在用户明确批准目标路径、新父路径和最终普通子节点索引后才能移动或排序节点。

1. 用 `node list` 核验目标、新父节点、两侧 owner 边界、目标名称、新父节点的全部直接子节点和当前普通同级索引。
2. 确认目标不是场景根，目标与新父节点均本地可编辑，新父节点不是目标自身或其后代；实例内部节点不可写。
3. 根据最终普通子节点序列计算 `--index`。跨父追加可使用目标父节点移动前的普通子节点数量；同父排序最大为当前普通子节点数减一。
4. 调用 `node move`，单独传入 `--apply`。
5. 再次用 `node list` 核验新路径、父路径、owner、索引、子树路径和旧路径是否消失，并检查 `scene current`。
6. 报告动作已进入 UndoRedo、场景尚未保存，磁盘场景文件没有被隐式修改。

```powershell
& $cli --json --project . node move Player `
  --parent World `
  --index 0 `
  --apply
```

跨父移动会请求 Godot 保持受支持节点的全局变换。同父节点、同索引的 no-op，循环、普通或 internal 同级重名、越界索引和非本地 owner 都会被拒绝。移动会改变目标和子树路径；不要假定脚本字符串或全部 `NodePath`、动画轨道引用会被自动改写，操作前后都要核验依赖。

## 安全重命名本地节点

只有在用户明确批准具体目标路径和新名称后才能重命名节点。

1. 用 `node list` 核验目标、父节点、owner、同级名称和当前子树路径。
2. 确认目标不是场景根，且 `owner_path="."`、`editable=true`；实例内部节点不可写。
3. 调用 `node rename`，单独传入 `--apply`。
4. 再次用 `node list` 核验新路径、子树路径、父节点、owner 和同级索引，并检查旧路径已不存在及 `scene current` 仍为未保存。
5. 报告该动作已进入 UndoRedo，场景尚未保存，磁盘场景文件没有被隐式修改。

```powershell
& $cli --json --project . node rename Player `
  --name Hero `
  --apply
```

新名称不会 trim、替换、规范化或自动补数字。场景根、非法名称、与当前名称相同的 no-op、普通或 internal 同级精确重名，以及非本地 owner 目标都会被拒绝。

## 安全更改持久节点组

只有在用户明确批准目标节点和完整持久用户组集合后才能写入。

1. 用 `node list <PATH>` 核验目标的 `owner_path` 和 `editable`，再用 `node groups get <PATH>` 读取当前用户组、持久组、运行时组和内部组。
2. 将期望的完整持久用户组集合转换为 JSON 字符串数组；最多 128 个唯一名称，不接受空名称、超过 128 字符或 `_` 开头的内部名称，新旧集合并集也不能超过 128 项。
3. 调用 `node groups set`，单独传入 `--apply`。`[]` 表示清空全部持久用户组，不能把它当作“未提供”。
4. 再次调用 `node groups get`，并按需用 `node list . --group <GROUP>` 核验成员；同时检查 `scene current`。
5. 报告整组变更共用一个 UndoRedo 动作、运行时与内部组被保留、场景仍未保存且磁盘文件未被隐式修改。

```powershell
& $cli --json --project . node groups get Player
& $cli --json --project . node groups set Player `
  --groups-json '["actors","controllable"]' `
  --apply
& $cli --json --project . node list . --group controllable
```

`persistent_groups` 表示当前编辑场景会保存的组，而不是实例来源场景的可写承诺。实例内部节点虽然可读取组状态，但不可用 `node groups set` 修改。写入会保留无关运行时组和全部 `_` 内部组；已有运行时同名组可被提升为持久组。幂等请求成功但不会创建空动作或改变未保存状态。

## 安全管理信号连接

读取信号不需要确认。先用精确信号过滤检查参数签名、实时连接和当前场景持久性：

```powershell
& $cli --json --project . node signals get Player `
  --signal health_changed
```

`persistent=true` 只表示实时连接带 `CONNECT_PERSIST` flag；只有 `current_scene_persistent=true` 才表示当前编辑场景的内存打包状态存储同一连接。`simple=true` 进一步表示 source/target 都本地可编辑、Callable 是普通方法、没有 bind/unbind 或高级 flags，因而处于写工具支持范围。

只有在用户明确批准精确 source、signal、target 和 method 后才能连接或断开：

1. 用 `node list` 核验 source 和 target 均为场景根或 `owner_path="."`、`editable=true` 的本地节点；实例内部节点不可写。
2. 用 `node signals get <SOURCE> --signal <SIGNAL>` 检查信号参数、已有 endpoint 和持久状态；目标方法必须已存在并与信号参数兼容。
3. 调用 `node signals connect` 或 `node signals disconnect`，单独传入 `--apply`。
4. 再次读取同一信号，核验 source/target/method、`flags=2`、`current_scene_persistent`、`simple` 和连接数量，并检查 `scene current`。
5. 报告操作已进入一个 UndoRedo 动作、场景仍未保存且磁盘场景文件未被隐式修改。

```powershell
& $cli --json --project . node signals connect Player `
  --signal health_changed `
  --target Hud `
  --method _on_player_health_changed `
  --apply

& $cli --json --project . node signals disconnect Player `
  --signal health_changed `
  --target Hud `
  --method _on_player_health_changed `
  --apply
```

首版固定创建无 bind、unbind、deferred、one-shot、reference-counted 或 append-source 标志的单一 `CONNECT_PERSIST` 连接。已有 endpoint 不会重复连接；断开不会修改仅运行时、高级或打包/实时状态不一致的连接。遇到 `SIGNAL_CONNECTION_NOT_PERSISTENT`、`SIGNAL_CONNECTION_UNSUPPORTED` 或 `SIGNAL_CONNECTION_INCONSISTENT` 时停止并报告，不要通过通用调用猜测 flags 或绕过限制。持久连接仍只存在于编辑器内存，直到用户另行批准 `scene save --apply`。

## 安全更改单个属性

只有在用户明确请求或批准具体的属性更改后才能写入。

1. 读取当前场景和目标属性。
2. 确认相对节点路径、属性、旧值和请求的新值。
3. 调用 `node set`，单独传入 `--apply` 标志，并明确指定 `--project`。
4. 再次读取该属性，并检查 `scene current`。
5. 报告 Godot 实际返回的值，并说明场景尚未保存。

```powershell
& $cli --json --project . node set Player `
  --property speed `
  --value-json 24.5 `
  --apply

& $cli --json --project . node set Player `
  --property position `
  --value-json '{"type":"Vector2","value":[100.0,64.0]}' `
  --apply
```

标量 JSON 保持原样。`Vector2/Vector2i`、`Vector3/Vector3i`、`Color` 和 `Rect2/Rect2i` 必须使用精确的 `{"type":"类型名","value":[分量...]}` 对象；类型名区分大小写，整数分量必须是安全整数，浮点分量必须有限。先用 `node get` 核验 `type`、`hint`、`hint_string`、`read_only` 和 `value_supported`。Transform、`NodePath`、资源、数组和 Dictionary 不通过通用 `node set` 写入；Resource 必须使用下方专用工作流。

未经用户确认，绝不要仅为重试 `APPLY_REQUIRED` 错误而添加 `--apply`。属性写入会记录到编辑器的 UndoRedo 历史中，并使场景保持未保存状态，直到用户另行批准执行 `scene save`。不要声称任意 `@tool` setter 的副作用都可撤销。

## 安全组合资源

读取资源无需确认，但只观察 EditorFileSystem 当前快照，不得为了让结果出现而自动发起重扫：

```powershell
& $cli --json --project . resource list `
  --search-path res://game/assets `
  --extension png,svg `
  --limit 200
& $cli --json --project . resource inspect `
  res://game/assets/player.png
```

继续分页时使用 `next_cursor`；改变目录、类型或扩展名后从 `cursor=0` 开始。外部文件由用户或 Agent 有意创建/修改后，先说明需要更新编辑器快照，只有获得该具体写操作授权后才运行 `game rescan --apply --wait`，再重新读取资源。

已有资源赋值工作流：

1. 用 `node get <PATH> --fields <PROPERTY>` 核验目标节点、owner、属性声明类型和只读状态。
2. 用 `resource inspect <RESOURCE_PATH>` 核验实际类型、导入状态、`assignable=true`、`assignment_family` 和非脚本化状态。
3. 确认属性与资源落在同一白名单族，并向用户明确说明只改变场景内存中的引用、不会修改资源文件或保存场景。
4. 用户明确请求或批准该具体赋值后，调用 `node assign-resource ... --apply`。
5. 再次读取节点属性、当前场景和必要的资源信息，核验返回类型、路径、`changed` 与 `scene_unsaved`。

```powershell
& $cli --json --project . node assign-resource Player/Sprite2D `
  --property texture `
  --resource res://game/assets/player.png `
  --apply
```

外部赋值只接受 `Texture2D`、`Shape2D`、`AudioStream`、`Font`、`Theme`、`StyleBox` 和 `PackedScene` 七个声明族。通用 `Resource` 属性、Script、自定义脚本资源、实例附带脚本和跨族类型必须停止并报告；不要改用 `tool-call` 绕过 `RESOURCE_TYPE_UNSUPPORTED`、`RESOURCE_TYPE_MISMATCH` 或 `RESOURCE_SCRIPTED_UNSUPPORTED`。重复赋同一实例的 `changed=false` 是幂等成功。

创建 SubResource 工作流：

1. 先读取目标属性，确认它是本地节点上的具体 Resource 属性。
2. 只选择 `RectangleShape2D`、`CircleShape2D`、`CapsuleShape2D`、`SegmentShape2D` 或 `StyleBoxFlat`。
3. 可选初始属性最多 32 项且名称唯一；值只使用既有安全标量和精确带类型编码。不得设置 `script`、`resource_path` 或 `resource_scene_unique_id`。
4. 用户明确批准类型、目标属性和完整初始值后，调用一次 `node create-subresource ... --apply`。
5. 核验 `embedded=true`、`changed=true`、配置后的实际值、目标属性和 `scene_unsaved=true`。

```powershell
$properties = @(
  @{
	property = 'size'
	value = @{ type = 'Vector2'; value = @(32.0, 48.0) }
  }
)
$propertiesJson = ConvertTo-Json -InputObject $properties -Compress -Depth 8

& $cli --json --project . node create-subresource Player/CollisionShape2D `
  --property shape `
  --type RectangleShape2D `
  --properties-json $propertiesJson `
  --apply
```

两个资源写工具各自只创建一个场景 UndoRedo 动作，Undo/Redo 应保持同一个 Resource 实例。它们绝不创建、覆盖或修改 `.tres`、`.res` 等外部资源文件，也不隐式重扫或保存；持久化仍需要用户另行批准 `scene save --apply`。

## 安全批量更改属性

只有在用户明确请求或批准整组具体属性更改后才能使用批量写入。

1. 用 `node get` 分别读取全部目标属性，确认规范路径、owner、当前值、`read_only=false` 和 `value_supported=true`。
2. 构造 `1..128` 个 `{path,property,value}` 对象；同一节点属性只能出现一次，不要混入结构、资源、信号或保存操作。
3. 调用 `node set-batch`，只在命令级单独传入一次 `--apply`。
4. 核验返回的 `change_count`、`node_count`、逐项实际值和 `scene_unsaved=true`，再重新读取全部目标属性。
5. 报告整批共用一个 UndoRedo 动作，场景尚未保存，磁盘文件未被隐式修改。

```powershell
$changes = @(
  @{ path = 'Player'; property = 'speed'; value = 24.5 }
  @{
	path = 'Player'
	property = 'position'
	value = @{ type = 'Vector2'; value = @(100.0, 64.0) }
  }
)
$changesJson = ConvertTo-Json -InputObject $changes -Compress -Depth 8

& $cli --json --project . node set-batch `
  --changes-json $changesJson `
  --apply
```

插件会在创建历史动作前完整预检所有条目；空批次、超过 128 项、路径/owner/属性/类型错误、无法安全表示的旧值或重复节点属性对都会让整批保持零属性写入。成功时按请求顺序执行 Setter，Undo 反向恢复旧值。项目属性列表、Getter、Setter 或 `@tool` 代码可能产生文件、网络等外部副作用，这些副作用不属于属性原子性或 UndoRedo 保证。

## 安全更改场景生命周期

- 将 `create_scene`、`save_scene`、`open_scene` 和 `close_scene_tab` 视为写入操作，分别需要 `--apply` 确认。
- 创建场景或另存为之前，检查准确的 `res://` 路径。`create_scene` 会拒绝已有文件；`save_scene --overwrite` 需要用户明确批准覆盖该目标。
- 打开场景之前，核验当前场景和请求的项目内场景路径。操作后重新读取 `scene current` 和 `scene list-open`。
- 关闭场景之前，检查 `scene list-open`。除非用户明确批准放弃该场景的未保存更改，否则绝不要传入 `--discard-unsaved`。
- 保存后，核验返回的路径以及 `scene_unsaved=false`。

```powershell
& $cli --json --project . scene create res://scenes/Main.tscn `
  --root-type Node2D `
  --apply
& $cli --json --project . scene open res://scenes/Main.tscn --apply
& $cli --json --project . scene save --apply
& $cli --json --project . scene close --apply
```

## 安全运行与观察项目

- 将 `game run`、`game stop` 和 `game rescan` 视为写入操作；先核验目标，再在用户明确请求或批准后传 `--apply`。
- 运行前先执行 `scene list-open` 与 `game status`。任一场景未保存时不要运行；需要保存时必须把保存作为单独批准的 `scene save --apply` 操作。
- 主场景使用 `--main`，当前场景使用 `--current`，指定场景使用唯一的 `--scene res://...`；三者互斥，省略时等同 `--main`。
- `--wait` 和 `--follow` 由 Rust CLI 轮询，插件处理器不会等待。按项目启动时间设置足够的全局 `--timeout-ms`，超时后重新读取状态，不要假设请求已撤销。
- 记录 `game run` 返回的 `run_id`，后续输出读取显式使用它。翻页时把上一页 `next_sequence` 作为新的 `--after`；若 `dropped_before_sequence` 前移，说明更早事件已被有界缓冲淘汰。
- 在 Agent 通过文件系统创建或修改脚本/资源后，使用 `game rescan --apply --wait` 请求编辑器发现变更；它不会修改文件内容或修复导入错误。
- 停止后核验 `state=stopped` 且 `playing=false`。未运行时 `game stop --apply --wait` 是幂等成功。

```powershell
& $cli --json --project . game status
& $cli --json --project . game run --main --apply --wait
& $cli --json --project . game output --run-id 1 --after 0 --limit 100
& $cli --json --project . game output --run-id 1 --follow
& $cli --json --project . game stop --apply --wait
& $cli --json --project . game rescan --apply --wait
```

## 记录 CLI 任务轨迹

只有在用户要求分析 CLI 执行过程时才建立项目级轨迹批次。`trace` 管理指令不连接编辑器，也不计入任务本身；普通指令 stdout 继续保持一个 JSON 对象。

```powershell
& $cli --json --project . trace start --label '任务名称'
# 执行需要观察的 CLI 指令
& $cli --json --project . trace status
& $cli --json --project . trace stop
```

向用户报告 `trace stop` 返回的 JSON 和 Markdown 路径。遇到 `TRACE_CAPTURE_BUSY` 时等待现有 CLI 进程结束后重试；除非用户接受将残留指令标记为中断，否则不要使用 `--force`。

## 遵守 v0.6 边界

- 只使用 `tools list` 发布的十六个读取工具和二十一个写入工具。
- 使用 `class search-nodes`、`class api`、`node list` 和 `resource list` 的 `next_cursor` 分页读取，并在基类、API 分区、继承选项、场景结构、资源快照或过滤参数变化后从 `cursor=0` 重新开始。
- `class api` 只查询 ClassDB 中的引擎类和 GDExtension 类；项目脚本的 `class_name` 不在该工具范围内。
- 使用 `.` 或普通的场景根节点相对路径；绝不要使用绝对路径、`..`、`%` 唯一名称、子名称或空路径段。
- 只写入与目标类型匹配的安全标量，或精确编码的 `Vector2/2i`、`Vector3/3i`、`Color`、`Rect2/2i`；不进行隐式类型转换。
- 资源只能通过两个专用写工具进入节点属性；不要创建/修改外部资源文件、编辑共享 Resource 内容、加载脚本化 Resource，或扩大资源族和 SubResource 类型白名单。
- 不要把运行观察扩展为 Autoload 探针、任意脚本或编辑器脚本执行、表达式求值、运行时方法调用、运行时节点增删改、输入模拟、动态调试前缀、MCP、HTTP、SSE、stdio 传输、插件内 `OS.execute`，或插件处理器中的等待循环。
- 不要添加后台或隐式场景保存、Node.js、C# 脚本附加或 GDExtension 行为。
- 当多个编辑器实例指向同一项目时，使用 `--pid`。

退出码：`2` 表示参数错误，`3` 表示会话、认证或版本错误，`4` 表示编辑器不可用，`5` 表示工具失败，`6` 表示缺少写入确认。
