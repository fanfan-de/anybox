const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins")

function enableLanCleartextTraffic(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest)
  application.$["android:usesCleartextTraffic"] = "true"
  return androidManifest
}

module.exports = function withAndroidLanCleartext(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = enableLanCleartextTraffic(manifestConfig.modResults)
    return manifestConfig
  })
}

module.exports.enableLanCleartextTraffic = enableLanCleartextTraffic
