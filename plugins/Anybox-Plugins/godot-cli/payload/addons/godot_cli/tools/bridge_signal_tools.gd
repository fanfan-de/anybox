class_name BridgeSignalTools
extends BridgeToolModule


func definitions() -> Array[BridgeToolDefinition]:
	return [
		_definition(
			"connect_signal",
			"Create one simple persistent signal connection through editor UndoRedo.",
			_connection_input_schema(),
			_connect_signal_schema(),
			"write",
			true,
			_connect_signal
		),
		_definition(
			"disconnect_signal",
			"Remove one simple persistent signal connection through editor UndoRedo.",
			_connection_input_schema(),
			_disconnect_signal_schema(),
			"write",
			true,
			_disconnect_signal
		),
		_definition(
			"get_node_signals",
			"Read signal signatures and outgoing connections for one scene node.",
			{
				"type": "object",
				"properties": {
					"path": {
						"type": "string",
						"description": "Scene-root-relative node path, or '.' for the root.",
					},
					"signal": {
						"type": ["string", "null"],
						"default": null,
						"description": "Optional exact signal name filter.",
					},
				},
				"required": ["path"],
				"additionalProperties": false,
			},
			_node_signals_schema(),
			"read",
			false,
			_get_node_signals
		),
	]


func _get_node_signals(arguments: Dictionary) -> Dictionary:
	var scene_root: Node = _context.edited_scene_root()
	var resolved: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		str(arguments["path"])
	)
	if not resolved["ok"]:
		return resolved
	var node: Node = resolved["node"]

	var signal_filter: Variant = arguments.get("signal", null)
	if signal_filter != null:
		var filter_validation: Dictionary = _validate_member_name(
			signal_filter,
			"Signal name"
		)
		if not filter_validation["ok"]:
			return filter_validation
		signal_filter = filter_validation["data"]["name"]

	var raw_signals: Array = node.get_signal_list()
	var signals_by_name: Dictionary = {}
	for raw_signal in raw_signals:
		if not (raw_signal is Dictionary):
			continue
		var signal_info: Dictionary = raw_signal
		var signal_name: String = str(signal_info.get("name", ""))
		if not signal_name.is_empty():
			signals_by_name[signal_name] = signal_info
	if signal_filter != null and not signals_by_name.has(str(signal_filter)):
		return _failure(
			"SIGNAL_NOT_FOUND",
			"Signal not found on %s: %s"
			% [_relative_node_path(scene_root, node), str(signal_filter)]
		)
	if (
		signal_filter == null
		and signals_by_name.size() > BridgeConstants.MAX_NODE_SIGNALS
	):
		return _failure(
			"SIGNAL_LIMIT_EXCEEDED",
			"Node exposes more than %d signals; use an exact signal filter"
			% BridgeConstants.MAX_NODE_SIGNALS
		)

	var persistent_result: Dictionary = _current_scene_connections(scene_root)
	if not persistent_result["ok"]:
		return persistent_result
	var persistent_connections: Array = persistent_result["data"]["connections"]
	var selected_names: Array = (
		[signal_filter]
		if signal_filter != null
		else signals_by_name.keys()
	)
	selected_names.sort()

	var source_path: String = _relative_node_path(scene_root, node)
	var serialized_signals: Array = []
	var connection_count: int = 0
	for raw_signal_name in selected_names:
		var signal_name: String = str(raw_signal_name)
		var runtime_connections: Array = node.get_signal_connection_list(
			StringName(signal_name)
		)
		connection_count += runtime_connections.size()
		if connection_count > BridgeConstants.MAX_NODE_SIGNAL_CONNECTIONS:
			return _failure(
				"SIGNAL_CONNECTION_LIMIT_EXCEEDED",
				(
					"Requested signals expose more than %d connections; "
					+ "use an exact signal filter"
				)
				% BridgeConstants.MAX_NODE_SIGNAL_CONNECTIONS
			)
		var connections: Array = []
		for raw_connection in runtime_connections:
			if raw_connection is Dictionary:
				connections.append(
					_serialize_runtime_connection(
						scene_root,
						node,
						source_path,
						signal_name,
						raw_connection,
						persistent_connections
					)
				)
		connections.sort_custom(_connection_less)
		serialized_signals.append(
			_serialize_signal(
				signals_by_name[signal_name],
				connections
			)
		)

	return _success(
		{
			"scene_path": scene_root.scene_file_path,
			"path": source_path,
			"editable": _is_local_node(scene_root, node),
			"signal_filter": signal_filter,
			"signals": serialized_signals,
			"count": serialized_signals.size(),
			"total_signals": signals_by_name.size(),
			"connection_count": connection_count,
		}
	)


