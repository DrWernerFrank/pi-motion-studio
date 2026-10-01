# Third-party downloads

Everything fetched for the editing pipeline: URL, license, sha256. Nothing here is committed to git; media lives in
`~/.cache/pi-motion-studio/fixtures/`, models in `~/.local/share/pi-motion-studio/models/`.

## Test media

| file | source | license | sha256 |
|---|---|---|---|
| `real/talking-head-original.webm` (54 s, 1280x720, 30000/1001, VP8 + Vorbis) | https://commons.wikimedia.org/wiki/File:Astronaut_Scott_Kelly_Speaks_Out_Against_Bullying.webm (NASA Johnson) | Public domain (NASA work) | `f3dd2f87b8dedbc6ea9864af594e2de4fc8a2b5d425f85f834ba7f36c1d04472` |

## Models

| file | source | license | sha256 (first 16) |
|---|---|---|---|
| Piper voice `en_US-ljspeech-medium.onnx(.json)` | https://huggingface.co/rhasspy/piper-voices (en/en_US/ljspeech/medium) | dataset LJSpeech: public domain (model card) | `6f52a751e2349abe` |
| Piper voice `en_GB-northern_english_male-medium.onnx(.json)` | same repo (en/en_GB/northern_english_male/medium) | CC-BY-SA 4.0 (OpenSLR 83); used only to generate a private test fixture | `57a219ae8e638873` |
| Piper voice `fa_IR-amir-medium.onnx(.json)` | same repo (fa/fa_IR/amir/medium) | CC0 (model card) | `fb815380d969ea37` |
| YuNet `face_detection_yunet_2023mar.onnx` | https://github.com/opencv/opencv_zoo (models/face_detection_yunet) | MIT | `8f2383e4dd3cfbb4` |
| faster-whisper `small` (CTranslate2 int8) | https://huggingface.co/Systran/faster-whisper-small, fetched by faster-whisper | MIT | (cached by huggingface_hub) |

## Python packages (ML venv, user space)

faster-whisper 1.2.1, ctranslate2, onnxruntime, opencv-python-headless 5.0.0, piper-tts 1.8.0, numpy, scipy, soundfile, uv (bootstrap).
No `curl | bash`, no downloaded executables run.

## Reference only (not copied)

veedstudio/open-edit (Apache-2.0), shallow clone in `~/.cache/pi-motion-studio/ref/`. See INSPIRATION.md. No NOTICE entry needed: no code was copied.
