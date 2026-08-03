class_name BridgeResourceTools
extends BridgeToolModule


func definitions() -> Array[BridgeToolDefinition]:
	return [
		_definition(
			"assign_resource_property",
			"Assign one existing project Resource to a safe local node property.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "Scene-root-relative node path, or '.' for the root.",
					},
					"property": {
						"type": "string",
						"description": "Editor-visible resource property name.",
					},
					"resource_path": {
						"type": "string",
						"description": "Normalized res:// path of an existing project resource.",
					},
				},
				"required": ["path", "property", "resource_path"],
				"additionalProperties": false,
			},
			_resource_assignment_schema(),
			"write",
			true,
			_assign_resource_property
		),
		_definition(
			"create_subresource_property",
			"Create and assign one new allowlisted built-in SubResource.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "Scene-root-relative node path, or '.' for the root.",
					},
					"property": {
						"type": "string",
						"description": "Editor-visible resource property name.",
					},
					"resource_type": {
						"type": "string",
						"description": "Exact allowlisted built-in Resource type.",
					},
					"properties": {
						"type": "array",
						"maxItems": BridgeConstants.MAX_SUBRESOURCE_PROPERTIES,
						"default": [],
						"items": {
							"type": "object",
							"properties": {
								"property": {"type": "string"},
								"value": BridgeVariantCodec.encoded_value_schema(),
							},
							"required": ["property", "value"],
							"additionalProperties": false,
						},
						"description": "Safe initial properties for the new unique Resource.",
					},
				},
				"required": ["path", "property", "resource_type"],
				"additionalProperties": false,
			},
			_subresource_creation_schema(),
			"write",
			true,
			_create_subresource_property
		),
		_definition(
			"inspect_resource",
			"Inspect one non-scripted project Resource and its safe property metadata.",
			{
				"type": "object",
				"properties": {
					"resource_path": {
						"type": "string",
						"description": "Normalized res:// path of one project resource.",
					},
					"properties": {
						"type": ["array", "null"],
						"items": {"type": "string"},
						"maxItems": BridgeConstants.MAX_PROPERTY_COUNT,
						"default": null,
						"description": "Optional editor-visible property name allowlist.",
					},
				},
				"required": ["resource_path"],
				"additionalProperties": false,
			},
			_resource_inspection_schema(),
			"read",
			false,
			_inspect_resource
		),
		_definition(
			"list_project_resources",
			"List a bounded, paginated EditorFileSystem resource snapshot.",
			{
				"type": "object",
				"properties": {
					"search_path": {
						"type": "string",
						"default": "res://",
						"description": "A res:// EditorFileSystem directory to scan recursively.",
					},
					"resource_types": {
						"type": "array",
						"items": {"type": "string"},
						"maxItems": BridgeConstants.MAX_RESOURCE_FILTERS,
						"default": [],
						"description": "Exact EditorFileSystem resource types; empty means all.",
					},
					"extensions": {
						"type": "array",
						"items": {"type": "string"},
						"maxItems": BridgeConstants.MAX_RESOURCE_FILTERS,
						"default": [],
						"description": "Lowercase extensions without dots; empty means all.",
					},
					"limit": {
						"type": "integer",
						"minimum": 1,
						"maximum": BridgeConstants.MAX_PROJECT_RESOURCES,
						"default": BridgeConstants.DEFAULT_PROJECT_RESOURCES,
					},
					"cursor": {
						"type": "integer",
						"minimum": 0,
						"maximum": BridgeConstants.MAX_RESOURCE_LIST_CURSOR,
						"default": 0,
					},
				},
				"additionalProperties": false,
			},
			_project_resources_schema(),
			"read",
			false,
			_list_project_resources
		),
	]


func _assign_resource_property(arguments: Dictionary) -> Dictionary:
	var target: Dictionary = _resolve_resource_property_target(arguments)
	if not target["ok"]:
		return target
	var loaded: Dictionary = _load_assignable_external_resource(
		str(arguments["resource_path"])
	)
	if not loaded["ok"]:
		return loaded

	var declared_type: String = str(target["declared_type"])
	var target_family: String = str(target["assignment_family"])
	var resource: Resource = loaded["resource"]
	var actual_type: String = str(loaded["resource_type"])
	var actual_family: String = str(loaded["assignment_family"])
	if (
		actual_family != target_family
		or not _class_inherits(actual_type, declared_type)
	):
		return _failure(
			"RESOURCE_TYPE_MISMATCH",
			"Resource type %s is incompatible with property type %s"
			% [actual_type, declared_type]
		)

	var node: Node = target["node"]
	var property_name: String = str(target["property"])
	var old_resource: Variant = target["old_resource"]
	if is_same(old_resource, resource):
		return _success(
			_resource_assignment_data(
				target,
				resource,
				str(loaded["resource_path"]),
				actual_type,
				actual_family,
				false
			)
		)

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)
	var scene_root: Node = target["scene_root"]
	var action_name: String = (
		BridgeConstants.PRODUCT_NAME + ": Assign " + property_name + " resource"
	)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		true,
		true
	)
	undo_redo.add_do_property(node, property_name, resource)
	undo_redo.add_undo_property(node, property_name, old_resource)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	if (
		not _resource_target_matches(scene_root, target)
		or not is_same(node.get(property_name), resource)
		or not _context.is_scene_unsaved(scene_root)
	):
		if not _rollback_resource_assignment(
			undo_redo,
			scene_root,
			target,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Resource assignment failed and could not be safely undone"
			)
		return _failure(
			"RESOURCE_ASSIGN_FAILED",
			"Resource assignment did not satisfy all editor postconditions"
		)

	return _success(
		_resource_assignment_data(
			target,
			resource,
			str(loaded["resource_path"]),
			actual_type,
			actual_family,
			true
		)
	)


