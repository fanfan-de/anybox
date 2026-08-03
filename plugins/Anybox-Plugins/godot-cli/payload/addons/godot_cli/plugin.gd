@tool
extends EditorPlugin


var _registry: BridgeToolRegistry
var _executor: BridgeToolExecutor
var _usage_tracker: BridgeToolUsageTracker
var _dispatcher: BridgeRpcDispatcher
var _server: BridgeTcpServer
var _tools: BridgeTools
var _debugger_bridge: BridgeDebuggerPlugin
var _panel: BridgeStatusPanel
var _panel_button: Button
var _last_panel_refresh_msec: int = 0
var _last_usage_revision: int = -1


func _enter_tree() -> void:
	_last_usage_revision = -1
	_registry = BridgeToolRegistry.new()
	_executor = BridgeToolExecutor.new(_registry)
	_usage_tracker = BridgeToolUsageTracker.new(_registry)
	_dispatcher = BridgeRpcDispatcher.new(_registry, _executor, _usage_tracker)
	_server = BridgeTcpServer.new(_dispatcher)
	_debugger_bridge = BridgeDebuggerPlugin.new()
	add_debugger_plugin(_debugger_bridge)
	_tools = BridgeTools.new(
		self,
		_registry,
		Callable(_server, "snapshot"),
		_debugger_bridge
	)
	var registration_error: Error = _tools.register_all()
	if registration_error != OK:
		push_error(
			"%s could not register tools: %s"
			% [BridgeConstants.PRODUCT_NAME, error_string(registration_error)]
		)
		_debugger_bridge.shutdown()
		remove_debugger_plugin(_debugger_bridge)
		_debugger_bridge = null
		return
	scene_saved.connect(_tools.on_scene_saved)
	scene_closed.connect(_tools.on_scene_closed)
	scene_changed.connect(_tools.on_scene_changed)

	_panel = BridgeStatusPanel.new()
	_panel.start_requested.connect(_start_server)
	_panel.stop_requested.connect(_stop_server)
	_panel.start_capture_requested.connect(_start_usage_capture)
	_panel.stop_capture_requested.connect(_stop_usage_capture)
	_panel.clear_capture_requested.connect(_clear_usage_capture)
	_panel.export_capture_requested.connect(_export_usage_capture)
	_panel_button = add_control_to_bottom_panel(_panel, BridgeConstants.PRODUCT_NAME)
	_server.status_changed.connect(_refresh_panel)
	_server.recent_error_changed.connect(_on_recent_error_changed)
	set_process(true)
	call_deferred("_start_server")


func _exit_tree() -> void:
	set_process(false)
	if _server != null:
		_server.stop()
	if _debugger_bridge != null:
		_debugger_bridge.shutdown()
		remove_debugger_plugin(_debugger_bridge)
	if _panel != null:
		remove_control_from_bottom_panel(_panel)
		_panel.queue_free()
	_panel = null
	_panel_button = null
	_tools = null
	_debugger_bridge = null
	_server = null
	_dispatcher = null
	_usage_tracker = null
	_executor = null
	_registry = null


func _process(_delta: float) -> void:
	if _server == null:
		return
	_server.process_transport()
	var now_msec: int = Time.get_ticks_msec()
	if now_msec - _last_panel_refresh_msec >= 250:
		_last_panel_refresh_msec = now_msec
		_refresh_panel()


func _start_server() -> void:
	if _server == null:
		return
	var result: Dictionary = _server.start()
	if not result["ok"]:
		push_error(
			"%s failed to start: %s"
			% [
				BridgeConstants.PRODUCT_NAME,
				str(result.get("error", {}).get("message", "unknown error"))
			]
		)
	_refresh_panel()


func _stop_server() -> void:
	if _server == null:
		return
	_server.stop()
	_refresh_panel()


func _refresh_panel() -> void:
	if _panel != null:
		_panel.update_status(_server.snapshot())
		if (
			_usage_tracker != null
			and _panel.is_usage_visible()
			and _usage_tracker.revision() != _last_usage_revision
		):
			_panel.update_usage(_usage_tracker.snapshot())
			_last_usage_revision = _usage_tracker.revision()


func _on_recent_error_changed(message: String) -> void:
	if not message.is_empty():
		push_warning(BridgeConstants.PRODUCT_NAME + ": " + message)
	_refresh_panel()


func _start_usage_capture(label: String) -> void:
	if _usage_tracker == null:
		return
	_usage_tracker.start_capture(label)
	_refresh_panel()


func _stop_usage_capture() -> void:
	if _usage_tracker == null:
		return
	_usage_tracker.stop_capture()
	_refresh_panel()


func _clear_usage_capture() -> void:
	if _usage_tracker == null:
		return
	_usage_tracker.clear_current_capture()
	_refresh_panel()


func _export_usage_capture() -> void:
	if _usage_tracker == null or _panel == null:
		return
	_panel.show_usage_export_result(_usage_tracker.export_current_capture())
