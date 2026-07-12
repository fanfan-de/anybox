#!/usr/bin/env bash
set -euo pipefail

platform="${1:?usage: build-media-runtime.sh <win32|darwin> <x64|arm64>}"
arch="${2:?usage: build-media-runtime.sh <win32|darwin> <x64|arm64>}"
ffmpeg_revision="${ANYBOX_FFMPEG_REVISION:-8ad6288553}"
node_binary="${ANYBOX_NODE_BINARY:-node}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
desktop_dir="$(cd "${script_dir}/.." && pwd)"
work_dir="${ANYBOX_MEDIA_RUNTIME_WORK_DIR:-${desktop_dir}/build/media-runtime-source-${platform}-${arch}}"
output_dir="${ANYBOX_MEDIA_RUNTIME_OUTPUT_DIR:-${desktop_dir}/build/media-runtime-candidates/${platform}-${arch}}"
source_dir="${work_dir}/ffmpeg"
prefix_dir="${work_dir}/prefix"
stage_dir="${output_dir}/stage"
sources_dir="${output_dir}/subtitle-sources"
evidence_dir="${stage_dir}/evidence"

if [[ "${ANYBOX_MEDIA_RUNTIME_RUN_SMOKE:-0}" != "1" ]]; then
  echo "media runtime candidates require ANYBOX_MEDIA_RUNTIME_RUN_SMOKE=1 so render and subtitle evidence is archive-bound" >&2
  exit 2
fi

libass_version="0.17.5"
libass_sha256="2dca25c0e0c837ddf00b52011b3f82cac1e4ddd3ad018227806b0c2288864acc"
freetype_version="2.14.3"
freetype_sha256="36bc4f1cc413335368ee656c42afca65c5a3987e8768cc28cf11ba775e785a5f"
fribidi_version="1.0.16"
fribidi_sha256="1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c"
harfbuzz_version="14.2.1"
harfbuzz_sha256="a54a5d8e9380a41fbb762ce367bcbf7704792dfca0d93f1bbca86c5a57902e0e"
noto_version="2.004"
noto_sha256="2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b"

rm -rf "${work_dir}" "${output_dir}"
mkdir -p "${work_dir}" "${output_dir}" "${stage_dir}" "${sources_dir}" "${stage_dir}/fonts" "${evidence_dir}"

fetch_verified() {
  local url="$1"
  local output="$2"
  local expected="$3"
  curl --fail --location --retry 3 --output "${output}" "${url}"
  echo "${expected}  ${output}" | sha256sum --check --status
}

fetch_verified "https://github.com/libass/libass/releases/download/${libass_version}/libass-${libass_version}.tar.xz" "${sources_dir}/libass-${libass_version}.tar.xz" "${libass_sha256}"
fetch_verified "https://download.savannah.gnu.org/releases/freetype/freetype-${freetype_version}.tar.xz" "${sources_dir}/freetype-${freetype_version}.tar.xz" "${freetype_sha256}"
fetch_verified "https://github.com/fribidi/fribidi/releases/download/v${fribidi_version}/fribidi-${fribidi_version}.tar.xz" "${sources_dir}/fribidi-${fribidi_version}.tar.xz" "${fribidi_sha256}"
fetch_verified "https://github.com/harfbuzz/harfbuzz/releases/download/${harfbuzz_version}/harfbuzz-${harfbuzz_version}.tar.xz" "${sources_dir}/harfbuzz-${harfbuzz_version}.tar.xz" "${harfbuzz_sha256}"
fetch_verified "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf" "${stage_dir}/fonts/NotoSansCJKsc-Regular.otf" "${noto_sha256}"
curl --fail --location --retry 3 --output "${stage_dir}/fonts/OFL-1.1.txt" "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE"

test "$(pkg-config --modversion libass)" = "${libass_version}"
test "$(pkg-config --modversion fribidi)" = "${fribidi_version}"
test "$(pkg-config --modversion harfbuzz)" = "${harfbuzz_version}"
git clone --filter=blob:none https://github.com/FFmpeg/FFmpeg.git "${source_dir}"
git -C "${source_dir}" checkout --detach "${ffmpeg_revision}"
source_archive="${output_dir}/ffmpeg-source-${ffmpeg_revision}.tar.gz"
recipe_copy="${output_dir}/build-media-runtime.sh"
git -C "${source_dir}" archive --format=tar.gz --prefix="ffmpeg-${ffmpeg_revision}/" --output="${source_archive}" "${ffmpeg_revision}"
cp "${script_dir}/build-media-runtime.sh" "${recipe_copy}"

common_flags=(
  "--prefix=${prefix_dir}"
  "--enable-version3"
  "--enable-static"
  "--disable-shared"
  "--disable-doc"
  "--disable-debug"
  "--disable-gpl"
  "--disable-nonfree"
  "--disable-libopenh264"
  "--disable-libx264"
  "--disable-libx265"
  "--disable-libfdk-aac"
  "--enable-libass"
)