func _create_subresource_property(arguments: Dictionary) -> Dictionary:
	var target: Dictionary = _resolve_resource_property_target(arguments)
	if not target["ok"]:
		return target
	var requested_type: String = str(arguments["resource_type"])
	if not BridgeResourceTypeGuard.is_creatable_subresource_type(requested_type):
		return _failure(
			"SUBRESOURCE_TYPE_UNSUPPORTED",
			"SubResource type is not in the v0.6 creation allowlist"
		)
	if (
		not ClassDB.class_exists(requested_type)
		or not ClassDB.can_instantiate(requested_type)
		or not ClassDB.is_parent_class(requested_type, "Resource")
	):
		return _failure(
			"SUBRESOURCE_TYPE_UNSUPPORTED",
			"SubResource type is not an instantiable engine Resource"
		)

	var declared_type: String = str(target["declared_type"])
	var target_family: String = str(target["assignment_family"])
	var requested_family: String = (
		BridgeResourceTypeGuard.assignment_family_for_class(requested_type)
	)
	if (
		requested_family != target_family
		or not _class_inherits(requested_type, declared_type)
	):
		return _failure(
			"RESOURCE_TYPE_MISMATCH",
			"SubResource type %s is incompatible with property type %s"
			% [requested_type, declared_type]
		)

	var created_value: Variant = ClassDB.instantiate(requested_type)
	if not (created_value is Resource):
		return _failure(
			"SUBRESOURCE_TYPE_UNSUPPORTED",
			"ClassDB did not create a Resource instance"
		)
	var created_resource: Resource = created_value
	if created_resource is Script or created_resource.get_script() != null:
		return _failure(
			"RESOURCE_SCRIPTED_UNSUPPORTED",
			"Scripted SubResources are not supported"
		)

	var configured: Dictionary = _configure_new_subresource(
		created_resource,
		arguments.get("properties", [])
	)
	if not configured["ok"]:
		return configured

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)
	var scene_root: Node = target["scene_root"]
	var node: Node = target["node"]
	var property_name: String = str(target["property"])
	var old_resource: Variant = target["old_resource"]
	var action_name: String = (
		BridgeConstants.PRODUCT_NAME + ": Create " + requested_type
	)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		scene_root,
		true,
		true
	)
	undo_redo.add_do_property(node, property_name, created_resource)
	undo_redo.add_undo_property(node, property_name, old_resource)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(scene_root)

	if (
		not _resource_target_matches(scene_root, target)
		or not is_same(node.get(property_name), created_resource)
		or not _context.is_scene_unsaved(scene_root)
	):
		if not _rollback_resource_assignment(
			undo_redo,
			scene_root,
			target,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"SubResource creation failed and could not be safely undone"
			)
		return _failure(
			"SUBRESOURCE_CREATE_FAILED",
			"SubResource assignment did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"path": str(target["path"]),
			"property": property_name,
			"property_resource_type": declared_type,
			"resource_type": requested_type,
			"assignment_family": requested_family,
			"configured_properties": configured["properties"],
			"property_count": (configured["properties"] as Array).size(),
			"previous_resource_path": _resource_path(old_resource),
			"previous_resource_type": _resource_type(old_resource),
			"replaced": old_resource != null,
			"embedded": true,
			"changed": true,
			"scene_unsaved": true,
		}
	)


