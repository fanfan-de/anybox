class_name BridgeToolUsageTracker
extends RefCounted


const SCHEMA_VERSION: int = 1
const DEFAULT_EVENT_LIMIT: int = 2000
const MAX_DURATION_SAMPLES_PER_TOOL: int = 256
const POLL_COLLAPSE_WINDOW_MSEC: int = 1500
const CONFIRMATION_COLLAPSE_WINDOW_MSEC: int = 30_000
const MAX_CAPTURE_LABEL_LENGTH: int = 128
const POLLING_TOOLS: Array[String] = ["get_run_state", "get_debug_output"]

var _registry: BridgeToolRegistry
var _event_limit: int = DEFAULT_EVENT_LIMIT
var _event_buffer: Array[Dictionary] = []
var _event_start_index: int = 0
var _dropped_events: int = 0
var _tool_stats: Dictionary = {}
var _totals: Dictionary = {}
var _last_logical_event_by_tool: Dictionary = {}
var _sequence: int = 0
var _revision: int = 0
var _capture_counter: int = 0
var _capture_id: String = ""
var _capture_label: String = ""
var _capture_active: bool = false
var _capture_started_unix_ms: int = 0
var _capture_started_ticks_msec: int = 0
var _capture_ended_unix_ms: int = 0


func _init(
	registry: BridgeToolRegistry,
	event_limit: int = DEFAULT_EVENT_LIMIT
) -> void:
	_registry = registry
	_event_limit = maxi(1, event_limit)
	start_capture("Editor session")


func start_capture(label: String = "") -> Dictionary:
	_capture_counter += 1
	var now_unix_ms: int = _unix_time_msec()
	_capture_id = "capture-%d-%d" % [now_unix_ms, _capture_counter]
	_capture_label = label.strip_edges().left(MAX_CAPTURE_LABEL_LENGTH)
	if _capture_label.is_empty():
		_capture_label = "Capture %d" % _capture_counter
	_capture_active = true
	_capture_started_unix_ms = now_unix_ms
	_capture_started_ticks_msec = Time.get_ticks_msec()
	_capture_ended_unix_ms = 0
	_reset_capture_data()
	_revision += 1
	return capture_snapshot()


func stop_capture() -> Dictionary:
	if _capture_active:
		_capture_active = false
		_capture_ended_unix_ms = _unix_time_msec()
		_revision += 1
	return capture_snapshot()


func clear_current_capture() -> Dictionary:
	_capture_started_unix_ms = _unix_time_msec()
	_capture_started_ticks_msec = Time.get_ticks_msec()
	_capture_ended_unix_ms = 0 if _capture_active else _capture_started_unix_ms
	_reset_capture_data()
	_revision += 1
	return capture_snapshot()


func is_capture_active() -> bool:
	return _capture_active


func revision() -> int:
	return _revision


func record_tool_call(
	name: String,
	arguments: Dictionary,
	apply: bool,
	outcome: Dictionary
) -> void:
	if not _capture_active:
		return

	_sequence += 1
	var now_ticks_msec: int = Time.get_ticks_msec()
	var definition: BridgeToolDefinition = _registry.get_tool(name)
	var recognized_fields: Array[String] = _recognized_argument_fields(
		definition,
		arguments
	)
	var classification: Dictionary = _classify_outcome(outcome)
	var duration_ms: int = maxi(0, int(outcome.get("duration_ms", 0)))
	var event: Dictionary = {
		"schema_version": SCHEMA_VERSION,
		"sequence": _sequence,
		"capture_id": _capture_id,
		"timestamp_unix_ms": _unix_time_msec(),
		"elapsed_ms": maxi(0, now_ticks_msec - _capture_started_ticks_msec),
		"tool_name": name,
		"risk": definition.risk if definition != null else "unknown",
		"requires_apply": definition.requires_apply if definition != null else false,
		"apply": apply,
		"status": classification["status"],
		"error_code": classification["error_code"],
		"duration_ms": duration_ms,
		"recognized_argument_fields": recognized_fields,
	}
	_assign_logical_group(event, now_ticks_msec)
	_append_event(event)
	_update_totals(event)
	_update_tool_stats(event)
	_last_logical_event_by_tool[name] = {
		"sequence": event["sequence"],
		"logical_group": event["logical_group"],
		"status": event["status"],
		"apply": event["apply"],
		"recognized_argument_fields": recognized_fields.duplicate(),
		"ticks_msec": now_ticks_msec,
	}
	_revision += 1


