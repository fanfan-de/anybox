function XDownExtension()
{
    this.nhManager = new XDownNativeHostManager;
    this.nhManager.onReady = this.onNativeHostReady.bind(this);
    this.nhManager.onNativeHostNotFound = this.onNativeHostNotFound.bind(this);
    this.nhManager.onGotSettings = this.onGotSettings.bind(this);
}

XDownExtension.prototype.initialize = function()
{
    this.nhManager.initialize();
};

XDownExtension.prototype.onNativeHostReady = function()
{
};

XDownExtension.prototype.onShowSetting = function() {
    this.nhManager.postMessage(
        new XDownShowSettingsTask,
    this.onGotSettings.bind(this));
}

XDownExtension.prototype.postMessage = function(taskMsg, callback) {
    this.nhManager.postMessage(taskMsg, callback);
}

XDownExtension.prototype.onGotSettings = function(resp)
{
    console.log("==onGotSettings==",resp);
};

XDownExtension.prototype.onNativeHostNotFound = function()
{
};

XDownExtension.prototype.onInitialInstall = function()
{
    this.nhManager.restartIfNeeded();
};

