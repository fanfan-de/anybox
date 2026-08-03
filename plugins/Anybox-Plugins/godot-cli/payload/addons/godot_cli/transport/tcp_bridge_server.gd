class_name BridgeTcpServer
extends RefCounted


signal status_changed
signal recent_error_changed(message: String)

var _tcp_server: TCPServer
var _clients: Array[BridgeClientConnection] = []
var _rejected_clients: Array[BridgeClientConnection] = []
var _dispatcher: BridgeRpcDispatcher
var _session_store: BridgeSessionStore = BridgeSessionStore.new()
var _listening: bool = false
var _port: int = 0
var _recent_error: String = ""


func _init(dispatcher: BridgeRpcDispatcher) -> void:
	_dispatcher = dispatcher


func start() -> Dictionary:
	if _listening:
		return {
			"ok": true,
			"port": _port,
		}
	_tcp_server = TCPServer.new()
	var listen_error: Error = _tcp_server.listen(0, BridgeConstants.LOOPBACK_HOST)
	if listen_error == OK:
		_port = _tcp_server.get_local_port()
	if listen_error != OK or _port <= 0:
		if _tcp_server != null:
			_tcp_server.stop()
		var fallback: Dictionary = _listen_on_random_dynamic_port()
		if not fallback["ok"]:
			_record_error(str(fallback["error"]["message"]))
			return fallback

	var session_result: Dictionary = _session_store.create(_port)
	if not session_result["ok"]:
		_tcp_server.stop()
		_tcp_server = null
		_port = 0
		_record_error(str(session_result["error"]["message"]))
		return session_result
	_dispatcher.set_token(_session_store.token())
	_listening = true
	_clear_error()
	status_changed.emit()
	return {
		"ok": true,
		"port": _port,
	}


func stop() -> void:
	if _tcp_server != null:
		_tcp_server.stop()
	for client in _clients:
		client.close()
	for client in _rejected_clients:
		client.close()
	_clients.clear()
	_rejected_clients.clear()
	_session_store.remove_own_file()
	_dispatcher.clear_token()
	_tcp_server = null
	_listening = false
	_port = 0
	status_changed.emit()


func process_transport() -> void:
	if not _listening or _tcp_server == null:
		return
	var started_at_usec: int = Time.get_ticks_usec()
	_accept_connections(started_at_usec)
	var executed_request: bool = false
	var now_msec: int = Time.get_ticks_msec()

	for client in _clients:
		if Time.get_ticks_usec() - started_at_usec >= BridgeConstants.TRANSPORT_BUDGET_USEC:
			break
		client.poll_transport()
		if client.closed:
			continue
		if client.is_timed_out(now_msec):
			client.close()
			continue
		var read_result: Dictionary = client.read_available(
			BridgeConstants.IO_BYTES_PER_CLIENT_FRAME
		)
		if not read_result["ok"]:
			if str(read_result.get("protocol_error", "")) == "PARSE_ERROR" and not client.closed:
				client.queue_json(
					BridgeRpcDispatcher.error_response(
						null,
						BridgeConstants.RPC_PARSE_ERROR,
						"PARSE_ERROR",
						"Request payload is not valid UTF-8 JSON"
					)
				)
				client.close_after_write = true
			elif str(read_result.get("protocol_error", "")) == "FRAME_TOO_LARGE":
				_record_error("Closed a connection with an invalid frame length")
		if not executed_request and not client.closed and not client.pending_requests.is_empty():
			var request: Variant = client.pop_pending_request()
			var dispatch_result: Dictionary = _dispatcher.dispatch(request, client)
			_queue_dispatch_result(client, request, dispatch_result)
			executed_request = true
		if not client.closed:
			client.write_available(BridgeConstants.IO_BYTES_PER_CLIENT_FRAME)

	_process_rejected_clients(started_at_usec)
	_remove_closed_clients()


func snapshot() -> Dictionary:
	return {
		"listening": _listening,
		"port": _port,
		"client_count": _active_client_count(),
		"recent_error": _recent_error,
		"session": _session_store.public_descriptor(),
	}


func is_listening() -> bool:
	return _listening


