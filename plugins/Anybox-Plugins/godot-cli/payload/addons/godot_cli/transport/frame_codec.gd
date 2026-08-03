class_name BridgeFrameCodec
extends RefCounted


static func encode_json(value: Variant) -> Dictionary:
	var payload: PackedByteArray = JSON.stringify(value).to_utf8_buffer()
	if payload.is_empty() or payload.size() > BridgeConstants.MAX_FRAME_BYTES:
		return {
			"ok": false,
			"error": "FRAME_TOO_LARGE",
		}
	var frame: PackedByteArray = PackedByteArray()
	frame.resize(4)
	var length: int = payload.size()
	frame[0] = (length >> 24) & 0xff
	frame[1] = (length >> 16) & 0xff
	frame[2] = (length >> 8) & 0xff
	frame[3] = length & 0xff
	frame.append_array(payload)
	return {
		"ok": true,
		"frame": frame,
		"payload_size": length,
	}


static func read_length(buffer: PackedByteArray) -> int:
	if buffer.size() < 4:
		return -1
	return (
		(int(buffer[0]) << 24)
		| (int(buffer[1]) << 16)
		| (int(buffer[2]) << 8)
		| int(buffer[3])
	)


static func decode_json(payload: PackedByteArray) -> Dictionary:
	if not _is_valid_utf8(payload):
		return {
			"ok": false,
			"error": "INVALID_UTF8",
		}
	var text: String = payload.get_string_from_utf8()
	var parser: JSON = JSON.new()
	var parse_error: Error = parser.parse(text)
	if parse_error != OK:
		return {
			"ok": false,
			"error": "INVALID_JSON",
			"message": parser.get_error_message(),
			"line": parser.get_error_line(),
		}
	return {
		"ok": true,
		"value": parser.data,
	}


static func _is_valid_utf8(bytes: PackedByteArray) -> bool:
	var index: int = 0
	while index < bytes.size():
		var first: int = int(bytes[index])
		if first <= 0x7f:
			index += 1
			continue
		if first >= 0xc2 and first <= 0xdf:
			if index + 1 >= bytes.size() or not _is_continuation(bytes[index + 1]):
				return false
			index += 2
			continue
		if first >= 0xe0 and first <= 0xef:
			if index + 2 >= bytes.size():
				return false
			var second: int = int(bytes[index + 1])
			if (
				(first == 0xe0 and (second < 0xa0 or second > 0xbf))
				or (first == 0xed and (second < 0x80 or second > 0x9f))
				or (
					first not in [0xe0, 0xed]
					and not _is_continuation(second)
				)
				or not _is_continuation(bytes[index + 2])
			):
				return false
			index += 3
			continue
		if first >= 0xf0 and first <= 0xf4:
			if index + 3 >= bytes.size():
				return false
			var second: int = int(bytes[index + 1])
			if (
				(first == 0xf0 and (second < 0x90 or second > 0xbf))
				or (first == 0xf4 and (second < 0x80 or second > 0x8f))
				or (
					first not in [0xf0, 0xf4]
					and not _is_continuation(second)
				)
				or not _is_continuation(bytes[index + 2])
				or not _is_continuation(bytes[index + 3])
			):
				return false
			index += 4
			continue
		return false
	return true


static func _is_continuation(value: int) -> bool:
	return value >= 0x80 and value <= 0xbf
