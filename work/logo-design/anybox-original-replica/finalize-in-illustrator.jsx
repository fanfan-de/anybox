(function () {
  var importedDocument = null;
  var previousInteractionLevel = app.userInteractionLevel;
  var originalDocumentName = app.documents.length > 0 ? app.activeDocument.name : "";
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
    var svgFile = new File("C:/Projects/Anybox/outputs/anybox-original-replica-brand/anybox-original-logo-white.svg");
    var aiFile = new File("C:/Projects/Anybox/outputs/anybox-original-replica-brand/anybox-original-logo-white.ai");
    if (!svgFile.exists) throw new Error("Final SVG does not exist");

    importedDocument = app.open(svgFile);
    importedDocument.layers[0].name = "Anybox Original Box Cat";

    var width = importedDocument.width;
    var height = importedDocument.height;
    var layers = importedDocument.layers.length;
    var artboards = importedDocument.artboards.length;
    var pageItems = importedDocument.pageItems.length;
    var pathItems = importedDocument.pathItems.length;
    var compoundPaths = importedDocument.compoundPathItems.length;
    var placedItems = importedDocument.placedItems.length;
    var rasterItems = importedDocument.rasterItems.length;

    var saveOptions = new IllustratorSaveOptions();
    saveOptions.compressed = true;
    saveOptions.embedICCProfile = false;
    saveOptions.pdfCompatible = true;
    importedDocument.saveAs(aiFile, saveOptions);
    importedDocument.close(SaveOptions.DONOTSAVECHANGES);
    importedDocument = null;

    return "{" +
      '"ok":true,' +
      '"width":' + width + ',' +
      '"height":' + height + ',' +
      '"layers":' + layers + ',' +
      '"artboards":' + artboards + ',' +
      '"pageItems":' + pageItems + ',' +
      '"pathItems":' + pathItems + ',' +
      '"compoundPaths":' + compoundPaths + ',' +
      '"placedItems":' + placedItems + ',' +
      '"rasterItems":' + rasterItems + ',' +
      '"aiExists":' + (aiFile.exists ? "true" : "false") + ',' +
      '"aiBytes":' + (aiFile.exists ? aiFile.length : 0) + ',' +
      '"documentsBefore":' + documentsBefore + ',' +
      '"documentsAfter":' + app.documents.length + ',' +
      '"originalDocumentName":' + quote(originalDocumentName) + ',' +
      '"activeDocumentAfter":' + quote(app.documents.length > 0 ? app.activeDocument.name : "") +
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
