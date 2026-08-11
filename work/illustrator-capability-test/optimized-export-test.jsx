(function () {
  var testDocument = null;
  var previousInteractionLevel = app.userInteractionLevel;
  var outputBase = "C:/Projects/Anybox/tmp/illustrator-capability-test/illustrator-capability-test-optimized";

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

  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    testDocument = app.documents.add(DocumentColorSpace.RGB, 512, 512);
    var layer = testDocument.layers[0];
    layer.name = "Codex Optimized Export Test";

    var background = layer.pathItems.roundedRectangle(480, 32, 448, 448, 56, 56);
    background.filled = true;
    background.fillColor = rgb(21, 32, 27);
    background.stroked = false;

    var orbit = layer.pathItems.ellipse(400, 112, 288, 288);
    orbit.filled = false;
    orbit.stroked = true;
    orbit.strokeColor = rgb(118, 184, 173);
    orbit.strokeWidth = 12;

    var diamond = layer.pathItems.add();
    diamond.setEntirePath([[256, 388], [354, 256], [256, 124], [158, 256]]);
    diamond.closed = true;
    diamond.filled = true;
    diamond.fillColor = rgb(47, 111, 104);
    diamond.stroked = true;
    diamond.strokeColor = rgb(244, 247, 244);
    diamond.strokeWidth = 6;
    diamond.opacity = 92;

    var core = layer.pathItems.ellipse(302, 210, 92, 92);
    core.filled = true;
    core.fillColor = rgb(199, 110, 47);
    core.stroked = false;

    var label = layer.textFrames.add();
    label.contents = "VECTOR BRIDGE OK";
    label.position = [154, 76];
    label.textRange.characterAttributes.size = 20;
    label.textRange.characterAttributes.fillColor = rgb(244, 247, 244);
    var textFramesBeforeOutline = layer.textFrames.length;
    label.createOutline();

    var svgOptions = new ExportOptionsSVG();
    svgOptions.compressed = false;
    svgOptions.coordinatePrecision = 3;
    svgOptions.embedRasterImages = false;
    svgOptions.includeFileInfo = false;
    svgOptions.includeUnusedStyles = false;
    svgOptions.includeVariablesAndDatasets = false;
    svgOptions.optimizeForSVGViewer = false;
    svgOptions.preserveEditability = false;
    svgOptions.saveMultipleArtboards = false;
    testDocument.exportFile(new File(outputBase), ExportType.SVG, svgOptions);

    var svgFile = new File(outputBase + ".svg");
    var summary = "{" +
      '"ok":true,' +
      '"textFramesBeforeOutline":' + textFramesBeforeOutline + ',' +
      '"textFramesAfterOutline":' + layer.textFrames.length + ',' +
      '"pathItemsAfterOutline":' + layer.pathItems.length + ',' +
      '"pageItemsAfterOutline":' + layer.pageItems.length + ',' +
      '"svgExists":' + (svgFile.exists ? "true" : "false") + ',' +
      '"svgBytes":' + (svgFile.exists ? svgFile.length : 0) +
      "}";

    testDocument.close(SaveOptions.DONOTSAVECHANGES);
    testDocument = null;
    return summary;
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