func snapshot(recent_event_limit: int = 100) -> Dictionary:
	var tools: Array[Dictionary] = _tool_rows()
	var used_tool_count: int = 0
	for row in tools:
		if (
			int(row.get("raw_calls", 0)) > 0
			and str(row.get("risk", "")) in ["read", "write"]
		):
			used_tool_count += 1
	var summary: Dictionary = _totals.duplicate(true)
	summary["registered_tool_count"] = _registry.size()
	summary["used_tool_count"] = used_tool_count
	summary["dropped_events"] = _dropped_events
	return {
		"schema_version": SCHEMA_VERSION,
		"revision": _revision,
		"latest_sequence": _sequence,
		"capture": capture_snapshot(),
		"summary": summary,
		"tools": tools,
		"events": recent_events(recent_event_limit),
	}


func capture_snapshot() -> Dictionary:
	return {
		"id": _capture_id,
		"label": _capture_label,
		"active": _capture_active,
		"started_unix_ms": _capture_started_unix_ms,
		"ended_unix_ms": _capture_ended_unix_ms,
	}


func recent_events(limit: int = 100) -> Array[Dictionary]:
	var available: int = _event_buffer.size() - _event_start_index
	var bounded_limit: int = clampi(limit, 0, available)
	var first: int = _event_buffer.size() - bounded_limit
	var result: Array[Dictionary] = []
	for index in range(first, _event_buffer.size()):
		result.append(_event_buffer[index].duplicate(true))
	return result


func export_current_capture() -> Dictionary:
	var report_directory_uri: String = "user://godot-cli/usage-reports"
	var report_directory_absolute: String = ProjectSettings.globalize_path(
		report_directory_uri
	)
	var make_error: Error = DirAccess.make_dir_recursive_absolute(
		report_directory_absolute
	)
	if make_error != OK:
		return _export_failure(
			"Could not create the usage report directory: " + error_string(make_error)
		)

	var generated_unix_ms: int = _unix_time_msec()
	var file_name: String = "%s-%d-%d.json" % [
		_capture_id,
		_sequence,
		generated_unix_ms,
	]
	var final_uri: String = report_directory_uri.path_join(file_name)
	var temporary_uri: String = final_uri + ".tmp"
	var report: Dictionary = snapshot(_event_limit)
	report["generated_unix_ms"] = generated_unix_ms
	report["plugin_version"] = BridgeConstants.PLUGIN_VERSION

	var file: FileAccess = FileAccess.open(temporary_uri, FileAccess.WRITE)
	if file == null:
		return _export_failure(
			"Could not open the temporary usage report: "
			+ error_string(FileAccess.get_open_error())
		)
	file.store_string(JSON.stringify(report, "\t", false))
	var write_error: Error = file.get_error()
	file.close()
	if write_error != OK:
		DirAccess.remove_absolute(ProjectSettings.globalize_path(temporary_uri))
		return _export_failure(
			"Could not write the usage report: " + error_string(write_error)
		)

	var temporary_absolute: String = ProjectSettings.globalize_path(temporary_uri)
	var final_absolute: String = ProjectSettings.globalize_path(final_uri)
	var rename_error: Error = DirAccess.rename_absolute(
		temporary_absolute,
		final_absolute
	)
	if rename_error != OK:
		DirAccess.remove_absolute(temporary_absolute)
		return _export_failure(
			"Could not finalize the usage report: " + error_string(rename_error)
		)
	return {
		"ok": true,
		"path": final_absolute.replace("\\", "/"),
	}


