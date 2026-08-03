class_name BridgeClassTools
extends BridgeToolModule


const API_TYPES: Array[String] = [
	"core",
	"editor",
	"extension",
	"editor_extension",
	"none",
]
const RUNTIME_API_TYPES: Array[String] = [
	"core",
	"extension",
]
const MEMBER_SECTIONS: Array[String] = [
	"properties",
	"methods",
	"signals",
	"enums",
]


func definitions() -> Array[BridgeToolDefinition]:
	return [
		_definition(
			"search_node_types",
			"Search instantiable runtime Node classes with bounded pagination.",
			{
				"type": "object",
				"properties": {
					"query": {
						"type": "string",
						"default": "",
						"description": "Optional case-insensitive class name substring.",
					},
					"base_type": {
						"type": "string",
						"default": "Node",
						"description": "Runtime ClassDB Node class used to restrict results.",
					},
					"limit": {
						"type": "integer",
						"minimum": 1,
						"maximum": BridgeConstants.MAX_CLASS_QUERY_LIMIT,
						"default": BridgeConstants.DEFAULT_CLASS_QUERY_LIMIT,
						"description": "Maximum number of matching classes returned.",
					},
					"cursor": {
						"type": "integer",
						"minimum": 0,
						"maximum": BridgeConstants.MAX_CLASS_QUERY_CURSOR,
						"default": 0,
						"description": "Zero-based offset in the matching class sequence.",
					},
				},
				"additionalProperties": false,
			},
			_node_type_search_schema(),
			"read",
			false,
			_search_node_types
		),
		_definition(
			"get_class_api",
			"Read one filtered, paginated section of an engine class API.",
			{
				"type": "object",
				"properties": {
					"class_name": {
						"type": "string",
						"description": "Exact ClassDB engine or GDExtension class name.",
					},
					"section": {
						"type": "string",
						"enum": MEMBER_SECTIONS,
						"default": "properties",
						"description": "API member section to return.",
					},
					"member_filter": {
						"type": ["string", "null"],
						"default": null,
						"description": "Optional case-insensitive member name substring.",
					},
					"include_inherited": {
						"type": "boolean",
						"default": true,
						"description": "Include effective members declared by ancestor classes.",
					},
					"limit": {
						"type": "integer",
						"minimum": 1,
						"maximum": BridgeConstants.MAX_CLASS_QUERY_LIMIT,
						"default": BridgeConstants.DEFAULT_CLASS_QUERY_LIMIT,
						"description": "Maximum number of matching members returned.",
					},
					"cursor": {
						"type": "integer",
						"minimum": 0,
						"maximum": BridgeConstants.MAX_CLASS_QUERY_CURSOR,
						"default": 0,
						"description": "Zero-based offset in the matching member sequence.",
					},
				},
				"required": ["class_name"],
				"additionalProperties": false,
			},
			_class_api_schema(),
			"read",
			false,
			_get_class_api
		),
	]


func _search_node_types(arguments: Dictionary) -> Dictionary:
	var query: String = str(arguments.get("query", "")).strip_edges()
	if query.length() > BridgeConstants.MAX_CLASS_QUERY_STRING_LENGTH:
		return _failure(
			"INVALID_ARGUMENTS",
			"Node type query must not exceed 128 characters"
		)

	var base_type: String = str(arguments.get("base_type", "Node")).strip_edges()
	if (
		not BridgeRuntimeNodeTypeGuard.is_runtime_node_class(base_type)
	):
		return _failure(
			"INVALID_ARGUMENTS",
			"Base type must be a runtime ClassDB Node class"
		)

	var matches: Array = []
	for raw_class_name in ClassDB.get_class_list():
		var type_name: String = str(raw_class_name)
		var api_type: int = ClassDB.class_get_api_type(type_name)
		if (
			not BridgeRuntimeNodeTypeGuard.is_instantiable_runtime_node_type(
				type_name
			)
			or not _is_class_or_subclass(type_name, base_type)
			or not _matches_filter(type_name, query)
		):
			continue
		matches.append(
			{
				"name": type_name,
				"parent_type": str(ClassDB.get_parent_class(type_name)),
				"api_type": _api_type_name(api_type),
				"instantiable": true,
				"inheritance_depth": _inheritance_depth(type_name, base_type),
			}
		)
	matches.sort_custom(
		func(left: Dictionary, right: Dictionary) -> bool:
			var left_rank: int = _search_rank(str(left["name"]), query)
			var right_rank: int = _search_rank(str(right["name"]), query)
			if left_rank != right_rank:
				return left_rank < right_rank
			return _case_insensitive_less(str(left["name"]), str(right["name"]))
	)

	var limit: int = int(
		arguments.get("limit", BridgeConstants.DEFAULT_CLASS_QUERY_LIMIT)
	)
	var cursor: int = int(arguments.get("cursor", 0))
	var page: Dictionary = _paginate(matches, cursor, limit)
	if bool(page["oversized"]):
		return _failure(
			"RESULT_TOO_LARGE",
			"A single node type record exceeds the result byte budget"
		)
	return _success(
		{
			"query": query,
			"base_type": base_type,
			"types": page["items"],
			"count": (page["items"] as Array).size(),
			"total_matches": matches.size(),
			"cursor": cursor,
			"limit": limit,
			"truncated": bool(page["has_more"]),
			"size_truncated": bool(page["size_truncated"]),
			"next_cursor": _next_cursor(page, cursor),
		}
	)


