class_name BridgeEditorTools
extends BridgeToolModule


func definitions() -> Array[BridgeToolDefinition]:
	return [
		_definition(
			"get_editor_status",
			"Read Godot CLI, editor, connection, and current-scene status.",
			_empty_object_schema(),
			_editor_status_schema(),
			"read",
			false,
			_get_editor_status
		),
	]


func _get_editor_status(_arguments: Dictionary) -> Dictionary:
	var snapshot: Dictionary = _context.server_snapshot()
	var scene_root: Node = _context.edited_scene_root()
	return _success(
		{
			"plugin_version": BridgeConstants.PLUGIN_VERSION,
			"godot_version": str(Engine.get_version_info().get("string", "")),
			"listening": bool(snapshot.get("listening", false)),
			"port": int(snapshot.get("port", 0)),
			"client_count": int(snapshot.get("client_count", 0)),
			"scene_open": scene_root != null,
			"scene_path": "" if scene_root == null else scene_root.scene_file_path,
			"scene_unsaved": (
				false if scene_root == null else _context.is_scene_unsaved(scene_root)
			),
		}
	)


func _editor_status_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"plugin_version": {"type": "string"},
			"godot_version": {"type": "string"},
			"listening": {"type": "boolean"},
			"port": {"type": "integer"},
			"client_count": {"type": "integer"},
			"scene_open": {"type": "boolean"},
			"scene_path": {"type": "string"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"plugin_version",
			"godot_version",
			"listening",
			"port",
			"client_count",
			"scene_open",
			"scene_path",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}