func _list_project_resources(arguments: Dictionary) -> Dictionary:
	var validated_path: Dictionary = BridgeScenePathGuard.validate_directory_path(
		str(arguments.get("search_path", "res://"))
	)
	if not validated_path["ok"]:
		return validated_path
	var search_path: String = str(validated_path["path"])

	var type_filters: Dictionary = _normalize_filters(
		arguments.get("resource_types", []),
		false,
		"resource_types"
	)
	if not type_filters["ok"]:
		return type_filters
	var extension_filters: Dictionary = _normalize_filters(
		arguments.get("extensions", []),
		true,
		"extensions"
	)
	if not extension_filters["ok"]:
		return extension_filters

	var filesystem: EditorFileSystem = _context.resource_filesystem()
	if filesystem == null:
		return _failure("INTERNAL_ERROR", "EditorFileSystem is unavailable")
	var directory: EditorFileSystemDirectory = _filesystem_directory(
		filesystem,
		search_path
	)
	if directory == null:
		return _failure(
			"DIRECTORY_NOT_FOUND",
			"EditorFileSystem directory not found: " + search_path
		)

	var state: Dictionary = {
		"entries": [],
		"visited": 0,
		"depth_truncated": false,
		"scan_truncated": false,
		"stop": false,
	}
	_collect_resource_entries(directory, 0, state)
	var entries: Array = state["entries"]
	entries.sort_custom(
		func(left: Dictionary, right: Dictionary) -> bool:
			return str(left["resource_path"]) < str(right["resource_path"])
	)

	var resource_types: Array = type_filters["values"]
	var extensions: Array = extension_filters["values"]
	var matches: Array[Dictionary] = []
	for entry in entries:
		if (
			not resource_types.is_empty()
			and str(entry["resource_type"]) not in resource_types
		):
			continue
		if (
			not extensions.is_empty()
			and str(entry["extension"]) not in extensions
		):
			continue
		matches.append(entry)

	var limit: int = int(
		arguments.get("limit", BridgeConstants.DEFAULT_PROJECT_RESOURCES)
	)
	var cursor: int = int(arguments.get("cursor", 0))
	var resources: Array[Dictionary] = []
	var result_bytes: int = 2
	var size_truncated: bool = false
	var index: int = cursor
	while index < matches.size() and resources.size() < limit:
		var entry: Dictionary = matches[index]
		var separator_bytes: int = 0 if resources.is_empty() else 1
		var entry_bytes: int = JSON.stringify(entry).to_utf8_buffer().size()
		if (
			result_bytes + separator_bytes + entry_bytes
			> BridgeConstants.MAX_RESOURCE_LIST_RESULT_BYTES
		):
			size_truncated = true
			break
		resources.append(entry)
		result_bytes += separator_bytes + entry_bytes
		index += 1

	var has_more: bool = index < matches.size()
	var next_cursor: Variant = index if has_more else null
	var scanning: bool = filesystem.is_scanning()
	return _success(
		{
			"search_path": search_path,
			"resource_types": resource_types,
			"extensions": extensions,
			"resources": resources,
			"count": resources.size(),
			"cursor": cursor,
			"next_cursor": next_cursor,
			"truncated": (
				has_more
				or size_truncated
				or bool(state["depth_truncated"])
				or bool(state["scan_truncated"])
			),
			"filesystem_scanning": scanning,
			"filesystem_scan_progress": _scan_progress(filesystem, scanning),
		}
	)


func _inspect_resource(arguments: Dictionary) -> Dictionary:
	var validated_path: Dictionary = BridgeScenePathGuard.validate_resource_path(
		str(arguments["resource_path"])
	)
	if not validated_path["ok"]:
		return validated_path
	var resource_path: String = str(validated_path["path"])
	if not FileAccess.file_exists(resource_path):
		return _failure(
			"RESOURCE_NOT_FOUND",
			"Project resource file not found: " + resource_path
		)

	var filesystem: EditorFileSystem = _context.resource_filesystem()
	if filesystem == null:
		return _failure("INTERNAL_ERROR", "EditorFileSystem is unavailable")
	var metadata: Dictionary = _filesystem_file_metadata(filesystem, resource_path)
	if not metadata["ok"]:
		return metadata
	if not bool(metadata["import_valid"]):
		return _failure(
			"RESOURCE_LOAD_FAILED",
			"Resource import is not valid: " + resource_path
		)

	var filesystem_type: String = str(metadata["resource_type"])
	if (
		not str(metadata["script_class"]).is_empty()
		or BridgeResourceTypeGuard.is_script_class(filesystem_type)
		or BridgeResourceTypeGuard.is_project_global_script_class(filesystem_type)
		or BridgeResourceTypeGuard.text_resource_declares_script_class(
			resource_path
		)
	):
		return _failure(
			"RESOURCE_SCRIPTED_UNSUPPORTED",
			"Script and scripted resources are not inspectable"
		)
	if (
		filesystem_type.is_empty()
		or not ClassDB.class_exists(filesystem_type)
		or not ClassDB.is_parent_class(filesystem_type, "Resource")
	):
		return _failure(
			"RESOURCE_TYPE_UNSUPPORTED",
			"EditorFileSystem resource type is not a supported engine Resource"
		)

	var cached_before_load: bool = ResourceLoader.has_cached(resource_path)
	var loaded: Resource = ResourceLoader.load(
		resource_path,
		"",
		ResourceLoader.CACHE_MODE_IGNORE
	)
	if loaded == null:
		return _failure(
			"RESOURCE_LOAD_FAILED",
			"ResourceLoader could not load: " + resource_path
		)
	if loaded is Script or loaded.get_script() != null:
		return _failure(
			"RESOURCE_SCRIPTED_UNSUPPORTED",
			"Script and scripted resources are not inspectable"
		)

	var requested: Variant = arguments.get("properties", null)
	var requested_names: Array[String] = []
	if requested is Array:
		if requested.size() > BridgeConstants.MAX_PROPERTY_COUNT:
			return _failure(
				"INVALID_ARGUMENTS",
				"No more than %d properties may be requested"
				% BridgeConstants.MAX_PROPERTY_COUNT
			)
		for raw_name in requested:
			if typeof(raw_name) != TYPE_STRING or str(raw_name).is_empty():
				return _failure(
					"INVALID_ARGUMENTS",
					"properties must contain non-empty strings"
				)
			if str(raw_name) not in requested_names:
				requested_names.append(str(raw_name))

	var visible_properties: Dictionary = {}
	for raw_property_info in loaded.get_property_list():
		var property_info: Dictionary = raw_property_info
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
					"RESOURCE_PROPERTY_UNSUPPORTED",
					"Editor-visible Resource property not found: " + requested_name
				)

	var names: Array = visible_properties.keys()
	names.sort()
	if requested is Array:
		names = requested_names
	var properties: Array[Dictionary] = []
	var result_bytes: int = 2
	var result_truncated: bool = false
	for property_name in names:
		if properties.size() >= BridgeConstants.MAX_PROPERTY_COUNT:
			result_truncated = true
			break
		var serialized: Dictionary = _serialize_resource_property(
			loaded,
			visible_properties[property_name]
		)
		var separator_bytes: int = 0 if properties.is_empty() else 1
		var serialized_bytes: int = JSON.stringify(serialized).to_utf8_buffer().size()
		if (
			result_bytes + separator_bytes + serialized_bytes
			> BridgeConstants.MAX_RESOURCE_INSPECT_RESULT_BYTES
		):
			result_truncated = true
			break
		properties.append(serialized)
		result_bytes += separator_bytes + serialized_bytes

	var actual_type: String = loaded.get_class()
	var assignment_family: String = (
		BridgeResourceTypeGuard.assignment_family_for_class(actual_type)
	)
	var scanning: bool = filesystem.is_scanning()
	return _success(
		{
			"resource_path": resource_path,
			"file_name": resource_path.get_file(),
			"extension": resource_path.get_extension().to_lower(),
			"filesystem_type": filesystem_type,
			"resource_type": actual_type,
			"import_valid": bool(metadata["import_valid"]),
			"resource_name": loaded.resource_name,
			"local_to_scene": loaded.resource_local_to_scene,
			"cached_before_load": cached_before_load,
			"assignable": not assignment_family.is_empty(),
			"assignment_family": (
				assignment_family if not assignment_family.is_empty() else null
			),
			"properties": properties,
			"truncated": result_truncated or names.size() > properties.size(),
			"filesystem_scanning": scanning,
			"filesystem_scan_progress": _scan_progress(filesystem, scanning),
		}
	)


