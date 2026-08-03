class_name BridgeToolRegistry
extends RefCounted

var _tools: Dictionary = {}
var _schema_validator: BridgeSchemaValidator = BridgeSchemaValidator.new()

func register_tool(definition: BridgeToolDefinition) -> Error:
	if definition == null or not definition.is_valid():
		return ERR_INVALID_PARAMETER
	if not _schema_validator.validate_schema(definition.input_schema)["ok"]:
		return ERR_INVALID_DATA
	if not _schema_validator.validate_schema(definition.output_schema)["ok"]:
		return ERR_INVALID_DATA
	if _tools.has(definition.name):
		return ERR_ALREADY_EXISTS
	_tools[definition.name] = definition
	return OK

func get_tool(name: String) -> BridgeToolDefinition:
	return _tools.get(name, null)

func list_summaries() -> Array[Dictionary]:
	var names: Array = _tools.keys()
	names.sort()
	var result: Array[Dictionary] = []
	for name in names:
		var definition: BridgeToolDefinition = _tools[name]
		result.append(definition.to_summary())
	return result

func search(query: String, limit: int = 5) -> Array[Dictionary]:
	var bounded_limit: int = clampi(limit, 1, 20)
	var normalized_query: String = _normalize(query)
	var query_tokens: PackedStringArray = normalized_query.split(" ", false)
	var scored: Array[Dictionary] = []
	for name in _tools:
		var definition: BridgeToolDefinition = _tools[name]
		var score: int = _score(definition, normalized_query, query_tokens)
		if score <= 0:
			continue
		var summary: Dictionary = definition.to_summary()
		summary["score"] = score
		scored.append(summary)
	scored.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		if int(left["score"]) == int(right["score"]):
			return str(left["name"]) < str(right["name"])
		return int(left["score"]) > int(right["score"])
	)
	return scored.slice(0, mini(scored.size(), bounded_limit))

func size() -> int:
	return _tools.size()

func _score(
	definition: BridgeToolDefinition,
	normalized_query: String,
	query_tokens: PackedStringArray
) -> int:
	if normalized_query.is_empty():
		return 1
	var normalized_name: String = _normalize(definition.name)
	var haystack: String = normalized_name + " " + _normalize(definition.description)
	if normalized_name == normalized_query:
		return 500
	if normalized_name.begins_with(normalized_query):
		return 400
	var all_tokens: bool = not query_tokens.is_empty()
	for token in query_tokens:
		if not haystack.contains(token):
			all_tokens = false
			break
	if all_tokens:
		return 200
	for token in query_tokens:
		if haystack.contains(token):
			return 100
	return 0

func _normalize(value: String) -> String:
	return " ".join(
		value.to_lower().replace("_", " ").replace("-", " ").strip_edges().split(" ", false)
	)
