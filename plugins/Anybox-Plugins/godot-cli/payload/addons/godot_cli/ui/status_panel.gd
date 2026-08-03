@tool
class_name BridgeStatusPanel
extends VBoxContainer


signal start_requested
signal stop_requested
signal start_capture_requested(label: String)
signal stop_capture_requested
signal clear_capture_requested
signal export_capture_requested

var _status_value: Label
var _port_value: Label
var _client_value: Label
var _project_value: Label
var _error_value: Label
var _toggle_button: Button
var _usage_panel: BridgeToolUsagePanel
var _listening: bool = false


func _ready() -> void:
	name = BridgeConstants.PRODUCT_NAME
	custom_minimum_size = Vector2(840.0, 300.0)
	add_theme_constant_override("separation", 6)
	var tabs: TabContainer = TabContainer.new()
	tabs.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(tabs)

	var service: VBoxContainer = VBoxContainer.new()
	service.name = "Service"
	service.add_theme_constant_override("separation", 6)
	tabs.add_child(service)

	var title: Label = Label.new()
	title.text = BridgeConstants.PRODUCT_NAME
	title.add_theme_font_size_override("font_size", 18)
	service.add_child(title)

	var grid: GridContainer = GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 16)
	grid.add_theme_constant_override("v_separation", 4)
	service.add_child(grid)
	_status_value = _add_row(grid, "Service")
	_port_value = _add_row(grid, "Port")
	_client_value = _add_row(grid, "Clients")
	_project_value = _add_row(grid, "Project")
	_project_value.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_error_value = _add_row(grid, "Recent error")
	_error_value.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART

	_toggle_button = Button.new()
	_toggle_button.text = "Start"
	_toggle_button.pressed.connect(_on_toggle_pressed)
	service.add_child(_toggle_button)

	_usage_panel = BridgeToolUsagePanel.new()
	_usage_panel.name = "Tool Usage"
	_usage_panel.start_capture_requested.connect(
		func(label: String) -> void: start_capture_requested.emit(label)
	)
	_usage_panel.stop_capture_requested.connect(
		func() -> void: stop_capture_requested.emit()
	)
	_usage_panel.clear_capture_requested.connect(
		func() -> void: clear_capture_requested.emit()
	)
	_usage_panel.export_capture_requested.connect(
		func() -> void: export_capture_requested.emit()
	)
	tabs.add_child(_usage_panel)


func update_status(snapshot: Dictionary) -> void:
	if not is_node_ready():
		return
	_listening = bool(snapshot.get("listening", false))
	_status_value.text = "Running" if _listening else "Stopped"
	_port_value.text = str(snapshot.get("port", 0)) if _listening else "—"
	_client_value.text = str(snapshot.get("client_count", 0))
	var session: Dictionary = snapshot.get("session", {})
	_project_value.text = str(
		session.get(
			"project_path",
			ProjectSettings.globalize_path("res://").replace("\\", "/")
		)
	)
	var recent_error: String = str(snapshot.get("recent_error", ""))
	_error_value.text = "None" if recent_error.is_empty() else recent_error
	_toggle_button.text = "Stop" if _listening else "Start"


func update_usage(snapshot: Dictionary) -> void:
	if _usage_panel != null:
		_usage_panel.update_usage(snapshot)


func show_usage_export_result(result: Dictionary) -> void:
	if _usage_panel != null:
		_usage_panel.show_export_result(result)


func is_usage_visible() -> bool:
	return _usage_panel != null and _usage_panel.is_visible_in_tree()


func _add_row(grid: GridContainer, label_text: String) -> Label:
	var label: Label = Label.new()
	label.text = label_text
	grid.add_child(label)
	var value: Label = Label.new()
	value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_child(value)
	return value


func _on_toggle_pressed() -> void:
	if _listening:
		stop_requested.emit()
	else:
		start_requested.emit()