func _resolve_resource_property_target(arguments: Dictionary) -> Dictionary:
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

	var property_name: String = str(arguments["property"])
	var property_info: Dictionary = _find_editor_property(node, property_name)
	if property_info.is_empty():
		return _failure(
			"PROPERTY_NOT_FOUND",
			"Editor-visible property not found: " + property_name
		)
	if (int(property_info["usage"]) & PROPERTY_USAGE_READ_ONLY) != 0:
		return _failure(
			"PROPERTY_READ_ONLY",
			"Property is read-only: " + property_name
		)
	if property_name == "script":
		return _failure(
			"RESOURCE_PROPERTY_UNSUPPORTED",
			"The script property is only writable through attach_script"
		)

	var declared_type: String = (
		BridgeResourceTypeGuard.declared_resource_type(property_info)
	)
	var assignment_family: String = (
		BridgeResourceTypeGuard.assignment_family_for_class(declared_type)
	)
	if declared_type.is_empty() or assignment_family.is_empty():
		return _failure(
			"RESOURCE_PROPERTY_UNSUPPORTED",
			"Property must declare one supported non-generic Resource type"
		)
	var old_resource: Variant = node.get(property_name)
	if old_resource != null and not (old_resource is Resource):
		return _failure(
			"RESOURCE_PROPERTY_UNSUPPORTED",
			"Current property value is not null or a Resource"
		)

	var parent: Node = node.get_parent()
	return {
		"ok": true,
		"scene_root": scene_root,
		"node": node,
		"instance_id": node.get_instance_id(),
		"path": _relative_node_path(scene_root, node),
		"property": property_name,
		"property_info": property_info,
		"declared_type": declared_type,
		"assignment_family": assignment_family,
		"old_resource": old_resource,
		"parent": parent,
		"owner": node.owner,
		"name": str(node.name),
		"node_type": node.get_class(),
		"child_index": -1 if parent == null else node.get_index(false),
	}


func _load_assignable_external_resource(raw_path: String) -> Dictionary:
	var validated_path: Dictionary = BridgeScenePathGuard.validate_resource_path(
		raw_path
	)
	if not validated_path["ok"]:
		return validated_path
	var resource_path: String = str(validated_path["path"])
	if not FileAccess.file_exists(resource_path):
		return _failure(
			"RESOURCE_NOT_FOUND",
			"Project resource file not found: " + resource_path
		)
	var filesystem: EditorFileSystem = _context.resource_filesystem()
	if filesystem == null:
		return _failure("INTERNAL_ERROR", "EditorFileSystem is unavailable")
	var metadata: Dictionary = _filesystem_file_metadata(filesystem, resource_path)
	if not metadata["ok"]:
		return metadata
	if not bool(metadata["import_valid"]):
		return _failure(
			"RESOURCE_LOAD_FAILED",
			"Resource import is not valid: " + resource_path
		)
	var filesystem_type: String = str(metadata["resource_type"])
	if (
		not str(metadata["script_class"]).is_empty()
		or BridgeResourceTypeGuard.is_script_class(filesystem_type)
		or BridgeResourceTypeGuard.is_project_global_script_class(filesystem_type)
		or BridgeResourceTypeGuard.text_resource_declares_script_class(
			resource_path
		)
	):
		return _failure(
			"RESOURCE_SCRIPTED_UNSUPPORTED",
			"Script and scripted resources cannot be assigned"
		)
	var filesystem_family: String = (
		BridgeResourceTypeGuard.assignment_family_for_class(filesystem_type)
	)
	if filesystem_family.is_empty():
		return _failure(
			"RESOURCE_TYPE_UNSUPPORTED",
			"External resource type is outside the v0.6 assignment allowlist"
		)

	var loaded: Resource = ResourceLoader.load(resource_path)
	if loaded == null or loaded.resource_path != resource_path:
		return _failure(
			"RESOURCE_LOAD_FAILED",
			"ResourceLoader could not load the exact project resource"
		)
	if loaded is Script or loaded.get_script() != null:
		return _failure(
			"RESOURCE_SCRIPTED_UNSUPPORTED",
			"Script and scripted resources cannot be assigned"
		)
	var actual_type: String = loaded.get_class()
	var actual_family: String = (
		BridgeResourceTypeGuard.assignment_family_for_class(actual_type)
	)
	if actual_family.is_empty() or actual_family != filesystem_family:
		return _failure(
			"RESOURCE_TYPE_UNSUPPORTED",
			"Loaded Resource type is outside the v0.6 assignment allowlist"
		)
	return {
		"ok": true,
		"resource": loaded,
		"resource_path": resource_path,
		"resource_type": actual_type,
		"assignment_family": actual_family,
	}


