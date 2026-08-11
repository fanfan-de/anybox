(function () {
  var inspectedDocument = null;
  var previousInteractionLevel = app.userInteractionLevel;

  function number(value) {
    return Math.round(value * 100) / 100;
  }

  function point(value) {
    return "[" + number(value[0]) + "," + number(value[1]) + "]";
  }

  function quote(value) {
    return '"' + String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n") + '"';
  }

  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    inspectedDocument = app.open(new File("C:/Projects/Anybox/outputs/anybox-original-replica-brand/anybox-original-logo-white.svg"));
    var compoundPath = inspectedDocument.compoundPathItems[0];
    var paths = [];
    var totalAnchors = 0;

    for (var pathIndex = 0; pathIndex < compoundPath.pathItems.length; pathIndex += 1) {
      var pathItem = compoundPath.pathItems[pathIndex];
      var anchors = [];
      for (var pointIndex = 0; pointIndex < pathItem.pathPoints.length; pointIndex += 1) {
        anchors.push(point(pathItem.pathPoints[pointIndex].anchor));
      }
      totalAnchors += pathItem.pathPoints.length;
      var bounds = pathItem.geometricBounds;
      paths.push("{" +
        '"index":' + pathIndex + ',' +
        '"closed":' + (pathItem.closed ? "true" : "false") + ',' +
        '"anchors":' + pathItem.pathPoints.length + ',' +
        '"area":' + number(Math.abs(pathItem.area)) + ',' +
        '"bounds":[' + number(bounds[0]) + ',' + number(bounds[1]) + ',' + number(bounds[2]) + ',' + number(bounds[3]) + '],' +
        '"points":[' + anchors.join(",") + "]" +
        "}");
    }

    var result = "{" +
      '"ok":true,' +
      '"compoundPaths":' + inspectedDocument.compoundPathItems.length + ',' +
      '"subpaths":' + compoundPath.pathItems.length + ',' +
      '"totalAnchors":' + totalAnchors + ',' +
      '"paths":[' + paths.join(",") + "]" +
      "}";

    inspectedDocument.close(SaveOptions.DONOTSAVECHANGES);
    inspectedDocument = null;
    return result;
  } catch (error) {
    if (inspectedDocument !== null) {
      try {
        inspectedDocument.close(SaveOptions.DONOTSAVECHANGES);
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