func _reset_capture_data() -> void:
	_event_buffer.clear()
	_event_start_index = 0
	_dropped_events = 0
	_tool_stats.clear()
	_last_logical_event_by_tool.clear()
	_totals = {
		"raw_calls": 0,
		"logical_calls": 0,
		"success_count": 0,
		"confirmation_count": 0,
		"invalid_count": 0,
		"failed_count": 0,
		"read_count": 0,
		"write_count": 0,
		"unknown_tool_count": 0,
	}


func _append_event(event: Dictionary) -> void:
	_event_buffer.append(event)
	if _event_buffer.size() - _event_start_index > _event_limit:
		_event_start_index += 1
		_dropped_events += 1
	if _event_start_index >= _event_limit:
		_event_buffer = _event_buffer.slice(_event_start_index)
		_event_start_index = 0


func _assign_logical_group(event: Dictionary, now_ticks_msec: int) -> void:
	var name: String = str(event["tool_name"])
	var previous: Dictionary = _last_logical_event_by_tool.get(name, {})
	var logical_group: int = int(event["sequence"])
	var logical_increment: int = 1
	var inference: String = ""
	if not previous.is_empty():
		var elapsed: int = maxi(0, now_ticks_msec - int(previous["ticks_msec"]))
		var same_fields: bool = (
			previous["recognized_argument_fields"]
			== event["recognized_argument_fields"]
		)
		if (
			name in POLLING_TOOLS
			and elapsed <= POLL_COLLAPSE_WINDOW_MSEC
			and str(previous["status"]) == "success"
			and str(event["status"]) == "success"
		):
			logical_group = int(previous["logical_group"])
			logical_increment = 0
			inference = "poll"
		elif (
			str(previous["status"]) == "confirmation_required"
			and str(event["status"]) == "success"
			and bool(event["apply"])
			and same_fields
			and elapsed <= CONFIRMATION_COLLAPSE_WINDOW_MSEC
		):
			logical_group = int(previous["logical_group"])
			logical_increment = 0
			inference = "confirmation"
	event["logical_group"] = logical_group
	event["logical_increment"] = logical_increment
	event["logical_inference"] = inference


func _update_totals(event: Dictionary) -> void:
	_totals["raw_calls"] = int(_totals["raw_calls"]) + 1
	_totals["logical_calls"] = (
		int(_totals["logical_calls"]) + int(event["logical_increment"])
	)
	var status_key: String = _status_count_key(str(event["status"]))
	_totals[status_key] = int(_totals[status_key]) + 1
	var risk: String = str(event["risk"])
	if risk == "read":
		_totals["read_count"] = int(_totals["read_count"]) + 1
	elif risk == "write":
		_totals["write_count"] = int(_totals["write_count"]) + 1
	else:
		_totals["unknown_tool_count"] = int(_totals["unknown_tool_count"]) + 1


func _update_tool_stats(event: Dictionary) -> void:
	var name: String = str(event["tool_name"])
	if not _tool_stats.has(name):
		_tool_stats[name] = _empty_tool_stats(
			name,
			str(event["risk"]),
			bool(event["requires_apply"])
		)
	var stats: Dictionary = _tool_stats[name]
	stats["raw_calls"] = int(stats["raw_calls"]) + 1
	stats["logical_calls"] = (
		int(stats["logical_calls"]) + int(event["logical_increment"])
	)
	var status_key: String = _status_count_key(str(event["status"]))
	stats[status_key] = int(stats[status_key]) + 1
	var duration_ms: int = int(event["duration_ms"])
	stats["total_duration_ms"] = int(stats["total_duration_ms"]) + duration_ms
	stats["max_duration_ms"] = maxi(int(stats["max_duration_ms"]), duration_ms)
	stats["last_sequence"] = int(event["sequence"])
	stats["last_timestamp_unix_ms"] = int(event["timestamp_unix_ms"])
	var samples: Array = stats["duration_samples"]
	samples.append(duration_ms)
	if samples.size() > MAX_DURATION_SAMPLES_PER_TOOL:
		samples.pop_front()
	var field_counts: Dictionary = stats["argument_field_counts"]
	for field in event["recognized_argument_fields"]:
		field_counts[field] = int(field_counts.get(field, 0)) + 1