func _configure_new_subresource(
	resource: Resource,
	raw_properties: Variant
) -> Dictionary:
	if not (raw_properties is Array):
		return _failure("INVALID_ARGUMENTS", "properties must be an array")
	var properties: Array = raw_properties
	if properties.size() > BridgeConstants.MAX_SUBRESOURCE_PROPERTIES:
		return _failure(
			"INVALID_ARGUMENTS",
			"properties must contain at most %d entries"
			% BridgeConstants.MAX_SUBRESOURCE_PROPERTIES
		)
	var plans: Array[Dictionary] = []
	var seen: Dictionary = {}
	for index in properties.size():
		var raw_entry: Variant = properties[index]
		if not (raw_entry is Dictionary):
			return _failure(
				"INVALID_ARGUMENTS",
				"SubResource property %d must be an object" % index
			)
		var entry: Dictionary = raw_entry
		if (
			entry.size() != 2
			or not entry.has("property")
			or not entry.has("value")
			or typeof(entry["property"]) != TYPE_STRING
		):
			return _failure(
				"INVALID_ARGUMENTS",
				"SubResource property %d requires only property and value" % index
			)
		var property_name: String = str(entry["property"])
		if property_name.is_empty() or property_name in [
			"script",
			"resource_path",
			"resource_scene_unique_id",
		]:
			return _failure(
				"RESOURCE_PROPERTY_UNSUPPORTED",
				"SubResource property is reserved or empty: " + property_name
			)
		if seen.has(property_name):
			return _failure(
				"INVALID_ARGUMENTS",
				"SubResource properties must not contain duplicates"
			)
		seen[property_name] = true

		var property_info: Dictionary = _find_editor_property(
			resource,
			property_name
		)
		if property_info.is_empty():
			return _failure(
				"RESOURCE_PROPERTY_UNSUPPORTED",
				"Editor-visible SubResource property not found: " + property_name
			)
		if (int(property_info["usage"]) & PROPERTY_USAGE_READ_ONLY) != 0:
			return _failure(
				"PROPERTY_READ_ONLY",
				"SubResource property is read-only: " + property_name
			)
		var property_type: int = int(property_info["type"])
		if not BridgeVariantCodec.is_supported_type(property_type):
			return _failure(
				"RESOURCE_PROPERTY_UNSUPPORTED",
				"SubResource property type is outside the safe value set: "
				+ property_name
			)
		var conversion: Dictionary = BridgeVariantCodec.decode(
			entry["value"],
			property_type
		)
		if not conversion["ok"]:
			return _indexed_property_failure(index, conversion)
		plans.append(
			{
				"property": property_name,
				"property_type": property_type,
				"value": conversion["value"],
			}
		)

	var output: Array[Dictionary] = []
	for index in plans.size():
		var plan: Dictionary = plans[index]
		resource.set(plan["property"], plan["value"])
		var actual_value: Variant = resource.get(plan["property"])
		if (
			not BridgeVariantCodec.matches_type(
				actual_value,
				int(plan["property_type"])
			)
			or actual_value != plan["value"]
		):
			return _failure(
				"RESOURCE_PROPERTY_UNSUPPORTED",
				"SubResource setter did not preserve requested value: "
				+ str(plan["property"])
			)
		var encoded: Dictionary = BridgeVariantCodec.encode(
			actual_value,
			int(plan["property_type"])
		)
		if not encoded["ok"]:
			return _failure(
				"RESOURCE_PROPERTY_UNSUPPORTED",
				"SubResource property cannot be safely represented"
			)
		output.append(
			{
				"property": plan["property"],
				"value": encoded["value"],
				"value_type": type_string(typeof(actual_value)),
			}
		)
	return {"ok": true, "properties": output}


func _indexed_property_failure(index: int, result: Dictionary) -> Dictionary:
	var error: Dictionary = result.get("error", {})
	return _failure(
		str(error.get("code", "INTERNAL_ERROR")),
		"SubResource property %d: %s"
		% [index, str(error.get("message", "validation failed"))],
		bool(error.get("retryable", false))
	)