func _connect_signal(arguments: Dictionary) -> Dictionary:
	var prepared: Dictionary = _prepare_connection(arguments, true)
	if not prepared["ok"]:
		return prepared
	var data: Dictionary = prepared["data"]
	if not data["scene_connections"].is_empty() or not data[
		"runtime_connections"
	].is_empty():
		return _failure(
			"SIGNAL_ALREADY_CONNECTED",
			"The requested signal endpoint is already connected"
		)

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)
	var action_name: String = _connection_action_name("Connect", data)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		data["scene_root"],
		true,
		true
	)
	undo_redo.add_do_method(
		self,
		"_set_simple_connection_state",
		data["source"],
		data["signal"],
		data["target"],
		data["method"],
		true
	)
	undo_redo.add_undo_method(
		self,
		"_set_simple_connection_state",
		data["source"],
		data["signal"],
		data["target"],
		data["method"],
		false
	)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(data["scene_root"])

	if not _connection_postconditions_met(data, true):
		if not _rollback_connection_change(
			undo_redo,
			data,
			false,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Signal connection failed and could not be safely undone"
			)
		return _failure(
			"SIGNAL_CONNECT_FAILED",
			"Signal connection did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": data["scene_root"].scene_file_path,
			"source_path": data["source_path"],
			"signal": data["signal"],
			"target_path": data["target_path"],
			"method": data["method"],
			"flags": CONNECT_PERSIST,
			"connected": true,
			"scene_unsaved": true,
		}
	)


func _disconnect_signal(arguments: Dictionary) -> Dictionary:
	var prepared: Dictionary = _prepare_connection(arguments, false)
	if not prepared["ok"]:
		return prepared
	var data: Dictionary = prepared["data"]
	var scene_connections: Array = data["scene_connections"]
	var runtime_connections: Array = data["runtime_connections"]
	if scene_connections.is_empty():
		if not runtime_connections.is_empty():
			return _failure(
				"SIGNAL_CONNECTION_NOT_PERSISTENT",
				"The matching connection is not stored by the current scene"
			)
		return _failure(
			"SIGNAL_CONNECTION_NOT_FOUND",
			"The requested persistent signal connection does not exist"
		)
	if scene_connections.size() != 1 or not _is_simple_scene_connection(
		scene_connections[0]
	):
		return _failure(
			"SIGNAL_CONNECTION_UNSUPPORTED",
			(
				"Only one persistent connection without deferred, one-shot, "
				+ "reference-counted, append-source, bind, or unbind options can be removed"
			)
		)
	if runtime_connections.size() != 1 or not _is_simple_runtime_connection(
		runtime_connections[0],
		data["target"],
		data["method"]
	):
		return _failure(
			"SIGNAL_CONNECTION_INCONSISTENT",
			"The stored connection does not match the live editor connection"
		)

	var undo_redo: EditorUndoRedoManager = _context.undo_redo()
	if undo_redo == null:
		return _failure(
			"INTERNAL_ERROR",
			"Editor UndoRedo manager is unavailable"
		)
	var action_name: String = _connection_action_name("Disconnect", data)
	undo_redo.create_action(
		action_name,
		UndoRedo.MERGE_DISABLE,
		data["scene_root"],
		true,
		true
	)
	undo_redo.add_do_method(
		self,
		"_set_simple_connection_state",
		data["source"],
		data["signal"],
		data["target"],
		data["method"],
		false
	)
	undo_redo.add_undo_method(
		self,
		"_set_simple_connection_state",
		data["source"],
		data["signal"],
		data["target"],
		data["method"],
		true
	)
	undo_redo.commit_action()
	_context.mark_scene_unsaved(data["scene_root"])

	if not _connection_postconditions_met(data, false):
		if not _rollback_connection_change(
			undo_redo,
			data,
			true,
			action_name
		):
			return _failure(
				"INTERNAL_ERROR",
				"Signal disconnection failed and could not be safely undone"
			)
		return _failure(
			"SIGNAL_DISCONNECT_FAILED",
			"Signal disconnection did not satisfy all editor postconditions"
		)

	return _success(
		{
			"scene_path": data["scene_root"].scene_file_path,
			"source_path": data["source_path"],
			"signal": data["signal"],
			"target_path": data["target_path"],
			"method": data["method"],
			"previous_flags": int(scene_connections[0]["flags"]),
			"disconnected": true,
			"scene_unsaved": true,
		}
	)


