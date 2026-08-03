class_name BridgeNodeTools
extends BridgeToolModule


func definitions() -> Array[BridgeToolDefinition]:
	return [
		_definition(
			"attach_script",
			"Attach one existing project GDScript through the editor UndoRedo history.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "Scene-root-relative path of the target node, or '.' for the root.",
					},
					"script_path": {
						"type": "string",
						"description": "Normalized res:// path of an existing .gd script.",
					},
				},
				"required": ["path", "script_path"],
				"additionalProperties": false,
			},
			_attach_script_schema(),
			"write",
			true,
			_attach_script
		),
		_definition(
			"batch_set_node_properties",
			"Set a bounded property batch through one editor UndoRedo action.",
			{
				"type": "object",
				"properties": {
					"changes": {
						"type": "array",
						"minItems": 1,
						"maxItems": BridgeConstants.MAX_BATCH_PROPERTY_CHANGES,
						"items": {
							"type": "object",
							"properties": {
								"path": {
									"type": "string",
									"description": (
										"A scene-root-relative node path, or '.' for the root."
									),
								},
								"property": {
									"type": "string",
									"description": (
										"An editor-visible, writable property name."
									),
								},
								"value": BridgeVariantCodec.encoded_value_schema(
									(
										"A scalar JSON value or an exact tagged Vector, "
										+ "Color, or Rect value."
									)
								),
							},
							"required": ["path", "property", "value"],
							"additionalProperties": false,
						},
						"description": (
							"One to 128 unique node-property assignments, applied in order."
						),
					},
				},
				"required": ["changes"],
				"additionalProperties": false,
			},
			_batch_set_node_properties_schema(),
			"write",
			true,
			_batch_set_node_properties
		),
		_definition(
			"create_node",
			"Create an undoable local Node beneath the current edited scene.",
			{
				"type": "object",
				"properties": {
					"parent_path": {
						"type": "string",
						"description": "Scene-root-relative parent path, or '.' for the root.",
					},
					"node_type": {
						"type": "string",
						"description": "Exact instantiable runtime ClassDB Node class.",
					},
					"node_name": {
						"type": "string",
						"description": "Exact unique name for the new direct child.",
					},
				},
				"required": ["parent_path", "node_type", "node_name"],
				"additionalProperties": false,
			},
			_create_node_schema(),
			"write",
			true,
			_create_node
		),
		_definition(
			"delete_node",
			"Delete one local scene subtree through the editor UndoRedo history.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "Scene-root-relative path of the node to delete.",
					},
				},
				"required": ["path"],
				"additionalProperties": false,
			},
			_delete_node_schema(),
			"write",
			true,
			_delete_node
		),
		_definition(
			"duplicate_node",
			"Duplicate one local scene subtree beside its source with an exact name.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "Scene-root-relative path of the node to duplicate.",
					},
					"new_name": {
						"type": "string",
						"description": "Exact unique name for the duplicated sibling.",
					},
				},
				"required": ["path", "new_name"],
				"additionalProperties": false,
			},
			_duplicate_node_schema(),
			"write",
			true,
			_duplicate_node
		),
		_definition(
			"get_scene_tree",
			"Read a bounded tree beneath the current edited scene root.",
			{
				"type": "object",
				"properties": {
					"depth": {
						"type": "integer",
						"minimum": 0,
						"maximum": BridgeConstants.MAX_SCENE_DEPTH,
						"default": BridgeConstants.DEFAULT_SCENE_DEPTH,
						"description": "Maximum depth below the scene root.",
					},
					"max_nodes": {
						"type": "integer",
						"minimum": 1,
						"maximum": BridgeConstants.MAX_SCENE_NODES,
						"default": BridgeConstants.DEFAULT_SCENE_NODES,
						"description": "Maximum number of nodes returned.",
					},
				},
				"additionalProperties": false,
			},
			_scene_tree_schema(),
			"read",
			false,
			_get_scene_tree
		),
		_definition(
			"instantiate_scene",
			"Instantiate one PackedScene beneath a local editable parent with UndoRedo.",
			{
				"type": "object",
				"properties": {
					"parent_path": {
						"type": "string",
						"description": "Scene-root-relative parent path, or '.' for the root.",
					},
					"scene_path": {
						"type": "string",
						"description": "Normalized res:// path of the PackedScene to instantiate.",
					},
					"node_name": {
						"type": ["string", "null"],
						"default": null,
						"description": "Optional exact unique root name; null preserves the PackedScene root name.",
					},
				},
				"required": ["parent_path", "scene_path"],
				"additionalProperties": false,
			},
			_instantiate_scene_schema(),
			"write",
			true,
			_instantiate_scene
		),
		_definition(
			"list_scene_nodes",
			"Query a paginated flat list of nodes in the current edited scene.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"default": ".",
						"description": "Subtree root path, or '.' for the scene root.",
					},
					"name": {
						"type": ["string", "null"],
						"default": null,
						"description": "Optional exact, case-sensitive node name filter.",
					},
					"type": {
						"type": ["string", "null"],
						"default": null,
						"description": "Optional built-in Node class or base class filter.",
					},
					"group": {
						"type": ["string", "null"],
						"default": null,
						"description": "Optional exact, case-sensitive user group filter.",
					},
					"depth": {
						"type": "integer",
						"minimum": 0,
						"maximum": BridgeConstants.MAX_NODE_LIST_DEPTH,
						"default": BridgeConstants.DEFAULT_NODE_LIST_DEPTH,
						"description": "Maximum depth below the selected subtree root.",
					},
					"limit": {
						"type": "integer",
						"minimum": 1,
						"maximum": BridgeConstants.MAX_NODE_LIST_LIMIT,
						"default": BridgeConstants.DEFAULT_NODE_LIST_LIMIT,
						"description": "Maximum number of matching nodes returned.",
					},
					"cursor": {
						"type": "integer",
						"minimum": 0,
						"maximum": BridgeConstants.MAX_NODE_LIST_CURSOR,
						"default": 0,
						"description": "Zero-based offset in the matching node sequence.",
					},
				},
				"additionalProperties": false,
			},
			_scene_nodes_schema(),
			"read",
			false,
			_list_scene_nodes
		),
		_definition(
			"get_node_groups",
			"Read current, persistent, runtime, and internal groups for one scene node.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "A scene-root-relative node path, or '.' for the root.",
					},
				},
				"required": ["path"],
				"additionalProperties": false,
			},
			_node_groups_schema(),
			"read",
			false,
			_get_node_groups
		),
		_definition(
			"get_node_properties",
			"Read editor-visible properties from a scene-root-relative node.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "A relative node path, or '.' for the scene root.",
					},
					"properties": {
						"type": ["array", "null"],
						"items": {"type": "string"},
						"default": null,
						"description": "Optional property name allowlist.",
					},
				},
				"required": ["path"],
				"additionalProperties": false,
			},
			_node_properties_schema(),
			"read",
			false,
			_get_node_properties
		),
		_definition(
			"move_node",
			"Move one local scene node to an exact parent and ordinary child index.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "Scene-root-relative path of the node to move.",
					},
					"new_parent_path": {
						"type": "string",
						"description": "Scene-root-relative destination parent, or '.' for the root.",
					},
					"child_index": {
						"type": "integer",
						"minimum": 0,
						"maximum": BridgeConstants.MAX_NODE_LIST_CURSOR,
						"description": "Exact final index among ordinary destination children.",
					},
				},
				"required": ["path", "new_parent_path", "child_index"],
				"additionalProperties": false,
			},
			_move_node_schema(),
			"write",
			true,
			_move_node
		),
		_definition(
			"rename_node",
			"Rename one local scene node through the editor UndoRedo history.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "Scene-root-relative path of the node to rename.",
					},
					"new_name": {
						"type": "string",
						"description": "Exact new node name without normalization.",
					},
				},
				"required": ["path", "new_name"],
				"additionalProperties": false,
			},
			_rename_node_schema(),
			"write",
			true,
			_rename_node
		),
		_definition(
			"set_node_groups",
			"Replace the persistent user groups of one local node with one UndoRedo action.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "A scene-root-relative node path, or '.' for the root.",
					},
					"groups": {
						"type": "array",
						"maxItems": BridgeConstants.MAX_NODE_GROUPS,
						"items": {"type": "string"},
						"description": "Exact persistent user group set; an empty array clears it.",
					},
				},
				"required": ["path", "groups"],
				"additionalProperties": false,
			},
			_set_node_groups_schema(),
			"write",
			true,
			_set_node_groups
		),
		_definition(
			"set_node_property",
			"Set one supported property through the editor UndoRedo history.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "A relative node path, or '.' for the scene root.",
					},
					"property": {
						"type": "string",
						"description": "An editor-visible, writable property name.",
					},
					"value": BridgeVariantCodec.encoded_value_schema(
						"A scalar JSON value or an exact tagged Vector, Color, or Rect value."
					),
				},
				"required": ["path", "property", "value"],
				"additionalProperties": false,
			},
			{
				"type": "object",
				"properties": {
					"path": {"type": "string"},
					"property": {"type": "string"},
					"value": BridgeVariantCodec.encoded_value_schema(),
					"value_type": {"type": "string"},
					"scene_unsaved": {"type": "boolean"},
				},
				"required": [
					"path",
					"property",
					"value",
					"value_type",
					"scene_unsaved",
				],
				"additionalProperties": false,
			},
			"write",
			true,
			_set_node_property
		),
	]


func _attach_script(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var resolved: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		str(arguments["path"])
	)
	if not resolved["ok"]:
		return resolved
	var target: Node = resolved["node"]
	if target != scene_root and target.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Target must be the scene root or a node owned by the scene root"
		)
	if target.get_script() != null:
		return _failure(
			"SCRIPT_ALREADY_ATTACHED",
			"Target already has a script attached"
		)

	var validated_path: Dictionary = BridgeScenePathGuard.validate_script_path(
		str(arguments["script_path"])
	)
	if not validated_path["ok"]:
		return validated_path
	var script_path: String = str(validated_path["path"])
	if not FileAccess.file_exists(script_path):
		return _failure(
			"SCRIPT_NOT_FOUND",
			"Script not found: " + script_path
		)

	var resource: Resource = ResourceLoader.load(script_path, "Script")
	if not (resource is GDScript):
		return _failure(
			"SCRIPT_LOAD_FAILED",
			"Resource is not a loadable GDScript: " + script_path
		)
	var script: Script = resource
	if script.is_abstract():
		return _failure(
			"SCRIPT_NOT_INSTANTIABLE",
			"Abstract scripts cannot be attached directly"
		)
	var script_base_type: String = str(script.get_instance_base_type())
	if script_base_type.is_empty() or not target.is_class(script_base_type):
		return _failure(
			"SCRIPT_BASE_TYPE_MISMATCH",
			(
				"Script base type '%s' is not compatible with target type '%s'"
				% [script_base_type, target.get_class()]
			)
		)

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)

	var target_path: String = _relative_node_path(scene_root, target)
	var target_parent: Node = target.get_parent()
	var target_owner: Node = target.owner
	var target_name: String = str(target.name)
	var target_type: String = target.get_class()
	var target_instance_id: int = target.get_instance_id()
	var target_child_index: int = -1
	if target_parent != null:
		target_child_index = target.get_index(false)
	var action_name: String = (
		BridgeConstants.PRODUCT_NAME
		+ ": Attach "
		+ script_path
		+ " to "
		+ target_path
	)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		false,
		true
	)
	undo_redo.add_do_method(target, "set_script", script)
	undo_redo.add_undo_method(target, "set_script", null)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	var scene_unsaved: bool = _context.is_scene_unsaved(scene_root)
	var postconditions_met: bool = (
		is_instance_valid(scene_root)
		and is_instance_valid(target)
		and target.get_instance_id() == target_instance_id
		and target.get_parent() == target_parent
		and target.owner == target_owner
		and str(target.name) == target_name
		and target.get_class() == target_type
		and _relative_node_path(scene_root, target) == target_path
		and scene_root.get_node_or_null(NodePath(target_path)) == target
		and target.get_script() == script
		and (target_parent == null or target.get_index(false) == target_child_index)
		and scene_unsaved
	)
	if not postconditions_met:
		if not _rollback_attached_script(
			undo_redo,
			scene_root,
			target,
			target_path,
			target_parent,
			target_owner,
			target_child_index,
			script,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Script attachment failed and could not be safely undone"
			)
		return _failure(
			"SCRIPT_ATTACH_FAILED",
			"Script attachment did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"path": target_path,
			"node_type": target_type,
			"owner_path": "" if target == scene_root else ".",
			"script_path": script_path,
			"script_base_type": script_base_type,
			"script_global_name": str(script.get_global_name()),
			"script_tool": script.is_tool(),
			"attached": true,
			"scene_unsaved": scene_unsaved,
		}
	)


