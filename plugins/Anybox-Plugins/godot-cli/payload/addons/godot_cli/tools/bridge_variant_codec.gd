class_name BridgeVariantCodec
extends RefCounted


const TAGGED_TYPE_NAMES: Array[String] = [
	"Vector2",
	"Vector2i",
	"Vector3",
	"Vector3i",
	"Color",
	"Rect2",
	"Rect2i",
]


static func decode(value: Variant, target_type: int) -> Dictionary:
	match target_type:
		TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return _decode_scalar(value, target_type)
		TYPE_VECTOR2, TYPE_VECTOR2I, TYPE_VECTOR3, TYPE_VECTOR3I, TYPE_COLOR, TYPE_RECT2, TYPE_RECT2I:
			return _decode_tagged(value, target_type)
		_:
			return BridgeToolResults.failure(
				"PROPERTY_TYPE_UNSUPPORTED",
				"Property type is not supported for writes"
			)


static func encode(value: Variant, target_type: int) -> Dictionary:
	if typeof(value) != target_type:
		return BridgeToolResults.failure(
			"PROPERTY_TYPE_UNSUPPORTED",
			"Property value does not match its declared type"
		)
	match target_type:
		TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return _decode_scalar(value, target_type)
		TYPE_VECTOR2:
			return _encoded_tagged("Vector2", [value.x, value.y], false)
		TYPE_VECTOR2I:
			return _encoded_tagged("Vector2i", [value.x, value.y], true)
		TYPE_VECTOR3:
			return _encoded_tagged("Vector3", [value.x, value.y, value.z], false)
		TYPE_VECTOR3I:
			return _encoded_tagged("Vector3i", [value.x, value.y, value.z], true)
		TYPE_COLOR:
			return _encoded_tagged("Color", [value.r, value.g, value.b, value.a], false)
		TYPE_RECT2:
			return _encoded_tagged(
				"Rect2",
				[value.position.x, value.position.y, value.size.x, value.size.y],
				false
			)
		TYPE_RECT2I:
			return _encoded_tagged(
				"Rect2i",
				[value.position.x, value.position.y, value.size.x, value.size.y],
				true
			)
		_:
			return BridgeToolResults.failure(
				"PROPERTY_TYPE_UNSUPPORTED",
				"Property type is not supported for safe JSON encoding"
			)


static func is_supported_type(type_id: int) -> bool:
	return type_id in [
		TYPE_BOOL,
		TYPE_INT,
		TYPE_FLOAT,
		TYPE_STRING,
		TYPE_VECTOR2,
		TYPE_VECTOR2I,
		TYPE_VECTOR3,
		TYPE_VECTOR3I,
		TYPE_COLOR,
		TYPE_RECT2,
		TYPE_RECT2I,
	]


static func matches_type(value: Variant, expected_type: int) -> bool:
	return typeof(value) == expected_type


static func encoded_value_schema(description: String = "") -> Dictionary:
	var schema: Dictionary = {
		"type": ["boolean", "integer", "number", "string", "object"],
		"properties": {
			"type": {
				"type": "string",
				"enum": TAGGED_TYPE_NAMES,
			},
			"value": {
				"type": "array",
				"items": {"type": ["integer", "number"]},
			},
		},
		"required": ["type", "value"],
		"additionalProperties": false,
	}
	if not description.is_empty():
		schema["description"] = description
	return schema


static func _decode_scalar(value: Variant, target_type: int) -> Dictionary:
	match target_type:
		TYPE_BOOL:
			if typeof(value) != TYPE_BOOL:
				return BridgeToolResults.failure(
					"INVALID_ARGUMENTS",
					"Boolean property requires a JSON boolean"
				)
			return {"ok": true, "value": value}
		TYPE_INT:
			var integer: Dictionary = _integer_component(value, "Integer property")
			if not integer["ok"]:
				return integer
			return {"ok": true, "value": integer["value"]}
		TYPE_FLOAT:
			var numeric: Dictionary = _float_component(value, "Float property")
			if not numeric["ok"]:
				return numeric
			return {"ok": true, "value": numeric["value"]}
		TYPE_STRING:
			if typeof(value) != TYPE_STRING:
				return BridgeToolResults.failure(
					"INVALID_ARGUMENTS",
					"String property requires a JSON string"
				)
			return {"ok": true, "value": value}
		_:
			return BridgeToolResults.failure(
				"PROPERTY_TYPE_UNSUPPORTED",
				"Property type is not a supported scalar"
			)