func _prepare_connection(
	arguments: Dictionary,
	validate_signature: bool
) -> Dictionary:
	var signal_validation: Dictionary = _validate_member_name(
		arguments.get("signal", null),
		"Signal name"
	)
	if not signal_validation["ok"]:
		return signal_validation
	var method_validation: Dictionary = _validate_member_name(
		arguments.get("method", null),
		"Target method"
	)
	if not method_validation["ok"]:
		return method_validation
	var signal_name: String = signal_validation["data"]["name"]
	var method_name: String = method_validation["data"]["name"]

	var scene_root: Node = _context.edited_scene_root()
	var source_result: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		str(arguments.get("source_path", ""))
	)
	if not source_result["ok"]:
		return source_result
	var target_result: Dictionary = BridgeNodePathGuard.resolve(
		scene_root,
		str(arguments.get("target_path", ""))
	)
	if not target_result["ok"]:
		return target_result
	var source: Node = source_result["node"]
	var target: Node = target_result["node"]
	if (
		not _is_local_node(scene_root, source)
		or not _is_local_node(scene_root, target)
	):
		return _failure(
			"NODE_NOT_EDITABLE",
			"Signal source and target must be local to the current scene"
		)

	var signal_info: Dictionary = _find_signal_info(source, signal_name)
	if signal_info.is_empty():
		return _failure(
			"SIGNAL_NOT_FOUND",
			"Signal not found on %s: %s"
			% [_relative_node_path(scene_root, source), signal_name]
		)
	var method_info: Dictionary = _find_method_info(target, method_name)
	if method_info.is_empty() or not target.has_method(StringName(method_name)):
		return _failure(
			"TARGET_METHOD_NOT_FOUND",
			"Target method not found on %s: %s"
			% [_relative_node_path(scene_root, target), method_name]
		)
	if validate_signature and not _signatures_are_compatible(
		signal_info,
		method_info
	):
		return _failure(
			"SIGNAL_ARGUMENT_MISMATCH",
			"Signal arguments are incompatible with the target method signature"
		)

	var persistent_result: Dictionary = _current_scene_connections(scene_root)
	if not persistent_result["ok"]:
		return persistent_result
	var source_path: String = _relative_node_path(scene_root, source)
	var target_path: String = _relative_node_path(scene_root, target)
	var scene_connections: Array = _find_scene_connections(
		persistent_result["data"]["connections"],
		source_path,
		signal_name,
		target_path,
		method_name
	)
	var runtime_connections: Array = _find_runtime_connections(
		source,
		signal_name,
		target,
		method_name
	)
	return _success(
		{
			"scene_root": scene_root,
			"source": source,
			"target": target,
			"source_path": source_path,
			"target_path": target_path,
			"signal": signal_name,
			"method": method_name,
			"scene_connections": scene_connections,
			"runtime_connections": runtime_connections,
			"plan": _connection_target_plan(
				scene_root,
				source,
				target,
				source_path,
				target_path
			),
		}
	)


