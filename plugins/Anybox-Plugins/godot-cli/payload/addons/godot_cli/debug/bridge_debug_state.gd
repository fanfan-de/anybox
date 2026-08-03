class_name BridgeDebugState
extends RefCounted


const CAPTURE_PREFIXES: Array[String] = [
	"output",
	"error",
	"script_error",
	"gdscript",
]
const STARTING_GRACE_MSEC: int = 2000

var _run_id: int = 0
var _state: String = "stopped"
var _target: String = "main"
var _requested_scene_path: String = ""
var _active_scene_path: String = ""
var _next_sequence: int = 1
var _state_started_msec: int = 0
var _events: Array[Dictionary] = []
var _latest_sequence_by_run: Dictionary = {}
var _dropped_before_sequence_by_run: Dictionary = {}
var _sessions: Dictionary = {}


static func accepts_capture_prefix(capture: String) -> bool:
	return capture in CAPTURE_PREFIXES


func begin_run(target: String, requested_scene_path: String) -> int:
	_run_id += 1
	_state = "starting"
	_state_started_msec = Time.get_ticks_msec()
	_target = target
	_requested_scene_path = requested_scene_path
	_active_scene_path = ""
	for session_id in _sessions:
		_sessions[session_id]["active"] = false
		_sessions[session_id]["paused"] = false
		_sessions[session_id]["run_id"] = _run_id
	return _run_id


func request_stop() -> void:
	if _state != "stopped":
		_state = "stopping"


func synchronize_editor_state(
	playing: bool,
	active_scene_path: String,
	inferred_target: String
) -> void:
	if playing and _state == "stopped":
		_begin_external_run(inferred_target, active_scene_path)
	if playing:
		_active_scene_path = active_scene_path
		if _requested_scene_path.is_empty():
			_target = inferred_target
			_requested_scene_path = active_scene_path
	elif _state == "stopped":
		_active_scene_path = ""

	var active_sessions: int = _active_session_count()
	if _state == "stopping":
		if not playing and active_sessions == 0:
			_state = "stopped"
			_active_scene_path = ""
		return
	if not playing:
		if (
			_state == "starting"
			and active_sessions == 0
			and Time.get_ticks_msec() - _state_started_msec
			<= STARTING_GRACE_MSEC
		):
			return
		_state = "stopped" if active_sessions == 0 else "stopping"
		if _state == "stopped":
			_active_scene_path = ""
		return
	if active_sessions > 0:
		_state = "paused" if _has_paused_session() else "running"
	elif _state != "starting":
		_state = "running"


func snapshot() -> Dictionary:
	return {
		"state": _state,
		"run_id": _run_id,
		"target": _target,
		"requested_scene_path": _requested_scene_path,
		"active_scene_path": _active_scene_path,
		"debugger_sessions": _active_session_count(),
		"output_latest_sequence": int(
			_latest_sequence_by_run.get(_run_id, 0)
		),
	}


func output_page(
	requested_run_id: int,
	after_sequence: int,
	limit: int,
	category: String
) -> Dictionary:
	var selected_run_id: int = _run_id if requested_run_id < 0 else requested_run_id
	var oldest_available_sequence: int = 0
	for event in _events:
		if int(event["run_id"]) == selected_run_id:
			oldest_available_sequence = int(event["sequence"])
			break
	var dropped_before_sequence: int = int(
		_dropped_before_sequence_by_run.get(selected_run_id, 0)
	)
	var page: Array[Dictionary] = []
	var has_more: bool = false
	for event in _events:
		if (
			int(event["run_id"]) != selected_run_id
			or int(event["sequence"]) <= after_sequence
			or (category != "all" and str(event["category"]) != category)
		):
			continue
		if page.size() < limit:
			page.append(event.duplicate(true))
		else:
			has_more = true
			break
	var next_page_sequence: int = maxi(
		after_sequence,
		dropped_before_sequence
	)
	if not page.is_empty():
		next_page_sequence = int(page[page.size() - 1]["sequence"])
	return {
		"run_id": selected_run_id,
		"events": page,
		"count": page.size(),
		"next_sequence": next_page_sequence,
		"oldest_available_sequence": oldest_available_sequence,
		"latest_sequence": int(
			_latest_sequence_by_run.get(selected_run_id, 0)
		),
		"dropped_before_sequence": dropped_before_sequence,
		"has_more": has_more,
	}


func session_started(session_id: int) -> void:
	if _state == "stopped":
		_begin_external_run("scene", "")
	_sessions[session_id] = {
		"active": true,
		"paused": false,
		"run_id": _run_id,
	}
	if _state != "stopping":
		_state = "running"


func session_stopped(session_id: int) -> void:
	if _sessions.has(session_id):
		_sessions[session_id]["active"] = false
		_sessions[session_id]["paused"] = false
	if _active_session_count() == 0 and _state != "stopping":
		_state = "stopped"
		_active_scene_path = ""


func session_breaked(session_id: int) -> void:
	if not _sessions.has(session_id):
		_sessions[session_id] = {
			"active": true,
			"paused": true,
			"run_id": _run_id,
		}
	else:
		_sessions[session_id]["active"] = true
		_sessions[session_id]["paused"] = true
	if _state != "stopping":
		_state = "paused"


