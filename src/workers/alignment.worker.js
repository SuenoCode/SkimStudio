// Opt-in only: never loaded until the user confirms the model download.
self.onmessage=async event=>{
  let recognizer;
  try{
    const runtime=await import('@huggingface/transformers');
    runtime.env.allowLocalModels=false;
    runtime.env.backends.onnx.wasm.numThreads=1;
    recognizer=await runtime.pipeline('automatic-speech-recognition','Xenova/whisper-base.en',{dtype:'q8',progress_callback:progress=>self.postMessage({progress})});
    const result=await recognizer(event.data.pcm,{return_timestamps:'word',chunk_length_s:20,stride_length_s:3});
    self.postMessage({tokens:(result.chunks||[]).map(chunk=>({text:chunk.text,start:chunk.timestamp?.[0],end:chunk.timestamp?.[1]}))});
  }catch(error){self.postMessage({error:error.message})}
  finally{await recognizer?.dispose?.()}
};