func _get_class_api(arguments: Dictionary) -> Dictionary:
	var requested_type: String = str(arguments.get("class_name", "")).strip_edges()
	if (
		requested_type.is_empty()
		or requested_type.length() > BridgeConstants.MAX_CLASS_QUERY_STRING_LENGTH
	):
		return _failure(
			"INVALID_ARGUMENTS",
			"Class name must contain between 1 and 128 characters"
		)
	if not ClassDB.class_exists(requested_type):
		return _failure(
			"CLASS_NOT_FOUND",
			"Class name must identify a ClassDB engine or GDExtension class"
		)

	var raw_filter: Variant = arguments.get("member_filter", null)
	var member_filter: Variant = null
	if raw_filter != null:
		var normalized_filter: String = str(raw_filter).strip_edges()
		if normalized_filter.length() > BridgeConstants.MAX_CLASS_QUERY_STRING_LENGTH:
			return _failure(
				"INVALID_ARGUMENTS",
				"Member filter must not exceed 128 characters"
			)
		if not normalized_filter.is_empty():
			member_filter = normalized_filter

	var section: String = str(arguments.get("section", "properties"))
	var include_inherited: bool = bool(arguments.get("include_inherited", true))
	var inheritance: Array[String] = _inheritance_chain(requested_type)
	var members: Array = _collect_members(
		requested_type,
		inheritance,
		section,
		member_filter,
		include_inherited
	)
	var limit: int = int(
		arguments.get("limit", BridgeConstants.DEFAULT_CLASS_QUERY_LIMIT)
	)
	var cursor: int = int(arguments.get("cursor", 0))
	var page: Dictionary = _paginate(members, cursor, limit)
	if bool(page["oversized"]):
		return _failure(
			"RESULT_TOO_LARGE",
			"A single class API member exceeds the result byte budget"
		)

	return _success(
		{
			"class_name": requested_type,
			"parent_class": str(ClassDB.get_parent_class(requested_type)),
			"inheritance": inheritance,
			"enabled": ClassDB.is_class_enabled(requested_type),
			"instantiable": ClassDB.can_instantiate(requested_type),
			"api_type": _api_type_name(ClassDB.class_get_api_type(requested_type)),
			"section": section,
			"member_filter": member_filter,
			"include_inherited": include_inherited,
			"members": page["items"],
			"count": (page["items"] as Array).size(),
			"total_matches": members.size(),
			"cursor": cursor,
			"limit": limit,
			"truncated": bool(page["has_more"]),
			"size_truncated": bool(page["size_truncated"]),
			"next_cursor": _next_cursor(page, cursor),
		}
	)