func _resource_target_matches(scene_root: Node, target: Dictionary) -> bool:
	var node: Node = target["node"]
	var parent: Node = target["parent"]
	if (
		not is_instance_valid(scene_root)
		or not is_instance_valid(node)
		or node.get_instance_id() != int(target["instance_id"])
		or node.get_parent() != parent
		or node.owner != target["owner"]
		or str(node.name) != str(target["name"])
		or node.get_class() != str(target["node_type"])
		or _relative_node_path(scene_root, node) != str(target["path"])
		or (
			node != scene_root
			and scene_root.get_node_or_null(NodePath(target["path"])) != node
		)
	):
		return false
	if parent != null and (
		not is_instance_valid(parent)
		or not parent.get_children(false).has(node)
		or node.get_index(false) != int(target["child_index"])
	):
		return false
	var property_info: Dictionary = _find_editor_property(
		node,
		str(target["property"])
	)
	return (
		not property_info.is_empty()
		and (int(property_info["usage"]) & PROPERTY_USAGE_READ_ONLY) == 0
		and BridgeResourceTypeGuard.declared_resource_type(property_info)
		== str(target["declared_type"])
	)


func _rollback_resource_assignment(
	undo_redo: EditorUndoRedoManager,
	scene_root: Node,
	target: Dictionary,
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
		var node: Node = target["node"]
		if is_instance_valid(node):
			node.set(target["property"], target["old_resource"])
	return (
		_resource_target_matches(scene_root, target)
		and is_same(
			(target["node"] as Node).get(target["property"]),
			target["old_resource"]
		)
	)


func _resource_assignment_data(
	target: Dictionary,
	resource: Resource,
	resource_path: String,
	resource_type: String,
	assignment_family: String,
	changed: bool
) -> Dictionary:
	var old_resource: Variant = target["old_resource"]
	return {
		"scene_path": (target["scene_root"] as Node).scene_file_path,
		"path": str(target["path"]),
		"property": str(target["property"]),
		"property_resource_type": str(target["declared_type"]),
		"resource_path": resource_path,
		"resource_type": resource_type,
		"assignment_family": assignment_family,
		"previous_resource_path": _resource_path(old_resource),
		"previous_resource_type": _resource_type(old_resource),
		"replaced": old_resource != null,
		"changed": changed,
		"scene_unsaved": _context.is_scene_unsaved(target["scene_root"]),
	}


func _find_editor_property(object: Object, property_name: String) -> Dictionary:
	for raw_property_info in object.get_property_list():
		var property_info: Dictionary = raw_property_info
		if (
			str(property_info.get("name", "")) == property_name
			and (int(property_info.get("usage", 0)) & PROPERTY_USAGE_EDITOR) != 0
			and int(property_info.get("type", TYPE_NIL)) != TYPE_NIL
		):
			return property_info
	return {}


func _relative_node_path(scene_root: Node, node: Node) -> String:
	return "." if node == scene_root else str(scene_root.get_path_to(node))


func _class_inherits(type_name: String, parent_type: String) -> bool:
	return (
		type_name == parent_type
		or (
			ClassDB.class_exists(type_name)
			and ClassDB.class_exists(parent_type)
			and ClassDB.is_parent_class(type_name, parent_type)
		)
	)


func _resource_path(value: Variant) -> String:
	return value.resource_path if value is Resource else ""


func _resource_type(value: Variant) -> String:
	return value.get_class() if value is Resource else ""


func _collect_resource_entries(
	directory: EditorFileSystemDirectory,
	depth: int,
	state: Dictionary
) -> void:
	if bool(state["stop"]):
		return
	for file_index in directory.get_file_count():
		if int(state["visited"]) >= BridgeConstants.MAX_RESOURCE_SCAN_ENTRIES:
			state["scan_truncated"] = true
			state["stop"] = true
			return
		state["visited"] = int(state["visited"]) + 1
		var resource_type: String = str(directory.get_file_type(file_index))
		var assignment_family: String = (
			BridgeResourceTypeGuard.assignment_family_for_class(resource_type)
		)
		var resource_path: String = directory.get_file_path(file_index)
		state["entries"].append(
			{
				"resource_path": resource_path,
				"file_name": directory.get_file(file_index),
				"extension": resource_path.get_extension().to_lower(),
				"resource_type": resource_type,
				"import_valid": directory.get_file_import_is_valid(file_index),
				"script_class": directory.get_file_script_class_name(file_index),
				"script_base": directory.get_file_script_class_extends(file_index),
				"assignable": not assignment_family.is_empty(),
				"assignment_family": (
					assignment_family if not assignment_family.is_empty() else null
				),
			}
		)

	if depth >= BridgeConstants.MAX_RESOURCE_SCAN_DEPTH:
		if directory.get_subdir_count() > 0:
			state["depth_truncated"] = true
		return
	for subdir_index in directory.get_subdir_count():
		if int(state["visited"]) >= BridgeConstants.MAX_RESOURCE_SCAN_ENTRIES:
			state["scan_truncated"] = true
			state["stop"] = true
			return
		var subdirectory: EditorFileSystemDirectory = directory.get_subdir(
			subdir_index
		)
		if subdirectory == null or subdirectory.get_name() == ".godot":
			continue
		state["visited"] = int(state["visited"]) + 1
		_collect_resource_entries(subdirectory, depth + 1, state)
		if bool(state["stop"]):
			return


func _filesystem_directory(
	filesystem: EditorFileSystem,
	search_path: String
) -> EditorFileSystemDirectory:
	var directory: EditorFileSystemDirectory = (
		filesystem.get_filesystem()
		if search_path == "res://"
		else filesystem.get_filesystem_path(search_path)
	)
	if directory == null:
		return null
	var actual_path: String = str(directory.get_path()).trim_suffix("/")
	var expected_path: String = search_path.trim_suffix("/")
	if actual_path != expected_path:
		return null
	return directory


func _filesystem_file_metadata(
	filesystem: EditorFileSystem,
	resource_path: String
) -> Dictionary:
	var directory_path: String = resource_path.get_base_dir()
	var directory: EditorFileSystemDirectory = _filesystem_directory(
		filesystem,
		directory_path
	)
	if directory == null:
		return _failure(
			"RESOURCE_NOT_FOUND",
			"Resource directory is not present in EditorFileSystem"
		)
	var file_index: int = directory.find_file_index(resource_path.get_file())
	if (
		file_index < 0
		or directory.get_file_path(file_index) != resource_path
	):
		return _failure(
			"RESOURCE_NOT_FOUND",
			"Resource is not present in EditorFileSystem: " + resource_path
		)
	return {
		"ok": true,
		"resource_type": str(directory.get_file_type(file_index)),
		"import_valid": directory.get_file_import_is_valid(file_index),
		"script_class": directory.get_file_script_class_name(file_index),
		"script_base": directory.get_file_script_class_extends(file_index),
	}


func _normalize_filters(
	raw_filters: Variant,
	lowercase: bool,
	label: String
) -> Dictionary:
	if not (raw_filters is Array):
		return _failure("INVALID_ARGUMENTS", label + " must be an array")
	if raw_filters.size() > BridgeConstants.MAX_RESOURCE_FILTERS:
		return _failure(
			"INVALID_ARGUMENTS",
			"%s must contain at most %d entries"
			% [label, BridgeConstants.MAX_RESOURCE_FILTERS]
		)
	var values: Array[String] = []
	for raw_value in raw_filters:
		if typeof(raw_value) != TYPE_STRING:
			return _failure(
				"INVALID_ARGUMENTS",
				label + " must contain only strings"
			)
		var value: String = str(raw_value)
		if (
			value.is_empty()
			or value != value.strip_edges()
			or value.length() > BridgeConstants.MAX_RESOURCE_FILTER_LENGTH
			or value.contains("\n")
			or value.contains("\r")
			or value.contains("\t")
		):
			return _failure(
				"INVALID_ARGUMENTS",
				label + " contains an invalid filter"
			)
		if lowercase and (
			value != value.to_lower()
			or value.contains(".")
			or value.contains("/")
			or value.contains("\\")
			or value.contains(":")
			or value.contains(" ")
		):
			return _failure(
				"INVALID_ARGUMENTS",
				"extensions must be lowercase names without dots"
			)
		if value in values:
			return _failure(
				"INVALID_ARGUMENTS",
				label + " must not contain duplicate filters"
			)
		values.append(value)
	values.sort()
	return {"ok": true, "values": values}


func _serialize_resource_property(
	resource: Resource,
	property_info: Dictionary
) -> Dictionary:
	var property_name: String = str(property_info["name"])
	var property_type: int = int(property_info["type"])
	var encoded: Dictionary = BridgeVariantCodec.encode(
		resource.get(property_name),
		property_type
	)
	if encoded["ok"]:
		var encoded_bytes: int = JSON.stringify(
			encoded["value"]
		).to_utf8_buffer().size()
		if encoded_bytes > BridgeConstants.MAX_RESOURCE_PROPERTY_VALUE_BYTES:
			encoded = BridgeToolResults.failure(
				"PROPERTY_VALUE_UNSUPPORTED",
				"Resource property value exceeds the safe output bound"
			)
	var result: Dictionary = {
		"name": property_name,
		"type": type_string(property_type),
		"class_name": str(property_info.get("class_name", "")),
		"hint": int(property_info.get("hint", PROPERTY_HINT_NONE)),
		"hint_string": str(property_info.get("hint_string", "")),
		"usage": int(property_info.get("usage", 0)),
		"value_supported": encoded["ok"],
		"read_only": (
			int(property_info.get("usage", 0)) & PROPERTY_USAGE_READ_ONLY
		) != 0,
	}
	if encoded["ok"]:
		result["value"] = encoded["value"]
	return result


func _scan_progress(filesystem: EditorFileSystem, scanning: bool) -> float:
	if not scanning:
		return 1.0
	var progress: float = filesystem.get_scanning_progress()
	return clampf(progress, 0.0, 1.0) if is_finite(progress) else 0.0


func _assignment_family_schema() -> Dictionary:
	return {
		"type": ["string", "null"],
		"enum": BridgeResourceTypeGuard.ASSIGNABLE_RESOURCE_FAMILIES + [null],
	}


func _required_assignment_family_schema() -> Dictionary:
	return {
		"type": "string",
		"enum": BridgeResourceTypeGuard.ASSIGNABLE_RESOURCE_FAMILIES,
	}


func _resource_assignment_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"path": {"type": "string"},
			"property": {"type": "string"},
			"property_resource_type": {"type": "string"},
			"resource_path": {"type": "string"},
			"resource_type": {"type": "string"},
			"assignment_family": _required_assignment_family_schema(),
			"previous_resource_path": {"type": "string"},
			"previous_resource_type": {"type": "string"},
			"replaced": {"type": "boolean"},
			"changed": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"path",
			"property",
			"property_resource_type",
			"resource_path",
			"resource_type",
			"assignment_family",
			"previous_resource_path",
			"previous_resource_type",
			"replaced",
			"changed",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _configured_subresource_property_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"property": {"type": "string"},
			"value": BridgeVariantCodec.encoded_value_schema(),
			"value_type": {"type": "string"},
		},
		"required": ["property", "value", "value_type"],
		"additionalProperties": false,
	}


