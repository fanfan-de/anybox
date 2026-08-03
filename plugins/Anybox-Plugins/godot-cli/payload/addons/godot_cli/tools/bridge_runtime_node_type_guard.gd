class_name BridgeRuntimeNodeTypeGuard
extends RefCounted


static func is_instantiable_runtime_node_type(type_name: String) -> bool:
	return (
		is_runtime_node_class(type_name)
		and ClassDB.is_class_enabled(type_name)
		and ClassDB.can_instantiate(type_name)
	)


static func is_runtime_node_class(type_name: String) -> bool:
	return (
		not type_name.is_empty()
		and type_name.length() <= BridgeConstants.MAX_CLASS_QUERY_STRING_LENGTH
		and ClassDB.class_exists(type_name)
		and is_class_or_subclass(type_name, "Node")
		and is_runtime_api_type(ClassDB.class_get_api_type(type_name))
	)


static func is_class_or_subclass(type_name: String, base_type: String) -> bool:
	return type_name == base_type or ClassDB.is_parent_class(type_name, base_type)


static func is_runtime_api_type(api_type: int) -> bool:
	return api_type in [ClassDB.API_CORE, ClassDB.API_EXTENSION]
