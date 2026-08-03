class_name BridgeToolModule
extends RefCounted


var _context: BridgeToolContext


func _init(context: BridgeToolContext) -> void:
	_context = context


func definitions() -> Array[BridgeToolDefinition]:
	return []


func _definition(
	name: String,
	description: String,
	input_schema: Dictionary,
	output_schema: Dictionary,
	risk: String,
	requires_apply: bool,
	handler: Callable
) -> BridgeToolDefinition:
	var definition: BridgeToolDefinition = BridgeToolDefinition.new()
	definition.name = name
	definition.description = description
	definition.input_schema = input_schema
	definition.output_schema = output_schema
	definition.risk = risk
	definition.requires_apply = requires_apply
	definition.handler = handler
	return definition


func _empty_object_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {},
		"additionalProperties": false,
	}


func _success(data: Dictionary) -> Dictionary:
	return BridgeToolResults.success(data)


func _failure(
	code: String,
	message: String,
	retryable: bool = false
) -> Dictionary:
	return BridgeToolResults.failure(code, message, retryable)