func _collect_members(
	requested_type: String,
	inheritance: Array[String],
	section: String,
	member_filter: Variant,
	include_inherited: bool
) -> Array:
	var classes: Array[String] = inheritance
	if not include_inherited:
		classes = [requested_type]

	var members: Array = []
	var seen_names: Dictionary = {}
	for declared_on in classes:
		match section:
			"properties":
				for raw_property in ClassDB.class_get_property_list(declared_on, true):
					var property_info: Dictionary = raw_property
					var property_name: String = str(property_info.get("name", ""))
					if (
						property_name.is_empty()
						or int(property_info.get("type", TYPE_NIL)) == TYPE_NIL
						or seen_names.has(property_name)
					):
						continue
					seen_names[property_name] = true
					if not _matches_filter(property_name, member_filter):
						continue
					members.append(
						_serialize_property(
							property_info,
							requested_type,
							declared_on
						)
					)
			"methods":
				for raw_method in ClassDB.class_get_method_list(declared_on, true):
					var method_info: Dictionary = raw_method
					var method_name: String = str(method_info.get("name", ""))
					if method_name.is_empty() or seen_names.has(method_name):
						continue
					seen_names[method_name] = true
					if not _matches_filter(method_name, member_filter):
						continue
					members.append(
						_serialize_callable(
							method_info,
							"method",
							requested_type,
							declared_on
						)
					)
			"signals":
				for raw_signal in ClassDB.class_get_signal_list(declared_on, true):
					var signal_info: Dictionary = raw_signal
					var signal_name: String = str(signal_info.get("name", ""))
					if signal_name.is_empty() or seen_names.has(signal_name):
						continue
					seen_names[signal_name] = true
					if not _matches_filter(signal_name, member_filter):
						continue
					members.append(
						_serialize_callable(
							signal_info,
							"signal",
							requested_type,
							declared_on
						)
					)
			"enums":
				for raw_enum_name in ClassDB.class_get_enum_list(declared_on, true):
					var enum_name: String = str(raw_enum_name)
					if enum_name.is_empty() or seen_names.has(enum_name):
						continue
					seen_names[enum_name] = true
					if not _matches_filter(enum_name, member_filter):
						continue
					members.append(
						_serialize_enum(enum_name, requested_type, declared_on)
					)

	members.sort_custom(
		func(left: Dictionary, right: Dictionary) -> bool:
			return _case_insensitive_less(
				str(left["name"]),
				str(right["name"])
			)
	)
	return members


func _serialize_property(
	property_info: Dictionary,
	requested_class: String,
	declared_on: String
) -> Dictionary:
	var serialized: Dictionary = _serialize_type_info(property_info)
	serialized["kind"] = "property"
	serialized["declared_on"] = declared_on
	serialized["inherited"] = declared_on != requested_class
	serialized["getter"] = str(
		ClassDB.class_get_property_getter(declared_on, serialized["name"])
	)
	serialized["setter"] = str(
		ClassDB.class_get_property_setter(declared_on, serialized["name"])
	)
	return serialized


func _serialize_callable(
	callable_info: Dictionary,
	kind: String,
	requested_class: String,
	declared_on: String
) -> Dictionary:
	var arguments: Array = []
	var raw_arguments: Variant = callable_info.get("args", [])
	if raw_arguments is Array:
		for raw_argument in raw_arguments:
			if raw_argument is Dictionary:
				arguments.append(_serialize_type_info(raw_argument))

	var default_argument_count: int = 0
	var default_arguments: Variant = callable_info.get("default_args", [])
	if default_arguments is Array:
		default_argument_count = default_arguments.size()

	var serialized: Dictionary = {
		"kind": kind,
		"name": str(callable_info.get("name", "")),
		"declared_on": declared_on,
		"inherited": declared_on != requested_class,
		"flags": int(callable_info.get("flags", 0)),
		"arguments": arguments,
		"default_argument_count": default_argument_count,
	}
	if kind == "method":
		var return_info: Dictionary = {}
		var raw_return: Variant = callable_info.get("return", {})
		if raw_return is Dictionary:
			return_info = raw_return
		serialized["return_value"] = _serialize_type_info(return_info)
	return serialized