case "${platform}/${arch}" in
  win32/x64)
    target_flags=("--arch=x86_64" "--target-os=mingw32" "--enable-mediafoundation")
    ffmpeg_name="ffmpeg.exe"
    ffprobe_name="ffprobe.exe"
    video_encoder="h264_mf"
    archive_name="ffmpeg-anybox-${ffmpeg_revision}-win32-x64-lgpl.tar.gz"
    ;;
  darwin/arm64)
    if [[ "$(uname -m)" != "arm64" ]]; then
      echo "macOS candidate must be built on native arm64 hardware" >&2
      exit 1
    fi
    target_flags=("--arch=arm64" "--target-os=darwin" "--enable-videotoolbox")
    ffmpeg_name="ffmpeg"
    ffprobe_name="ffprobe"
    video_encoder="h264_videotoolbox"
    archive_name="ffmpeg-anybox-${ffmpeg_revision}-darwin-arm64-lgpl.tar.gz"
    ;;
  *)
    echo "unsupported candidate target ${platform}/${arch}" >&2
    exit 1
    ;;
esac

pushd "${source_dir}" >/dev/null
./configure "${common_flags[@]}" "${target_flags[@]}"
make -j"${ANYBOX_MEDIA_RUNTIME_JOBS:-2}" "${ffmpeg_name}" "${ffprobe_name}"
popd >/dev/null

cp "${source_dir}/${ffmpeg_name}" "${stage_dir}/${ffmpeg_name}"
cp "${source_dir}/${ffprobe_name}" "${stage_dir}/${ffprobe_name}"
cp "${source_dir}/COPYING.LGPLv3" "${stage_dir}/LICENSE.txt"
cp "${recipe_copy}" "${stage_dir}/BUILD-RECIPE.sh"
cat > "${stage_dir}/SOURCE.txt" <<EOF
FFmpeg revision: ${ffmpeg_revision}
libass: ${libass_version} sha256=${libass_sha256}
FreeType: ${freetype_version} sha256=${freetype_sha256}
FriBidi: ${fribidi_version} sha256=${fribidi_sha256}
HarfBuzz: ${harfbuzz_version} sha256=${harfbuzz_sha256}
Noto Sans CJK SC: ${noto_version} sha256=${noto_sha256}
Source archive: $(basename "${source_archive}")
Source origin: https://github.com/FFmpeg/FFmpeg/commit/${ffmpeg_revision}
EOF
"${stage_dir}/${ffmpeg_name}" -buildconf > "${stage_dir}/configure.txt" 2>&1
cat > "${stage_dir}/THIRD-PARTY-NOTICES.txt" <<EOF
FFmpeg media runtime candidate for Anybox

FFmpeg revision: ${ffmpeg_revision}
Source: https://github.com/FFmpeg/FFmpeg/commit/${ffmpeg_revision}
Build recipe: packages/desktop/scripts/build-media-runtime.sh
License: LGPL-3.0-or-later; see LICENSE.txt.
Subtitle renderer: libass ${libass_version} with FreeType ${freetype_version}, FriBidi ${fribidi_version}, and HarfBuzz ${harfbuzz_version}.
Bundled font: Noto Sans CJK SC ${noto_version}; see fonts/OFL-1.1.txt.

This is an unapproved candidate. It must not be published until immutable mirroring,
license review, release approval, and installed-app evidence are complete.
EOF

"${stage_dir}/${ffmpeg_name}" -hide_banner -encoders 2>&1 | grep -q "${video_encoder}"
"${stage_dir}/${ffmpeg_name}" -hide_banner -encoders 2>&1 | grep -q " aac "
"${stage_dir}/${ffmpeg_name}" -hide_banner -filters 2>&1 | grep -Eq "[[:space:]]ass[[:space:]].*libass"

if [[ "${ANYBOX_MEDIA_RUNTIME_RUN_SMOKE:-0}" == "1" ]]; then
  pushd "${evidence_dir}" >/dev/null
  "../${ffmpeg_name}" -hide_banner -loglevel error \
    -f lavfi -i "testsrc2=size=320x180:rate=24" \
    -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
    -t 1 -c:v "${video_encoder}" -c:a aac -y smoke.mp4
  "../${ffprobe_name}" -v error -show_streams -show_format -of json smoke.mp4 > smoke.ffprobe.json
  cat > subtitle-smoke.ass <<'EOF'
[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans CJK SC,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Cinema 字幕 smoke
EOF
  "../${ffmpeg_name}" -hide_banner -loglevel error -f lavfi -i "color=c=black:s=320x180:r=24:d=1" -vf "ass=subtitle-smoke.ass:fontsdir=../fonts" -c:v "${video_encoder}" -an -y subtitle-smoke.mp4
  "../${ffprobe_name}" -v error -show_streams -show_format -of json subtitle-smoke.mp4 > subtitle-smoke.ffprobe.json
  "../${ffmpeg_name}" -hide_banner -loglevel error -ss 0.5 -i subtitle-smoke.mp4 -frames:v 1 -y subtitle-smoke.png
  popd >/dev/null
fi

tar -czf "${output_dir}/${archive_name}" -C "${stage_dir}" .
"${node_binary}" "${script_dir}/describe-media-runtime-candidate.mjs" \
  --platform "${platform}" \
  --arch "${arch}" \
  --stage "${stage_dir}" \
  --archive "${output_dir}/${archive_name}" \
  --source "${source_archive}" \
  --recipe "${recipe_copy}" \
  --output "${output_dir}/candidate.json" \
  --revision "${ffmpeg_revision}"

echo "[desktop][media] built unapproved ${platform}/${arch} candidate at ${output_dir}"
