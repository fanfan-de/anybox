package com.anybox.mobile.updater

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.system.ErrnoException
import android.system.Os
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

class AnyboxAndroidUpdaterModule : Module() {
  companion object {
    private const val MAX_APK_BYTES = 500L * 1024L * 1024L
    private const val MAX_REDIRECTS = 5
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val STALE_DOWNLOAD_AGE_MS = 7L * 24L * 60L * 60L * 1000L
    private const val UPDATE_CERTIFICATE_METADATA = "expo.modules.updates.CODE_SIGNING_CERTIFICATE"
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val updateDirectory: File
    get() = File(context.cacheDir, "anybox-updates")

  @Volatile
  private var activeConnection: HttpURLConnection? = null

  private val downloadCancelled = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("AnyboxAndroidUpdater")
    Events("onDownloadProgress")

    AsyncFunction("downloadApk") Coroutine { options: DownloadApkOptions ->
      withContext(Dispatchers.IO) {
        downloadAndVerify(options)
      }
    }

    AsyncFunction("cancelDownload") {
      downloadCancelled.set(true)
      activeConnection?.disconnect()
    }

    AsyncFunction("canRequestPackageInstalls") {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
    }

    AsyncFunction("openInstallPermissionSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val intent = Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }

    AsyncFunction("installApk") { fileUri: String ->
      val file = requireVerifiedApk(fileUri)
      val contentUri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.anybox-updater.files",
        file
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      context.startActivity(intent)
    }

    AsyncFunction("verifyDetachedSignature") { payload: String, signature: String ->
      verifyDetachedSignature(payload, signature)
    }

    AsyncFunction("clearStaleDownloads") {
      clearStaleDownloadFiles()
    }
  }

  @Synchronized
  private fun downloadAndVerify(options: DownloadApkOptions): Map<String, Any> {
    validateDownloadOptions(options)
    updateDirectory.mkdirs()
    clearPartialDownloads()
    downloadCancelled.set(false)

    val safeName = sanitizeFileName(options.fileName ?: "anybox-mobile-${options.expectedVersionCode}.apk")
    val partialFile = File(updateDirectory, "$safeName.part")
    val finalFile = File(updateDirectory, safeName)
    partialFile.delete()

    try {
      val digest = MessageDigest.getInstance("SHA-256")
      val result = openDownload(options.url)
      activeConnection = result.connection
      val declaredLength = result.connection.contentLengthLong
      if (declaredLength > MAX_APK_BYTES) {
        throw IllegalArgumentException("APK exceeds the 500 MB safety limit.")
      }
      if (declaredLength > 0 && declaredLength != options.expectedSizeBytes) {
        throw IllegalArgumentException("APK Content-Length does not match the signed release manifest.")
      }

      var downloadedBytes = 0L
      var lastProgressAt = 0L
      result.connection.inputStream.use { input ->
        FileOutputStream(partialFile).use { output ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE * 4)
          while (true) {
            if (downloadCancelled.get()) throw DownloadCancelledException()
            val count = input.read(buffer)
            if (count < 0) break
            downloadedBytes += count
            if (downloadedBytes > MAX_APK_BYTES || downloadedBytes > options.expectedSizeBytes) {
              throw IllegalArgumentException("Downloaded APK is larger than the signed release manifest.")
            }
            output.write(buffer, 0, count)
            digest.update(buffer, 0, count)

            val now = System.currentTimeMillis()
            if (now - lastProgressAt >= 200L || downloadedBytes == options.expectedSizeBytes) {
              sendProgress(downloadedBytes, options.expectedSizeBytes)
              lastProgressAt = now
            }
          }
          output.fd.sync()
        }
      }

      if (downloadedBytes != options.expectedSizeBytes) {
        throw IllegalArgumentException("Downloaded APK size does not match the signed release manifest.")
      }
      val sha256 = digest.digest().toHex()
      if (!sha256.equals(options.expectedSha256, ignoreCase = true)) {
        throw SecurityException("Downloaded APK SHA-256 does not match the signed release manifest.")
      }

      val archive = getArchivePackageInfo(partialFile)
        ?: throw IllegalArgumentException("Downloaded file is not a valid Android APK.")
      if (archive.packageName != options.expectedPackageName || archive.packageName != context.packageName) {
        throw SecurityException("Downloaded APK package name is not ${context.packageName}.")
      }
      if (archive.longVersionCodeCompat() != options.expectedVersionCode) {
        throw SecurityException("Downloaded APK versionCode does not match the signed release manifest.")
      }

      val archiveSigners = signerDigests(archive)
      val installedSigners = signerDigests(getInstalledPackageInfo())
      if (archiveSigners.isEmpty() || installedSigners.intersect(archiveSigners).isEmpty()) {
        throw SecurityException("Downloaded APK is not signed by the installed Anybox signing key.")
      }

      try {
        Os.rename(partialFile.absolutePath, finalFile.absolutePath)
      } catch (error: ErrnoException) {
        throw IllegalStateException("Unable to atomically publish the verified APK.", error)
      }
      sendProgress(downloadedBytes, options.expectedSizeBytes)

      return mapOf(
        "fileUri" to Uri.fromFile(finalFile).toString(),
        "sizeBytes" to downloadedBytes,
        "sha256" to sha256,
        "packageName" to archive.packageName,
        "versionCode" to archive.longVersionCodeCompat(),
        "signerSha256" to archiveSigners.sorted().first()
      )
    } catch (error: Throwable) {
      partialFile.delete()
      throw error
    } finally {
      activeConnection?.disconnect()
      activeConnection = null
      downloadCancelled.set(false)
    }
  }