func _rollback_attached_script(
	undo_redo: EditorUndoRedoManager,
	scene_root: Node,
	target: Node,
	target_path: String,
	target_parent: Node,
	target_owner: Node,
	target_child_index: int,
	script: Script,
	action_name: String
) -> bool:
	var history_id: int = undo_redo.get_object_history_id(scene_root)
	var history: UndoRedo = undo_redo.get_history_undo_redo(history_id)
	if (
		history != null
		and history.has_undo()
		and history.get_current_action_name() == action_name
	):
		if not history.undo():
			return false
	elif is_instance_valid(target) and target.get_script() == script:
		target.set_script(null)

	return (
		is_instance_valid(target)
		and target.get_script() == null
		and target.get_parent() == target_parent
		and target.owner == target_owner
		and _relative_node_path(scene_root, target) == target_path
		and scene_root.get_node_or_null(NodePath(target_path)) == target
		and (target_parent == null or target.get_index(false) == target_child_index)
	)


func _get_scene_tree(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	if scene_root == null:
		return _failure("SCENE_NOT_OPEN", "No scene is currently open")
	var max_depth: int = int(
		arguments.get("depth", BridgeConstants.DEFAULT_SCENE_DEPTH)
	)
	var max_nodes: int = int(
		arguments.get("max_nodes", BridgeConstants.DEFAULT_SCENE_NODES)
	)
	var state: Dictionary = {
		"count": 0,
		"truncated": false,
		"max_nodes": max_nodes,
	}
	var root_data: Dictionary = _serialize_tree_node(
		scene_root,
		scene_root,
		0,
		max_depth,
		state
	)
	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"root": root_data,
			"node_count": int(state["count"]),
			"truncated": bool(state["truncated"]),
			"depth": max_depth,
			"max_nodes": max_nodes,
		}
	)


func _list_scene_nodes(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var scope_path: String = str(arguments.get("path", "."))
	var resolved: Dictionary = BridgeNodePathGuard.resolve(scene_root, scope_path)
	if not resolved["ok"]:
		return resolved
	var scope_root: Node = resolved["node"]

	var name_filter: Variant = arguments.get("name", null)
	if name_filter != null and (
		str(name_filter).is_empty()
		or str(name_filter).length() > 128
	):
		return _failure(
			"INVALID_ARGUMENTS",
			"Node name filter must contain between 1 and 128 characters"
		)

	var type_filter: Variant = arguments.get("type", null)
	if type_filter != null:
		var filter_class: String = str(type_filter)
		if (
			filter_class.is_empty()
			or not ClassDB.class_exists(filter_class)
			or not ClassDB.is_parent_class(filter_class, "Node")
		):
			return _failure(
				"INVALID_ARGUMENTS",
				"Node type filter must be a built-in Node class"
			)

	var group_filter: Variant = arguments.get("group", null)
	if group_filter != null:
		var group_validation: Dictionary = _validate_user_group_name(
			group_filter,
			"Node group filter"
		)
		if not group_validation["ok"]:
			return group_validation

	var max_depth: int = int(
		arguments.get("depth", BridgeConstants.DEFAULT_NODE_LIST_DEPTH)
	)
	var limit: int = int(
		arguments.get("limit", BridgeConstants.DEFAULT_NODE_LIST_LIMIT)
	)
	var cursor: int = int(arguments.get("cursor", 0))
	var state: Dictionary = {
		"visited": 0,
		"matches": 0,
		"nodes": [],
		"has_more": false,
		"depth_truncated": false,
		"scan_truncated": false,
		"size_truncated": false,
		"result_bytes": 2,
		"stop": false,
	}
	_collect_scene_nodes(
		scope_root,
		scene_root,
		0,
		max_depth,
		name_filter,
		type_filter,
		group_filter,
		cursor,
		limit,
		state
	)

	var next_cursor: Variant = null
	if bool(state["has_more"]):
		next_cursor = cursor + (state["nodes"] as Array).size()
	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"scope_path": scope_path,
			"nodes": state["nodes"],
			"count": (state["nodes"] as Array).size(),
			"scanned": int(state["visited"]),
			"cursor": cursor,
			"limit": limit,
			"truncated": (
				bool(state["has_more"])
				or bool(state["depth_truncated"])
				or bool(state["scan_truncated"])
				or bool(state["size_truncated"])
			),
			"depth_truncated": bool(state["depth_truncated"]),
			"scan_truncated": bool(state["scan_truncated"]),
			"size_truncated": bool(state["size_truncated"]),
			"next_cursor": next_cursor,
		}
	)


func _collect_scene_nodes(
	node: Node,
	scene_root: Node,
	depth: int,
	max_depth: int,
	name_filter: Variant,
	type_filter: Variant,
	group_filter: Variant,
	cursor: int,
	limit: int,
	state: Dictionary
) -> void:
	if bool(state["stop"]):
		return
	if int(state["visited"]) >= BridgeConstants.MAX_NODE_LIST_SCAN_NODES:
		state["scan_truncated"] = true
		state["stop"] = true
		return
	state["visited"] = int(state["visited"]) + 1

	if _matches_scene_node(node, name_filter, type_filter, group_filter):
		var match_index: int = int(state["matches"])
		state["matches"] = match_index + 1
		if match_index >= cursor:
			var nodes: Array = state["nodes"]
			if nodes.size() >= limit:
				state["has_more"] = true
				state["stop"] = true
				return
			var serialized: Dictionary = _serialize_scene_node(node, scene_root)
			var separator_bytes: int = 0 if nodes.is_empty() else 1
			var serialized_bytes: int = (
				JSON.stringify(serialized).to_utf8_buffer().size()
			)
			if (
				int(state["result_bytes"])
				+ separator_bytes
				+ serialized_bytes
				> BridgeConstants.MAX_NODE_LIST_RESULT_BYTES
			):
				state["has_more"] = true
				state["size_truncated"] = true
				state["stop"] = true
				return
			nodes.append(serialized)
			state["result_bytes"] = (
				int(state["result_bytes"])
				+ separator_bytes
				+ serialized_bytes
			)

	if depth >= max_depth:
		if node.get_child_count(false) > 0:
			state["depth_truncated"] = true
		return
	for child in node.get_children(false):
		_collect_scene_nodes(
			child,
			scene_root,
			depth + 1,
			max_depth,
			name_filter,
			type_filter,
			group_filter,
			cursor,
			limit,
			state
		)
		if bool(state["stop"]):
			return


func _matches_scene_node(
	node: Node,
	name_filter: Variant,
	type_filter: Variant,
	group_filter: Variant
) -> bool:
	if name_filter != null and str(node.name) != str(name_filter):
		return false
	if type_filter != null and not node.is_class(str(type_filter)):
		return false
	return group_filter == null or node.is_in_group(StringName(str(group_filter)))


func _serialize_scene_node(node: Node, scene_root: Node) -> Dictionary:
	var relative_path: String = _relative_node_path(scene_root, node)
	var parent_path: String = ""
	var parent: Node = node.get_parent()
	if node != scene_root and parent != null:
		parent_path = _relative_node_path(scene_root, parent)

	var owner_path: String = ""
	var owner: Node = node.owner
	if owner != null and (
		owner == scene_root
		or scene_root.is_ancestor_of(owner)
	):
		owner_path = _relative_node_path(scene_root, owner)

	var instance_root: Node = _find_scene_instance_root(node, scene_root)
	var instance_root_path: String = ""
	var instance_scene_path: String = ""
	var instance_editable: bool = false
	if instance_root != null:
		instance_root_path = _relative_node_path(scene_root, instance_root)
		instance_scene_path = instance_root.scene_file_path
		instance_editable = scene_root.is_editable_instance(instance_root)

	return {
		"path": relative_path,
		"parent_path": parent_path,
		"name": str(node.name),
		"type": node.get_class(),
		"owner_path": owner_path,
		"editable": node == scene_root or node.owner == scene_root,
		"child_count": node.get_child_count(false),
		"in_instanced_scene": instance_root != null,
		"instance_root_path": instance_root_path,
		"instance_scene_path": instance_scene_path,
		"instance_editable": instance_editable,
	}


func _find_scene_instance_root(node: Node, scene_root: Node) -> Node:
	var current: Node = node
	while current != null and current != scene_root:
		if not current.scene_file_path.is_empty():
			return current
		current = current.get_parent()
	return null


func _relative_node_path(scene_root: Node, node: Node) -> String:
	if node == scene_root:
		return "."
	return str(scene_root.get_path_to(node))


func _get_node_groups(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var resolved: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		str(arguments["path"])
	)
	if not resolved["ok"]:
		return resolved
	var node: Node = resolved["node"]
	var snapshot: Dictionary = _node_group_snapshot(scene_root, node)
	if not snapshot["ok"]:
		return snapshot
	var data: Dictionary = snapshot["data"]
	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"path": _relative_node_path(scene_root, node),
			"editable": node == scene_root or node.owner == scene_root,
			"groups": data["groups"],
			"persistent_groups": data["persistent_groups"],
			"runtime_groups": data["runtime_groups"],
			"internal_groups": data["internal_groups"],
		}
	)


func _node_group_snapshot(scene_root: Node, node: Node) -> Dictionary:
	var persistent_result: Dictionary = _persistent_groups_by_path(scene_root)
	if not persistent_result["ok"]:
		return persistent_result
	var persistent_by_path: Dictionary = persistent_result["data"][
		"groups_by_path"
	]
	var node_path: String = _relative_node_path(scene_root, node)
	var stored_groups: Array = persistent_by_path.get(node_path, [])
	var stored_lookup: Dictionary = {}
	for group_name in stored_groups:
		stored_lookup[str(group_name)] = true

	var groups: Array[String] = []
	var persistent_groups: Array[String] = []
	var runtime_groups: Array[String] = []
	var internal_groups: Array[String] = []
	for raw_group_name in node.get_groups():
		var group_name: String = str(raw_group_name)
		if group_name.begins_with("_"):
			internal_groups.append(group_name)
			continue
		groups.append(group_name)
		if stored_lookup.has(group_name):
			persistent_groups.append(group_name)
		else:
			runtime_groups.append(group_name)
	groups.sort()
	persistent_groups.sort()
	runtime_groups.sort()
	internal_groups.sort()
	return _success(
		{
			"groups": groups,
			"persistent_groups": persistent_groups,
			"runtime_groups": runtime_groups,
			"internal_groups": internal_groups,
		}
	)


func _persistent_groups_by_path(scene_root: Node) -> Dictionary:
	if scene_root == null:
		return _failure("SCENE_NOT_OPEN", "No edited scene is currently open")
	var packed_scene: PackedScene = PackedScene.new()
	var pack_error: Error = packed_scene.pack(scene_root)
	if pack_error != OK:
		return _failure(
			"SCENE_STATE_UNAVAILABLE",
			"The current scene could not be inspected for persistent groups"
		)
	var scene_state: SceneState = packed_scene.get_state()
	if scene_state == null:
		return _failure(
			"SCENE_STATE_UNAVAILABLE",
			"The current scene did not expose a packed scene state"
		)
	var groups_by_path: Dictionary = {}
	for index in scene_state.get_node_count():
		var group_names: Array[String] = []
		for raw_group_name in scene_state.get_node_groups(index):
			group_names.append(str(raw_group_name))
		group_names.sort()
		var state_path: String = str(scene_state.get_node_path(index))
		if index == 0:
			state_path = "."
		elif state_path.begins_with("./"):
			state_path = state_path.trim_prefix("./")
		else:
			var root_prefix: String = str(scene_root.name) + "/"
			if state_path.begins_with(root_prefix):
				state_path = state_path.trim_prefix(root_prefix)
		groups_by_path[state_path] = group_names
	return _success({"groups_by_path": groups_by_path})