static func _decode_tagged(value: Variant, target_type: int) -> Dictionary:
	var type_name: String = type_string(target_type)
	if not (value is Dictionary):
		return BridgeToolResults.failure(
			"INVALID_ARGUMENTS",
			"%s property requires a tagged JSON object" % type_name
		)
	if str(value.get("type", "")) != type_name:
		return BridgeToolResults.failure(
			"INVALID_ARGUMENTS",
			"Tagged value type must exactly match %s" % type_name
		)
	var raw_components: Variant = value.get("value", null)
	if not (raw_components is Array):
		return BridgeToolResults.failure(
			"INVALID_ARGUMENTS",
			"Tagged %s value must contain a numeric array" % type_name
		)
	var expected_size: int = 4 if target_type in [TYPE_COLOR, TYPE_RECT2, TYPE_RECT2I] else 3
	if target_type in [TYPE_VECTOR2, TYPE_VECTOR2I]:
		expected_size = 2
	if raw_components.size() != expected_size:
		return BridgeToolResults.failure(
			"INVALID_ARGUMENTS",
			"Tagged %s value requires exactly %d components" % [type_name, expected_size]
		)

	var integer_components: bool = target_type in [
		TYPE_VECTOR2I,
		TYPE_VECTOR3I,
		TYPE_RECT2I,
	]
	var components: Array = []
	for index in raw_components.size():
		var label: String = "%s component %d" % [type_name, index]
		var converted: Dictionary = (
			_integer_component(raw_components[index], label)
			if integer_components
			else _float_component(raw_components[index], label)
		)
		if not converted["ok"]:
			return converted
		components.append(converted["value"])

	match target_type:
		TYPE_VECTOR2:
			return {"ok": true, "value": Vector2(components[0], components[1])}
		TYPE_VECTOR2I:
			return {"ok": true, "value": Vector2i(components[0], components[1])}
		TYPE_VECTOR3:
			return {
				"ok": true,
				"value": Vector3(components[0], components[1], components[2]),
			}
		TYPE_VECTOR3I:
			return {
				"ok": true,
				"value": Vector3i(components[0], components[1], components[2]),
			}
		TYPE_COLOR:
			return {
				"ok": true,
				"value": Color(components[0], components[1], components[2], components[3]),
			}
		TYPE_RECT2:
			return {
				"ok": true,
				"value": Rect2(components[0], components[1], components[2], components[3]),
			}
		TYPE_RECT2I:
			return {
				"ok": true,
				"value": Rect2i(components[0], components[1], components[2], components[3]),
			}
		_:
			return BridgeToolResults.failure(
				"PROPERTY_TYPE_UNSUPPORTED",
				"Tagged property type is not supported"
			)


static func _encoded_tagged(
	type_name: String,
	components: Array,
	integer_components: bool
) -> Dictionary:
	var encoded_components: Array = []
	for index in components.size():
		var label: String = "%s component %d" % [type_name, index]
		var converted: Dictionary = (
			_integer_component(components[index], label)
			if integer_components
			else _float_component(components[index], label)
		)
		if not converted["ok"]:
			return converted
		encoded_components.append(converted["value"])
	return {
		"ok": true,
		"value": {
			"type": type_name,
			"value": encoded_components,
		},
	}


static func _integer_component(value: Variant, label: String) -> Dictionary:
	if not _is_integral_number(value):
		return BridgeToolResults.failure(
			"INVALID_ARGUMENTS",
			label + " requires a JSON integer"
		)
	var integer_value: int = int(value)
	if (
		integer_value < -BridgeConstants.MAX_SAFE_INTEGER
		or integer_value > BridgeConstants.MAX_SAFE_INTEGER
	):
		return BridgeToolResults.failure(
			"INVALID_ARGUMENTS",
			label + " exceeds the interoperable ±(2^53-1) range"
		)
	return {"ok": true, "value": integer_value}


static func _float_component(value: Variant, label: String) -> Dictionary:
	if typeof(value) != TYPE_INT and typeof(value) != TYPE_FLOAT:
		return BridgeToolResults.failure(
			"INVALID_ARGUMENTS",
			label + " requires a JSON number"
		)
	var numeric: float = value as float
	if not is_finite(numeric):
		return BridgeToolResults.failure(
			"INVALID_ARGUMENTS",
			label + " must be finite"
		)
	return {"ok": true, "value": numeric}


static func _is_integral_number(value: Variant) -> bool:
	if typeof(value) == TYPE_INT:
		return true
	if typeof(value) != TYPE_FLOAT:
		return false
	var numeric: float = value as float
	return is_finite(numeric) and floor(numeric) == numeric
