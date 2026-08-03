class_name BridgeClientConnection
extends RefCounted


var peer: StreamPeerTCP
var receive_buffer: PackedByteArray = PackedByteArray()
var send_buffer: PackedByteArray = PackedByteArray()
var pending_requests: Array[Variant] = []
var pending_request_sizes: Array[int] = []
var pending_request_bytes: int = 0
var initialized: bool = false
var close_after_write: bool = false
var closed: bool = false
var created_at_msec: int = 0
var last_activity_msec: int = 0


func _init(tcp_peer: StreamPeerTCP) -> void:
	peer = tcp_peer
	created_at_msec = Time.get_ticks_msec()
	last_activity_msec = created_at_msec


func poll_transport() -> void:
	if closed or peer == null:
		return
	peer.poll()
	if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		close()


func read_available(byte_budget: int) -> Dictionary:
	if closed or peer == null or byte_budget <= 0:
		return {"ok": true, "bytes": 0}
	var available: int = peer.get_available_bytes()
	if available <= 0:
		return {"ok": true, "bytes": 0}
	var requested: int = mini(available, byte_budget)
	var read_result: Array = peer.get_partial_data(requested)
	var error: Error = read_result[0]
	var bytes: PackedByteArray = read_result[1]
	if error != OK:
		close()
		return {
			"ok": false,
			"error": error,
		}
	if not bytes.is_empty():
		receive_buffer.append_array(bytes)
		last_activity_msec = Time.get_ticks_msec()
	var extraction: Dictionary = _extract_frames()
	extraction["bytes"] = bytes.size()
	return extraction


func _extract_frames() -> Dictionary:
	while receive_buffer.size() >= 4:
		var length: int = BridgeFrameCodec.read_length(receive_buffer)
		if length <= 0 or length > BridgeConstants.MAX_FRAME_BYTES:
			close()
			return {
				"ok": false,
				"protocol_error": "FRAME_TOO_LARGE",
			}
		if receive_buffer.size() < 4 + length:
			break
		var payload: PackedByteArray = receive_buffer.slice(4, 4 + length)
		receive_buffer = receive_buffer.slice(4 + length)
		var decoded: Dictionary = BridgeFrameCodec.decode_json(payload)
		if not decoded["ok"]:
			return {
				"ok": false,
				"protocol_error": "PARSE_ERROR",
				"parse_error": decoded,
			}
		if (
			pending_requests.size() >= BridgeConstants.MAX_PENDING_REQUESTS
			or pending_request_bytes + length
			> BridgeConstants.MAX_PENDING_REQUEST_BYTES
		):
			close()
			return {
				"ok": false,
				"protocol_error": "REQUEST_QUEUE_FULL",
			}
		pending_requests.append(decoded["value"])
		pending_request_sizes.append(length)
		pending_request_bytes += length
	return {"ok": true}


func pop_pending_request() -> Variant:
	if pending_requests.is_empty():
		return null
	var request: Variant = pending_requests.pop_front()
	var size: int = pending_request_sizes.pop_front()
	pending_request_bytes -= size
	return request


func queue_json(value: Variant) -> Dictionary:
	var encoded: Dictionary = BridgeFrameCodec.encode_json(value)
	if not encoded["ok"]:
		return encoded
	var frame: PackedByteArray = encoded["frame"]
	if send_buffer.size() + frame.size() > BridgeConstants.MAX_SEND_QUEUE_BYTES:
		close()
		return {
			"ok": false,
			"error": "SEND_QUEUE_FULL",
		}
	send_buffer.append_array(frame)
	return {
		"ok": true,
		"payload_size": encoded["payload_size"],
	}


func write_available(byte_budget: int) -> Dictionary:
	if closed or peer == null or send_buffer.is_empty() or byte_budget <= 0:
		return {"ok": true, "bytes": 0}
	var requested: int = mini(send_buffer.size(), byte_budget)
	var chunk: PackedByteArray = send_buffer.slice(0, requested)
	var write_result: Array = peer.put_partial_data(chunk)
	var error: Error = write_result[0]
	var written: int = int(write_result[1])
	if error != OK:
		close()
		return {
			"ok": false,
			"error": error,
			"bytes": 0,
		}
	if written > 0:
		send_buffer = send_buffer.slice(written)
		last_activity_msec = Time.get_ticks_msec()
	if close_after_write and send_buffer.is_empty():
		close()
	return {
		"ok": true,
		"bytes": written,
	}


func is_timed_out(now_msec: int) -> bool:
	if initialized:
		return now_msec - last_activity_msec > BridgeConstants.IDLE_TIMEOUT_MSEC
	return now_msec - created_at_msec > BridgeConstants.INITIALIZE_TIMEOUT_MSEC


func close() -> void:
	if closed:
		return
	closed = true
	if peer != null:
		peer.disconnect_from_host()
	peer = null
	receive_buffer.clear()
	send_buffer.clear()
	pending_requests.clear()
	pending_request_sizes.clear()
	pending_request_bytes = 0