func _validate_user_group_name(
	raw_group_name: Variant,
	label: String = "Group name"
) -> Dictionary:
	if typeof(raw_group_name) != TYPE_STRING:
		return _failure("INVALID_ARGUMENTS", label + " must be a string")
	var group_name: String = str(raw_group_name)
	if (
		group_name.is_empty()
		or group_name.length() > BridgeConstants.MAX_NODE_GROUP_NAME_LENGTH
	):
		return _failure(
			"INVALID_ARGUMENTS",
			(
				label
				+ " must contain between 1 and %d characters"
				% BridgeConstants.MAX_NODE_GROUP_NAME_LENGTH
			)
		)
	if group_name.begins_with("_"):
		return _failure(
			"INVALID_ARGUMENTS",
			label + " must not start with '_' because that namespace is internal"
		)
	return _success({"group": group_name})


func _serialize_tree_node(
	node: Node,
	scene_root: Node,
	depth: int,
	max_depth: int,
	state: Dictionary
) -> Dictionary:
	state["count"] = int(state["count"]) + 1
	var relative_path: String = "."
	if node != scene_root:
		relative_path = str(scene_root.get_path_to(node))
	var result: Dictionary = {
		"path": relative_path,
		"name": str(node.name),
		"type": node.get_class(),
		"children": [],
	}
	if depth >= max_depth:
		if node.get_child_count(false) > 0:
			state["truncated"] = true
		return result
	for child in node.get_children(false):
		if int(state["count"]) >= int(state["max_nodes"]):
			state["truncated"] = true
			break
		result["children"].append(
			_serialize_tree_node(child, scene_root, depth + 1, max_depth, state)
		)
	return result


func _get_node_properties(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var resolved: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		str(arguments["path"])
	)
	if not resolved["ok"]:
		return resolved
	var node: Node = resolved["node"]
	var requested: Variant = arguments.get("properties", null)
	var requested_names: Array[String] = []
	if requested is Array:
		if requested.size() > BridgeConstants.MAX_PROPERTY_COUNT:
			return _failure(
				"INVALID_ARGUMENTS",
				"No more than %d properties may be requested"
				% BridgeConstants.MAX_PROPERTY_COUNT
			)
		for item in requested:
			if not requested_names.has(str(item)):
				requested_names.append(str(item))

	var visible_properties: Dictionary = {}
	for property_info in node.get_property_list():
		var usage: int = int(property_info.get("usage", 0))
		var property_name: String = str(property_info.get("name", ""))
		if (
			property_name.is_empty()
			or (usage & PROPERTY_USAGE_EDITOR) == 0
			or int(property_info.get("type", TYPE_NIL)) == TYPE_NIL
		):
			continue
		visible_properties[property_name] = property_info

	if requested is Array:
		for requested_name in requested_names:
			if not visible_properties.has(requested_name):
				return _failure(
					"PROPERTY_NOT_FOUND",
					"Editor-visible property not found: " + requested_name
				)

	var names: Array = visible_properties.keys()
	names.sort()
	if requested is Array:
		names = requested_names
	var properties: Array[Dictionary] = []
	for property_name in names:
		if properties.size() >= BridgeConstants.MAX_PROPERTY_COUNT:
			break
		var property_info: Dictionary = visible_properties[property_name]
		properties.append(_serialize_property(node, property_info))
	return _success(
		{
			"path": str(arguments["path"]),
			"node_type": node.get_class(),
			"properties": properties,
			"truncated": names.size() > BridgeConstants.MAX_PROPERTY_COUNT,
		}
	)


func _serialize_property(node: Node, property_info: Dictionary) -> Dictionary:
	var property_name: String = str(property_info["name"])
	var property_type: int = int(property_info["type"])
	var encoded: Dictionary = BridgeVariantCodec.encode(
		node.get(property_name),
		property_type
	)
	var result: Dictionary = {
		"name": property_name,
		"type": type_string(property_type),
		"class_name": str(property_info.get("class_name", "")),
		"hint": int(property_info.get("hint", PROPERTY_HINT_NONE)),
		"hint_string": str(property_info.get("hint_string", "")),
		"usage": int(property_info.get("usage", 0)),
		"value_supported": encoded["ok"],
		"read_only": (int(property_info.get("usage", 0)) & PROPERTY_USAGE_READ_ONLY) != 0,
	}
	if encoded["ok"]:
		result["value"] = encoded["value"]
	return result


func _create_node(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	if scene_root == null:
		return _failure("SCENE_NOT_OPEN", "No scene is currently open")

	var requested_parent_path: String = str(arguments["parent_path"])
	var resolved: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		requested_parent_path
	)
	if not resolved["ok"]:
		return resolved
	var parent: Node = resolved["node"]
	if parent != scene_root and parent.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Parent must be the scene root or a node owned by the scene root"
		)

	var node_type: String = str(arguments["node_type"])
	if not BridgeRuntimeNodeTypeGuard.is_instantiable_runtime_node_type(
		node_type
	):
		return _failure(
			"NODE_TYPE_INVALID",
			"Node type must be an enabled, instantiable runtime ClassDB Node"
		)

	var node_name: String = str(arguments["node_name"])
	if not BridgeNodeNameGuard.is_valid(node_name):
		return _failure(
			"INVALID_ARGUMENTS",
			"Node name must contain 1 to 128 valid characters"
		)

	for child in parent.get_children(true):
		if str(child.name) == node_name:
			return _failure(
				"NODE_NAME_CONFLICT",
				"Parent already has a direct child named: " + node_name
			)

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)

	var instantiated: Variant = ClassDB.instantiate(node_type)
	if not (instantiated is Node):
		if instantiated is Object and is_instance_valid(instantiated):
			instantiated.free()
		return _failure(
			"NODE_TYPE_INVALID",
			"ClassDB did not instantiate the requested Node type"
		)
	var node: Node = instantiated
	node.name = node_name
	if str(node.name) != node_name:
		node.free()
		return _failure(
			"NODE_CREATE_FAILED",
			"Godot did not accept the requested node name exactly"
		)

	var parent_path: String = _relative_node_path(scene_root, parent)
	var expected_path: String = node_name
	if parent_path != ".":
		expected_path = parent_path + "/" + node_name
	var action_name: String = BridgeConstants.PRODUCT_NAME + ": Create " + node_name
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		false,
		true
	)
	undo_redo.add_do_method(
		parent,
		"add_child",
		node,
		false,
		Node.INTERNAL_MODE_DISABLED
	)
	undo_redo.add_do_property(node, "owner", scene_root)
	undo_redo.add_do_reference(node)
	undo_redo.add_undo_method(parent, "remove_child", node)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	var actual_path: String = ""
	var child_index: int = -1
	if is_instance_valid(node) and node.get_parent() == parent:
		actual_path = _relative_node_path(scene_root, node)
		child_index = node.get_index(false)
	var scene_unsaved: bool = _context.is_scene_unsaved(scene_root)
	var postconditions_met: bool = (
		is_instance_valid(node)
		and node.get_parent() == parent
		and parent.get_children(false).has(node)
		and str(node.name) == node_name
		and node.get_class() == node_type
		and node.owner == scene_root
		and actual_path == expected_path
		and child_index >= 0
		and child_index < parent.get_child_count(false)
		and scene_unsaved
	)
	if not postconditions_met:
		if not _rollback_created_node(
			undo_redo,
			scene_root,
			parent,
			node,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Node creation failed and could not be safely undone"
			)
		return _failure(
			"NODE_CREATE_FAILED",
			"Node creation did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"parent_path": parent_path,
			"path": actual_path,
			"name": str(node.name),
			"type": node.get_class(),
			"owner_path": ".",
			"child_index": child_index,
			"created": true,
			"scene_unsaved": scene_unsaved,
		}
	)


func _rollback_created_node(
	undo_redo: EditorUndoRedoManager,
	scene_root: Node,
	parent: Node,
	node: Node,
	action_name: String
) -> bool:
	var history_id: int = undo_redo.get_object_history_id(scene_root)
	var history: UndoRedo = undo_redo.get_history_undo_redo(history_id)
	if (
		history != null
		and history.has_undo()
		and history.get_current_action_name() == action_name
	):
		if not history.undo():
			return false
		return is_instance_valid(node) and node.get_parent() == null

	if is_instance_valid(node) and node.get_parent() == parent:
		parent.remove_child(node)
	return not is_instance_valid(node) or node.get_parent() == null


func _delete_node(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var target_path: String = str(arguments["path"])
	var resolved: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		target_path
	)
	if not resolved["ok"]:
		return resolved
	var target: Node = resolved["node"]
	if target == scene_root:
		return _failure(
			"NODE_ROOT_FORBIDDEN",
			"The edited scene root cannot be deleted"
		)
	if target.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Target must be a node owned by the current scene root"
		)

	var parent: Node = target.get_parent()
	if parent == null:
		return _failure(
			"NODE_DELETE_FAILED",
			"Target node is not attached to the edited scene"
		)
	if parent != scene_root and parent.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Target parent must be local to the current scene"
		)

	var plan: Dictionary = _build_owned_subtree_plan(scene_root, target)
	if not plan["ok"]:
		return plan

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)

	var parent_path: String = _relative_node_path(scene_root, parent)
	var target_name: String = str(target.name)
	var target_type: String = target.get_class()
	var target_instance_id: int = target.get_instance_id()
	var child_index: int = target.get_index(false)
	var entries: Array = plan["entries"]
	var target_nodes: Array[Node] = _ordinary_subtree_nodes(target)
	var action_name: String = (
		BridgeConstants.PRODUCT_NAME + ": Delete " + target_path
	)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		false,
		true
	)
	undo_redo.add_do_method(parent, "remove_child", target)
	undo_redo.add_undo_method(
		parent,
		"add_child",
		target,
		false,
		Node.INTERNAL_MODE_DISABLED
	)
	undo_redo.add_undo_method(parent, "move_child", target, child_index)
	for index in range(entries.size()):
		undo_redo.add_undo_property(
			target_nodes[index],
			"owner",
			_owner_for_subtree_entry(entries[index], target, scene_root)
		)
	undo_redo.add_undo_reference(target)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	var scene_unsaved: bool = _context.is_scene_unsaved(scene_root)
	var postconditions_met: bool = (
		is_instance_valid(scene_root)
		and is_instance_valid(parent)
		and is_instance_valid(target)
		and target.get_instance_id() == target_instance_id
		and target.get_parent() == null
		and not parent.get_children(false).has(target)
		and scene_root.get_node_or_null(NodePath(target_path)) == null
		and str(target.name) == target_name
		and target.get_class() == target_type
		and _subtree_matches(target, entries, scene_root, false)
		and scene_unsaved
	)
	if not postconditions_met:
		if not _rollback_deleted_node(
			undo_redo,
			scene_root,
			parent,
			target,
			target_path,
			child_index,
			entries,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Node deletion failed and could not be safely undone"
			)
		return _failure(
			"NODE_DELETE_FAILED",
			"Node deletion did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"deleted_path": target_path,
			"parent_path": parent_path,
			"name": target_name,
			"type": target_type,
			"owner_path": ".",
			"child_index": child_index,
			"subtree_node_count": entries.size(),
			"deleted": true,
			"scene_unsaved": scene_unsaved,
		}
	)


func _rollback_deleted_node(
	undo_redo: EditorUndoRedoManager,
	scene_root: Node,
	parent: Node,
	target: Node,
	target_path: String,
	child_index: int,
	entries: Array,
	action_name: String
) -> bool:
	var history_id: int = undo_redo.get_object_history_id(scene_root)
	var history: UndoRedo = undo_redo.get_history_undo_redo(history_id)
	if (
		history != null
		and history.has_undo()
		and history.get_current_action_name() == action_name
	):
		if not history.undo():
			return false
	elif is_instance_valid(target):
		if target.get_parent() == null:
			parent.add_child(target, false, Node.INTERNAL_MODE_DISABLED)
		if target.get_parent() == parent:
			parent.move_child(target, child_index)
			var target_nodes: Array[Node] = _ordinary_subtree_nodes(target)
			if target_nodes.size() != entries.size():
				return false
			for index in range(entries.size()):
				target_nodes[index].owner = _owner_for_subtree_entry(
					entries[index],
					target,
					scene_root
				)

	return (
		is_instance_valid(target)
		and target.get_parent() == parent
		and parent.get_children(false).has(target)
		and target.get_index(false) == child_index
		and scene_root.get_node_or_null(NodePath(target_path)) == target
		and _subtree_matches(target, entries, scene_root, true)
	)


