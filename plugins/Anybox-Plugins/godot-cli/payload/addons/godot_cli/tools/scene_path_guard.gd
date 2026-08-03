class_name BridgeScenePathGuard
extends RefCounted


static func validate_scene_path(
	raw_path: String,
	text_only: bool = false
) -> Dictionary:
	var validated: Dictionary = _validate_project_path(raw_path, false)
	if not validated["ok"]:
		return validated
	var extension: String = str(validated["path"]).get_extension().to_lower()
	if text_only:
		if extension != "tscn":
			return _failure(
				"INVALID_ARGUMENTS",
				"Scene path must use the .tscn extension"
			)
	elif extension not in ["tscn", "scn"]:
		return _failure(
			"INVALID_ARGUMENTS",
			"Scene path must use the .tscn or .scn extension"
		)
	validated["extension"] = extension
	return validated


static func validate_directory_path(raw_path: String) -> Dictionary:
	return _validate_project_path(raw_path, true)


static func validate_script_path(raw_path: String) -> Dictionary:
	var validated: Dictionary = _validate_project_path(raw_path, false)
	if not validated["ok"]:
		return validated
	if str(validated["path"]).get_extension().to_lower() != "gd":
		return _failure(
			"INVALID_ARGUMENTS",
			"Script path must use the .gd extension"
		)
	return validated


static func validate_resource_path(raw_path: String) -> Dictionary:
	return _validate_project_path(raw_path, false)


static func _validate_project_path(
	raw_path: String,
	allow_project_root: bool
) -> Dictionary:
	if (
		raw_path.is_empty()
		or raw_path != raw_path.strip_edges()
		or not raw_path.begins_with("res://")
		or raw_path.contains("\\")
	):
		return _failure(
			"INVALID_ARGUMENTS",
			"Path must be a normalized res:// project path"
		)

	var relative_path: String = raw_path.trim_prefix("res://")
	if relative_path.is_empty():
		if not allow_project_root:
			return _failure("INVALID_ARGUMENTS", "Path must identify a project file")
		return _success_path("res://")
	if relative_path.ends_with("/"):
		return _failure("INVALID_ARGUMENTS", "Path must not end with '/'")

	var segments: PackedStringArray = relative_path.split("/", true)
	for segment in segments:
		if (
			segment.is_empty()
			or segment == "."
			or segment == ".."
			or segment.contains(":")
		):
			return _failure(
				"INVALID_ARGUMENTS",
				"Path contains a forbidden segment"
			)
	if segments[0] == ".godot":
		return _failure(
			"INVALID_ARGUMENTS",
			"Paths inside res://.godot are not allowed"
		)

	var normalized_path: String = "res://" + "/".join(segments)
	var project_root: String = (
		ProjectSettings.globalize_path("res://")
		.replace("\\", "/")
		.simplify_path()
		.trim_suffix("/")
	)
	var global_path: String = (
		ProjectSettings.globalize_path(normalized_path)
		.replace("\\", "/")
		.simplify_path()
	)
	if global_path != project_root and not global_path.begins_with(project_root + "/"):
		return _failure(
			"INVALID_ARGUMENTS",
			"Path resolves outside the current project"
		)
	return {
		"ok": true,
		"path": normalized_path,
		"global_path": global_path,
	}


static func _success_path(path: String) -> Dictionary:
	return {
		"ok": true,
		"path": path,
		"global_path": ProjectSettings.globalize_path(path).replace("\\", "/"),
	}


static func _failure(code: String, message: String) -> Dictionary:
	return {
		"ok": false,
		"error": {
			"code": code,
			"message": message,
			"retryable": false,
		},
	}
