class_name BridgeResourceTypeGuard
extends RefCounted


const ASSIGNABLE_RESOURCE_FAMILIES: Array[String] = [
	"Texture2D",
	"Shape2D",
	"AudioStream",
	"Font",
	"Theme",
	"StyleBox",
	"PackedScene",
]
const CREATABLE_SUBRESOURCE_TYPES: Array[String] = [
	"RectangleShape2D",
	"CircleShape2D",
	"CapsuleShape2D",
	"SegmentShape2D",
	"StyleBoxFlat",
]


static func assignment_family_for_class(type_name: String) -> String:
	if type_name.is_empty() or not ClassDB.class_exists(type_name):
		return ""
	if not ClassDB.is_parent_class(type_name, "Resource"):
		return ""
	for family in ASSIGNABLE_RESOURCE_FAMILIES:
		if type_name == family or ClassDB.is_parent_class(type_name, family):
			return family
	return ""


static func is_script_class(type_name: String) -> bool:
	return (
		not type_name.is_empty()
		and ClassDB.class_exists(type_name)
		and (
			type_name == "Script"
			or ClassDB.is_parent_class(type_name, "Script")
		)
	)


static func is_project_global_script_class(type_name: String) -> bool:
	if type_name.is_empty():
		return false
	for raw_entry in ProjectSettings.get_global_class_list():
		if raw_entry is Dictionary and str(raw_entry.get("class", "")) == type_name:
			return true
	return false


static func text_resource_declares_script_class(resource_path: String) -> bool:
	if resource_path.get_extension().to_lower() != "tres":
		return false
	var file: FileAccess = FileAccess.open(resource_path, FileAccess.READ)
	if file == null:
		return false
	var header_size: int = mini(
		file.get_length(),
		BridgeConstants.MAX_RESOURCE_TEXT_HEADER_BYTES
	)
	var header: String = file.get_buffer(header_size).get_string_from_utf8()
	file.close()
	var first_line: String = header.get_slice("\n", 0).strip_edges()
	return (
		first_line.begins_with("[gd_resource ")
		and first_line.contains("script_class=")
	)


static func is_creatable_subresource_type(type_name: String) -> bool:
	return type_name in CREATABLE_SUBRESOURCE_TYPES


static func declared_resource_type(property_info: Dictionary) -> String:
	if int(property_info.get("type", TYPE_NIL)) != TYPE_OBJECT:
		return ""
	var declared_type: String = str(property_info.get("class_name", ""))
	if not declared_type.is_empty():
		return declared_type
	if int(property_info.get("hint", PROPERTY_HINT_NONE)) != PROPERTY_HINT_RESOURCE_TYPE:
		return ""
	var hint_string: String = str(property_info.get("hint_string", ""))
	if hint_string.contains(","):
		return ""
	return hint_string
