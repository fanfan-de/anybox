@tool
class_name BridgeToolUsagePanel
extends VBoxContainer


signal start_capture_requested(label: String)
signal stop_capture_requested
signal clear_capture_requested
signal export_capture_requested

enum FilterMode {
	ALL,
	READ,
	WRITE,
	ISSUES,
}

var _capture_label: LineEdit
var _capture_state: Label
var _stop_button: Button
var _summary: Label
var _filter: OptionButton
var _search: LineEdit
var _pause: CheckButton
var _tool_tree: Tree
var _event_tree: Tree
var _export_status: Label
var _last_snapshot: Dictionary = {}
var _last_capture_id: String = ""


func _ready() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 6)
	_build_capture_toolbar()
	_build_summary()
	_build_filters()
	_build_tables()
	_build_export_status()


func update_usage(snapshot: Dictionary) -> void:
	_last_snapshot = snapshot.duplicate(true)
	if not is_node_ready():
		return
	if _pause.button_pressed:
		return
	_render_snapshot()


func show_export_result(result: Dictionary) -> void:
	if bool(result.get("ok", false)):
		var path: String = str(result.get("path", ""))
		_export_status.text = "Exported: " + path
		_export_status.tooltip_text = path
		_export_status.add_theme_color_override(
			"font_color",
			Color(0.45, 0.85, 0.58)
		)
	else:
		var error: Dictionary = result.get("error", {})
		var message: String = str(error.get("message", "Export failed"))
		_export_status.text = message
		_export_status.tooltip_text = message
		_export_status.add_theme_color_override(
			"font_color",
			Color(0.95, 0.45, 0.45)
		)


func _build_capture_toolbar() -> void:
	var toolbar: HBoxContainer = HBoxContainer.new()
	toolbar.add_theme_constant_override("separation", 6)
	add_child(toolbar)

	var label: Label = Label.new()
	label.text = "Capture"
	toolbar.add_child(label)

	_capture_label = LineEdit.new()
	_capture_label.placeholder_text = "Task label"
	_capture_label.custom_minimum_size.x = 220.0
	_capture_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_capture_label.text_submitted.connect(_on_capture_label_submitted)
	toolbar.add_child(_capture_label)

	var new_button: Button = Button.new()
	new_button.text = "New"
	new_button.tooltip_text = "Start a new capture and clear the current in-memory data."
	new_button.pressed.connect(_on_new_capture_pressed)
	toolbar.add_child(new_button)

	_stop_button = Button.new()
	_stop_button.text = "Stop"
	_stop_button.tooltip_text = "Stop recording new tool calls."
	_stop_button.pressed.connect(func() -> void: stop_capture_requested.emit())
	toolbar.add_child(_stop_button)

	var clear_button: Button = Button.new()
	clear_button.text = "Clear"
	clear_button.tooltip_text = "Clear events and counters for the current capture."
	clear_button.pressed.connect(func() -> void: clear_capture_requested.emit())
	toolbar.add_child(clear_button)

	var export_button: Button = Button.new()
	export_button.text = "Export JSON"
	export_button.tooltip_text = "Export the current local capture without arguments or results."
	export_button.pressed.connect(func() -> void: export_capture_requested.emit())
	toolbar.add_child(export_button)

	_capture_state = Label.new()
	_capture_state.text = "● Recording"
	toolbar.add_child(_capture_state)


func _build_summary() -> void:
	_summary = Label.new()
	_summary.text = "Calls 0 · Logical 0 · Tools 0/0 · Success 0 · Confirm 0 · Issues 0"
	add_child(_summary)


func _build_filters() -> void:
	var filters: HBoxContainer = HBoxContainer.new()
	filters.add_theme_constant_override("separation", 6)
	add_child(filters)

	_filter = OptionButton.new()
	_filter.add_item("All", FilterMode.ALL)
	_filter.add_item("Read", FilterMode.READ)
	_filter.add_item("Write", FilterMode.WRITE)
	_filter.add_item("Issues", FilterMode.ISSUES)
	_filter.item_selected.connect(func(_index: int) -> void: _render_snapshot())
	filters.add_child(_filter)

	_search = LineEdit.new()
	_search.placeholder_text = "Filter tool name"
	_search.clear_button_enabled = true
	_search.custom_minimum_size.x = 220.0
	_search.text_changed.connect(func(_value: String) -> void: _render_snapshot())
	filters.add_child(_search)

	_pause = CheckButton.new()
	_pause.text = "Pause display"
	_pause.tooltip_text = "Recording continues while the display is paused."
	_pause.toggled.connect(_on_pause_toggled)
	filters.add_child(_pause)