func session_continued(session_id: int) -> void:
	if _sessions.has(session_id):
		_sessions[session_id]["paused"] = false
	if _state != "stopping":
		_state = "paused" if _has_paused_session() else "running"


func clear_sessions() -> void:
	_sessions.clear()


func capture_debug_message(
	message: String,
	data: Array,
	session_id: int
) -> void:
	var prefix: String = message.get_slice(":", 0)
	if not accepts_capture_prefix(prefix):
		return
	match prefix:
		"output":
			_capture_output(data, session_id)
		"error":
			_capture_error(data, session_id)
		"script_error", "gdscript":
			_capture_simple_error(data, session_id)


func _capture_output(data: Array, session_id: int) -> void:
	if (
		data.size() == 2
		and data[0] is PackedStringArray
		and data[1] is PackedInt32Array
	):
		var messages: PackedStringArray = data[0]
		var types: PackedInt32Array = data[1]
		if messages.size() != types.size():
			return
		for index in messages.size():
			_append_event(
				_output_category(types[index]),
				messages[index],
				session_id
			)
		return
	if data.size() >= 2 and typeof(data[0]) == TYPE_STRING:
		_append_event(
			_output_category(int(data[1])),
			str(data[0]),
			session_id
		)


func _capture_error(data: Array, session_id: int) -> void:
	if data.size() >= 11:
		var file: String = str(data[4])
		var function_name: String = str(data[5])
		var line: int = int(data[6])
		var message: String = str(data[8])
		if message.is_empty():
			message = str(data[7])
		if not file.begins_with("res://") and data.size() >= 14:
			file = str(data[11])
			function_name = str(data[12])
			line = int(data[13])
		var category: String = "stderr" if bool(data[9]) else "error"
		_append_event(category, message, session_id, file, line, function_name)
		return
	_capture_simple_error(data, session_id)


func _capture_simple_error(data: Array, session_id: int) -> void:
	if data.is_empty():
		return
	_append_event(
		"error",
		str(data[0]),
		session_id,
		str(data[1]) if data.size() > 1 else "",
		int(data[2]) if data.size() > 2 else 0,
		str(data[3]) if data.size() > 3 else ""
	)


func _append_event(
	category: String,
	message: String,
	session_id: int,
	file: String = "",
	line: int = 0,
	function_name: String = ""
) -> void:
	var run_for_event: int = _event_run_id(session_id)
	var truncated_message: Dictionary = _truncate_utf8(message)
	var event: Dictionary = {
		"run_id": run_for_event,
		"sequence": _next_sequence,
		"session_id": session_id,
		"timestamp_msec": int(Time.get_unix_time_from_system() * 1000.0),
		"category": category,
		"message": truncated_message["value"],
	}
	if not file.is_empty():
		event["file"] = str(_truncate_utf8(file)["value"])
	if line > 0:
		event["line"] = line
	if not function_name.is_empty():
		event["function"] = str(_truncate_utf8(function_name)["value"])
	if bool(truncated_message["truncated"]):
		event["truncated"] = true
	_next_sequence += 1
	_events.append(event)
	_latest_sequence_by_run[run_for_event] = int(event["sequence"])
	while _events.size() > BridgeConstants.MAX_DEBUG_OUTPUT_EVENTS:
		var removed: Dictionary = _events.pop_front()
		var removed_run_id: int = int(removed["run_id"])
		_dropped_before_sequence_by_run[removed_run_id] = maxi(
			int(_dropped_before_sequence_by_run.get(removed_run_id, 0)),
			int(removed["sequence"])
		)


func _event_run_id(session_id: int) -> int:
	if _sessions.has(session_id):
		return int(_sessions[session_id].get("run_id", _run_id))
	return _run_id


func _truncate_utf8(value: String) -> Dictionary:
	var byte_count: int = value.to_utf8_buffer().size()
	if byte_count <= BridgeConstants.MAX_DEBUG_MESSAGE_BYTES:
		return {"value": value, "truncated": false}
	var low: int = 0
	var high: int = mini(
		value.length(),
		BridgeConstants.MAX_DEBUG_MESSAGE_BYTES
	)
	while low < high:
		var middle: int = int((low + high + 1) / 2.0)
		if (
			value.substr(0, middle).to_utf8_buffer().size()
			<= BridgeConstants.MAX_DEBUG_MESSAGE_BYTES
		):
			low = middle
		else:
			high = middle - 1
	return {"value": value.substr(0, low), "truncated": true}


func _output_category(output_type: int) -> String:
	return "stderr" if output_type == 1 else "stdout"


func _active_session_count() -> int:
	var count: int = 0
	for session_value in _sessions.values():
		if bool(session_value.get("active", false)):
			count += 1
	return count


func _has_paused_session() -> bool:
	for session_value in _sessions.values():
		if (
			bool(session_value.get("active", false))
			and bool(session_value.get("paused", false))
		):
			return true
	return false


func _begin_external_run(target: String, scene_path: String) -> void:
	_run_id += 1
	_state = "starting"
	_state_started_msec = Time.get_ticks_msec()
	_target = target if target in ["main", "current", "scene"] else "scene"
	_requested_scene_path = scene_path
	_active_scene_path = scene_path
