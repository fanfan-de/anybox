class_name BridgeRunTools
extends BridgeToolModule


func definitions() -> Array[BridgeToolDefinition]:
	return [
		_definition(
			"get_run_state",
			"Read project run, debugger session, output, and filesystem scan state.",
			_empty_object_schema(),
			_run_state_schema(),
			"read",
			false,
			_get_run_state
		),
		_definition(
			"run_project",
			"Request a non-blocking run of the main, current, or selected scene.",
			{
				"type": "object",
				"properties": {
					"target": {
						"type": "string",
						"enum": ["main", "current", "scene"],
						"default": "main",
						"description": "The closed run target selection.",
					},
					"scene_path": {
						"type": "string",
						"description": "Required only for target=scene.",
					},
				},
				"additionalProperties": false,
			},
			_run_request_schema(),
			"write",
			true,
			_run_project
		),
		_definition(
			"stop_project",
			"Request a non-blocking stop of the running project.",
			_empty_object_schema(),
			_stop_request_schema(),
			"write",
			true,
			_stop_project
		),
		_definition(
			"get_debug_output",
			"Read a bounded page of stdout, stderr, or script error events.",
			{
				"type": "object",
				"properties": {
					"run_id": {
						"type": "integer",
						"minimum": 0,
						"maximum": BridgeConstants.MAX_SAFE_INTEGER,
						"description": "Optional run identifier; omitted selects the latest run.",
					},
					"after_sequence": {
						"type": "integer",
						"minimum": 0,
						"maximum": BridgeConstants.MAX_SAFE_INTEGER,
						"default": 0,
						"description": "Return only events with a greater sequence.",
					},
					"limit": {
						"type": "integer",
						"minimum": 1,
						"maximum": BridgeConstants.MAX_DEBUG_OUTPUT_LIMIT,
						"default": BridgeConstants.DEFAULT_DEBUG_OUTPUT_LIMIT,
						"description": "Maximum events in this page.",
					},
					"category": {
						"type": "string",
						"enum": ["all", "stdout", "stderr", "error"],
						"default": "all",
						"description": "Fixed event category filter.",
					},
				},
				"additionalProperties": false,
			},
			_debug_output_schema(),
			"read",
			false,
			_get_debug_output
		),
		_definition(
			"rescan_project_files",
			"Request a non-blocking EditorFileSystem scan for external changes.",
			_empty_object_schema(),
			_rescan_schema(),
			"write",
			true,
			_rescan_project_files
		),
	]


func _get_run_state(_arguments: Dictionary) -> Dictionary:
	return _read_run_state()


func _run_project(arguments: Dictionary) -> Dictionary:
	var current_state: Dictionary = _read_run_state()
	if not current_state["ok"]:
		return current_state
	if (
		bool(current_state["data"]["playing"])
		or str(current_state["data"]["state"]) != "stopped"
	):
		return _failure(
			"PROJECT_ALREADY_RUNNING",
			"A project run is already active or changing state"
		)

	var target: String = str(arguments.get("target", "main"))
	var has_scene_path: bool = arguments.has("scene_path")
	if target == "scene" and not has_scene_path:
		return _failure(
			"INVALID_ARGUMENTS",
			"scene_path is required when target is scene"
		)
	if target != "scene" and has_scene_path:
		return _failure(
			"INVALID_ARGUMENTS",
			"scene_path is only allowed when target is scene"
		)

	var scene_result: Dictionary
	match target:
		"main":
			scene_result = _resolve_main_scene()
		"current":
			scene_result = _resolve_current_scene()
		"scene":
			scene_result = _resolve_requested_scene(str(arguments["scene_path"]))
		_:
			return _failure("INVALID_ARGUMENTS", "Unsupported run target")
	if not scene_result["ok"]:
		return scene_result
	var scene_path: String = str(scene_result["path"])

	var unsaved_scene: Dictionary = _context.first_unsaved_open_scene()
	if bool(unsaved_scene["unsaved"]):
		var dirty_path: String = str(unsaved_scene["scene_path"])
		return _failure(
			"SCENE_HAS_UNSAVED_CHANGES",
			(
				"An open scene has unsaved or conservatively unknown changes"
				if dirty_path.is_empty()
				else "Scene has unsaved or conservatively unknown changes: " + dirty_path
			)
		)

	var interface: EditorInterface = _context.editor_interface()
	var debugger_bridge: BridgeDebuggerPlugin = _context.debugger_bridge()
	if interface == null or debugger_bridge == null:
		return _failure(
			"EDITOR_UNAVAILABLE",
			"The editor run bridge is unavailable",
			true
		)
	var run_id: int = debugger_bridge.begin_run(target, scene_path)
	match target:
		"main":
			interface.play_main_scene()
		"current":
			interface.play_current_scene()
		"scene":
			interface.play_custom_scene(scene_path)
	return _success(
		{
			"requested": true,
			"run_id": run_id,
			"target": target,
			"requested_scene_path": scene_path,
		}
	)


