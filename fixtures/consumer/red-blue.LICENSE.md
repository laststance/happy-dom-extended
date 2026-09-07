# Generated video fixture

`red-blue.webm` is an original, synthetic fixture generated for this repository and distributed under its MIT license. It contains two 16×16 VP9 frames at 1 fps: red, then blue. The source has SMPTE 170M / limited-range color metadata so browser and FFmpeg decoding select the same color interpretation.

```sh
ffmpeg -f lavfi -i 'color=c=red:s=16x16:r=1:d=1' -f lavfi -i 'color=c=blue:s=16x16:r=1:d=1' -filter_complex '[0:v][1:v]concat=n=2:v=1:a=0[v]' -map '[v]' -c:v libvpx-vp9 -lossless 1 -pix_fmt yuv420p -colorspace smpte170m -color_primaries smpte170m -color_trc smpte170m -color_range tv red-blue.webm
```

Expected decoded RGBA samples are `[254, 0, 0, 255]` before 1 second and `[0, 0, 255, 255]` afterward. The one-level red difference comes from RGB↔YUV conversion. This fixture contains no third-party footage, audio, fonts or external resources.
