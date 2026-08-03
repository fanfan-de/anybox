class_name BridgeSceneTools
extends BridgeToolModule


func definitions() -> Array[BridgeToolDefinition]:
	return [
		_definition(
			"create_scene",
			"Create a new project-local text scene without opening it.",
			{
				"type": "object",
				"properties": {
					"scene_path": {
						"type": "string",
						"description": "A new res:// path using the .tscn extension.",
					},
					"root_type": {
						"type": "string",
						"default": "Node",
						"description": "An instantiable built-in Node class.",
					},
					"root_name": {
						"type": ["string", "null"],
						"default": null,
						"description": "Optional root node name; defaults to the file name.",
					},
				},
				"required": ["scene_path"],
				"additionalProperties": false,
			},
			_created_scene_schema(),
			"write",
			true,
			_create_scene
		),
		_definition(
			"save_scene",
			"Save the active scene, optionally to a new project-local path.",
			{
				"type": "object",
				"properties": {
					"scene_path": {
						"type": ["string", "null"],
						"default": null,
						"description": "Optional res:// save-as path.",
					},
					"overwrite": {
						"type": "boolean",
						"default": false,
						"description": "Allow replacing another existing scene file.",
					},
				},
				"additionalProperties": false,
			},
			_saved_scene_schema(),
			"write",
			true,
			_save_scene
		),
		_definition(
			"open_scene",
			"Open and activate an existing project-local scene.",
			{
				"type": "object",
				"properties": {
					"scene_path": {
						"type": "string",
						"description": "An existing res:// .tscn or .scn path.",
					},
				},
				"required": ["scene_path"],
				"additionalProperties": false,
			},
			_opened_scene_schema(),
			"write",
			true,
			_open_scene
		),
		_definition(
			"list_project_scenes",
			"List project-local .tscn and .scn files beneath a directory.",
			{
				"type": "object",
				"properties": {
					"search_path": {
						"type": "string",
						"default": "res://",
						"description": "A res:// directory to scan recursively.",
					},
					"max_results": {
						"type": "integer",
						"minimum": 1,
						"maximum": BridgeConstants.MAX_PROJECT_SCENES,
						"default": BridgeConstants.DEFAULT_PROJECT_SCENES,
						"description": "Maximum number of scene paths returned.",
					},
				},
				"additionalProperties": false,
			},
			_project_scenes_schema(),
			"read",
			false,
			_list_project_scenes
		),
		_definition(
			"list_open_scenes",
			"List open scene tabs and identify the active and unsaved scenes.",
			_empty_object_schema(),
			_open_scenes_schema(),
			"read",
			false,
			_list_open_scenes
		),
		_definition(
			"close_scene_tab",
			"Close the active or selected scene tab with an unsaved-change guard.",
			{
				"type": "object",
				"properties": {
					"scene_path": {
						"type": ["string", "null"],
						"default": null,
						"description": "Optional open scene path; null selects the active tab.",
					},
					"discard_unsaved": {
						"type": "boolean",
						"default": false,
						"description": "Explicitly allow discarding unsaved changes.",
					},
				},
				"additionalProperties": false,
			},
			_closed_scene_schema(),
			"write",
			true,
			_close_scene_tab
		),
		_definition(
			"get_current_scene",
			"Read the currently edited scene without opening or saving a scene.",
			_empty_object_schema(),
			_current_scene_schema(),
			"read",
			false,
			_get_current_scene
		),
	]