func _listen_on_random_dynamic_port() -> Dictionary:
	var random: RandomNumberGenerator = RandomNumberGenerator.new()
	random.randomize()
	for _attempt in range(32):
		var candidate: int = random.randi_range(49_152, 65_535)
		_tcp_server = TCPServer.new()
		var error: Error = _tcp_server.listen(candidate, BridgeConstants.LOOPBACK_HOST)
		if error == OK:
			_port = _tcp_server.get_local_port()
			if _port > 0:
				return {
					"ok": true,
					"port": _port,
				}
		_tcp_server.stop()
	return {
		"ok": false,
		"error": {
			"code": "EDITOR_UNAVAILABLE",
			"message": "Could not bind a loopback TCP port after 32 attempts",
			"retryable": true,
		},
	}


func _accept_connections(started_at_usec: int) -> void:
	while (
		_tcp_server.is_connection_available()
		and Time.get_ticks_usec() - started_at_usec
		< BridgeConstants.TRANSPORT_BUDGET_USEC
	):
		var peer: StreamPeerTCP = _tcp_server.take_connection()
		if peer == null:
			break
		if _active_client_count() >= BridgeConstants.MAX_CLIENTS:
			var rejected: BridgeClientConnection = BridgeClientConnection.new(peer)
			rejected.queue_json(
				BridgeRpcDispatcher.error_response(
					null,
					BridgeConstants.RPC_SERVER_BUSY,
					"SERVER_BUSY",
					"Godot CLI already has the maximum number of clients",
					true
				)
			)
			rejected.close_after_write = true
			_rejected_clients.append(rejected)
		else:
			_clients.append(BridgeClientConnection.new(peer))
		status_changed.emit()


func _queue_dispatch_result(
	client: BridgeClientConnection,
	request: Variant,
	dispatch_result: Dictionary
) -> void:
	var response: Variant = dispatch_result.get(
		"response",
		BridgeRpcDispatcher.error_response(
			null,
			BridgeConstants.RPC_INTERNAL_ERROR,
			"INTERNAL_ERROR",
			"Dispatcher did not produce a response"
		)
	)
	if response is Dictionary and response.has("error"):
		var rpc_error: Dictionary = response["error"]
		var error_data: Dictionary = rpc_error.get("data", {})
		_record_error(
			"%s: %s"
			% [
				str(error_data.get("code", "RPC_ERROR")),
				str(rpc_error.get("message", "Request failed")),
			]
		)
	var queue_result: Dictionary = client.queue_json(response)
	if not queue_result["ok"] and not client.closed:
		var request_id: Variant = null
		if request is Dictionary:
			request_id = request.get("id", null)
		var compact_error: Dictionary = BridgeRpcDispatcher.error_response(
			request_id,
			BridgeConstants.RPC_RESULT_TOO_LARGE,
			"RESULT_TOO_LARGE",
			"Response exceeds the 1 MiB payload limit"
		)
		if not client.queue_json(compact_error)["ok"]:
			client.close()
	if bool(dispatch_result.get("close", false)):
		client.close_after_write = true


func _process_rejected_clients(started_at_usec: int) -> void:
	for client in _rejected_clients:
		if Time.get_ticks_usec() - started_at_usec >= BridgeConstants.TRANSPORT_BUDGET_USEC:
			break
		client.poll_transport()
		if not client.closed:
			client.write_available(BridgeConstants.IO_BYTES_PER_CLIENT_FRAME)
			if client.is_timed_out(Time.get_ticks_msec()):
				client.close()


func _remove_closed_clients() -> void:
	var previous_count: int = _clients.size()
	_clients = _clients.filter(
		func(client: BridgeClientConnection) -> bool:
			return not client.closed
	)
	_rejected_clients = _rejected_clients.filter(
		func(client: BridgeClientConnection) -> bool:
			return not client.closed
	)
	if previous_count != _clients.size():
		status_changed.emit()


func _active_client_count() -> int:
	var count: int = 0
	for client in _clients:
		if not client.closed:
			count += 1
	return count


func _record_error(message: String) -> void:
	_recent_error = message
	recent_error_changed.emit(message)


func _clear_error() -> void:
	if _recent_error.is_empty():
		return
	_recent_error = ""
	recent_error_changed.emit("")
