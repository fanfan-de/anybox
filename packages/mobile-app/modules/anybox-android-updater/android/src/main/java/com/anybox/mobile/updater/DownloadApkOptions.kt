package com.anybox.mobile.updater

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

data class DownloadApkOptions(
  @Field
  val url: String,
  @Field
  val expectedSha256: String,
  @Field
  val expectedSizeBytes: Long,
  @Field
  val expectedPackageName: String,
  @Field
  val expectedVersionCode: Long,
  @Field
  val fileName: String? = null
) : Record
