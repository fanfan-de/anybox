(function () {
  var testDocument = null;
  var previousInteractionLevel = app.userInteractionLevel;
  var outputDirectory = "C:/Projects/Anybox/work/logo-design/anybox-original-replica/candidates/";

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

  function isWhite(pathItem) {
    if (!pathItem.filled) return false;
    var color = pathItem.fillColor;
    if (color.typename === "RGBColor") {
      return color.red > 200 && color.green > 200 && color.blue > 200;
    }
    if (color.typename === "GrayColor") {
      return color.gray < 20;
    }
    if (color.typename === "CMYKColor") {
      return color.cyan < 20 && color.magenta < 20 && color.yellow < 20 && color.black < 20;
    }
    return false;
  }

  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    testDocument = app.documents.add(DocumentColorSpace.RGB, 1024, 1024);
    testDocument.layers[0].name = "Anybox Original Replica";

    var placedItem = testDocument.placedItems.add();
    placedItem.file = new File("C:/Projects/Anybox/work/logo-design/anybox-original-replica/trace-source.png");
    placedItem.width = 1024;
    placedItem.height = 1024;
    placedItem.position = [0, 1024];

    var pluginItem = placedItem.trace();
    app.redraw();
    $.sleep(1200);

    var tracing = pluginItem.tracing;
    var tracingOptions = tracing.tracingOptions;
    tracingOptions.tracingMode = TracingModeType.TRACINGMODEBLACKANDWHITE;
    tracingOptions.threshold = 128;
    tracingOptions.pathFidelity = 85;
    tracingOptions.cornerFidelity = 80;
    tracingOptions.noiseFidelity = 1;
    tracingOptions.fills = true;
    tracingOptions.strokes = false;
    tracingOptions.ignoreWhite = false;
    tracingOptions.snapCurveToLines = false;
    app.redraw();
    $.sleep(2200);

    tracing.expandTracing();
    app.redraw();
    exportSvg(testDocument, outputDirectory + "debug-expanded-original-colors");

    var whitePaths = 0;
    var darkPaths = 0;
    var white = rgb(255, 255, 255);
    for (var pathIndex = testDocument.pathItems.length - 1; pathIndex >= 0; pathIndex -= 1) {
      var pathItem = testDocument.pathItems[pathIndex];
      if (pathItem.guides) continue;
      if (isWhite(pathItem)) {
        whitePaths += 1;
        pathItem.remove();
      } else {
        darkPaths += 1;
        pathItem.filled = true;
        pathItem.fillColor = white;
        pathItem.stroked = false;
      }
    }

    exportSvg(testDocument, outputDirectory + "f-filtered-128");
    exportPng(testDocument, outputDirectory + "f-filtered-128");
    var result = "{" +
      '"ok":true,' +
      '"whitePathsRemoved":' + whitePaths + ',' +
      '"darkPathsKept":' + darkPaths + ',' +
      '"remainingPaths":' + testDocument.pathItems.length + ',' +
      '"compoundPaths":' + testDocument.compoundPathItems.length + ',' +
      '"svgBytes":' + new File(outputDirectory + "f-filtered-128.svg").length +
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