func _stop_project(_arguments: Dictionary) -> Dictionary:
	var current_state: Dictionary = _read_run_state()
	if not current_state["ok"]:
		return current_state
	var run_id: int = int(current_state["data"]["run_id"])
	if (
		not bool(current_state["data"]["playing"])
		and str(current_state["data"]["state"]) == "stopped"
	):
		return _success(
			{
				"requested": false,
				"already_stopped": true,
				"run_id": run_id,
			}
		)
	var interface: EditorInterface = _context.editor_interface()
	var debugger_bridge: BridgeDebuggerPlugin = _context.debugger_bridge()
	if interface == null or debugger_bridge == null:
		return _failure(
			"EDITOR_UNAVAILABLE",
			"The editor run bridge is unavailable",
			true
		)
	debugger_bridge.request_stop()
	interface.stop_playing_scene()
	return _success(
		{
			"requested": true,
			"already_stopped": false,
			"run_id": run_id,
		}
	)


func _get_debug_output(arguments: Dictionary) -> Dictionary:
	var debugger_bridge: BridgeDebuggerPlugin = _context.debugger_bridge()
	if debugger_bridge == null:
		return _failure(
			"EDITOR_UNAVAILABLE",
			"The editor debugger bridge is unavailable",
			true
		)
	var requested_run_id: int = -1
	if arguments.has("run_id"):
		requested_run_id = int(arguments["run_id"])
	return _success(
		debugger_bridge.output_page(
			requested_run_id,
			int(arguments.get("after_sequence", 0)),
			int(
				arguments.get(
					"limit",
					BridgeConstants.DEFAULT_DEBUG_OUTPUT_LIMIT
				)
			),
			str(arguments.get("category", "all"))
		)
	)


func _rescan_project_files(_arguments: Dictionary) -> Dictionary:
	var filesystem: EditorFileSystem = _context.resource_filesystem()
	if filesystem == null:
		return _failure(
			"EDITOR_UNAVAILABLE",
			"EditorFileSystem is unavailable",
			true
		)
	if filesystem.is_scanning():
		return _success(
			{
				"requested": false,
				"already_scanning": true,
				"filesystem_scanning": true,
				"filesystem_scan_progress": _scan_progress(filesystem),
			}
		)
	filesystem.scan()
	return _success(
		{
			"requested": true,
			"already_scanning": false,
			"filesystem_scanning": filesystem.is_scanning(),
			"filesystem_scan_progress": _scan_progress(filesystem),
		}
	)


func _read_run_state() -> Dictionary:
	var interface: EditorInterface = _context.editor_interface()
	var debugger_bridge: BridgeDebuggerPlugin = _context.debugger_bridge()
	if interface == null or debugger_bridge == null:
		return _failure(
			"EDITOR_UNAVAILABLE",
			"The editor run bridge is unavailable",
			true
		)
	var playing: bool = interface.is_playing_scene()
	var active_scene_path: String = _canonical_scene_reference(
		interface.get_playing_scene()
	)
	if playing and active_scene_path.is_empty():
		active_scene_path = str(
			debugger_bridge.snapshot().get("requested_scene_path", "")
		)
	var inferred_target: String = _infer_target(active_scene_path)
	debugger_bridge.synchronize_editor_state(
		playing,
		active_scene_path,
		inferred_target
	)
	var data: Dictionary = debugger_bridge.snapshot()
	data["playing"] = playing
	var filesystem: EditorFileSystem = _context.resource_filesystem()
	data["filesystem_scanning"] = (
		false if filesystem == null else filesystem.is_scanning()
	)
	data["filesystem_scan_progress"] = (
		0.0 if filesystem == null else _scan_progress(filesystem)
	)
	return _success(data)


func _resolve_main_scene() -> Dictionary:
	var configured: String = str(
		ProjectSettings.get_setting("application/run/main_scene", "")
	)
	if configured.is_empty():
		return _failure(
			"MAIN_SCENE_NOT_CONFIGURED",
			"The project does not define application/run/main_scene"
		)
	var scene_path: String = _canonical_scene_reference(configured)
	if scene_path.is_empty():
		return _failure(
			"MAIN_SCENE_NOT_FOUND",
			"The configured main scene could not be resolved to a res:// path"
		)
	return _validate_loadable_scene(scene_path)


func _resolve_current_scene() -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	if scene_root == null:
		return _failure("SCENE_NOT_OPEN", "No scene is currently open")
	if scene_root.scene_file_path.is_empty():
		return _failure(
			"SCENE_PATH_REQUIRED",
			"The current scene must have a saved project path before it can run"
		)
	return _resolve_requested_scene(scene_root.scene_file_path)


func _resolve_requested_scene(raw_path: String) -> Dictionary:
	var validated: Dictionary = BridgeScenePathGuard.validate_scene_path(raw_path)
	if not validated["ok"]:
		return validated
	return _validate_loadable_scene(str(validated["path"]))


func _validate_loadable_scene(scene_path: String) -> Dictionary:
	if not FileAccess.file_exists(scene_path):
		return _failure("SCENE_NOT_FOUND", "Scene not found: " + scene_path)
	var resource: Resource = ResourceLoader.load(scene_path, "PackedScene")
	if not (resource is PackedScene):
		return _failure(
			"SCENE_LOAD_FAILED",
			"Resource is not a loadable PackedScene: " + scene_path
		)
	return {"ok": true, "path": scene_path}


