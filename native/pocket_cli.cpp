/* Local Linux/macOS test harness; NOT an Android/iPhone application. */
#include "pocket_voice.h"
#include <fstream>
#include <iostream>
#include <memory>
#include <string>
int main(int argc,char **argv) {
 if(argc!=6 || std::string(argv[5])!="--consent-own-voice") {
  std::cerr<<"Usage: echo-pocket-cli MODEL_DIR OWN_REFERENCE.wav TEXT.txt NEW_OUTPUT.wav --consent-own-voice\n";return 2;
 }
 const std::string root=std::string(argv[1])+"/";
 const std::string flow=root+"lm_flow.int8.onnx", main=root+"lm_main.int8.onnx", encoder=root+"encoder.onnx", decoder=root+"decoder.int8.onnx", conditioner=root+"text_conditioner.onnx", vocab=root+"vocab.json", scores=root+"token_scores.json";
 EchoPocketFiles files{flow.c_str(),main.c_str(),encoder.c_str(),decoder.c_str(),conditioner.c_str(),vocab.c_str(),scores.c_str()};
 std::ifstream input(argv[3]);std::string text;char c;
 if(!input)return 2;
 while(input.get(c) && text.size()<=1200)text+=c;
 if(text.empty() || text.size()>1200)return 2;
 std::unique_ptr<void,decltype(&echo_pocket_destroy)> engine(echo_pocket_create(&files),echo_pocket_destroy);
 if(!engine){std::cerr<<"Local model unavailable\n";return 3;}
 int status=echo_pocket_generate(engine.get(),text.c_str(),"en",argv[2],argv[4],1);
 if(status!=ECHO_VOICE_OK)std::cerr<<"Synthesis failed, code="<<status<<"\n";
 return status;
}
