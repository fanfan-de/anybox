class_name BridgeNodeNameGuard
extends RefCounted


static func is_valid(node_name: String) -> bool:
	if node_name.is_empty() or node_name.length() > 128:
		return false
	for forbidden_character in [".", ":", "@", "/", "\"", "%"]:
		if node_name.contains(forbidden_character):
			return false
	return true
