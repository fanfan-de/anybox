class_name BridgeToolExecutor
extends RefCounted

var _registry: BridgeToolRegistry
var _validator: BridgeSchemaValidator = BridgeSchemaValidator.new()

func _init(registry: BridgeToolRegistry) -> void:
	_registry = registry

func execute(name: String, arguments: Dictionary, apply: bool) -> Dictionary:
	var started_at: int = Time.get_ticks_msec()
	var definition: BridgeToolDefinition = _registry.get_tool(name)
	if definition == null:
		return _failure("TOOL_NOT_FOUND", "Tool not found: " + name, false, started_at)
	if arguments.has("apply"):
		return _failure(
			"INVALID_ARGUMENTS",
			"'apply' is transport metadata and is not allowed in tool arguments",
			false,
			started_at
		)
	var input_validation: Dictionary = _validator.validate(arguments, definition.input_schema)
	if not input_validation["ok"]:
		return _failure(
			"INVALID_ARGUMENTS",
			"%s at %s" % [input_validation["message"], input_validation["path"]],
			false,
			started_at
		)
	if definition.requires_apply and not apply:
		return _failure(
			"APPLY_REQUIRED",
			"This operation requires explicit apply confirmation",
			false,
			started_at
		)

	var handler_result: Variant = definition.handler.call(arguments)
	if not (handler_result is Dictionary):
		return _failure("INTERNAL_ERROR", "Tool handler returned an invalid result", false, started_at)
	if not bool(handler_result.get("ok", false)):
		var error: Dictionary = handler_result.get("error", {})
		return _failure(
			str(error.get("code", "INTERNAL_ERROR")),
			str(error.get("message", "Tool execution failed")),
			bool(error.get("retryable", false)),
			started_at
		)

	var data: Variant = handler_result.get("data", {})
	var output_validation: Dictionary = _validator.validate(data, definition.output_schema)
	if not output_validation["ok"]:
		return _failure(
			"INTERNAL_ERROR",
			"Tool output failed validation: %s at %s"
			% [output_validation["message"], output_validation["path"]],
			false,
			started_at
		)
	return {
		"ok": true,
		"data": data,
		"duration_ms": Time.get_ticks_msec() - started_at,
	}

func _failure(
	code: String,
	message: String,
	retryable: bool,
	started_at: int
) -> Dictionary:
	return {
		"ok": false,
		"error": {
			"code": code,
			"message": message,
			"retryable": retryable,
		},
		"duration_ms": Time.get_ticks_msec() - started_at,
	}