func _validate_member_name(raw_name: Variant, label: String) -> Dictionary:
	if typeof(raw_name) != TYPE_STRING:
		return _failure("INVALID_ARGUMENTS", label + " must be a string")
	var member_name: String = str(raw_name)
	if (
		member_name.is_empty()
		or member_name.length() > BridgeConstants.MAX_SIGNAL_MEMBER_NAME_LENGTH
		or not member_name.is_valid_identifier()
	):
		return _failure(
			"INVALID_ARGUMENTS",
			(
				label
				+ " must be a valid identifier containing between 1 and %d characters"
				% BridgeConstants.MAX_SIGNAL_MEMBER_NAME_LENGTH
			)
		)
	return _success({"name": member_name})


func _find_signal_info(node: Node, signal_name: String) -> Dictionary:
	for raw_signal in node.get_signal_list():
		if (
			raw_signal is Dictionary
			and str(raw_signal.get("name", "")) == signal_name
		):
			return raw_signal
	return {}


func _find_method_info(node: Node, method_name: String) -> Dictionary:
	for raw_method in node.get_method_list():
		if (
			raw_method is Dictionary
			and str(raw_method.get("name", "")) == method_name
		):
			return raw_method
	return {}


func _signatures_are_compatible(
	signal_info: Dictionary,
	method_info: Dictionary
) -> bool:
	var signal_arguments: Array = signal_info.get("args", [])
	var method_arguments: Array = method_info.get("args", [])
	var default_arguments: Array = method_info.get("default_args", [])
	var required_method_arguments: int = maxi(
		0,
		method_arguments.size() - default_arguments.size()
	)
	var method_is_vararg: bool = (
		int(method_info.get("flags", 0)) & METHOD_FLAG_VARARG
	) != 0
	if signal_arguments.size() < required_method_arguments:
		return false
	if not method_is_vararg and signal_arguments.size() > method_arguments.size():
		return false
	for index in mini(signal_arguments.size(), method_arguments.size()):
		if (
			not (signal_arguments[index] is Dictionary)
			or not (method_arguments[index] is Dictionary)
		):
			continue
		if not _argument_types_are_compatible(
			signal_arguments[index],
			method_arguments[index]
		):
			return false
	return true


func _argument_types_are_compatible(
	signal_argument: Dictionary,
	method_argument: Dictionary
) -> bool:
	var signal_type: int = int(signal_argument.get("type", TYPE_NIL))
	var method_type: int = int(method_argument.get("type", TYPE_NIL))
	if signal_type == TYPE_NIL or method_type == TYPE_NIL:
		return true
	if signal_type != method_type:
		return false
	if signal_type != TYPE_OBJECT:
		return true
	var signal_class: String = str(signal_argument.get("class_name", ""))
	var method_class: String = str(method_argument.get("class_name", ""))
	if signal_class.is_empty() or method_class.is_empty() or signal_class == method_class:
		return true
	return (
		ClassDB.class_exists(signal_class)
		and ClassDB.class_exists(method_class)
		and ClassDB.is_parent_class(signal_class, method_class)
	)