func _duplicate_node(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var source_path: String = str(arguments["path"])
	var resolved: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		source_path
	)
	if not resolved["ok"]:
		return resolved
	var source: Node = resolved["node"]
	if source == scene_root:
		return _failure(
			"NODE_ROOT_FORBIDDEN",
			"The edited scene root cannot be duplicated"
		)
	if source.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Target must be a node owned by the current scene root"
		)

	var parent: Node = source.get_parent()
	if parent == null:
		return _failure(
			"NODE_DUPLICATE_FAILED",
			"Target node is not attached to the edited scene"
		)
	if parent != scene_root and parent.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Target parent must be local to the current scene"
		)

	var new_name: String = str(arguments["new_name"])
	if not BridgeNodeNameGuard.is_valid(new_name):
		return _failure(
			"INVALID_ARGUMENTS",
			"Node name must contain 1 to 128 valid characters"
		)
	for sibling in parent.get_children(true):
		if str(sibling.name) == new_name:
			return _failure(
				"NODE_NAME_CONFLICT",
				"Parent already has a direct child named: " + new_name
			)

	var plan: Dictionary = _build_owned_subtree_plan(
		scene_root,
		source
	)
	if not plan["ok"]:
		return plan

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)

	var duplicate: Node = source.duplicate(Node.DUPLICATE_DEFAULT)
	if duplicate == null:
		return _failure(
			"NODE_DUPLICATE_FAILED",
			"Godot could not duplicate the requested node subtree"
		)
	duplicate.name = new_name
	if str(duplicate.name) != new_name:
		duplicate.free()
		return _failure(
			"NODE_DUPLICATE_FAILED",
			"Godot did not accept the duplicated node name exactly"
		)

	var prepared: Dictionary = _prepare_duplicate_nodes(
		duplicate,
		plan["entries"]
	)
	if not prepared["ok"]:
		duplicate.free()
		return prepared

	var parent_path: String = _relative_node_path(scene_root, parent)
	var duplicate_path: String = new_name
	if parent_path != ".":
		duplicate_path = parent_path + "/" + new_name
	var source_child_index: int = source.get_index(false)
	var duplicate_child_index: int = source_child_index + 1
	var source_instance_id: int = source.get_instance_id()
	var source_name: String = str(source.name)
	var source_type: String = source.get_class()
	var action_name: String = (
		BridgeConstants.PRODUCT_NAME
		+ ": Duplicate "
		+ source_path
		+ " as "
		+ new_name
	)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		false,
		true
	)
	undo_redo.add_do_method(
		parent,
		"add_child",
		duplicate,
		false,
		Node.INTERNAL_MODE_DISABLED
	)
	undo_redo.add_do_method(
		parent,
		"move_child",
		duplicate,
		duplicate_child_index
	)
	var entries: Array = plan["entries"]
	var duplicate_nodes: Array = prepared["nodes"]
	for index in range(entries.size()):
		var desired_owner: Node = _owner_for_subtree_entry(
			entries[index],
			duplicate,
			scene_root
		)
		undo_redo.add_do_property(
			duplicate_nodes[index],
			"owner",
			desired_owner
		)
	undo_redo.add_do_reference(duplicate)
	undo_redo.add_undo_method(parent, "remove_child", duplicate)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	var actual_duplicate_path: String = ""
	if is_instance_valid(duplicate) and duplicate.get_parent() == parent:
		actual_duplicate_path = _relative_node_path(scene_root, duplicate)
	var scene_unsaved: bool = _context.is_scene_unsaved(scene_root)
	var subtree_matches: bool = _subtree_matches(
		duplicate,
		entries,
		scene_root,
		true
	)
	var postconditions_met: bool = (
		is_instance_valid(source)
		and is_instance_valid(parent)
		and is_instance_valid(duplicate)
		and source.get_instance_id() == source_instance_id
		and source.get_parent() == parent
		and source.get_index(false) == source_child_index
		and str(source.name) == source_name
		and source.get_class() == source_type
		and source.owner == scene_root
		and _relative_node_path(scene_root, source) == source_path
		and scene_root.get_node_or_null(NodePath(source_path)) == source
		and duplicate != source
		and duplicate.get_parent() == parent
		and parent.get_children(false).has(duplicate)
		and duplicate.get_index(false) == duplicate_child_index
		and parent.get_child(duplicate_child_index, false) == duplicate
		and str(duplicate.name) == new_name
		and duplicate.get_class() == source_type
		and duplicate.owner == scene_root
		and actual_duplicate_path == duplicate_path
		and scene_root.get_node_or_null(NodePath(duplicate_path)) == duplicate
		and subtree_matches
		and scene_unsaved
	)
	if not postconditions_met:
		if not _rollback_duplicated_node(
			undo_redo,
			scene_root,
			parent,
			source,
			duplicate,
			source_path,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Node duplication failed and could not be safely undone"
			)
		return _failure(
			"NODE_DUPLICATE_FAILED",
			"Node duplication did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"source_path": source_path,
			"duplicate_path": actual_duplicate_path,
			"parent_path": parent_path,
			"source_name": source_name,
			"new_name": str(duplicate.name),
			"type": duplicate.get_class(),
			"owner_path": ".",
			"source_child_index": source_child_index,
			"child_index": duplicate_child_index,
			"subtree_node_count": entries.size(),
			"duplicated": true,
			"scene_unsaved": scene_unsaved,
		}
	)


func _build_owned_subtree_plan(scene_root: Node, source: Node) -> Dictionary:
	var source_nodes: Array[Node] = _ordinary_subtree_nodes(source)
	var entries: Array[Dictionary] = []
	var relative_paths: Dictionary = {}
	for source_node in source_nodes:
		var relative_path: String = _relative_subtree_path(
			source,
			source_node
		)
		relative_paths[relative_path] = true
		var source_owner: Node = source_node.owner
		var owner_kind: String = "none"
		var owner_relative_path: String = ""
		if source_owner == null:
			return _failure(
				"NODE_NOT_EDITABLE",
				"Subtree contains an unowned ordinary node"
			)
		elif source_owner == scene_root:
			owner_kind = "scene_root"
		else:
			if source_owner != source and not source.is_ancestor_of(source_owner):
				return _failure(
					"NODE_NOT_EDITABLE",
					"Subtree contains a node owned outside its ordinary boundary"
				)
			owner_kind = "subtree"
			owner_relative_path = _relative_subtree_path(
				source,
				source_owner
			)
		entries.append(
			{
				"relative_path": relative_path,
				"name": str(source_node.name),
				"type": source_node.get_class(),
				"script": source_node.get_script(),
				"scene_file_path": source_node.scene_file_path,
				"owner_kind": owner_kind,
				"owner_relative_path": owner_relative_path,
			}
		)
	for entry in entries:
		if (
			entry["owner_kind"] == "subtree"
			and not relative_paths.has(entry["owner_relative_path"])
		):
			return _failure(
				"NODE_NOT_EDITABLE",
				"Subtree owner is not part of the ordinary node boundary"
			)
	return {"ok": true, "entries": entries}


func _prepare_duplicate_nodes(
	duplicate: Node,
	entries: Array
) -> Dictionary:
	var duplicate_nodes: Array[Node] = _ordinary_subtree_nodes(duplicate)
	if duplicate_nodes.size() != entries.size():
		return _failure(
			"NODE_DUPLICATE_FAILED",
			"Duplicated subtree has a different ordinary node count"
		)
	var resolved_nodes: Array[Node] = []
	for entry in entries:
		var relative_path: String = str(entry["relative_path"])
		var duplicate_node: Node = duplicate
		if relative_path != ".":
			duplicate_node = duplicate.get_node_or_null(
				NodePath(relative_path)
			)
		if duplicate_node == null:
			return _failure(
				"NODE_DUPLICATE_FAILED",
				"Duplicated subtree is missing node: " + relative_path
			)
		if (
			(relative_path != "." and str(duplicate_node.name) != entry["name"])
			or duplicate_node.get_class() != entry["type"]
			or duplicate_node.get_script() != entry["script"]
			or duplicate_node.scene_file_path != entry["scene_file_path"]
		):
			return _failure(
				"NODE_DUPLICATE_FAILED",
				"Duplicated subtree did not preserve node metadata: " + relative_path
			)
		resolved_nodes.append(duplicate_node)
	return {"ok": true, "nodes": resolved_nodes}


func _subtree_matches(
	subtree_root: Node,
	entries: Array,
	scene_root: Node,
	attached: bool
) -> bool:
	if not is_instance_valid(subtree_root):
		return false
	var subtree_nodes: Array[Node] = _ordinary_subtree_nodes(subtree_root)
	if subtree_nodes.size() != entries.size():
		return false
	for entry in entries:
		var relative_path: String = str(entry["relative_path"])
		var subtree_node: Node = subtree_root
		if relative_path != ".":
			subtree_node = subtree_root.get_node_or_null(
				NodePath(relative_path)
			)
		if subtree_node == null:
			return false
		if (
			(relative_path != "." and str(subtree_node.name) != entry["name"])
			or subtree_node.get_class() != entry["type"]
			or subtree_node.get_script() != entry["script"]
			or subtree_node.scene_file_path != entry["scene_file_path"]
		):
			return false
		var expected_owner: Node = null
		if attached or str(entry["owner_kind"]) == "subtree":
			expected_owner = _owner_for_subtree_entry(
				entry,
				subtree_root,
				scene_root
			)
		if subtree_node.owner != expected_owner:
			return false
	return true


func _owner_for_subtree_entry(
	entry: Dictionary,
	subtree_root: Node,
	scene_root: Node
) -> Node:
	match str(entry["owner_kind"]):
		"scene_root":
			return scene_root
		"subtree":
			var owner_path: String = str(entry["owner_relative_path"])
			if owner_path == ".":
				return subtree_root
			return subtree_root.get_node_or_null(NodePath(owner_path))
	return null


func _ordinary_subtree_nodes(root: Node) -> Array[Node]:
	var nodes: Array[Node] = []
	var pending: Array[Node] = [root]
	while not pending.is_empty():
		var node: Node = pending.pop_back()
		nodes.append(node)
		var children: Array[Node] = []
		for child in node.get_children(false):
			children.append(child)
		for index in range(children.size() - 1, -1, -1):
			pending.append(children[index])
	return nodes


func _relative_subtree_path(root: Node, node: Node) -> String:
	if node == root:
		return "."
	return str(root.get_path_to(node))


func _rollback_duplicated_node(
	undo_redo: EditorUndoRedoManager,
	scene_root: Node,
	parent: Node,
	source: Node,
	duplicate: Node,
	source_path: String,
	action_name: String
) -> bool:
	var history_id: int = undo_redo.get_object_history_id(scene_root)
	var history: UndoRedo = undo_redo.get_history_undo_redo(history_id)
	if (
		history != null
		and history.has_undo()
		and history.get_current_action_name() == action_name
	):
		if not history.undo():
			return false
	elif is_instance_valid(duplicate) and duplicate.get_parent() == parent:
		parent.remove_child(duplicate)
	return (
		is_instance_valid(source)
		and scene_root.get_node_or_null(NodePath(source_path)) == source
		and (
			not is_instance_valid(duplicate)
			or duplicate.get_parent() == null
		)
	)