func _create_scene(arguments: Dictionary) -> Dictionary:
	var validated_path: Dictionary = BridgeScenePathGuard.validate_scene_path(
		str(arguments["scene_path"]),
		true
	)
	if not validated_path["ok"]:
		return validated_path
	var scene_path: String = str(validated_path["path"])
	if FileAccess.file_exists(scene_path) or ResourceLoader.exists(scene_path):
		return _failure(
			"SCENE_ALREADY_EXISTS",
			"Scene already exists: " + scene_path
		)

	var parent_path: String = scene_path.get_base_dir()
	var parent_global_path: String = ProjectSettings.globalize_path(parent_path)
	if not DirAccess.dir_exists_absolute(parent_global_path):
		return _failure(
			"PARENT_DIRECTORY_NOT_FOUND",
			"Scene parent directory does not exist: " + parent_path
		)

	var root_type: String = str(arguments.get("root_type", "Node"))
	if (
		root_type.is_empty()
		or not ClassDB.class_exists(root_type)
		or not ClassDB.can_instantiate(root_type)
		or ClassDB.class_get_api_type(root_type) != ClassDB.API_CORE
		or (
			root_type != "Node"
			and not ClassDB.is_parent_class(root_type, "Node")
		)
	):
		return _failure(
			"ROOT_TYPE_INVALID",
			"Root type must be an instantiable built-in Node class"
		)

	var requested_name: Variant = arguments.get("root_name", null)
	var root_name: String = scene_path.get_file().get_basename()
	if requested_name != null:
		root_name = str(requested_name)
	if not BridgeNodeNameGuard.is_valid(root_name):
		return _failure(
			"INVALID_ARGUMENTS",
			"Root name is empty or contains a forbidden Node name character"
		)

	var instance: Variant = ClassDB.instantiate(root_type)
	if not (instance is Node):
		if instance is Object:
			(instance as Object).free()
		return _failure(
			"ROOT_TYPE_INVALID",
			"Root type did not instantiate as a Node"
		)
	var root: Node = instance
	root.name = StringName(root_name)
	if str(root.name) != root_name:
		root.free()
		return _failure(
			"INVALID_ARGUMENTS",
			"Godot did not accept the requested root node name"
		)

	var packed_scene: PackedScene = PackedScene.new()
	var pack_error: Error = packed_scene.pack(root)
	if pack_error != OK:
		root.free()
		return _failure(
			"SCENE_CREATE_FAILED",
			"Could not pack the scene: " + error_string(pack_error)
		)
	var save_error: Error = ResourceSaver.save(packed_scene, scene_path)
	root.free()
	if save_error != OK:
		return _failure(
			"SCENE_CREATE_FAILED",
			"Could not save the new scene: " + error_string(save_error)
		)
	if not FileAccess.file_exists(scene_path):
		return _failure(
			"SCENE_CREATE_FAILED",
			"The new scene was not found after saving"
		)

	var interface: EditorInterface = _context.editor_interface()
	var filesystem: EditorFileSystem = interface.get_resource_filesystem()
	if filesystem != null:
		filesystem.update_file(scene_path)
	return _success(
		{
			"scene_path": scene_path,
			"root_name": root_name,
			"root_type": root_type,
			"created": true,
			"opened": false,
		}
	)


func _save_scene(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	if scene_root == null:
		return _failure("SCENE_NOT_OPEN", "No scene is currently open")
	var interface: EditorInterface = _context.editor_interface()
	var current_path: String = scene_root.scene_file_path
	var requested_path: Variant = arguments.get("scene_path", null)
	var target_path: String = current_path
	if requested_path != null:
		var validated_path: Dictionary = BridgeScenePathGuard.validate_scene_path(
			str(requested_path)
		)
		if not validated_path["ok"]:
			return validated_path
		target_path = str(validated_path["path"])
	if target_path.is_empty():
		return _failure(
			"SCENE_PATH_REQUIRED",
			"An untitled scene requires a scene_path"
		)

	var parent_path: String = target_path.get_base_dir()
	if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(parent_path)):
		return _failure(
			"PARENT_DIRECTORY_NOT_FOUND",
			"Scene parent directory does not exist: " + parent_path
		)
	var save_as: bool = target_path != current_path
	if (
		save_as
		and (FileAccess.file_exists(target_path) or ResourceLoader.exists(target_path))
		and not bool(arguments.get("overwrite", false))
	):
		return _failure(
			"SCENE_ALREADY_EXISTS",
			"Save-as target already exists: " + target_path
		)

	if save_as:
		interface.save_scene_as(target_path, true)
	else:
		var save_error: Error = interface.save_scene()
		if save_error != OK:
			return _failure(
				"SCENE_SAVE_FAILED",
				"Godot could not save the active scene: " + error_string(save_error)
			)

	var actual_root: Node = _context.edited_scene_root()
	if (
		actual_root == null
		or actual_root.scene_file_path != target_path
		or not FileAccess.file_exists(target_path)
	):
		return _failure(
			"SCENE_SAVE_FAILED",
			"The active scene did not reach the requested saved state"
		)
	_context.mark_scene_clean(actual_root)
	var scene_unsaved: bool = _context.is_scene_unsaved(actual_root)
	if scene_unsaved:
		return _failure(
			"SCENE_SAVE_FAILED",
			"The active scene is still marked as unsaved"
		)
	return _success(
		{
			"scene_path": target_path,
			"saved": true,
			"save_as": save_as,
			"scene_unsaved": scene_unsaved,
		}
	)


