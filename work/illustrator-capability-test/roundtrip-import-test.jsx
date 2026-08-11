(function () {
  var importedDocument = null;
  var previousInteractionLevel = app.userInteractionLevel;
  var originalDocument = app.documents.length > 0 ? app.activeDocument : null;
  var originalName = originalDocument ? originalDocument.name : "";
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
    var svgFile = new File("C:/Projects/Anybox/tmp/illustrator-capability-test/illustrator-capability-test-optimized.svg");
    if (!svgFile.exists) {
      throw new Error("Optimized SVG does not exist");
    }

    importedDocument = app.open(svgFile);
    var importedName = importedDocument.name;
    var importedWidth = importedDocument.width;
    var importedHeight = importedDocument.height;
    var importedLayers = importedDocument.layers.length;
    var importedArtboards = importedDocument.artboards.length;
    var importedPageItems = importedDocument.pageItems.length;
    var importedPathItems = importedDocument.pathItems.length;

    importedDocument.close(SaveOptions.DONOTSAVECHANGES);
    importedDocument = null;

    var originalStillOpen = false;
    for (var index = 0; index < app.documents.length; index += 1) {
      if (app.documents[index].name === originalName) {
        originalStillOpen = true;
        break;
      }
    }

    return "{" +
      '"ok":true,' +
      '"documentsBefore":' + documentsBefore + ',' +
      '"documentsAfter":' + app.documents.length + ',' +
      '"originalName":' + quote(originalName) + ',' +
      '"originalStillOpen":' + (originalStillOpen ? "true" : "false") + ',' +
      '"activeDocumentAfter":' + quote(app.documents.length > 0 ? app.activeDocument.name : "") + ',' +
      '"importedName":' + quote(importedName) + ',' +
      '"importedWidth":' + importedWidth + ',' +
      '"importedHeight":' + importedHeight + ',' +
      '"importedLayers":' + importedLayers + ',' +
      '"importedArtboards":' + importedArtboards + ',' +
      '"importedPageItems":' + importedPageItems + ',' +
      '"importedPathItems":' + importedPathItems +
      "}";
  } catch (error) {
    if (importedDocument !== null) {
      try {
        importedDocument.close(SaveOptions.DONOTSAVECHANGES);
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
