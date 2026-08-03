class_name BridgeSchemaValidator
extends RefCounted


const SUPPORTED_KEYWORDS: Array[String] = [
	"type",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"minItems",
	"maxItems",
	"enum",
	"minimum",
	"maximum",
	"default",
	"description",
]
const SUPPORTED_TYPES: Array[String] = [
	"object",
	"array",
	"string",
	"boolean",
	"integer",
	"number",
	"null",
]


func validate_schema(schema: Dictionary, path: String = "$") -> Dictionary:
	for key in schema:
		if str(key) not in SUPPORTED_KEYWORDS:
			return _failure(path, "unsupported schema keyword '%s'" % str(key))
	if not schema.has("type"):
		return _failure(path, "schema must declare a type")
	var declared_types: Variant = schema["type"]
	if typeof(declared_types) == TYPE_STRING:
		if str(declared_types) not in SUPPORTED_TYPES:
			return _failure(path, "unsupported schema type '%s'" % str(declared_types))
	elif declared_types is Array:
		if declared_types.is_empty():
			return _failure(path, "schema type array must not be empty")
		for declared_type in declared_types:
			if typeof(declared_type) != TYPE_STRING or str(declared_type) not in SUPPORTED_TYPES:
				return _failure(path, "unsupported schema type '%s'" % str(declared_type))
	else:
		return _failure(path, "schema type must be a string or array of strings")

	if schema.has("properties"):
		if not (schema["properties"] is Dictionary):
			return _failure(path, "properties must be an object")
		for property_name in schema["properties"]:
			var property_schema: Variant = schema["properties"][property_name]
			if not (property_schema is Dictionary):
				return _failure(path, "property schema must be an object")
			var property_result: Dictionary = validate_schema(
				property_schema,
				"%s.properties.%s" % [path, str(property_name)]
			)
			if not property_result["ok"]:
				return property_result
	if schema.has("items"):
		if not (schema["items"] is Dictionary):
			return _failure(path, "items must be an object")
		var items_result: Dictionary = validate_schema(
			schema["items"],
			path + ".items"
		)
		if not items_result["ok"]:
			return items_result
	for array_keyword in ["minItems", "maxItems"]:
		if (
			schema.has(array_keyword)
			and (
				typeof(schema[array_keyword]) != TYPE_INT
				or int(schema[array_keyword]) < 0
			)
		):
			return _failure(path, "%s must be a non-negative integer" % array_keyword)
	if (
		schema.has("minItems")
		and schema.has("maxItems")
		and int(schema["minItems"]) > int(schema["maxItems"])
	):
		return _failure(path, "minItems must not exceed maxItems")
	if schema.has("required") and not (schema["required"] is Array):
		return _failure(path, "required must be an array")
	if (
		schema.has("additionalProperties")
		and typeof(schema["additionalProperties"]) != TYPE_BOOL
	):
		return _failure(path, "additionalProperties must be a boolean")
	if schema.has("enum") and not (schema["enum"] is Array):
		return _failure(path, "enum must be an array")
	if schema.has("description") and typeof(schema["description"]) != TYPE_STRING:
		return _failure(path, "description must be a string")
	for numeric_keyword in ["minimum", "maximum"]:
		if (
			schema.has(numeric_keyword)
			and typeof(schema[numeric_keyword]) not in [TYPE_INT, TYPE_FLOAT]
		):
			return _failure(path, "%s must be numeric" % numeric_keyword)
	return {"ok": true}


func validate(value: Variant, schema: Dictionary, path: String = "$") -> Dictionary:
	var expected_type: Variant = schema.get("type", null)
	if expected_type != null and not _matches_type(value, expected_type):
		return _failure(
			path,
			"expected %s, received %s" % [_type_description(expected_type), type_string(typeof(value))]
		)

	if schema.has("enum"):
		var allowed: Array = schema["enum"]
		if not allowed.has(value):
			return _failure(path, "value is not in the allowed enum")

	match typeof(value):
		TYPE_DICTIONARY:
			return _validate_object(value, schema, path)
		TYPE_ARRAY:
			return _validate_array(value, schema, path)
		TYPE_INT, TYPE_FLOAT:
			return _validate_number(value, schema, path)
		_:
			return {"ok": true}

func _validate_object(value: Dictionary, schema: Dictionary, path: String) -> Dictionary:
	var properties: Dictionary = schema.get("properties", {})
	var required: Array = schema.get("required", [])
	for key in required:
		if not value.has(key):
			return _failure(path, "missing required property '%s'" % str(key))

	if schema.get("additionalProperties", true) == false:
		for key in value:
			if not properties.has(key):
				return _failure(path, "unexpected property '%s'" % str(key))

	for key in value:
		if not properties.has(key):
			continue
		var result: Dictionary = validate(value[key], properties[key], "%s.%s" % [path, str(key)])
		if not result["ok"]:
			return result
	return {"ok": true}

func _validate_array(value: Array, schema: Dictionary, path: String) -> Dictionary:
	if schema.has("minItems") and value.size() < int(schema["minItems"]):
		return _failure(path, "array contains fewer than minItems entries")
	if schema.has("maxItems") and value.size() > int(schema["maxItems"]):
		return _failure(path, "array contains more than maxItems entries")
	if schema.has("items"):
		for index in value.size():
			var result: Dictionary = validate(value[index], schema["items"], "%s[%d]" % [path, index])
			if not result["ok"]:
				return result
	return {"ok": true}

func _validate_number(value: Variant, schema: Dictionary, path: String) -> Dictionary:
	var numeric: float = value
	if not is_finite(numeric):
		return _failure(path, "number must be finite")
	if schema.has("minimum") and numeric < float(schema["minimum"]):
		return _failure(path, "number is below minimum")
	if schema.has("maximum") and numeric > float(schema["maximum"]):
		return _failure(path, "number is above maximum")
	return {"ok": true}

func _matches_type(value: Variant, expected: Variant) -> bool:
	if expected is Array:
		for candidate in expected:
			if _matches_type(value, candidate):
				return true
		return false
	match str(expected):
		"object":
			return value is Dictionary
		"array":
			return value is Array
		"string":
			return typeof(value) == TYPE_STRING
		"boolean":
			return typeof(value) == TYPE_BOOL
		"integer":
			if typeof(value) == TYPE_INT:
				return true
			return typeof(value) == TYPE_FLOAT and is_finite(value) and floor(value) == value
		"number":
			return (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and is_finite(value)
		"null":
			return value == null
		_:
			return false

func _type_description(expected: Variant) -> String:
	if expected is Array:
		var names: PackedStringArray = PackedStringArray()
		for item in expected:
			names.append(str(item))
		return "|".join(names)
	return str(expected)

func _failure(path: String, message: String) -> Dictionary:
	return {
		"ok": false,
		"path": path,
		"message": message,
	}
