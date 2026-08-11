(function () {
  var workingDocument = null;
  var previousInteractionLevel = app.userInteractionLevel;
  var documentsBefore = app.documents.length;

  function rgb(red, green, blue) {
    var color = new RGBColor();
    color.red = red;
    color.green = green;
    color.blue = blue;
    return color;
  }

  function quote(value) {
    return '"' + String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n") + '"';
  }

  function anchorCount(compoundPath) {
    var count = 0;
    for (var index = 0; index < compoundPath.pathItems.length; index += 1) {
      count += compoundPath.pathItems[index].pathPoints.length;
    }
    return count;
  }

  function setPolygon(pathItem, points) {
    pathItem.setEntirePath(points);
    pathItem.closed = true;
    pathItem.filled = true;
    pathItem.stroked = false;
    for (var pointIndex = 0; pointIndex < pathItem.pathPoints.length; pointIndex += 1) {
      var point = pathItem.pathPoints[pointIndex];
      point.pointType = PointType.CORNER;
      point.leftDirection = point.anchor;
      point.rightDirection = point.anchor;
    }
  }

  function colorCompoundPath(compoundPath, color) {
    for (var index = 0; index < compoundPath.pathItems.length; index += 1) {
      compoundPath.pathItems[index].filled = true;
      compoundPath.pathItems[index].fillColor = color;
      compoundPath.pathItems[index].stroked = false;
    }
  }

  function exportSvg(document, outputBase) {
    var options = new ExportOptionsSVG();
    options.compressed = false;
    options.coordinatePrecision = 4;
    options.embedRasterImages = false;
    options.includeFileInfo = false;
    options.includeUnusedStyles = false;
    options.includeVariablesAndDatasets = false;
    options.optimizeForSVGViewer = false;
    options.preserveEditability = false;
    options.saveMultipleArtboards = false;
    document.exportFile(new File(outputBase), ExportType.SVG, options);
  }

  function exportPng(document, outputBase) {
    var options = new ExportOptionsPNG24();
    options.antiAliasing = true;
    options.artBoardClipping = true;
    options.horizontalScale = 100;
    options.verticalScale = 100;
    options.transparency = true;
    document.exportFile(new File(outputBase), ExportType.PNG24, options);
  }

  function saveAi(document, outputPath) {
    var options = new IllustratorSaveOptions();
    options.compressed = true;
    options.embedICCProfile = false;
    options.pdfCompatible = true;
    document.saveAs(new File(outputPath), options);
  }

  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    workingDocument = app.open(new File("C:/Projects/Anybox/outputs/anybox-original-replica-brand/anybox-original-logo-white.svg"));
    workingDocument.layers[0].name = "Anybox Clean Geometry";
    var compoundPath = workingDocument.compoundPathItems[0];
    var anchorsBefore = anchorCount(compoundPath);
    var boxAnchorsBefore =
      compoundPath.pathItems[4].pathPoints.length +
      compoundPath.pathItems[5].pathPoints.length +
      compoundPath.pathItems[7].pathPoints.length +
      compoundPath.pathItems[8].pathPoints.length +
      compoundPath.pathItems[9].pathPoints.length;

    // Rear-right flap: four structural corners, all straight segments.
    setPolygon(compoundPath.pathItems[4], [
      [734.02, 617.98],
      [816.99, 584.5],
      [737, 558.43],
      [703, 573.51]
    ]);

    // Rear-left flap: four structural corners, all straight segments.
    setPolygon(compoundPath.pathItems[5], [
      [386.9, 602.11],
      [278.75, 560.25],
      [209.01, 584.5],
      [359.55, 647.99]
    ]);

    // Front-left flap: replace traced edge samples with a quadrilateral.
    setPolygon(compoundPath.pathItems[7], [
      [203.02, 463.03],
      [285.48, 551.01],
      [502.98, 441.51],
      [419.67, 357.12]
    ]);

    // Front-right flap: replace traced edge samples with a quadrilateral.
    setPolygon(compoundPath.pathItems[8], [
      [737.67, 552.88],
      [820.96, 464.59],
      [601.99, 356.5],
      [520.08, 440.5]
    ]);

    // Lower box: retain every actual corner while removing collinear samples.
    setPolygon(compoundPath.pathItems[9], [
      [289, 397.5],
      [424.34, 333.17],
      [512, 418.99],
      [512, 209.5],
      [720.84, 314.66],
      [720.95, 381.55],
      [740, 398.5],
      [740, 303.5],
      [512.54, 187.96],
      [289, 304.5]
    ]);

    var anchorsAfter = anchorCount(compoundPath);
    var boxAnchorsAfter =
      compoundPath.pathItems[4].pathPoints.length +
      compoundPath.pathItems[5].pathPoints.length +
      compoundPath.pathItems[7].pathPoints.length +
      compoundPath.pathItems[8].pathPoints.length +
      compoundPath.pathItems[9].pathPoints.length;

    var outputDirectory = "C:/Projects/Anybox/outputs/anybox-original-replica-brand/";
    var whiteBase = outputDirectory + "anybox-original-logo-clean-white";
    var blackBase = outputDirectory + "anybox-original-logo-clean-black";
    var white = rgb(255, 255, 255);
    var black = rgb(0, 0, 0);

    colorCompoundPath(compoundPath, white);
    saveAi(workingDocument, whiteBase + ".ai");
    exportSvg(workingDocument, whiteBase);
    exportPng(workingDocument, whiteBase + "-1024");

    colorCompoundPath(compoundPath, black);
    saveAi(workingDocument, outputDirectory + "anybox-original-logo-clean.ai");
    exportSvg(workingDocument, blackBase);
    exportPng(workingDocument, blackBase + "-1024");

    var result = "{" +
      '"ok":true,' +
      '"anchorsBefore":' + anchorsBefore + ',' +
      '"anchorsAfter":' + anchorsAfter + ',' +
      '"boxAnchorsBefore":' + boxAnchorsBefore + ',' +
      '"boxAnchorsAfter":' + boxAnchorsAfter + ',' +
      '"subpaths":' + compoundPath.pathItems.length + ',' +
      '"compoundPaths":' + workingDocument.compoundPathItems.length + ',' +
      '"placedItems":' + workingDocument.placedItems.length + ',' +
      '"rasterItems":' + workingDocument.rasterItems.length + ',' +
      '"documentsBefore":' + documentsBefore +
      "}";

    workingDocument.close(SaveOptions.DONOTSAVECHANGES);
    workingDocument = null;
    return result;
  } catch (error) {
    if (workingDocument !== null) {
      try {
        workingDocument.close(SaveOptions.DONOTSAVECHANGES);
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