func _serialize_signal(signal_info: Dictionary, connections: Array) -> Dictionary:
	var arguments: Array = []
	var raw_arguments: Variant = signal_info.get("args", [])
	if raw_arguments is Array:
		for raw_argument in raw_arguments:
			if raw_argument is Dictionary:
				arguments.append(_serialize_type_info(raw_argument))
	var default_arguments: Variant = signal_info.get("default_args", [])
	var default_argument_count: int = (
		default_arguments.size() if default_arguments is Array else 0
	)
	return {
		"name": str(signal_info.get("name", "")),
		"flags": int(signal_info.get("flags", 0)),
		"arguments": arguments,
		"argument_count": arguments.size(),
		"default_argument_count": default_argument_count,
		"connections": connections,
		"connection_count": connections.size(),
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


func _serialize_runtime_connection(
	scene_root: Node,
	source: Node,
	source_path: String,
	signal_name: String,
	raw_connection: Dictionary,
	persistent_connections: Array
) -> Dictionary:
	var callable_value: Variant = raw_connection.get("callable", Callable())
	var callable: Callable = (
		callable_value if callable_value is Callable else Callable()
	)
	var target_object: Object = callable.get_object()
	var target_node: Node = target_object as Node
	var target_in_scene: bool = (
		target_node != null
		and (
			target_node == scene_root
			or scene_root.is_ancestor_of(target_node)
		)
	)
	var target_path: Variant = (
		_relative_node_path(scene_root, target_node)
		if target_in_scene
		else null
	)
	var method_name: String = str(callable.get_method())
	var flags: int = int(raw_connection.get("flags", 0))
	var bind_count: int = callable.get_bound_arguments_count()
	var unbind_count: int = callable.get_unbound_arguments_count()
	var current_scene_persistent: bool = false
	if target_path != null:
		for record in persistent_connections:
			if _scene_record_matches_runtime(
				record,
				source_path,
				signal_name,
				str(target_path),
				method_name,
				flags,
				bind_count,
				unbind_count
			):
				current_scene_persistent = true
				break
	var source_editable: bool = _is_local_node(scene_root, source)
	var target_editable: bool = (
		target_in_scene and _is_local_node(scene_root, target_node)
	)
	return {
		"source_path": source_path,
		"target_path": target_path,
		"target_in_scene": target_in_scene,
		"target_editable": target_editable,
		"method": method_name,
		"flags": flags,
		"persistent": (flags & CONNECT_PERSIST) != 0,
		"current_scene_persistent": current_scene_persistent,
		"deferred": (flags & CONNECT_DEFERRED) != 0,
		"one_shot": (flags & CONNECT_ONE_SHOT) != 0,
		"reference_counted": (flags & CONNECT_REFERENCE_COUNTED) != 0,
		"append_source_object": (
			flags & CONNECT_APPEND_SOURCE_OBJECT
		) != 0,
		"bind_count": bind_count,
		"unbind_count": unbind_count,
		"simple": (
			source_editable
			and target_editable
			and callable.is_standard()
			and flags == CONNECT_PERSIST
			and bind_count == 0
			and unbind_count == 0
			and current_scene_persistent
		),
	}


func _current_scene_connections(scene_root: Node) -> Dictionary:
	if scene_root == null:
		return _failure("SCENE_NOT_OPEN", "No edited scene is currently open")
	var packed_scene: PackedScene = PackedScene.new()
	if packed_scene.pack(scene_root) != OK:
		return _failure(
			"SCENE_STATE_UNAVAILABLE",
			"The current scene could not be inspected for persistent connections"
		)
	var scene_state: SceneState = packed_scene.get_state()
	if scene_state == null:
		return _failure(
			"SCENE_STATE_UNAVAILABLE",
			"The current scene did not expose a packed scene state"
		)
	var connections: Array = []
	for index in scene_state.get_connection_count():
		var binds: Array = scene_state.get_connection_binds(index)
		connections.append(
			{
				"source_path": _normalize_state_path(
					scene_root,
					str(scene_state.get_connection_source(index))
				),
				"signal": str(scene_state.get_connection_signal(index)),
				"target_path": _normalize_state_path(
					scene_root,
					str(scene_state.get_connection_target(index))
				),
				"method": str(scene_state.get_connection_method(index)),
				"flags": int(scene_state.get_connection_flags(index)),
				"bind_count": binds.size(),
				"unbind_count": int(scene_state.get_connection_unbinds(index)),
			}
		)
	connections.sort_custom(_scene_connection_less)
	return _success({"connections": connections})


func _normalize_state_path(scene_root: Node, raw_path: String) -> String:
	if raw_path in ["", "."] or raw_path == str(scene_root.name):
		return "."
	var normalized: String = raw_path
	if normalized.begins_with("./"):
		normalized = normalized.trim_prefix("./")
	var root_prefix: String = str(scene_root.name) + "/"
	if normalized.begins_with(root_prefix):
		normalized = normalized.trim_prefix(root_prefix)
	return normalized


func _find_scene_connections(
	connections: Array,
	source_path: String,
	signal_name: String,
	target_path: String,
	method_name: String
) -> Array:
	var matches: Array = []
	for connection in connections:
		if (
			str(connection["source_path"]) == source_path
			and str(connection["signal"]) == signal_name
			and str(connection["target_path"]) == target_path
			and str(connection["method"]) == method_name
		):
			matches.append(connection)
	return matches


func _find_runtime_connections(
	source: Node,
	signal_name: String,
	target: Node,
	method_name: String
) -> Array:
	var matches: Array = []
	for raw_connection in source.get_signal_connection_list(
		StringName(signal_name)
	):
		if not (raw_connection is Dictionary):
			continue
		var callable_value: Variant = raw_connection.get("callable", Callable())
		if not (callable_value is Callable):
			continue
		var callable: Callable = callable_value
		if (
			callable.get_object() == target
			and str(callable.get_method()) == method_name
		):
			matches.append(raw_connection)
	return matches


func _scene_record_matches_runtime(
	record: Dictionary,
	source_path: String,
	signal_name: String,
	target_path: String,
	method_name: String,
	flags: int,
	bind_count: int,
	unbind_count: int
) -> bool:
	return (
		str(record["source_path"]) == source_path
		and str(record["signal"]) == signal_name
		and str(record["target_path"]) == target_path
		and str(record["method"]) == method_name
		and int(record["flags"]) == flags
		and int(record["bind_count"]) == bind_count
		and int(record["unbind_count"]) == unbind_count
	)


func _is_simple_scene_connection(record: Dictionary) -> bool:
	return (
		int(record["flags"]) == CONNECT_PERSIST
		and int(record["bind_count"]) == 0
		and int(record["unbind_count"]) == 0
	)


func _is_simple_runtime_connection(
	connection: Dictionary,
	target: Node,
	method_name: String
) -> bool:
	var callable_value: Variant = connection.get("callable", Callable())
	if not (callable_value is Callable):
		return false
	var callable: Callable = callable_value
	return (
		callable.is_standard()
		and callable.get_object() == target
		and str(callable.get_method()) == method_name
		and callable.get_bound_arguments_count() == 0
		and callable.get_unbound_arguments_count() == 0
		and int(connection.get("flags", 0)) == CONNECT_PERSIST
	)


func _set_simple_connection_state(
	source: Node,
	signal_name: String,
	target: Node,
	method_name: String,
	connected: bool
) -> void:
	if not is_instance_valid(source) or not is_instance_valid(target):
		return
	var callable: Callable = Callable(target, StringName(method_name))
	var is_connected_now: bool = source.is_connected(
		StringName(signal_name),
		callable
	)
	if connected and not is_connected_now:
		source.connect(StringName(signal_name), callable, CONNECT_PERSIST)
	elif not connected and is_connected_now:
		source.disconnect(StringName(signal_name), callable)


func _connection_postconditions_met(data: Dictionary, connected: bool) -> bool:
	var scene_root: Node = data["scene_root"]
	var source: Node = data["source"]
	var target: Node = data["target"]
	if (
		not _context.is_scene_unsaved(scene_root)
		or not _connection_targets_match(data["plan"])
	):
		return false
	var persistent_result: Dictionary = _current_scene_connections(scene_root)
	if not persistent_result["ok"]:
		return false
	var scene_connections: Array = _find_scene_connections(
		persistent_result["data"]["connections"],
		data["source_path"],
		data["signal"],
		data["target_path"],
		data["method"]
	)
	var runtime_connections: Array = _find_runtime_connections(
		source,
		data["signal"],
		target,
		data["method"]
	)
	if connected:
		return (
			scene_connections.size() == 1
			and _is_simple_scene_connection(scene_connections[0])
			and runtime_connections.size() == 1
			and _is_simple_runtime_connection(
				runtime_connections[0],
				target,
				data["method"]
			)
		)
	return scene_connections.is_empty() and runtime_connections.is_empty()


func _rollback_connection_change(
	undo_redo: EditorUndoRedoManager,
	data: Dictionary,
	previously_connected: bool,
	action_name: String
) -> bool:
	var scene_root: Node = data["scene_root"]
	var history_id: int = undo_redo.get_object_history_id(scene_root)
	var history: UndoRedo = undo_redo.get_history_undo_redo(history_id)
	if (
		history != null
		and history.has_undo()
		and history.get_current_action_name() == action_name
	):
		if not history.undo():
			return false
	else:
		_set_simple_connection_state(
			data["source"],
			data["signal"],
			data["target"],
			data["method"],
			previously_connected
		)
	if not _connection_targets_match(data["plan"]):
		return false
	var persistent_result: Dictionary = _current_scene_connections(scene_root)
	if not persistent_result["ok"]:
		return false
	var scene_connections: Array = _find_scene_connections(
		persistent_result["data"]["connections"],
		data["source_path"],
		data["signal"],
		data["target_path"],
		data["method"]
	)
	var runtime_connections: Array = _find_runtime_connections(
		data["source"],
		data["signal"],
		data["target"],
		data["method"]
	)
	if previously_connected:
		return (
			scene_connections.size() == 1
			and _is_simple_scene_connection(scene_connections[0])
			and runtime_connections.size() == 1
			and _is_simple_runtime_connection(
				runtime_connections[0],
				data["target"],
				data["method"]
			)
		)
	return scene_connections.is_empty() and runtime_connections.is_empty()


func _connection_target_plan(
	scene_root: Node,
	source: Node,
	target: Node,
	source_path: String,
	target_path: String
) -> Dictionary:
	return {
		"scene_root": scene_root,
		"source": source,
		"source_id": source.get_instance_id(),
		"source_path": source_path,
		"source_parent": source.get_parent(),
		"source_owner": source.owner,
		"target": target,
		"target_id": target.get_instance_id(),
		"target_path": target_path,
		"target_parent": target.get_parent(),
		"target_owner": target.owner,
	}


func _connection_targets_match(plan: Dictionary) -> bool:
	var scene_root: Node = plan["scene_root"]
	var source: Node = plan["source"]
	var target: Node = plan["target"]
	if (
		not is_instance_valid(scene_root)
		or not is_instance_valid(source)
		or not is_instance_valid(target)
		or source.get_instance_id() != int(plan["source_id"])
		or target.get_instance_id() != int(plan["target_id"])
		or source.get_parent() != plan["source_parent"]
		or target.get_parent() != plan["target_parent"]
		or source.owner != plan["source_owner"]
		or target.owner != plan["target_owner"]
		or _relative_node_path(scene_root, source) != str(plan["source_path"])
		or _relative_node_path(scene_root, target) != str(plan["target_path"])
	):
		return false
	return (
		_resolve_relative_path(scene_root, str(plan["source_path"])) == source
		and _resolve_relative_path(scene_root, str(plan["target_path"])) == target
	)


func _resolve_relative_path(scene_root: Node, path: String) -> Node:
	return (
		scene_root
		if path == "."
		else scene_root.get_node_or_null(NodePath(path))
	)


func _connection_action_name(action: String, data: Dictionary) -> String:
	return (
		BridgeConstants.PRODUCT_NAME
		+ ": "
		+ action
		+ " "
		+ str(data["source_path"])
		+ "."
		+ str(data["signal"])
		+ " -> "
		+ str(data["target_path"])
		+ "."
		+ str(data["method"])
	)


func _relative_node_path(scene_root: Node, node: Node) -> String:
	if node == scene_root:
		return "."
	return str(scene_root.get_path_to(node))


func _is_local_node(scene_root: Node, node: Node) -> bool:
	return node == scene_root or node.owner == scene_root


func _connection_less(left: Dictionary, right: Dictionary) -> bool:
	var left_key: String = "%s\n%s\n%010d" % [
		str(left["target_path"]),
		str(left["method"]),
		int(left["flags"]),
	]
	var right_key: String = "%s\n%s\n%010d" % [
		str(right["target_path"]),
		str(right["method"]),
		int(right["flags"]),
	]
	return left_key < right_key


func _scene_connection_less(left: Dictionary, right: Dictionary) -> bool:
	var left_key: String = "%s\n%s\n%s\n%s\n%010d" % [
		str(left["source_path"]),
		str(left["signal"]),
		str(left["target_path"]),
		str(left["method"]),
		int(left["flags"]),
	]
	var right_key: String = "%s\n%s\n%s\n%s\n%010d" % [
		str(right["source_path"]),
		str(right["signal"]),
		str(right["target_path"]),
		str(right["method"]),
		int(right["flags"]),
	]
	return left_key < right_key


func _connection_input_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"source_path": {
				"type": "string",
				"description": "Local scene node that owns the signal.",
			},
			"signal": {
				"type": "string",
				"description": "Exact signal name on the source node.",
			},
			"target_path": {
				"type": "string",
				"description": "Local scene node that owns the target method.",
			},
			"method": {
				"type": "string",
				"description": "Exact existing target method name.",
			},
		},
		"required": ["source_path", "signal", "target_path", "method"],
		"additionalProperties": false,
	}


