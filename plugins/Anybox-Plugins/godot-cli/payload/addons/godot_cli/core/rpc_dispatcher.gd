class_name BridgeRpcDispatcher
extends RefCounted


var _registry: BridgeToolRegistry
var _executor: BridgeToolExecutor
var _usage_tracker: BridgeToolUsageTracker
var _token: String = ""


func _init(
	registry: BridgeToolRegistry,
	executor: BridgeToolExecutor,
	usage_tracker: BridgeToolUsageTracker = null
) -> void:
	_registry = registry
	_executor = executor
	_usage_tracker = usage_tracker


func set_token(token: String) -> void:
	_token = token


func clear_token() -> void:
	_token = ""


func dispatch(request: Variant, client: BridgeClientConnection) -> Dictionary:
	if not (request is Dictionary):
		return {
			"response": error_response(
				null,
				BridgeConstants.RPC_INVALID_REQUEST,
				"INVALID_REQUEST",
				"Only a single JSON-RPC request object is accepted"
			),
		}
	var object: Dictionary = request
	var request_id: Variant = object.get("id", null)
	if (
		str(object.get("jsonrpc", "")) != "2.0"
		or not object.has("id")
		or not object.has("method")
		or typeof(object["method"]) != TYPE_STRING
	):
		return {
			"response": error_response(
				request_id,
				BridgeConstants.RPC_INVALID_REQUEST,
				"INVALID_REQUEST",
				"Request must contain jsonrpc, id, and method"
			),
		}
	if not _valid_id(request_id):
		return {
			"response": error_response(
				null,
				BridgeConstants.RPC_INVALID_REQUEST,
				"INVALID_REQUEST",
				"Request id must be an integer or string"
			),
		}
	var params: Variant = object.get("params", {})
	if not (params is Dictionary):
		return {
			"response": error_response(
				request_id,
				BridgeConstants.RPC_INVALID_PARAMS,
				"INVALID_ARGUMENTS",
				"Request params must be an object"
			),
		}

	var method: String = object["method"]
	if not client.initialized:
		if method != "session.initialize":
			return {
				"response": error_response(
					request_id,
					BridgeConstants.RPC_INITIALIZE_REQUIRED,
					"INITIALIZE_REQUIRED",
					"The first request on a connection must be session.initialize"
				),
			}
		return _initialize(request_id, params, client)
	if method == "session.initialize":
		return {
			"response": error_response(
				request_id,
				BridgeConstants.RPC_INVALID_REQUEST,
				"INVALID_REQUEST",
				"The connection is already initialized"
			),
		}

	match method:
		"system.ping":
			if not params.is_empty():
				return _invalid_params(request_id, "system.ping does not accept parameters")
			return {
				"response": success_response(
					request_id,
					{
						"ok": true,
						"unix_ms": int(Time.get_unix_time_from_system() * 1000.0),
					}
				),
			}
		"tools.list":
			if not params.is_empty():
				return _invalid_params(request_id, "tools.list does not accept parameters")
			return {
				"response": success_response(
					request_id,
					{"tools": _registry.list_summaries()}
				),
			}
		"tools.search":
			return _search_tools(request_id, params)
		"tools.schema":
			return _tool_schema(request_id, params)
		"tools.execute":
			return _execute_tool(request_id, params)
		_:
			return {
				"response": error_response(
					request_id,
					BridgeConstants.RPC_METHOD_NOT_FOUND,
					"METHOD_NOT_FOUND",
					"Method not found: " + method
				),
			}


func _initialize(
	request_id: Variant,
	params: Dictionary,
	client: BridgeClientConnection
) -> Dictionary:
	if (
		not params.has("protocol_version")
		or not _is_json_integer(params["protocol_version"])
		or not params.has("token")
		or typeof(params["token"]) != TYPE_STRING
	):
		return _invalid_params(
			request_id,
			"session.initialize requires integer protocol_version and string token",
			true
		)
	if int(params["protocol_version"]) != BridgeConstants.PROTOCOL_VERSION:
		return {
			"response": error_response(
				request_id,
				BridgeConstants.RPC_PROTOCOL_MISMATCH,
				"PROTOCOL_VERSION_MISMATCH",
				"Client and server protocol versions do not match",
				false,
				{
					"server_protocol_version": BridgeConstants.PROTOCOL_VERSION,
				}
			),
			"close": true,
		}
	if not _tokens_equal(str(params["token"]), _token):
		return {
			"response": error_response(
				request_id,
				BridgeConstants.RPC_AUTH_FAILED,
				"AUTH_FAILED",
				"Session authentication failed"
			),
			"close": true,
		}
	client.initialized = true
	client.last_activity_msec = Time.get_ticks_msec()
	var version: Dictionary = Engine.get_version_info()
	var project_path: String = ProjectSettings.globalize_path("res://").replace("\\", "/")
	project_path = project_path.trim_suffix("/")
	var project_name: String = str(
		ProjectSettings.get_setting("application/config/name", "")
	)
	if project_name.is_empty():
		project_name = project_path.get_file()
	return {
		"response": success_response(
			request_id,
			{
				"server": {
					"name": "godot_cli",
					"version": BridgeConstants.PLUGIN_VERSION,
				},
				"godot": {
					"major": int(version.get("major", 0)),
					"minor": int(version.get("minor", 0)),
					"patch": int(version.get("patch", 0)),
					"status": str(version.get("status", "")),
					"string": str(version.get("string", "")),
				},
				"project": {
					"name": project_name,
					"path": project_path,
				},
				"protocol_version": BridgeConstants.PROTOCOL_VERSION,
				"limits": {
					"max_clients": BridgeConstants.MAX_CLIENTS,
					"max_payload_bytes": BridgeConstants.MAX_FRAME_BYTES,
					"initialize_timeout_ms": BridgeConstants.INITIALIZE_TIMEOUT_MSEC,
					"idle_timeout_ms": BridgeConstants.IDLE_TIMEOUT_MSEC,
					"max_send_queue_bytes": BridgeConstants.MAX_SEND_QUEUE_BYTES,
					"tool_requests_per_frame": 1,
				},
			}
		),
	}


