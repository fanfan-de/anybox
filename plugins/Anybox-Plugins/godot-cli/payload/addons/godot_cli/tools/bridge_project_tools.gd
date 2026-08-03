class_name BridgeProjectTools
extends BridgeToolModule


func definitions() -> Array[BridgeToolDefinition]:
	return [
		_definition(
			"get_project_info",
			"Read the current Godot project's identity and version information.",
			_empty_object_schema(),
			_project_info_schema(),
			"read",
			false,
			_get_project_info
		),
	]


func _get_project_info(_arguments: Dictionary) -> Dictionary:
	var version: Dictionary = Engine.get_version_info()
	var project_path: String = _context.project_path()
	var project_name: String = str(
		ProjectSettings.get_setting("application/config/name", "")
	)
	if project_name.is_empty():
		project_name = project_path.get_file()
	return _success(
		{
			"project_name": project_name,
			"project_path": project_path,
			"godot_version": str(version.get("string", "")),
			"godot_major": int(version.get("major", 0)),
			"godot_minor": int(version.get("minor", 0)),
			"godot_patch": int(version.get("patch", 0)),
			"plugin_version": BridgeConstants.PLUGIN_VERSION,
			"protocol_version": BridgeConstants.PROTOCOL_VERSION,
		}
	)


func _project_info_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"project_name": {"type": "string"},
			"project_path": {"type": "string"},
			"godot_version": {"type": "string"},
			"godot_major": {"type": "integer"},
			"godot_minor": {"type": "integer"},
			"godot_patch": {"type": "integer"},
			"plugin_version": {"type": "string"},
			"protocol_version": {"type": "integer"},
		},
		"required": [
			"project_name",
			"project_path",
			"godot_version",
			"godot_major",
			"godot_minor",
			"godot_patch",
			"plugin_version",
			"protocol_version",
		],
		"additionalProperties": false,
	}
