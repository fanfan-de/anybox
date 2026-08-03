@tool
class_name BridgeDebuggerPlugin
extends EditorDebuggerPlugin


var _state_model: BridgeDebugState = BridgeDebugState.new()
var _session_connections: Dictionary = {}
var _debugger_connections: Dictionary = {}


func _setup_session(session_id: int) -> void:
	var session: EditorDebuggerSession = get_session(session_id)
	if session == null:
		return
	if not _session_connections.has(session_id):
		var started: Callable = Callable(self, "_on_session_started").bind(
			session_id
		)
		var stopped: Callable = Callable(self, "_on_session_stopped").bind(
			session_id
		)
		var breaked: Callable = Callable(self, "_on_session_breaked").bind(
			session_id
		)
		var continued: Callable = Callable(self, "_on_session_continued").bind(
			session_id
		)
		session.connect(&"started", started)
		session.connect(&"stopped", stopped)
		session.connect(&"breaked", breaked)
		session.connect(&"continued", continued)
		_session_connections[session_id] = {
			"session": weakref(session),
			"started": started,
			"stopped": stopped,
			"breaked": breaked,
			"continued": continued,
		}
	if session.is_active():
		_on_session_started(session_id)
	call_deferred("_connect_debug_data_for_session", session_id)


func _has_capture(capture: String) -> bool:
	return BridgeDebugState.accepts_capture_prefix(capture)


func _capture(message: String, data: Array, session_id: int) -> bool:
	var prefix: String = message.get_slice(":", 0)
	if not BridgeDebugState.accepts_capture_prefix(prefix):
		return false
	if not _debugger_connections.has(session_id):
		_state_model.capture_debug_message(message, data, session_id)
	return false


func begin_run(target: String, requested_scene_path: String) -> int:
	return _state_model.begin_run(target, requested_scene_path)


func request_stop() -> void:
	_state_model.request_stop()


func synchronize_editor_state(
	playing: bool,
	active_scene_path: String,
	inferred_target: String
) -> void:
	_state_model.synchronize_editor_state(
		playing,
		active_scene_path,
		inferred_target
	)


func snapshot() -> Dictionary:
	return _state_model.snapshot()


func output_page(
	requested_run_id: int,
	after_sequence: int,
	limit: int,
	category: String
) -> Dictionary:
	return _state_model.output_page(
		requested_run_id,
		after_sequence,
		limit,
		category
	)


func shutdown() -> void:
	for record_value in _debugger_connections.values():
		var record: Dictionary = record_value
		var reference: WeakRef = record.get("debugger", null)
		var debugger: Object = null if reference == null else reference.get_ref()
		if debugger == null:
			continue
		for signal_name in [&"debug_data", &"output"]:
			var callback: Callable = record.get(str(signal_name), Callable())
			if (
				debugger.has_signal(signal_name)
				and callback.is_valid()
				and debugger.is_connected(signal_name, callback)
			):
				debugger.disconnect(signal_name, callback)
	_debugger_connections.clear()
	for record_value in _session_connections.values():
		var record: Dictionary = record_value
		var reference: WeakRef = record.get("session", null)
		var session: Object = null if reference == null else reference.get_ref()
		if session == null:
			continue
		for signal_name in [&"started", &"stopped", &"breaked", &"continued"]:
			var callback: Callable = record.get(str(signal_name), Callable())
			if callback.is_valid() and session.is_connected(signal_name, callback):
				session.disconnect(signal_name, callback)
	_session_connections.clear()
	_state_model.clear_sessions()


func _on_session_started(session_id: int) -> void:
	_state_model.session_started(session_id)


func _on_session_stopped(session_id: int) -> void:
	_state_model.session_stopped(session_id)


func _on_session_breaked(_can_debug: bool, session_id: int) -> void:
	_state_model.session_breaked(session_id)


func _on_session_continued(session_id: int) -> void:
	_state_model.session_continued(session_id)


func _on_debug_data(message: String, data: Array, session_id: int) -> void:
	if message.get_slice(":", 0) != "output":
		_state_model.capture_debug_message(message, data, session_id)


func _on_output(message: String, output_type: int, session_id: int) -> void:
	_state_model.capture_debug_message(
		"output",
		[message, output_type],
		session_id
	)


func _connect_debug_data_for_session(session_id: int) -> void:
	if _debugger_connections.has(session_id):
		return
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null or tree.root == null:
		return
	var debuggers: Array[Node] = []
	_collect_script_debuggers(tree.root, debuggers)
	debuggers.sort_custom(
		func(left: Node, right: Node) -> bool:
			return str(left.get_path()) < str(right.get_path())
	)
	if session_id < 0 or session_id >= debuggers.size():
		return
	var debugger: Node = debuggers[session_id]
	if not debugger.has_signal(&"debug_data"):
		return
	var callback: Callable = Callable(self, "_on_debug_data").bind(session_id)
	if not debugger.is_connected(&"debug_data", callback):
		debugger.connect(&"debug_data", callback)
	var output_callback: Callable = Callable(self, "_on_output").bind(session_id)
	if (
		debugger.has_signal(&"output")
		and not debugger.is_connected(&"output", output_callback)
	):
		debugger.connect(&"output", output_callback)
	_debugger_connections[session_id] = {
		"debugger": weakref(debugger),
		"debug_data": callback,
		"output": output_callback,
	}


func _collect_script_debuggers(node: Node, result: Array[Node]) -> void:
	if node.get_class() == "ScriptEditorDebugger":
		result.append(node)
	for child_value in node.get_children():
		if child_value is Node:
			_collect_script_debuggers(child_value, result)
