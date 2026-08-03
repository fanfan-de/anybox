class_name BridgeSessionStore
extends RefCounted


var descriptor: Dictionary = {}
var session_file_path: String = ""


func create(port: int) -> Dictionary:
	var token_bytes: PackedByteArray = Crypto.new().generate_random_bytes(32)
	var instance_bytes: PackedByteArray = Crypto.new().generate_random_bytes(16)
	if token_bytes.size() != 32 or instance_bytes.size() != 16:
		return _failure("INTERNAL_ERROR", "Could not generate secure session identifiers")

	var project_path: String = ProjectSettings.globalize_path("res://").replace("\\", "/")
	project_path = project_path.trim_suffix("/")
	var project_name: String = str(
		ProjectSettings.get_setting("application/config/name", "")
	)
	if project_name.is_empty():
		project_name = project_path.get_file()
	descriptor = {
		"schema_version": BridgeConstants.SESSION_SCHEMA_VERSION,
		"protocol_version": BridgeConstants.PROTOCOL_VERSION,
		"plugin_version": BridgeConstants.PLUGIN_VERSION,
		"instance_id": instance_bytes.hex_encode(),
		"pid": OS.get_process_id(),
		"project_name": project_name,
		"project_path": project_path,
		"host": BridgeConstants.LOOPBACK_HOST,
		"port": port,
		"token": token_bytes.hex_encode(),
		"started_at_unix_ms": int(Time.get_unix_time_from_system() * 1000.0),
	}

	var directory_path: String = _sessions_directory()
	var make_error: Error = DirAccess.make_dir_recursive_absolute(directory_path)
	if make_error != OK and not DirAccess.dir_exists_absolute(directory_path):
		return _failure("INTERNAL_ERROR", "Could not create the session directory")

	session_file_path = directory_path.path_join(
		"%d-%s.json" % [int(descriptor["pid"]), str(descriptor["instance_id"])]
	)
	var temporary_path: String = session_file_path + ".tmp-" + _random_suffix()
	var file: FileAccess = FileAccess.open(temporary_path, FileAccess.WRITE)
	if file == null:
		return _failure("INTERNAL_ERROR", "Could not create the session file")
	file.store_string(JSON.stringify(descriptor))
	file.flush()
	file.close()

	var rename_error: Error = DirAccess.rename_absolute(temporary_path, session_file_path)
	if rename_error != OK:
		DirAccess.remove_absolute(temporary_path)
		return _failure("INTERNAL_ERROR", "Could not publish the session file atomically")
	return {
		"ok": true,
		"descriptor": descriptor,
		"path": session_file_path,
	}


func remove_own_file() -> void:
	if session_file_path.is_empty():
		return
	if FileAccess.file_exists(session_file_path):
		DirAccess.remove_absolute(session_file_path)
	session_file_path = ""
	descriptor = {}


func token() -> String:
	return str(descriptor.get("token", ""))


func public_descriptor() -> Dictionary:
	var result: Dictionary = descriptor.duplicate(true)
	result.erase("token")
	return result


func _sessions_directory() -> String:
	var local_app_data: String = OS.get_environment("LOCALAPPDATA")
	if local_app_data.is_empty():
		local_app_data = OS.get_user_data_dir()
	return local_app_data.path_join("GodotCli").path_join("sessions")


func _random_suffix() -> String:
	var bytes: PackedByteArray = Crypto.new().generate_random_bytes(8)
	if bytes.size() == 8:
		return bytes.hex_encode()
	return str(Time.get_ticks_usec())


func _failure(code: String, message: String) -> Dictionary:
	return {
		"ok": false,
		"error": {
			"code": code,
			"message": message,
			"retryable": false,
		},
	}
