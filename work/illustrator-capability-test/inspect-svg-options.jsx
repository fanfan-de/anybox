(function () {
  var options = new ExportOptionsSVG();
  var properties = options.reflect.properties;
  var names = [];
  for (var index = 0; index < properties.length; index += 1) {
    names.push(properties[index].name);
  }
  names.sort();
  return names.join("\n");
}());