func _open_scene(arguments: Dictionary) -> Dictionary:
	var validated_path: Dictionary = BridgeScenePathGuard.validate_scene_path(
		str(arguments["scene_path"])
	)
	if not validated_path["ok"]:
		return validated_path
	var scene_path: String = str(validated_path["path"])
	if not FileAccess.file_exists(scene_path):
		return _failure("SCENE_NOT_FOUND", "Scene not found: " + scene_path)
	var resource: Resource = ResourceLoader.load(scene_path, "PackedScene")
	if not (resource is PackedScene):
		return _failure(
			"SCENE_OPEN_FAILED",
			"Resource is not a loadable PackedScene: " + scene_path
		)

	var interface: EditorInterface = _context.editor_interface()
	var current_root: Node = _context.edited_scene_root()
	var current_was_clean: bool = (
		current_root != null and not _context.is_scene_unsaved(current_root)
	)
	var already_active: bool = (
		current_root != null and current_root.scene_file_path == scene_path
	)
	var open_target_root: Node = _find_open_scene_root(scene_path)
	var already_open: bool = open_target_root != null
	var target_was_clean: bool = (
		already_open and not _context.is_scene_unsaved(open_target_root)
	)
	if not already_active:
		interface.open_scene_from_path(scene_path)
	var actual_root: Node = _context.edited_scene_root()
	if actual_root == null or actual_root.scene_file_path != scene_path:
		return _failure(
			"SCENE_OPEN_FAILED",
			"Godot did not activate the requested scene"
		)
	if not already_active and current_was_clean:
		_context.mark_scene_clean(current_root)
	if already_open:
		if target_was_clean:
			_context.mark_scene_clean(actual_root)
		else:
			_context.track_scene(actual_root)
	else:
		_context.mark_scene_clean(actual_root)
	return _success(
		{
			"scene_path": scene_path,
			"already_open": already_open,
			"active": true,
			"open_scene_count": _open_scene_count(),
		}
	)


func _list_project_scenes(arguments: Dictionary) -> Dictionary:
	var validated_path: Dictionary = BridgeScenePathGuard.validate_directory_path(
		str(arguments.get("search_path", "res://"))
	)
	if not validated_path["ok"]:
		return validated_path
	var search_path: String = str(validated_path["path"])
	if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(search_path)):
		return _failure(
			"DIRECTORY_NOT_FOUND",
			"Project directory not found: " + search_path
		)
	var max_results: int = int(
		arguments.get(
			"max_results",
			BridgeConstants.DEFAULT_PROJECT_SCENES
		)
	)
	var state: Dictionary = {
		"scenes": [],
		"truncated": false,
		"visited_entries": 0,
	}
	_collect_project_scenes(search_path, 0, max_results, state)
	var scenes: Array = state["scenes"]
	if scenes.size() > max_results:
		scenes.resize(max_results)
		state["truncated"] = true
	return _success(
		{
			"search_path": search_path,
			"scenes": scenes,
			"count": scenes.size(),
			"truncated": bool(state["truncated"]),
		}
	)


func _collect_project_scenes(
	directory_path: String,
	depth: int,
	max_results: int,
	state: Dictionary
) -> void:
	if bool(state["truncated"]) or state["scenes"].size() > max_results:
		return
	if depth > BridgeConstants.MAX_SCENE_SCAN_DEPTH:
		state["truncated"] = true
		return

	var directories: PackedStringArray = DirAccess.get_directories_at(directory_path)
	var files: PackedStringArray = DirAccess.get_files_at(directory_path)
	state["visited_entries"] = (
		int(state["visited_entries"]) + directories.size() + files.size()
	)
	if int(state["visited_entries"]) > BridgeConstants.MAX_SCENE_SCAN_ENTRIES:
		state["truncated"] = true
		return

	var entries: Array[String] = []
	for directory_name in directories:
		if directory_name == ".godot":
			continue
		entries.append(directory_name + "/")
	for file_name in files:
		if file_name.get_extension().to_lower() in ["tscn", "scn"]:
			entries.append(file_name)
	entries.sort()

	for entry in entries:
		if bool(state["truncated"]) or state["scenes"].size() > max_results:
			return
		var entry_name: String = entry.trim_suffix("/")
		var entry_path: String = _join_project_path(directory_path, entry_name)
		if entry.ends_with("/"):
			_collect_project_scenes(
				entry_path,
				depth + 1,
				max_results,
				state
			)
			continue
		var extension: String = entry_name.get_extension().to_lower()
		state["scenes"].append(
			{
				"scene_path": entry_path,
				"scene_name": entry_name.get_basename(),
				"format": extension,
			}
		)


func _list_open_scenes(_arguments: Dictionary) -> Dictionary:
	return _success(_open_scenes_data())


