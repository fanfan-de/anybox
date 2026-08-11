(function () {
  var verifiedDocument = null;
  var previousInteractionLevel = app.userInteractionLevel;
  var documentsBefore = app.documents.length;

  function quote(value) {
    return '"' + String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n") + '"';
  }

  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    verifiedDocument = app.open(new File("C:/Projects/Anybox/outputs/anybox-original-replica-brand/anybox-original-logo-clean.ai"));
    var compoundPath = verifiedDocument.compoundPathItems[0];
    var anchors = 0;
    var boxAnchors = 0;
    for (var index = 0; index < compoundPath.pathItems.length; index += 1) {
      anchors += compoundPath.pathItems[index].pathPoints.length;
    }
    var boxIndexes = [4, 5, 7, 8, 9];
    for (var boxIndex = 0; boxIndex < boxIndexes.length; boxIndex += 1) {
      boxAnchors += compoundPath.pathItems[boxIndexes[boxIndex]].pathPoints.length;
    }

    var result = "{" +
      '"ok":true,' +
      '"documentName":' + quote(verifiedDocument.name) + ',' +
      '"width":' + verifiedDocument.width + ',' +
      '"height":' + verifiedDocument.height + ',' +
      '"compoundPaths":' + verifiedDocument.compoundPathItems.length + ',' +
      '"subpaths":' + compoundPath.pathItems.length + ',' +
      '"anchors":' + anchors + ',' +
      '"boxAnchors":' + boxAnchors + ',' +
      '"placedItems":' + verifiedDocument.placedItems.length + ',' +
      '"rasterItems":' + verifiedDocument.rasterItems.length + ',' +
      '"documentsBefore":' + documentsBefore +
      "}";

    verifiedDocument.close(SaveOptions.DONOTSAVECHANGES);
    verifiedDocument = null;
    return result;
  } catch (error) {
    if (verifiedDocument !== null) {
      try {
        verifiedDocument.close(SaveOptions.DONOTSAVECHANGES);
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
