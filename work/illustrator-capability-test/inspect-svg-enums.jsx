(function () {
  function describe(name, value) {
    var output = ["[" + name + "]"];
    var properties = value.reflect.properties;
    for (var index = 0; index < properties.length; index += 1) {
      var propertyName = properties[index].name;
      if (propertyName === "__proto__") continue;
      try {
        output.push(propertyName + "=" + value[propertyName]);
      } catch (error) {
        output.push(propertyName + "=<unreadable>");
      }
    }
    return output.join("\n");
  }

  return [
    describe("SVGFontSubsetting", SVGFontSubsetting),
    describe("SVGFontType", SVGFontType),
    describe("SVGCSSPropertyLocation", SVGCSSPropertyLocation),
    describe("SVGDocumentEncoding", SVGDocumentEncoding)
  ].join("\n\n");
}());