func _serialize_enum(
	enum_name: String,
	requested_class: String,
	declared_on: String
) -> Dictionary:
	var values: Array = []
	for raw_constant_name in ClassDB.class_get_enum_constants(
		declared_on,
		enum_name,
		true
	):
		var constant_name: String = str(raw_constant_name)
		values.append(
			{
				"name": constant_name,
				"value": ClassDB.class_get_integer_constant(
					declared_on,
					constant_name
				),
			}
		)
	values.sort_custom(
		func(left: Dictionary, right: Dictionary) -> bool:
			return _case_insensitive_less(
				str(left["name"]),
				str(right["name"])
			)
	)
	return {
		"kind": "enum",
		"name": enum_name,
		"declared_on": declared_on,
		"inherited": declared_on != requested_class,
		"bitfield": ClassDB.is_class_enum_bitfield(
			declared_on,
			enum_name,
			true
		),
		"values": values,
	}


func _serialize_type_info(type_info: Dictionary) -> Dictionary:
	var type_id: int = int(type_info.get("type", TYPE_NIL))
	return {
		"name": str(type_info.get("name", "")),
		"type": type_string(type_id),
		"type_id": type_id,
		"class_name": str(type_info.get("class_name", "")),
		"hint": int(type_info.get("hint", PROPERTY_HINT_NONE)),
		"hint_string": str(type_info.get("hint_string", "")),
		"usage": int(type_info.get("usage", PROPERTY_USAGE_NONE)),
	}


func _paginate(records: Array, cursor: int, limit: int) -> Dictionary:
	var items: Array = []
	var result_bytes: int = 2
	var index: int = cursor
	var size_truncated: bool = false
	var oversized: bool = false
	while index < records.size() and items.size() < limit:
		var serialized_bytes: int = (
			JSON.stringify(records[index]).to_utf8_buffer().size()
		)
		var separator_bytes: int = 0 if items.is_empty() else 1
		if (
			result_bytes
			+ separator_bytes
			+ serialized_bytes
			> BridgeConstants.MAX_CLASS_QUERY_RESULT_BYTES
		):
			size_truncated = true
			oversized = items.is_empty()
			break
		items.append(records[index])
		result_bytes += separator_bytes + serialized_bytes
		index += 1
	return {
		"items": items,
		"has_more": index < records.size(),
		"size_truncated": size_truncated,
		"oversized": oversized,
	}


func _next_cursor(page: Dictionary, cursor: int) -> Variant:
	if not bool(page["has_more"]):
		return null
	return cursor + (page["items"] as Array).size()


func _inheritance_chain(type_name: String) -> Array[String]:
	var inheritance: Array[String] = []
	var seen: Dictionary = {}
	var current: String = type_name
	while not current.is_empty() and not seen.has(current):
		inheritance.append(current)
		seen[current] = true
		current = str(ClassDB.get_parent_class(current))
	return inheritance


func _inheritance_depth(type_name: String, base_type: String) -> int:
	var depth: int = 0
	var current: String = type_name
	while current != base_type and not current.is_empty():
		current = str(ClassDB.get_parent_class(current))
		depth += 1
	return depth


func _is_class_or_subclass(type_name: String, base_type: String) -> bool:
	return (
		type_name == base_type
		or ClassDB.is_parent_class(type_name, base_type)
	)


func _matches_filter(value: String, filter_value: Variant) -> bool:
	if filter_value == null:
		return true
	var normalized_filter: String = str(filter_value).to_lower()
	return normalized_filter.is_empty() or value.to_lower().contains(normalized_filter)


func _search_rank(type_name: String, query: String) -> int:
	if query.is_empty():
		return 0
	var normalized_name: String = type_name.to_lower()
	var normalized_query: String = query.to_lower()
	if normalized_name == normalized_query:
		return 0
	if normalized_name.begins_with(normalized_query):
		return 1
	return 2


func _case_insensitive_less(left: String, right: String) -> bool:
	var normalized_left: String = left.to_lower()
	var normalized_right: String = right.to_lower()
	if normalized_left == normalized_right:
		return left < right
	return normalized_left < normalized_right