func _instantiate_scene(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var resolved_parent: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		str(arguments["parent_path"])
	)
	if not resolved_parent["ok"]:
		return resolved_parent
	var parent: Node = resolved_parent["node"]
	if parent != scene_root and parent.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Parent must be the scene root or a node owned by the scene root"
		)

	var validated_path: Dictionary = BridgeScenePathGuard.validate_scene_path(
		str(arguments["scene_path"])
	)
	if not validated_path["ok"]:
		return validated_path
	var source_scene_path: String = str(validated_path["path"])
	if not FileAccess.file_exists(source_scene_path):
		return _failure(
			"SCENE_NOT_FOUND",
			"Scene not found: " + source_scene_path
		)

	var requested_name: Variant = arguments.get("node_name", null)
	if requested_name != null:
		if not (requested_name is String):
			return _failure(
				"INVALID_ARGUMENTS",
				"Optional node name must be a string or null"
			)
		if not BridgeNodeNameGuard.is_valid(requested_name):
			return _failure(
				"INVALID_ARGUMENTS",
				"Node name must contain 1 to 128 valid characters"
			)

	var current_scene_path: String = _normalized_resource_path(
		scene_root.scene_file_path
	)
	var source_scene_identity: String = _normalized_resource_path(
		source_scene_path
	)
	if (
		not current_scene_path.is_empty()
		and source_scene_identity == current_scene_path
	):
		return _failure(
			"SCENE_DEPENDENCY_CYCLE",
			"The current scene cannot be instantiated into itself"
		)

	var resource: Resource = ResourceLoader.load(source_scene_path, "PackedScene")
	if not (resource is PackedScene):
		return _failure(
			"SCENE_INSTANTIATE_FAILED",
			"Resource is not a loadable PackedScene: " + source_scene_path
		)
	var packed_scene: PackedScene = resource
	if not packed_scene.can_instantiate():
		return _failure(
			"SCENE_INSTANTIATE_FAILED",
			"PackedScene does not contain an instantiable node hierarchy"
		)

	if not current_scene_path.is_empty():
		var cycle_check: Dictionary = _packed_scene_cycle_check(
			packed_scene,
			current_scene_path
		)
		if not cycle_check["ok"]:
			return cycle_check
		if cycle_check["contains_target"]:
			return _failure(
				"SCENE_DEPENDENCY_CYCLE",
				"Source scene contains the current scene in its instance or inheritance graph"
			)

	var instance: Node = packed_scene.instantiate(
		PackedScene.GEN_EDIT_STATE_INSTANCE
	)
	if instance == null:
		return _failure(
			"SCENE_INSTANTIATE_FAILED",
			"Godot could not instantiate the requested PackedScene"
		)
	instance.scene_file_path = source_scene_path
	if instance.scene_file_path != source_scene_path:
		instance.free()
		return _failure(
			"SCENE_INSTANTIATE_FAILED",
			"Godot did not preserve the requested PackedScene path"
		)
	if (
		not current_scene_path.is_empty()
		and _instantiated_tree_contains_scene_path(
			instance,
			current_scene_path
		)
	):
		instance.free()
		return _failure(
			"SCENE_DEPENDENCY_CYCLE",
			"Instantiated hierarchy contains the current scene"
		)

	var node_name: String = str(instance.name)
	if requested_name != null:
		node_name = requested_name
		instance.name = node_name
		if str(instance.name) != node_name:
			instance.free()
			return _failure(
				"SCENE_INSTANTIATE_FAILED",
				"Godot did not accept the requested instance name exactly"
			)
	elif not BridgeNodeNameGuard.is_valid(node_name):
		instance.free()
		return _failure(
			"SCENE_INSTANTIATE_FAILED",
			"PackedScene root has an invalid node name"
		)

	for child in parent.get_children(true):
		if str(child.name) == node_name:
			instance.free()
			return _failure(
				"NODE_NAME_CONFLICT",
				"Parent already has a direct child named: " + node_name
			)

	var plan: Dictionary = _build_instantiated_subtree_plan(instance)
	if not plan["ok"]:
		instance.free()
		return plan
	var entries: Array = plan["entries"]
	if not _subtree_matches(instance, entries, scene_root, false):
		instance.free()
		return _failure(
			"SCENE_INSTANTIATE_FAILED",
			"Detached instance did not preserve its PackedScene ownership graph"
		)

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		instance.free()
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)

	var parent_path: String = _relative_node_path(scene_root, parent)
	var expected_path: String = node_name
	if parent_path != ".":
		expected_path = parent_path + "/" + node_name
	var child_index: int = parent.get_child_count(false)
	var instance_type: String = instance.get_class()
	var instance_id: int = instance.get_instance_id()
	var action_name: String = (
		BridgeConstants.PRODUCT_NAME
		+ ": Instantiate "
		+ source_scene_path
		+ " as "
		+ expected_path
	)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		false,
		true
	)
	undo_redo.add_do_method(
		parent,
		"add_child",
		instance,
		false,
		Node.INTERNAL_MODE_DISABLED
	)
	undo_redo.add_do_property(instance, "owner", scene_root)
	undo_redo.add_do_reference(instance)
	undo_redo.add_undo_method(parent, "remove_child", instance)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	var actual_path: String = ""
	if is_instance_valid(instance) and instance.get_parent() == parent:
		actual_path = _relative_node_path(scene_root, instance)
	var scene_unsaved: bool = _context.is_scene_unsaved(scene_root)
	var postconditions_met: bool = (
		is_instance_valid(scene_root)
		and is_instance_valid(parent)
		and is_instance_valid(instance)
		and instance.get_instance_id() == instance_id
		and instance.get_parent() == parent
		and parent.get_children(false).has(instance)
		and instance.get_index(false) == child_index
		and parent.get_child(child_index, false) == instance
		and str(instance.name) == node_name
		and instance.get_class() == instance_type
		and instance.owner == scene_root
		and instance.scene_file_path == source_scene_path
		and actual_path == expected_path
		and scene_root.get_node_or_null(NodePath(expected_path)) == instance
		and _subtree_matches(instance, entries, scene_root, true)
		and scene_unsaved
	)
	if not postconditions_met:
		if not _rollback_instantiated_scene(
			undo_redo,
			scene_root,
			parent,
			instance,
			entries,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Scene instantiation failed and could not be safely undone"
			)
		return _failure(
			"SCENE_INSTANTIATE_FAILED",
			"Scene instantiation did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"instance_scene_path": source_scene_path,
			"parent_path": parent_path,
			"path": actual_path,
			"name": str(instance.name),
			"type": instance.get_class(),
			"owner_path": ".",
			"child_index": child_index,
			"subtree_node_count": entries.size(),
			"instantiated": true,
			"scene_unsaved": scene_unsaved,
		}
	)


func _packed_scene_cycle_check(
	packed_scene: PackedScene,
	target_scene_path: String
) -> Dictionary:
	var pending: Array = [packed_scene.get_state()]
	var visited: Dictionary = {}
	var visited_entries: int = 0
	while not pending.is_empty():
		var state: SceneState = pending.pop_back()
		if state == null:
			continue
		var state_path: String = _normalized_resource_path(state.get_path())
		var state_key: String = state_path
		if state_key.is_empty():
			state_key = "instance:" + str(state.get_instance_id())
		if visited.has(state_key):
			continue
		visited[state_key] = true
		visited_entries += 1
		if visited_entries > BridgeConstants.MAX_SCENE_SCAN_ENTRIES:
			return _failure(
				"SCENE_INSTANTIATE_FAILED",
				"PackedScene dependency graph exceeds the safe scan limit"
			)
		if state_path == target_scene_path:
			return {"ok": true, "contains_target": true}

		var base_state: SceneState = state.get_base_scene_state()
		if base_state != null:
			pending.append(base_state)
		for index in range(state.get_node_count()):
			var child_scene: PackedScene = state.get_node_instance(index)
			if child_scene == null:
				continue
			var child_path: String = _normalized_resource_path(
				child_scene.resource_path
			)
			if child_path == target_scene_path:
				return {"ok": true, "contains_target": true}
			pending.append(child_scene.get_state())
	return {"ok": true, "contains_target": false}


func _instantiated_tree_contains_scene_path(
	instance: Node,
	target_scene_path: String
) -> bool:
	for node in _ordinary_subtree_nodes(instance):
		if _normalized_resource_path(node.scene_file_path) == target_scene_path:
			return true
	return false


func _normalized_resource_path(path: String) -> String:
	if path.is_empty():
		return ""
	var normalized: String = ProjectSettings.localize_path(path).replace("\\", "/")
	if OS.get_name() == "Windows":
		normalized = normalized.to_lower()
	return normalized


func _build_instantiated_subtree_plan(instance: Node) -> Dictionary:
	var instance_nodes: Array[Node] = _ordinary_subtree_nodes(instance)
	var entries: Array[Dictionary] = []
	var relative_paths: Dictionary = {}
	for instance_node in instance_nodes:
		var relative_path: String = _relative_subtree_path(
			instance,
			instance_node
		)
		relative_paths[relative_path] = true
		var owner_kind: String = "scene_root"
		var owner_relative_path: String = ""
		if instance_node == instance:
			if instance_node.owner != null:
				return _failure(
					"SCENE_INSTANTIATE_FAILED",
					"Detached PackedScene root unexpectedly has an owner"
				)
		else:
			var instance_owner: Node = instance_node.owner
			if instance_owner == null:
				return _failure(
					"SCENE_INSTANTIATE_FAILED",
					"PackedScene contains an unowned ordinary descendant"
				)
			if (
				instance_owner != instance
				and not instance.is_ancestor_of(instance_owner)
			):
				return _failure(
					"SCENE_INSTANTIATE_FAILED",
					"PackedScene owner escapes the instantiated hierarchy"
				)
			owner_kind = "subtree"
			owner_relative_path = _relative_subtree_path(
				instance,
				instance_owner
			)
		entries.append(
			{
				"relative_path": relative_path,
				"name": str(instance_node.name),
				"type": instance_node.get_class(),
				"script": instance_node.get_script(),
				"scene_file_path": instance_node.scene_file_path,
				"owner_kind": owner_kind,
				"owner_relative_path": owner_relative_path,
			}
		)
	for entry in entries:
		if (
			entry["owner_kind"] == "subtree"
			and not relative_paths.has(entry["owner_relative_path"])
		):
			return _failure(
				"SCENE_INSTANTIATE_FAILED",
				"PackedScene owner is not part of the ordinary node boundary"
			)
	return {"ok": true, "entries": entries}


func _rollback_instantiated_scene(
	undo_redo: EditorUndoRedoManager,
	scene_root: Node,
	parent: Node,
	instance: Node,
	entries: Array,
	action_name: String
) -> bool:
	var history_id: int = undo_redo.get_object_history_id(scene_root)
	var history: UndoRedo = undo_redo.get_history_undo_redo(history_id)
	if (
		history != null
		and history.has_undo()
		and history.get_current_action_name() == action_name
	):
		if not history.undo():
			return false
	elif is_instance_valid(instance) and instance.get_parent() == parent:
		parent.remove_child(instance)
	return (
		is_instance_valid(instance)
		and instance.get_parent() == null
		and _subtree_matches(instance, entries, scene_root, false)
	)


