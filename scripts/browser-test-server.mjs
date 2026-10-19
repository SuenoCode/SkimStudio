import {createServer,preview} from 'vite';

export default async function setup(){
  const production=process.env.SKIMSTUDIO_TEST_PRODUCTION==='1';
  const port=production?4180:5180;
  if(production){
    const server=await preview({preview:{host:'127.0.0.1',port,strictPort:true}});
    return async()=>{server.httpServer.closeAllConnections();await new Promise((resolve,reject)=>server.httpServer.close(error=>error?reject(error):resolve()));};
  }
  const server=await createServer({server:{host:'127.0.0.1',port,strictPort:true}});
  try{await server.listen();}catch(error){await server.close();throw error;}
  return async()=>{server.httpServer?.closeAllConnections();await server.close();};
}
