class_name BridgeTools
extends RefCounted


var _registry: BridgeToolRegistry
var _context: BridgeToolContext
var _modules: Array[BridgeToolModule] = []


func _init(
	plugin: EditorPlugin,
	registry: BridgeToolRegistry,
	server_snapshot: Callable,
	debugger_bridge: BridgeDebuggerPlugin = null
) -> void:
	_registry = registry
	_context = BridgeToolContext.new(plugin, server_snapshot, debugger_bridge)
	_context.mark_existing_open_scenes_unknown()
	_modules = [
		BridgeEditorTools.new(_context),
		BridgeProjectTools.new(_context),
		BridgeResourceTools.new(_context),
		BridgeSceneTools.new(_context),
		BridgeClassTools.new(_context),
		BridgeNodeTools.new(_context),
		BridgeSignalTools.new(_context),
		BridgeRunTools.new(_context),
	]


func register_all() -> Error:
	for module in _modules:
		for definition in module.definitions():
			var error: Error = _registry.register_tool(definition)
			if error != OK:
				return error
	return OK


func on_scene_saved(filepath: String) -> void:
	_context.mark_scene_path_saved(filepath)


func on_scene_closed(filepath: String) -> void:
	_context.clear_scene_path(filepath)


func on_scene_changed(scene_root: Node) -> void:
	_context.track_scene(scene_root)
