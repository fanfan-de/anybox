class_name BridgeNodePathGuard
extends RefCounted

static func resolve(scene_root: Node, raw_path: String) -> Dictionary:
	if scene_root == null:
		return _failure("SCENE_NOT_OPEN", "No scene is currently open")
	if raw_path == ".":
		return {"ok": true, "node": scene_root}
	if raw_path.is_empty() or raw_path.begins_with("/") or raw_path.contains(":"):
		return _failure("INVALID_ARGUMENTS", "Node path must be scene-root relative")

	var segments: PackedStringArray = raw_path.split("/", true)
	var current: Node = scene_root
	for segment in segments:
		if (
			segment.is_empty()
			or segment == "."
			or segment == ".."
			or segment.begins_with("%")
		):
			return _failure("INVALID_ARGUMENTS", "Node path contains a forbidden segment")
		var candidate: Node = current.get_node_or_null(NodePath(segment))
		if (
			candidate == null
			or candidate.get_parent() != current
			or not current.get_children(false).has(candidate)
		):
			return _failure("NODE_NOT_FOUND", "Node not found: " + raw_path)
		current = candidate

	if current != scene_root and not scene_root.is_ancestor_of(current):
		return _failure("NODE_NOT_FOUND", "Resolved node is outside the edited scene")
	return {"ok": true, "node": current}

static func _failure(code: String, message: String) -> Dictionary:
	return {
		"ok": false,
		"error": {
			"code": code,
			"message": message,
			"retryable": false,
		}
	}

