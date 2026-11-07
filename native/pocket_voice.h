#ifndef ECHO_POCKET_VOICE_H
#define ECHO_POCKET_VOICE_H
#ifdef __cplusplus
extern "C" {
#endif
/* Foundation for JNI/Swift adapters, NOT a shipped Android/iOS application. */
typedef struct EchoPocketFiles {
 const char *lm_flow, *lm_main, *encoder, *decoder, *text_conditioner;
 const char *vocab_json, *token_scores_json;
} EchoPocketFiles;
typedef enum EchoVoiceStatus {
 ECHO_VOICE_OK=0, ECHO_VOICE_CONSENT_REQUIRED=1, ECHO_VOICE_INVALID_INPUT=2,
 ECHO_VOICE_MODEL_MISSING=3, ECHO_VOICE_ENGINE_FAILED=4, ECHO_VOICE_WAV_FAILED=5
} EchoVoiceStatus;
void *echo_pocket_create(const EchoPocketFiles *files);
void echo_pocket_destroy(void *engine);
/* Only EN is allowed. Input: own 6–30 s mono PCM16 WAV. No network calls. */
int echo_pocket_generate(void *engine, const char *text, const char *language,
 const char *reference_wav, const char *output_wav, int owner_consent);
#ifdef __cplusplus
}
#endif
#endif
