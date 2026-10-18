import {analyzeSamples} from '../analysis/sceneAnalysis.js';
self.onmessage=event=>{
  try{const {samples,width,height,fps}=event.data;self.postMessage({result:analyzeSamples(samples,width,height,fps)})}
  catch(error){self.postMessage({error:error.message})}
};