func _subresource_creation_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"path": {"type": "string"},
			"property": {"type": "string"},
			"property_resource_type": {"type": "string"},
			"resource_type": {
				"type": "string",
				"enum": BridgeResourceTypeGuard.CREATABLE_SUBRESOURCE_TYPES,
			},
			"assignment_family": _required_assignment_family_schema(),
			"configured_properties": {
				"type": "array",
				"maxItems": BridgeConstants.MAX_SUBRESOURCE_PROPERTIES,
				"items": _configured_subresource_property_schema(),
			},
			"property_count": {
				"type": "integer",
				"minimum": 0,
				"maximum": BridgeConstants.MAX_SUBRESOURCE_PROPERTIES,
			},
			"previous_resource_path": {"type": "string"},
			"previous_resource_type": {"type": "string"},
			"replaced": {"type": "boolean"},
			"embedded": {"type": "boolean"},
			"changed": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"path",
			"property",
			"property_resource_type",
			"resource_type",
			"assignment_family",
			"configured_properties",
			"property_count",
			"previous_resource_path",
			"previous_resource_type",
			"replaced",
			"embedded",
			"changed",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _resource_entry_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"resource_path": {"type": "string"},
			"file_name": {"type": "string"},
			"extension": {"type": "string"},
			"resource_type": {"type": "string"},
			"import_valid": {"type": "boolean"},
			"script_class": {"type": "string"},
			"script_base": {"type": "string"},
			"assignable": {"type": "boolean"},
			"assignment_family": _assignment_family_schema(),
		},
		"required": [
			"resource_path",
			"file_name",
			"extension",
			"resource_type",
			"import_valid",
			"script_class",
			"script_base",
			"assignable",
			"assignment_family",
		],
		"additionalProperties": false,
	}