func _move_node(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var resolved_target: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		str(arguments["path"])
	)
	if not resolved_target["ok"]:
		return resolved_target
	var node: Node = resolved_target["node"]
	if node == scene_root:
		return _failure(
			"NODE_ROOT_FORBIDDEN",
			"The edited scene root cannot be moved"
		)
	if node.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Target must be a node owned by the current scene root"
		)

	var resolved_parent: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		str(arguments["new_parent_path"])
	)
	if not resolved_parent["ok"]:
		return resolved_parent
	var new_parent: Node = resolved_parent["node"]
	if new_parent != scene_root and new_parent.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Destination parent must be local to the current scene"
		)
	if new_parent == node or node.is_ancestor_of(new_parent):
		return _failure(
			"NODE_CYCLE_FORBIDDEN",
			"A node cannot be moved beneath itself or its descendants"
		)

	var old_parent: Node = node.get_parent()
	if old_parent == null:
		return _failure(
			"NODE_MOVE_FAILED",
			"Target node is not attached to the edited scene"
		)
	var old_child_index: int = node.get_index(false)
	var new_child_index: int = int(arguments["child_index"])
	var maximum_child_index: int = new_parent.get_child_count(false)
	if new_parent == old_parent:
		maximum_child_index -= 1
	if new_child_index < 0 or new_child_index > maximum_child_index:
		return _failure(
			"NODE_INDEX_OUT_OF_RANGE",
			(
				"Child index must be between 0 and %d for the destination"
				% maximum_child_index
			)
		)

	for sibling in new_parent.get_children(true):
		if sibling != node and str(sibling.name) == str(node.name):
			return _failure(
				"NODE_NAME_CONFLICT",
				"Destination already has a direct child named: " + str(node.name)
			)
	if new_parent == old_parent and new_child_index == old_child_index:
		return _failure(
			"INVALID_ARGUMENTS",
			"Move must change the parent or ordinary child index"
		)

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)

	var old_path: String = _relative_node_path(scene_root, node)
	var old_parent_path: String = _relative_node_path(scene_root, old_parent)
	var new_parent_path: String = _relative_node_path(scene_root, new_parent)
	var expected_new_path: String = str(node.name)
	if new_parent_path != ".":
		expected_new_path = new_parent_path + "/" + str(node.name)
	var reparented: bool = old_parent != new_parent
	var node_name: String = str(node.name)
	var node_type: String = node.get_class()
	var instance_id: int = node.get_instance_id()
	var action_name: String = (
		BridgeConstants.PRODUCT_NAME
		+ ": Move "
		+ old_path
		+ " to "
		+ new_parent_path
		+ " at "
		+ str(new_child_index)
	)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		false,
		true
	)
	if reparented:
		undo_redo.add_do_method(node, "reparent", new_parent, true)
	undo_redo.add_do_method(
		new_parent,
		"move_child",
		node,
		new_child_index
	)
	if reparented:
		undo_redo.add_undo_method(node, "reparent", old_parent, true)
	undo_redo.add_undo_method(
		old_parent,
		"move_child",
		node,
		old_child_index
	)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	var actual_new_path: String = ""
	if is_instance_valid(node) and node.get_parent() == new_parent:
		actual_new_path = _relative_node_path(scene_root, node)
	var scene_unsaved: bool = _context.is_scene_unsaved(scene_root)
	var postconditions_met: bool = (
		is_instance_valid(node)
		and is_instance_valid(old_parent)
		and is_instance_valid(new_parent)
		and node.get_instance_id() == instance_id
		and node.get_parent() == new_parent
		and new_parent.get_children(false).has(node)
		and node.get_index(false) == new_child_index
		and new_parent.get_child(new_child_index, false) == node
		and str(node.name) == node_name
		and node.get_class() == node_type
		and node.owner == scene_root
		and actual_new_path == expected_new_path
		and scene_root.get_node_or_null(NodePath(expected_new_path)) == node
		and (not reparented or not old_parent.get_children(false).has(node))
		and (not reparented or scene_root.get_node_or_null(NodePath(old_path)) == null)
		and scene_unsaved
	)
	if not postconditions_met:
		if not _rollback_moved_node(
			undo_redo,
			scene_root,
			old_parent,
			new_parent,
			node,
			old_path,
			old_child_index,
			reparented,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Node move failed and could not be safely undone"
			)
		return _failure(
			"NODE_MOVE_FAILED",
			"Node move did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"old_path": old_path,
			"new_path": actual_new_path,
			"old_parent_path": old_parent_path,
			"new_parent_path": new_parent_path,
			"old_child_index": old_child_index,
			"new_child_index": new_child_index,
			"owner_path": ".",
			"moved": true,
			"reparented": reparented,
			"scene_unsaved": scene_unsaved,
		}
	)


func _rollback_moved_node(
	undo_redo: EditorUndoRedoManager,
	scene_root: Node,
	old_parent: Node,
	new_parent: Node,
	node: Node,
	old_path: String,
	old_child_index: int,
	reparented: bool,
	action_name: String
) -> bool:
	var history_id: int = undo_redo.get_object_history_id(scene_root)
	var history: UndoRedo = undo_redo.get_history_undo_redo(history_id)
	if (
		history != null
		and history.has_undo()
		and history.get_current_action_name() == action_name
	):
		if not history.undo():
			return false
	elif (
		is_instance_valid(node)
		and is_instance_valid(old_parent)
		and is_instance_valid(new_parent)
	):
		if reparented:
			if node.get_parent() != new_parent:
				return false
			node.reparent(old_parent, true)
		elif node.get_parent() != old_parent:
			return false
		old_parent.move_child(node, old_child_index)

	return (
		is_instance_valid(node)
		and is_instance_valid(old_parent)
		and is_instance_valid(new_parent)
		and node.get_parent() == old_parent
		and old_parent.get_children(false).has(node)
		and node.get_index(false) == old_child_index
		and old_parent.get_child(old_child_index, false) == node
		and node.owner == scene_root
		and _relative_node_path(scene_root, node) == old_path
		and scene_root.get_node_or_null(NodePath(old_path)) == node
		and (not reparented or not new_parent.get_children(false).has(node))
	)


func _rename_node(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var old_path: String = str(arguments["path"])
	var resolved: Dictionary = BridgeNodePathGuard.resolve(scene_root, old_path)
	if not resolved["ok"]:
		return resolved
	var node: Node = resolved["node"]
	if node == scene_root:
		return _failure(
			"NODE_ROOT_FORBIDDEN",
			"The edited scene root cannot be renamed"
		)
	if node.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Target must be a node owned by the current scene root"
		)

	var new_name: String = str(arguments["new_name"])
	if not BridgeNodeNameGuard.is_valid(new_name):
		return _failure(
			"INVALID_ARGUMENTS",
			"Node name must contain 1 to 128 valid characters"
		)
	var old_name: String = str(node.name)
	if new_name == old_name:
		return _failure(
			"INVALID_ARGUMENTS",
			"New node name must differ from the current name"
		)

	var parent: Node = node.get_parent()
	if parent == null:
		return _failure(
			"NODE_RENAME_FAILED",
			"Target node is not attached to the edited scene"
		)
	for sibling in parent.get_children(true):
		if sibling != node and str(sibling.name) == new_name:
			return _failure(
				"NODE_NAME_CONFLICT",
				"Parent already has a direct child named: " + new_name
			)

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)

	var parent_path: String = _relative_node_path(scene_root, parent)
	var expected_new_path: String = new_name
	if parent_path != ".":
		expected_new_path = parent_path + "/" + new_name
	var child_index: int = node.get_index(false)
	var node_type: String = node.get_class()
	var instance_id: int = node.get_instance_id()
	var action_name: String = (
		BridgeConstants.PRODUCT_NAME
		+ ": Rename "
		+ old_name
		+ " to "
		+ new_name
	)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		false,
		true
	)
	undo_redo.add_do_property(node, "name", new_name)
	undo_redo.add_undo_property(node, "name", old_name)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	var actual_new_path: String = ""
	if is_instance_valid(node) and node.get_parent() == parent:
		actual_new_path = _relative_node_path(scene_root, node)
	var scene_unsaved: bool = _context.is_scene_unsaved(scene_root)
	var postconditions_met: bool = (
		is_instance_valid(node)
		and is_instance_valid(parent)
		and node.get_instance_id() == instance_id
		and node.get_parent() == parent
		and parent.get_children(false).has(node)
		and node.get_index(false) == child_index
		and str(node.name) == new_name
		and node.get_class() == node_type
		and node.owner == scene_root
		and actual_new_path == expected_new_path
		and scene_root.get_node_or_null(NodePath(expected_new_path)) == node
		and scene_root.get_node_or_null(NodePath(old_path)) == null
		and scene_unsaved
	)
	if not postconditions_met:
		if not _rollback_renamed_node(
			undo_redo,
			scene_root,
			parent,
			node,
			old_path,
			old_name,
			child_index,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Node rename failed and could not be safely undone"
			)
		return _failure(
			"NODE_RENAME_FAILED",
			"Node rename did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"old_path": old_path,
			"new_path": actual_new_path,
			"old_name": old_name,
			"new_name": str(node.name),
			"parent_path": parent_path,
			"owner_path": ".",
			"child_index": child_index,
			"renamed": true,
			"scene_unsaved": scene_unsaved,
		}
	)


func _rollback_renamed_node(
	undo_redo: EditorUndoRedoManager,
	scene_root: Node,
	parent: Node,
	node: Node,
	old_path: String,
	old_name: String,
	child_index: int,
	action_name: String
) -> bool:
	var history_id: int = undo_redo.get_object_history_id(scene_root)
	var history: UndoRedo = undo_redo.get_history_undo_redo(history_id)
	if (
		history != null
		and history.has_undo()
		and history.get_current_action_name() == action_name
	):
		if not history.undo():
			return false
	elif (
		is_instance_valid(node)
		and is_instance_valid(parent)
		and node.get_parent() == parent
	):
		node.name = old_name

	return (
		is_instance_valid(node)
		and is_instance_valid(parent)
		and node.get_parent() == parent
		and parent.get_children(false).has(node)
		and node.get_index(false) == child_index
		and str(node.name) == old_name
		and node.owner == scene_root
		and _relative_node_path(scene_root, node) == old_path
		and scene_root.get_node_or_null(NodePath(old_path)) == node
	)


func _set_node_groups(arguments: Dictionary) -> Dictionary:
	var raw_groups: Variant = arguments.get("groups", null)
	if not (raw_groups is Array):
		return _failure("INVALID_ARGUMENTS", "groups must be an array")
	var group_validation: Dictionary = _validate_node_group_list(raw_groups)
	if not group_validation["ok"]:
		return group_validation
	var desired_groups: Array = group_validation["data"]["groups"]

	var scene_root: Node = _context.edited_scene_root()
	var resolved: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		str(arguments["path"])
	)
	if not resolved["ok"]:
		return resolved
	var node: Node = resolved["node"]
	if node != scene_root and node.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Target must be the scene root or a node owned by the scene root"
		)

	var before_snapshot: Dictionary = _node_group_snapshot(scene_root, node)
	if not before_snapshot["ok"]:
		return before_snapshot
	var previous_groups: Array = before_snapshot["data"]["persistent_groups"]
	if previous_groups.size() > BridgeConstants.MAX_NODE_GROUPS:
		return _failure(
			"INVALID_ARGUMENTS",
			"Target has more than %d persistent user groups"
			% BridgeConstants.MAX_NODE_GROUPS
		)
	var added_groups: Array = _group_array_difference(
		desired_groups,
		previous_groups
	)
	var removed_groups: Array = _group_array_difference(
		previous_groups,
		desired_groups
	)
	var target_path: String = _relative_node_path(scene_root, node)
	if added_groups.is_empty() and removed_groups.is_empty():
		return _success(
			{
				"scene_path": scene_root.scene_file_path,
				"path": target_path,
				"previous_groups": previous_groups,
				"groups": desired_groups,
				"added_groups": added_groups,
				"removed_groups": removed_groups,
				"scene_unsaved": _context.is_scene_unsaved(scene_root),
			}
		)

	var affected_lookup: Dictionary = {}
	for group_name in previous_groups:
		affected_lookup[str(group_name)] = true
	for group_name in desired_groups:
		affected_lookup[str(group_name)] = true
	var affected_groups: Array = affected_lookup.keys()
	affected_groups.sort()
	if affected_groups.size() > BridgeConstants.MAX_NODE_GROUPS:
		return _failure(
			"INVALID_ARGUMENTS",
			"Group replacement would affect more than %d unique memberships"
			% BridgeConstants.MAX_NODE_GROUPS
		)
	var old_states: Dictionary = _capture_node_group_states(
		node,
		affected_groups,
		previous_groups
	)
	var desired_states: Dictionary = {}
	for raw_group_name in affected_groups:
		var group_name: String = str(raw_group_name)
		desired_states[group_name] = 2 if desired_groups.has(group_name) else 0

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)
	var action_name: String = (
		BridgeConstants.PRODUCT_NAME + ": Set groups on " + target_path
	)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		true,
		true
	)
	undo_redo.add_do_method(
		self,
		"_restore_node_group_states",
		node,
		desired_states
	)
	undo_redo.add_undo_method(
		self,
		"_restore_node_group_states",
		node,
		old_states
	)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	var target_plan: Dictionary = {
		"instance_id": node.get_instance_id(),
		"path": target_path,
		"parent": node.get_parent(),
		"owner": node.owner,
	}
	var after_snapshot: Dictionary = _node_group_snapshot(scene_root, node)
	var postconditions_met: bool = (
		_context.is_scene_unsaved(scene_root)
		and _node_group_target_matches(scene_root, node, target_plan)
		and after_snapshot["ok"]
		and after_snapshot["data"]["persistent_groups"] == desired_groups
		and _node_group_states_match(
			node,
			desired_states,
			after_snapshot["data"]["persistent_groups"]
		)
	)
	if not postconditions_met:
		if not _rollback_node_group_change(
			undo_redo,
			scene_root,
			node,
			target_plan,
			old_states,
			previous_groups,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Node group update failed and could not be safely undone"
			)
		return _failure(
			"NODE_GROUP_SET_FAILED",
			"Node groups did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"path": target_path,
			"previous_groups": previous_groups,
			"groups": after_snapshot["data"]["persistent_groups"],
			"added_groups": added_groups,
			"removed_groups": removed_groups,
			"scene_unsaved": true,
		}
	)