func _node_signals_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"path": {"type": "string"},
			"editable": {"type": "boolean"},
			"signal_filter": {"type": ["string", "null"]},
			"signals": {
				"type": "array",
				"items": _node_signal_schema(),
			},
			"count": {"type": "integer", "minimum": 0},
			"total_signals": {"type": "integer", "minimum": 0},
			"connection_count": {"type": "integer", "minimum": 0},
		},
		"required": [
			"scene_path",
			"path",
			"editable",
			"signal_filter",
			"signals",
			"count",
			"total_signals",
			"connection_count",
		],
		"additionalProperties": false,
	}


func _node_signal_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"name": {"type": "string"},
			"flags": {"type": "integer"},
			"arguments": {
				"type": "array",
				"items": _type_info_schema(),
			},
			"argument_count": {"type": "integer", "minimum": 0},
			"default_argument_count": {"type": "integer", "minimum": 0},
			"connections": {
				"type": "array",
				"items": _signal_connection_schema(),
			},
			"connection_count": {"type": "integer", "minimum": 0},
		},
		"required": [
			"name",
			"flags",
			"arguments",
			"argument_count",
			"default_argument_count",
			"connections",
			"connection_count",
		],
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


func _signal_connection_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"source_path": {"type": "string"},
			"target_path": {"type": ["string", "null"]},
			"target_in_scene": {"type": "boolean"},
			"target_editable": {"type": "boolean"},
			"method": {"type": "string"},
			"flags": {"type": "integer"},
			"persistent": {"type": "boolean"},
			"current_scene_persistent": {"type": "boolean"},
			"deferred": {"type": "boolean"},
			"one_shot": {"type": "boolean"},
			"reference_counted": {"type": "boolean"},
			"append_source_object": {"type": "boolean"},
			"bind_count": {"type": "integer", "minimum": 0},
			"unbind_count": {"type": "integer", "minimum": 0},
			"simple": {"type": "boolean"},
		},
		"required": [
			"source_path",
			"target_path",
			"target_in_scene",
			"target_editable",
			"method",
			"flags",
			"persistent",
			"current_scene_persistent",
			"deferred",
			"one_shot",
			"reference_counted",
			"append_source_object",
			"bind_count",
			"unbind_count",
			"simple",
		],
		"additionalProperties": false,
	}


func _connect_signal_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"source_path": {"type": "string"},
			"signal": {"type": "string"},
			"target_path": {"type": "string"},
			"method": {"type": "string"},
			"flags": {"type": "integer"},
			"connected": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"source_path",
			"signal",
			"target_path",
			"method",
			"flags",
			"connected",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}


func _disconnect_signal_schema() -> Dictionary:
	return {
		"type": "object",
		"properties": {
			"scene_path": {"type": "string"},
			"source_path": {"type": "string"},
			"signal": {"type": "string"},
			"target_path": {"type": "string"},
			"method": {"type": "string"},
			"previous_flags": {"type": "integer"},
			"disconnected": {"type": "boolean"},
			"scene_unsaved": {"type": "boolean"},
		},
		"required": [
			"scene_path",
			"source_path",
			"signal",
			"target_path",
			"method",
			"previous_flags",
			"disconnected",
			"scene_unsaved",
		],
		"additionalProperties": false,
	}
