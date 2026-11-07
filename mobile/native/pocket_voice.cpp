// Cross-platform PocketTTS inference core using the official sherpa-onnx C API.
// NOT yet linked to Android JNI or iOS Swift. Model weights are never bundled.
#include <string>
#include <filesystem>
#include <cstring>
#include "sherpa-onnx/c-api/c-api.h"

extern "C" int echo_pocket_en_synthesize(
    const char *model_directory,
    const char *reference_wav,
    const char *text,
    const char *output_wav
) {
    if (!model_directory || !reference_wav || !text || !output_wav) return 1;
    const size_t n = std::strlen(text);
    if (n == 0 || n > 300) return 2;

    namespace fs = std::filesystem;
    const fs::path root(model_directory);
    auto path = [&root](const char *name) -> std::string {
        return (root / name).string();
    };
    const std::string lm_flow = path("lm_flow.int8.onnx");
    const std::string lm_main = path("lm_main.int8.onnx");
    const std::string encoder = path("encoder.onnx");
    const std::string decoder = path("decoder.int8.onnx");
    const std::string conditioner = path("text_conditioner.onnx");
    const std::string vocab = path("vocab.json");
    const std::string scores = path("token_scores.json");

    for (const auto &name : {lm_flow, lm_main, encoder, decoder, conditioner, vocab, scores}) {
        if (!fs::is_regular_file(fs::path(name))) return 3;
    }
    if (!fs::is_regular_file(fs::path(reference_wav))) return 4;

    SherpaOnnxOfflineTtsConfig config = {};
    config.model.pocket.lm_flow = lm_flow.c_str();
    config.model.pocket.lm_main = lm_main.c_str();
    config.model.pocket.encoder = encoder.c_str();
    config.model.pocket.decoder = decoder.c_str();
    config.model.pocket.text_conditioner = conditioner.c_str();
    config.model.pocket.vocab_json = vocab.c_str();
    config.model.pocket.token_scores_json = scores.c_str();
    config.model.pocket.voice_embedding_cache_capacity = 1;
    config.model.num_threads = 2;
    config.model.debug = 0;

    const SherpaOnnxOfflineTts *tts = SherpaOnnxCreateOfflineTts(&config);
    if (!tts) return 5;
    const SherpaOnnxWave *reference = SherpaOnnxReadWave(reference_wav);
    if (!reference || reference->num_samples <= 0 || reference->sample_rate <= 0) {
        if (reference) SherpaOnnxFreeWave(reference);
        SherpaOnnxDestroyOfflineTts(tts);
        return 6;
    }
    SherpaOnnxGenerationConfig generation = {};
    generation.reference_audio = reference->samples;
    generation.reference_audio_len = reference->num_samples;
    generation.reference_sample_rate = reference->sample_rate;
    generation.extra = "{\"max_reference_audio_len\":10.0,\"seed\":42}";
    const SherpaOnnxGeneratedAudio *result =
        SherpaOnnxOfflineTtsGenerateWithConfig(tts, text, &generation, nullptr, nullptr);

    SherpaOnnxFreeWave(reference);
    int status = 7;
    if (result && result->samples && result->n > 0 && result->sample_rate > 0) {
        const int write_status = SherpaOnnxWriteWave(
            result->samples, result->n, result->sample_rate, output_wav);
        status = (write_status == 1) ? 0 : 8;
    }
    if (result) SherpaOnnxDestroyOfflineTtsGeneratedAudio(result);
    SherpaOnnxDestroyOfflineTts(tts);
    return status;
}