func _close_scene_tab(arguments: Dictionary) -> Dictionary:
	var interface: EditorInterface = _context.editor_interface()
	var active_root: Node = _context.edited_scene_root()
	if active_root == null:
		return _failure("SCENE_NOT_OPEN", "No scene is currently open")
	var requested_path: Variant = arguments.get("scene_path", null)
	var target_path: String = active_root.scene_file_path
	var target_root: Node = active_root
	if requested_path != null:
		var validated_path: Dictionary = BridgeScenePathGuard.validate_scene_path(
			str(requested_path)
		)
		if not validated_path["ok"]:
			return validated_path
		target_path = str(validated_path["path"])
		target_root = _find_open_scene_root(target_path)
		if target_root == null:
			return _failure(
				"SCENE_NOT_OPEN",
				"Scene tab is not open: " + target_path
			)

	var target_name: String = (
		str(target_root.name)
		if target_path.is_empty()
		else target_path.get_file().get_basename()
	)
	var target_unsaved: bool = _context.is_scene_unsaved(target_root)
	if target_unsaved and not bool(arguments.get("discard_unsaved", false)):
		return _failure(
			"SCENE_HAS_UNSAVED_CHANGES",
			"Scene has unsaved changes; set discard_unsaved to close it"
		)

	var previous_active_path: String = active_root.scene_file_path
	var target_was_active: bool = target_root == active_root
	var open_count_before: int = _open_scene_count()
	if not target_was_active:
		if target_path.is_empty():
			return _failure(
				"SCENE_NOT_ACTIVE",
				"An untitled scene must be active before it can be closed"
			)
		interface.open_scene_from_path(target_path)
		var activated_root: Node = _context.edited_scene_root()
		if activated_root == null or activated_root.scene_file_path != target_path:
			return _failure(
				"SCENE_CLOSE_FAILED",
				"Could not activate the requested scene tab"
			)
		target_root = activated_root

	var target_instance_id: int = target_root.get_instance_id()
	var close_error: Error = interface.close_scene()
	if close_error != OK:
		if not target_was_active and not previous_active_path.is_empty():
			interface.open_scene_from_path(previous_active_path)
		return _failure(
			"SCENE_CLOSE_FAILED",
			"Godot could not close the scene tab: " + error_string(close_error)
		)
	_context.clear_scene_instance(target_instance_id)
	if (
		_open_scene_count() != open_count_before - 1
		or (
			not target_path.is_empty()
			and _find_open_scene_index(target_path) >= 0
		)
	):
		return _failure(
			"SCENE_CLOSE_FAILED",
			"The requested scene tab is still open"
		)

	if (
		not target_was_active
		and not previous_active_path.is_empty()
		and _find_open_scene_index(previous_active_path) >= 0
	):
		interface.open_scene_from_path(previous_active_path)
	var active_after: Node = _context.edited_scene_root()
	return _success(
		{
			"closed_scene_path": target_path,
			"closed_scene_name": target_name,
			"discarded_unsaved_changes": target_unsaved,
			"active_scene_path": (
				"" if active_after == null else active_after.scene_file_path
			),
			"open_scene_count": _open_scene_count(),
		}
	)