func _canonical_scene_reference(raw_path: String) -> String:
	var scene_path: String = raw_path
	if scene_path.begins_with("uid://"):
		var resource_id: int = ResourceUID.text_to_id(scene_path)
		if resource_id < 0 or not ResourceUID.has_id(resource_id):
			return ""
		scene_path = ResourceUID.get_id_path(resource_id)
	var validated: Dictionary = BridgeScenePathGuard.validate_scene_path(scene_path)
	return str(validated["path"]) if validated["ok"] else ""


func _infer_target(active_scene_path: String) -> String:
	if active_scene_path.is_empty():
		return "scene"
	var main_scene_path: String = _canonical_scene_reference(
		str(ProjectSettings.get_setting("application/run/main_scene", ""))
	)
	if active_scene_path == main_scene_path:
		return "main"
	var scene_root: Node = _context.edited_scene_root()
	if scene_root != null and active_scene_path == scene_root.scene_file_path:
		return "current"
	return "scene"


func _scan_progress(filesystem: EditorFileSystem) -> float:
	var progress: float = filesystem.get_scanning_progress()
	return clampf(progress, 0.0, 1.0) if is_finite(progress) else 0.0


func _run_state_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"state": {
				"type": "string",
				"enum": ["stopped", "starting", "running", "paused", "stopping"],
			},
			"playing": {"type": "boolean"},
			"run_id": {"type": "integer", "minimum": 0},
			"target": {
				"type": "string",
				"enum": ["main", "current", "scene"],
			},
			"requested_scene_path": {"type": "string"},
			"active_scene_path": {"type": "string"},
			"debugger_sessions": {"type": "integer", "minimum": 0},
			"output_latest_sequence": {"type": "integer", "minimum": 0},
			"filesystem_scanning": {"type": "boolean"},
			"filesystem_scan_progress": {
				"type": "number",
				"minimum": 0.0,
				"maximum": 1.0,
			},
		},
		"required": [
			"state",
			"playing",
			"run_id",
			"target",
			"requested_scene_path",
			"active_scene_path",
			"debugger_sessions",
			"output_latest_sequence",
			"filesystem_scanning",
			"filesystem_scan_progress",
		],
		"additionalProperties": false,
	}


func _run_request_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"requested": {"type": "boolean"},
			"run_id": {"type": "integer", "minimum": 1},
			"target": {
				"type": "string",
				"enum": ["main", "current", "scene"],
			},
			"requested_scene_path": {"type": "string"},
		},
		"required": ["requested", "run_id", "target", "requested_scene_path"],
		"additionalProperties": false,
	}


func _stop_request_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"requested": {"type": "boolean"},
			"already_stopped": {"type": "boolean"},
			"run_id": {"type": "integer", "minimum": 0},
		},
		"required": ["requested", "already_stopped", "run_id"],
		"additionalProperties": false,
	}


func _debug_output_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"run_id": {"type": "integer", "minimum": 0},
			"events": {
				"type": "array",
				"maxItems": BridgeConstants.MAX_DEBUG_OUTPUT_LIMIT,
				"items": _debug_event_schema(),
			},
			"count": {
				"type": "integer",
				"minimum": 0,
				"maximum": BridgeConstants.MAX_DEBUG_OUTPUT_LIMIT,
			},
			"next_sequence": {"type": "integer", "minimum": 0},
			"oldest_available_sequence": {"type": "integer", "minimum": 0},
			"latest_sequence": {"type": "integer", "minimum": 0},
			"dropped_before_sequence": {"type": "integer", "minimum": 0},
			"has_more": {"type": "boolean"},
		},
		"required": [
			"run_id",
			"events",
			"count",
			"next_sequence",
			"oldest_available_sequence",
			"latest_sequence",
			"dropped_before_sequence",
			"has_more",
		],
		"additionalProperties": false,
	}


func _debug_event_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"run_id": {"type": "integer", "minimum": 0},
			"sequence": {"type": "integer", "minimum": 1},
			"session_id": {"type": "integer", "minimum": -1},
			"timestamp_msec": {"type": "integer", "minimum": 0},
			"category": {
				"type": "string",
				"enum": ["stdout", "stderr", "error"],
			},
			"message": {"type": "string"},
			"file": {"type": "string"},
			"line": {"type": "integer", "minimum": 1},
			"function": {"type": "string"},
			"truncated": {"type": "boolean"},
		},
		"required": [
			"run_id",
			"sequence",
			"session_id",
			"timestamp_msec",
			"category",
			"message",
		],
		"additionalProperties": false,
	}


func _rescan_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"requested": {"type": "boolean"},
			"already_scanning": {"type": "boolean"},
			"filesystem_scanning": {"type": "boolean"},
			"filesystem_scan_progress": {
				"type": "number",
				"minimum": 0.0,
				"maximum": 1.0,
			},
		},
		"required": [
			"requested",
			"already_scanning",
			"filesystem_scanning",
			"filesystem_scan_progress",
		],
		"additionalProperties": false,
	}
