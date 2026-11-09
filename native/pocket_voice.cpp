#include "pocket_voice.h"
#include "sherpa-onnx/c-api/c-api.h"
#include <cstring>
#include <fstream>
#include <memory>
namespace {
bool exists(const char *path) { return path && *path && std::ifstream(path).good(); }
size_t characters(const char *s) { size_t n=0;for(;*s;++s)if((static_cast<unsigned char>(*s)&0xc0)!=0x80)++n;return n; }
}
extern "C" void *echo_pocket_create(const EchoPocketFiles *f) {
 if(!f || !exists(f->lm_flow) || !exists(f->lm_main) || !exists(f->encoder) ||
    !exists(f->decoder) || !exists(f->text_conditioner) || !exists(f->vocab_json) || !exists(f->token_scores_json))return nullptr;
 SherpaOnnxOfflineTtsConfig config{};
 config.model.num_threads=2;config.model.provider="cpu";config.max_num_sentences=1;
 auto &p=config.model.pocket;
 p.lm_flow=f->lm_flow;p.lm_main=f->lm_main;p.encoder=f->encoder;p.decoder=f->decoder;
 p.text_conditioner=f->text_conditioner;p.vocab_json=f->vocab_json;p.token_scores_json=f->token_scores_json;
 p.voice_embedding_cache_capacity=1;
 return const_cast<SherpaOnnxOfflineTts *>(SherpaOnnxCreateOfflineTts(&config));
}
extern "C" void echo_pocket_destroy(void *engine) {
 if(engine)SherpaOnnxDestroyOfflineTts(static_cast<const SherpaOnnxOfflineTts *>(engine));
}
extern "C" int echo_pocket_generate(void *engine,const char *text,const char *language,
 const char *reference_wav,const char *output_wav,int owner_consent) {
 if(owner_consent!=1)return ECHO_VOICE_CONSENT_REQUIRED;
 if(!text || !*text || characters(text)>300 || !language || std::strcmp(language,"en")!=0 ||
    !exists(reference_wav) || !output_wav || !*output_wav || exists(output_wav) || std::strcmp(reference_wav,output_wav)==0)return ECHO_VOICE_INVALID_INPUT;
 if(!engine)return ECHO_VOICE_MODEL_MISSING;
 // Caller must serialize one engine, use private files, and verify the model package.
 const auto *wave=SherpaOnnxReadWave(reference_wav);
 if(!wave)return ECHO_VOICE_WAV_FAILED;
 std::unique_ptr<const SherpaOnnxWave,decltype(&SherpaOnnxFreeWave)> input(wave,SherpaOnnxFreeWave);
 if(wave->sample_rate<8000 || wave->sample_rate>96000 || wave->num_samples<6LL*wave->sample_rate || wave->num_samples>30LL*wave->sample_rate)return ECHO_VOICE_INVALID_INPUT;
 SherpaOnnxGenerationConfig generation{};
 generation.speed=1;generation.silence_scale=.2f;generation.num_steps=5;
 generation.reference_audio=wave->samples;generation.reference_audio_len=wave->num_samples;
 generation.reference_sample_rate=wave->sample_rate;
 generation.extra="{\"max_reference_audio_len\":10.0}";
 const auto *audio=SherpaOnnxOfflineTtsGenerateWithConfig(static_cast<const SherpaOnnxOfflineTts *>(engine),text,&generation,nullptr,nullptr);
 if(!audio)return ECHO_VOICE_ENGINE_FAILED;
 std::unique_ptr<const SherpaOnnxGeneratedAudio,decltype(&SherpaOnnxDestroyOfflineTtsGeneratedAudio)> result(audio,SherpaOnnxDestroyOfflineTtsGeneratedAudio);
 if(!audio->samples || audio->n<=0 || audio->sample_rate<=0)return ECHO_VOICE_ENGINE_FAILED;
 return SherpaOnnxWriteWave(audio->samples,audio->n,audio->sample_rate,output_wav)?ECHO_VOICE_OK:ECHO_VOICE_WAV_FAILED;
}