func _validate_node_group_list(raw_groups: Array) -> Dictionary:
	if raw_groups.size() > BridgeConstants.MAX_NODE_GROUPS:
		return _failure(
			"INVALID_ARGUMENTS",
			"groups must contain at most %d entries"
			% BridgeConstants.MAX_NODE_GROUPS
		)
	var groups: Array[String] = []
	var seen: Dictionary = {}
	for index in raw_groups.size():
		var validation: Dictionary = _validate_user_group_name(
			raw_groups[index],
			"Group %d" % index
		)
		if not validation["ok"]:
			return validation
		var group_name: String = validation["data"]["group"]
		if seen.has(group_name):
			return _failure(
				"INVALID_ARGUMENTS",
				"groups contains a duplicate entry: " + group_name
			)
		seen[group_name] = true
		groups.append(group_name)
	groups.sort()
	return _success({"groups": groups})


func _group_array_difference(left: Array, right: Array) -> Array[String]:
	var difference: Array[String] = []
	for raw_group_name in left:
		var group_name: String = str(raw_group_name)
		if not right.has(group_name):
			difference.append(group_name)
	difference.sort()
	return difference


func _capture_node_group_states(
	node: Node,
	group_names: Array,
	persistent_groups: Array
) -> Dictionary:
	var states: Dictionary = {}
	for raw_group_name in group_names:
		var group_name: String = str(raw_group_name)
		if persistent_groups.has(group_name):
			states[group_name] = 2
		elif node.is_in_group(StringName(group_name)):
			states[group_name] = 1
		else:
			states[group_name] = 0
	return states


func _restore_node_group_states(node: Node, states: Dictionary) -> void:
	if not is_instance_valid(node):
		return
	var group_names: Array = states.keys()
	group_names.sort()
	for raw_group_name in group_names:
		var group_name: String = str(raw_group_name)
		var string_name: StringName = StringName(group_name)
		if node.is_in_group(string_name):
			node.remove_from_group(string_name)
		match int(states[group_name]):
			2:
				node.add_to_group(string_name, true)
			1:
				node.add_to_group(string_name, false)


func _node_group_states_match(
	node: Node,
	expected_states: Dictionary,
	persistent_groups: Array
) -> bool:
	if not is_instance_valid(node):
		return false
	for raw_group_name in expected_states:
		var group_name: String = str(raw_group_name)
		var actual_state: int = 0
		if persistent_groups.has(group_name):
			actual_state = 2
		elif node.is_in_group(StringName(group_name)):
			actual_state = 1
		if actual_state != int(expected_states[group_name]):
			return false
	return true


func _node_group_target_matches(
	scene_root: Node,
	node: Node,
	plan: Dictionary
) -> bool:
	if (
		not is_instance_valid(scene_root)
		or not is_instance_valid(node)
		or node.get_instance_id() != int(plan["instance_id"])
		or node.get_parent() != plan["parent"]
		or node.owner != plan["owner"]
		or _relative_node_path(scene_root, node) != str(plan["path"])
	):
		return false
	var resolved_node: Node = (
		scene_root
		if str(plan["path"]) == "."
		else scene_root.get_node_or_null(NodePath(plan["path"]))
	)
	return resolved_node == node


func _rollback_node_group_change(
	undo_redo: EditorUndoRedoManager,
	scene_root: Node,
	node: Node,
	plan: Dictionary,
	old_states: Dictionary,
	previous_groups: Array,
	action_name: String
) -> bool:
	var history_id: int = undo_redo.get_object_history_id(scene_root)
	var history: UndoRedo = undo_redo.get_history_undo_redo(history_id)
	if (
		history != null
		and history.has_undo()
		and history.get_current_action_name() == action_name
	):
		if not history.undo():
			return false
	else:
		_restore_node_group_states(node, old_states)
	if not _node_group_target_matches(scene_root, node, plan):
		return false
	var snapshot: Dictionary = _node_group_snapshot(scene_root, node)
	return (
		snapshot["ok"]
		and snapshot["data"]["persistent_groups"] == previous_groups
		and _node_group_states_match(
			node,
			old_states,
			snapshot["data"]["persistent_groups"]
		)
	)


func _batch_set_node_properties(arguments: Dictionary) -> Dictionary:
	var raw_changes: Variant = arguments.get("changes", null)
	if not (raw_changes is Array):
		return _failure("INVALID_ARGUMENTS", "changes must be an array")
	var changes: Array = raw_changes
	if changes.is_empty():
		return _failure("INVALID_ARGUMENTS", "changes must not be empty")
	if changes.size() > BridgeConstants.MAX_BATCH_PROPERTY_CHANGES:
		return _failure(
			"INVALID_ARGUMENTS",
			(
				"changes must contain at most %d entries"
				% BridgeConstants.MAX_BATCH_PROPERTY_CHANGES
			)
		)

	var scene_root: Node = _context.edited_scene_root()
	var plans: Array[Dictionary] = []
	var seen_properties_by_node: Dictionary = {}
	var unique_node_ids: Dictionary = {}
	for index in changes.size():
		var raw_change: Variant = changes[index]
		if not (raw_change is Dictionary):
			return _failure(
				"INVALID_ARGUMENTS",
				"Change %d must be an object" % index
			)
		var change: Dictionary = raw_change
		if (
			not change.has("path")
			or not change.has("property")
			or not change.has("value")
			or typeof(change["path"]) != TYPE_STRING
			or typeof(change["property"]) != TYPE_STRING
		):
			return _failure(
				"INVALID_ARGUMENTS",
				"Change %d must contain string path and property fields plus value" % index
			)

		var resolved: Dictionary = BridgeNodePathGuard.resolve(
			scene_root,
			str(change["path"])
		)
		if not resolved["ok"]:
			return _batch_change_failure(index, resolved)
		var node: Node = resolved["node"]
		if node != scene_root and node.owner != scene_root:
			return _failure(
				"NODE_NOT_EDITABLE",
				(
					"Change %d target must be the scene root or a node owned by "
					+ "the scene root"
				) % index
			)

		var property_name: String = str(change["property"])
		var property_info: Dictionary = _find_editor_property(node, property_name)
		if property_info.is_empty():
			return _failure(
				"PROPERTY_NOT_FOUND",
				"Change %d editor-visible property not found: %s"
				% [index, property_name]
			)
		if (int(property_info["usage"]) & PROPERTY_USAGE_READ_ONLY) != 0:
			return _failure(
				"PROPERTY_READ_ONLY",
				"Change %d property is read-only: %s" % [index, property_name]
			)

		var property_type: int = int(property_info["type"])
		if not BridgeVariantCodec.is_supported_type(property_type):
			return _failure(
				"PROPERTY_TYPE_UNSUPPORTED",
				(
					"Change %d uses an unsupported property type for: %s"
					% [index, property_name]
				)
			)
		var conversion: Dictionary = BridgeVariantCodec.decode(
			change["value"],
			property_type
		)
		if not conversion["ok"]:
			return _batch_change_failure(index, conversion)

		var old_value: Variant = node.get(property_name)
		var encoded_old: Dictionary = BridgeVariantCodec.encode(
			old_value,
			property_type
		)
		if not encoded_old["ok"]:
			return _failure(
				"PROPERTY_VALUE_UNSUPPORTED",
				(
					"Change %d current value cannot be represented safely: %s"
					% [index, property_name]
				)
			)

		var instance_id: int = node.get_instance_id()
		var seen_properties: Dictionary = seen_properties_by_node.get(
			instance_id,
			{}
		)
		if seen_properties.has(property_name):
			return _failure(
				"INVALID_ARGUMENTS",
				(
					"Change %d duplicates node property: %s.%s"
					% [index, _relative_node_path(scene_root, node), property_name]
				)
			)
		seen_properties[property_name] = true
		seen_properties_by_node[instance_id] = seen_properties
		unique_node_ids[instance_id] = true

		var parent: Node = node.get_parent()
		plans.append(
			{
				"node": node,
				"instance_id": instance_id,
				"path": _relative_node_path(scene_root, node),
				"property": property_name,
				"property_type": property_type,
				"old_value": old_value,
				"new_value": conversion["value"],
				"parent": parent,
				"owner": node.owner,
				"name": str(node.name),
				"node_type": node.get_class(),
				"child_index": -1 if parent == null else node.get_index(false),
			}
		)

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)

	var action_name: String = (
		BridgeConstants.PRODUCT_NAME
		+ ": Set "
		+ str(plans.size())
		+ " node properties"
	)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		true,
		true
	)
	for plan in plans:
		undo_redo.add_do_property(
			plan["node"],
			plan["property"],
			plan["new_value"]
		)
		undo_redo.add_undo_property(
			plan["node"],
			plan["property"],
			plan["old_value"]
		)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	var output_changes: Array[Dictionary] = []
	var postconditions_met: bool = _context.is_scene_unsaved(scene_root)
	if postconditions_met:
		for plan in plans:
			if not _batch_change_target_matches(scene_root, plan):
				postconditions_met = false
				break
			var actual_value: Variant = plan["node"].get(plan["property"])
			if not BridgeVariantCodec.matches_type(
				actual_value,
				int(plan["property_type"])
			):
				postconditions_met = false
				break
			var encoded_actual: Dictionary = BridgeVariantCodec.encode(
				actual_value,
				int(plan["property_type"])
			)
			if not encoded_actual["ok"]:
				postconditions_met = false
				break
			output_changes.append(
				{
					"path": plan["path"],
					"property": plan["property"],
					"value": encoded_actual["value"],
					"value_type": type_string(typeof(actual_value)),
				}
			)

	if not postconditions_met:
		if not _rollback_batch_property_changes(
			undo_redo,
			scene_root,
			plans,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Property batch failed and could not be safely undone"
			)
		return _failure(
			"BATCH_PROPERTY_SET_FAILED",
			"Property batch did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"changes": output_changes,
			"change_count": plans.size(),
			"node_count": unique_node_ids.size(),
			"scene_unsaved": true,
		}
	)


func _batch_change_failure(index: int, result: Dictionary) -> Dictionary:
	var error: Dictionary = result.get("error", {})
	return _failure(
		str(error.get("code", "INTERNAL_ERROR")),
		"Change %d: %s" % [index, str(error.get("message", "validation failed"))],
		bool(error.get("retryable", false))
	)


func _batch_change_target_matches(
	scene_root: Node,
	plan: Dictionary
) -> bool:
	var node: Node = plan["node"]
	var parent: Node = plan["parent"]
	if (
		not is_instance_valid(scene_root)
		or not is_instance_valid(node)
		or node.get_instance_id() != int(plan["instance_id"])
		or node.get_parent() != parent
		or node.owner != plan["owner"]
		or str(node.name) != str(plan["name"])
		or node.get_class() != str(plan["node_type"])
		or _relative_node_path(scene_root, node) != str(plan["path"])
		or scene_root.get_node_or_null(NodePath(plan["path"])) != node
	):
		return false
	if parent != null:
		if (
			not is_instance_valid(parent)
			or not parent.get_children(false).has(node)
			or node.get_index(false) != int(plan["child_index"])
		):
			return false
	var property_info: Dictionary = _find_editor_property(
		node,
		str(plan["property"])
	)
	return (
		not property_info.is_empty()
		and int(property_info["type"]) == int(plan["property_type"])
		and (int(property_info["usage"]) & PROPERTY_USAGE_READ_ONLY) == 0
	)


func _rollback_batch_property_changes(
	undo_redo: EditorUndoRedoManager,
	scene_root: Node,
	plans: Array[Dictionary],
	action_name: String
) -> bool:
	var history_id: int = undo_redo.get_object_history_id(scene_root)
	var history: UndoRedo = undo_redo.get_history_undo_redo(history_id)
	if (
		history != null
		and history.has_undo()
		and history.get_current_action_name() == action_name
	):
		if not history.undo():
			return false
	else:
		for index in range(plans.size() - 1, -1, -1):
			var plan: Dictionary = plans[index]
			var node: Node = plan["node"]
			if is_instance_valid(node):
				node.set(plan["property"], plan["old_value"])

	for plan in plans:
		if not _batch_change_target_matches(scene_root, plan):
			return false
		var node: Node = plan["node"]
		if node.get(plan["property"]) != plan["old_value"]:
			return false
	return true