func _build_tables() -> void:
	var split: HSplitContainer = HSplitContainer.new()
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	split.split_offset = 560
	add_child(split)

	var tool_section: VBoxContainer = VBoxContainer.new()
	tool_section.custom_minimum_size.x = 520.0
	tool_section.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tool_section.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.add_child(tool_section)
	var tool_title: Label = Label.new()
	tool_title.text = "Tool frequency"
	tool_section.add_child(tool_title)
	_tool_tree = Tree.new()
	_tool_tree.columns = 7
	_tool_tree.column_titles_visible = true
	_tool_tree.hide_root = true
	_tool_tree.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_tool_tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_set_tree_column(_tool_tree, 0, "Tool", 210, true)
	_set_tree_column(_tool_tree, 1, "Raw", 48)
	_set_tree_column(_tool_tree, 2, "Logic", 52)
	_set_tree_column(_tool_tree, 3, "OK", 44)
	_set_tree_column(_tool_tree, 4, "Confirm", 62)
	_set_tree_column(_tool_tree, 5, "Issue", 50)
	_set_tree_column(_tool_tree, 6, "P95", 48)
	tool_section.add_child(_tool_tree)

	var event_section: VBoxContainer = VBoxContainer.new()
	event_section.custom_minimum_size.x = 430.0
	event_section.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	event_section.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.add_child(event_section)
	var event_title: Label = Label.new()
	event_title.text = "Live calls"
	event_section.add_child(event_title)
	_event_tree = Tree.new()
	_event_tree.columns = 5
	_event_tree.column_titles_visible = true
	_event_tree.hide_root = true
	_event_tree.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_event_tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_set_tree_column(_event_tree, 0, "Time", 68)
	_set_tree_column(_event_tree, 1, "Tool", 190, true)
	_set_tree_column(_event_tree, 2, "Risk", 54)
	_set_tree_column(_event_tree, 3, "Status", 80)
	_set_tree_column(_event_tree, 4, "ms", 44)
	event_section.add_child(_event_tree)


func _build_export_status() -> void:
	_export_status = Label.new()
	_export_status.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_export_status.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(_export_status)


func _render_snapshot() -> void:
	if _last_snapshot.is_empty() or not is_node_ready():
		return
	var capture: Dictionary = _last_snapshot.get("capture", {})
	var capture_id: String = str(capture.get("id", ""))
	if capture_id != _last_capture_id:
		_last_capture_id = capture_id
		_capture_label.text = str(capture.get("label", ""))
	var active: bool = bool(capture.get("active", false))
	_capture_state.text = "● Recording" if active else "■ Stopped"
	_capture_state.add_theme_color_override(
		"font_color",
		Color(0.45, 0.85, 0.58) if active else Color(0.7, 0.7, 0.7)
	)
	_stop_button.disabled = not active

	var summary: Dictionary = _last_snapshot.get("summary", {})
	var issues: int = (
		int(summary.get("invalid_count", 0))
		+ int(summary.get("failed_count", 0))
	)
	_summary.text = (
		"Calls %d · Logical %d · Tools %d/%d · Success %d · Confirm %d · Issues %d"
		% [
			int(summary.get("raw_calls", 0)),
			int(summary.get("logical_calls", 0)),
			int(summary.get("used_tool_count", 0)),
			int(summary.get("registered_tool_count", 0)),
			int(summary.get("success_count", 0)),
			int(summary.get("confirmation_count", 0)),
			issues,
		]
	)
	_render_tools(_last_snapshot.get("tools", []))
	_render_events(_last_snapshot.get("events", []))