func _project_resources_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"search_path": {"type": "string"},
			"resource_types": {
				"type": "array",
				"items": {"type": "string"},
			},
			"extensions": {
				"type": "array",
				"items": {"type": "string"},
			},
			"resources": {
				"type": "array",
				"maxItems": BridgeConstants.MAX_PROJECT_RESOURCES,
				"items": _resource_entry_schema(),
			},
			"count": {
				"type": "integer",
				"minimum": 0,
				"maximum": BridgeConstants.MAX_PROJECT_RESOURCES,
			},
			"cursor": {"type": "integer", "minimum": 0},
			"next_cursor": {"type": ["integer", "null"], "minimum": 0},
			"truncated": {"type": "boolean"},
			"filesystem_scanning": {"type": "boolean"},
			"filesystem_scan_progress": {
				"type": "number",
				"minimum": 0.0,
				"maximum": 1.0,
			},
		},
		"required": [
			"search_path",
			"resource_types",
			"extensions",
			"resources",
			"count",
			"cursor",
			"next_cursor",
			"truncated",
			"filesystem_scanning",
			"filesystem_scan_progress",
		],
		"additionalProperties": false,
	}


func _resource_property_schema() -> Dictionary:
	return {
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
	}


func _resource_inspection_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"resource_path": {"type": "string"},
			"file_name": {"type": "string"},
			"extension": {"type": "string"},
			"filesystem_type": {"type": "string"},
			"resource_type": {"type": "string"},
			"import_valid": {"type": "boolean"},
			"resource_name": {"type": "string"},
			"local_to_scene": {"type": "boolean"},
			"cached_before_load": {"type": "boolean"},
			"assignable": {"type": "boolean"},
			"assignment_family": _assignment_family_schema(),
			"properties": {
				"type": "array",
				"maxItems": BridgeConstants.MAX_PROPERTY_COUNT,
				"items": _resource_property_schema(),
			},
			"truncated": {"type": "boolean"},
			"filesystem_scanning": {"type": "boolean"},
			"filesystem_scan_progress": {
				"type": "number",
				"minimum": 0.0,
				"maximum": 1.0,
			},
		},
		"required": [
			"resource_path",
			"file_name",
			"extension",
			"filesystem_type",
			"resource_type",
			"import_valid",
			"resource_name",
			"local_to_scene",
			"cached_before_load",
			"assignable",
			"assignment_family",
			"properties",
			"truncated",
			"filesystem_scanning",
			"filesystem_scan_progress",
		],
		"additionalProperties": false,
	}
