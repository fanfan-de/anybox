#!/usr/bin/env bash
set -euo pipefail

platform="${1:?usage: build-media-runtime.sh <win32|darwin> <x64|arm64>}"
arch="${2:?usage: build-media-runtime.sh <win32|darwin> <x64|arm64>}"
ffmpeg_revision="${ANYBOX_FFMPEG_REVISION:-8ad6288553}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
desktop_dir="$(cd "${script_dir}/.." && pwd)"
work_dir="${ANYBOX_MEDIA_RUNTIME_WORK_DIR:-${desktop_dir}/build/media-runtime-source-${platform}-${arch}}"
output_dir="${ANYBOX_MEDIA_RUNTIME_OUTPUT_DIR:-${desktop_dir}/build/media-runtime-candidates/${platform}-${arch}}"
source_dir="${work_dir}/ffmpeg"
prefix_dir="${work_dir}/prefix"
stage_dir="${output_dir}/stage"

rm -rf "${work_dir}" "${output_dir}"
mkdir -p "${work_dir}" "${output_dir}" "${stage_dir}"
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
make -j"${ANYBOX_MEDIA_RUNTIME_JOBS:-2}" ffmpeg ffprobe
popd >/dev/null

cp "${source_dir}/${ffmpeg_name}" "${stage_dir}/${ffmpeg_name}"
cp "${source_dir}/${ffprobe_name}" "${stage_dir}/${ffprobe_name}"
cp "${source_dir}/COPYING.LGPLv3" "${stage_dir}/LICENSE.txt"
cp "${recipe_copy}" "${stage_dir}/BUILD-RECIPE.sh"
cat > "${stage_dir}/SOURCE.txt" <<EOF
FFmpeg revision: ${ffmpeg_revision}
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

This is an unapproved candidate. It must not be published until immutable mirroring,
license review, release approval, and installed-app evidence are complete.
EOF

"${stage_dir}/${ffmpeg_name}" -hide_banner -encoders 2>&1 | grep -q "${video_encoder}"
"${stage_dir}/${ffmpeg_name}" -hide_banner -encoders 2>&1 | grep -q " aac "

if [[ "${ANYBOX_MEDIA_RUNTIME_RUN_SMOKE:-0}" == "1" ]]; then
  smoke_output="${output_dir}/smoke.mp4"
  "${stage_dir}/${ffmpeg_name}" -hide_banner -loglevel error \
    -f lavfi -i "testsrc2=size=320x180:rate=24" \
    -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
    -t 1 -c:v "${video_encoder}" -c:a aac -y "${smoke_output}"
  "${stage_dir}/${ffprobe_name}" -v error -show_streams -show_format -of json "${smoke_output}" > "${output_dir}/smoke.ffprobe.json"
fi

tar -czf "${output_dir}/${archive_name}" -C "${stage_dir}" .
node "${script_dir}/describe-media-runtime-candidate.mjs" \
  --platform "${platform}" \
  --arch "${arch}" \
  --stage "${stage_dir}" \
  --archive "${output_dir}/${archive_name}" \
  --source "${source_archive}" \
  --recipe "${recipe_copy}" \
  --output "${output_dir}/candidate.json" \
  --revision "${ffmpeg_revision}"

echo "[desktop][media] built unapproved ${platform}/${arch} candidate at ${output_dir}"
