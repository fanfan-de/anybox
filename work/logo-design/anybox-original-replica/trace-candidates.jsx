(function () {
  var previousInteractionLevel = app.userInteractionLevel;
  var currentDocument = null;
  var sourcePath = "C:/Projects/Anybox/work/logo-design/anybox-original-replica/trace-source.png";
  var outputDirectory = "C:/Projects/Anybox/work/logo-design/anybox-original-replica/candidates/";
  var candidates = [
    { name: "a-precise-128", threshold: 128, path: 100, corner: 100, noise: 1 },
    { name: "b-balanced-128", threshold: 128, path: 85, corner: 80, noise: 1 },
    { name: "c-smooth-128", threshold: 128, path: 65, corner: 65, noise: 1 },
    { name: "d-precise-112", threshold: 112, path: 100, corner: 100, noise: 1 },
    { name: "e-precise-144", threshold: 144, path: 100, corner: 100, noise: 1 }
  ];

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

  function traceCandidate(candidate) {
    currentDocument = app.documents.add(DocumentColorSpace.RGB, 1024, 1024);
    currentDocument.layers[0].name = "Anybox Original Replica";

    var placedItem = currentDocument.placedItems.add();
    placedItem.file = new File(sourcePath);
    placedItem.width = 1024;
    placedItem.height = 1024;
    placedItem.position = [0, 1024];

    var pluginItem = placedItem.trace();
    app.redraw();
    $.sleep(1200);

    var tracing = pluginItem.tracing;
    var options = tracing.tracingOptions;
    options.tracingMode = TracingModeType.TRACINGMODEBLACKANDWHITE;
    options.threshold = candidate.threshold;
    options.pathFidelity = candidate.path;
    options.cornerFidelity = candidate.corner;
    options.noiseFidelity = candidate.noise;
    options.fills = true;
    options.strokes = false;
    options.ignoreWhite = true;
    options.snapCurveToLines = false;
    app.redraw();
    $.sleep(2200);

    var tracedPathCount = tracing.pathCount;
    var tracedAnchorCount = tracing.anchorCount;
    tracing.expandTracing();
    app.redraw();

    var white = rgb(255, 255, 255);
    for (var pathIndex = 0; pathIndex < currentDocument.pathItems.length; pathIndex += 1) {
      var pathItem = currentDocument.pathItems[pathIndex];
      if (!pathItem.guides && !pathItem.clipping) {
        pathItem.filled = true;
        pathItem.fillColor = white;
        pathItem.stroked = false;
      }
    }

    var outputBase = outputDirectory + candidate.name;
    var svgOptions = new ExportOptionsSVG();
    svgOptions.compressed = false;
    svgOptions.coordinatePrecision = 4;
    svgOptions.embedRasterImages = false;
    svgOptions.includeFileInfo = false;
    svgOptions.includeUnusedStyles = false;
    svgOptions.includeVariablesAndDatasets = false;
    svgOptions.optimizeForSVGViewer = false;
    svgOptions.preserveEditability = false;
    svgOptions.saveMultipleArtboards = false;
    currentDocument.exportFile(new File(outputBase), ExportType.SVG, svgOptions);

    var pngOptions = new ExportOptionsPNG24();
    pngOptions.antiAliasing = true;
    pngOptions.artBoardClipping = true;
    pngOptions.horizontalScale = 100;
    pngOptions.verticalScale = 100;
    pngOptions.transparency = true;
    currentDocument.exportFile(new File(outputBase), ExportType.PNG24, pngOptions);

    var result = {
      name: candidate.name,
      paths: currentDocument.pathItems.length,
      compoundPaths: currentDocument.compoundPathItems.length,
      groups: currentDocument.groupItems.length,
      tracedPaths: tracedPathCount,
      tracedAnchors: tracedAnchorCount,
      svgBytes: new File(outputBase + ".svg").length,
      pngBytes: new File(outputBase + ".png").length
    };

    currentDocument.close(SaveOptions.DONOTSAVECHANGES);
    currentDocument = null;
    return result;
  }

  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    var resultParts = [];
    for (var index = 0; index < candidates.length; index += 1) {
      var result = traceCandidate(candidates[index]);
      resultParts.push("{" +
        '"name":' + quote(result.name) + ',' +
        '"paths":' + result.paths + ',' +
        '"compoundPaths":' + result.compoundPaths + ',' +
        '"groups":' + result.groups + ',' +
        '"tracedPaths":' + result.tracedPaths + ',' +
        '"tracedAnchors":' + result.tracedAnchors + ',' +
        '"svgBytes":' + result.svgBytes + ',' +
        '"pngBytes":' + result.pngBytes +
        "}");
    }
    return "{" +
      '"ok":true,' +
      '"candidates":[' + resultParts.join(",") + "]" +
      "}";
  } catch (error) {
    if (currentDocument !== null) {
      try {
        currentDocument.close(SaveOptions.DONOTSAVECHANGES);
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