  private fun validateDownloadOptions(options: DownloadApkOptions) {
    val uri = URI(options.url)
    requireAllowedHttpsUri(uri)
    if (!options.expectedSha256.matches(Regex("^[a-fA-F0-9]{64}$"))) {
      throw IllegalArgumentException("Expected APK SHA-256 must contain 64 hexadecimal characters.")
    }
    if (options.expectedSizeBytes <= 0L || options.expectedSizeBytes > MAX_APK_BYTES) {
      throw IllegalArgumentException("Expected APK size must be between 1 byte and 500 MB.")
    }
    if (options.expectedVersionCode <= 0L) {
      throw IllegalArgumentException("Expected APK versionCode must be positive.")
    }
    if (options.expectedPackageName != context.packageName) {
      throw IllegalArgumentException("Expected package name must match the installed application.")
    }
  }

  private fun openDownload(initialUrl: String): DownloadConnection {
    var current = URI(initialUrl)
    repeat(MAX_REDIRECTS + 1) { redirectCount ->
      requireAllowedHttpsUri(current)
      val connection = URL(current.toString()).openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.requestMethod = "GET"
      connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream")
      connection.setRequestProperty("Accept-Encoding", "identity")
      connection.setRequestProperty("User-Agent", "Anybox-Mobile-Updater/1")
      connection.connect()

      if (connection.responseCode in 300..399) {
        val location = connection.getHeaderField("Location")
          ?: throw IllegalStateException("APK redirect is missing a Location header.")
        connection.disconnect()
        if (redirectCount >= MAX_REDIRECTS) {
          throw IllegalStateException("APK download exceeded the five redirect safety limit.")
        }
        current = current.resolve(location)
      } else {
        if (connection.responseCode !in 200..299) {
          val status = connection.responseCode
          connection.disconnect()
          throw IllegalStateException("APK download failed with HTTP $status.")
        }
        return DownloadConnection(connection, current)
      }
    }
    throw IllegalStateException("Unable to open APK download.")
  }

  private fun requireAllowedHttpsUri(uri: URI) {
    if (!uri.scheme.equals("https", ignoreCase = true)) {
      throw SecurityException("APK downloads must use HTTPS.")
    }
    val host = uri.host?.lowercase(Locale.US)
      ?: throw SecurityException("APK download URL is missing a host.")
    val allowed = host == "download.anybox.com.cn" ||
      host == "github.com" ||
      host == "github-releases.githubusercontent.com" ||
      host == "objects.githubusercontent.com" ||
      host == "release-assets.githubusercontent.com"
    if (!allowed) {
      throw SecurityException("APK download host is not allowed: $host")
    }
    if (!uri.userInfo.isNullOrEmpty()) {
      throw SecurityException("APK download URLs cannot contain user credentials.")
    }
    if (uri.port != -1 && uri.port != 443) {
      throw SecurityException("APK download URLs must use the default HTTPS port.")
    }
  }