func _render_tools(source: Array) -> void:
	_tool_tree.clear()
	var root: TreeItem = _tool_tree.create_item()
	var tools: Array = source.duplicate(true)
	tools.sort_custom(
		func(left: Dictionary, right: Dictionary) -> bool:
			var left_calls: int = int(left.get("raw_calls", 0))
			var right_calls: int = int(right.get("raw_calls", 0))
			if left_calls == right_calls:
				return str(left.get("name", "")) < str(right.get("name", ""))
			return left_calls > right_calls
	)
	for tool in tools:
		if not _tool_matches_filter(tool):
			continue
		var item: TreeItem = _tool_tree.create_item(root)
		var issue_count: int = (
			int(tool.get("invalid_count", 0))
			+ int(tool.get("failed_count", 0))
		)
		item.set_text(0, str(tool.get("name", "")))
		item.set_text(1, str(tool.get("raw_calls", 0)))
		item.set_text(2, str(tool.get("logical_calls", 0)))
		item.set_text(3, str(tool.get("success_count", 0)))
		item.set_text(4, str(tool.get("confirmation_count", 0)))
		item.set_text(5, str(issue_count))
		item.set_text(6, str(tool.get("p95_duration_ms", 0)))
		if issue_count > 0:
			item.set_custom_color(5, Color(0.95, 0.45, 0.45))
		elif int(tool.get("confirmation_count", 0)) > 0:
			item.set_custom_color(4, Color(0.95, 0.72, 0.32))


func _render_events(events: Array) -> void:
	_event_tree.clear()
	var root: TreeItem = _event_tree.create_item()
	for index in range(events.size() - 1, -1, -1):
		var event: Dictionary = events[index]
		if not _event_matches_filter(event):
			continue
		var item: TreeItem = _event_tree.create_item(root)
		var status: String = str(event.get("status", "failed"))
		var status_label: String = _status_label(status)
		var inference: String = str(event.get("logical_inference", ""))
		if not inference.is_empty():
			status_label += " · " + inference.to_upper()
		item.set_text(0, "+%.2fs" % (float(event.get("elapsed_ms", 0)) / 1000.0))
		item.set_text(1, str(event.get("tool_name", "")))
		item.set_text(2, str(event.get("risk", "")).to_upper())
		item.set_text(3, status_label)
		item.set_text(4, str(event.get("duration_ms", 0)))
		item.set_tooltip_text(3, str(event.get("error_code", "")))
		item.set_custom_color(3, _status_color(status))


func _tool_matches_filter(tool: Dictionary) -> bool:
	var name: String = str(tool.get("name", ""))
	if not _search.text.strip_edges().is_empty():
		if not name.to_lower().contains(_search.text.strip_edges().to_lower()):
			return false
	match _filter.get_selected_id():
		FilterMode.READ:
			return str(tool.get("risk", "")) == "read"
		FilterMode.WRITE:
			return str(tool.get("risk", "")) == "write"
		FilterMode.ISSUES:
			return (
				int(tool.get("confirmation_count", 0))
				+ int(tool.get("invalid_count", 0))
				+ int(tool.get("failed_count", 0))
			) > 0
		_:
			return true


func _event_matches_filter(event: Dictionary) -> bool:
	var name: String = str(event.get("tool_name", ""))
	if not _search.text.strip_edges().is_empty():
		if not name.to_lower().contains(_search.text.strip_edges().to_lower()):
			return false
	match _filter.get_selected_id():
		FilterMode.READ:
			return str(event.get("risk", "")) == "read"
		FilterMode.WRITE:
			return str(event.get("risk", "")) == "write"
		FilterMode.ISSUES:
			return str(event.get("status", "")) != "success"
		_:
			return true


func _status_label(status: String) -> String:
	match status:
		"success":
			return "SUCCESS"
		"confirmation_required":
			return "CONFIRM"
		"invalid":
			return "INVALID"
		_:
			return "FAILED"


func _status_color(status: String) -> Color:
	match status:
		"success":
			return Color(0.45, 0.85, 0.58)
		"confirmation_required":
			return Color(0.95, 0.72, 0.32)
		_:
			return Color(0.95, 0.45, 0.45)


func _set_tree_column(
	tree: Tree,
	column: int,
	title: String,
	minimum_width: int,
	expand: bool = false
) -> void:
	tree.set_column_title(column, title)
	tree.set_column_custom_minimum_width(column, minimum_width)
	tree.set_column_expand(column, expand)


func _on_new_capture_pressed() -> void:
	start_capture_requested.emit(_capture_label.text)


func _on_capture_label_submitted(_value: String) -> void:
	_on_new_capture_pressed()


func _on_pause_toggled(paused: bool) -> void:
	if not paused:
		_render_snapshot()