func _get_current_scene(_arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	if scene_root == null:
		return _success(
			{
				"open": false,
				"scene_name": "",
				"resource_path": "",
				"root_name": "",
				"unsaved": false,
			}
		)
	return _success(
		{
			"open": true,
			"scene_name": scene_root.scene_file_path.get_file().get_basename(),
			"resource_path": scene_root.scene_file_path,
			"root_name": str(scene_root.name),
			"unsaved": _context.is_scene_unsaved(scene_root),
		}
	)


func _open_scenes_data() -> Dictionary:
	var interface: EditorInterface = _context.editor_interface()
	var roots: Array[Node] = interface.get_open_scene_roots()
	var paths: PackedStringArray = interface.get_open_scenes()
	var active_root: Node = _context.edited_scene_root()
	var scene_count: int = maxi(roots.size(), paths.size())
	var scenes: Array[Dictionary] = []
	var active_index: int = -1
	for index in scene_count:
		var root: Node = null
		if index < roots.size():
			root = roots[index]
		var scene_path: String = ""
		if index < paths.size():
			scene_path = paths[index]
		if scene_path.is_empty() and root != null:
			scene_path = root.scene_file_path
		var is_active: bool = root != null and root == active_root
		if is_active:
			active_index = index
		var root_name: String = "" if root == null else str(root.name)
		scenes.append(
			{
				"index": index,
				"scene_path": scene_path,
				"scene_name": (
					root_name
					if scene_path.is_empty()
					else scene_path.get_file().get_basename()
				),
				"root_name": root_name,
				"root_type": "" if root == null else root.get_class(),
				"active": is_active,
				"unsaved": _context.is_scene_unsaved(root),
				"untitled": scene_path.is_empty(),
			}
		)
	return {
		"active_scene_path": (
			"" if active_root == null else active_root.scene_file_path
		),
		"active_index": active_index,
		"count": scenes.size(),
		"scenes": scenes,
	}


func _find_open_scene_root(scene_path: String) -> Node:
	var interface: EditorInterface = _context.editor_interface()
	for root in interface.get_open_scene_roots():
		if root != null and root.scene_file_path == scene_path:
			return root
	return null


func _find_open_scene_index(scene_path: String) -> int:
	var interface: EditorInterface = _context.editor_interface()
	var paths: PackedStringArray = interface.get_open_scenes()
	for index in paths.size():
		if paths[index] == scene_path:
			return index
	var roots: Array[Node] = interface.get_open_scene_roots()
	for index in roots.size():
		if roots[index] != null and roots[index].scene_file_path == scene_path:
			return index
	return -1


func _open_scene_count() -> int:
	var interface: EditorInterface = _context.editor_interface()
	return maxi(
		interface.get_open_scene_roots().size(),
		interface.get_open_scenes().size()
	)


func _join_project_path(parent_path: String, child_name: String) -> String:
	if parent_path == "res://":
		return parent_path + child_name
	return parent_path + "/" + child_name


func _created_scene_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"root_name": {"type": "string"},
			"root_type": {"type": "string"},
			"created": {"type": "boolean"},
			"opened": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"root_name",
			"root_type",
			"created",
			"opened",
		],
		"additionalProperties": false,
	}


func _saved_scene_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"saved": {"type": "boolean"},
			"save_as": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"saved",
			"save_as",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _opened_scene_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"already_open": {"type": "boolean"},
			"active": {"type": "boolean"},
			"open_scene_count": {"type": "integer"},
		},
		"required": [
			"scene_path",
			"already_open",
			"active",
			"open_scene_count",
		],
		"additionalProperties": false,
	}


func _project_scenes_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"search_path": {"type": "string"},
			"scenes": {
				"type": "array",
				"items": {
					"type": "object",
					"properties": {
						"scene_path": {"type": "string"},
						"scene_name": {"type": "string"},
						"format": {"type": "string", "enum": ["tscn", "scn"]},
					},
					"required": ["scene_path", "scene_name", "format"],
					"additionalProperties": false,
				},
			},
			"count": {"type": "integer"},
			"truncated": {"type": "boolean"},
		},
		"required": ["search_path", "scenes", "count", "truncated"],
		"additionalProperties": false,
	}


func _open_scenes_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"active_scene_path": {"type": "string"},
			"active_index": {"type": "integer", "minimum": -1},
			"count": {"type": "integer", "minimum": 0},
			"scenes": {
				"type": "array",
				"items": {
					"type": "object",
					"properties": {
						"index": {"type": "integer", "minimum": 0},
						"scene_path": {"type": "string"},
						"scene_name": {"type": "string"},
						"root_name": {"type": "string"},
						"root_type": {"type": "string"},
						"active": {"type": "boolean"},
						"unsaved": {"type": "boolean"},
						"untitled": {"type": "boolean"},
					},
					"required": [
						"index",
						"scene_path",
						"scene_name",
						"root_name",
						"root_type",
						"active",
						"unsaved",
						"untitled",
					],
					"additionalProperties": false,
				},
			},
		},
		"required": [
			"active_scene_path",
			"active_index",
			"count",
			"scenes",
		],
		"additionalProperties": false,
	}


func _closed_scene_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"closed_scene_path": {"type": "string"},
			"closed_scene_name": {"type": "string"},
			"discarded_unsaved_changes": {"type": "boolean"},
			"active_scene_path": {"type": "string"},
			"open_scene_count": {"type": "integer", "minimum": 0},
		},
		"required": [
			"closed_scene_path",
			"closed_scene_name",
			"discarded_unsaved_changes",
			"active_scene_path",
			"open_scene_count",
		],
		"additionalProperties": false,
	}


func _current_scene_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"open": {"type": "boolean"},
			"scene_name": {"type": "string"},
			"resource_path": {"type": "string"},
			"root_name": {"type": "string"},
			"unsaved": {"type": "boolean"},
		},
		"required": ["open", "scene_name", "resource_path", "root_name", "unsaved"],
		"additionalProperties": false,
	}
