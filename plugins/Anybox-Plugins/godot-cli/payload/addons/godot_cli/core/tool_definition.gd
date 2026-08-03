class_name BridgeToolDefinition
extends RefCounted

var name: String = ""
var description: String = ""
var input_schema: Dictionary = {}
var output_schema: Dictionary = {}
var risk: String = "read"
var requires_apply: bool = false
var handler: Callable = Callable()

func is_valid() -> bool:
	return (
		not name.is_empty()
		and not description.is_empty()
		and input_schema is Dictionary
		and output_schema is Dictionary
		and handler.is_valid()
		and risk in ["read", "write"]
	)

func to_summary() -> Dictionary:
	return {
		"name": name,
		"description": description,
		"risk": risk,
		"requires_apply": requires_apply,
	}

func to_schema() -> Dictionary:
	return {
		"name": name,
		"description": description,
		"input_schema": input_schema,
		"output_schema": output_schema,
		"risk": risk,
		"requires_apply": requires_apply,
	}

