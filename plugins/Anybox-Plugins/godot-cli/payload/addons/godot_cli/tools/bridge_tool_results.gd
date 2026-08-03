class_name BridgeToolResults
extends RefCounted


static func success(data: Dictionary) -> Dictionary:
	return {
		"ok": true,
		"data": data,
	}


static func failure(
	code: String,
	message: String,
	retryable: bool = false
) -> Dictionary:
	return {
		"ok": false,
		"error": {
			"code": code,
			"message": message,
			"retryable": retryable,
		},
	}