  private fun sendProgress(downloadedBytes: Long, totalBytes: Long) {
    val percent = if (totalBytes <= 0L) 0.0 else (downloadedBytes.toDouble() / totalBytes.toDouble() * 100.0)
      .coerceIn(0.0, 100.0)
    sendEvent(
      "onDownloadProgress",
      mapOf(
        "downloadedBytes" to downloadedBytes,
        "totalBytes" to totalBytes,
        "percent" to percent
      )
    )
  }

  private fun verifyDetachedSignature(payload: String, encodedSignature: String): Boolean {
    return try {
      val certificate = loadUpdateCertificate()
      val verifier = Signature.getInstance("SHA256withRSA")
      verifier.initVerify(certificate.publicKey)
      verifier.update(payload.toByteArray(Charsets.UTF_8))
      verifier.verify(Base64.getDecoder().decode(encodedSignature.trim()))
    } catch (_: Throwable) {
      false
    }
  }

  private fun loadUpdateCertificate(): X509Certificate {
    val applicationInfo = context.packageManager.getApplicationInfo(
      context.packageName,
      PackageManager.GET_META_DATA
    )
    val certificatePem = applicationInfo.metaData?.getString(UPDATE_CERTIFICATE_METADATA)
      ?: throw IllegalStateException("The OTA signing certificate is not embedded in this build.")
    val certificate = CertificateFactory.getInstance("X.509")
      .generateCertificate(ByteArrayInputStream(certificatePem.toByteArray(Charsets.UTF_8))) as X509Certificate
    certificate.checkValidity()
    return certificate
  }

  @Suppress("DEPRECATION")
  private fun getArchivePackageInfo(file: File): PackageInfo? {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      PackageManager.GET_SIGNATURES
    }
    return context.packageManager.getPackageArchiveInfo(file.absolutePath, flags)
  }

  @Suppress("DEPRECATION")
  private fun getInstalledPackageInfo(): PackageInfo {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      PackageManager.GET_SIGNATURES
    }
    return context.packageManager.getPackageInfo(context.packageName, flags)
  }

  @Suppress("DEPRECATION")
  private fun signerDigests(packageInfo: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signingInfo = packageInfo.signingInfo ?: return emptySet()
      if (signingInfo.hasMultipleSigners()) {
        signingInfo.apkContentsSigners
      } else {
        signingInfo.signingCertificateHistory
      }
    } else {
      packageInfo.signatures
    }
    return signatures.orEmpty()
      .map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).toHex() }
      .toSet()
  }

  private fun requireVerifiedApk(fileUri: String): File {
    val uri = Uri.parse(fileUri)
    if (uri.scheme != "file") throw SecurityException("Only verified local APK files can be installed.")
    val file = File(uri.path ?: throw IllegalArgumentException("APK file URI is invalid.")).canonicalFile
    val root = updateDirectory.canonicalFile
    if (file.parentFile != root || !file.name.endsWith(".apk") || !file.isFile) {
      throw SecurityException("APK file is outside the verified update cache.")
    }
    return file
  }

  private fun clearPartialDownloads() {
    updateDirectory.listFiles()?.filter { it.name.endsWith(".part") }?.forEach { it.delete() }
  }

  private fun clearStaleDownloadFiles() {
    val cutoff = System.currentTimeMillis() - STALE_DOWNLOAD_AGE_MS
    updateDirectory.listFiles()?.forEach { file ->
      if (file.name.endsWith(".part") || file.lastModified() < cutoff) file.delete()
    }
  }

  private fun sanitizeFileName(value: String): String {
    val sanitized = value.replace(Regex("[^A-Za-z0-9._-]"), "-")
    return if (sanitized.lowercase(Locale.US).endsWith(".apk")) sanitized else "$sanitized.apk"
  }

  @Suppress("DEPRECATION")
  private fun PackageInfo.longVersionCodeCompat(): Long {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) longVersionCode else versionCode.toLong()
  }

  private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

  private data class DownloadConnection(
    val connection: HttpURLConnection,
    val finalUri: URI
  )

  private class DownloadCancelledException :
    CodedException("ERR_DOWNLOAD_CANCELLED", "APK download was cancelled.", null)
}