func _tool_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var included: Dictionary = {}
	for summary in _registry.list_summaries():
		var name: String = str(summary["name"])
		var stats: Dictionary = _empty_tool_stats(
			name,
			str(summary["risk"]),
			bool(summary["requires_apply"])
		)
		if _tool_stats.has(name):
			stats = _tool_stats[name].duplicate(true)
		rows.append(_public_tool_stats(stats))
		included[name] = true
	for name in _tool_stats:
		if not included.has(name):
			rows.append(_public_tool_stats(_tool_stats[name].duplicate(true)))
	rows.sort_custom(
		func(left: Dictionary, right: Dictionary) -> bool:
			return str(left["name"]) < str(right["name"])
	)
	return rows


func _public_tool_stats(stats: Dictionary) -> Dictionary:
	var samples: Array = stats.get("duration_samples", [])
	stats["p95_duration_ms"] = _percentile_95(samples)
	stats.erase("duration_samples")
	return stats


func _empty_tool_stats(
	name: String,
	risk: String,
	requires_apply: bool
) -> Dictionary:
	return {
		"name": name,
		"risk": risk,
		"requires_apply": requires_apply,
		"raw_calls": 0,
		"logical_calls": 0,
		"success_count": 0,
		"confirmation_count": 0,
		"invalid_count": 0,
		"failed_count": 0,
		"total_duration_ms": 0,
		"max_duration_ms": 0,
		"p95_duration_ms": 0,
		"last_sequence": 0,
		"last_timestamp_unix_ms": 0,
		"argument_field_counts": {},
		"duration_samples": [],
	}


func _recognized_argument_fields(
	definition: BridgeToolDefinition,
	arguments: Dictionary
) -> Array[String]:
	var fields: Array[String] = []
	if definition == null:
		return fields
	var properties: Dictionary = definition.input_schema.get("properties", {})
	for key in arguments:
		var field: String = str(key)
		if properties.has(field):
			fields.append(field)
	fields.sort()
	return fields


func _classify_outcome(outcome: Dictionary) -> Dictionary:
	if bool(outcome.get("ok", false)):
		return {"status": "success", "error_code": ""}
	var error: Dictionary = outcome.get("error", {})
	var code: String = str(error.get("code", "INTERNAL_ERROR"))
	if code == "APPLY_REQUIRED":
		return {"status": "confirmation_required", "error_code": code}
	if code == "INVALID_ARGUMENTS":
		return {"status": "invalid", "error_code": code}
	return {"status": "failed", "error_code": code}


func _status_count_key(status: String) -> String:
	match status:
		"success":
			return "success_count"
		"confirmation_required":
			return "confirmation_count"
		"invalid":
			return "invalid_count"
		_:
			return "failed_count"


func _percentile_95(samples: Array) -> int:
	if samples.is_empty():
		return 0
	var sorted_samples: Array = samples.duplicate()
	sorted_samples.sort()
	var index: int = clampi(
		int(ceil(float(sorted_samples.size()) * 0.95)) - 1,
		0,
		sorted_samples.size() - 1
	)
	return int(sorted_samples[index])


func _export_failure(message: String) -> Dictionary:
	return {
		"ok": false,
		"error": {
			"code": "USAGE_EXPORT_FAILED",
			"message": message,
		},
	}


func _unix_time_msec() -> int:
	return int(Time.get_unix_time_from_system() * 1000.0)