func _node_type_search_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"query": {"type": "string"},
			"base_type": {"type": "string"},
			"types": {
				"type": "array",
				"items": {
					"type": "object",
					"properties": {
						"name": {"type": "string"},
						"parent_type": {"type": "string"},
						"api_type": {
							"type": "string",
							"enum": RUNTIME_API_TYPES,
						},
						"instantiable": {"type": "boolean"},
						"inheritance_depth": {
							"type": "integer",
							"minimum": 0,
						},
					},
					"required": [
						"name",
						"parent_type",
						"api_type",
						"instantiable",
						"inheritance_depth",
					],
					"additionalProperties": false,
				},
			},
			"count": {"type": "integer", "minimum": 0},
			"total_matches": {"type": "integer", "minimum": 0},
			"cursor": {"type": "integer", "minimum": 0},
			"limit": {"type": "integer", "minimum": 1},
			"truncated": {"type": "boolean"},
			"size_truncated": {"type": "boolean"},
			"next_cursor": {"type": ["integer", "null"], "minimum": 0},
		},
		"required": [
			"query",
			"base_type",
			"types",
			"count",
			"total_matches",
			"cursor",
			"limit",
			"truncated",
			"size_truncated",
			"next_cursor",
		],
		"additionalProperties": false,
	}


func _class_api_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"class_name": {"type": "string"},
			"parent_class": {"type": "string"},
			"inheritance": {
				"type": "array",
				"items": {"type": "string"},
			},
			"enabled": {"type": "boolean"},
			"instantiable": {"type": "boolean"},
			"api_type": {
				"type": "string",
				"enum": API_TYPES,
			},
			"section": {
				"type": "string",
				"enum": MEMBER_SECTIONS,
			},
			"member_filter": {"type": ["string", "null"]},
			"include_inherited": {"type": "boolean"},
			"members": {
				"type": "array",
				"items": _class_member_schema(),
			},
			"count": {"type": "integer", "minimum": 0},
			"total_matches": {"type": "integer", "minimum": 0},
			"cursor": {"type": "integer", "minimum": 0},
			"limit": {"type": "integer", "minimum": 1},
			"truncated": {"type": "boolean"},
			"size_truncated": {"type": "boolean"},
			"next_cursor": {"type": ["integer", "null"], "minimum": 0},
		},
		"required": [
			"class_name",
			"parent_class",
			"inheritance",
			"enabled",
			"instantiable",
			"api_type",
			"section",
			"member_filter",
			"include_inherited",
			"members",
			"count",
			"total_matches",
			"cursor",
			"limit",
			"truncated",
			"size_truncated",
			"next_cursor",
		],
		"additionalProperties": false,
	}


func _class_member_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"kind": {
				"type": "string",
				"enum": ["property", "method", "signal", "enum"],
			},
			"name": {"type": "string"},
			"declared_on": {"type": "string"},
			"inherited": {"type": "boolean"},
			"type": {"type": "string"},
			"type_id": {"type": "integer"},
			"class_name": {"type": "string"},
			"hint": {"type": "integer"},
			"hint_string": {"type": "string"},
			"usage": {"type": "integer"},
			"getter": {"type": "string"},
			"setter": {"type": "string"},
			"flags": {"type": "integer"},
			"arguments": {
				"type": "array",
				"items": _type_info_schema(),
			},
			"default_argument_count": {"type": "integer", "minimum": 0},
			"return_value": _type_info_schema(),
			"bitfield": {"type": "boolean"},
			"values": {
				"type": "array",
				"items": {
					"type": "object",
					"properties": {
						"name": {"type": "string"},
						"value": {"type": "integer"},
					},
					"required": ["name", "value"],
					"additionalProperties": false,
				},
			},
		},
		"required": ["kind", "name", "declared_on", "inherited"],
		"additionalProperties": false,
	}


func _type_info_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"name": {"type": "string"},
			"type": {"type": "string"},
			"type_id": {"type": "integer"},
			"class_name": {"type": "string"},
			"hint": {"type": "integer"},
			"hint_string": {"type": "string"},
			"usage": {"type": "integer"},
		},
		"required": [
			"name",
			"type",
			"type_id",
			"class_name",
			"hint",
			"hint_string",
			"usage",
		],
		"additionalProperties": false,
	}


func _api_type_name(api_type: int) -> String:
	match api_type:
		ClassDB.API_CORE:
			return "core"
		ClassDB.API_EDITOR:
			return "editor"
		ClassDB.API_EXTENSION:
			return "extension"
		ClassDB.API_EDITOR_EXTENSION:
			return "editor_extension"
		_:
			return "none"
