(function () {
  var testDocument = null;
  var previousInteractionLevel = app.userInteractionLevel;

  function quote(value) {
    return '"' + String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n") + '"';
  }

  function inspect(object) {
    var result = [];
    for (var key in object) {
      try {
        var value = object[key];
        var type = typeof value;
        if (type !== "function") {
          result.push({ key: key, type: type, value: String(value) });
        }
      } catch (error) {
        result.push({ key: key, type: "error", value: String(error) });
      }
    }
    return result;
  }

  function stringifyList(items) {
    var parts = [];
    for (var index = 0; index < items.length; index += 1) {
      parts.push("{" +
        '"key":' + quote(items[index].key) + ',' +
        '"type":' + quote(items[index].type) + ',' +
        '"value":' + quote(items[index].value) +
        "}");
    }
    return "[" + parts.join(",") + "]";
  }

  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    testDocument = app.documents.add(DocumentColorSpace.RGB, 1024, 1024);
    var placedItem = testDocument.placedItems.add();
    placedItem.file = new File("C:/Projects/Anybox/work/logo-design/anybox-original-replica/trace-source.png");
    placedItem.position = [0, 1024];
    var pluginItem = placedItem.trace();
    app.redraw();
    $.sleep(2500);

    var tracing = pluginItem.tracing;
    var options = tracing.tracingOptions;
    var result = "{" +
      '"ok":true,' +
      '"pluginType":' + quote(pluginItem.typename) + ',' +
      '"tracing":' + stringifyList(inspect(tracing)) + ',' +
      '"options":' + stringifyList(inspect(options)) +
      "}";

    testDocument.close(SaveOptions.DONOTSAVECHANGES);
    testDocument = null;
    return result;
  } catch (error) {
    if (testDocument !== null) {
      try {
        testDocument.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeError) {}
    }
    return "{" +
      '"ok":false,' +
      '"message":' + quote(error) + ',' +
      '"line":' + (error.line || 0) +
      "}";
  } finally {
    app.userInteractionLevel = previousInteractionLevel;
  }
}());