func _set_node_property(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var raw_path: String = str(arguments["path"])
	var resolved: Dictionary = BridgeNodePathGuard.resolve(scene_root, raw_path)
	if not resolved["ok"]:
		return resolved
	var node: Node = resolved["node"]
	if node != scene_root and node.owner != scene_root:
		return _failure(
			"NODE_NOT_EDITABLE",
			"Target must be the scene root or a node owned by the scene root"
		)

	var property_name: String = str(arguments["property"])
	var property_info: Dictionary = _find_editor_property(node, property_name)
	if property_info.is_empty():
		return _failure(
			"PROPERTY_NOT_FOUND",
			"Editor-visible property not found: " + property_name
		)
	if (int(property_info["usage"]) & PROPERTY_USAGE_READ_ONLY) != 0:
		return _failure("PROPERTY_READ_ONLY", "Property is read-only: " + property_name)

	var property_type: int = int(property_info["type"])
	if not BridgeVariantCodec.is_supported_type(property_type):
		return _failure(
			"PROPERTY_TYPE_UNSUPPORTED",
			(
				"Only safe scalar, Vector2/2i, Vector3/3i, Color, and Rect2/2i "
				+ "properties can be written"
			)
		)
	var conversion: Dictionary = BridgeVariantCodec.decode(
		arguments["value"],
		property_type
	)
	if not conversion["ok"]:
		return conversion

	var old_value: Variant = node.get(property_name)
	var new_value: Variant = conversion["value"]
	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	undo_redo.create_action(BridgeConstants.PRODUCT_NAME + ": Set " + property_name)
	undo_redo.add_do_property(node, property_name, new_value)
	undo_redo.add_undo_property(node, property_name, old_value)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)
	var actual_value: Variant = node.get(property_name)
	if not BridgeVariantCodec.matches_type(actual_value, property_type):
		return _failure(
			"INTERNAL_ERROR",
			"Property setter returned an unsupported value"
		)
	var encoded_actual: Dictionary = BridgeVariantCodec.encode(
		actual_value,
		property_type
	)
	if not encoded_actual["ok"]:
		return _failure(
			"INTERNAL_ERROR",
			"Property setter returned a value that cannot be safely encoded"
		)
	return _success(
		{
			"path": raw_path,
			"property": property_name,
			"value": encoded_actual["value"],
			"value_type": type_string(typeof(actual_value)),
			"scene_unsaved": _context.is_scene_unsaved(scene_root),
		}
	)


func _find_editor_property(node: Node, property_name: String) -> Dictionary:
	for property_info in node.get_property_list():
		if (
			str(property_info.get("name", "")) == property_name
			and (int(property_info.get("usage", 0)) & PROPERTY_USAGE_EDITOR) != 0
			and int(property_info.get("type", TYPE_NIL)) != TYPE_NIL
		):
			return property_info
	return {}


func _scene_tree_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"root": {
				"type": "object",
				"properties": {
					"path": {"type": "string"},
					"name": {"type": "string"},
					"type": {"type": "string"},
					"children": {
						"type": "array",
						"items": {"type": "object"},
					},
				},
				"required": ["path", "name", "type", "children"],
				"additionalProperties": false,
			},
			"node_count": {"type": "integer"},
			"truncated": {"type": "boolean"},
			"depth": {"type": "integer"},
			"max_nodes": {"type": "integer"},
		},
		"required": [
			"scene_path",
			"root",
			"node_count",
			"truncated",
			"depth",
			"max_nodes",
		],
		"additionalProperties": false,
	}


func _attach_script_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"path": {"type": "string"},
			"node_type": {"type": "string"},
			"owner_path": {"type": "string"},
			"script_path": {"type": "string"},
			"script_base_type": {"type": "string"},
			"script_global_name": {"type": "string"},
			"script_tool": {"type": "boolean"},
			"attached": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"path",
			"node_type",
			"owner_path",
			"script_path",
			"script_base_type",
			"script_global_name",
			"script_tool",
			"attached",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _create_node_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"parent_path": {"type": "string"},
			"path": {"type": "string"},
			"name": {"type": "string"},
			"type": {"type": "string"},
			"owner_path": {"type": "string"},
			"child_index": {"type": "integer", "minimum": 0},
			"created": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"parent_path",
			"path",
			"name",
			"type",
			"owner_path",
			"child_index",
			"created",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _delete_node_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"deleted_path": {"type": "string"},
			"parent_path": {"type": "string"},
			"name": {"type": "string"},
			"type": {"type": "string"},
			"owner_path": {"type": "string"},
			"child_index": {"type": "integer", "minimum": 0},
			"subtree_node_count": {"type": "integer", "minimum": 1},
			"deleted": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"deleted_path",
			"parent_path",
			"name",
			"type",
			"owner_path",
			"child_index",
			"subtree_node_count",
			"deleted",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _duplicate_node_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"source_path": {"type": "string"},
			"duplicate_path": {"type": "string"},
			"parent_path": {"type": "string"},
			"source_name": {"type": "string"},
			"new_name": {"type": "string"},
			"type": {"type": "string"},
			"owner_path": {"type": "string"},
			"source_child_index": {"type": "integer", "minimum": 0},
			"child_index": {"type": "integer", "minimum": 0},
			"subtree_node_count": {"type": "integer", "minimum": 1},
			"duplicated": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"source_path",
			"duplicate_path",
			"parent_path",
			"source_name",
			"new_name",
			"type",
			"owner_path",
			"source_child_index",
			"child_index",
			"subtree_node_count",
			"duplicated",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _instantiate_scene_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"instance_scene_path": {"type": "string"},
			"parent_path": {"type": "string"},
			"path": {"type": "string"},
			"name": {"type": "string"},
			"type": {"type": "string"},
			"owner_path": {"type": "string"},
			"child_index": {"type": "integer", "minimum": 0},
			"subtree_node_count": {"type": "integer", "minimum": 1},
			"instantiated": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"instance_scene_path",
			"parent_path",
			"path",
			"name",
			"type",
			"owner_path",
			"child_index",
			"subtree_node_count",
			"instantiated",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _rename_node_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"old_path": {"type": "string"},
			"new_path": {"type": "string"},
			"old_name": {"type": "string"},
			"new_name": {"type": "string"},
			"parent_path": {"type": "string"},
			"owner_path": {"type": "string"},
			"child_index": {"type": "integer", "minimum": 0},
			"renamed": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"old_path",
			"new_path",
			"old_name",
			"new_name",
			"parent_path",
			"owner_path",
			"child_index",
			"renamed",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _move_node_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"old_path": {"type": "string"},
			"new_path": {"type": "string"},
			"old_parent_path": {"type": "string"},
			"new_parent_path": {"type": "string"},
			"old_child_index": {"type": "integer", "minimum": 0},
			"new_child_index": {"type": "integer", "minimum": 0},
			"owner_path": {"type": "string"},
			"moved": {"type": "boolean"},
			"reparented": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"old_path",
			"new_path",
			"old_parent_path",
			"new_parent_path",
			"old_child_index",
			"new_child_index",
			"owner_path",
			"moved",
			"reparented",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _scene_nodes_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"scope_path": {"type": "string"},
			"nodes": {
				"type": "array",
				"items": {
					"type": "object",
					"properties": {
						"path": {"type": "string"},
						"parent_path": {"type": "string"},
						"name": {"type": "string"},
						"type": {"type": "string"},
						"owner_path": {"type": "string"},
						"editable": {"type": "boolean"},
						"child_count": {"type": "integer", "minimum": 0},
						"in_instanced_scene": {"type": "boolean"},
						"instance_root_path": {"type": "string"},
						"instance_scene_path": {"type": "string"},
						"instance_editable": {"type": "boolean"},
					},
					"required": [
						"path",
						"parent_path",
						"name",
						"type",
						"owner_path",
						"editable",
						"child_count",
						"in_instanced_scene",
						"instance_root_path",
						"instance_scene_path",
						"instance_editable",
					],
					"additionalProperties": false,
				},
			},
			"count": {"type": "integer", "minimum": 0},
			"scanned": {"type": "integer", "minimum": 0},
			"cursor": {"type": "integer", "minimum": 0},
			"limit": {"type": "integer", "minimum": 1},
			"truncated": {"type": "boolean"},
			"depth_truncated": {"type": "boolean"},
			"scan_truncated": {"type": "boolean"},
			"size_truncated": {"type": "boolean"},
			"next_cursor": {"type": ["integer", "null"], "minimum": 0},
		},
		"required": [
			"scene_path",
			"scope_path",
			"nodes",
			"count",
			"scanned",
			"cursor",
			"limit",
			"truncated",
			"depth_truncated",
			"scan_truncated",
			"size_truncated",
			"next_cursor",
		],
		"additionalProperties": false,
	}


func _node_groups_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"path": {"type": "string"},
			"editable": {"type": "boolean"},
			"groups": _group_name_array_schema(
				"All current non-internal group memberships."
			),
			"persistent_groups": _group_name_array_schema(
				"Memberships stored by the current edited scene."
			),
			"runtime_groups": _group_name_array_schema(
				"Current memberships not stored by the current edited scene."
			),
			"internal_groups": _group_name_array_schema(
				"Engine-reserved current memberships whose names start with underscore."
			),
		},
		"required": [
			"scene_path",
			"path",
			"editable",
			"groups",
			"persistent_groups",
			"runtime_groups",
			"internal_groups",
		],
		"additionalProperties": false,
	}


func _set_node_groups_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"path": {"type": "string"},
			"previous_groups": _group_name_array_schema(
				"Persistent user groups before the operation."
			),
			"groups": _group_name_array_schema(
				"Persistent user groups after the operation."
			),
			"added_groups": _group_name_array_schema(
				"Groups added or promoted to persistent membership."
			),
			"removed_groups": _group_name_array_schema(
				"Persistent groups removed from the node."
			),
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"path",
			"previous_groups",
			"groups",
			"added_groups",
			"removed_groups",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _group_name_array_schema(description: String) -> Dictionary:
	return {
		"type": "array",
		"items": {"type": "string"},
		"description": description,
	}


func _node_properties_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"path": {"type": "string"},
			"node_type": {"type": "string"},
			"properties": {
				"type": "array",
				"items": {
					"type": "object",
					"properties": {
						"name": {"type": "string"},
						"type": {"type": "string"},
						"class_name": {"type": "string"},
						"hint": {"type": "integer"},
						"hint_string": {"type": "string"},
						"usage": {"type": "integer"},
						"value_supported": {"type": "boolean"},
						"read_only": {"type": "boolean"},
						"value": BridgeVariantCodec.encoded_value_schema(),
					},
					"required": [
						"name",
						"type",
						"class_name",
						"hint",
						"hint_string",
						"usage",
						"value_supported",
						"read_only",
					],
					"additionalProperties": false,
				},
			},
			"truncated": {"type": "boolean"},
		},
		"required": ["path", "node_type", "properties", "truncated"],
		"additionalProperties": false,
	}


func _batch_set_node_properties_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"changes": {
				"type": "array",
				"minItems": 1,
				"maxItems": BridgeConstants.MAX_BATCH_PROPERTY_CHANGES,
				"items": {
					"type": "object",
					"properties": {
						"path": {"type": "string"},
						"property": {"type": "string"},
						"value": BridgeVariantCodec.encoded_value_schema(),
						"value_type": {"type": "string"},
					},
					"required": ["path", "property", "value", "value_type"],
					"additionalProperties": false,
				},
			},
			"change_count": {
				"type": "integer",
				"minimum": 1,
				"maximum": BridgeConstants.MAX_BATCH_PROPERTY_CHANGES,
			},
			"node_count": {
				"type": "integer",
				"minimum": 1,
				"maximum": BridgeConstants.MAX_BATCH_PROPERTY_CHANGES,
			},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"changes",
			"change_count",
			"node_count",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}
