class_name BridgeToolContext
extends RefCounted


var _plugin: EditorPlugin
var _server_snapshot: Callable
var _debugger_bridge: BridgeDebuggerPlugin
var _bridge_dirty_scenes: Dictionary = {}
var _saved_scene_versions: Dictionary = {}
var _tracked_scene_paths: Dictionary = {}
var _unknown_scene_instances: Dictionary = {}


func _init(
	plugin: EditorPlugin,
	server_snapshot: Callable,
	debugger_bridge: BridgeDebuggerPlugin = null
) -> void:
	_plugin = plugin
	_server_snapshot = server_snapshot
	_debugger_bridge = debugger_bridge


func editor_interface() -> EditorInterface:
	if _plugin == null:
		return null
	return _plugin.get_editor_interface()


func undo_redo() -> EditorUndoRedoManager:
	if _plugin == null:
		return null
	return _plugin.get_undo_redo()


func edited_scene_root() -> Node:
	var interface: EditorInterface = editor_interface()
	if interface == null:
		return null
	return interface.get_edited_scene_root()


func debugger_bridge() -> BridgeDebuggerPlugin:
	return _debugger_bridge


func resource_filesystem() -> EditorFileSystem:
	var interface: EditorInterface = editor_interface()
	if interface == null:
		return null
	return interface.get_resource_filesystem()


func server_snapshot() -> Dictionary:
	if not _server_snapshot.is_valid():
		return {}
	return _server_snapshot.call()


func project_path() -> String:
	return ProjectSettings.globalize_path("res://").replace("\\", "/").trim_suffix("/")


func mark_existing_open_scenes_unknown() -> void:
	var interface: EditorInterface = editor_interface()
	if interface == null:
		return
	for value in interface.get_open_scene_roots():
		if value is Node:
			var scene_root: Node = value
			var instance_id: int = scene_root.get_instance_id()
			_tracked_scene_paths[instance_id] = scene_root.scene_file_path
			_unknown_scene_instances[instance_id] = true


func track_scene(scene_root: Node) -> void:
	if scene_root == null:
		return
	var instance_id: int = scene_root.get_instance_id()
	_tracked_scene_paths[instance_id] = scene_root.scene_file_path
	if (
		_saved_scene_versions.has(instance_id)
		or _unknown_scene_instances.has(instance_id)
	):
		return
	var version: int = _scene_history_version(scene_root)
	if version >= 0:
		_saved_scene_versions[instance_id] = version


func mark_scene_unsaved(scene_root: Node) -> void:
	var interface: EditorInterface = editor_interface()
	if interface == null or scene_root == null:
		return
	track_scene(scene_root)
	interface.set_object_edited(scene_root, true)
	interface.mark_scene_as_unsaved()
	_bridge_dirty_scenes[scene_root.get_instance_id()] = scene_root.scene_file_path


func is_scene_unsaved(scene_root: Node) -> bool:
	if scene_root == null:
		return false
	if _bridge_dirty_scenes.has(scene_root.get_instance_id()):
		return true
	var interface: EditorInterface = editor_interface()
	if interface == null:
		return false
	if interface.has_method(&"get_unsaved_scenes"):
		var unsaved_scenes: PackedStringArray = _read_optional_unsaved_scene_paths(
			interface
		)
		if scene_root.scene_file_path.is_empty():
			return not unsaved_scenes.is_empty()
		return unsaved_scenes.has(scene_root.scene_file_path)
	if scene_root.scene_file_path.is_empty():
		return true
	track_scene(scene_root)
	var instance_id: int = scene_root.get_instance_id()
	if _unknown_scene_instances.has(instance_id):
		return true
	if not _saved_scene_versions.has(instance_id):
		return false
	var current_version: int = _scene_history_version(scene_root)
	return (
		current_version < 0
		or current_version != int(_saved_scene_versions[instance_id])
	)


func first_unsaved_open_scene() -> Dictionary:
	var interface: EditorInterface = editor_interface()
	if interface == null:
		return {"unsaved": false, "scene_path": ""}
	var roots: Array[Node] = interface.get_open_scene_roots()
	var paths: PackedStringArray = interface.get_open_scenes()
	var scene_count: int = maxi(roots.size(), paths.size())
	for index in scene_count:
		var scene_root: Node = roots[index] if index < roots.size() else null
		var scene_path: String = paths[index] if index < paths.size() else ""
		if scene_path.is_empty() and scene_root != null:
			scene_path = scene_root.scene_file_path
		if scene_root == null or is_scene_unsaved(scene_root):
			return {"unsaved": true, "scene_path": scene_path}
	return {"unsaved": false, "scene_path": ""}


static func _read_optional_unsaved_scene_paths(interface: Object) -> PackedStringArray:
	# Godot 4.6.3 lacks this API; newer editor versions expose it.
	if interface == null or not interface.has_method(&"get_unsaved_scenes"):
		return PackedStringArray()
	var value: Variant = interface.call(&"get_unsaved_scenes")
	if value is PackedStringArray:
		return value
	return PackedStringArray()


func mark_scene_clean(scene_root: Node) -> void:
	if scene_root == null:
		return
	var instance_id: int = scene_root.get_instance_id()
	_bridge_dirty_scenes.erase(instance_id)
	_unknown_scene_instances.erase(instance_id)
	_tracked_scene_paths[instance_id] = scene_root.scene_file_path
	var version: int = _scene_history_version(scene_root)
	if version >= 0:
		_saved_scene_versions[instance_id] = version
	var interface: EditorInterface = editor_interface()
	if interface != null:
		interface.set_object_edited(scene_root, false)


func mark_scene_path_saved(filepath: String) -> void:
	var interface: EditorInterface = editor_interface()
	if interface == null:
		return
	for value in interface.get_open_scene_roots():
		if value is Node and value.scene_file_path == filepath:
			mark_scene_clean(value)


func clear_scene_instance(instance_id: int) -> void:
	_bridge_dirty_scenes.erase(instance_id)
	_saved_scene_versions.erase(instance_id)
	_tracked_scene_paths.erase(instance_id)
	_unknown_scene_instances.erase(instance_id)


func clear_scene_path(filepath: String) -> void:
	var ids_to_remove: Dictionary = {}
	for instance_id in _bridge_dirty_scenes:
		if str(_bridge_dirty_scenes[instance_id]) == filepath:
			ids_to_remove[instance_id] = true
	for instance_id in _tracked_scene_paths:
		if str(_tracked_scene_paths[instance_id]) == filepath:
			ids_to_remove[instance_id] = true
	for instance_id in ids_to_remove:
		clear_scene_instance(instance_id)


func _scene_history_version(scene_root: Node) -> int:
	var manager: EditorUndoRedoManager = undo_redo()
	if manager == null or scene_root == null:
		return -1
	var history_id: int = manager.get_object_history_id(scene_root)
	var history: UndoRedo = manager.get_history_undo_redo(history_id)
	if history == null:
		return -1
	return history.get_version()