func _search_tools(request_id: Variant, params: Dictionary) -> Dictionary:
	if (
		not params.has("query")
		or typeof(params["query"]) != TYPE_STRING
		or (params.has("limit") and not _is_json_integer(params["limit"]))
	):
		return _invalid_params(request_id, "tools.search requires query and optional integer limit")
	for key in params:
		if key not in ["query", "limit"]:
			return _invalid_params(request_id, "Unexpected tools.search parameter: " + str(key))
	var limit: int = int(params.get("limit", 5))
	if limit < 1 or limit > 20:
		return _invalid_params(request_id, "tools.search limit must be between 1 and 20")
	return {
		"response": success_response(
			request_id,
			{"tools": _registry.search(str(params["query"]), limit)}
		),
	}


func _tool_schema(request_id: Variant, params: Dictionary) -> Dictionary:
	if params.size() != 1 or typeof(params.get("name", null)) != TYPE_STRING:
		return _invalid_params(request_id, "tools.schema requires exactly one string name")
	var name: String = str(params["name"])
	var definition: BridgeToolDefinition = _registry.get_tool(name)
	if definition == null:
		return {
			"response": error_response(
				request_id,
				BridgeConstants.RPC_TOOL_ERROR,
				"TOOL_NOT_FOUND",
				"Tool not found: " + name
			),
		}
	return {
		"response": success_response(request_id, definition.to_schema()),
	}


func _execute_tool(request_id: Variant, params: Dictionary) -> Dictionary:
	if (
		params.size() != 3
		or typeof(params.get("name", null)) != TYPE_STRING
		or not (params.get("arguments", null) is Dictionary)
		or typeof(params.get("apply", null)) != TYPE_BOOL
	):
		return _invalid_params(
			request_id,
			"tools.execute requires exactly name, arguments, and apply"
		)
	var name: String = str(params["name"])
	var arguments: Dictionary = params["arguments"]
	var apply: bool = bool(params["apply"])
	var outcome: Dictionary = _executor.execute(name, arguments, apply)
	if _usage_tracker != null:
		_usage_tracker.record_tool_call(name, arguments, apply, outcome)
	if bool(outcome.get("ok", false)):
		return {
			"response": success_response(request_id, outcome),
		}
	var tool_error: Dictionary = outcome.get("error", {})
	var stable_code: String = str(tool_error.get("code", "INTERNAL_ERROR"))
	var rpc_code: int = BridgeConstants.RPC_TOOL_ERROR
	if stable_code == "APPLY_REQUIRED":
		rpc_code = BridgeConstants.RPC_APPLY_REQUIRED
	elif stable_code == "INVALID_ARGUMENTS":
		rpc_code = BridgeConstants.RPC_INVALID_PARAMS
	elif stable_code == "INTERNAL_ERROR":
		rpc_code = BridgeConstants.RPC_INTERNAL_ERROR
	return {
		"response": error_response(
			request_id,
			rpc_code,
			stable_code,
			str(tool_error.get("message", "Tool execution failed")),
			bool(tool_error.get("retryable", false))
		),
	}


func _invalid_params(
	request_id: Variant,
	message: String,
	close_connection: bool = false
) -> Dictionary:
	return {
		"response": error_response(
			request_id,
			BridgeConstants.RPC_INVALID_PARAMS,
			"INVALID_ARGUMENTS",
			message
		),
		"close": close_connection,
	}


func _tokens_equal(left: String, right: String) -> bool:
	var left_bytes: PackedByteArray = left.to_utf8_buffer()
	var right_bytes: PackedByteArray = right.to_utf8_buffer()
	if left_bytes.size() != right_bytes.size() or left_bytes.is_empty():
		return false
	return Crypto.new().constant_time_compare(left_bytes, right_bytes)


func _valid_id(value: Variant) -> bool:
	return typeof(value) == TYPE_STRING or _is_json_integer(value)


func _is_json_integer(value: Variant) -> bool:
	if typeof(value) == TYPE_INT:
		return true
	if typeof(value) != TYPE_FLOAT:
		return false
	var numeric: float = value as float
	return is_finite(numeric) and floor(numeric) == numeric


static func success_response(request_id: Variant, result: Variant) -> Dictionary:
	return {
		"jsonrpc": "2.0",
		"id": request_id,
		"result": result,
	}


static func error_response(
	request_id: Variant,
	rpc_code: int,
	stable_code: String,
	message: String,
	retryable: bool = false,
	details: Dictionary = {}
) -> Dictionary:
	var data: Dictionary = {
		"code": stable_code,
		"retryable": retryable,
	}
	if not details.is_empty():
		data["details"] = details
	return {
		"jsonrpc": "2.0",
		"id": request_id,
		"error": {
			"code": rpc_code,
			"message": message,
			"data": data,
		},
	}
